// Destructive filters (Composa.Filters.ImageFilters ported, plus extras Composa has no menu item for). Every filter is
// { id, name, group, params, run(img, p, env) } over straight RGBA bytes: img = { data, w, h }; env = { clampEdges, seed,
// fillsClear, frame } supplied by the caller. `run` returns { data, w, h, growX, growY }. Pure: runs in the filter worker.
import { gaussianBlur, blurRGBA, morph } from './blur.js';
import { blurStraight, motionBlurStraight, noise, hash, vignetteMask } from './adjust.js';
import { backdropPlane } from '../select/wand.js';
import { painterly, PAINTERLY_STYLES } from './painterly.js';
import { rgbToHsl, hslToRgb } from '../pixels.js';
import { cameraRaw, isIdentitySettings } from './cameraraw.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rec709 = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const same = (img, data = img.data) => ({ data, w: img.w, h: img.h, growX: 0, growY: 0 });
const hasOpaqueBorder = ({ data, w, h }) => {
  for (let x = 0; x < w; x++) if (data[x * 4 + 3] !== 255 || data[((h - 1) * w + x) * 4 + 3] !== 255) return false;
  for (let y = 0; y < h; y++) if (data[y * w * 4 + 3] !== 255 || data[(y * w + w - 1) * 4 + 3] !== 255) return false;
  return true;
};
function premul(d) { for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; if (a !== 255) { d[i] = d[i] * a / 255; d[i + 1] = d[i + 1] * a / 255; d[i + 2] = d[i + 2] * a / 255; } } }
function unpremul(d) { for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; if (a !== 255 && a !== 0) { d[i] = Math.min(255, d[i] * 255 / a); d[i + 1] = Math.min(255, d[i + 1] * 255 / a); d[i + 2] = Math.min(255, d[i + 2] * 255 / a); } } }
function pad(img, px, py) {
  const w = img.w + 2 * px, h = img.h + 2 * py, out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < img.h; y++) out.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((y + py) * w + px) * 4);
  return { data: out, w, h };
}
// Bilinear sample of premultiplied-in-place straight data at (x, y); returns [r,g,b,a] straight.
function sampler(img) {
  const { data: d, w, h } = img, out = [0, 0, 0, 0];
  return (x, y, mode = 'zero') => {
    let x0 = Math.floor(x), y0 = Math.floor(y); const tx = x - x0, ty = y - y0;
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = 0; k < 4; k++) {
      let px = x0 + (k & 1), py = y0 + (k >> 1);
      const wgt = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty);
      if (mode === 'clamp') { px = clamp(px, 0, w - 1); py = clamp(py, 0, h - 1); } else if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const i = (py * w + px) * 4, al = d[i + 3] / 255 * wgt;
      r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al;
    }
    if (a > 0) { out[0] = r / a; out[1] = g / a; out[2] = b / a; } else out[0] = out[1] = out[2] = 0;
    out[3] = a * 255;
    return out;
  };
}
function convolve(img, kernel, size, divisor = 1, offset = 0, keepAlpha = true) {
  const { data: s, w, h } = img, out = new Uint8ClampedArray(s.length), r = size >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; let ar = 0, ag = 0, ab = 0;
    for (let ky = -r; ky <= r; ky++) for (let kx = -r; kx <= r; kx++) {
      const j = (clamp(y + ky, 0, h - 1) * w + clamp(x + kx, 0, w - 1)) * 4, k = kernel[(ky + r) * size + kx + r];
      ar += s[j] * k; ag += s[j + 1] * k; ab += s[j + 2] * k;
    }
    out[i] = ar / divisor + offset; out[i + 1] = ag / divisor + offset; out[i + 2] = ab / divisor + offset; out[i + 3] = s[i + 3];
  }
  return out;
}

const range = (key, label, min, max, value, step = 1, unit = '') => ({ type: 'range', key, label, min, max, value, step, unit });
const check = (key, label, value = false) => ({ type: 'check', key, label, value });
const color = (key, label, value) => ({ type: 'color', key, label, value });
const angle = (key, label, min, max, value) => ({ type: 'angle', key, label, min, max, value });
const select = (key, label, options, value) => ({ type: 'select', key, label, options, value });

export const FILTERS = [];
const def = (id, name, group, params, run, extra = {}) => FILTERS.push({ id, name, group, params, run, ...extra });

