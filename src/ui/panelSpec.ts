import type { SectionSpec } from './controls';
import { paletteEditor, PALETTE_OPTIONS } from './paletteEditor';
import { lutControl } from './lutControl';

export const LIGHT: SectionSpec = {
  title: 'Light',
  open: true,
  items: [
    { kind: 'slider', path: 'adjust.exposure', label: 'Exposure (EV)', min: -3, max: 3, step: 0.01 },
    { kind: 'slider', path: 'adjust.brightness', label: 'Brightness', min: -1, max: 1, step: 0.01 },
    { kind: 'slider', path: 'adjust.contrast', label: 'Contrast', min: -1, max: 1, step: 0.01 },
    { kind: 'slider', path: 'adjust.highlights', label: 'Highlights', min: -1, max: 1, step: 0.01 },
    { kind: 'slider', path: 'adjust.shadows', label: 'Shadows', min: -1, max: 1, step: 0.01 },
    { kind: 'slider', path: 'adjust.gamma', label: 'Gamma', min: 0.2, max: 3, step: 0.01 },
    { kind: 'slider', path: 'adjust.fade', label: 'Fade (lifted blacks)', min: 0, max: 1, step: 0.01 },
    { kind: 'slider', path: 'adjust.sharpness', label: 'Sharpness', min: 0, max: 1, step: 0.01 },
  ],
};

export const COLOUR: SectionSpec = {
  title: 'Colour',
  open: true,
  items: [
    { kind: 'slider', path: 'adjust.temperature', label: 'Temperature', min: -1, max: 1, step: 0.01 },
    { kind: 'slider', path: 'adjust.tint', label: 'Tint', min: -1, max: 1, step: 0.01 },
    { kind: 'slider', path: 'adjust.hue', label: 'Hue', min: -180, max: 180, step: 1, suffix: '°' },
    { kind: 'slider', path: 'adjust.saturation', label: 'Saturation', min: -1, max: 1, step: 0.01 },
    { kind: 'slider', path: 'adjust.vibrance', label: 'Vibrance', min: -1, max: 1, step: 0.01 },
    { kind: 'custom', build: lutControl },
  ],
};

