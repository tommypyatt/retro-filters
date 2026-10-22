import type { Recipe, RenderContext } from '../recipe';
import type { AnyCanvas, RenderOptions } from './glRenderer';

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

export interface Layout {
  /** Final canvas size including any frame. */
  width: number;
  height: number;
  /** Where the image sits inside the canvas. */
  image: { x: number; y: number; w: number; h: number };
}

export function computeLayout(_recipe: Recipe, w: number, h: number): Layout {
  return { width: w, height: h, image: { x: 0, y: 0, w, h } };
}

/**
 * Render (image, recipe) to a 2D context: backend pass, then CPU passes and
 * overlays. Used identically for preview, thumbnails and export.
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
  backend.render(key, recipe, ctx, imageW, imageH);
  out.drawImage(backend.canvas, layout.image.x, layout.image.y);
  return layout;
}
