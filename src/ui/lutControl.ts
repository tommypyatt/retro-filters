import { parseCube, LutError } from '../render/lut';
import type { Recipe } from '../recipe';
import type { Bound, ControlHost } from './controls';
import { h, uniqueId } from './dom';
import { notify } from './notify';

/** Load a .cube file into recipe.lut, with enable toggle and intensity. */
export function lutControl(host: ControlHost): Bound {
  const fileInput = h('input', { type: 'file', accept: '.cube', class: 'sr-only', tabindex: -1, 'aria-hidden': 'true' });
  const load = h('button', { class: 'btn small', onclick: () => fileInput.click() }, 'Load .cube LUT…');
  const remove = h('button', { class: 'btn small danger', onclick: () => host.set('lut', null) }, 'Remove');
  const name = h('span', { class: 'hint', style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' });
  const checkId = uniqueId('lut');
  const check = h('input', { type: 'checkbox', id: checkId });
  check.addEventListener('change', () => host.set('lut.enabled', check.checked));
  const rangeId = uniqueId('luti');
  const range = h('input', { type: 'range', id: rangeId, min: 0, max: 1, step: 0.01 });
  const num = h('input', { type: 'number', min: 0, max: 1, step: 0.01, 'aria-label': 'LUT intensity value' });
  const setIntensity = (v: number) => { if (Number.isFinite(v)) host.set('lut.intensity', Math.min(1, Math.max(0, v))); };
  range.addEventListener('input', () => setIntensity(parseFloat(range.value)));
  num.addEventListener('change', () => setIntensity(parseFloat(num.value)));
  range.addEventListener('dblclick', () => setIntensity(1));
  const label = h('label', { for: rangeId, title: 'Double-click to reset' }, 'Intensity');
  label.addEventListener('dblclick', () => setIntensity(1));
  const details = h('div', { class: 'effect-body' },
    h('div', { class: 'ctl' }, label, num, range));

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    try {
      host.set('lut', parseCube(await f.text(), f.name));
    } catch (err) {
      notify(`Could not load LUT “${f.name}”: ${err instanceof LutError ? err.message : String(err)}`, 'error');
    }
  });

  const card = h('div', { class: 'effect', 'data-effect': 'lut' },
    h('div', { class: 'effect-head' }, h('label', { for: checkId }, check, '3D LUT'), name),
    h('div', { class: 'effect-body' }, h('div', { class: 'row' }, load, remove, fileInput)),
    details,
  );
  return {
    el: card,
    sync(r: Recipe) {
      const lut = r.lut;
      check.disabled = !lut;
      check.checked = !!lut?.enabled;
      card.classList.toggle('on', !!lut?.enabled);
      remove.hidden = !lut;
      details.hidden = !lut;
      name.textContent = lut ? `${lut.name} (${lut.size}³)` : 'None loaded';
      name.title = name.textContent;
      if (lut) {
        range.value = String(lut.intensity);
        if (document.activeElement !== num) num.value = lut.intensity.toFixed(2);
      }
    },
  };
}
