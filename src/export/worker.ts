/// <reference lib="webworker" />
// Export worker: renders full-resolution images off the main thread using an
// OffscreenCanvas with the same backend (and shader code) as the preview.
import { GLRenderer } from '../render/glRenderer';
import { CpuRenderer } from '../render/cpuRenderer';
import type { Backend } from '../render/pipeline';
import { renderExport } from './render';
import type { WorkerRequest, WorkerResponse } from './types';

declare const self: DedicatedWorkerGlobalScope;
let backend: Backend | null = null;

const post = (msg: WorkerResponse) => self.postMessage(msg);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      const canvas = new OffscreenCanvas(1, 1);
      backend = msg.backend === 'webgl2' ? new GLRenderer(canvas) : new CpuRenderer(canvas);
      post({ type: 'ready', ok: true });
    } catch (err) {
      post({ type: 'ready', ok: false, reason: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (msg.type === 'render') {
    try {
      if (!backend) throw new Error('Export worker is not initialised');
      const result = await renderExport(msg.job, backend);
      post({ type: 'done', id: msg.job.id, result });
    } catch (err) {
      post({ type: 'error', id: msg.job.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
};
