// GLSL for the recipe pipeline. Preview and export run exactly this code; the
// only difference is output resolution, and every spatial parameter is
// expressed relative to the image so the result is resolution independent.
//
// Colour handling:
// - Source and intermediate textures are SRGB8_ALPHA8, so texture() returns
//   *linear* light and hardware filtering/mipmaps average in linear (correct
//   for downscaling, pixelate block averages and blurs).
// - Physically based operations run in linear light: exposure (a multiply in
//   light units), white balance (per-channel gains), sharpening and
//   bloom/halation (light adds, computed from a linear bright-pass).
// - Tonal and "look" operations (contrast, shadows/highlights, brightness,
//   gamma, saturation, hue, LUTs, toning, fade, grain, vignette, palettes...)
//   run on sRGB-encoded values: their parameters are perceptual, .cube LUTs
//   are authored for display-referred sRGB input, and retro palettes are
//   defined in sRGB.
//
// Pass order (final pass):
//   geometry (CRT warp, VHS tracking) -> sample (pixelate grid, chromatic
//   aberration, VHS chroma bleed) -> sharpen -> [linear] exposure, white
//   balance, halation -> [sRGB] tone, colour, LUT, toning, fade, posterise,
//   light leak, vignette, grain, scanlines, VHS noise, palette -> CRT mask.

export const VERT = /* glsl */ `#version 300 es
// Full-screen triangle generated from gl_VertexID; no vertex buffers needed.
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const COMMON = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// PCG hash: deterministic integer noise so a given (seed, position) always
// produces the same value on every GPU. Avoids sin()-based hashes, which vary
// between drivers and precisions.
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float hash2(ivec2 p, uint seed) {
  return float(pcg(uint(p.x) * 1973u + pcg(uint(p.y) * 9277u + seed))) / 4294967295.0;
}
float hash1(int x, uint seed) {
  return float(pcg(uint(x) * 26699u + seed)) / 4294967295.0;
}
// Smooth value noise in [0,1].
float vnoise(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 ii = ivec2(i);
  float a = hash2(ii, seed), b = hash2(ii + ivec2(1, 0), seed);
  float c = hash2(ii + ivec2(0, 1), seed), d = hash2(ii + ivec2(1, 1), seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

/** Bloom bright-pass: downsample the source into a small fixed-size buffer. */
export const BRIGHT_FRAG = COMMON + /* glsl */ `
uniform sampler2D u_src;
uniform vec2 u_size;
uniform float u_lod;
uniform vec3 u_gain;        // exposure x white balance, linear
uniform float u_threshold;  // linear-light luminance threshold
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  // 4 taps around the pixel at the matching mip level for a smooth downsample.
  vec2 o = 0.5 / u_size;
  vec3 c = (textureLod(u_src, uv + vec2(-o.x, -o.y), u_lod).rgb + textureLod(u_src, uv + vec2(o.x, -o.y), u_lod).rgb
          + textureLod(u_src, uv + vec2(-o.x, o.y), u_lod).rgb + textureLod(u_src, uv + vec2(o.x, o.y), u_lod).rgb) * 0.25;
  c *= u_gain;
  float l = luma(c);
  // Soft threshold: only the part of the light above the threshold glows.
  float k = max(l - u_threshold, 0.0) / max(l, 1e-4);
  outColor = vec4(min(c * k, vec3(1.0)), 1.0);
}
`;

/** Separable Gaussian blur, sigma in buffer pixels. */
export const BLUR_FRAG = COMMON + /* glsl */ `
uniform sampler2D u_tex;
uniform vec2 u_size;
uniform vec2 u_dir;
uniform float u_sigma;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  float stepPx = max(1.0, u_sigma / 6.0);
  int n = int(ceil(3.0 * u_sigma / stepPx));
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -24; i <= 24; i++) {
    if (i < -n || i > n) continue;
    float x = float(i) * stepPx;
    float w = exp(-x * x / (2.0 * u_sigma * u_sigma));
    acc += texture(u_tex, uv + u_dir * x / u_size).rgb * w;
    wsum += w;
  }
  outColor = vec4(acc / wsum, 1.0);
}
`;

export const FINAL_FRAG = COMMON + /* glsl */ `
uniform sampler2D u_src;
uniform sampler2D u_bloom;
uniform sampler3D u_lut;
uniform vec2 u_outSize;     // output size in px
uniform vec2 u_srcSize;     // source texture size in px
uniform float u_flipY;      // 1 when drawing to the default framebuffer
uniform uint u_seed;

