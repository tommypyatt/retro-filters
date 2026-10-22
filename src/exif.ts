// Minimal EXIF reader: finds the capture date in JPEG, PNG and WebP files
// without pulling in a full metadata library. Only the TIFF/EXIF date tags are
// parsed; everything else is skipped.

const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;

/** JPEG APP1 segments are at most 64KB, and EXIF sits near the start of the file. */
const JPEG_SCAN_BYTES = 256 * 1024;

/**
 * Capture date from the file's EXIF data, or null if there is none.
 * Prefers DateTimeOriginal, then DateTimeDigitized, then DateTime.
 * EXIF dates carry no timezone, so they are read as local time.
 */
export async function readExifDate(file: Blob): Promise<Date | null> {
  try {
    const head = new DataView(await file.slice(0, 16).arrayBuffer());
    if (head.byteLength < 12) return null;
    let tiff: DataView | null = null;
    if (head.getUint16(0) === 0xffd8) {
      tiff = findJpegTiff(new DataView(await file.slice(0, JPEG_SCAN_BYTES).arrayBuffer()));
    } else if (head.getUint32(0) === 0x89504e47) {
      tiff = findPngTiff(new DataView(await file.arrayBuffer()));
    } else if (head.getUint32(0) === 0x52494646 && head.getUint32(8) === 0x57454250) {
      tiff = findWebpTiff(new DataView(await file.arrayBuffer()));
    }
    return tiff ? readTiffDate(tiff) : null;
  } catch {
    return null;
  }
}

function findJpegTiff(v: DataView): DataView | null {
  let p = 2;
  while (p + 4 <= v.byteLength) {
    if (v.getUint8(p) !== 0xff) return null;
    const marker = v.getUint8(p + 1);
    // Start of scan / end of image: no more metadata segments.
    if (marker === 0xda || marker === 0xd9) return null;
    const len = v.getUint16(p + 2);
    // APP1 starting "Exif\0\0"
    if (marker === 0xe1 && p + 10 <= v.byteLength && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) {
      const start = p + 10;
      const end = Math.min(v.byteLength, p + 2 + len);
      return new DataView(v.buffer, v.byteOffset + start, end - start);
    }
    p += 2 + len;
  }
  return null;
}

function findPngTiff(v: DataView): DataView | null {
  let p = 8;
  while (p + 8 <= v.byteLength) {
    const len = v.getUint32(p);
    const type = v.getUint32(p + 4);
    if (type === 0x65584966) { // eXIf
      return new DataView(v.buffer, v.byteOffset + p + 8, Math.min(len, v.byteLength - p - 8));
    }
    if (type === 0x49454e44) return null; // IEND
    p += 12 + len;
  }
  return null;
}

function findWebpTiff(v: DataView): DataView | null {
  let p = 12;
  while (p + 8 <= v.byteLength) {
    const type = v.getUint32(p);
    const len = v.getUint32(p + 4, true);
    if (type === 0x45584946) { // EXIF
      let start = p + 8;
      let size = Math.min(len, v.byteLength - start);
      // Some writers keep the JPEG-style "Exif\0\0" prefix.
      if (size >= 6 && v.getUint32(start) === 0x45786966 && v.getUint16(start + 4) === 0) {
        start += 6;
        size -= 6;
      }
      return new DataView(v.buffer, v.byteOffset + start, size);
    }
    p += 8 + len + (len & 1);
  }
  return null;
}

function readTiffDate(t: DataView): Date | null {
  if (t.byteLength < 8) return null;
  const order = t.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const le = order === 0x4949;
  if (t.getUint16(2, le) !== 42) return null;

  const ifd0 = readIfd(t, t.getUint32(4, le), le);
  const exifOffset = ifd0.get(TAG_EXIF_IFD);
  const exif = exifOffset ? readIfd(t, readLong(t, exifOffset, le), le) : new Map<number, number>();

  for (const [ifd, tag] of [[exif, TAG_DATETIME_ORIGINAL], [exif, TAG_DATETIME_DIGITIZED], [ifd0, TAG_DATETIME]] as const) {
    const entry = ifd.get(tag);
    const d = entry ? parseExifDate(readAscii(t, entry, le)) : null;
    if (d) return d;
  }
  return null;
}

/** Map of tag -> offset of its 12-byte IFD entry, for the tags we care about. */
function readIfd(t: DataView, offset: number, le: boolean): Map<number, number> {
  const out = new Map<number, number>();
  if (offset + 2 > t.byteLength) return out;
  const count = t.getUint16(offset, le);
  for (let i = 0; i < count; i++) {
    const e = offset + 2 + i * 12;
    if (e + 12 > t.byteLength) break;
    const tag = t.getUint16(e, le);
    if (tag === TAG_DATETIME || tag === TAG_EXIF_IFD || tag === TAG_DATETIME_ORIGINAL || tag === TAG_DATETIME_DIGITIZED) {
      out.set(tag, e);
    }
  }
  return out;
}

function readLong(t: DataView, entry: number, le: boolean): number {
  return t.getUint32(entry + 8, le);
}

function readAscii(t: DataView, entry: number, le: boolean): string {
  if (t.getUint16(entry + 2, le) !== 2) return ''; // type ASCII
  const n = t.getUint32(entry + 4, le);
  const start = n <= 4 ? entry + 8 : t.getUint32(entry + 8, le);
  let s = '';
  for (let i = 0; i < n && start + i < t.byteLength; i++) {
    const c = t.getUint8(start + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** "YYYY:MM:DD HH:MM:SS" (some writers use '-' in the date) as local time. */
function parseExifDate(s: string): Date | null {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, sec] = m.slice(1).map(Number);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  return new Date(y, mo - 1, d, h, mi, sec);
}
