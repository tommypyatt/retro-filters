import type { Recipe, RenderContext } from '../recipe';
import { GLProgram, createRenderTexture, deleteRenderTexture, hexToRgb, setSampling, type RenderTexture } from './glutil';
import { VERT, FINAL_FRAG, BRIGHT_FRAG, BLUR_FRAG } from './shaders';
import type { Backend, SourceImage } from './pipeline';
import { ditherSpread, paletteRgb, pixelGrid, usesErrorDiffusion, MAX_PALETTE } from './palettes';
import { decodeLut } from './lut';

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

interface SourceTex {
  tex: WebGLTexture;
  width: number;
  height: number;
}

/** Largest tile rendered per draw. Large outputs are rendered tile by tile
 * into a tile-sized canvas and assembled in 2D, which keeps each GPU
 * submission short (no driver watchdog resets), keeps GPU memory for the
 * framebuffer small, and avoids browsers silently clamping huge drawing
 * buffers. */
const TILE = 2048;
/** Keep a few source textures resident (preview + thumbnails). */
const MAX_SOURCES = 4;
/** Bloom is computed in a buffer of fixed size (long edge), independent of
 * output resolution, so preview and export bloom are the same. */
const BLOOM_EDGE = 384;

export interface RenderOptions {
  /** Skip in-shader palette quantisation (a CPU error-diffusion pass follows). */
  skipPalette?: boolean;
  /** Render only this part of the output (default: all of it). */
  tile?: { x: number; y: number; w: number; h: number };
}

/**
 * WebGL2 implementation of the recipe pipeline. Works with both
 * HTMLCanvasElement (preview) and OffscreenCanvas (export worker).
 */
export class GLRenderer implements Backend {
  readonly kind = 'webgl2' as const;
  readonly gl: WebGL2RenderingContext;
  readonly maxTextureSize: number;
  /** Largest output this context can render (viewport/renderbuffer limits). */
  readonly maxOutputSize: number;
  readonly maxTile = TILE;
  private finalProg: GLProgram;
  private brightProg: GLProgram;
  private blurProg: GLProgram;
  private sources = new Map<string, SourceTex>();
  private vao: WebGLVertexArrayObject;
  private bloomA: RenderTexture | null = null;
  private bloomB: RenderTexture | null = null;
  /** Inputs of the last bloom pass, so tiles of one image reuse it. */
  private bloomKey = '';
  private dummy2D: WebGLTexture;
  private dummy3D: WebGLTexture;
  private lutTex: WebGLTexture | null = null;
  private lutKey = '';
  private palBuf = new Float32Array(MAX_PALETTE * 3);
  lost = false;

