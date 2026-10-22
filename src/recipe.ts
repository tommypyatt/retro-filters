// The Recipe is the single, serialisable description of everything applied to
// an image. Renderers take (image, recipe, context) and produce pixels; nothing
// here knows about the DOM or WebGL, so another renderer (CPU, native, server)
// could implement the same contract. The schema is documented in README.md.
//
// Units are chosen to be resolution independent: anything spatial is expressed
// relative to the image (fractions of the long edge, lines per image height,
// blocks across the long edge) so a 1000px preview and a 50MP export look the
// same.

export const RECIPE_VERSION = 1;

export type HexColor = string; // '#rrggbb'

export interface Adjustments {
  /** Exposure in EV stops, applied in linear light. -3..3, 0 = neutral. */
  exposure: number;
  /** Lifts/lowers midtones without clipping, -1..1. */
  brightness: number;
  /** S-curve around mid grey, -1..1. */
  contrast: number;
  /** -1 (greyscale) .. 1 (double). */
  saturation: number;
  /** Saturation boost weighted towards muted colours, -1..1. */
  vibrance: number;
  /** Recover (-) or boost (+) bright tones, -1..1. */
  highlights: number;
  /** Darken (-) or lift (+) dark tones, -1..1. */
  shadows: number;
  /** Cool (-) .. warm (+) white balance shift, applied in linear light, -1..1. */
  temperature: number;
  /** Green (-) .. magenta (+), applied in linear light, -1..1. */
  tint: number;
  /** Hue rotation in degrees, -180..180. */
  hue: number;
  /** Gamma exponent, 0.2..3, 1 = neutral (>1 brightens). */
  gamma: number;
  /** Lifted blacks / faded film look, 0..1. */
  fade: number;
  /** Unsharp-mask amount, 0..1. */
  sharpness: number;
}

export interface GrainEffect { enabled: boolean; amount: number; /** grain cell size in px at a 1000px long edge, 0.5..4 */ size: number; /** 0 mono .. 1 full colour grain */ colour: number }
export interface VignetteEffect { enabled: boolean; /** -1 (white) .. 1 (black) */ amount: number; /** 0..1 midpoint */ size: number; /** 0 matches the image aspect .. 1 circular */ roundness: number; /** 0..1 */ feather: number }
export interface HalationEffect { enabled: boolean; amount: number; /** 0..1 maps to ~0.5%..8% of the long edge */ radius: number; /** 0..1 linear-light brightness threshold */ threshold: number; /** 0 neutral bloom .. 1 red film halation */ warmth: number }
export interface ChromaticAberrationEffect { enabled: boolean; /** 0..1, max ~1% of the long edge at the corners */ amount: number }
export interface CrtEffect { enabled: boolean; /** scanline darkness 0..1 */ scanlines: number; /** scanlines per image height, 60..1200 */ lineCount: number; /** barrel distortion 0..1 */ curvature: number }
export interface VhsEffect { enabled: boolean; /** static & line noise 0..1 */ noise: number; /** horizontal tracking glitch 0..1 */ tracking: number; /** horizontal chroma bleed 0..1 */ bleed: number }
export interface LightLeakEffect { enabled: boolean; amount: number; colour: HexColor; /** where the leak enters, degrees 0..360 (0 = right edge, 90 = bottom) */ angle: number; /** 0..1 */ size: number }
export interface PixelateEffect { enabled: boolean; /** pixel blocks across the long edge, 16..512 */ blocks: number }
export interface PosteriseEffect { enabled: boolean; /** levels per channel, 2..32 */ levels: number }

export type PaletteName = 'gameboy' | 'cga' | 'ega' | 'nes' | 'custom';
export type DitherMode = 'none' | 'bayer4' | 'bayer8' | 'floyd-steinberg' | 'atkinson';
export interface PaletteEffect { enabled: boolean; palette: PaletteName; /** used when palette = 'custom', 2..32 colours */ custom: HexColor[]; dither: DitherMode; /** 0..1, ordered dithering spread */ ditherStrength: number }

export type ToneMode = 'duotone' | 'split';
export interface ToneEffect { enabled: boolean; mode: ToneMode; shadowColour: HexColor; highlightColour: HexColor; amount: number; /** -1..1 shifts the shadow/highlight split point */ balance: number }

export type StampPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type StampFont = 'segment' | 'mono' | 'sans' | 'serif';
export interface DateStampEffect {
  enabled: boolean;
  /** Text with tokens {yy} {yyyy} {mm} {dd} {hh} {min}, taken from the photo's EXIF capture date, else the file's modified date. */
  text: string;
  font: StampFont;
  colour: HexColor;
  position: StampPosition;
  /** Character height as a fraction of the image's short edge, 0.02..0.12 */
  size: number;
  /** 0..1 */
  glow: number;
}

