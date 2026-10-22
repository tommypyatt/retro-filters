import { defaultRecipe, type Recipe } from '../recipe';
import { h, uniqueId } from './dom';

// Declarative control specs bound to dotted paths in the Recipe
// ('adjust.exposure', 'grain.amount', ...). The panel builds DOM from these and
// keeps it in sync with whichever recipe is being edited.

export interface SliderSpec { kind: 'slider'; path: string; label: string; min: number; max: number; step: number; digits?: number; suffix?: string }
export interface SelectSpec { kind: 'select'; path: string; label: string; options: [string, string][] }
export interface ColourSpec { kind: 'colour'; path: string; label: string }
export interface TextSpec { kind: 'text'; path: string; label: string; placeholder?: string; hint?: string }
export interface CustomSpec { kind: 'custom'; build: (ctl: ControlHost) => Bound }
export type ControlSpec = SliderSpec | SelectSpec | ColourSpec | TextSpec | CustomSpec;

export interface EffectSpec { kind: 'effect'; key: keyof Recipe; label: string; controls: ControlSpec[] }
export interface SectionSpec { title: string; open?: boolean; items: (ControlSpec | EffectSpec)[] }

/** A control element plus a function that refreshes it from a recipe. */
export interface Bound {
  el: HTMLElement;
  sync(r: Recipe): void;
}

export interface ControlHost {
  /** Recipe to read for display. */
  view(): Recipe;
  /** Write a value (creates an override when editing a single image). */
  set(path: string, value: unknown): void;
}

export function getPath(obj: unknown, path: string): unknown {
  let o = obj as Record<string, unknown> | undefined;
  for (const k of path.split('.')) o = o?.[k] as Record<string, unknown> | undefined;
  return o;
}

export function setPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  let o = obj as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
}

const DEFAULTS = defaultRecipe();

function decimals(step: number): number {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

export function slider(spec: SliderSpec, host: ControlHost): Bound {
  const id = uniqueId('s');
  const def = getPath(DEFAULTS, spec.path) as number;
  const digits = spec.digits ?? decimals(spec.step);
  const range = h('input', { type: 'range', id, min: spec.min, max: spec.max, step: spec.step, 'aria-describedby': `${id}-hint` });
  const num = h('input', {
    type: 'number', min: spec.min, max: spec.max, step: spec.step,
    'aria-label': `${spec.label} value`,
  });
  const label = h('label', { for: id, title: 'Double-click to reset' }, spec.label);
  const wrap = h('div', { class: 'ctl' }, label, num, range, h('span', { id: `${id}-hint`, class: 'sr-only' }, 'Double-click or press Delete to reset'));

  const commit = (v: number) => {
    if (!Number.isFinite(v)) return;
    v = Math.min(spec.max, Math.max(spec.min, v));
    host.set(spec.path, v);
    show(v);
  };
  const show = (v: number) => {
    range.value = String(v);
    if (document.activeElement !== num) num.value = v.toFixed(digits);
    wrap.classList.toggle('changed', Math.abs(v - def) > 1e-9);
  };
  range.addEventListener('input', () => commit(parseFloat(range.value)));
  num.addEventListener('change', () => commit(parseFloat(num.value)));
  num.addEventListener('blur', () => show(getPath(host.view(), spec.path) as number));
  const reset = () => commit(def);
  range.addEventListener('dblclick', reset);
  label.addEventListener('dblclick', reset);
  range.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); reset(); }
  });
  return { el: wrap, sync: (r) => show(getPath(r, spec.path) as number) };
}

export function select(spec: SelectSpec, host: ControlHost): Bound {
  const id = uniqueId('sel');
  const sel = h('select', { id }, ...spec.options.map(([v, l]) => h('option', { value: v }, l)));
  sel.addEventListener('change', () => host.set(spec.path, sel.value));
  return {
    el: h('div', { class: 'field' }, h('label', { for: id }, spec.label), sel),
    sync: (r) => { sel.value = String(getPath(r, spec.path)); },
  };
}

export function colour(spec: ColourSpec, host: ControlHost): Bound {
  const id = uniqueId('col');
  const inp = h('input', { type: 'color', id });
  inp.addEventListener('input', () => host.set(spec.path, inp.value));
  return {
    el: h('div', { class: 'field' }, h('label', { for: id }, spec.label), inp),
    sync: (r) => { inp.value = String(getPath(r, spec.path)); },
  };
}

export function text(spec: TextSpec, host: ControlHost): Bound {
  const id = uniqueId('txt');
  const inp = h('input', { type: 'text', id, placeholder: spec.placeholder, spellcheck: 'false', maxlength: 64 });
  inp.addEventListener('input', () => host.set(spec.path, inp.value));
  return {
    el: h('div', { class: 'field' }, h('label', { for: id }, spec.label), inp, spec.hint ? h('p', { class: 'hint' }, spec.hint) : null),
    sync: (r) => { if (document.activeElement !== inp) inp.value = String(getPath(r, spec.path)); },
  };
}

export function buildControl(spec: ControlSpec, host: ControlHost): Bound {
  switch (spec.kind) {
    case 'slider': return slider(spec, host);
    case 'select': return select(spec, host);
    case 'colour': return colour(spec, host);
    case 'text': return text(spec, host);
    case 'custom': return spec.build(host);
  }
}

/** Effect card: header with an on/off checkbox, collapsible body of controls. */
export function effect(spec: EffectSpec, host: ControlHost): Bound {
  const id = uniqueId('fx');
  const bodyId = `${id}-body`;
  const check = h('input', { type: 'checkbox', id });
  const toggleBody = h('button', { class: 'toggle-body', 'aria-expanded': 'false', 'aria-controls': bodyId, 'aria-label': `Show ${spec.label} settings` }, '▾');
  const children = spec.controls.map((c) => buildControl(c, host));
  const body = h('div', { class: 'effect-body', id: bodyId }, ...children.map((c) => c.el));
  const card = h('div', { class: 'effect collapsed', 'data-effect': String(spec.key) },
    h('div', { class: 'effect-head' }, h('label', { for: id }, check, spec.label), toggleBody),
    body,
  );
  const setOpen = (open: boolean) => {
    card.classList.toggle('collapsed', !open);
    toggleBody.setAttribute('aria-expanded', String(open));
    toggleBody.textContent = open ? '▴' : '▾';
  };
  toggleBody.addEventListener('click', () => setOpen(card.classList.contains('collapsed')));
  check.addEventListener('change', () => {
    host.set(`${String(spec.key)}.enabled`, check.checked);
    if (check.checked) setOpen(true);
  });
  return {
    el: card,
    sync: (r) => {
      const on = !!getPath(r, `${String(spec.key)}.enabled`);
      check.checked = on;
      card.classList.toggle('on', on);
      for (const c of children) c.sync(r);
    },
  };
}

export function section(spec: SectionSpec, host: ControlHost): Bound {
  const items = spec.items.map((it) => (it.kind === 'effect' ? effect(it, host) : buildControl(it, host)));
  const el = h('details', { class: 'section', open: spec.open ?? false },
    h('summary', {}, spec.title),
    h('div', { class: 'section-body' }, ...items.map((i) => i.el)),
  );
  return { el, sync: (r) => { for (const i of items) i.sync(r); } };
}
