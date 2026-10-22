# Retro Filter

Apply retro film, video and 8-bit looks to batches of photos, entirely in the browser. Images never leave your machine: there is no server, and the app makes no network requests after it has loaded, so it also works offline.

**Live at [retrofilter.pyatt.me](https://retrofilter.pyatt.me/)**, deployed automatically from `main` via GitHub Pages.

- **GPU rendering** with WebGL2. The preview re-renders as you drag a slider, and export runs the same shader code at full resolution.
- **Adjustments:** exposure, brightness, contrast, saturation, vibrance, highlights, shadows, temperature, tint, hue, gamma, fade and sharpness.
- **Retro effects:** film grain, vignette, halation/bloom, chromatic aberration, CRT scanlines and curvature, VHS noise/tracking/colour bleed, light leaks, pixelate, posterise, limited palettes (Game Boy, CGA, EGA, NES, custom) with Bayer, Floyd–Steinberg or Atkinson dithering, duotone/split toning, a 7-segment date stamp, and Polaroid/Instax/letterbox frames.
- **Presets:** eight built-in presets, plus your own (saved in the browser, with JSON import/export). `.cube` 3D LUTs are also supported.
- **Batch editing:** settings apply to every image, and any image can have its own override.
- **Export:** PNG, JPEG or WebP at original size or a maximum long edge, rendered in a Web Worker. One image downloads directly; a batch downloads as a ZIP.

## Running locally

Requires Node.js 20.19+ or 22.12+ (CI uses 22).

```sh
npm install
npm run dev        # dev server at http://localhost:5173
```

## Building

```sh
npm run build      # type-checks, then writes the static site to dist/
npm run preview    # serves dist/ locally for testing the production build
```

## Using the app

| Action | How |
| --- | --- |
| Add images | **Add images…**, or drag and drop anywhere |
| Select an image | Click its thumbnail |
| Previous / next image | <kbd>←</kbd> / <kbd>→</kbd> (or <kbd>,</kbd> / <kbd>.</kbd>) when no form field has focus |
| Compare with the original | Hold **Hold to compare**, or hold <kbd>C</kbd> |
| Before/after split | **Split view** or <kbd>S</kbd>, then drag the handle (or focus it and use the arrow keys) |
| Reset a slider | Double-click it or its label, or focus it and press <kbd>Delete</kbd> |
| Tick images for “Apply to selected” | The tick box on each thumbnail, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>-click, or **Tick all** |

**Batch behaviour.** The switch at the top of the panel chooses what the controls edit:

- **All images** edits the global recipe, which every image uses unless it has an override.
- **This image only** gives the selected image its own copy of the settings, and its thumbnail is badged **EDITED**. **Reset to global** removes the override.
- **Apply to all** makes the settings shown the global recipe and clears every override.
- **Apply to selected** copies the settings shown onto the ticked images as overrides.

Applying a preset follows the same switch: it changes all images unless you are editing one image only.

## Architecture

```
src/
  recipe.ts            Recipe type, defaults, validation (no DOM, no WebGL)
  render/
    pipeline.ts        renderRecipe(backend, image, recipe) → 2D canvas; Backend interface
    glRenderer.ts      WebGL2 backend (HTMLCanvasElement or OffscreenCanvas)
    shaders.ts         All GLSL; documents the order of operations and colour handling
    cpuRenderer.ts     Canvas 2D fallback backend (subset of effects)
    dither.ts          CPU error diffusion (Floyd–Steinberg, Atkinson)
    overlays.ts        Frames, letterbox bars, 7-segment date stamp
    palettes.ts, lut.ts
  export/              Worker, exporter (worker or main-thread fallback), filenames
  ui/                  Panel, controls, preview, thumbnails, presets, export UI
  state.ts             Global recipe and per-image overrides
  presets.ts           Built-in presets, localStorage, JSON import/export
```

The **recipe** is the contract between the UI and the renderers. The renderer takes `(image, recipe, { seed, date })` and returns pixels, and nothing in `recipe.ts` depends on the DOM or WebGL, so a different renderer could implement the same schema.

Preview, thumbnails and export all call the same `renderRecipe()`. That runs the GPU pass in tiles of up to 2048 px, then the optional CPU dithering pass, then the 2D overlays.

## Recipe schema (version 1)

A recipe is plain JSON. Every key is required in memory, but imports are normalised: missing keys take their defaults, unknown keys are dropped, and values are clamped to their ranges. Each effect has an `enabled` flag, and a disabled effect is skipped entirely.

Spatial values are **relative to the image** (fractions of the long or short edge, lines per image height, blocks across the long edge), so a 900 px preview and a 50 MP export look the same.

### `adjust`

| Key | Range | Default | Notes |
| --- | --- | --- | --- |
| `exposure` | −3…3 | 0 | EV stops, multiplied in linear light |
| `brightness` | −1…1 | 0 | Midtone curve with black and white fixed |
| `contrast` | −1…1 | 0 | S-curve around mid grey (+), compression (−) |
| `saturation` | −1…1 | 0 | −1 gives greyscale |
| `vibrance` | −1…1 | 0 | Mostly affects muted colours |
| `highlights` | −1…1 | 0 | Luminance-masked, peaks around ⅔ |
| `shadows` | −1…1 | 0 | Luminance-masked, peaks around ⅓ |
| `temperature` | −1…1 | 0 | Cool ↔ warm white-balance gains, in linear light |
| `tint` | −1…1 | 0 | Green ↔ magenta, in linear light |
| `hue` | −180…180 | 0 | Degrees. Positive turns red towards yellow |
| `gamma` | 0.2…3 | 1 | Applied as `x^(1/gamma)`, so values above 1 brighten |
| `fade` | 0…1 | 0 | Lifted blacks and slightly lowered whites |
| `sharpness` | 0…1 | 0 | Unsharp mask with a 1.2 px radius at a 1000 px long edge |

### Effects

| Key | Fields (range, default) |
| --- | --- |
| `grain` | `amount` 0…1 (0.35), `size` 0.5…4 (1.2; grain cell in px at a 1000 px long edge), `colour` 0…1 (0.15; mono → colour grain) |
| `vignette` | `amount` −1…1 (0.4; negative is a white vignette), `size` 0…1 (0.5), `roundness` 0…1 (0.6; 0 follows the frame shape, 1 is circular), `feather` 0…1 (0.6) |
| `halation` | `amount` 0…1 (0.4), `radius` 0…1 (0.35; 0.5–8 % of the long edge), `threshold` 0…1 (0.7; sRGB brightness), `warmth` 0…1 (0.7; 0 is neutral bloom, 1 is red film halation) |
| `chromaticAberration` | `amount` 0…1 (0.3; radial, up to about 1 % of the frame at the corners) |
| `crt` | `scanlines` 0…1 (0.5; darkness), `lineCount` 60…1200 (240; per image height), `curvature` 0…1 (0.3) |
| `vhs` | `noise` 0…1 (0.3), `tracking` 0…1 (0.3), `bleed` 0…1 (0.4; horizontal chroma smear) |
| `lightLeak` | `amount` 0…1 (0.5), `colour` hex (`#ff6a2a`), `angle` 0…360 (20; edge the light enters from: 0 is right, 90 is bottom), `size` 0…1 (0.5) |
| `pixelate` | `blocks` 16…512 (160; pixel blocks across the long edge) |
| `posterise` | `levels` 2…32 (6; per channel) |
| `palette` | `palette` `gameboy`, `cga`, `ega`, `nes` or `custom`; `custom` array of 2–32 hex colours; `dither` `none`, `bayer4`, `bayer8`, `floyd-steinberg` or `atkinson`; `ditherStrength` 0…1 (0.6) |
| `tone` | `mode` `split` or `duotone`; `shadowColour`, `highlightColour` hex; `amount` 0…1 (0.4); `balance` −1…1 (0) |
| `dateStamp` | `text` (≤64 chars; tokens `{yy}` `{yyyy}` `{mm}` `{dd}` `{hh}` `{min}`, default `'{yy} {mm} {dd}`); `font` `segment`, `mono`, `sans` or `serif`; `colour` hex (`#ff8a1e`); `position` `bottom-right`, `bottom-left`, `top-right` or `top-left`; `size` 0.02…0.12 (character height as a fraction of the short edge); `glow` 0…1 |
| `frame` | `style` `polaroid`, `instax` or `letterbox` (2.39:1 black bars); `colour` hex (border colour for Polaroid/Instax) |
| `lut` | `null`, or `{ enabled, name, size, data, intensity }`. `size` is N for an N×N×N cube (2…65). `data` is base64 of little-endian `Uint16` RGB triples (value × 65535), red fastest, in `.cube` order. `intensity` is 0…1 |

There is also a top-level `version: 1`.

### Example

The example below is shortened, and keys left out take their defaults when imported.

```json
{
  "version": 1,
  "adjust": { "exposure": 0, "contrast": 0.2, "saturation": 0, "gamma": 1, "fade": 0.1 },
  "grain": { "enabled": true, "amount": 0.3, "size": 1.4, "colour": 0.1 },
  "pixelate": { "enabled": true, "blocks": 160 },
  "palette": { "enabled": true, "palette": "gameboy", "custom": [], "dither": "bayer4", "ditherStrength": 0.6 },
  "dateStamp": { "enabled": true, "text": "'{yy} {mm} {dd}", "font": "segment", "colour": "#ff8a1e", "position": "bottom-right", "size": 0.045, "glow": 0.5 },
  "lut": null
}
```

### Render context

The context is not part of the look, so it is not stored in the recipe:

- `seed`: a 32-bit integer for grain and noise, derived from the file name and size. It is fixed per image, so preview and export are deterministic and match.
- `date`: used by the date-stamp tokens. It is the file's last-modified time.

### Order of operations and colour handling

1. **Geometry:** CRT barrel warp, then VHS line jitter and tracking band.
2. **Sampling:** pixelate (each block is a box-filtered average of the source), chromatic aberration, VHS chroma bleed, sharpening.
3. **Linear light:** exposure, white balance, halation/bloom. These model physical light, so they act on linear values. Source and intermediate textures are `SRGB8_ALPHA8`, so sampling, mipmaps and blurs also average in linear light.
4. **sRGB-encoded (perceptual):** shadows/highlights, brightness, contrast, gamma, hue, saturation, vibrance, LUT, toning, fade, posterise, light leak, vignette, grain, scanlines, VHS noise, palette. These controls are perceptual by nature, `.cube` LUTs expect display-referred sRGB input, and retro palettes are defined in sRGB.
5. **CPU pass:** Floyd–Steinberg or Atkinson dithering, if selected.
6. **Overlays:** frame, letterbox bars, date stamp.

Halation is computed in a buffer with a fixed 384 px long edge, so it does not depend on output size. Palettes and dithering work on a grid of blocks: the pixelate blocks if Pixelate is on, otherwise a 640-cell grid across the long edge. This keeps dither patterns the same at any output size.

### Preset files

Exported presets look like this:

```json
{ "format": "retro-filters-presets", "version": 1, "presets": [ { "name": "My look", "recipe": { … } } ] }
```

Import also accepts a bare array of `{ name, recipe }`, a single `{ name, recipe }`, or a bare recipe.

## Known limitations

- **HEIC/HEIF and camera RAW files are not supported** (nor TIFF in most browsers). The app only decodes what the browser can decode, and shows an error naming any file it can't read. Convert those files to JPEG or PNG first.
- **Metadata is not kept in exports.** Browser encoders drop EXIF. Orientation is applied to the pixels, so exported images still display the right way up.
- **The date stamp uses the file's modification date**, not the EXIF capture date.
- **GPU texture limit:** images larger than the GPU's `MAX_TEXTURE_SIZE` (often 16384 px, sometimes 8192) are downscaled to fit on export, and a warning names the files affected. Very large exports need a lot of memory, so images are processed one at a time and everything is released between them.
- **Preview vs export at different resolutions:** every parameter is relative to the image, and at the same resolution the two are pixel-identical. Detail finer than the preview's pixels can't be shown in it, though. Very fine grain and dense scanlines show as their average in the preview, and block edges or error-diffusion choices can differ slightly.
- **Error-diffusion dithering runs on the CPU**, so it is slower than the other effects on very large images.
- **Without WebGL2**, a Canvas 2D fallback is used and a warning is shown. It covers the adjustments and simple effects. Sharpening, halation, chromatic aberration, CRT curvature, VHS, light leaks and LUTs are skipped, and grain uses a different noise pattern.
- **Export worker:** when the browser can't run WebGL2 in an `OffscreenCanvas` worker (some older Safari versions), export falls back to the main thread. The output is the same, but the page is less responsive during the export.
- **Colour:** the pipeline is 8-bit sRGB. Wide-gamut images are converted to sRGB by the browser when decoded.
- **LUTs** must be 3D `.cube` files with a 0…1 domain and at most 65³ entries. LUT data is stored inside presets, and large LUTs can fill the browser's storage quota for saved presets. Export those presets to a file instead.
- **Downloads:** some browsers ask for permission the first time a page downloads more than one file.