export type FrameStyle = 'polaroid' | 'instax' | 'letterbox';
export interface FrameEffect { enabled: boolean; style: FrameStyle; colour: HexColor }

export interface LutSpec {
  enabled: boolean;
  name: string;
  /** Edge length N of the N×N×N cube. */
  size: number;
  /**
   * RGB triples, red fastest (as in .cube files), encoded as base64 of
   * little-endian Uint16 values (value × 65535, clamped to 0..1).
   */
  data: string;
  intensity: number;
}

export interface Recipe {
  version: typeof RECIPE_VERSION;
  adjust: Adjustments;
  grain: GrainEffect;
  vignette: VignetteEffect;
  halation: HalationEffect;
  chromaticAberration: ChromaticAberrationEffect;
  crt: CrtEffect;
  vhs: VhsEffect;
  lightLeak: LightLeakEffect;
  pixelate: PixelateEffect;
  posterise: PosteriseEffect;
  palette: PaletteEffect;
  tone: ToneEffect;
  dateStamp: DateStampEffect;
  frame: FrameEffect;
  lut: LutSpec | null;
}

/** Per-render context that is not part of the look itself. */
export interface RenderContext {
  /** Seed for grain/noise; fixed per image so preview and export match. */
  seed: number;
  /** Date used by the date-stamp tokens. */
  date: Date;
}

export function defaultRecipe(): Recipe {
  return {
    version: RECIPE_VERSION,
    adjust: {
      exposure: 0, brightness: 0, contrast: 0, saturation: 0, vibrance: 0,
      highlights: 0, shadows: 0, temperature: 0, tint: 0, hue: 0, gamma: 1, fade: 0, sharpness: 0,
    },
    grain: { enabled: false, amount: 0.35, size: 1.2, colour: 0.15 },
    vignette: { enabled: false, amount: 0.4, size: 0.5, roundness: 0.6, feather: 0.6 },
    halation: { enabled: false, amount: 0.4, radius: 0.35, threshold: 0.7, warmth: 0.7 },
    chromaticAberration: { enabled: false, amount: 0.3 },
    crt: { enabled: false, scanlines: 0.5, lineCount: 240, curvature: 0.3 },
    vhs: { enabled: false, noise: 0.3, tracking: 0.3, bleed: 0.4 },
    lightLeak: { enabled: false, amount: 0.5, colour: '#ff6a2a', angle: 20, size: 0.5 },
    pixelate: { enabled: false, blocks: 160 },
    posterise: { enabled: false, levels: 6 },
    palette: { enabled: false, palette: 'gameboy', custom: ['#1b1b1b', '#e05a3a', '#f2d6a2', '#4f8fba'], dither: 'bayer4', ditherStrength: 0.6 },
    tone: { enabled: false, mode: 'split', shadowColour: '#1f5f7a', highlightColour: '#f2b36b', amount: 0.4, balance: 0 },
    dateStamp: { enabled: false, text: "{dd} {mm} '{yy}", font: 'segment', colour: '#ff8a1e', position: 'bottom-right', size: 0.045, glow: 0.5 },
    frame: { enabled: false, style: 'polaroid', colour: '#f4f1ea' },
    lut: null,
  };
}