// Adjustments
uniform float u_exposure, u_brightness, u_contrast, u_saturation, u_vibrance;
uniform float u_highlights, u_shadows, u_temperature, u_tint, u_hue, u_gamma, u_fade, u_sharpness;

// Effects (amounts are 0 when the effect is disabled)
uniform vec2 u_grid;        // pixelate/palette block grid (cols, rows); 0 = off
uniform float u_gridLod;    // mip level matching one block of the source
uniform float u_ca;
uniform float u_crtCurv, u_scan, u_lines;
uniform float u_vhsNoise, u_vhsTrack, u_vhsBleed;
uniform float u_halAmt;
uniform vec3 u_halTint;
uniform float u_lutAmt, u_lutSize;
uniform int u_toneMode;     // 0 off, 1 duotone, 2 split toning
uniform vec3 u_toneShadow, u_toneHigh;
uniform float u_toneAmt, u_toneBal;
uniform float u_posterise;  // levels, 0 = off
uniform float u_leakAmt, u_leakSize;
uniform vec3 u_leakCol;
uniform vec2 u_leakDir;
uniform float u_vigAmt, u_vigSize, u_vigRound, u_vigFeather;
uniform float u_grainAmt, u_grainSize, u_grainColour;
uniform int u_palCount;     // 0 = off (or deferred to the CPU error-diffusion pass)
uniform vec3 u_pal[64];
uniform int u_dither;       // 0 none, 1 Bayer 4x4, 2 Bayer 8x8
uniform float u_ditherAmt;

out vec4 outColor;

// ---------------------------------------------------------------- geometry

// Barrel distortion with fixed edge midpoints; corners fall outside and are
// masked with rounded corners like a CRT bezel.
vec2 crtWarp(vec2 uv, out float mask) {
  mask = 1.0;
  if (u_crtCurv <= 0.0) return uv;
  vec2 c = uv * 2.0 - 1.0;
  float k = u_crtCurv * 0.2;
  vec2 w = c * (1.0 + k * dot(c, c)) / (1.0 + k);
  float r = 0.02 + 0.08 * u_crtCurv;
  float dist = length(max(abs(w) - (1.0 - r), 0.0)) - r;
  mask = 1.0 - smoothstep(-0.008, 0.0, dist);
  return w * 0.5 + 0.5;
}

// Tracking-error band: position fixed per image (seeded), 0..1 weight.
float trackingBand(vec2 uv) {
  float bandY = 0.15 + 0.7 * hash1(7, u_seed);
  float bandH = 0.03 + 0.07 * u_vhsTrack;
  return smoothstep(bandY - bandH, bandY, uv.y) * (1.0 - smoothstep(bandY, bandY + bandH * 0.35, uv.y));
}

// VHS line jitter, a displaced tracking band and head-switching noise at the
// bottom. 480 "lines" per image height regardless of resolution.
vec2 vhsWarp(vec2 uv) {
  if (u_vhsTrack <= 0.0 && u_vhsNoise <= 0.0) return uv;
  int line = int(floor(uv.y * 480.0));
  float jitter = (hash1(line, u_seed ^ 0x9e37u) - 0.5) * 0.003 * (u_vhsTrack + 0.4 * u_vhsNoise);
  float wave = sin(uv.y * 90.0 + hash1(3, u_seed) * 6.2831);
  float shift = trackingBand(uv) * u_vhsTrack * (0.035 + 0.015 * wave);
  float bottom = smoothstep(0.96, 1.0, uv.y) * u_vhsTrack * 0.05 * (0.5 + hash1(line, u_seed ^ 0x51u));
  uv.x += jitter + shift + bottom;
  return uv;
}

