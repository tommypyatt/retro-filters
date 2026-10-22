import { decodeFile } from '../images';
import { renderRecipe, type Backend } from '../render/pipeline';
import { mimeFor, type ExportJob, type ExportResult } from './types';

/**
 * Full-resolution render of one job. Shared by the export worker and the
 * main-thread fallback. Memory: one decoded bitmap, one source texture and
 * the output canvases exist at a time and are all released before returning.
 */
export async function renderExport(job: ExportJob, backend: Backend): Promise<ExportResult> {
  const { settings: s } = job;
  const warnings: string[] = [];

  // Target size: the requested long edge (never upscaled), then capped by
  // what this GPU can hold as a texture and render as a viewport.
  const long = Math.max(job.width, job.height);
  let target = s.maxEdge > 0 ? Math.min(s.maxEdge, long) : long;
  const gpuLimit = Math.min(backend.maxTextureSize, backend.maxOutputSize);
  if (target > gpuLimit) {
    warnings.push(`downscaled from ${job.width}×${job.height} to fit this GPU's ${gpuLimit}px texture limit`);
    target = gpuLimit;
  }
  const scale = target / long;
  const w = Math.max(1, Math.round(job.width * scale));
  const h = Math.max(1, Math.round(job.height * scale));

  // Decode directly at the target size (EXIF orientation applied) so a 50MP
  // original never has to coexist with a resized copy.
  const bitmap = await decodeFile(job.file, scale < 1 ? { width: w, height: h } : undefined);
  const key = `export:${job.id}`;
  const canvas = new OffscreenCanvas(1, 1);
  try {
    if (bitmap.width !== w || bitmap.height !== h) {
      throw new Error(`Decoded size ${bitmap.width}×${bitmap.height} does not match the expected ${w}×${h}.`);
    }
    backend.setSource(key, bitmap);
    bitmap.close();
    const ctx = canvas.getContext('2d')!;
    renderRecipe(backend, key, job.recipe, { seed: job.seed, date: new Date(job.date) }, w, h, ctx);
    backend.dropSource(key);
    // Release the backend's full-size drawing buffer now rather than at GC.
    backend.canvas.width = backend.canvas.height = 1;
    if (s.format === 'jpeg') {
      // JPEG has no alpha: flatten transparent areas onto white.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const blob = await canvas.convertToBlob({ type: mimeFor(s.format), quality: s.format === 'png' ? undefined : s.quality });
    if (s.format !== 'png' && blob.type !== mimeFor(s.format)) {
      warnings.push(`this browser cannot encode ${s.format.toUpperCase()}, saved as ${blob.type}`);
    }
    return { blob, width: canvas.width, height: canvas.height, warning: warnings.join('; ') || undefined };
  } finally {
    bitmap.close();
    backend.dropSource(key);
    canvas.width = canvas.height = 0;
  }
}
