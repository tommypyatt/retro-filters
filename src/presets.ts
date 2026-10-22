import { defaultRecipe, normaliseRecipe, type Recipe } from './recipe';

export interface Preset {
  id: string;
  name: string;
  recipe: Recipe;
  builtIn?: boolean;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object | null ? DeepPartial<NonNullable<T[K]>> : T[K] };

/** Built-in presets are written as patches over the default recipe. */
function make(name: string, patch: DeepPartial<Recipe>): Preset {
  const r = defaultRecipe() as unknown as Record<string, Record<string, unknown>>;
  for (const [k, v] of Object.entries(patch)) Object.assign(r[k], v);
  return { id: `builtin:${name}`, name, recipe: normaliseRecipe(r), builtIn: true };
}

export const BUILT_IN_PRESETS: Preset[] = [
  make('Kodachrome', {
    adjust: { contrast: 0.3, saturation: 0.2, vibrance: 0.2, temperature: 0.12, highlights: -0.2, shadows: -0.1 },
    tone: { enabled: true, mode: 'split', shadowColour: '#24476b', highlightColour: '#f2c48d', amount: 0.25, balance: 0 },
    grain: { enabled: true, amount: 0.18, size: 1, colour: 0.1 },
    vignette: { enabled: true, amount: 0.25, size: 0.6, roundness: 0.5, feather: 0.7 },
    halation: { enabled: true, amount: 0.15, radius: 0.3, threshold: 0.8, warmth: 0.8 },
  }),
  make('Faded Polaroid', {
    adjust: { fade: 0.45, contrast: -0.15, saturation: -0.25, temperature: 0.18, tint: 0.08, highlights: -0.2 },
    tone: { enabled: true, mode: 'split', shadowColour: '#2f6b6b', highlightColour: '#f5d29a', amount: 0.35, balance: 0.1 },
    grain: { enabled: true, amount: 0.25, size: 1.3, colour: 0.2 },
    vignette: { enabled: true, amount: 0.3, size: 0.55, roundness: 0.4, feather: 0.8 },
    lightLeak: { enabled: true, amount: 0.25, colour: '#ff7a3d', angle: 300, size: 0.45 },
    frame: { enabled: true, style: 'polaroid', colour: '#f4f1ea' },
  }),
  make('70s Warm', {
    adjust: { temperature: 0.5, tint: 0.1, fade: 0.25, saturation: -0.1, contrast: 0.1, shadows: 0.1 },
    tone: { enabled: true, mode: 'split', shadowColour: '#5a3a1a', highlightColour: '#ffb35c', amount: 0.4, balance: 0 },
    grain: { enabled: true, amount: 0.35, size: 1.6, colour: 0.25 },
    vignette: { enabled: true, amount: 0.35, size: 0.5, roundness: 0.6, feather: 0.7 },
    halation: { enabled: true, amount: 0.3, radius: 0.4, threshold: 0.7, warmth: 0.9 },
    lightLeak: { enabled: true, amount: 0.35, colour: '#ff6a2a', angle: 20, size: 0.5 },
    dateStamp: { enabled: true },
  }),
  make('VHS', {
    adjust: { saturation: 0.25, contrast: 0.1, sharpness: 0.3, brightness: 0.05 },
    vhs: { enabled: true, noise: 0.4, tracking: 0.5, bleed: 0.6 },
    chromaticAberration: { enabled: true, amount: 0.35 },
    crt: { enabled: true, scanlines: 0.25, lineCount: 480, curvature: 0 },
    dateStamp: { enabled: true, text: 'PLAY  {mm}.{dd}.{yy}', font: 'mono', colour: '#ffffff', position: 'bottom-left', size: 0.05, glow: 0.3 },
  }),
  make('Game Boy', {
    adjust: { contrast: 0.2, brightness: 0.1 },
    pixelate: { enabled: true, blocks: 160 },
    palette: { enabled: true, palette: 'gameboy', dither: 'bayer4', ditherStrength: 0.6 },
  }),
  make('CRT Arcade', {
    adjust: { saturation: 0.35, contrast: 0.2 },
    pixelate: { enabled: true, blocks: 320 },
    crt: { enabled: true, scanlines: 0.6, lineCount: 240, curvature: 0.45 },
    halation: { enabled: true, amount: 0.45, radius: 0.25, threshold: 0.55, warmth: 0.1 },
    chromaticAberration: { enabled: true, amount: 0.2 },
    vignette: { enabled: true, amount: 0.25, size: 0.6, roundness: 0.3, feather: 0.6 },
  }),
  make('Cross-process', {
    adjust: { contrast: 0.35, saturation: 0.25, vibrance: 0.3, tint: -0.2, temperature: 0.1, highlights: 0.1 },
    tone: { enabled: true, mode: 'split', shadowColour: '#204a9a', highlightColour: '#e8f060', amount: 0.5, balance: -0.1 },
    vignette: { enabled: true, amount: 0.3, size: 0.5, roundness: 0.5, feather: 0.6 },
    grain: { enabled: true, amount: 0.15, size: 1, colour: 0.2 },
  }),
  make('Noir Grain', {
    adjust: { saturation: -1, contrast: 0.45, shadows: -0.1, highlights: 0.1, fade: 0.08 },
    grain: { enabled: true, amount: 0.55, size: 1.8, colour: 0 },
    vignette: { enabled: true, amount: 0.5, size: 0.45, roundness: 0.6, feather: 0.7 },
    halation: { enabled: true, amount: 0.2, radius: 0.3, threshold: 0.75, warmth: 0 },
  }),
];

