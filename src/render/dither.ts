// CPU error-diffusion dithering (Floyd–Steinberg, Atkinson). Error diffusion
// is inherently sequential, so it runs on the CPU after the GPU pass. The
// error is diffused between cells of the same block grid the shader uses
// (pixelate blocks, or the palette grid), so the pattern is identical at
// preview and export resolution; each pixel is then quantised with its cell's
// incoming error, which keeps per-pixel detail such as scanlines or CRT warp.

export type DiffusionKind = 'floyd-steinberg' | 'atkinson';

// [dx, dy, weight]
const KERNELS: Record<DiffusionKind, [number, number, number][]> = {
  'floyd-steinberg': [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
  // Atkinson only propagates 6/8 of the error, giving the high-contrast
  // early-Macintosh look.
  atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
};

/** Nearest palette index using the same "redmean" metric as the shader. */
function makeNearest(pal: number[][]): (r: number, g: number, b: number) => number {
  // Memoise on the 24-bit colour; images reuse few colours after the GPU pass.
  const cache = new Uint8Array(1 << 24).fill(255);
  return (r, g, b) => {
    r = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
    g = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
    b = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
    const key = (r << 16) | (g << 8) | b;
    const hit = cache[key];
    if (hit !== 255) return hit;
    let best = 0, bestD = Infinity;
    for (let k = 0; k < pal.length; k++) {
      const p = pal[k];
      const dr = r - p[0], dg = g - p[1], db = b - p[2];
      const rm = (r + p[0]) / 510;
      const d = (2 + rm) * dr * dr + 4 * dg * dg + (3 - rm) * db * db;
      if (d < bestD) { bestD = d; best = k; }
    }
    cache[key] = best;
    return best;
  };
}

/**
 * Quantise `img` in place to `palette` (0..1 sRGB) with error diffusion on a
 * gw×gh cell grid. `strength` scales the diffused error (0 = nearest colour).
 */
export function errorDiffuse(
  img: ImageData,
  grid: [number, number],
  palette: [number, number, number][],
  kind: DiffusionKind,
  strength: number,
): void {
  const { width: w, height: h, data } = img;
  const [gw, gh] = grid;
  const pal = palette.map((c) => c.map((v) => v * 255));
  const nearest = makeNearest(pal);
  // Cell boundaries match the shader: pixel x is in cell floor((x+0.5)*gw/w).
  const colCell = new Int32Array(w);
  for (let x = 0; x < w; x++) colCell[x] = Math.min(gw - 1, Math.floor(((x + 0.5) * gw) / w));
  const rowCell = (y: number) => Math.min(gh - 1, Math.floor(((y + 0.5) * gh) / h));

  // Representative colour per cell: its centre pixel (the GPU pass has
  // already averaged pixelate blocks).
  const orig = new Float32Array(gw * gh * 3);
  for (let j = 0; j < gh; j++) {
    const py = Math.min(h - 1, Math.floor(((j + 0.5) * h) / gh));
    for (let i = 0; i < gw; i++) {
      const px = Math.min(w - 1, Math.floor(((i + 0.5) * w) / gw));
      const p = (py * w + px) * 4, q = (j * gw + i) * 3;
      orig[q] = data[p]; orig[q + 1] = data[p + 1]; orig[q + 2] = data[p + 2];
    }
  }
  // Accumulated incoming error per cell.
  const err = new Float32Array(gw * gh * 3);
  const kernel = KERNELS[kind];
  for (let j = 0; j < gh; j++) {
    const rev = j & 1; // serpentine scan avoids directional artefacts
    for (let n = 0; n < gw; n++) {
      const i = rev ? gw - 1 - n : n;
      const q = (j * gw + i) * 3;
      const r = orig[q] + err[q], g = orig[q + 1] + err[q + 1], b = orig[q + 2] + err[q + 2];
      const p = pal[nearest(r, g, b)];
      const er = (r - p[0]) * strength, eg = (g - p[1]) * strength, eb = (b - p[2]) * strength;
      for (const [dx0, dy, wgt] of kernel) {
        const x = i + (rev ? -dx0 : dx0), y = j + dy;
        if (x < 0 || x >= gw || y >= gh) continue;
        const t = (y * gw + x) * 3;
        err[t] += er * wgt; err[t + 1] += eg * wgt; err[t + 2] += eb * wgt;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    const rowBase = rowCell(y) * gw;
    let p = y * w * 4;
    for (let x = 0; x < w; x++, p += 4) {
      const q = (rowBase + colCell[x]) * 3;
      const c = pal[nearest(data[p] + err[q], data[p + 1] + err[q + 1], data[p + 2] + err[q + 2])];
      data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2];
    }
  }
}
