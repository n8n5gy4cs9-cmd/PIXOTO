// GPU path for per-pixel adjustments (P2). Each type packs its settings into uniforms (or a persistent LUT texture)
// and draws source -> target in one fullscreen pass. Anything not listed returns null from setupAdjustment so the
// caller falls back to the CPU worker. LUTs are built with the exact CPU helpers from adjust.js / lut.js.
import { getGl, program, texture, release, upload, bindSampler, drawFullscreen, gpuCaps, framebuffer, readPixels } from './context.js';
import { adjustFrag } from './shaders.js';
import { packedLut, applyAdjustment } from '../filters/adjust.js';
import { lutFor } from '../filters/lut.js';
import { makeCanvas, ctxOf } from '../pixels.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const lutTex = new Map();      // key -> persistent WebGLTexture (256x1 LUT or 3D atlas), tiny
const lut3dCache = new Map();  // preset/cube key -> { tex, size }

function getLut256() {
  let t = lutTex.get('lut256');
  if (!t) { t = texture(256, 1, 'rgba8'); lutTex.set('lut256', t); }
  return t;
}

// Levels/curves/gradientMap: rebuild the 256-entry table each tick (the sliders move) and re-upload in place.
function bindLut256(gl, p, adj) {
  const t = getLut256();
  upload(t, packedLut(adj), 256, 1);
  bindSampler(p, 'u_lut', t, 2);
}

// 3D LUT packed into a 2D atlas (width N*N, height N; red fastest, slices = blue) and cached per preset/cube.
function lut3dEntry(adj) {
  const key = adj.preset === 'custom' ? adj.cube : adj.preset;
  let e = lut3dCache.get(key);
  if (e) return e;
  const lut = lutFor(adj);
  if (!lut) return null;
  const n = lut.size, w = n * n, h = n, max = gpuCaps()?.maxTex || 0;
  if (w > max || h > max) return null;
  const bytes = new Uint8Array(w * h * 4);
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const s = (b * n * n + g * n + r) * 3, d = (g * w + (b * n + r)) * 4;
    bytes[d] = Math.round(clamp01(lut.data[s]) * 255);
    bytes[d + 1] = Math.round(clamp01(lut.data[s + 1]) * 255);
    bytes[d + 2] = Math.round(clamp01(lut.data[s + 2]) * 255);
    bytes[d + 3] = 255;
  }
  const tex = texture(w, h, 'rgba8');
  upload(tex, bytes, w, h);
  e = { tex, size: n };
  lut3dCache.set(key, e);
  if (lut3dCache.size > 8) { const k = lut3dCache.keys().next().value; release(lut3dCache.get(k).tex); lut3dCache.delete(k); }
  return e;
}
function bindLut3d(gl, p, adj) {
  const e = lut3dEntry(adj);
  if (!e) throw new Error('3D LUT unavailable or too large for GPU');
  bindSampler(p, 'u_lut3d', e.tex, 2);
  gl.uniform1f(p.loc('u_n'), e.size);
  gl.uniform1f(p.loc('u_m'), e.size - 1);
  gl.uniform1f(p.loc('u_amount'), Math.max(0, Math.min(100, adj.amount)) / 100);
}

