import type { Recipe, RenderContext } from '../recipe';
import type { AnyCanvas, RenderOptions } from './glRenderer';
import type { Backend, SourceImage } from './pipeline';

// Canvas 2D fallback used when WebGL2 is unavailable. It ports the shader's
// per-pixel colour maths to JS (same formulas, same order), so adjustments
// match the GPU path. Neighbourhood and geometric effects (sharpening,
// halation, chromatic aberration, CRT curvature, VHS) are GPU-only and are
// skipped here; the UI shows a warning listing them.

export const CPU_UNSUPPORTED = ['sharpness', 'halation/bloom', 'chromatic aberration', 'CRT curvature', 'VHS', '3D LUT'];

const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const LIN_LUT = new Float32Array(256).map((_, i) => srgbToLin(i / 255));

export class CpuRenderer implements Backend {
  readonly kind = 'canvas2d' as const;
  readonly maxTextureSize = 16384;
  readonly maxOutputSize = 16384;
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

  render(key: string, recipe: Recipe, _ctx: RenderContext, w: number, h: number, _opts: RenderOptions = {}): void {
    const src = this.sources.get(key);
    if (!src) throw new Error(`No source for ${key}`);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    processPixels(img.data, recipe);
    ctx.putImageData(img, 0, 0);
  }
}

function processPixels(d: Uint8ClampedArray, r: Recipe): void {
  const a = r.adjust;
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
    d[i] = R * 255 + 0.5; d[i + 1] = G * 255 + 0.5; d[i + 2] = B * 255 + 0.5;
  }
}