// --------------------------------------------------------------- sampling

vec2 snapToGrid(vec2 uv) {
  return u_grid.x > 0.0 ? (floor(uv * u_grid) + 0.5) / u_grid : uv;
}

// Linear-light source sample. With a block grid, each block is the average
// of a 4x4 set of taps spread over the block, each tap read from the mip
// level covering a quarter block, so a block is a true box filter of the
// source under it and colours don't bleed into neighbouring blocks.
vec4 src(vec2 uv) {
  if (u_grid.x <= 0.0) return texture(u_src, uv);
  vec2 origin = floor(uv * u_grid) / u_grid;
  vec2 cellSize = 1.0 / u_grid;
  vec4 acc = vec4(0.0);
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      acc += textureLod(u_src, origin + (vec2(x, y) + 0.5) * 0.25 * cellSize, u_gridLod);
    }
  }
  return acc / 16.0;
}

vec4 sampleImage(vec2 uv) {
  vec4 c = src(uv);
  if (u_ca > 0.0) {
    // Radial lateral chromatic aberration: red scaled out, blue scaled in.
    vec2 off = (uv - 0.5) * u_ca * 0.02;
    c.r = src(uv + off).r;
    c.b = src(uv - off).b;
  }
  if (u_vhsBleed > 0.0) {
    // VHS chroma bleed: luminance stays sharp, colour smears to the right.
    vec3 acc = vec3(0.0);
    float ws = 0.0;
    for (int i = 1; i <= 6; i++) {
      float w = 1.0 - float(i) / 7.0;
      acc += src(uv - vec2(float(i) * u_vhsBleed * 0.0035, 0.0)).rgb * w;
      ws += w;
    }
    vec3 smear = acc / ws;
    float L = luma(c.rgb);
    vec3 chroma = mix(c.rgb - L, smear - luma(smear), min(1.0, u_vhsBleed * 1.5));
    c.rgb = max(L + chroma, 0.0);
  }
  return c;
}

// Unsharp mask in linear light: 8 taps on a ring whose radius is a fixed
// fraction of the image (1.2px at a 1000px long edge).
vec3 sharpen(vec2 uv, vec3 c) {
  if (u_sharpness <= 0.0 || u_grid.x > 0.0) return c;
  float longEdge = max(u_outSize.x, u_outSize.y);
  vec2 d = vec2(max(1.0, longEdge * 0.0012)) / u_outSize;
  vec3 blur = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    blur += texture(u_src, uv + d * vec2(cos(a), sin(a))).rgb;
  }
  blur /= 8.0;
  return max(c + (c - blur) * u_sharpness * 1.5, 0.0);
}

// ------------------------------------------------------- linear-light ops

// Approximate white balance gains. Normalised so luminance stays constant.
vec3 whiteBalance(vec3 c) {
  vec3 g = vec3(1.0 + 0.30 * u_temperature, 1.0, 1.0 - 0.30 * u_temperature);
  g *= vec3(1.0 + 0.12 * u_tint, 1.0 - 0.18 * u_tint, 1.0 + 0.12 * u_tint);
  return c * g / luma(g);
}

// ---------------------------------------------------------- perceptual ops

vec3 hueRotate(vec3 c, float deg) {
  // Rotate chroma in YIQ space.
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * c;
  float a = radians(-deg); // positive = red towards yellow, like common editors
  float ca = cos(a), sa = sin(a);
  yiq.yz = vec2(yiq.y * ca - yiq.z * sa, yiq.y * sa + yiq.z * ca);
  return toRGB * yiq;
}