export const RETRO: SectionSpec = {
  title: 'Retro effects',
  open: true,
  items: [
    { kind: 'effect', key: 'grain', label: 'Film grain', controls: [
      { kind: 'slider', path: 'grain.amount', label: 'Amount', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', path: 'grain.size', label: 'Size', min: 0.5, max: 4, step: 0.05 },
      { kind: 'slider', path: 'grain.colour', label: 'Colour noise', min: 0, max: 1, step: 0.01 },
    ] },
    { kind: 'effect', key: 'vignette', label: 'Vignette', controls: [
      { kind: 'slider', path: 'vignette.amount', label: 'Amount (− = white)', min: -1, max: 1, step: 0.01 },
      { kind: 'slider', path: 'vignette.size', label: 'Size', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', path: 'vignette.roundness', label: 'Roundness', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', path: 'vignette.feather', label: 'Feather', min: 0, max: 1, step: 0.01 },
    ] },
    { kind: 'effect', key: 'halation', label: 'Halation / bloom', controls: [
      { kind: 'slider', path: 'halation.amount', label: 'Amount', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', path: 'halation.radius', label: 'Radius', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', path: 'halation.threshold', label: 'Threshold', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', path: 'halation.warmth', label: 'Warmth (bloom → halation)', min: 0, max: 1, step: 0.01 },
    ] },
    { kind: 'effect', key: 'chromaticAberration', label: 'Chromatic aberration', controls: [
      { kind: 'slider', path: 'chromaticAberration.amount', label: 'Amount', min: 0, max: 1, step: 0.01 },
    ] },
    { kind: 'effect', key: 'crt', label: 'CRT scanlines & curvature', controls: [
      { kind: 'slider', path: 'crt.scanlines', label: 'Scanlines', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', path: 'crt.lineCount', label: 'Lines', min: 60, max: 1200, step: 1 },
      { kind: 'slider', path: 'crt.curvature', label: 'Curvature', min: 0, max: 1, step: 0.01 },
    ] },
    { kind: 'effect', key: 'vhs', label: 'VHS', controls: [
      { kind: 'slider', path: 'vhs.noise', label: 'Noise', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', path: 'vhs.tracking', label: 'Tracking glitch', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', path: 'vhs.bleed', label: 'Colour bleed', min: 0, max: 1, step: 0.01 },
    ] },
    { kind: 'effect', key: 'lightLeak', label: 'Light leak', controls: [
      { kind: 'slider', path: 'lightLeak.amount', label: 'Amount', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', path: 'lightLeak.size', label: 'Size', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', path: 'lightLeak.angle', label: 'Direction (°)', min: 0, max: 359, step: 1 },
      { kind: 'colour', path: 'lightLeak.colour', label: 'Colour' },
    ] },
    { kind: 'effect', key: 'pixelate', label: 'Pixelate', controls: [
      { kind: 'slider', path: 'pixelate.blocks', label: 'Pixels across', min: 16, max: 512, step: 1 },
    ] },
    { kind: 'effect', key: 'posterise', label: 'Posterise', controls: [
      { kind: 'slider', path: 'posterise.levels', label: 'Levels', min: 2, max: 32, step: 1 },
    ] },
    { kind: 'effect', key: 'palette', label: 'Limited palette', controls: [
      { kind: 'select', path: 'palette.palette', label: 'Palette', options: PALETTE_OPTIONS },
      { kind: 'custom', build: paletteEditor },
      { kind: 'select', path: 'palette.dither', label: 'Dithering', options: [
        ['none', 'None'], ['bayer4', 'Bayer 4×4'], ['bayer8', 'Bayer 8×8'],
        ['floyd-steinberg', 'Floyd–Steinberg (CPU)'], ['atkinson', 'Atkinson (CPU)'],
      ] },
      { kind: 'slider', path: 'palette.ditherStrength', label: 'Dither strength', min: 0, max: 1, step: 0.01 },
    ] },
    { kind: 'effect', key: 'tone', label: 'Duotone / split toning', controls: [
      { kind: 'select', path: 'tone.mode', label: 'Mode', options: [['split', 'Split toning'], ['duotone', 'Duotone']] },
      { kind: 'colour', path: 'tone.shadowColour', label: 'Shadows' },
      { kind: 'colour', path: 'tone.highlightColour', label: 'Highlights' },
      { kind: 'slider', path: 'tone.amount', label: 'Amount', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', path: 'tone.balance', label: 'Balance', min: -1, max: 1, step: 0.01 },
    ] },
    { kind: 'effect', key: 'dateStamp', label: 'Date stamp', controls: [
      { kind: 'text', path: 'dateStamp.text', label: 'Text', hint: 'Tokens: {yy} {yyyy} {mm} {dd} {hh} {min}, from each file’s date.' },
      { kind: 'select', path: 'dateStamp.font', label: 'Font', options: [['segment', '7-segment'], ['mono', 'Monospace'], ['sans', 'Sans-serif'], ['serif', 'Serif']] },
      { kind: 'select', path: 'dateStamp.position', label: 'Position', options: [['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-right', 'Top right'], ['top-left', 'Top left']] },
      { kind: 'colour', path: 'dateStamp.colour', label: 'Colour' },
      { kind: 'slider', path: 'dateStamp.size', label: 'Size', min: 0.02, max: 0.12, step: 0.001 },
      { kind: 'slider', path: 'dateStamp.glow', label: 'Glow', min: 0, max: 1, step: 0.01 },
    ] },
    { kind: 'effect', key: 'frame', label: 'Border / frame', controls: [
      { kind: 'select', path: 'frame.style', label: 'Style', options: [['polaroid', 'Polaroid'], ['instax', 'Instax'], ['letterbox', 'Black bars (2.39:1)']] },
      { kind: 'colour', path: 'frame.colour', label: 'Border colour (Polaroid/Instax)' },
    ] },
  ],
};
