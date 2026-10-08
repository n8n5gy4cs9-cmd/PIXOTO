// GPU path for the per-pixel adjustments that map 1:1 to a fragment shader (P2.1). Each type packs its settings into
// scalar float uniforms and draws source -> target in a single fullscreen pass. Anything not listed here returns null
// from setupAdjustment so the caller falls back to the CPU worker.
import { getGl, program, bindSampler, drawFullscreen } from './context.js';
import { adjustFrag } from './shaders.js';

const UNIFORMS = {
  brightnessContrast: ['u_b', 'u_c'],
  exposure: ['u_exp', 'u_off', 'u_gamma'],
  invert: [],
  threshold: ['u_level'],
  posterize: ['u_levels'],
  desaturate: ['u_amount'],
  sepia: ['u_amount'],
  solarize: ['u_threshold'],
};
const PACK = {
  brightnessContrast: (a) => [a.brightness, a.contrast],
  exposure: (a) => [a.exposure, a.offset, a.gamma],
  threshold: (a) => [a.level],
  posterize: (a) => [a.levels],
  desaturate: (a) => [a.amount],
  sepia: (a) => [a.amount],
  solarize: (a) => [a.threshold],
};

// Returns { name, frag, pack } for a supported adjustment, or null so the caller uses the CPU path.
export function setupAdjustment(adj) {
  const frag = adjustFrag[adj.type];
  if (!frag) return null;
  return { name: 'adjust:' + adj.type, frag, pack: PACK[adj.type], uniforms: UNIFORMS[adj.type] };
}

// Draws `srcTex` through the adjustment into `target` (a framebuffer, or null for the GL canvas of size w x h).
export function drawAdjustment(adj, srcTex, target, w, h) {
  const st = setupAdjustment(adj);
  if (!st) return false;
  const gl = getGl(); if (!gl) return false;
  try {
    const p = program(st.name, st.frag);
    gl.useProgram(p.prog);
    bindSampler(p, 'u_src', srcTex, 0);
    const v = st.pack(adj);
    for (let i = 0; i < st.uniforms.length; i++) gl.uniform1f(p.loc(st.uniforms[i]), v[i]);
    drawFullscreen(p, target, w, h);
    return true;
  } catch (e) { console.warn('GPU adjust failed, falling back', e); return false; }
}