// Endpoints (0 and 1) are preserved wherever possible so the controls shape
// tones rather than clip them.
vec3 tone(vec3 s) {
  // Shadows / highlights: luminance-masked lifts that peak around 1/3 and 2/3.
  float L = luma(s);
  float sh = u_shadows * 1.6 * L * (1.0 - L) * (1.0 - L);
  float hi = u_highlights * 1.6 * L * L * (1.0 - L);
  s = clamp(s + sh + hi, 0.0, 1.0);

  // Brightness: bends midtones with fixed endpoints.
  if (u_brightness > 0.0) s = 1.0 - pow(1.0 - s, vec3(1.0 + 1.5 * u_brightness));
  else if (u_brightness < 0.0) s = pow(s, vec3(1.0 - 1.5 * u_brightness));

  // Contrast: power S-curve around mid grey for positive values, linear
  // compression towards mid grey for negative values.
  if (u_contrast > 0.0) {
    float p = exp2(u_contrast * 1.3);
    vec3 lo = 0.5 * pow(2.0 * s, vec3(p));
    vec3 hiC = 1.0 - 0.5 * pow(2.0 * (1.0 - s), vec3(p));
    s = mix(lo, hiC, step(0.5, s));
  } else if (u_contrast < 0.0) {
    s = 0.5 + (s - 0.5) * (1.0 + 0.7 * u_contrast);
  }
  return pow(clamp(s, 0.0, 1.0), vec3(1.0 / u_gamma));
}

vec3 colour(vec3 s) {
  if (u_hue != 0.0) s = hueRotate(s, u_hue);
  float L = luma(s);
  s = mix(vec3(L), s, 1.0 + u_saturation);
  if (u_vibrance != 0.0) {
    float sat = max(s.r, max(s.g, s.b)) - min(s.r, min(s.g, s.b));
    s = mix(vec3(L), s, 1.0 + u_vibrance * (1.0 - sat) * 1.2);
  }
  return clamp(s, 0.0, 1.0);
}

vec3 applyLut(vec3 s) {
  if (u_lutAmt <= 0.0) return s;
  // Sample texel centres: scale into [0.5/N, 1 - 0.5/N].
  vec3 coord = s * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize;
  return mix(s, texture(u_lut, coord).rgb, u_lutAmt);
}

vec3 toning(vec3 s) {
  if (u_toneMode == 0) return s;
  float L = luma(s);
  if (u_toneMode == 1) {
    // Duotone: map luminance onto a shadow->highlight gradient.
    float t = clamp(pow(L, exp2(-u_toneBal)), 0.0, 1.0);
    return mix(s, mix(u_toneShadow, u_toneHigh, t), u_toneAmt);
  }
  // Split toning: add each colour's chroma (not its brightness) to its range.
  float pivot = 0.5 + 0.35 * u_toneBal;
  float ws = clamp(1.0 - L / pivot, 0.0, 1.0);
  float wh = clamp((L - pivot) / (1.0 - pivot), 0.0, 1.0);
  vec3 sh = u_toneShadow - luma(u_toneShadow);
  vec3 hi = u_toneHigh - luma(u_toneHigh);
  return clamp(s + (sh * ws + hi * wh) * u_toneAmt * 1.5, 0.0, 1.0);
}

// Two soft blobs of light entering from an edge, screen-blended. Their exact
// placement along the edge is seeded per image.
vec3 lightLeak(vec3 s, vec2 uv) {
  if (u_leakAmt <= 0.0) return s;
  float aspect = u_outSize.x / u_outSize.y;
  vec2 ext = vec2(aspect, 1.0) * 0.5;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 dir = u_leakDir;
  float tEdge = min(ext.x / max(abs(dir.x), 1e-4), ext.y / max(abs(dir.y), 1e-4));
  vec2 o = dir * tEdge * 1.05;
  vec2 perp = vec2(-dir.y, dir.x);
  float j1 = hash1(11, u_seed) - 0.5;
  float j2 = hash1(12, u_seed) > 0.5 ? 1.0 : -1.0;
  vec2 o1 = o + perp * j1 * 0.6;
  vec2 o2 = o + perp * (j1 * 0.6 + j2 * 0.3) - dir * 0.05;
  float r = 0.2 + 0.7 * u_leakSize;
  vec2 q1 = p - o1;
  float b1 = exp(-dot(q1, q1) / (r * r * 0.5));
  vec2 q2 = p - o2;
  float along = dot(q2, perp), across = dot(q2, dir);
  float b2 = exp(-(along * along / (r * r * 1.2) + across * across / (r * r * 0.12)));
  vec3 leak = u_leakCol * b1 + mix(u_leakCol, vec3(1.0, 0.85, 0.45), 0.5) * b2 * 0.7;
  return 1.0 - (1.0 - s) * (1.0 - clamp(leak * u_leakAmt * 1.4, 0.0, 1.0));
}