// ---- Blur -----------------------------------------------------------------------------------------
def('gaussianBlur', 'Gaussian Blur', 'Blur', [range('radius', 'Radius', 0.1, 250, 8, 0.1, ' px')], (img, p, env) => {
  const sigma = Math.max(0.1, p.radius);
  if (env.clampEdges && hasOpaqueBorder(img)) { const d = new Uint8ClampedArray(img.data); blurStraight(d, img.w, img.h, sigma); return same(img, d); }
  const pd = Math.ceil(sigma * 3), big = pad(img, pd, pd);
  blurRGBA(big.data, big.w, big.h, sigma, sigma, 'zero');
  return { ...big, growX: pd, growY: pd };
}, { spreads: true });
def('motionBlur', 'Motion Blur', 'Blur', [angle('angle', 'Angle', -90, 90, 0), range('distance', 'Distance', 1, 2000, 20, 1, ' px')], (img, p, env) => {
  const clampEdge = env.clampEdges && hasOpaqueBorder(img), len = Math.max(1, Math.round(p.distance)), rad = p.angle * Math.PI / 180;
  const px = clampEdge ? 0 : Math.ceil(Math.abs(Math.cos(rad)) * len / 2) + 1, py = clampEdge ? 0 : Math.ceil(Math.abs(Math.sin(rad)) * len / 2) + 1, big = pad(img, px, py);
  return { data: motionBlurStraight(big.data, big.w, big.h, len, p.angle, clampEdge), w: big.w, h: big.h, growX: px, growY: py };
}, { spreads: true });
def('boxBlur', 'Box Blur', 'Blur', [range('radius', 'Radius', 1, 200, 5, 1, ' px')], (img, p) => {
  const d = new Uint8ClampedArray(img.data); premul(d);
  const tmp = new Uint8ClampedArray(d.length), r = Math.round(p.radius);
  // one box pass each way through the shared blur kernel
  boxPass(d, tmp, img.w, img.h, r);
  unpremul(tmp); return same(img, tmp);
});
function boxPass(src, dst, w, h, r) {
  const tmp = new Float32Array(src.length), div = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let c = 0; c < 4; c++) { let s = 0; for (let x = -r; x <= r; x++) s += src[(y * w + clamp(x, 0, w - 1)) * 4 + c]; for (let x = 0; x < w; x++) { tmp[(y * w + x) * 4 + c] = s / div; s += src[(y * w + clamp(x + r + 1, 0, w - 1)) * 4 + c] - src[(y * w + clamp(x - r, 0, w - 1)) * 4 + c]; } }
  for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[(clamp(y, 0, h - 1) * w + x) * 4 + c]; for (let y = 0; y < h; y++) { dst[(y * w + x) * 4 + c] = s / div + 0.5; s += tmp[(clamp(y + r + 1, 0, h - 1) * w + x) * 4 + c] - tmp[(clamp(y - r, 0, h - 1) * w + x) * 4 + c]; } }
}
def('radialBlur', 'Radial Blur', 'Blur', [select('mode', 'Method', [['spin', 'Spin'], ['zoom', 'Zoom']], 'zoom'), range('amount', 'Amount', 1, 100, 20), range('cx', 'Center X', 0, 100, 50, 1, '%'), range('cy', 'Center Y', 0, 100, 50, 1, '%')], (img, p) => {
  const { data: d, w, h } = img, out = new Uint8ClampedArray(d.length), S = sampler(img), cx = w * p.cx / 100, cy = h * p.cy / 100, n = 16, amt = p.amount / 100;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = 0; k < n; k++) {
      const t = (k / (n - 1) - 0.5) * amt;
      let sx, sy;
      if (p.mode === 'zoom') { sx = cx + (x - cx) * (1 + t); sy = cy + (y - cy) * (1 + t); }
      else { const c = Math.cos(t), s = Math.sin(t), dx = x - cx, dy = y - cy; sx = cx + dx * c - dy * s; sy = cy + dx * s + dy * c; }
      const v = S(sx, sy, 'clamp'), al = v[3] / 255; r += v[0] * al; g += v[1] * al; b += v[2] * al; a += v[3];
    }
    const o = (y * w + x) * 4, al = a / n / 255;
    out[o + 3] = a / n; if (al > 0) { out[o] = r / n / al; out[o + 1] = g / n / al; out[o + 2] = b / n / al; }
  }
  return same(img, out);
});
def('surfaceBlur', 'Surface Blur', 'Blur', [range('radius', 'Radius', 1, 30, 5), range('threshold', 'Threshold', 1, 255, 30)], (img, p) => {
  const { data: s, w, h } = img, out = new Uint8ClampedArray(s.length), r = Math.round(p.radius), th = p.threshold, sig = (r / 2) ** 2 * 2 || 1, th2 = 2 * (th / 3) ** 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; let sr = 0, sg = 0, sb = 0, sw = 0;
    for (let ky = -r; ky <= r; ky++) { const yy = clamp(y + ky, 0, h - 1); for (let kx = -r; kx <= r; kx++) {
      const j = (yy * w + clamp(x + kx, 0, w - 1)) * 4, dr = s[j] - s[i], dg = s[j + 1] - s[i + 1], db = s[j + 2] - s[i + 2];
      const wt = Math.exp(-(kx * kx + ky * ky) / sig - (dr * dr + dg * dg + db * db) / 3 / th2); sr += s[j] * wt; sg += s[j + 1] * wt; sb += s[j + 2] * wt; sw += wt;
    } }
    out[i] = sr / sw; out[i + 1] = sg / sw; out[i + 2] = sb / sw; out[i + 3] = s[i + 3];
  }
  return same(img, out);
});
def('tiltShift', 'Tilt-Shift', 'Blur', [range('focus', 'Focus position', 0, 100, 50, 1, '%'), range('band', 'Sharp band', 0, 100, 25, 1, '%'), range('blur', 'Blur', 1, 60, 12, 0.5, ' px')], (img, p) => {
  const { w, h } = img, blurred = new Uint8ClampedArray(img.data); blurStraight(blurred, w, h, p.blur);
  const out = new Uint8ClampedArray(img.data), fy = h * p.focus / 100, half = h * p.band / 200, feather = Math.max(1, h * 0.35);
  for (let y = 0; y < h; y++) { const t = clamp01((Math.abs(y - fy) - half) / feather), k = t * t * (3 - 2 * t); for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; for (let c = 0; c < 4; c++) out[i + c] = img.data[i + c] + (blurred[i + c] - img.data[i + c]) * k; } }
  return same(img, out);
});