function bindHueSat(gl, p, a) {
  const v = new Float32Array(21);
  for (let i = 0; i < 7; i++) { const s = a.shifts[i]; v[i * 3] = s.hue; v[i * 3 + 1] = s.saturation; v[i * 3 + 2] = s.lightness; }
  gl.uniform3fv(p.loc('u_shifts'), v);
  gl.uniform1f(p.loc('u_colorize'), a.colorize ? 1 : 0);
}
function bindBw(gl, p, a) {
  const w = new Float32Array(6);
  for (let i = 0; i < 6; i++) w[i] = Math.max(-200, Math.min(300, a.weights[i])) / 100;
  gl.uniform1fv(p.loc('u_w'), w);
  gl.uniform1f(p.loc('u_tint'), a.tint && a.tintSaturation > 0 ? 1 : 0);
  gl.uniform1f(p.loc('u_tintHue'), a.tintHue);
  gl.uniform1f(p.loc('u_tintSat'), Math.max(0, Math.min(100, a.tintSaturation)) / 100);
}
function bindColorBalance(gl, p, a) {
  const u = (v) => [Math.max(-100, Math.min(100, v[0])) / 100, Math.max(-100, Math.min(100, v[1])) / 100, Math.max(-100, Math.min(100, v[2])) / 100];
  gl.uniform3fv(p.loc('u_sh'), u(a.shadows));
  gl.uniform3fv(p.loc('u_mid'), u(a.midtones));
  gl.uniform3fv(p.loc('u_hi'), u(a.highlights));
  gl.uniform1f(p.loc('u_preserve'), a.preserveLuminosity ? 1 : 0);
}
function bindGrain(gl, p, a, opts = {}) {
  const step = opts.step || 1;
  const eff = step > 1.01 ? a.amount * Math.min(1, Math.max(a.size, 1) / step) : a.amount;
  const amount = Math.max(0, Math.min(100, eff)) / 100 * 96;
  const size = Math.max(0.5, Math.min(20, a.size));
  const detail = Math.max(0.5, size * 0.35);
  const rough = Math.max(0, Math.min(100, a.roughness)) / 100;
  const s0 = a.seed >>> 0, s1 = (s0 ^ 0x9E3779B9) >>> 0;
  gl.uniform1f(p.loc('u_amount'), amount);
  gl.uniform1f(p.loc('u_size'), size);
  gl.uniform1f(p.loc('u_detail'), detail);
  gl.uniform1f(p.loc('u_rough'), rough);
  gl.uniform1ui(p.loc('u_s0'), s0);
  gl.uniform1ui(p.loc('u_s1'), s1);
  gl.uniform1f(p.loc('u_ox'), opts.ox || 0);
  gl.uniform1f(p.loc('u_oy'), opts.oy || 0);
  gl.uniform1f(p.loc('u_step'), step);
}
function bindNoise(gl, p, a, opts = {}) {
  const step = opts.step || 1;
  const amt = step > 1.01 ? a.amount / step : a.amount;
  const spread = Math.max(0, Math.min(400, amt)) / 100 * 127.5;
  gl.uniform1f(p.loc('u_spread'), spread);
  gl.uniform1ui(p.loc('u_sd'), a.seed >>> 0);
  gl.uniform1f(p.loc('u_gaussian'), a.gaussian ? 1 : 0);
  gl.uniform1f(p.loc('u_mono'), a.monochromatic ? 1 : 0);
  gl.uniform1f(p.loc('u_ox'), opts.ox || 0);
  gl.uniform1f(p.loc('u_oy'), opts.oy || 0);
  gl.uniform1f(p.loc('u_step'), step);
}

const TYPES = {
  brightnessContrast: { frag: adjustFrag.brightnessContrast, bind: (gl, p, a) => { gl.uniform1f(p.loc('u_b'), a.brightness); gl.uniform1f(p.loc('u_c'), a.contrast); } },
  exposure: { frag: adjustFrag.exposure, bind: (gl, p, a) => { gl.uniform1f(p.loc('u_exp'), a.exposure); gl.uniform1f(p.loc('u_off'), a.offset); gl.uniform1f(p.loc('u_gamma'), a.gamma); } },
  invert: { frag: adjustFrag.invert, bind: () => {} },
  threshold: { frag: adjustFrag.threshold, bind: (gl, p, a) => gl.uniform1f(p.loc('u_level'), a.level) },
  posterize: { frag: adjustFrag.posterize, bind: (gl, p, a) => gl.uniform1f(p.loc('u_levels'), a.levels) },
  desaturate: { frag: adjustFrag.desaturate, bind: (gl, p, a) => gl.uniform1f(p.loc('u_amount'), a.amount) },
  sepia: { frag: adjustFrag.sepia, bind: (gl, p, a) => gl.uniform1f(p.loc('u_amount'), a.amount) },
  solarize: { frag: adjustFrag.solarize, bind: (gl, p, a) => gl.uniform1f(p.loc('u_threshold'), a.threshold) },
  levels: { frag: adjustFrag.levels, bind: bindLut256 },
  curves: { frag: adjustFrag.curves, bind: bindLut256 },
  gradientMap: { frag: adjustFrag.gradientMap, bind: bindLut256 },
  hueSaturation: { frag: adjustFrag.hueSaturation, bind: bindHueSat },
  vibrance: { frag: adjustFrag.vibrance, bind: (gl, p, a) => { gl.uniform1f(p.loc('u_amount'), a.amount); gl.uniform1f(p.loc('u_sat'), a.saturation); } },
  blackAndWhite: { frag: adjustFrag.blackAndWhite, bind: bindBw },
  colorBalance: { frag: adjustFrag.colorBalance, bind: bindColorBalance },
  lut: { frag: adjustFrag.lut, bind: bindLut3d },
  grain: { frag: adjustFrag.grain, bind: bindGrain },
  addNoise: { frag: adjustFrag.addNoise, bind: bindNoise },
};

