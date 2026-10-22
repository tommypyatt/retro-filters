import type { Store } from '../state';
import type { Backend } from '../render/pipeline';
import { renderRecipe } from '../render/pipeline';
import type { LoadedImage } from '../images';
import { h } from './dom';

interface ThumbEl {
  li: HTMLLIElement;
  canvas: HTMLCanvasElement;
  badge: HTMLElement;
  pick: HTMLInputElement;
  btn: HTMLButtonElement;
  /** JSON of the recipe last rendered, to skip redundant work. */
  rendered: string;
}

/** Thumbnail strip with processed previews, override badges and multi-select. */
export class Thumbs {
  private els = new Map<string, ThumbEl>();
  private timer = 0;
  onRemove?: (img: LoadedImage) => void;

  constructor(private list: HTMLElement, private store: Store, private backend: Backend) {}

  /** Rebuild the list structure (images added/removed). */
  rebuild(): void {
    const keep = new Set(this.store.images.map((i) => i.id));
    for (const [id] of this.els) if (!keep.has(id)) this.els.delete(id);
    const items = this.store.images.map((img) => (this.els.get(img.id) ?? this.create(img)).li);
    this.list.replaceChildren(...items);
    this.update();
  }

  private create(img: LoadedImage): ThumbEl {
    const canvas = h('canvas', { width: img.thumb.width, height: img.thumb.height });
    canvas.getContext('2d')!.drawImage(img.thumb, 0, 0);
    const btn = h('button', { class: 'thumb-btn', 'aria-label': `Select ${img.name}`, title: img.name },
      canvas, h('span', { class: 'name' }, img.name));
    btn.addEventListener('click', () => this.store.select(img.id));
    const badge = h('span', { class: 'badge', title: 'This image has its own settings' }, 'EDITED');
    const pick = h('input', { type: 'checkbox', class: 'pick', 'aria-label': `Include ${img.name} in “apply to selected”`, title: 'Select for “Apply to selected”' });
    pick.addEventListener('change', () => {
      if (pick.checked) this.store.picked.add(img.id);
      else this.store.picked.delete(img.id);
      this.store.emit('selection');
    });
    const remove = h('button', { class: 'remove', 'aria-label': `Remove ${img.name}`, title: 'Remove' }, '×');
    remove.addEventListener('click', (e) => { e.stopPropagation(); this.onRemove?.(img); });
    const li = h('li', { class: 'thumb', 'data-id': img.id }, btn, badge, pick, remove);
    const el: ThumbEl = { li, canvas, badge, pick, btn, rendered: '' };
    this.els.set(img.id, el);
    return el;
  }

  /** Refresh selection/override state and schedule processed re-renders. */
  update(): void {
    for (const img of this.store.images) {
      const el = this.els.get(img.id);
      if (!el) continue;
      const active = img.id === this.store.selectedId;
      el.li.classList.toggle('active', active);
      el.btn.setAttribute('aria-current', active ? 'true' : 'false');
      el.badge.hidden = !this.store.hasOverride(img.id);
      el.pick.checked = this.store.picked.has(img.id);
      el.li.classList.toggle('multi', el.pick.checked);
    }
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.renderQueued(), 200);
  }

  scrollToSelected(): void {
    const id = this.store.selectedId;
    if (id) this.els.get(id)?.li.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private renderQueued(): void {
    const todo = this.store.images.filter((img) => {
      const el = this.els.get(img.id);
      return el && el.rendered !== JSON.stringify(this.store.effective(img.id));
    });
    const step = () => {
      const start = performance.now();
      while (todo.length && performance.now() - start < 12) {
        const img = todo.shift()!;
        const el = this.els.get(img.id);
        if (!el) continue;
        const recipe = this.store.effective(img.id);
        const key = `${img.id}:thumb`;
        try {
          this.backend.setSource(key, img.thumb);
          renderRecipe(this.backend, key, recipe, { seed: img.seed, date: img.date }, img.thumb.width, img.thumb.height, el.canvas.getContext('2d')!);
          el.rendered = JSON.stringify(recipe);
        } catch (err) {
          console.warn('Thumbnail render failed', err);
        } finally {
          // Free immediately so the preview's texture stays cached.
          this.backend.dropSource(key);
        }
      }
      if (todo.length) setTimeout(step, 16);
    };
    step();
  }
}
