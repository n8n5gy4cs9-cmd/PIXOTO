// WebGL2 plumbing for GPU image passes: one shared context, program cache, texture and framebuffer pools, and
// straight-alpha upload/readback. Every function is safe to call when WebGL2 is missing: check `getGl()` first.
const VERT = `#version 300 es
out vec2 v_uv;
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); v_uv = vec2(p.x, 1.0 - p.y); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
export const FRAG_HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nin vec2 v_uv;\nout vec4 o;\n';

let gl = null, canvas = null, caps = null, vao = null, dead = false, tried = false;
const programs = new Map(), freeTex = new Map(), freeFbo = [];

export function getGl() {
  if (dead) return null;
  if (gl || tried) return gl;
  tried = true;
  try {
    canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) return null;
    caps = { maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), halfFloat: !!(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float')) };
    vao = gl.createVertexArray();
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); dead = true; gl = null; programs.clear(); freeTex.clear(); freeFbo.length = 0; });
  } catch (e) { console.warn('WebGL2 unavailable', e); gl = null; }
  return gl;
}
export const isGpuAvailable = () => !!getGl();
export const gpuCaps = () => (getGl(), caps);
export const gpuCanvas = () => (getGl(), canvas);
export const isContextDead = () => dead;

// Compiles `frag` (body after FRAG_HEAD is added) once per name. Returns { prog, loc(name) }.
export function program(name, fragBody) {
  let p = programs.get(name); if (p) return p;
  const g = getGl(); if (!g) throw new Error('WebGL2 unavailable');
  const compile = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) { const log = g.getShaderInfoLog(s); g.deleteShader(s); throw new Error(`Shader ${name}: ${log}`); } return s; };
  const vs = compile(g.VERTEX_SHADER, VERT), fs = compile(g.FRAGMENT_SHADER, fragBody.startsWith('#version') ? fragBody : FRAG_HEAD + fragBody);
  const prog = g.createProgram(); g.attachShader(prog, vs); g.attachShader(prog, fs); g.linkProgram(prog);
  g.deleteShader(vs); g.deleteShader(fs);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(`Program ${name}: ${g.getProgramInfoLog(prog)}`);
  const locs = new Map();
  p = { prog, loc: (n) => { let l = locs.get(n); if (l === undefined) locs.set(n, l = g.getUniformLocation(prog, n)); return l; } };
  programs.set(name, p);
  return p;
}

const FORMATS = { rgba8: ['RGBA8', 'RGBA', 'UNSIGNED_BYTE'], r8: ['R8', 'RED', 'UNSIGNED_BYTE'], rgba16f: ['RGBA16F', 'RGBA', 'HALF_FLOAT'] };
// Pooled immutable texture. `filter`: 'nearest' | 'linear'. Give it back with release().
export function texture(w, h, fmt = 'rgba8', filter = 'nearest') {
  const g = getGl(), key = `${fmt}:${w}x${h}`, l = freeTex.get(key);
  let t = l?.pop();
  if (!t) { t = g.createTexture(); g.bindTexture(g.TEXTURE_2D, t); g.texStorage2D(g.TEXTURE_2D, 1, g[FORMATS[fmt][0]], w, h); }
  g.bindTexture(g.TEXTURE_2D, t);
  const f = filter === 'linear' ? g.LINEAR : g.NEAREST;
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, f); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, f);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  t.key = key;
  return t;
}
export function release(t) {
  if (!t || !gl) return;
  let l = freeTex.get(t.key); if (!l) freeTex.set(t.key, l = []);
  if (l.length < 4) l.push(t); else gl.deleteTexture(t);
}

// Straight-alpha upload of a canvas, ImageBitmap, ImageData or typed array into the whole texture.
export function upload(tex, source, w, h, fmt = 'rgba8') {
  const g = getGl(), [, format, type] = FORMATS[fmt];
  g.bindTexture(g.TEXTURE_2D, tex);
  g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.NONE);
  g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
  g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
  g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, w, h, g[format], g[type], source);
}

// Framebuffer wrapper around a texture, from a small pool.
export function framebuffer(tex) {
  const g = getGl(), f = freeFbo.pop() || g.createFramebuffer();
  g.bindFramebuffer(g.FRAMEBUFFER, f);
  g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
  return f;
}
export function releaseFramebuffer(f) { if (gl && f) { if (freeFbo.length < 4) freeFbo.push(f); else gl.deleteFramebuffer(f); } }

// Binds `tex` to texture unit `unit` and points sampler uniform `name` of program `p` at it.
export function bindSampler(p, name, tex, unit) {
  const g = getGl(); g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(g.TEXTURE_2D, tex); g.uniform1i(p.loc(name), unit);
}
// Draws the fullscreen triangle with program `p` into `target` (framebuffer, or null for the GL canvas of size w x h).
export function drawFullscreen(p, target, w, h) {
  const g = getGl();
  if (!target && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
  g.bindFramebuffer(g.FRAMEBUFFER, target || null);
  g.viewport(0, 0, w, h);
  g.disable(g.BLEND);
  g.useProgram(p.prog);
  g.bindVertexArray(vao);
  g.drawArrays(g.TRIANGLES, 0, 3);
}
// Reads the currently bound framebuffer (or `target`) into `out` (Uint8Array/Uint8ClampedArray of w*h*4), straight alpha.
export function readPixels(target, w, h, out) {
  const g = getGl(); g.bindFramebuffer(g.FRAMEBUFFER, target || null);
  g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, out);
  return out;
}
export function disposeAll() {
  if (!gl) return;
  for (const l of freeTex.values()) l.forEach((t) => gl.deleteTexture(t));
  freeTex.clear(); freeFbo.forEach((f) => gl.deleteFramebuffer(f)); freeFbo.length = 0;
}