export function cloneRecipe(r: Recipe): Recipe {
  return structuredClone(r);
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Accept a possibly partial / older / hand-edited recipe and return a complete,
 * clamped one. Unknown keys are dropped; missing keys take defaults. Used when
 * importing presets so a bad file can't break the renderer.
 */
export function normaliseRecipe(input: unknown): Recipe {
  const def = defaultRecipe();
  if (!input || typeof input !== 'object') return def;
  const src = input as Record<string, unknown>;
  const out = def as unknown as Record<string, unknown>;
  for (const key of Object.keys(def) as (keyof Recipe)[]) {
    if (key === 'version') continue;
    if (key === 'lut') { out.lut = normaliseLut(src.lut); continue; }
    out[key] = mergeSection(out[key] as Record<string, unknown>, src[key]);
  }
  return clampRecipe(def);
}

function mergeSection(def: Record<string, unknown>, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return def;
  const v = value as Record<string, unknown>;
  const res: Record<string, unknown> = { ...def };
  for (const [k, d] of Object.entries(def)) {
    const x = v[k];
    if (typeof d === 'number' && typeof x === 'number' && Number.isFinite(x)) res[k] = x;
    else if (typeof d === 'boolean' && typeof x === 'boolean') res[k] = x;
    else if (typeof d === 'string' && typeof x === 'string') res[k] = HEX_RE.test(d) ? (HEX_RE.test(x) ? x : d) : x;
    else if (Array.isArray(d) && Array.isArray(x)) {
      const cols = x.filter((c): c is string => typeof c === 'string' && HEX_RE.test(c)).slice(0, 32);
      if (cols.length >= 2) res[k] = cols;
    }
  }
  return res;
}

function normaliseLut(v: unknown): LutSpec | null {
  if (!v || typeof v !== 'object') return null;
  const l = v as Record<string, unknown>;
  if (typeof l.data !== 'string' || typeof l.size !== 'number') return null;
  const size = Math.round(l.size);
  if (size < 2 || size > 128) return null;
  return {
    enabled: l.enabled !== false,
    name: typeof l.name === 'string' ? l.name : 'LUT',
    size,
    data: l.data,
    intensity: typeof l.intensity === 'number' ? l.intensity : 1,
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function oneOf<T extends string>(v: T, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v) ? v : fallback;
}

function clampRecipe(r: Recipe): Recipe {
  const a = r.adjust;
  a.exposure = clamp(a.exposure, -3, 3);
  for (const k of ['brightness', 'contrast', 'saturation', 'vibrance', 'highlights', 'shadows', 'temperature', 'tint'] as const) a[k] = clamp(a[k], -1, 1);
  a.hue = clamp(a.hue, -180, 180);
  a.gamma = clamp(a.gamma, 0.2, 3);
  a.fade = clamp(a.fade, 0, 1);
  a.sharpness = clamp(a.sharpness, 0, 1);
  r.grain.amount = clamp(r.grain.amount, 0, 1);
  r.grain.size = clamp(r.grain.size, 0.5, 4);
  r.grain.colour = clamp(r.grain.colour, 0, 1);
  r.vignette.amount = clamp(r.vignette.amount, -1, 1);
  r.crt.lineCount = clamp(Math.round(r.crt.lineCount), 60, 1200);
  r.pixelate.blocks = clamp(Math.round(r.pixelate.blocks), 16, 512);
  r.posterise.levels = clamp(Math.round(r.posterise.levels), 2, 32);
  r.palette.palette = oneOf(r.palette.palette, ['gameboy', 'cga', 'ega', 'nes', 'custom'], 'gameboy');
  r.palette.dither = oneOf(r.palette.dither, ['none', 'bayer4', 'bayer8', 'floyd-steinberg', 'atkinson'], 'none');
  r.tone.mode = oneOf(r.tone.mode, ['duotone', 'split'], 'split');
  r.tone.balance = clamp(r.tone.balance, -1, 1);
  r.dateStamp.font = oneOf(r.dateStamp.font, ['segment', 'mono', 'sans', 'serif'], 'segment');
  r.dateStamp.position = oneOf(r.dateStamp.position, ['bottom-right', 'bottom-left', 'top-right', 'top-left'], 'bottom-right');
  r.dateStamp.size = clamp(r.dateStamp.size, 0.02, 0.12);
  r.dateStamp.text = r.dateStamp.text.slice(0, 64);
  r.frame.style = oneOf(r.frame.style, ['polaroid', 'instax', 'letterbox'], 'polaroid');
  r.lightLeak.angle = ((r.lightLeak.angle % 360) + 360) % 360;
  for (const sec of [r.vignette, r.halation, r.chromaticAberration, r.crt, r.vhs, r.lightLeak, r.palette, r.tone, r.dateStamp] as unknown as Record<string, unknown>[]) {
    for (const [k, v] of Object.entries(sec)) {
      if (typeof v === 'number' && !['amount', 'lineCount', 'angle', 'size', 'balance', 'blocks', 'levels'].includes(k)) sec[k] = clamp(v, 0, 1);
    }
  }
  for (const sec of [r.halation, r.chromaticAberration, r.lightLeak, r.tone]) sec.amount = clamp(sec.amount, 0, 1);
  r.vignette.size = clamp(r.vignette.size, 0, 1);
  r.lightLeak.size = clamp(r.lightLeak.size, 0, 1);
  if (r.lut) r.lut.intensity = clamp(r.lut.intensity, 0, 1);
  return r;
}

/** Deep structural equality for recipes (they are plain JSON). */
export function recipesEqual(a: Recipe, b: Recipe): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Expand the date-stamp tokens for a given date. */
export function formatStampText(template: string, d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return template
    .replaceAll('{yyyy}', String(d.getFullYear()))
    .replaceAll('{yy}', p2(d.getFullYear() % 100))
    .replaceAll('{mm}', p2(d.getMonth() + 1))
    .replaceAll('{dd}', p2(d.getDate()))
    .replaceAll('{hh}', p2(d.getHours()))
    .replaceAll('{min}', p2(d.getMinutes()));
}
