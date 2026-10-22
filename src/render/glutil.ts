// Small raw-WebGL2 helpers. No library: just enough to compile programs,
// cache uniform locations and manage render-target textures.

export class GLProgram {
  readonly program: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();

  constructor(private gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string, name: string) {
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, name);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, name);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Link failed (${name}): ${gl.getProgramInfoLog(p)}`);
    }
    this.program = p;
  }

  use(): this {
    this.gl.useProgram(this.program);
    return this;
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.locs.set(name, l);
    }
    return l;
  }

  f(name: string, ...v: number[]): this {
    const l = this.loc(name);
    const gl = this.gl;
    if (v.length === 1) gl.uniform1f(l, v[0]);
    else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
    else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
    return this;
  }

  i(name: string, v: number): this {
    this.gl.uniform1i(this.loc(name), v);
    return this;
  }

  u(name: string, v: number): this {
    this.gl.uniform1ui(this.loc(name), v >>> 0);
    return this;
  }

  v3array(name: string, data: Float32Array): this {
    this.gl.uniform3fv(this.loc(name), data);
    return this;
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, name: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile failed (${name}): ${log}`);
  }
  return s;
}

export interface RenderTexture {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

/**
 * Render target stored as SRGB8_ALPHA8: writes are encoded linear->sRGB and
 * reads decode back to linear, so intermediates hold linear light with 8-bit
 * perceptual precision (no banding in shadows) and work on every WebGL2
 * implementation without float-texture extensions.
 */
export function createRenderTexture(gl: WebGL2RenderingContext, width: number, height: number): RenderTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.SRGB8_ALPHA8, width, height);
  setSampling(gl, gl.LINEAR, gl.LINEAR);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, width, height };
}

export function deleteRenderTexture(gl: WebGL2RenderingContext, rt: RenderTexture | null): void {
  if (!rt) return;
  gl.deleteTexture(rt.tex);
  gl.deleteFramebuffer(rt.fbo);
}

export function setSampling(gl: WebGL2RenderingContext, min: number, mag: number): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
