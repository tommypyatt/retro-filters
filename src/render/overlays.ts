import { formatStampText, type DateStampEffect, type Recipe } from '../recipe';

// 2D overlays drawn after the per-pixel pass: frames and the date stamp. All
// sizes are fractions of the image so they scale with the output.

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Rect { x: number; y: number; w: number; h: number }

export interface Layout {
  /** Final canvas size including any frame. */
  width: number;
  height: number;
  /** Where the image sits inside the canvas. */
  image: Rect;
  /** Part of the image left visible (inside letterbox bars). */
  visible: Rect;
}

/** Cinemascope ratio used for the letterbox frame. */
const LETTERBOX_RATIO = 2.39;

// Frame borders as fractions of the image's short edge: [side, top, bottom].
const FRAME_BORDERS = {
  polaroid: [0.065, 0.065, 0.28],
  instax: [0.085, 0.13, 0.34],
} as const;

export function computeLayout(recipe: Recipe, w: number, h: number): Layout {
  const f = recipe.frame;
  const full: Rect = { x: 0, y: 0, w, h };
  if (!f.enabled) return { width: w, height: h, image: full, visible: full };
  if (f.style === 'letterbox') {
    const bar = Math.max(0, Math.round((h - w / LETTERBOX_RATIO) / 2));
    return { width: w, height: h, image: full, visible: { x: 0, y: bar, w, h: h - 2 * bar } };
  }
  const s = Math.min(w, h);
  const [side, top, bottom] = FRAME_BORDERS[f.style].map((v) => Math.round(v * s));
  const image = { x: side, y: top, w, h };
  return { width: w + 2 * side, height: h + top + bottom, image, visible: image };
}

/** Paint the frame background (before the image is drawn). */
export function drawFrameBackground(ctx: Ctx2D, recipe: Recipe, layout: Layout): void {
  const f = recipe.frame;
  if (!f.enabled || f.style === 'letterbox') return;
  ctx.save();
  ctx.fillStyle = f.colour;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.restore();
}

