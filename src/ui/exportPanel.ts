import { Zip, ZipPassThrough } from 'fflate';
import type { Store } from '../state';
import type { LoadedImage } from '../images';
import { cloneRecipe } from '../recipe';
import { AbortError, type Exporter } from '../export/exporter';
import { DEFAULT_EXPORT, outputName, type ExportFormat, type ExportSettings } from '../export/types';
import { downloadBlob, h, uniqueId } from './dom';
import { notify } from './notify';

const SETTINGS_KEY = 'retro-filters.export.v1';

function loadSettings(): ExportSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = { ...DEFAULT_EXPORT, ...JSON.parse(raw) } as ExportSettings;
      if (!['png', 'jpeg', 'webp'].includes(s.format)) s.format = 'jpeg';
      return s;
    }
  } catch { /* storage unavailable: use defaults */ }
  return { ...DEFAULT_EXPORT };
}

function saveSettings(s: ExportSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* not critical */ }
}

/** "Output" section: export format/size/naming and the export actions. */
export function exportSection(store: Store, exporter: Exporter): { el: HTMLElement; sync(): void } {
  const s = loadSettings();
  const id = (p: string) => uniqueId(p);

  const fmtId = id('fmt');
  const fmt = h('select', { id: fmtId },
    h('option', { value: 'jpeg' }, 'JPEG'), h('option', { value: 'png' }, 'PNG'), h('option', { value: 'webp' }, 'WebP'));
  fmt.value = s.format;

  const qId = id('q');
  const q = h('input', { type: 'range', id: qId, min: 0.5, max: 1, step: 0.01, value: s.quality });
  const qNum = h('input', { type: 'number', min: 0.5, max: 1, step: 0.01, 'aria-label': 'Quality value', value: s.quality.toFixed(2) });
  const qRow = h('div', { class: 'ctl' }, h('label', { for: qId }, 'Quality'), qNum, q);

  const sizeId = id('size');
  const size = h('select', { id: sizeId }, h('option', { value: 'original' }, 'Original size'), h('option', { value: 'max' }, 'Max long edge'));
  size.value = s.maxEdge > 0 ? 'max' : 'original';
  const edgeId = id('edge');
  const edge = h('input', { type: 'number', id: edgeId, class: 'plain', min: 64, max: 32768, step: 1, value: s.maxEdge > 0 ? s.maxEdge : 2048 });
  const edgeField = h('div', { class: 'field' }, h('label', { for: edgeId }, 'Long edge (px)'), edge);

  const patId = id('pat');
  const pattern = h('input', { type: 'text', id: patId, value: s.pattern, spellcheck: 'false' });

  const update = () => {
    s.format = fmt.value as ExportFormat;
    s.quality = Math.min(1, Math.max(0.5, parseFloat(q.value) || DEFAULT_EXPORT.quality));
    s.maxEdge = size.value === 'max' ? Math.max(64, Math.round(parseFloat(edge.value) || 2048)) : 0;
    s.pattern = pattern.value.trim() || DEFAULT_EXPORT.pattern;
    qRow.hidden = s.format === 'png';
    edgeField.hidden = size.value !== 'max';
    qNum.value = s.quality.toFixed(2);
    saveSettings(s);
    sync();
  };
  fmt.addEventListener('change', update);
  q.addEventListener('input', update);
  qNum.addEventListener('change', () => { q.value = qNum.value; update(); });
  size.addEventListener('change', update);
  edge.addEventListener('change', update);
  pattern.addEventListener('change', update);

  const exportOne = h('button', { class: 'btn primary', type: 'button' }, 'Export image');
  const exportAll = h('button', { class: 'btn', type: 'button' }, 'Export all (.zip)');
  const example = h('p', { class: 'hint' });

  // ---- Progress dialog ----
  const bar = h('progress', { max: 1, value: 0 });
  const text = h('p', { class: 'progress-text', 'aria-live': 'polite' });
  const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
  const dialog = h('dialog', { 'aria-labelledby': 'export-title' },
    h('header', { id: 'export-title' }, 'Exporting'),
    h('div', { class: 'dialog-body' }, bar, text),
    h('footer', {}, cancel));
  document.body.append(dialog);
  let controller: AbortController | null = null;
  cancel.addEventListener('click', () => controller?.abort());
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); controller?.abort(); });

  async function run(images: LoadedImage[], zip: boolean): Promise<void> {
    if (!images.length || controller) return;
    controller = new AbortController();
    const signal = controller.signal;
    const settings = { ...s };
    const warnings: string[] = [];
    const failures: string[] = [];
    const parts: Uint8Array[] = [];
    const used = new Set<string>();
    let zipper: Zip | null = null;
    let zipDone: Promise<void> | null = null;
    if (zip) {
      zipper = new Zip();
      zipDone = new Promise((resolve, reject) => {
        zipper!.ondata = (err, chunk, final) => {
          if (err) return reject(err);
          parts.push(chunk);
          if (final) resolve();
        };
      });
    }
    bar.max = images.length;
    bar.value = 0;
    text.textContent = 'Starting…';
    dialog.showModal();
    const t0 = performance.now();
    let done = 0;
    try {
      for (const [i, img] of images.entries()) {
        if (signal.aborted) throw new AbortError();
        text.textContent = `${i + 1} of ${images.length}: ${img.name}`;
        try {
          const res = await exporter.render({
            id: i + 1,
            file: img.file,
            recipe: cloneRecipe(store.effective(img.id)),
            seed: img.seed,
            date: img.date.getTime(),
            width: img.width,
            height: img.height,
            settings,
          }, signal);
          let name = outputName(settings.pattern, img.name, i + 1, settings.format);
          if (res.warning) warnings.push(`${img.name}: ${res.warning}`);
          if (zipper) {
            // Unique names inside the archive.
            let n = 2;
            const stem = name.replace(/(\.[^.]+)$/, '');
            const ext = name.slice(stem.length);
            while (used.has(name)) name = `${stem}-${n++}${ext}`;
            used.add(name);
            // Already-compressed images: store, don't deflate.
            const entry = new ZipPassThrough(name);
            entry.mtime = img.date;
            zipper.add(entry);
            entry.push(new Uint8Array(await res.blob.arrayBuffer()), true);
          } else {
            downloadBlob(res.blob, name);
          }
          done++;
        } catch (err) {
          if (err instanceof AbortError || signal.aborted) throw new AbortError();
          failures.push(`${img.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
        bar.value = i + 1;
      }
      if (zipper) {
        text.textContent = 'Finishing archive…';
        zipper.end();
        await zipDone;
        if (done) downloadBlob(new Blob(parts as BlobPart[], { type: 'application/zip' }), 'retro-filters-export.zip');
      }
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      console.info(`Exported ${done}/${images.length} in ${secs}s (${exporter.mode} thread)`);
      if (warnings.length) notify(`Export notes:\n${warnings.map((w) => `• ${w}`).join('\n')}`, 'warning', 'export-warn');
      if (failures.length) notify(`${failures.length} image${failures.length > 1 ? 's' : ''} failed to export:\n${failures.map((f) => `• ${f}`).join('\n')}`, 'error', 'export-fail');
    } catch (err) {
      if (!(err instanceof AbortError)) notify(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error', 'export-fail');
      else zipper?.terminate();
    } finally {
      parts.length = 0;
      controller = null;
      dialog.close();
      sync();
    }
  }

  exportOne.addEventListener('click', () => { const img = store.selected; if (img) void run([img], false); });
  exportAll.addEventListener('click', () => void run(store.images, true));

  function sync(): void {
    const n = store.images.length;
    exportOne.disabled = !store.selected || !!controller;
    exportAll.disabled = !n || !!controller;
    exportAll.textContent = n > 1 ? `Export all ${n} (.zip)` : 'Export all (.zip)';
    const sel = store.selected;
    example.textContent = sel ? `e.g. ${outputName(s.pattern, sel.name, store.images.indexOf(sel) + 1, s.format)}` : '';
  }

  qRow.hidden = s.format === 'png';
  edgeField.hidden = size.value !== 'max';
  sync();

  const el = h('details', { class: 'section', open: true },
    h('summary', {}, 'Output'),
    h('div', { class: 'section-body' },
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { for: fmtId }, 'Format'), fmt),
        h('div', { class: 'field' }, h('label', { for: sizeId }, 'Size'), size)),
      edgeField,
      qRow,
      h('div', { class: 'field' }, h('label', { for: patId }, 'Filename pattern'), pattern,
        h('p', { class: 'hint' }, 'Tokens: {name} {index} {ext}')),
      example,
      h('div', { class: 'row' }, exportOne, exportAll),
    ));
  return { el, sync };
}
