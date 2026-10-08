// GPU previews for the blur family and a few cheap filters (P4). All of these only preview on the GPU; commit always
// runs on the CPU worker so saved pixels stay identical to before. Blurs run premultiplied (like the CPU), so a
// semi-transparent edge blurs exactly like `blurStraight`. Anything not listed here returns false and stays on the CPU.
import { getGl, program, texture, release, framebuffer, releaseFramebuffer, bindSampler, drawFullscreen } from './context.js';
import { passFrag, cameraRawBasicFrag } from './shaders.js';
import { adjustsGroup } from '../filters/cameraraw.js';

// Filter id -> preview on GPU (commit is always CPU). Kept as a flat map for the docs audit table (PERF_PLAN §4).
// cameraRaw previews only when its Light/Color groups are the sole non-default stage; otherwise the function returns
// false and the session falls back to the CPU proxy.
export const FILTER_GPU = { gaussianBlur: true, motionBlur: true, boxBlur: true, emboss: true, cameraRaw: true };

const SEP_BLUR = `uniform sampler2D u_src;
uniform vec2 u_dir;
uniform float u_param;
uniform float u_box;
uniform int u_taps;
uniform float u_clamp;
void main() {
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  int half = u_taps / 2;
  for (int i = 0; i < 96; i++) {
    if (i >= u_taps) break;
    float off = float(i - half);
    vec2 uv = v_uv + u_dir * off;
    if (u_clamp < 0.5 && (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0)) continue;
    vec4 t = texture(u_src, clamp(uv, 0.0, 1.0));
    float w = u_box > 0.5 ? 1.0 : exp(-(off * off) / (2.0 * u_param * u_param));
    sum += t * w;
    wsum += w;
  }
  o = sum / max(wsum, 1e-5);
}`;

const MOTION = `uniform sampler2D u_src;
uniform vec2 u_dir;
uniform int u_samples;
uniform float u_clamp;
void main() {
  vec4 sum = vec4(0.0);
  float n = float(u_samples);
  for (int i = 0; i < 96; i++) {
    if (i >= u_samples) break;
    float t = n <= 1.0 ? 0.0 : (float(i) / (n - 1.0) - 0.5);
    vec2 uv = v_uv + u_dir * t;
    if (u_clamp < 0.5 && (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0)) continue;
    sum += texture(u_src, clamp(uv, 0.0, 1.0));
  }
  o = sum / n;
}`;

// 3x3 emboss kernel from filters.js: [-2s, -s, 0,  -s, 1, s,  0, s, 2s], on straight RGB, alpha unchanged.
const EMBOSS = `uniform sampler2D u_src;
uniform float u_strength;
void main() {
  vec2 ts = 1.0 / vec2(textureSize(u_src, 0));
  float s = u_strength;
  vec3 sum = vec3(0.0);
  sum += texture(u_src, clamp(v_uv + vec2(-ts.x, -ts.y), 0.0, 1.0)).rgb * -2.0 * s;
  sum += texture(u_src, clamp(v_uv + vec2(0.0, -ts.y), 0.0, 1.0)).rgb * -s;
  sum += texture(u_src, clamp(v_uv + vec2(ts.x, -ts.y), 0.0, 1.0)).rgb * 0.0;
  sum += texture(u_src, clamp(v_uv + vec2(-ts.x, 0.0), 0.0, 1.0)).rgb * -s;
  sum += texture(u_src, v_uv).rgb * 1.0;
  sum += texture(u_src, clamp(v_uv + vec2(ts.x, 0.0), 0.0, 1.0)).rgb * s;
  sum += texture(u_src, clamp(v_uv + vec2(-ts.x, ts.y), 0.0, 1.0)).rgb * 0.0;
  sum += texture(u_src, clamp(v_uv + vec2(0.0, ts.y), 0.0, 1.0)).rgb * s;
  sum += texture(u_src, clamp(v_uv + vec2(ts.x, ts.y), 0.0, 1.0)).rgb * 2.0 * s;
  o = vec4(clamp(sum, 0.0, 1.0), texture(u_src, v_uv).a);
}`;