// Classification for every entry of ADJUSTMENT_TYPES. grain/addNoise preview on the GPU but commit on the CPU worker
// (random ops must save identically). gaussianBlur/motionBlur are not ported yet (P4), so they stay fully CPU.
export function canRunOnGpu(adj) {
  if (adj.type === 'grain' || adj.type === 'addNoise') return { preview: true, commit: false };
  if (adj.type === 'gaussianBlur' || adj.type === 'motionBlur') return { preview: true, commit: false };
  const ok = !!TYPES[adj.type];
  return { preview: ok, commit: ok };
}

// Returns { name, frag, bind } for a supported adjustment, or null so the caller uses the CPU path.
export function setupAdjustment(adj) {
  const def = TYPES[adj.type];
  if (!def) return null;
  return { name: 'adjust:' + adj.type, frag: def.frag, bind: def.bind };
}

// Draws `srcTex` through the adjustment into `target` (a framebuffer, or null for the GL canvas of size w x h).
// opts may carry { selTex, step, ox, oy } for the position-dependent noise previews.
export function drawAdjustment(adj, srcTex, target, w, h, opts = {}) {
  const st = setupAdjustment(adj);
  if (!st) return false;
  const gl = getGl(); if (!gl) return false;
  try {
    const p = program(st.name, st.frag);
    gl.useProgram(p.prog);
    bindSampler(p, 'u_src', srcTex, 0);
    bindSampler(p, 'u_sel', opts.selTex || srcTex, 1);
    gl.uniform1i(p.loc('u_useSel'), opts.selTex ? 1 : 0);
    st.bind(gl, p, adj, opts);
    drawFullscreen(p, target, w, h);
    return true;
  } catch (e) { console.warn('GPU adjust failed, falling back', e); return false; }
}

// Dev-only parity check (P6.4): runs the CPU applyAdjustment and the GPU pass on a 512x512 gradient+noise+alpha test
// image and returns { max, mean } abs differences per channel. Call from the console: __gpuParity(createAdjustment('levels')).
export function gpuParity(adj) {
  const gl = getGl(); if (!gl) return { error: 'WebGL2 unavailable' };
  const size = 512, c = makeCanvas(size, size), ctx = ctxOf(c);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    img.data[i] = (x * 255 / size) | 0; img.data[i + 1] = (y * 255 / size) | 0; img.data[i + 2] = (x * y) & 255; img.data[i + 3] = (x + y) & 255;
  }
  ctx.putImageData(img, 0, 0);
  const cpu = new Uint8ClampedArray(img.data);
  applyAdjustment(adj, cpu, size, size, 0, 0, 1);
  const src = texture(size, size, 'rgba8', 'linear');
  upload(src, c, size, size);
  const out = texture(size, size, 'rgba8', 'linear');
  let ok = false;
  try { ok = drawAdjustment(adj, src, framebuffer(out), size, size, { step: 1, ox: 0, oy: 0 }); } catch (e) { console.warn(e); }
  const gpu = new Uint8ClampedArray(size * size * 4);
  if (ok) readPixels(framebuffer(out), size, size, gpu);
  release(src); release(out);
  if (!ok) return { error: 'not supported on GPU' };
  let max = 0, sum = 0;
  for (let i = 0; i < cpu.length; i++) { const d = Math.abs(cpu[i] - gpu[i]); if (d > max) max = d; sum += d; }
  return { max, mean: sum / cpu.length };
}
if (typeof window !== 'undefined') window.__gpuParity = gpuParity;
