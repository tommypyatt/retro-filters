import type { Recipe, RenderContext } from '../recipe';
import type { AnyCanvas, RenderOptions } from './glRenderer';
import type { Backend, SourceImage } from './pipeline';
import { hexToRgb } from './glutil';
import { ditherSpread, paletteRgb, pixelGrid, usesErrorDiffusion } from './palettes';

// Canvas 2D fallback used when WebGL2 is unavailable. It ports the shader's
// per-pixel colour maths to JS (same formulas, same order), so adjustments
// match the GPU path. Neighbourhood and geometric effects (sharpening,
// halation, chromatic aberration, CRT curvature, VHS, light leaks, LUTs) are
// GPU-only and are skipped here; the UI shows a warning listing them. Grain
// uses a different noise function, so its pattern differs from the GPU's.

export const CPU_UNSUPPORTED = ['sharpness', 'halation/bloom', 'chromatic aberration', 'CRT curvature', 'VHS', 'light leak', '3D LUT'];

const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const LIN_LUT = new Float32Array(256).map((_, i) => srgbToLin(i / 255));

export class CpuRenderer implements Backend {
  readonly kind = 'canvas2d' as const;
  readonly maxTextureSize = 16384;
  readonly maxOutputSize = 16384;
  readonly maxTile = Infinity;
  private sources = new Map<string, SourceImage>();
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  constructor(readonly canvas: AnyCanvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
  }

  hasSource(key: string): boolean { return this.sources.has(key); }
  setSource(key: string, image: SourceImage): void { this.sources.set(key, image); }
  dropSource(key: string): void { this.sources.delete(key); }
  dispose(): void { this.sources.clear(); }

  render(key: string, recipe: Recipe, rctx: RenderContext, w: number, h: number, opts: RenderOptions = {}): void {
    const src = this.sources.get(key);
    if (!src) throw new Error(`No source for ${key}`);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const grid = pixelGrid(recipe, w, h);
    if (grid) {
      // Pixelate: average into the block grid, then scale up without smoothing.
      const small = new OffscreenCanvas(grid[0], grid[1]);
      const sctx = small.getContext('2d')!;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(src, 0, 0, grid[0], grid[1]);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, w, h);
    } else {
      ctx.drawImage(src, 0, 0, w, h);
    }
    const img = ctx.getImageData(0, 0, w, h);
    processPixels(img.data, w, h, recipe, rctx.seed, grid, !!opts.skipPalette || usesErrorDiffusion(recipe));
    ctx.putImageData(img, 0, 0);
  }
}