// ---------------------------------------------------------------- storage

const STORAGE_KEY = 'retro-filters.presets.v1';
export const PRESET_FILE_FORMAT = 'retro-filters-presets';

export function loadCustomPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return parsePresetList(JSON.parse(raw));
  } catch (err) {
    console.warn('Could not read saved presets', err);
    return [];
  }
}

/** Persist custom presets. Throws a readable error if storage is full or blocked. */
export function saveCustomPresets(presets: Preset[]): void {
  const data = presets.map(({ id, name, recipe }) => ({ id, name, recipe }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    const quota = err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22);
    throw new Error(quota
      ? 'Browser storage is full, so presets could not be saved. Large LUTs take a lot of space: export presets to a file or delete some.'
      : `Presets could not be saved to browser storage (${err instanceof Error ? err.message : String(err)}).`);
  }
}

export function newPresetId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Serialise presets for download. */
export function presetsToJson(presets: Preset[]): string {
  return JSON.stringify({
    format: PRESET_FILE_FORMAT,
    version: 1,
    presets: presets.map(({ name, recipe }) => ({ name, recipe })),
  }, null, 2);
}

/**
 * Parse an imported file. Accepts the preset file format, a bare array of
 * {name, recipe}, a single {name, recipe}, or a bare recipe.
 */
export function parsePresetFile(text: string, fallbackName: string): Preset[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const list = parsePresetList(data, fallbackName);
  if (!list.length) throw new Error('No presets found in this file.');
  return list;
}

function parsePresetList(data: unknown, fallbackName = 'Imported'): Preset[] {
  const obj = data as Record<string, unknown> | null;
  let items: unknown[];
  if (Array.isArray(data)) items = data;
  else if (obj && Array.isArray(obj.presets)) items = obj.presets;
  else if (obj && typeof obj === 'object' && 'recipe' in obj) items = [obj];
  else if (obj && typeof obj === 'object' && ('adjust' in obj || 'version' in obj)) items = [{ name: fallbackName, recipe: obj }];
  else items = [];
  return items
    .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object' && 'recipe' in it)
    .map((it) => ({
      id: typeof it.id === 'string' ? it.id : newPresetId(),
      name: typeof it.name === 'string' && it.name.trim() ? it.name.trim().slice(0, 60) : fallbackName,
      recipe: normaliseRecipe(it.recipe),
    }));
}
