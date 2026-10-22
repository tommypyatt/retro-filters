import type { Recipe, RenderContext } from '../recipe';
import type { AnyCanvas, RenderOptions } from './glRenderer';
import { computeLayout, drawDateStamp, drawFrameBackground, drawFrameForeground, type Layout } from './overlays';
import { errorDiffuse, type DiffusionKind } from './dither';
import { paletteRgb, pixelGrid, usesErrorDiffusion } from './palettes';

export type { Layout } from './overlays';
export { computeLayout } from './overlays';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type SourceImage = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

/**
 * A backend renders the per-pixel part of a recipe (adjustments and shader
 * effects) for a source image into its own canvas. GLRenderer is the main
 * implementation; CpuRenderer is the Canvas 2D fallback.
 */
export interface Backend {
  readonly kind: 'webgl2' | 'canvas2d';
  readonly canvas: AnyCanvas;
  readonly maxTextureSize: number;
  readonly maxOutputSize: number;
  hasSource(key: string): boolean;
  setSource(key: string, image: SourceImage): void;
  dropSource(key: string): void;
  render(key: string, recipe: Recipe, ctx: RenderContext, w: number, h: number, opts?: RenderOptions): void;
  dispose(): void;
}

/**
 * Render (image, recipe) to a 2D context. Used identically for preview,
 * thumbnails and export:
 *   1. backend pass (adjustments + shader effects) at imageW×imageH
 *   2. optional CPU error-diffusion palette pass
 *   3. frame, letterbox bars and date stamp
 * The source must already be set on the backend under `key`.
 */
export function renderRecipe(
  backend: Backend,
  key: string,
  recipe: Recipe,
  ctx: RenderContext,
  imageW: number,
  imageH: number,
  out: Ctx2D,
): Layout {
  const layout = computeLayout(recipe, imageW, imageH);
  const c = out.canvas;
  if (c.width !== layout.width || c.height !== layout.height) {
    c.width = layout.width;
    c.height = layout.height;
  } else {
    out.clearRect(0, 0, c.width, c.height);
  }
  const diffuse = usesErrorDiffusion(recipe);
  backend.render(key, recipe, ctx, imageW, imageH, { skipPalette: diffuse });
  drawFrameBackground(out, recipe, layout);
  const r = layout.image;
  if (diffuse) {
    // Read back through a scratch canvas so `out` can stay GPU-accelerated.
    const scratch = new OffscreenCanvas(r.w, r.h);
    const sctx = scratch.getContext('2d', { willReadFrequently: true })!;
    sctx.drawImage(backend.canvas, 0, 0);
    const data = sctx.getImageData(0, 0, r.w, r.h);
    scratch.width = scratch.height = 0;
    const grid = pixelGrid(recipe, imageW, imageH)!;
    errorDiffuse(data, grid, paletteRgb(recipe.palette), recipe.palette.dither as DiffusionKind, recipe.palette.ditherStrength);
    out.putImageData(data, r.x, r.y);
  } else {
    out.drawImage(backend.canvas, r.x, r.y);
  }

  drawFrameForeground(out, recipe, layout);
  drawDateStamp(out, recipe.dateStamp, layout.visible, ctx.date);
  return layout;
}
