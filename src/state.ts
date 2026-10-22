import { cloneRecipe, defaultRecipe, type Recipe } from './recipe';
import type { LoadedImage } from './images';

export type ChangeKind = 'images' | 'selection' | 'recipe' | 'scope';
type Listener = (kind: ChangeKind) => void;

/**
 * Application state. There is one global recipe that applies to every image,
 * plus optional per-image overrides (a full recipe copy). The editing scope
 * decides which of the two the controls write to.
 */
export class Store {
  images: LoadedImage[] = [];
  selectedId: string | null = null;
  /** Images ticked for "apply to selected". */
  picked = new Set<string>();
  global: Recipe = defaultRecipe();
  overrides = new Map<string, Recipe>();
  /** 'image' = controls edit the selected image's override. */
  scope: 'global' | 'image' = 'global';
  private listeners: Listener[] = [];

  on(fn: Listener): void {
    this.listeners.push(fn);
  }

  emit(kind: ChangeKind): void {
    for (const l of this.listeners) l(kind);
  }

  get selected(): LoadedImage | null {
    return this.images.find((i) => i.id === this.selectedId) ?? null;
  }

  effective(id: string): Recipe {
    return this.overrides.get(id) ?? this.global;
  }

  hasOverride(id: string): boolean {
    return this.overrides.has(id);
  }

  /** The recipe the controls currently read and write. */
  editing(): Recipe {
    const sel = this.selectedId;
    if (this.scope === 'image' && sel) {
      let o = this.overrides.get(sel);
      if (!o) {
        o = cloneRecipe(this.global);
        this.overrides.set(sel, o);
      }
      return o;
    }
    return this.global;
  }

  /** Recipe shown in the controls without creating an override as a side effect. */
  viewing(): Recipe {
    const sel = this.selectedId;
    if (this.scope === 'image' && sel) return this.overrides.get(sel) ?? this.global;
    return this.global;
  }

  select(id: string | null): void {
    this.selectedId = id;
    // Follow the image: if it has its own settings, edit those.
    this.scope = id && this.overrides.has(id) ? 'image' : 'global';
    this.emit('selection');
  }

  setScope(scope: 'global' | 'image'): void {
    this.scope = scope;
    this.emit('scope');
  }

  addImage(img: LoadedImage): void {
    this.images.push(img);
    if (!this.selectedId) this.select(img.id);
    this.emit('images');
  }

  removeImage(id: string): LoadedImage | undefined {
    const idx = this.images.findIndex((i) => i.id === id);
    if (idx < 0) return undefined;
    const [img] = this.images.splice(idx, 1);
    this.overrides.delete(id);
    this.picked.delete(id);
    if (this.selectedId === id) {
      const next = this.images[Math.min(idx, this.images.length - 1)];
      this.select(next?.id ?? null);
    }
    this.emit('images');
    return img;
  }

  clearImages(): LoadedImage[] {
    const all = this.images;
    this.images = [];
    this.overrides.clear();
    this.picked.clear();
    this.select(null);
    this.emit('images');
    return all;
  }

  /** Replace the recipe being edited (e.g. when a preset is applied). */
  replaceEditing(r: Recipe): void {
    const sel = this.selectedId;
    if (this.scope === 'image' && sel) this.overrides.set(sel, cloneRecipe(r));
    else this.global = cloneRecipe(r);
    this.emit('recipe');
  }

  resetToGlobal(id: string): void {
    this.overrides.delete(id);
    if (id === this.selectedId) this.scope = 'global';
    this.emit('recipe');
    this.emit('scope');
  }

  /** Make the currently viewed settings the global recipe and drop all overrides. */
  applyToAll(): void {
    this.global = cloneRecipe(this.viewing());
    this.overrides.clear();
    this.scope = 'global';
    this.emit('recipe');
    this.emit('scope');
  }

  /** Copy the currently viewed settings to each picked image as an override. */
  applyToPicked(): number {
    const r = this.viewing();
    let n = 0;
    for (const id of this.picked) {
      if (!this.images.some((i) => i.id === id)) continue;
      this.overrides.set(id, cloneRecipe(r));
      n++;
    }
    if (this.selectedId && this.picked.has(this.selectedId)) this.scope = 'image';
    this.emit('recipe');
    this.emit('scope');
    return n;
  }
}
