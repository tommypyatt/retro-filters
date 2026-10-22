import type { Store } from '../state';
import { h } from './dom';

/** Panel header: which recipe the controls edit, plus batch actions. */
export function batchBar(store: Store): { el: HTMLElement; sync(): void } {
  const allBtn = h('button', { type: 'button', 'aria-pressed': 'true' }, 'All images');
  const oneBtn = h('button', { type: 'button', 'aria-pressed': 'false' }, 'This image only');
  allBtn.addEventListener('click', () => store.setScope('global'));
  oneBtn.addEventListener('click', () => store.setScope('image'));
  const status = h('p', { class: 'hint' });
  const flash = h('p', { class: 'hint', 'aria-live': 'polite' });
  const reset = h('button', { class: 'btn small', title: 'Discard this image’s own settings' }, 'Reset to global');
  reset.addEventListener('click', () => { if (store.selectedId) store.resetToGlobal(store.selectedId); });
  const applyAll = h('button', { class: 'btn small', title: 'Use the settings shown for every image and clear all per-image overrides' }, 'Apply to all');
  applyAll.addEventListener('click', () => {
    const n = store.overrides.size;
    if (n && !confirm(`This replaces the global settings and clears per-image settings on ${n} image${n > 1 ? 's' : ''}. Continue?`)) return;
    store.applyToAll();
  });
  const applyPicked = h('button', { class: 'btn small', title: 'Copy the settings shown to the images ticked in the thumbnail list' }, 'Apply to selected');
  applyPicked.addEventListener('click', () => {
    const n = store.applyToPicked();
    flash.textContent = `Applied to ${n} selected image${n === 1 ? '' : 's'}.`;
  });

  const el = h('div', { class: 'batch' },
    h('div', { class: 'scope', role: 'group', 'aria-label': 'Settings apply to' }, allBtn, oneBtn),
    status,
    h('div', { class: 'row' }, reset, applyAll, applyPicked),
    flash,
  );

  return {
    el,
    sync() {
      const sel = store.selected;
      const img = store.scope === 'image' && !!sel;
      allBtn.setAttribute('aria-pressed', String(!img));
      oneBtn.setAttribute('aria-pressed', String(img));
      oneBtn.disabled = !sel;
      const has = !!sel && store.hasOverride(sel.id);
      reset.hidden = !has;
      const overrides = store.overrides.size;
      if (img) status.textContent = has ? `Editing “${sel.name}” only (it has its own settings).` : `Edits will apply to “${sel.name}” only.`;
      else status.textContent = `Editing global settings for all images${overrides ? ` (${overrides} image${overrides > 1 ? 's have' : ' has'} own settings)` : ''}.`;
      applyAll.disabled = !store.images.length;
      const picked = [...store.picked].filter((id) => store.images.some((i) => i.id === id)).length;
      applyPicked.disabled = picked === 0;
      applyPicked.textContent = picked ? `Apply to selected (${picked})` : 'Apply to selected';
    },
  };
}
