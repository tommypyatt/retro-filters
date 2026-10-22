import type { Recipe } from '../recipe';

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface ExportSettings {
  format: ExportFormat;
  /** 0..1 for JPEG/WebP. */
  quality: number;
  /** 0 = original size, otherwise the maximum long edge in px. */
  maxEdge: number;
  /** Filename pattern with {name}, {index}, {ext}. */
  pattern: string;
}

export const DEFAULT_EXPORT: ExportSettings = { format: 'jpeg', quality: 0.92, maxEdge: 0, pattern: '{name}-retro.{ext}' };

export interface ExportJob {
  id: number;
  file: Blob;
  recipe: Recipe;
  seed: number;
  /** ms since epoch (Dates don't survive postMessage as nicely across all paths). */
  date: number;
  /** Oriented source dimensions, known from loading. */
  width: number;
  height: number;
  settings: ExportSettings;
}

export interface ExportResult {
  blob: Blob;
  width: number;
  height: number;
  warning?: string;
}

export type WorkerRequest =
  | { type: 'init'; backend: 'webgl2' | 'canvas2d' }
  | { type: 'render'; job: ExportJob };

export type WorkerResponse =
  | { type: 'ready'; ok: boolean; reason?: string }
  | { type: 'done'; id: number; result: ExportResult }
  | { type: 'error'; id: number; message: string };

export function mimeFor(f: ExportFormat): string {
  return f === 'png' ? 'image/png' : f === 'jpeg' ? 'image/jpeg' : 'image/webp';
}

export function extFor(f: ExportFormat): string {
  return f === 'jpeg' ? 'jpg' : f;
}

/** Expand the filename pattern; always ends with the right extension. */
export function outputName(pattern: string, sourceName: string, index: number, format: ExportFormat): string {
  const base = sourceName.replace(/\.[^.]+$/, '');
  const ext = extFor(format);
  let name = (pattern || '{name}')
    .replaceAll('{name}', base)
    .replaceAll('{index}', String(index).padStart(3, '0'))
    .replaceAll('{ext}', ext);
  // Strip characters that are invalid in filenames on common platforms.
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || base;
  if (!name.toLowerCase().endsWith(`.${ext}`)) name = `${name.replace(/\.(jpe?g|png|webp)$/i, '')}.${ext}`;
  return name;
}