function pcg(v: number): number {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}
const hash2 = (x: number, y: number, seed: number) => pcg((Math.imul(x, 1973) + pcg((Math.imul(y, 9277) + seed) >>> 0)) >>> 0) / 4294967295;

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function bayer(n: 4 | 8, x: number, y: number): number {
  if (n === 4) return (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
  const xy = x ^ y;
  const v = ((xy & 1) << 5) | ((y & 1) << 4) | ((xy & 2) << 2) | ((y & 2) << 1) | ((xy & 4) >> 1) | ((y & 4) >> 2);
  return (v + 0.5) / 64;
}

function processPixels(d: Uint8ClampedArray, w: number, h: number, r: Recipe, seed: number, grid: [number, number] | null, skipPalette: boolean): void {
  const a = r.adjust;
  const tone = r.tone;
  const toneMode = tone.enabled ? (tone.mode === 'duotone' ? 1 : 2) : 0;
  const tS = hexToRgb(tone.shadowColour), tH = hexToRgb(tone.highlightColour);
  const lS = luma(...tS), lH = luma(...tH);
  const post = r.posterise.enabled ? r.posterise.levels - 1 : 0;
  const vig = r.vignette, vAmt = vig.enabled ? vig.amount : 0;
  const aspect = w / h;
  const vMid = 0.25 + 0.8 * vig.size, vW = 0.05 + 0.95 * vig.feather;
  const gAmt = r.grain.enabled ? r.grain.amount : 0;
  const gScale = (1000 / r.grain.size) / Math.max(w, h);
  const scan = r.crt.enabled ? r.crt.scanlines : 0;
  const scanAA = Math.min(1, Math.max(0, (r.crt.lineCount / h - 0.3) / 0.2));
  const pal = r.palette.enabled && !skipPalette ? paletteRgb(r.palette) : null;
  const dith = r.palette.dither === 'bayer4' ? 4 : r.palette.dither === 'bayer8' ? 8 : 0;
  const dAmt = pal ? r.palette.ditherStrength * ditherSpread(pal) * 1.5 : 0;
  const smooth = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
  const expo = Math.pow(2, a.exposure);
  let gr = 1 + 0.3 * a.temperature, gg = 1, gb = 1 - 0.3 * a.temperature;
  gr *= 1 + 0.12 * a.tint; gg *= 1 - 0.18 * a.tint; gb *= 1 + 0.12 * a.tint;
  const gl = luma(gr, gg, gb);
  gr = (gr / gl) * expo; gg = (gg / gl) * expo; gb = (gb / gl) * expo;
  const hueRad = (-a.hue * Math.PI) / 180;
  const ca = Math.cos(hueRad), sa = Math.sin(hueRad);
  const cP = Math.pow(2, a.contrast * 1.3);
  const invGamma = 1 / a.gamma;

  const toneCh = (s: number): number => {
    if (a.brightness > 0) s = 1 - Math.pow(1 - s, 1 + 1.5 * a.brightness);
    else if (a.brightness < 0) s = Math.pow(s, 1 - 1.5 * a.brightness);
    if (a.contrast > 0) s = s < 0.5 ? 0.5 * Math.pow(2 * s, cP) : 1 - 0.5 * Math.pow(2 * (1 - s), cP);
    else if (a.contrast < 0) s = 0.5 + (s - 0.5) * (1 + 0.7 * a.contrast);
    return Math.pow(clamp01(s), invGamma);
  };

  for (let i = 0; i < d.length; i += 4) {
    const px = (i >> 2) % w, py = ((i >> 2) / w) | 0;
    const u = (px + 0.5) / w, v = (py + 0.5) / h;
    let R = clamp01(linToSrgb(LIN_LUT[d[i]] * gr));
    let G = clamp01(linToSrgb(LIN_LUT[d[i + 1]] * gg));
    let B = clamp01(linToSrgb(LIN_LUT[d[i + 2]] * gb));

    let L = luma(R, G, B);
    const lift = a.shadows * 1.6 * L * (1 - L) * (1 - L) + a.highlights * 1.6 * L * L * (1 - L);
    R = toneCh(clamp01(R + lift)); G = toneCh(clamp01(G + lift)); B = toneCh(clamp01(B + lift));

    if (a.hue !== 0) {
      const y = 0.299 * R + 0.587 * G + 0.114 * B;
      const iq = 0.596 * R - 0.274 * G - 0.322 * B;
      const q = 0.211 * R - 0.523 * G + 0.312 * B;
      const i2 = iq * ca - q * sa, q2 = iq * sa + q * ca;
      R = y + 0.956 * i2 + 0.621 * q2; G = y - 0.272 * i2 - 0.647 * q2; B = y - 1.106 * i2 + 1.703 * q2;
    }
    L = luma(R, G, B);
    const sat = 1 + a.saturation;
    R = L + (R - L) * sat; G = L + (G - L) * sat; B = L + (B - L) * sat;
    if (a.vibrance !== 0) {
      const s = Math.max(R, G, B) - Math.min(R, G, B);
      const k = 1 + a.vibrance * (1 - s) * 1.2;
      R = L + (R - L) * k; G = L + (G - L) * k; B = L + (B - L) * k;
    }
    R = clamp01(R); G = clamp01(G); B = clamp01(B);
    if (a.fade > 0) {
      R += (0.2 + R * 0.74 - R) * a.fade; G += (0.2 + G * 0.74 - G) * a.fade; B += (0.2 + B * 0.74 - B) * a.fade;
    }
    // (LUT is GPU-only.) Toning:
    if (toneMode === 1) {
      const t = clamp01(Math.pow(luma(R, G, B), Math.pow(2, -tone.balance)));
      R += (tS[0] + (tH[0] - tS[0]) * t - R) * tone.amount;
      G += (tS[1] + (tH[1] - tS[1]) * t - G) * tone.amount;
      B += (tS[2] + (tH[2] - tS[2]) * t - B) * tone.amount;
    } else if (toneMode === 2) {
      const Lt = luma(R, G, B), pivot = 0.5 + 0.35 * tone.balance;
      const ws = clamp01(1 - Lt / pivot), wh = clamp01((Lt - pivot) / (1 - pivot));
      const k = tone.amount * 1.5;
      R = clamp01(R + ((tS[0] - lS) * ws + (tH[0] - lH) * wh) * k);
      G = clamp01(G + ((tS[1] - lS) * ws + (tH[1] - lH) * wh) * k);
      B = clamp01(B + ((tS[2] - lS) * ws + (tH[2] - lH) * wh) * k);
    }
    if (post) { R = Math.floor(R * post + 0.5) / post; G = Math.floor(G * post + 0.5) / post; B = Math.floor(B * post + 0.5) / post; }
    if (vAmt !== 0) {
      let x = (u - 0.5) * 2, y = (v - 0.5) * 2;
      if (aspect > 1) x *= 1 + (aspect - 1) * vig.roundness; else y *= 1 + (1 / aspect - 1) * vig.roundness;
      const vv = smooth(vMid - vW / 2, vMid + vW / 2, Math.hypot(x, y) / Math.SQRT2);
      if (vAmt > 0) { const k = 1 - vAmt * vv; R *= k; G *= k; B *= k; }
      else { const k = -vAmt * vv; R += (1 - R) * k; G += (1 - G) * k; B += (1 - B) * k; }
    }
    if (gAmt > 0) {
      const gx = grid ? Math.floor(u * grid[0]) : Math.floor(px * gScale), gy = grid ? Math.floor(v * grid[1]) : Math.floor(py * gScale);
      const n = (hash2(gx, gy, seed) - 0.5) * gAmt * 0.5 * (1 - Math.pow(Math.abs(2 * luma(R, G, B) - 1), 2) * 0.7);
      R = clamp01(R + n); G = clamp01(G + n); B = clamp01(B + n);
    }
    if (scan > 0) {
      const m = 0.5 + 0.5 * Math.cos(2 * Math.PI * v * r.crt.lineCount);
      const g = m * m + (0.375 - m * m) * scanAA;
      const k = (1 - scan * g * 0.9) * (1 + scan * 0.2);
      R = clamp01(R * k); G = clamp01(G * k); B = clamp01(B * k);
    }
    if (pal) {
      if (dith) {
        const cx = grid ? Math.floor(u * grid[0]) : px, cy = grid ? Math.floor(v * grid[1]) : py;
        const t = (bayer(dith as 4 | 8, cx, cy) - 0.5) * dAmt;
        R = clamp01(R + t); G = clamp01(G + t); B = clamp01(B + t);
      }
      let best = pal[0], bd = Infinity;
      for (const p of pal) {
        const dr = R - p[0], dg = G - p[1], db = B - p[2], rm = (R + p[0]) / 2;
        const dd = (2 + rm) * dr * dr + 4 * dg * dg + (3 - rm) * db * db;
        if (dd < bd) { bd = dd; best = p; }
      }
      [R, G, B] = best;
    }
    d[i] = R * 255 + 0.5; d[i + 1] = G * 255 + 0.5; d[i + 2] = B * 255 + 0.5;
  }
}