/** Paint frame details that sit on top of the image. */
export function drawFrameForeground(ctx: Ctx2D, recipe: Recipe, layout: Layout): void {
  const f = recipe.frame;
  if (!f.enabled) return;
  const { image: r, visible: v } = layout;
  ctx.save();
  if (f.style === 'letterbox') {
    // Letterbox bars are always black.
    ctx.fillStyle = '#000';
    ctx.fillRect(r.x, r.y, r.w, v.y - r.y);
    ctx.fillRect(r.x, v.y + v.h, r.w, r.y + r.h - (v.y + v.h));
  } else {
    // A faint inner edge where the print meets the border.
    const lw = Math.max(1, Math.min(r.w, r.h) * 0.002);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = lw;
    ctx.strokeRect(r.x + lw / 2, r.y + lw / 2, r.w - lw, r.h - lw);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ date stamp

// Seven-segment glyphs: segments a b c d e f g (top, upper-right, lower-right,
// bottom, lower-left, upper-left, middle).
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
  A: 'abcefg', b: 'cdefg', C: 'adef', c: 'deg', d: 'bcdeg', E: 'adefg', F: 'aefg', G: 'acdef', H: 'bcefg', h: 'cefg',
  I: 'ef', i: 'e', J: 'bcde', L: 'def', n: 'ceg', N: 'abcef', o: 'cdeg', O: 'abcdef', P: 'abefg', q: 'abcfg', r: 'eg',
  S: 'afgcd', t: 'defg', U: 'bcdef', u: 'cde', y: 'bcdfg', Y: 'bcdfg', Z: 'abdeg', '-': 'g', _: 'd', '=': 'dg',
};

function segGlyph(ch: string): string | undefined {
  return SEGMENTS[ch] ?? SEGMENTS[ch.toUpperCase()] ?? SEGMENTS[ch.toLowerCase()];
}

/** Build a Path2D for text in a seven-segment style, origin at the top-left. */
function segmentPath(text: string, H: number): { path: Path2D; width: number } {
  const path = new Path2D();
  const W = 0.56 * H, T = 0.13 * H, gap = 0.025 * H, adv = W + 0.24 * H;
  const hseg = (cx: number, cy: number, L: number) => {
    path.moveTo(cx - L / 2, cy);
    path.lineTo(cx - L / 2 + T / 2, cy - T / 2);
    path.lineTo(cx + L / 2 - T / 2, cy - T / 2);
    path.lineTo(cx + L / 2, cy);
    path.lineTo(cx + L / 2 - T / 2, cy + T / 2);
    path.lineTo(cx - L / 2 + T / 2, cy + T / 2);
    path.closePath();
  };
  const vseg = (cx: number, cy: number, L: number) => {
    path.moveTo(cx, cy - L / 2);
    path.lineTo(cx + T / 2, cy - L / 2 + T / 2);
    path.lineTo(cx + T / 2, cy + L / 2 - T / 2);
    path.lineTo(cx, cy + L / 2);
    path.lineTo(cx - T / 2, cy + L / 2 - T / 2);
    path.lineTo(cx - T / 2, cy - L / 2 + T / 2);
    path.closePath();
  };
  const hL = W - T - 2 * gap;
  const vL = H / 2 - T / 2 - 2 * gap;
  const dot = (cx: number, cy: number) => path.rect(cx - T / 2, cy - T / 2, T, T);
  let x = 0;
  for (const ch of text) {
    if (ch === ' ') { x += W * 0.7; continue; }
    if (ch === "'" || ch === '`' || ch === '’') { vseg(x + T / 2, H * 0.18, H * 0.3); x += T + 0.22 * H; continue; }
    if (ch === '.' || ch === ',') { dot(x + T / 2, H - T / 2); x += T + 0.22 * H; continue; }
    if (ch === ':') { dot(x + T / 2, H * 0.3); dot(x + T / 2, H * 0.75); x += T + 0.22 * H; continue; }
    if (ch === '/') {
      path.moveTo(x + W * 0.75, T / 2); path.lineTo(x + W * 0.75 + T * 0.8, T / 2);
      path.lineTo(x + T * 0.8, H - T / 2); path.lineTo(x, H - T / 2); path.closePath();
      x += adv; continue;
    }
    const segs = segGlyph(ch);
    if (segs) {
      for (const s of segs) {
        switch (s) {
          case 'a': hseg(x + W / 2, T / 2, hL); break;
          case 'g': hseg(x + W / 2, H / 2, hL); break;
          case 'd': hseg(x + W / 2, H - T / 2, hL); break;
          case 'f': vseg(x + T / 2, H / 4 + T / 4, vL); break;
          case 'b': vseg(x + W - T / 2, H / 4 + T / 4, vL); break;
          case 'e': vseg(x + T / 2, (3 * H) / 4 - T / 4, vL); break;
          case 'c': vseg(x + W - T / 2, (3 * H) / 4 - T / 4, vL); break;
        }
      }
    }
    x += adv; // unknown characters leave a blank cell
  }
  return { path, width: Math.max(0, x - 0.24 * H) };
}

const FONT_STACKS: Record<Exclude<DateStampEffect['font'], 'segment'>, string> = {
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif',
  serif: 'Georgia, "Times New Roman", "DejaVu Serif", serif',
};

function lighten(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * t);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** Draw the date stamp inside `area` (the visible image rect). */
export function drawDateStamp(ctx: Ctx2D, stamp: DateStampEffect, area: Rect, date: Date): void {
  if (!stamp.enabled) return;
  const text = formatStampText(stamp.text, date);
  if (!text.trim()) return;
  const short = Math.min(area.w, area.h);
  const H = Math.max(4, stamp.size * short);
  const margin = 0.05 * short;
  const skew = -0.1; // slight italic, like camera data backs

  let width: number;
  let draw: () => void;
  if (stamp.font === 'segment') {
    const seg = segmentPath(text, H);
    width = seg.width + Math.abs(skew) * H;
    draw = () => ctx.fill(seg.path);
  } else {
    ctx.font = `600 ${H * 1.25}px ${FONT_STACKS[stamp.font]}`;
    ctx.textBaseline = 'top';
    width = ctx.measureText(text).width;
    draw = () => ctx.fillText(text, 0, -H * 0.1);
  }

  const right = stamp.position.endsWith('right');
  const bottom = stamp.position.startsWith('bottom');
  const x = right ? area.x + area.w - margin - width : area.x + margin;
  const y = bottom ? area.y + area.h - margin - H : area.y + margin;

  ctx.save();
  ctx.translate(x - skew * H, y);
  ctx.transform(1, 0, skew, 1, 0, 0);
  // Glow pass (light bleeding into the film), then a hotter core.
  if (stamp.glow > 0) {
    ctx.shadowColor = stamp.colour;
    ctx.shadowBlur = stamp.glow * H * 0.6;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = stamp.colour;
    draw();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = lighten(stamp.colour, 0.2 * stamp.glow);
  draw();
  ctx.restore();
}
