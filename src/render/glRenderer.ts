import type { Recipe, RenderContext } from '../recipe';
import { GLProgram, setSampling } from './glutil';
import { VERT, FINAL_FRAG } from './shaders';
import type { Backend, SourceImage } from './pipeline';

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

interface SourceTex {
  tex: WebGLTexture;
  width: number;
  height: number;
}

/** Tile edge for the final pass. Splitting huge outputs into scissored tiles
 * keeps each GPU submission short, avoiding driver watchdog resets. */
const TILE = 2048;
/** Keep a few source textures resident (preview + thumbnails). */
const MAX_SOURCES = 4;

export interface RenderOptions {
  /** Skip in-shader palette quantisation (a CPU error-diffusion pass follows). */
  skipPalette?: boolean;
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
  private finalProg: GLProgram;
  private sources = new Map<string, SourceTex>();
  private vao: WebGLVertexArrayObject;
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
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    this.maxOutputSize = Math.min(vp[0], vp[1], gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), this.maxTextureSize);
    this.vao = gl.createVertexArray()!;
    this.finalProg = new GLProgram(gl, VERT, FINAL_FRAG, 'final');
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

  dropSource(key: string): void {
    const s = this.sources.get(key);
    if (s) {
      this.gl.deleteTexture(s.tex);
      this.sources.delete(key);
    }
  }

  /** Render the recipe for a source into this renderer's canvas at outW×outH. */
  render(key: string, recipe: Recipe, ctx: RenderContext, outW: number, outH: number, _opts: RenderOptions = {}): void {
    const gl = this.gl;
    const src = this.sources.get(key);
    if (!src) throw new Error(`No source texture for ${key}`);
    if (this.canvas.width !== outW || this.canvas.height !== outH) {
      this.canvas.width = outW;
      this.canvas.height = outH;
    }
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    const a = recipe.adjust;
    const p = this.finalProg.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    p.i('u_src', 0)
      .f('u_outSize', outW, outH)
      .f('u_flipY', 1)
      .u('u_seed', ctx.seed)
      .f('u_exposure', a.exposure).f('u_brightness', a.brightness).f('u_contrast', a.contrast)
      .f('u_saturation', a.saturation).f('u_vibrance', a.vibrance)
      .f('u_highlights', a.highlights).f('u_shadows', a.shadows)
      .f('u_temperature', a.temperature).f('u_tint', a.tint).f('u_hue', a.hue)
      .f('u_gamma', a.gamma).f('u_fade', a.fade).f('u_sharpness', a.sharpness);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outW, outH);
    this.drawTiled(outW, outH);
  }

  private drawTiled(w: number, h: number): void {
    const gl = this.gl;
    if (w <= TILE && h <= TILE) {
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }
    gl.enable(gl.SCISSOR_TEST);
    for (let y = 0; y < h; y += TILE) {
      for (let x = 0; x < w; x += TILE) {
        gl.scissor(x, y, Math.min(TILE, w - x), Math.min(TILE, h - y));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.flush();
      }
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  dispose(): void {
    for (const k of [...this.sources.keys()]) this.dropSource(k);
    this.finalProg.dispose();
    this.gl.deleteVertexArray(this.vao);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
