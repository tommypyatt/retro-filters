import './style.css';
import { h, $, isTypingTarget } from './ui/dom';
import { loadImage, releaseImage, DecodeError } from './images';
import { Store } from './state';
import { GLRenderer } from './render/glRenderer';
import { CpuRenderer, CPU_UNSUPPORTED } from './render/cpuRenderer';
import type { Backend } from './render/pipeline';
import { Preview } from './ui/preview';
import { Thumbs } from './ui/thumbs';
import { Panel } from './ui/panel';
import { LIGHT, COLOUR, RETRO } from './ui/panelSpec';
import { notify } from './ui/notify';

const store = new Store();

// ---------- Shell ----------
const app = $('#app');
app.className = 'app';
const fileInput = h('input', { type: 'file', id: 'file-input', accept: 'image/*', multiple: true, class: 'sr-only', tabindex: -1, 'aria-hidden': 'true' });
const addBtn = h('button', { class: 'btn', id: 'add-btn' }, 'Add images…');
const clearBtn = h('button', { class: 'btn danger', id: 'clear-btn', disabled: true }, 'Clear all');
const panelToggle = h('button', { class: 'btn', id: 'panel-toggle', 'aria-controls': 'panel', 'aria-expanded': 'true' }, 'Controls');
const thumbList = h('ul', { class: 'thumb-list', id: 'thumb-list' });
const viewport = h('div', { class: 'viewport', id: 'viewport' });
const dropzone = h('div', { class: 'dropzone', id: 'dropzone' },
  h('div', {},
    h('h2', {}, 'Drop images here'),
    h('p', {}, 'or ', h('button', { class: 'btn small', onclick: () => fileInput.click() }, 'choose files')),
    h('p', {}, 'JPEG, PNG, WebP, GIF, AVIF… anything your browser can decode. Nothing is uploaded.'),
  ));
viewport.append(dropzone);
const compareBtn = h('button', { class: 'btn small', id: 'compare-btn', title: 'Hold to show the original (shortcut: hold C)' }, 'Hold to compare');
const splitBtn = h('button', { class: 'btn small', id: 'split-btn', 'aria-pressed': 'false', title: 'Before/after split (shortcut: S)' }, 'Split view');
const info = h('span', { class: 'info', id: 'preview-info', 'aria-live': 'off' });
const panelEl = h('aside', { class: 'panel', id: 'panel', 'aria-label': 'Adjustments' });

app.append(
  h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'RETRO', h('span', {}, 'FILTERS')),
    addBtn, fileInput, clearBtn,
    h('div', { class: 'spacer' }),
    panelToggle,
  ),
  h('div', { class: 'banner', id: 'banner' }),
  h('nav', { class: 'thumbs', 'aria-label': 'Loaded images' }, thumbList),
  h('main', { class: 'stage' },
    h('div', { class: 'stage-toolbar' }, compareBtn, splitBtn, info),
    viewport,
  ),
  panelEl,
);

// ---------- Rendering backend ----------
function createBackend(): Backend {
  const forceCpu = new URLSearchParams(location.search).has('cpu');
  if (!forceCpu) {
    try {
      return new GLRenderer(document.createElement('canvas'));
    } catch (err) {
      console.warn('WebGL2 unavailable, falling back to Canvas 2D', err);
    }
  }
  notify(
    `WebGL2 is not available${forceCpu ? ' (forced by ?cpu)' : ''}, so rendering uses a slower Canvas 2D fallback. ` +
    `Not supported in this mode: ${CPU_UNSUPPORTED.join(', ')}.`,
    'warning', 'backend',
  );
  return new CpuRenderer(document.createElement('canvas'));
}
const backend = createBackend();
document.documentElement.dataset.backend = backend.kind;

const preview = new Preview(viewport, store, backend);
const thumbs = new Thumbs(thumbList, store, backend);
const panel = new Panel(panelEl, store);
panel.addSection(LIGHT);
panel.addSection(COLOUR);
panel.addSection(RETRO);

preview.onRendered = ({ width, height, ms }) => {
  const img = store.selected;
  if (!img) return;
  info.textContent = `${img.name} · ${img.width}×${img.height} · preview ${width}×${height} · ${ms.toFixed(1)} ms`;
};
preview.onError = (err) => notify(`Preview failed: ${err instanceof Error ? err.message : String(err)}`, 'error', 'preview');