// ---- Sharpen ---------------------------------------------------------------------------------------
def('sharpen', 'Sharpen', 'Sharpen', [range('amount', 'Amount', 0, 100, 20), range('radius', 'Radius', 0.3, 50, 8, 0.1, ' px')], (img, p) => {
  const d = new Uint8ClampedArray(img.data), soft = new Uint8ClampedArray(img.data), s = p.amount / 100 * 2;
  blurStraight(soft, img.w, img.h, Math.max(0.3, p.radius / 2));
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]) for (let c = 0; c < 3; c++) d[i + c] = d[i + c] + (d[i + c] - soft[i + c]) * s;
  return same(img, d);
}, { identity: (p) => p.amount <= 0 });
def('unsharpMask', 'Unsharp Mask', 'Sharpen', [range('amount', 'Amount', 0, 500, 100, 1, '%'), range('radius', 'Radius', 0.1, 100, 2, 0.1, ' px'), range('threshold', 'Threshold', 0, 255, 0)], (img, p) => {
  const d = new Uint8ClampedArray(img.data), soft = new Uint8ClampedArray(img.data), k = p.amount / 100;
  blurStraight(soft, img.w, img.h, p.radius);
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]) for (let c = 0; c < 3; c++) { const diff = d[i + c] - soft[i + c]; if (Math.abs(diff) >= p.threshold) d[i + c] = d[i + c] + diff * k; }
  return same(img, d);
});
def('highPass', 'High Pass', 'Sharpen', [range('radius', 'Radius', 0.1, 100, 4, 0.1, ' px')], (img, p) => {
  const d = new Uint8ClampedArray(img.data), soft = new Uint8ClampedArray(img.data);
  blurStraight(soft, img.w, img.h, p.radius);
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = d[i + c] - soft[i + c] + 128;
  return same(img, d);
});