vec3 vignette(vec3 s, vec2 uv) {
  if (u_vigAmt == 0.0) return s;
  float aspect = u_outSize.x / u_outSize.y;
  vec2 p = (uv - 0.5) * 2.0;
  // roundness 0: ellipse following the frame; 1: circle.
  if (aspect > 1.0) p.x *= mix(1.0, aspect, u_vigRound);
  else p.y *= mix(1.0, 1.0 / aspect, u_vigRound);
  float d = length(p) / 1.41421;
  float mid = mix(0.25, 1.05, u_vigSize);
  float width = mix(0.05, 1.0, u_vigFeather);
  float v = smoothstep(mid - width * 0.5, mid + width * 0.5, d);
  if (u_vigAmt > 0.0) return s * (1.0 - u_vigAmt * v);
  return mix(s, vec3(1.0), -u_vigAmt * v);
}

// Film grain on a grid fixed relative to the image (1000/size cells across the
// long edge), strongest in the midtones like real film.
vec3 grain(vec3 s, vec2 uv) {
  if (u_grainAmt <= 0.0) return s;
  float longEdge = max(u_outSize.x, u_outSize.y);
  vec2 p = uv * u_outSize / longEdge * (1000.0 / u_grainSize);
  float n = (vnoise(p, u_seed) + 0.6 * vnoise(p * 1.93 + 31.7, u_seed + 101u)) / 1.6 - 0.5;
  vec3 nc = vec3(n);
  if (u_grainColour > 0.0) {
    vec3 cn = vec3(vnoise(p + 7.1, u_seed + 7u), vnoise(p + 13.3, u_seed + 13u), vnoise(p + 19.9, u_seed + 19u)) - 0.5;
    nc = mix(nc, cn, u_grainColour);
  }
  float L = luma(s);
  float w = 1.0 - pow(abs(2.0 * L - 1.0), 2.0) * 0.7;
  return clamp(s + nc * u_grainAmt * 0.5 * w, 0.0, 1.0);
}

// Scanlines: u_lines per image height. When the lines are finer than the
// output can resolve (small previews) they fade to their average darkening so
// overall brightness still matches the full-size export.
vec3 scanlines(vec3 s, vec2 uv) {
  if (u_scan <= 0.0) return s;
  float y = uv.y * u_lines;
  float m = 0.5 + 0.5 * cos(6.2831853 * y);
  float g = m * m;
  float cyclesPerPx = u_lines / u_outSize.y;
  g = mix(g, 0.375, smoothstep(0.3, 0.5, cyclesPerPx));
  return s * (1.0 - u_scan * g * 0.9) * (1.0 + u_scan * 0.2);
}

vec3 vhsNoise(vec3 s, vec2 uv) {
  if (u_vhsNoise <= 0.0 && u_vhsTrack <= 0.0) return s;
  float aspect = u_outSize.x / u_outSize.y;
  int line = int(floor(uv.y * 480.0));
  ivec2 cell = ivec2(floor(uv * vec2(480.0 * aspect, 480.0)));
  // Per-line brightness flicker and fine static.
  s += (hash1(line, u_seed ^ 0xabcdu) - 0.5) * 0.06 * u_vhsNoise;
  s = mix(s, vec3(hash2(cell, u_seed ^ 0x1234u)), u_vhsNoise * 0.12);
  // Occasional white dropout streaks.
  if (hash1(line, u_seed ^ 0x777u) < u_vhsNoise * 0.03) {
    float x0 = hash1(line, u_seed ^ 0x888u);
    float len = 0.04 + 0.25 * hash1(line, u_seed ^ 0x999u);
    float t = (uv.x - x0) / len;
    if (t > 0.0 && t < 1.0) s = mix(s, vec3(1.0), (1.0 - t) * 0.85);
  }
  // Noise inside the tracking band.
  float band = trackingBand(uv) * u_vhsTrack;
  s = mix(s, vec3(hash2(cell, u_seed ^ 0x4242u)), band * 0.55);
  return clamp(s, 0.0, 1.0);
}

