import type { LutSpec } from '../recipe';

// .cube 3D LUT support. LUTs are stored inside the recipe (so presets are
// self-contained) as base64 of little-endian Uint16 values, which is ~3x
// smaller than JSON numbers and keeps 16-bit precision.

export const MAX_LUT_SIZE = 65;

export class LutError extends Error {}

/** Parse the text of a .cube file into a LutSpec (enabled, intensity 1). */
export function parseCube(text: string, name: string): LutSpec {
  let size = 0;
  let title = '';
  const values: number[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    if (/^[A-Za-z_]/.test(line)) {
      const [kw, ...rest] = line.split(/\s+/);
      switch (kw.toUpperCase()) {
        case 'TITLE': title = line.slice(5).trim().replace(/^"|"$/g, ''); break;
        case 'LUT_3D_SIZE': size = parseInt(rest[0], 10); break;
        case 'LUT_1D_SIZE': throw new LutError('1D LUTs are not supported; please use a 3D .cube LUT.');
        case 'DOMAIN_MIN':
          if (rest.map(Number).some((v) => v !== 0)) throw new LutError('Only LUTs with DOMAIN_MIN 0 0 0 are supported.');
          break;
        case 'DOMAIN_MAX':
          if (rest.map(Number).some((v) => v !== 1)) throw new LutError('Only LUTs with DOMAIN_MAX 1 1 1 are supported.');
          break;
        case 'LUT_3D_INPUT_RANGE':
          if (Number(rest[0]) !== 0 || Number(rest[1]) !== 1) throw new LutError('Only LUTs with input range 0..1 are supported.');
          break;
        default: break; // ignore unknown keywords
      }
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 3) throw new LutError(`Malformed data on line ${i + 1}.`);
    for (let k = 0; k < 3; k++) {
      const v = Number(parts[k]);
      if (!Number.isFinite(v)) throw new LutError(`Invalid number on line ${i + 1}.`);
      values.push(v);
    }
  }
  if (!size) throw new LutError('Missing LUT_3D_SIZE: is this a 3D .cube file?');
  if (size < 2 || size > MAX_LUT_SIZE) throw new LutError(`LUT size ${size} is outside the supported range 2..${MAX_LUT_SIZE}.`);
  const expected = size * size * size * 3;
  if (values.length !== expected) throw new LutError(`Expected ${expected / 3} entries for a ${size}³ LUT but found ${values.length / 3}.`);
  return { enabled: true, name: title || name.replace(/\.cube$/i, ''), size, data: encodeLutData(values), intensity: 1 };
}

export function encodeLutData(values: ArrayLike<number>): string {
  const u16 = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) u16[i] = Math.round(Math.min(1, Math.max(0, values[i])) * 65535);
  const bytes = new Uint8Array(u16.length * 2);
  for (let i = 0; i < u16.length; i++) {
    bytes[i * 2] = u16[i] & 255;
    bytes[i * 2 + 1] = u16[i] >> 8;
  }
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** Decode a LutSpec's data to 0..1 floats (RGB, red fastest), or null if invalid. */
export function decodeLut(lut: LutSpec): Float32Array | null {
  try {
    const bin = atob(lut.data);
    const n = lut.size * lut.size * lut.size * 3;
    if (bin.length !== n * 2) return null;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) / 65535;
    return out;
  } catch {
    return null;
  }
}