// ---- Noise ---------------------------------------------------------------------------------------------
def('addNoise', 'Add Noise', 'Noise', [range('amount', 'Amount', 0, 400, 20, 0.1, '%'), check('gaussian', 'Gaussian'), check('monochrome', 'Monochromatic', true)], (img, p, env) => {
  const d = new Uint8ClampedArray(img.data), spread = clamp(p.amount, 0, 400) / 100 * 127.5, seed = env.seed >>> 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const i = (y * img.w + x) * 4; if (!d[i + 3]) continue;
    const shared = noise(x, y, seed, 0, p.gaussian) * spread;
    for (let c = 0; c < 3; c++) d[i + c] += p.monochrome ? shared : noise(x, y, seed, c, p.gaussian) * spread;
  }
  return same(img, d);
}, { identity: (p) => p.amount <= 0 });
def('median', 'Median (Despeckle)', 'Noise', [range('radius', 'Radius', 1, 6, 1)], (img, p) => {
  const { data: s, w, h } = img, out = new Uint8ClampedArray(s.length), r = Math.round(p.radius), n = (2 * r + 1) ** 2, buf = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let k = 0;
    for (let ky = -r; ky <= r; ky++) for (let kx = -r; kx <= r; kx++) { const j = (clamp(y + ky, 0, h - 1) * w + clamp(x + kx, 0, w - 1)) * 4; buf[0][k] = s[j]; buf[1][k] = s[j + 1]; buf[2][k] = s[j + 2]; k++; }
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) { buf[c].sort(); out[o + c] = buf[c][n >> 1]; }
    out[o + 3] = s[o + 3];
  }
  return same(img, out);
});
def('diffuse', 'Diffuse', 'Noise', [range('distance', 'Distance', 1, 50, 4)], (img, p, env) => {
  const { data: s, w, h } = img, out = new Uint8ClampedArray(s.length), r = Math.round(p.distance), seed = env.seed >>> 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = clamp(x + Math.round(hash(x, y, seed) * r), 0, w - 1), sy = clamp(y + Math.round(hash(y, x, seed ^ 0x9E3779B9) * r), 0, h - 1), i = (y * w + x) * 4, j = (sy * w + sx) * 4;
    out[i] = s[j]; out[i + 1] = s[j + 1]; out[i + 2] = s[j + 2]; out[i + 3] = s[j + 3];
  }
  return same(img, out);
});

// ---- Light and tone ------------------------------------------------------------------------------------
def('vignette', 'Vignette', 'Light', [range('amount', 'Amount', 0, 100, 35), color('color', 'Color', '#000000'), range('midpoint', 'Midpoint', 0, 100, 50), range('roundness', 'Roundness', -100, 100, 100), range('feather', 'Feather', 0, 100, 60), range('highlights', 'Highlights', 0, 100, 25)], (img, p, env) => {
  const d = new Uint8ClampedArray(img.data), { w, h } = img;
  if (p.amount <= 0) return same(img, d);
  const frame = env.frame || { x: 0, y: 0, w, h }, fills = !!env.fillsClear, strength = clamp01(p.amount / 100), n = parseInt(p.color.slice(1), 16), R = (n >> 16 & 255) / 255, G = (n >> 8 & 255) / 255, B = (n & 255) / 255, hl = clamp(p.highlights, 0, 100) / 100;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, a0 = d[i + 3]; if (a0 === 0 && !fills) continue;
    const m = vignetteMask(x + 0.5 - frame.x, y + 0.5 - frame.y, frame.w, frame.h, p.midpoint, p.roundness, p.feather); if (m <= 0) continue;
    let r = 0, g = 0, b = 0, bright = 0; const alpha = a0 / 255;
    if (a0 > 0) { r = d[i] / 255; g = d[i + 1] / 255; b = d[i + 2] / 255; bright = clamp01((rec709(r, g, b) - 0.45) / 0.55); }
    const eff = strength * m * (1 - hl * bright);
    if (!fills) { d[i] = (r + (R - r) * eff) * 255; d[i + 1] = (g + (G - g) * eff) * 255; d[i + 2] = (b + (B - b) * eff) * 255; continue; }
    const oa = alpha + eff * (1 - alpha); if (oa <= 0) continue;
    d[i] = (R * eff + r * alpha * (1 - eff)) / oa * 255; d[i + 1] = (G * eff + g * alpha * (1 - eff)) / oa * 255; d[i + 2] = (B * eff + b * alpha * (1 - eff)) / oa * 255; d[i + 3] = oa * 255;
  }
  return same(img, d);
}, { identity: (p) => p.amount <= 0 });
def('bloom', 'Bloom / Glow', 'Light', [range('amount', 'Amount', 0, 100, 40), range('radius', 'Radius', 0.5, 200, 24, 0.5, ' px')], (img, p, env) => {
  const sigma = Math.max(0.5, p.radius), clampEdge = env.clampEdges && hasOpaqueBorder(img), pd = clampEdge ? 0 : Math.ceil(sigma * 3), big = pad(img, pd, pd), { w, h } = big;
  const lights = new Uint8ClampedArray(big.data); premul(lights);
  for (let i = 0; i < lights.length; i += 4) { const a = big.data[i + 3]; if (!a) continue; const wgt = clamp01((rec709(big.data[i] / 255, big.data[i + 1] / 255, big.data[i + 2] / 255) - 0.4) / 0.6); for (let c = 0; c < 4; c++) lights[i + c] *= wgt; }
  gaussianBlur(lights, w, h, sigma, sigma, 4, clampEdge ? 'clamp' : 'zero');
  const gain = Math.max(0, p.amount / 50), out = new Uint8ClampedArray(big.data); premul(out);
  for (let i = 0; i < out.length; i += 4) {
    const ga = Math.min(255, lights[i + 3] * gain); if (!ga) continue;
    const a = out[i + 3], oa = a + ga - a * ga / 255;
    for (let c = 0; c < 3; c++) out[i + c] = Math.min(oa, out[i + c] + lights[i + c] * gain);
    out[i + 3] = oa;
  }
  unpremul(out);
  return { data: out, w, h, growX: pd, growY: pd };
}, { spreads: true, identity: (p) => p.amount <= 0 });
const smooth = (lo, hi, v) => { const t = clamp01((v - lo) / (hi - lo)); return t * t * (3 - 2 * t); };
def('tonalContrast', 'Tonal Contrast', 'Light', [range('amount', 'Amount', 0, 100, 50), range('radius', 'Radius', 0.5, 200, 16, 0.5, ' px'), range('shadows', 'Shadows', -100, 100, 40), range('midtones', 'Midtones', -100, 100, 60), range('highlights', 'Highlights', -100, 100, 30)], (img, p) => {
  const d = new Uint8ClampedArray(img.data), soft = new Uint8ClampedArray(img.data); blurStraight(soft, img.w, img.h, Math.max(0.5, p.radius));
  const strength = clamp(p.amount, 0, 100) / 50;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3] || !soft[i + 3]) continue;
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, lum = rec709(r, g, b), base = rec709(soft[i] / 255, soft[i + 1] / 255, soft[i + 2] / 255);
    const sh = 1 - smooth(0.15, 0.5, base), hi = smooth(0.5, 0.85, base), mid = 1 - sh - hi, wgt = (p.shadows * sh + p.midtones * mid + p.highlights * hi) / 100;
    const delta = 0.18 * Math.tanh((lum - base) * 6) * wgt * strength * (4 * lum * (1 - lum));
    d[i] = clamp01(r + delta) * 255; d[i + 1] = clamp01(g + delta) * 255; d[i + 2] = clamp01(b + delta) * 255;
  }
  return same(img, d);
}, { identity: (p) => p.amount <= 0 || (!p.shadows && !p.midtones && !p.highlights) });

