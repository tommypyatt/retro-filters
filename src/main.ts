import './style.css';
import { h, $ } from './ui/dom';
import { loadImage, releaseImage, DecodeError, type LoadedImage } from './images';

const images: LoadedImage[] = [];
let selectedId: string | null = null;

const app = $('#app');
app.className = 'app';
app.append(
  h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'RETRO', h('span', {}, 'FILTERS')),
    h('button', { class: 'btn', id: 'add-btn' }, 'Add images…'),
    h('input', { type: 'file', id: 'file-input', accept: 'image/*', multiple: true, class: 'sr-only', tabindex: -1 }),
  ),
  h('div', { class: 'banner', id: 'banner', 'aria-live': 'polite' }),
  h('nav', { class: 'thumbs', 'aria-label': 'Loaded images' }, h('ul', { class: 'thumb-list', id: 'thumb-list' })),
  h('main', { class: 'stage' },
    h('div', { class: 'viewport', id: 'viewport' },
      h('canvas', { class: 'preview', id: 'preview' }),
      h('div', { class: 'dropzone', id: 'dropzone' },
        h('div', {}, h('h2', {}, 'Drop images here'), h('p', {}, 'or use “Add images…”')),
      ),
    ),
  ),
  h('aside', { class: 'panel' }),
);

const fileInput = $<HTMLInputElement>('#file-input');
$('#add-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files) void addFiles([...fileInput.files]);
  fileInput.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; app.classList.add('drag-over'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; app.classList.remove('drag-over'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  app.classList.remove('drag-over');
  if (e.dataTransfer?.files.length) void addFiles([...e.dataTransfer.files]);
});

async function addFiles(files: File[]): Promise<void> {
  const errors: string[] = [];
  for (const f of files) {
    try {
      const img = await loadImage(f);
      images.push(img);
      if (!selectedId) selectedId = img.id;
      renderThumbs();
      renderPreview();
    } catch (err) {
      errors.push(err instanceof DecodeError ? err.message : `${f.name}: ${String(err)}`);
    }
  }
  const banner = $('#banner');
  banner.replaceChildren(...errors.map((m) => h('div', { class: 'notice error', role: 'alert' }, h('p', {}, m))));
}

function renderThumbs(): void {
  const list = $('#thumb-list');
  list.replaceChildren(...images.map((img) => {
    const c = h('canvas', { width: img.thumb.width, height: img.thumb.height });
    c.getContext('2d')!.drawImage(img.thumb, 0, 0);
    return h('li', {
      class: `thumb${img.id === selectedId ? ' active' : ''}`,
      onclick: () => { selectedId = img.id; renderThumbs(); renderPreview(); },
    }, c,
    h('span', { class: 'name' }, img.name),
    h('button', {
      class: 'remove', 'aria-label': `Remove ${img.name}`,
      onclick: (e: Event) => {
        e.stopPropagation();
        images.splice(images.indexOf(img), 1);
        releaseImage(img);
        if (selectedId === img.id) selectedId = images[0]?.id ?? null;
        renderThumbs(); renderPreview();
      },
    }, '×'));
  }));
}

function renderPreview(): void {
  const canvas = $<HTMLCanvasElement>('#preview');
  const img = images.find((i) => i.id === selectedId);
  $('#dropzone').hidden = !!img;
  if (!img) { canvas.width = canvas.height = 0; return; }
  canvas.width = img.preview.width;
  canvas.height = img.preview.height;
  canvas.getContext('2d')!.drawImage(img.preview, 0, 0);
}