// Draws `srcTex` through `body` into the texture `targetTex` (a pooled framebuffer is created and released around the
// single draw call, so no framebuffers accumulate across ticks).
function pass(name, body, srcTex, targetTex, w, h, bind) {
  const p = program(name, body);
  const gl = getGl();
  gl.useProgram(p.prog);
  bindSampler(p, 'u_src', srcTex, 0);
  bind?.(gl, p);
  const f = framebuffer(targetTex);
  drawFullscreen(p, f, w, h);
  releaseFramebuffer(f);
}

// Blurs `srcTex` (straight RGBA) separably into `outTex` at size w x h. `radius` is in the current (proxy) texels;
// `box` selects a box kernel (boxBlur) instead of a Gaussian. Scratch textures come from the pool, so steady-state
// ticks allocate nothing.
function sepBlur(srcTex, outTex, w, h, radius, box) {
  const taps = Math.max(1, Math.min(64, (box ? Math.round(radius) * 2 + 1 : Math.ceil(radius * 3) * 2 + 1)));
  let scale = 1, r = radius;
  while ((box ? r * 2 + 1 : r * 3) > 32 && scale > 0.0625) { scale /= 2; r /= 2; }
  const sw = Math.max(1, Math.round(w * scale)), sh = Math.max(1, Math.round(h * scale));
  const a = texture(w, h, 'rgba8', 'linear');
  const b = texture(w, h, 'rgba8', 'linear');
  pass('premul', passFrag.premul, srcTex, a, w, h);

  if (scale < 1) {
    const small = texture(sw, sh, 'rgba8', 'linear');
    const small2 = texture(sw, sh, 'rgba8', 'linear');
    const param = box ? r : Math.max(0.1, r);
    pass('copy', passFrag.copy, a, small, sw, sh);                     // downsample
    pass('sepblur', SEP_BLUR, small, small2, sw, sh, blurBind(sw, 0, param, box, taps));
    pass('sepblur', SEP_BLUR, small2, small, sw, sh, blurBind(0, sh, param, box, taps));
    pass('copy', passFrag.copy, small, b, w, h);                       // upsample
    release(small); release(small2);
  } else {
    const param = box ? r : Math.max(0.1, r);
    pass('sepblur', SEP_BLUR, a, b, w, h, blurBind(w, 0, param, box, taps));
    pass('sepblur', SEP_BLUR, b, a, w, h, blurBind(0, h, param, box, taps));
    pass('unpremul', passFrag.unpremul, a, outTex, w, h);
    release(a); release(b);
    return;
  }
  pass('unpremul', passFrag.unpremul, b, outTex, w, h);
  release(a); release(b);
}
const blurBind = (sx, sy, param, box, taps) => (g, p) => {
  g.uniform2f(p.loc('u_dir'), sx ? 1 / sx : 0, sy ? 1 / sy : 0);
  g.uniform1f(p.loc('u_param'), param); g.uniform1f(p.loc('u_box'), box ? 1 : 0);
  g.uniform1i(p.loc('u_taps'), taps); g.uniform1f(p.loc('u_clamp'), 1);
};

function motionBlur(srcTex, outTex, w, h, distance, angle) {
  const dist = Math.max(1, Math.min(2000, distance));
  const rad = Math.max(-90, Math.min(90, angle)) * Math.PI / 180;
  const dx = Math.cos(rad) / w, dy = -Math.sin(rad) / h;
  const samples = Math.min(96, Math.max(1, Math.round(dist)));
  const length = samples <= 1 ? 0 : dist;
  const a = texture(w, h, 'rgba8', 'linear');
  const b = texture(w, h, 'rgba8', 'linear');
  pass('premul', passFrag.premul, srcTex, a, w, h);
  pass('motion', MOTION, a, b, w, h, (g, p) => { g.uniform2f(p.loc('u_dir'), dx * length, dy * length); g.uniform1i(p.loc('u_samples'), samples); g.uniform1f(p.loc('u_clamp'), 1); });
  pass('unpremul', passFrag.unpremul, b, outTex, w, h);
  release(a); release(b);
}