// ---- Distort -------------------------------------------------------------------------------------------------
def('lensCorrection', 'Lens Correction', 'Distort', [range('distortion', 'Distortion', -100, 100, 0)], (img, p) => {
  const { data: d, w, h } = img, out = new Uint8ClampedArray(d.length), S = sampler(img), cx = w / 2, cy = h / 2, norm = Math.sqrt(cx * cx + cy * cy), k = p.distortion / 100 * 0.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x + 0.5 - cx) / norm, ny = (y + 0.5 - cy) / norm, f = 1 + k * (nx * nx + ny * ny), v = S(cx + nx * f * norm - 0.5, cy + ny * f * norm - 0.5), o = (y * w + x) * 4;
    out[o] = v[0]; out[o + 1] = v[1]; out[o + 2] = v[2]; out[o + 3] = v[3];
  }
  return same(img, out);
}, { identity: (p) => p.distortion === 0 });
const warp = (fn) => (img, p) => {
  const { data: d, w, h } = img, out = new Uint8ClampedArray(d.length), S = sampler(img);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [sx, sy] = fn(x + 0.5, y + 0.5, w, h, p), v = S(sx - 0.5, sy - 0.5, 'clamp'), o = (y * w + x) * 4; out[o] = v[0]; out[o + 1] = v[1]; out[o + 2] = v[2]; out[o + 3] = v[3]; }
  return same(img, out);
};
def('wave', 'Wave', 'Distort', [range('amplitude', 'Amplitude', 0, 200, 10), range('wavelength', 'Wavelength', 2, 500, 60), select('dir', 'Direction', [['h', 'Horizontal'], ['v', 'Vertical']], 'h')], warp((x, y, w, h, p) => (p.dir === 'h' ? [x + Math.sin(y / p.wavelength * 2 * Math.PI) * p.amplitude, y] : [x, y + Math.sin(x / p.wavelength * 2 * Math.PI) * p.amplitude])));
def('ripple', 'Ripple', 'Distort', [range('amplitude', 'Amplitude', 0, 100, 6), range('wavelength', 'Wavelength', 2, 300, 24)], warp((x, y, w, h, p) => { const dx = x - w / 2, dy = y - h / 2, r = Math.hypot(dx, dy) || 1, o = Math.sin(r / p.wavelength * 2 * Math.PI) * p.amplitude; return [x + dx / r * o, y + dy / r * o]; }));
def('twirl', 'Twirl', 'Distort', [range('angle', 'Angle', -720, 720, 90, 1, '°')], warp((x, y, w, h, p) => {
  const cx = w / 2, cy = h / 2, rad = Math.min(w, h) / 2, dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
  if (r >= rad) return [x, y];
  const a = p.angle * Math.PI / 180 * (1 - r / rad) ** 2, c = Math.cos(a), s = Math.sin(a);
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}));
def('spherize', 'Spherize / Pinch', 'Distort', [range('amount', 'Amount', -100, 100, 50)], warp((x, y, w, h, p) => {
  const cx = w / 2, cy = h / 2, rad = Math.min(w, h) / 2, dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
  if (r >= rad || r === 0) return [x, y];
  const t = r / rad, k = p.amount / 100, f = k >= 0 ? Math.pow(t, 1 + k) / t : Math.pow(t, 1 / (1 - k)) / t;
  return [cx + dx * f, cy + dy * f];
}));
def('chromaticAberration', 'Chromatic Aberration', 'Distort', [range('amount', 'Amount', 0, 50, 4, 0.5, ' px'), range('angle', 'Angle', -180, 180, 0, 1, '°')], (img, p) => {
  const { data: d, w, h } = img, out = new Uint8ClampedArray(d.length), rad = p.angle * Math.PI / 180, dx = Math.cos(rad) * p.amount, dy = Math.sin(rad) * p.amount, S = sampler(img);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, a = S(x - dx, y - dy, 'clamp'), c = S(x + dx, y + dy, 'clamp'); out[o] = a[0]; out[o + 1] = d[o + 1]; out[o + 2] = c[2]; out[o + 3] = d[o + 3]; }
  return same(img, out);
});
def('glitch', 'Glitch', 'Distort', [range('amount', 'Amount', 0, 100, 30), range('bands', 'Bands', 1, 60, 14), range('shift', 'RGB shift', 0, 40, 6, 1, ' px')], (img, p, env) => {
  const { data: s, w, h } = img, out = new Uint8ClampedArray(s.length), seed = env.seed >>> 0, bandH = Math.max(1, Math.floor(h / p.bands));
  for (let y = 0; y < h; y++) {
    const band = Math.floor(y / bandH), off = Math.round(hash(band, 7, seed) * w * p.amount / 400), ch = Math.round(p.shift * (hash(band, 3, seed) > 0 ? 1 : 0.5));
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, xr = clamp(x + off + ch, 0, w - 1), xg = clamp(x + off, 0, w - 1), xb = clamp(x + off - ch, 0, w - 1);
      out[o] = s[(y * w + xr) * 4]; out[o + 1] = s[(y * w + xg) * 4 + 1]; out[o + 2] = s[(y * w + xb) * 4 + 2]; out[o + 3] = s[(y * w + xg) * 4 + 3];
    }
  }
  return same(img, out);
});

