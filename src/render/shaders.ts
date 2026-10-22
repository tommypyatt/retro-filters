// GLSL for the recipe pipeline. Preview and export run exactly this code; the
// only difference is output resolution, and every spatial parameter is
// expressed relative to the image so the result is resolution independent.
//
// Colour handling:
// - Source and intermediate textures are SRGB8_ALPHA8, so texture() returns
//   *linear* light and hardware filtering/mipmaps average in linear (correct
//   for downscaling and blurs).
// - Physically based operations run in linear light: exposure (a multiply in
//   light units), white balance (per-channel gains), sharpening and
//   bloom/halation (light adds).
// - Tonal and "look" operations (contrast, shadows/highlights, brightness,
//   gamma, saturation, hue, LUTs, toning, fade, grain...) run on sRGB-encoded
//   values because their parameters are perceptual and .cube LUTs are authored
//   for display-referred sRGB input.

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

export const FINAL_FRAG = COMMON + /* glsl */ `
uniform sampler2D u_src;
uniform vec2 u_outSize;     // output size in px
uniform float u_flipY;      // 1 when drawing to the default framebuffer
uniform uint u_seed;

// Adjustments
uniform float u_exposure, u_brightness, u_contrast, u_saturation, u_vibrance;
uniform float u_highlights, u_shadows, u_temperature, u_tint, u_hue, u_gamma, u_fade, u_sharpness;

out vec4 outColor;

// Unsharp mask in linear light: 8 taps on a ring whose radius is a fixed
// fraction of the image (1.2px at a 1000px long edge) so it looks the same at
// preview and export resolution.
vec3 sharpen(vec2 uv, vec3 c) {
  if (u_sharpness <= 0.0) return c;
  float longEdge = max(u_outSize.x, u_outSize.y);
  vec2 d = vec2(max(1.0, longEdge * 0.0012)) / u_outSize;
  vec3 blur = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    blur += texture(u_src, uv + d * vec2(cos(a), sin(a))).rgb;
  }
  blur /= 8.0;
  return max(c + (c - blur) * u_sharpness * 2.5, 0.0);
}

// Approximate white balance gains in linear light. Normalised so overall
// luminance stays roughly constant.
vec3 whiteBalance(vec3 c) {
  vec3 g = vec3(1.0 + 0.30 * u_temperature, 1.0, 1.0 - 0.30 * u_temperature);
  g *= vec3(1.0 + 0.12 * u_tint, 1.0 - 0.18 * u_tint, 1.0 + 0.12 * u_tint);
  return c * g / luma(g);
}

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

// Perceptual-space tone controls. Endpoints (0 and 1) are preserved wherever
// possible so the controls shape tones rather than clip them.
vec3 tone(vec3 s) {
  // Shadows / highlights: luminance-masked lifts that peak around 1/3 and 2/3.
  float L = luma(s);
  float sh = u_shadows * 1.6 * L * (1.0 - L) * (1.0 - L);
  float hi = u_highlights * 1.6 * L * L * (1.0 - L);
  s += sh + hi;
  s = clamp(s, 0.0, 1.0);

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

  s = pow(clamp(s, 0.0, 1.0), vec3(1.0 / u_gamma));
  return s;
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

void main() {
  vec2 frag = vec2(gl_FragCoord.x, mix(gl_FragCoord.y, u_outSize.y - gl_FragCoord.y, u_flipY));
  vec2 uv = frag / u_outSize;

  vec4 src = texture(u_src, uv);
  vec3 c = sharpen(uv, src.rgb);

  // ---- Linear light ----
  c *= exp2(u_exposure);
  c = whiteBalance(c);

  // ---- Perceptual (sRGB-encoded) ----
  vec3 s = clamp(linearToSrgb(c), 0.0, 1.0);
  s = tone(s);
  s = colour(s);

  // Fade: lift blacks and pull whites down slightly, like faded prints.
  s = mix(s, vec3(0.2) + s * 0.74, u_fade);

  outColor = vec4(clamp(s, 0.0, 1.0), src.a);
}
`;
