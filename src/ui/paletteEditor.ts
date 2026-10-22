import type { Recipe } from '../recipe';
import { PALETTES, paletteHex } from '../render/palettes';
import type { Bound, ControlHost } from './controls';
import { h } from './dom';

/** Swatch preview of the active palette plus an editor for the custom one. */
export function paletteEditor(host: ControlHost): Bound {
  const swatches = h('div', { class: 'palette-swatches', 'aria-hidden': 'true' });
  const list = h('div', { class: 'palette-swatches' });
  const add = h('button', { class: 'btn small', type: 'button' }, '+ Colour');
  const paste = h('input', { type: 'text', placeholder: 'Paste hex list: #112233, #445566…', 'aria-label': 'Custom palette as hex list', spellcheck: 'false' });
  const custom = h('div', { class: 'field' },
    h('span', {}, 'Custom colours'), list, h('div', { class: 'row' }, add, paste));

  const current = () => [...host.view().palette.custom];
  add.addEventListener('click', () => {
    const cols = current();
    if (cols.length >= 32) return;
    cols.push('#808080');
    host.set('palette.custom', cols);
  });
  paste.addEventListener('change', () => {
    const cols = (paste.value.match(/#?[0-9a-fA-F]{6}\b/g) ?? []).map((c) => (c.startsWith('#') ? c : `#${c}`).toLowerCase());
    if (cols.length >= 2) host.set('palette.custom', cols.slice(0, 32));
    paste.value = '';
  });

  let rendered = '';
  return {
    el: h('div', { class: 'field' }, swatches, custom),
    sync(r: Recipe) {
      const hex = paletteHex(r.palette);
      swatches.replaceChildren(...hex.map((c) => h('span', { style: `background:${c}`, title: c })));
      custom.hidden = r.palette.palette !== 'custom';
      const key = r.palette.custom.join();
      if (key === rendered) return;
      rendered = key;
      list.replaceChildren(...r.palette.custom.map((c, i) => {
        const inp = h('input', { type: 'color', value: c, 'aria-label': `Custom colour ${i + 1}`, style: 'width:32px;height:26px' });
        inp.addEventListener('input', () => {
          const cols = current();
          cols[i] = inp.value;
          rendered = cols.join();
          host.set('palette.custom', cols);
        });
        const del = h('button', { class: 'btn small icon-btn', type: 'button', 'aria-label': `Remove colour ${i + 1}`, title: 'Remove' }, '×');
        del.addEventListener('click', () => {
          const cols = current();
          if (cols.length <= 2) return;
          cols.splice(i, 1);
          host.set('palette.custom', cols);
        });
        return h('span', { style: 'display:inline-flex;gap:2px;width:auto;height:auto;border:0' }, inp, del);
      }));
    },
  };
}

export const PALETTE_OPTIONS: [string, string][] = [
  ...Object.entries(PALETTES).map(([k, v]) => [k, v.label] as [string, string]),
  ['custom', 'Custom'],
];