vec3 posterise(vec3 s) {
  if (u_posterise < 2.0) return s;
  float n = u_posterise - 1.0;
  return floor(s * n + 0.5) / n;
}

// Bayer threshold maps via bit interleaving: M(x,y) = reverse(interleave(x^y, y)).
float bayer4(ivec2 p) {
  int x = p.x & 3, y = p.y & 3, xy = x ^ y;
  int v = ((xy & 1) << 3) | ((y & 1) << 2) | (xy & 2) | ((y & 2) >> 1);
  return (float(v) + 0.5) / 16.0;
}
float bayer8(ivec2 p) {
  int x = p.x & 7, y = p.y & 7, xy = x ^ y;
  int v = ((xy & 1) << 5) | ((y & 1) << 4) | ((xy & 2) << 2) | ((y & 2) << 1) | ((xy & 4) >> 1) | ((y & 4) >> 2);
  return (float(v) + 0.5) / 64.0;
}

// Nearest palette colour using the "redmean" weighted RGB distance, a cheap
// approximation of perceived colour difference.
vec3 nearestPalette(vec3 c) {
  float best = 1e9;
  vec3 bc = c;
  for (int i = 0; i < 64; i++) {
    if (i >= u_palCount) break;
    vec3 p = u_pal[i];
    vec3 d = c - p;
    float rm = (c.r + p.r) * 0.5;
    float dist = (2.0 + rm) * d.r * d.r + 4.0 * d.g * d.g + (3.0 - rm) * d.b * d.b;
    if (dist < best) { best = dist; bc = p; }
  }
  return bc;
}

vec3 palette(vec3 s, ivec2 cell) {
  if (u_palCount == 0) return s;
  if (u_dither == 1) s += (bayer4(cell) - 0.5) * u_ditherAmt;
  else if (u_dither == 2) s += (bayer8(cell) - 0.5) * u_ditherAmt;
  return nearestPalette(clamp(s, 0.0, 1.0));
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, mix(gl_FragCoord.y, u_outSize.y - gl_FragCoord.y, u_flipY));
  vec2 uv = frag / u_outSize;

  float mask;
  vec2 wuv = vhsWarp(crtWarp(uv, mask));

  vec4 base = sampleImage(wuv);
  vec3 c = sharpen(wuv, base.rgb);

  // ---- Linear light ----
  c *= exp2(u_exposure);
  c = whiteBalance(c);
  if (u_halAmt > 0.0) c += texture(u_bloom, wuv).rgb * u_halAmt * 2.0 * u_halTint;

  // ---- Perceptual (sRGB-encoded) ----
  vec3 s = clamp(linearToSrgb(c), 0.0, 1.0);
  s = tone(s);
  s = colour(s);
  s = applyLut(s);
  s = toning(s);
  // Fade: lift blacks and pull whites down slightly, like faded prints.
  s = mix(s, vec3(0.2) + s * 0.74, u_fade);
  s = posterise(s);
  s = lightLeak(s, uv);
  s = vignette(s, uv);
  s = grain(s, u_grid.x > 0.0 ? snapToGrid(wuv) : uv);
  s = scanlines(s, uv);
  s = vhsNoise(s, uv);
  ivec2 cell = ivec2(floor((u_grid.x > 0.0 ? wuv * u_grid : frag)));
  s = palette(s, cell);

  // Outside the CRT tube is black.
  outColor = vec4(clamp(s, 0.0, 1.0) * mask, mix(1.0, base.a, mask));
}
`;
