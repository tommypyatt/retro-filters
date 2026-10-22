import type { Store } from '../state';
import { cloneRecipe, defaultRecipe } from '../recipe';
import {
  BUILT_IN_PRESETS, loadCustomPresets, newPresetId, parsePresetFile, presetsToJson, saveCustomPresets, type Preset,
} from '../presets';
import { downloadBlob, h } from './dom';
import { notify } from './notify';

/** Presets section: built-ins, user presets (save/rename/delete), import/export. */
export function presetsSection(store: Store): HTMLElement {
  let custom = loadCustomPresets();
  const list = h('ul', { class: 'preset-list', 'aria-label': 'My presets' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', tabindex: -1, 'aria-hidden': 'true' });

  const persist = (): boolean => {
    try {
      saveCustomPresets(custom);
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error', 'presets');
      return false;
    }
  };

  const apply = (p: Preset) => {
    store.replaceEditing(p.recipe);
    const target = store.scope === 'image' && store.selected ? `“${store.selected.name}”` : 'all images';
    status.textContent = `Applied “${p.name}” to ${target}.`;
  };

  const exportPresets = (presets: Preset[], filename: string) => {
    downloadBlob(new Blob([presetsToJson(presets)], { type: 'application/json' }), filename);
  };

  const renderList = () => {
    list.replaceChildren(...custom.map((p) => h('li', {},
      h('button', { class: 'btn small', title: `Apply ${p.name}`, onclick: () => apply(p) }, p.name),
      h('button', { class: 'btn small icon-btn', 'aria-label': `Rename ${p.name}`, title: 'Rename', onclick: () => {
        const name = prompt('Rename preset', p.name)?.trim();
        if (!name) return;
        p.name = name.slice(0, 60);
        if (persist()) renderList();
      } }, '✎'),
      h('button', { class: 'btn small icon-btn', 'aria-label': `Export ${p.name}`, title: 'Export to file', onclick: () => exportPresets([p], `${slug(p.name)}.preset.json`) }, '⤓'),
      h('button', { class: 'btn small icon-btn danger', 'aria-label': `Delete ${p.name}`, title: 'Delete', onclick: () => {
        if (!confirm(`Delete preset “${p.name}”?`)) return;
        custom = custom.filter((x) => x !== p);
        if (persist()) renderList();
      } }, '×'),
    )));
    if (!custom.length) list.append(h('li', { class: 'hint' }, 'No saved presets yet.'));
    exportAll.disabled = !custom.length;
  };

  const saveBtn = h('button', { class: 'btn small', onclick: () => {
    const name = prompt('Name for this preset', `My preset ${custom.length + 1}`)?.trim();
    if (!name) return;
    custom.push({ id: newPresetId(), name: name.slice(0, 60), recipe: cloneRecipe(store.viewing()) });
    if (persist()) renderList();
    else custom.pop();
  } }, 'Save current…');
  const importBtn = h('button', { class: 'btn small', onclick: () => fileInput.click() }, 'Import…');
  const exportAll = h('button', { class: 'btn small', onclick: () => exportPresets(custom, 'retro-filter-presets.json') }, 'Export all');
  const status = h('p', { class: 'hint', 'aria-live': 'polite' });

  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    let added = 0;
    for (const f of files) {
      try {
        const imported = parsePresetFile(await f.text(), f.name.replace(/(\.preset)?\.json$/i, ''));
        for (const p of imported) custom.push({ ...p, id: newPresetId() });
        added += imported.length;
      } catch (err) {
        notify(`Could not import “${f.name}”: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    }
    if (added && persist()) {
      renderList();
      status.textContent = `Imported ${added} preset${added > 1 ? 's' : ''}.`;
    }
  });

  const builtIns = h('div', { class: 'preset-grid' }, ...BUILT_IN_PRESETS.map((p) =>
    h('button', { class: 'btn small', onclick: () => apply(p), title: `Apply ${p.name}` }, p.name)));
  const resetBtn = h('button', { class: 'btn small', title: 'Reset every adjustment and effect', onclick: () => {
    store.replaceEditing(defaultRecipe());
    status.textContent = 'Reset to defaults.';
  } }, 'Reset all');

  renderList();
  return h('details', { class: 'section', open: true },
    h('summary', {}, 'Presets'),
    h('div', { class: 'section-body' },
      builtIns,
      h('div', { class: 'row' }, resetBtn),
      h('h3', { class: 'hint', style: 'margin:6px 0 0' }, 'My presets'),
      list,
      h('div', { class: 'row' }, saveBtn, importBtn, exportAll, fileInput),
      status,
    ));
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
}