// ---- Stylize ----------------------------------------------------------------------------------------------------
def('pixelate', 'Pixelate (Mosaic)', 'Stylize', [range('size', 'Cell size', 2, 200, 12, 1, ' px')], (img, p) => {
  const { data: s, w, h } = img, out = new Uint8ClampedArray(s.length), c = Math.round(p.size);
  for (let by = 0; by < h; by += c) for (let bx = 0; bx < w; bx += c) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = by; y < Math.min(h, by + c); y++) for (let x = bx; x < Math.min(w, bx + c); x++) { const i = (y * w + x) * 4, al = s[i + 3]; r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al; n++; }
    const R = a ? r / a : 0, G = a ? g / a : 0, B = a ? b / a : 0, A = a / n;
    for (let y = by; y < Math.min(h, by + c); y++) for (let x = bx; x < Math.min(w, bx + c); x++) { const i = (y * w + x) * 4; out[i] = R; out[i + 1] = G; out[i + 2] = B; out[i + 3] = A; }
  }
  return same(img, out);
});
def('emboss', 'Emboss', 'Stylize', [range('strength', 'Strength', 1, 10, 1, 0.5)], (img, p) => same(img, convolve(img, [-2 * p.strength, -p.strength, 0, -p.strength, 1, p.strength, 0, p.strength, 2 * p.strength], 3, 1, 0)));
def('findEdges', 'Find Edges', 'Stylize', [check('invert', 'Invert', false)], (img, p) => {
  const { data: s, w, h } = img, out = new Uint8ClampedArray(s.length), L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = luma(s[i * 4], s[i * 4 + 1], s[i * 4 + 2]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = (px, py) => L[clamp(py, 0, h - 1) * w + clamp(px, 0, w - 1)];
    const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1), gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    let v = clamp(Math.sqrt(gx * gx + gy * gy), 0, 255); if (!p.invert) v = 255 - v;
    const o = (y * w + x) * 4; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = s[o + 3];
  }
  return same(img, out);
});
def('oilPaint', 'Oil Paint', 'Stylize', [range('radius', 'Brush size', 1, 10, 3), range('levels', 'Levels', 4, 50, 20)], (img, p) => {
  const { data: s, w, h } = img, out = new Uint8ClampedArray(s.length), r = Math.round(p.radius), L = Math.round(p.levels);
  const cnt = new Int32Array(L), sr = new Float32Array(L), sg = new Float32Array(L), sb = new Float32Array(L);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0);
    for (let ky = -r; ky <= r; ky++) for (let kx = -r; kx <= r; kx++) { const j = (clamp(y + ky, 0, h - 1) * w + clamp(x + kx, 0, w - 1)) * 4, bin = Math.min(L - 1, Math.floor((s[j] + s[j + 1] + s[j + 2]) / 3 * L / 256)); cnt[bin]++; sr[bin] += s[j]; sg[bin] += s[j + 1]; sb[bin] += s[j + 2]; }
    let best = 0; for (let b = 1; b < L; b++) if (cnt[b] > cnt[best]) best = b;
    const o = (y * w + x) * 4; out[o] = sr[best] / cnt[best]; out[o + 1] = sg[best] / cnt[best]; out[o + 2] = sb[best] / cnt[best]; out[o + 3] = s[o + 3];
  }
  return same(img, out);
});
def('halftone', 'Halftone', 'Stylize', [range('size', 'Dot size', 3, 60, 8), range('angle', 'Angle', 0, 90, 45, 1, '°'), check('color', 'Color dots', false)], (img, p) => {
  const { data: s, w, h } = img, out = new Uint8ClampedArray(s.length), c = p.size, a = p.angle * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x * cos + y * sin, v = -x * sin + y * cos, cu = (Math.floor(u / c) + 0.5) * c, cv = (Math.floor(v / c) + 0.5) * c;
    const sx = clamp(Math.round(cu * cos - cv * sin), 0, w - 1), sy = clamp(Math.round(cu * sin + cv * cos), 0, h - 1), j = (sy * w + sx) * 4, lum = luma(s[j], s[j + 1], s[j + 2]) / 255;
    const dist = Math.hypot(u - cu, v - cv), radius = c * 0.72 * Math.sqrt(1 - lum), cover = clamp01(radius - dist + 0.5), o = (y * w + x) * 4;
    const col = p.color ? [s[j], s[j + 1], s[j + 2]] : [0, 0, 0];
    out[o] = 255 + (col[0] - 255) * cover; out[o + 1] = 255 + (col[1] - 255) * cover; out[o + 2] = 255 + (col[2] - 255) * cover; out[o + 3] = s[(y * w + x) * 4 + 3];
  }
  return same(img, out);
});
def('crystallize', 'Crystallize', 'Stylize', [range('size', 'Cell size', 4, 200, 24)], (img, p, env) => {
  const { data: s, w, h } = img, out = new Uint8ClampedArray(s.length), c = p.size, seed = env.seed >>> 0, cols = Math.ceil(w / c) + 2;
  const jit = (gx, gy) => [(gx + 0.5 + hash(gx, gy, seed) * 0.45) * c, (gy + 0.5 + hash(gy, gx, seed ^ 0x5bd1e995) * 0.45) * c];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx0 = Math.floor(x / c), gy0 = Math.floor(y / c); let best = Infinity, bx = 0, by = 0;
    for (let gy = gy0 - 1; gy <= gy0 + 1; gy++) for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) { const [px, py] = jit(gx, gy), d2 = (px - x) ** 2 + (py - y) ** 2; if (d2 < best) { best = d2; bx = px; by = py; } }
    const j = (clamp(Math.round(by), 0, h - 1) * w + clamp(Math.round(bx), 0, w - 1)) * 4, o = (y * w + x) * 4;
    out[o] = s[j]; out[o + 1] = s[j + 1]; out[o + 2] = s[j + 2]; out[o + 3] = s[j + 3];
  }
  return same(img, out);
});
def('minimum', 'Minimum (Erode)', 'Stylize', [range('radius', 'Radius', 1, 20, 2)], (img, p) => morphRgb(img, p.radius, false));
def('maximum', 'Maximum (Dilate)', 'Stylize', [range('radius', 'Radius', 1, 20, 2)], (img, p) => morphRgb(img, p.radius, true));
function morphRgb(img, r, isMax) {
  const { data: s, w, h } = img, out = new Uint8ClampedArray(s.length);
  for (let c = 0; c < 3; c++) { const plane = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) plane[i] = s[i * 4 + c]; const m = isMax ? morph(plane, w, h, Math.round(r), true) : morph(plane.map((v) => 255 - v), w, h, Math.round(r), true).map((v) => 255 - v); for (let i = 0; i < w * h; i++) out[i * 4 + c] = m[i]; }
  for (let i = 0; i < w * h; i++) out[i * 4 + 3] = s[i * 4 + 3];
  return same(img, out);
}
def('outline', 'Outline', 'Stylize', [range('thickness', 'Thickness', 1, 50, 2, 1, ' px'), color('color', 'Color', '#000000')], (img, p) => {
  const { data: s, w, h } = img, alpha = new Uint8Array(w * h), n = parseInt(p.color.slice(1), 16);
  for (let i = 0; i < w * h; i++) alpha[i] = s[i * 4 + 3] > 10 ? 255 : 0;
  const grown = morph(alpha, w, h, Math.round(p.thickness), true), out = new Uint8ClampedArray(s);
  for (let i = 0; i < w * h; i++) if (!alpha[i] && grown[i]) { out[i * 4] = n >> 16 & 255; out[i * 4 + 1] = n >> 8 & 255; out[i * 4 + 2] = n & 255; out[i * 4 + 3] = 255; }
  return same(img, out);
});
def('painterly', 'Painterly', 'Stylize', [select('style', 'Style', [['impressionist', 'Impressionist'], ['expressionist', 'Expressionist'], ['coloristWash', 'Colorist Wash'], ['pointillist', 'Pointillist']], 'impressionist'), range('brushSize', 'Brush size (0 = auto)', 0, 200, 0, 1, ' px'), range('passes', 'Passes', 1, 4, 3), range('detail', 'Detail', 0, 100, 50)],
  (img, p, env) => same(img, painterly(img.data, img.w, img.h, p, env.seed || 1)), { slow: true });