store.on((kind) => {
  if (kind === 'images') {
    thumbs.rebuild();
    clearBtn.disabled = store.images.length === 0;
    dropzone.hidden = store.images.length > 0;
  } else {
    thumbs.update();
  }
  if (kind === 'selection') thumbs.scrollToSelected();
  if (kind !== 'recipe') panel.sync();
  preview.request();
});
panel.sync();

// ---------- Loading ----------
fileInput.addEventListener('change', () => {
  if (fileInput.files) void addFiles([...fileInput.files]);
  fileInput.value = '';
});
addBtn.addEventListener('click', () => fileInput.click());
clearBtn.addEventListener('click', () => {
  if (!confirm(`Remove all ${store.images.length} images?`)) return;
  for (const img of store.clearImages()) {
    backend.dropSource(`${img.id}:preview`);
    releaseImage(img);
  }
});
thumbs.onRemove = (img) => {
  store.removeImage(img.id);
  backend.dropSource(`${img.id}:preview`);
  releaseImage(img);
};

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; app.classList.add('drag-over'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; app.classList.remove('drag-over'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  app.classList.remove('drag-over');
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) void addFiles(files);
});

async function addFiles(files: File[]): Promise<void> {
  const failed: string[] = [];
  // Sequential: each decode briefly holds a full-resolution bitmap.
  for (const f of files) {
    try {
      store.addImage(await loadImage(f));
    } catch (err) {
      failed.push(err instanceof DecodeError ? `• ${err.fileName}: ${err.message}` : `• ${f.name}: ${String(err)}`);
    }
  }
  if (failed.length) {
    notify(`${failed.length} file${failed.length > 1 ? 's' : ''} could not be loaded:\n${failed.join('\n')}`, 'error');
  }
}

// ---------- Compare ----------
const hold = (v: boolean) => {
  preview.setHolding(v);
  compareBtn.setAttribute('aria-pressed', String(v));
};
compareBtn.addEventListener('pointerdown', (e) => { compareBtn.setPointerCapture(e.pointerId); hold(true); });
compareBtn.addEventListener('pointerup', () => hold(false));
compareBtn.addEventListener('pointercancel', () => hold(false));
compareBtn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); hold(true); } });
compareBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') hold(false); });
compareBtn.addEventListener('blur', () => hold(false));
const toggleSplit = () => {
  const on = preview.mode !== 'split';
  preview.setMode(on ? 'split' : 'off');
  splitBtn.setAttribute('aria-pressed', String(on));
};
splitBtn.addEventListener('click', toggleSplit);

// ---------- Panel toggle ----------
panelToggle.addEventListener('click', () => {
  const collapsed = app.classList.toggle('panel-collapsed');
  panelToggle.setAttribute('aria-expanded', String(!collapsed));
  preview.request();
});
if (window.matchMedia('(max-width: 900px)').matches) {
  app.classList.add('panel-collapsed');
  panelToggle.setAttribute('aria-expanded', 'false');
}

// ---------- Keyboard shortcuts ----------
function step(delta: number): void {
  const n = store.images.length;
  if (!n) return;
  const idx = store.images.findIndex((i) => i.id === store.selectedId);
  store.select(store.images[(idx + delta + n) % n].id);
}
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingTarget(e.target) || (e.target as HTMLElement | null)?.closest('dialog')) return;
  if ((e.target as HTMLElement | null)?.getAttribute('role') === 'slider') return;
  switch (e.key) {
    case 'ArrowRight': case '.': step(1); break;
    case 'ArrowLeft': case ',': step(-1); break;
    case 'c': case 'C': if (!e.repeat) hold(true); break;
    case 's': case 'S': toggleSplit(); break;
    default: return;
  }
  e.preventDefault();
});
window.addEventListener('keyup', (e) => { if (e.key === 'c' || e.key === 'C') hold(false); });
window.addEventListener('blur', () => hold(false));

// Exposed for automated browser tests.
Object.assign(window, { __retro: { store, backend, preview } });
