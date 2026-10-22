import type { SectionSpec } from './controls';

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
  ],
};
