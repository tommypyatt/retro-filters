import type { PaletteEffect, Recipe } from '../recipe';

export const PALETTES: Record<Exclude<PaletteEffect['palette'], 'custom'>, { label: string; colours: string[] }> = {
  gameboy: { label: 'Game Boy (DMG)', colours: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
  cga: { label: 'CGA (palette 1, high)', colours: ['#000000', '#55ffff', '#ff55ff', '#ffffff'] },
  ega: {
    label: 'EGA (16 colours)',
    colours: [
      '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
      '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
    ],
  },
  nes: {
    label: 'NES (2C02)',
    colours: [
      '#7c7c7c', '#0000fc', '#0000bc', '#4428bc', '#940084', '#a80020', '#a81000', '#881400', '#503000', '#007800', '#006800', '#005800', '#004058', '#000000',
      '#bcbcbc', '#0078f8', '#0058f8', '#6844fc', '#d800cc', '#e40058', '#f83800', '#e45c10', '#ac7c00', '#00b800', '#00a800', '#00a844', '#008888',
      '#f8f8f8', '#3cbcfc', '#6888fc', '#9878f8', '#f878f8', '#f85898', '#f87858', '#fca044', '#f8b800', '#b8f818', '#58d854', '#58f898', '#00e8d8', '#787878',
      '#fcfcfc', '#a4e4fc', '#b8b8f8', '#d8b8f8', '#f8b8f8', '#f8a4c0', '#f0d0b0', '#fce0a8', '#f8d878', '#d8f878', '#b8f8b8', '#b8f8d8', '#00fcfc', '#f8d8f8',
    ],
  },
};

export const MAX_PALETTE = 64;

export function paletteHex(p: PaletteEffect): string[] {
  const cols = p.palette === 'custom' ? p.custom : PALETTES[p.palette].colours;
  return cols.slice(0, MAX_PALETTE);
}

/** Palette as 0..1 sRGB triples. */
export function paletteRgb(p: PaletteEffect): [number, number, number][] {
  return paletteHex(p).map((hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  });
}

/**
 * Ordered-dither spread: the mean distance from each palette colour to its
 * nearest neighbour, so sparse palettes (Game Boy) get a wide threshold and
 * dense ones (NES) a narrow one.
 */
export function ditherSpread(cols: [number, number, number][]): number {
  if (cols.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < cols.length; i++) {
    let best = Infinity;
    for (let j = 0; j < cols.length; j++) {
      if (i === j) continue;
      const d = Math.hypot(cols[i][0] - cols[j][0], cols[i][1] - cols[j][1], cols[i][2] - cols[j][2]);
      if (d > 1e-6) best = Math.min(best, d);
    }
    if (Number.isFinite(best)) sum += best;
  }
  return sum / cols.length;
}

/** Cells across the long edge used by palettes when Pixelate is off. Gives
 * dithering a fixed, resolution-independent scale (EGA-like 640 columns). */
export const PALETTE_GRID = 640;

/**
 * The block grid (columns, rows) for pixelate and palette effects, or null.
 * Derived from the image's aspect ratio only, so preview and export use the
 * same grid and dither patterns line up exactly.
 */
export function pixelGrid(r: Recipe, w: number, h: number): [number, number] | null {
  const blocks = r.pixelate.enabled ? r.pixelate.blocks : r.palette.enabled ? PALETTE_GRID : 0;
  if (!blocks) return null;
  const long = Math.max(w, h);
  return [Math.max(1, Math.round((blocks * w) / long)), Math.max(1, Math.round((blocks * h) / long))];
}

export function usesErrorDiffusion(r: Recipe): boolean {
  return r.palette.enabled && (r.palette.dither === 'floyd-steinberg' || r.palette.dither === 'atkinson');
}
