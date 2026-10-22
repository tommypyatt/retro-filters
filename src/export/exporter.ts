import type { Backend } from '../render/pipeline';
import { renderExport } from './render';
import type { ExportJob, ExportResult, WorkerResponse } from './types';

export class AbortError extends Error {
  constructor() {
    super('Export cancelled');
  }
}

/**
 * Runs export jobs one at a time, in a Web Worker (OffscreenCanvas) when the
 * browser supports rendering there with the same backend as the preview, and
 * on the main thread otherwise. Cancelling terminates the worker, which also
 * frees its GPU memory immediately.
 */
export class Exporter {
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private pending = new Map<number, { resolve: (r: ExportResult) => void; reject: (e: Error) => void }>();
  /** 'worker' or 'main', known after the first job. */
  mode: 'worker' | 'main' | 'unknown' = 'unknown';

  constructor(private backend: Backend) {}

  private startWorker(): Promise<boolean> {
    if (this.ready) return this.ready;
    this.ready = new Promise<boolean>((resolve) => {
      if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return resolve(false);
      let w: Worker;
      try {
        w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      } catch {
        return resolve(false);
      }
      const timer = setTimeout(() => { w.terminate(); resolve(false); }, 10_000);
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(timer);
          if (!m.ok) {
            console.info('Export worker unavailable, exporting on the main thread:', m.reason);
            w.terminate();
            return resolve(false);
          }
          this.worker = w;
          return resolve(true);
        }
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.type === 'done') p.resolve(m.result);
        else p.reject(new Error(m.message));
      };
      w.onerror = (e) => {
        clearTimeout(timer);
        console.warn('Export worker failed', e.message);
        this.failAll(new Error(e.message || 'Export worker crashed (possibly out of memory).'));
        this.worker = null;
        this.ready = null;
        resolve(false);
      };
      w.postMessage({ type: 'init', backend: this.backend.kind });
    });
    return this.ready;
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  async render(job: ExportJob, signal: AbortSignal): Promise<ExportResult> {
    if (signal.aborted) throw new AbortError();
    const useWorker = await this.startWorker();
    this.mode = useWorker && this.worker ? 'worker' : 'main';
    if (this.mode === 'main') {
      // Yield so the progress UI can paint between images.
      await new Promise((r) => setTimeout(r, 0));
      const res = await renderExport(job, this.backend);
      if (signal.aborted) throw new AbortError();
      return res;
    }
    const worker = this.worker!;
    return new Promise<ExportResult>((resolve, reject) => {
      const onAbort = () => {
        // Terminate rather than wait: frees the worker's memory and GPU context.
        worker.terminate();
        if (this.worker === worker) {
          this.worker = null;
          this.ready = null;
        }
        this.failAll(new AbortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(job.id, {
        resolve: (r) => { signal.removeEventListener('abort', onAbort); resolve(r); },
        reject: (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
      });
      worker.postMessage({ type: 'render', job });
    });
  }
}