// Destructive filter preview. `params`/`env` are already resolved; `step` = source pixels per proxy pixel.
export function drawFilterGpu(id, params, env, srcTex, outTex, w, h, step = 1) {
  const gl = getGl(); if (!gl) return false;
  try {
    if (id === 'gaussianBlur') { sepBlur(srcTex, outTex, w, h, Math.max(0.1, params.radius) / Math.max(step, 1e-6), false); return true; }
    if (id === 'boxBlur') { sepBlur(srcTex, outTex, w, h, Math.max(1, Math.round(params.radius)) / Math.max(step, 1e-6), true); return true; }
    if (id === 'motionBlur') { motionBlur(srcTex, outTex, w, h, params.distance / Math.max(step, 1e-6), params.angle); return true; }
    if (id === 'emboss') { pass('emboss', EMBOSS, srcTex, outTex, w, h, (g, p) => g.uniform1f(p.loc('u_strength'), params.strength)); return true; }
    if (id === 'cameraRaw') return drawCameraRawGpu(params.settings, srcTex, outTex, w, h);
    return false;
  } catch (e) { console.warn('GPU filter failed, falling back', e); return false; }
}

// Camera Raw Light + Color stage (cameraraw.js `basic`) as one shader. Only used when every other group is at its
// default, so the grade is exactly the WB/exposure/contrast/highlights/shadows/whites/blacks/vibrance/saturation pass.
function drawCameraRawGpu(settings, srcTex, outTex, w, h) {
  const s = settings; if (!s) return false;
  if (['grading', 'effects', 'curve', 'mixer', 'detail', 'optics', 'calibration'].some((g) => adjustsGroup(s, g))) return false;
  const warm = s.temperature / 100, magenta = s.tint / 100, light = Math.pow(2, s.exposure);
  const p = program('cameraRawBasic', cameraRawBasicFrag);
  const gl = getGl();
  gl.useProgram(p.prog);
  bindSampler(p, 'u_src', srcTex, 0);
  bindSampler(p, 'u_sel', srcTex, 1);
  gl.uniform1i(p.loc('u_useSel'), 0);
  gl.uniform1f(p.loc('u_gr'), (1 + 0.35 * warm + 0.15 * magenta) * light);
  gl.uniform1f(p.loc('u_gg'), (1 - 0.30 * magenta) * light);
  gl.uniform1f(p.loc('u_gb'), (1 - 0.35 * warm + 0.15 * magenta) * light);
  gl.uniform1f(p.loc('u_contrast'), 1 + s.contrast / 100);
  gl.uniform1f(p.loc('u_hi'), s.highlights / 100);
  gl.uniform1f(p.loc('u_sh'), s.shadows / 100);
  gl.uniform1f(p.loc('u_wh'), s.whites / 100);
  gl.uniform1f(p.loc('u_bl'), s.blacks / 100);
  gl.uniform1f(p.loc('u_vib'), s.vibrance / 100);
  gl.uniform1f(p.loc('u_sat'), s.saturation / 100);
  const f = framebuffer(outTex);
  drawFullscreen(p, f, w, h);
  releaseFramebuffer(f);
  return true;
}

// Blur adjustments (gaussianBlur / motionBlur) preview on the GPU the same way as their filter equivalents.
export function drawBlurAdjustmentGpu(adj, srcTex, outTex, w, h, step = 1) {
  const gl = getGl(); if (!gl) return false;
  try {
    if (adj.type === 'gaussianBlur') { sepBlur(srcTex, outTex, w, h, Math.max(0.1, Math.min(250, adj.radius)) / Math.max(step, 1e-6), false); return true; }
    if (adj.type === 'motionBlur') { motionBlur(srcTex, outTex, w, h, adj.distance / Math.max(step, 1e-6), adj.angle); return true; }
    return false;
  } catch (e) { console.warn('GPU blur adjustment failed', e); return false; }
}

// The selection-mix post pass used for filters (adjustments mix inside their own shader). Draws original (srcTex) mixed
// with result (resTex) by selection coverage (selTex, R8) onto the default canvas (`out` is null for the GL canvas).
export function drawSelectionMix(srcTex, resTex, selTex, out, w, h) {
  const p = program('selmix', passFrag.selMix);
  const gl = getGl();
  gl.useProgram(p.prog);
  bindSampler(p, 'u_src', srcTex, 0);
  bindSampler(p, 'u_res', resTex, 1);
  bindSampler(p, 'u_sel', selTex, 2);
  drawFullscreen(p, out, w, h);
}