def('removeBackground', 'Remove Background', 'Other', [range('tolerance', 'Tolerance', 0, 100, 25)], (img, p) => {
  const { data: s, w, h } = img, bg = backdropPlane(s, w, h, Math.round(clamp(p.tolerance / 100 * 160, 2, 200))), out = new Uint8ClampedArray(s);
  gaussianBlur(bg, w, h, 1, 1, 1, 'zero');
  for (let i = 0; i < w * h; i++) out[i * 4 + 3] = s[i * 4 + 3] * (1 - bg[i] / 255);
  return same(img, out);
});

// Camera Raw Filter: all settings travel as one object (`p.settings`); the grouped dialog lives in ui/camera-raw-dialog.js. Its group is not in FILTER_GROUPS, so it sits at the top of the Filter menu.
def('cameraRaw', 'Camera Raw Filter', 'Raw', [], (img, p, env) => same(img, cameraRaw(new Uint8ClampedArray(img.data), img.w, img.h, p.settings, { seed: env.seed || 1 })), { slow: true, shortcut: 'Ctrl+Shift+A', identity: (p) => isIdentitySettings(p.settings) });

export const FILTER_BY_ID = Object.fromEntries(FILTERS.map((f) => [f.id, f]));
export const FILTER_GROUPS = ['Blur', 'Sharpen', 'Noise', 'Light', 'Distort', 'Stylize', 'Other'];
export const defaultParams = (f) => Object.fromEntries(f.params.map((q) => [q.key, q.value]));
export const isIdentityFilter = (f, p) => !!f.identity?.(p);
export function runFilter(id, params, data, w, h, env = {}) {
  const f = FILTER_BY_ID[id];
  if (!f) throw new Error('Unknown filter ' + id);
  return f.run({ data, w, h }, { ...defaultParams(f), ...params }, env);
}
export { PAINTERLY_STYLES };
