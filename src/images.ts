// Image loading: decodes files with EXIF orientation applied, keeps only
// downscaled bitmaps resident (preview + thumbnail), and re-decodes the
// original File at export time so full-resolution pixels never sit in memory
// for longer than one export.

import { readExifDate } from './exif';

export const PREVIEW_MAX_EDGE = 2048;
export const THUMB_MAX_EDGE = 256;

export interface LoadedImage {
  id: string;
  file: File;
  name: string;
  /** Dimensions after EXIF orientation. */
  width: number;
  height: number;
  preview: ImageBitmap;
  thumb: ImageBitmap;
  /** Deterministic per-image seed for grain/noise so preview == export. */
  seed: number;
  /** Used for the date stamp `{yy}` etc. tokens: EXIF capture date, else the file's modified date. */
  date: Date;
}

export class DecodeError extends Error {
  constructor(public fileName: string, message: string) {
    super(message);
  }
}

let nextId = 1;

/** FNV-1a hash of a string to a 32-bit unsigned integer. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function fitWithin(w: number, h: number, maxEdge: number): [number, number] {
  const s = Math.min(1, maxEdge / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

function describeUndecodable(file: File): string {
  const n = file.name.toLowerCase();
  if (/\.(heic|heif)$/.test(n) || /hei[cf]/.test(file.type)) {
    return 'HEIC/HEIF images cannot be decoded by this browser. Convert to JPEG or PNG first.';
  }
  if (/\.(cr2|cr3|nef|arw|dng|raf|orf|rw2|pef|srw)$/.test(n)) {
    return 'RAW camera files are not supported. Export a JPEG/PNG/TIFF from your RAW editor first.';
  }
  if (/\.(tif|tiff)$/.test(n)) {
    return 'TIFF is not supported by most browsers. Convert to PNG or JPEG first.';
  }
  return `This browser could not decode "${file.name}"${file.type ? ` (${file.type})` : ''}. Is it a valid image?`;
}

/**
 * Decode a file with EXIF orientation applied. Optionally resize during decode
 * (the browser can do this more cheaply than drawing to a canvas).
 */
export async function decodeFile(
  file: Blob,
  resize?: { width: number; height: number },
): Promise<ImageBitmap> {
  const opts: ImageBitmapOptions = {
    imageOrientation: 'from-image',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'default',
  };
  if (resize) {
    opts.resizeWidth = resize.width;
    opts.resizeHeight = resize.height;
    opts.resizeQuality = 'high';
  }
  return createImageBitmap(file, opts);
}

export async function loadImage(file: File): Promise<LoadedImage> {
  let full: ImageBitmap;
  const exifDate = readExifDate(file);
  try {
    full = await decodeFile(file);
  } catch {
    throw new DecodeError(file.name, describeUndecodable(file));
  }
  try {
    const { width, height } = full;
    if (!width || !height) throw new DecodeError(file.name, `"${file.name}" decoded to an empty image.`);
    const [pw, ph] = fitWithin(width, height, PREVIEW_MAX_EDGE);
    const [tw, th] = fitWithin(width, height, THUMB_MAX_EDGE);
    // Resize from the already-decoded bitmap so we only decode once.
    const preview = await createImageBitmap(full, { resizeWidth: pw, resizeHeight: ph, resizeQuality: 'high' });
    const thumb = await createImageBitmap(preview, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' });
    return {
      id: `img${nextId++}`,
      file,
      name: file.name,
      width,
      height,
      preview,
      thumb,
      seed: hashString(`${file.name}:${file.size}`),
      date: (await exifDate) ?? new Date(file.lastModified || Date.now()),
    };
  } finally {
    full.close();
  }
}

export function releaseImage(img: LoadedImage): void {
  img.preview.close();
  img.thumb.close();
}
