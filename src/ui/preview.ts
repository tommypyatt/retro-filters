import type { Store } from '../state';
import type { Backend } from '../render/pipeline';
import { renderRecipe } from '../render/pipeline';
import { h } from './dom';

export type CompareMode = 'off' | 'split';

/**
 * The large preview. Renders the selected image's preview bitmap (≤2048px)
 * through the same pipeline as export, sized to the viewport's device pixels,
 * so slider changes re-render instantly.
 */
export class Preview {
  readonly canvas = h('canvas', { class: 'preview', role: 'img', 'aria-label': 'Preview' });
  private ctx = this.canvas.getContext('2d')!;
  private handle = h('div', { class: 'split-handle', role: 'slider', tabindex: 0, 'aria-label': 'Before/after split position', 'aria-valuemin': 0, 'aria-valuemax': 100 });
  private labels = [h('div', { class: 'split-label' }, 'Before'), h('div', { class: 'split-label' }, 'After')];
  private badge = h('div', { class: 'compare-badge' }, 'Original');
  private pending = false;
  /** Hold-to-compare: show the unprocessed image. */
  holding = false;
  mode: CompareMode = 'off';
  /** Split position, 0..1 of the image width. */
  split = 0.5;
  /** Called after each render with the preview's output size. */
  onRendered?: (info: { width: number; height: number; ms: number }) => void;
  onError?: (err: unknown) => void;

  constructor(private viewport: HTMLElement, private store: Store, private backend: Backend) {
    this.ctx.imageSmoothingQuality = 'high';
    viewport.append(this.canvas, this.handle, ...this.labels, this.badge);
    new ResizeObserver(() => this.request()).observe(viewport);
    this.setupSplitDrag();
    this.updateOverlay();
  }

  request(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      try {
        this.draw();
      } catch (err) {
        this.onError?.(err);
      }
    });
  }

  setMode(mode: CompareMode): void {
    this.mode = mode;
    this.request();
  }

  setHolding(v: boolean): void {
    if (this.holding === v) return;
    this.holding = v;
    this.request();
  }

  private draw(): void {
    const img = this.store.selected;
    this.canvas.hidden = !img;
    if (!img) { this.updateOverlay(); return; }
    const t0 = performance.now();
    const key = `${img.id}:preview`;
    if (!this.backend.hasSource(key)) this.backend.setSource(key, img.preview);

    // Output size: the viewport in device pixels, never more than the preview
    // bitmap (which is itself ≤2048px), at the image's aspect ratio.
    const dpr = window.devicePixelRatio || 1;
    const vw = Math.max(1, this.viewport.clientWidth - 16);
    const vh = Math.max(1, this.viewport.clientHeight - 16);
    const fitCss = Math.min(vw / img.width, vh / img.height);
    const scale = Math.min(fitCss * dpr, img.preview.width / img.width, this.backend.maxOutputSize / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const hgt = Math.max(1, Math.round(img.height * scale));

    const recipe = this.store.effective(img.id);
    const layout = renderRecipe(this.backend, key, recipe, { seed: img.seed, date: img.date }, w, hgt, this.ctx);

    // Display size in CSS px: fit the whole output (including frame) to the viewport.
    const cssScale = Math.min(vw / layout.width, vh / layout.height);
    this.canvas.style.width = `${Math.round(layout.width * cssScale)}px`;
    this.canvas.style.height = `${Math.round(layout.height * cssScale)}px`;

    const r = layout.image;
    if (this.holding) {
      this.ctx.drawImage(img.preview, r.x, r.y, r.w, r.h);
    } else if (this.mode === 'split') {
      const sx = Math.round(r.w * this.split);
      if (sx > 0) {
        this.ctx.drawImage(img.preview, 0, 0, (sx / r.w) * img.preview.width, img.preview.height, r.x, r.y, sx, r.h);
      }
    }
    this.updateOverlay();
    this.onRendered?.({ width: w, height: hgt, ms: performance.now() - t0 });
  }

  /** Geometry of the image area within the viewport, in CSS px. */
  private imageBox(): { left: number; top: number; width: number; height: number } {
    const cr = this.canvas.getBoundingClientRect();
    const vr = this.viewport.getBoundingClientRect();
    return { left: cr.left - vr.left, top: cr.top - vr.top, width: cr.width, height: cr.height };
  }

  private updateOverlay(): void {
    const show = this.mode === 'split' && !this.holding && !!this.store.selected;
    this.handle.hidden = !show;
    this.labels.forEach((l) => (l.hidden = !show));
    this.badge.hidden = !(this.holding && this.store.selected);
    if (!show) return;
    const b = this.imageBox();
    const x = b.left + b.width * this.split;
    this.handle.style.left = `${x}px`;
    this.handle.style.top = `${b.top}px`;
    this.handle.style.bottom = 'auto';
    this.handle.style.height = `${b.height}px`;
    this.handle.setAttribute('aria-valuenow', String(Math.round(this.split * 100)));
    this.labels[0].style.left = `${b.left + 8}px`;
    this.labels[1].style.left = `${b.left + b.width - 48}px`;
    this.labels.forEach((l) => (l.style.top = `${b.top + 8}px`));
  }

  private setupSplitDrag(): void {
    const move = (clientX: number) => {
      const cr = this.canvas.getBoundingClientRect();
      this.split = Math.min(1, Math.max(0, (clientX - cr.left) / cr.width));
      this.request();
    };
    let dragging = false;
    const start = (e: PointerEvent) => {
      if (this.mode !== 'split' || e.button !== 0) return;
      dragging = true;
      this.viewport.setPointerCapture(e.pointerId);
      move(e.clientX);
      e.preventDefault();
    };
    this.handle.addEventListener('pointerdown', start);
    this.canvas.addEventListener('pointerdown', start);
    this.viewport.addEventListener('pointermove', (e) => { if (dragging) move(e.clientX); });
    this.viewport.addEventListener('pointerup', () => { dragging = false; });
    this.viewport.addEventListener('pointercancel', () => { dragging = false; });
    this.handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      if (e.key === 'ArrowLeft') this.split = Math.max(0, this.split - step);
      else if (e.key === 'ArrowRight') this.split = Math.min(1, this.split + step);
      else return;
      e.preventDefault();
      e.stopPropagation();
      this.request();
    });
  }
}