  constructor(readonly canvas: AnyCanvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    // Output is assembled from tiles in a 2D canvas, so it is limited by the
    // source texture rather than by viewport or drawing-buffer limits.
    this.maxOutputSize = this.maxTextureSize;
    this.vao = gl.createVertexArray()!;
    this.finalProg = new GLProgram(gl, VERT, FINAL_FRAG, 'final');
    this.brightProg = new GLProgram(gl, VERT, BRIGHT_FRAG, 'bright');
    this.blurProg = new GLProgram(gl, VERT, BLUR_FRAG, 'blur');

    // Every sampler needs a texture of the right type on its own unit, even
    // when the effect is off: sampler2D and sampler3D may not share a unit.
    this.dummy2D = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.dummy2D);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.dummy3D = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, this.dummy3D);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
  }

  hasSource(key: string): boolean {
    return this.sources.has(key);
  }

  /**
   * Upload an image as an sRGB texture with mipmaps. Mipmaps give clean
   * downscaling in the preview and are used to average blocks for pixelate.
   */
  setSource(key: string, image: SourceImage): void {
    const gl = this.gl;
    if (image.width > this.maxTextureSize || image.height > this.maxTextureSize) {
      throw new Error(`Image ${image.width}×${image.height} exceeds MAX_TEXTURE_SIZE ${this.maxTextureSize}`);
    }
    this.dropSource(key);
    while (this.sources.size >= MAX_SOURCES) this.dropSource(this.sources.keys().next().value!);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    setSampling(gl, gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
    this.sources.set(key, { tex, width: image.width, height: image.height });
  }

  private texIds = new WeakMap<WebGLTexture, number>();
  private nextTexId = 1;
  private texId(t: WebGLTexture): number {
    let id = this.texIds.get(t);
    if (!id) this.texIds.set(t, (id = this.nextTexId++));
    return id;
  }

  dropSource(key: string): void {
    const s = this.sources.get(key);
    if (s) {
      this.gl.deleteTexture(s.tex);
      this.sources.delete(key);
    }
  }

  /**
   * Render the recipe for a source at outW×outH into this renderer's canvas.
   * With opts.tile, only that region is rendered and the canvas is tile-sized.
   */
  render(key: string, recipe: Recipe, ctx: RenderContext, outW: number, outH: number, opts: RenderOptions = {}): void {
    const gl = this.gl;
    const src = this.sources.get(key);
    if (!src) throw new Error(`No source texture for ${key}`);
    const tile = opts.tile ?? { x: 0, y: 0, w: outW, h: outH };
    if (tile.w > TILE || tile.h > TILE) throw new Error(`Tile ${tile.w}×${tile.h} exceeds ${TILE}px`);
    if (this.canvas.width !== tile.w || this.canvas.height !== tile.h) {
      this.canvas.width = tile.w;
      this.canvas.height = tile.h;
    }
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    const a = recipe.adjust;
    const hal = recipe.halation;
    const bloom = hal.enabled && hal.amount > 0 ? this.renderBloom(src, recipe, outW, outH) : null;
    const lut = recipe.lut?.enabled && recipe.lut.intensity > 0 ? this.ensureLut(recipe) : null;

    const p = this.finalProg.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloom ? bloom.tex : this.dummy2D);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, lut ?? this.dummy3D);
    gl.activeTexture(gl.TEXTURE0);
    p.i('u_src', 0).i('u_bloom', 1).i('u_lut', 2)
      .f('u_outSize', outW, outH)
      .f('u_tile', tile.x, tile.y, tile.w, tile.h)
      .f('u_srcSize', src.width, src.height)
      .f('u_flipY', 1)
      .u('u_seed', ctx.seed)
      .f('u_exposure', a.exposure).f('u_brightness', a.brightness).f('u_contrast', a.contrast)
      .f('u_saturation', a.saturation).f('u_vibrance', a.vibrance)
      .f('u_highlights', a.highlights).f('u_shadows', a.shadows)
      .f('u_temperature', a.temperature).f('u_tint', a.tint).f('u_hue', a.hue)
      .f('u_gamma', a.gamma).f('u_fade', a.fade).f('u_sharpness', a.sharpness);

    // Block grid shared by pixelate and palettes (see pixelGrid()).
    const grid = pixelGrid(recipe, outW, outH);
    // Each of the 4x4 taps per block covers a quarter block of source pixels.
    const blockSrcPx = grid ? src.width / grid[0] / 4 : 1;
    p.f('u_grid', grid ? grid[0] : 0, grid ? grid[1] : 0).f('u_gridLod', Math.max(0, Math.log2(blockSrcPx)));

    const on = (e: { enabled: boolean }, v: number) => (e.enabled ? v : 0);
    p.f('u_ca', on(recipe.chromaticAberration, recipe.chromaticAberration.amount));
    const crt = recipe.crt;
    p.f('u_crtCurv', on(crt, crt.curvature)).f('u_scan', on(crt, crt.scanlines)).f('u_lines', crt.lineCount);
    const vhs = recipe.vhs;
    p.f('u_vhsNoise', on(vhs, vhs.noise)).f('u_vhsTrack', on(vhs, vhs.tracking)).f('u_vhsBleed', on(vhs, vhs.bleed));
    // Halation tint: neutral bloom (warmth 0) to the red/orange of film
    // halation, where light scatters off the film base back into the red layer.
    const w = hal.warmth;
    p.f('u_halAmt', bloom ? hal.amount : 0).f('u_halTint', 1, 1 - 0.65 * w, 1 - 0.85 * w);
    p.f('u_lutAmt', lut ? recipe.lut!.intensity : 0).f('u_lutSize', recipe.lut?.size ?? 2);

    const t = recipe.tone;
    p.i('u_toneMode', t.enabled ? (t.mode === 'duotone' ? 1 : 2) : 0)
      .f('u_toneShadow', ...hexToRgb(t.shadowColour)).f('u_toneHigh', ...hexToRgb(t.highlightColour))
      .f('u_toneAmt', t.amount).f('u_toneBal', t.balance);
    p.f('u_posterise', on(recipe.posterise, recipe.posterise.levels));
    const leak = recipe.lightLeak;
    const rad = (leak.angle * Math.PI) / 180;
    p.f('u_leakAmt', on(leak, leak.amount)).f('u_leakSize', leak.size)
      .f('u_leakCol', ...hexToRgb(leak.colour)).f('u_leakDir', Math.cos(rad), Math.sin(rad));
    const v = recipe.vignette;
    p.f('u_vigAmt', on(v, v.amount)).f('u_vigSize', v.size).f('u_vigRound', v.roundness).f('u_vigFeather', v.feather);
    const g = recipe.grain;
    p.f('u_grainAmt', on(g, g.amount)).f('u_grainSize', g.size).f('u_grainColour', g.colour);

    const pal = recipe.palette;
    if (pal.enabled && !opts.skipPalette && !usesErrorDiffusion(recipe)) {
      const cols = paletteRgb(pal);
      cols.forEach((c, i) => this.palBuf.set(c, i * 3));
      p.i('u_palCount', cols.length).v3array('u_pal', this.palBuf)
        .i('u_dither', pal.dither === 'bayer4' ? 1 : pal.dither === 'bayer8' ? 2 : 0)
        .f('u_ditherAmt', pal.ditherStrength * ditherSpread(cols) * 1.5);
    } else {
      p.i('u_palCount', 0).i('u_dither', 0);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, tile.w, tile.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.flush();
  }

  /** Bright-pass + separable blur into a small fixed-size buffer. */
  private renderBloom(src: SourceTex, recipe: Recipe, outW: number, outH: number): RenderTexture {
    const gl = this.gl;
    const long = Math.max(outW, outH);
    const bw = Math.max(1, Math.round((BLOOM_EDGE * outW) / long));
    const bh = Math.max(1, Math.round((BLOOM_EDGE * outH) / long));
    if (!this.bloomA || this.bloomA.width !== bw || this.bloomA.height !== bh) {
      deleteRenderTexture(gl, this.bloomA);
      deleteRenderTexture(gl, this.bloomB);
      this.bloomA = createRenderTexture(gl, bw, bh);
      this.bloomB = createRenderTexture(gl, bw, bh);
      this.bloomKey = '';
    }
    const A = this.bloomA, B = this.bloomB!;
    const a = recipe.adjust;
    const hal = recipe.halation;
    const key = JSON.stringify([this.texId(src.tex), bw, bh, hal, a.exposure, a.temperature, a.tint]);
    if (key === this.bloomKey) return A;
    this.bloomKey = key;
    // Same exposure and white balance gains as the final pass, so the glow
    // follows the image's brightness.
    const t = a.temperature, n = a.tint;
    const gain = [(1 + 0.3 * t) * (1 + 0.12 * n), 1 - 0.18 * n, (1 - 0.3 * t) * (1 + 0.12 * n)];
    const lum = 0.2126 * gain[0] + 0.7152 * gain[1] + 0.0722 * gain[2];
    const expo = Math.pow(2, a.exposure) / lum;
    // Threshold is given on the perceptual (sRGB) scale for intuitive control.
    const thr = hal.threshold <= 0.04045 ? hal.threshold / 12.92 : Math.pow((hal.threshold + 0.055) / 1.055, 2.4);

    gl.viewport(0, 0, bw, bh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, A.fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    this.brightProg.use().i('u_src', 0).f('u_size', bw, bh)
      .f('u_lod', Math.max(0, Math.log2(src.width / bw) - 1))
      .f('u_gain', gain[0] * expo, gain[1] * expo, gain[2] * expo)
      .f('u_threshold', thr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Radius 0..1 -> sigma 0.5%..8% of the long edge.
    const sigma = BLOOM_EDGE * (0.005 + 0.075 * hal.radius);
    const blur = this.blurProg.use().i('u_tex', 0).f('u_size', bw, bh).f('u_sigma', sigma);
    gl.bindFramebuffer(gl.FRAMEBUFFER, B.fbo);
    gl.bindTexture(gl.TEXTURE_2D, A.tex);
    blur.f('u_dir', 1, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, A.fbo);
    gl.bindTexture(gl.TEXTURE_2D, B.tex);
    blur.f('u_dir', 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return A;
  }

  /** Upload the recipe's 3D LUT (cached by content) as an RGB16F texture. */
  private ensureLut(recipe: Recipe): WebGLTexture | null {
    const lut = recipe.lut!;
    const key = `${lut.size}:${lut.data.length}:${lut.data.slice(0, 64)}:${lut.data.slice(-64)}`;
    if (this.lutTex && key === this.lutKey) return this.lutTex;
    const gl = this.gl;
    const rgb = decodeLut(lut);
    if (!rgb) return null;
    const half = new Uint16Array(rgb.length);
    for (let i = 0; i < rgb.length; i++) half[i] = toHalf(rgb[i]);
    if (!this.lutTex) this.lutTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.HALF_FLOAT, half);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    this.lutKey = key;
    return this.lutTex;
  }

  dispose(): void {
    const gl = this.gl;
    for (const k of [...this.sources.keys()]) this.dropSource(k);
    deleteRenderTexture(gl, this.bloomA);
    deleteRenderTexture(gl, this.bloomB);
    gl.deleteTexture(this.dummy2D);
    gl.deleteTexture(this.dummy3D);
    if (this.lutTex) gl.deleteTexture(this.lutTex);
    this.finalProg.dispose();
    this.brightProg.dispose();
    this.blurProg.dispose();
    gl.deleteVertexArray(this.vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// float32 -> IEEE half bits (round to nearest; LUT values are within 0..1).
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >> (1 - exp);
    return sign | ((mant + 0x1000) >> 13);
  }
  if (exp >= 31) return sign | 0x7c00;
  const h = sign | (exp << 10) | (mant >> 13);
  return mant & 0x1000 ? h + 1 : h;
}
