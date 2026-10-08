// Camera Raw Filter (port of Composa.Filters.CameraRaw + CameraRawPixels). Settings are a plain object; `cameraRaw` runs the
// pipeline over straight RGBA bytes in this order: calibration, white balance + Light + Color, curve / mixer / grading,
// Effects (texture, clarity, dehaze, glow, vignette), grain, optics, detail. Pure: runs in the filter worker.
import { applyAdjustment, vignetteMask } from './adjust.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const cl = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rec = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export const TEMPERATURE_GAIN = 0.35, TINT_RED_BLUE = 0.15, TINT_GREEN = 0.30;
export const GROUPS = ['light', 'color', 'grading', 'effects', 'curve', 'mixer', 'detail', 'optics', 'calibration'];
export const MIXER_NAMES = ['Reds', 'Oranges', 'Yellows', 'Greens', 'Aquas', 'Blues', 'Purples', 'Magentas'];
export const MIXER_CENTERS = [0, 30, 60, 120, 180, 240, 270, 300];
export const WHEEL_NAMES = ['Shadows', 'Midtones', 'Highlights', 'Global'];
export const CALIBRATION_SUMMARY = [
  'Earliest response. Hue, saturation and shadow tint move about half as far as Version 6.',
  'A little stronger than Version 1. The sliders below still fall well short of the current look.',
  'Firmer color than Version 2. Primary shifts stay gentler than the current process.',
  'The 2012 response. Calibration reaches most of the strength used by Version 6.',
  'Close to the current process, with slightly softer primary and shadow shifts.',
  'Current default. The calibration sliders below apply at full strength.',
];
export const linearCurve = () => [{ x: 0, y: 0 }, { x: 255, y: 255 }];
const zeros = () => new Array(8).fill(0);
const wheel = () => ({ hue: 0, saturation: 0, luminance: 0 });

export const defaultSettings = () => ({
  whiteBalance: 'custom', temperature: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0,
  texture: 0, clarity: 0, dehaze: 0, glow: 0, glowStyle: 'diffusion', glowRange: 0, glowSpread: 0, glowWarmth: 0,
  vignetteAmount: 0, vignetteStyle: 'highlight', vignetteMidpoint: 50, vignetteRoundness: 0, vignetteFeather: 50, vignetteHighlights: 0,
  grainAmount: 0, grainSize: 25, grainRoughness: 50,
  curve: { shadows: 0, darks: 0, lights: 0, highlights: 0, shadowSplit: 25, darkSplit: 50, lightSplit: 75, refineSaturation: 0, channels: [linearCurve(), linearCurve(), linearCurve(), linearCurve()] },
  mixer: { hue: zeros(), saturation: zeros(), luminance: zeros() },
  grading: { wheels: [wheel(), wheel(), wheel(), wheel()], blending: 50, balance: 0 },
  detail: { sharpenAmount: 0, sharpenRadius: 10, sharpenDetail: 25, sharpenMasking: 0, noiseLuminance: 0, noiseLuminanceDetail: 50, noiseLuminanceContrast: 0, noiseColor: 0, noiseColorDetail: 50, noiseColorSmoothness: 50 },
  optics: { chromatic: false, lensProfile: false, profileDistortion: 100, profileVignetting: 100, distortion: 0, purpleAmount: 0, purpleHueLow: 270, purpleHueHigh: 310, greenAmount: 0, greenHueLow: 60, greenHueHigh: 120, vignetteAmount: 0, vignetteMidpoint: 50 },
  calibration: { process: 6, shadowTint: 0, redHue: 0, redSaturation: 0, greenHue: 0, greenSaturation: 0, blueHue: 0, blueSaturation: 0 },
});

const GROUP_KEYS = {
  light: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  color: ['temperature', 'tint', 'vibrance', 'saturation', 'whiteBalance'],
  effects: ['texture', 'clarity', 'dehaze', 'glow', 'glowStyle', 'glowRange', 'glowSpread', 'glowWarmth', 'vignetteAmount', 'vignetteStyle', 'vignetteMidpoint', 'vignetteRoundness', 'vignetteFeather', 'vignetteHighlights', 'grainAmount', 'grainSize', 'grainRoughness'],
  curve: ['curve'], mixer: ['mixer'], grading: ['grading'], detail: ['detail'], optics: ['optics'], calibration: ['calibration'],
};

const isLinear = (p) => p.length === 2 && p[0].x === 0 && p[0].y === 0 && p[1].x === 255 && p[1].y === 255;
const ADJUSTS = {
  light: (s) => s.exposure || s.contrast || s.highlights || s.shadows || s.whites || s.blacks,
  color: (s) => s.temperature || s.tint || s.vibrance || s.saturation,
  effects: (s) => s.texture || s.clarity || s.dehaze || s.glow || s.vignetteAmount || s.grainAmount,
  curve: ({ curve: c }) => c.shadows || c.darks || c.lights || c.highlights || c.refineSaturation || c.channels.some((p) => !isLinear(p)),
  mixer: ({ mixer: m }) => [m.hue, m.saturation, m.luminance].some((a) => a.some((v) => v)),
  grading: ({ grading: g }) => g.wheels.some((w) => w.saturation || w.luminance),
  detail: ({ detail: d }) => d.sharpenAmount || d.noiseLuminance || d.noiseColor,
  optics: ({ optics: o }) => o.chromatic || o.lensProfile || o.distortion || o.purpleAmount || o.greenAmount || o.vignetteAmount,
  calibration: ({ calibration: c }) => c.shadowTint || c.redHue || c.redSaturation || c.greenHue || c.greenSaturation || c.blueHue || c.blueSaturation,
};
export const adjustsGroup = (s, group) => !!ADJUSTS[group](s);
export const isIdentitySettings = (s) => !s || GROUPS.every((g) => !adjustsGroup(s, g));

// The grade with a group's amounts put back to their defaults (the group's eye switched off).
export function withoutGroup(s, group) {
  const fresh = defaultSettings(), out = { ...s };
  for (const k of GROUP_KEYS[group]) out[k] = fresh[k];
  return out;
}

// Returns a copy of `s` with the value at `path` (['curve', 'channels', 0] ...) replaced; arrays and objects on the way are cloned.
export function put(s, path, value) {
  if (!path.length) return value;
  const [k, ...rest] = path, copy = Array.isArray(s) ? [...s] : { ...s };
  copy[k] = put(s[k], rest, value);
  return copy;
}

const fill = (base, given) => {
  if (Array.isArray(base)) return Array.isArray(given) ? base.map((b, i) => fill(b, given[i])) : base;
  if (base && typeof base === 'object') return Object.fromEntries(Object.entries(base).map(([k, b]) => [k, fill(b, given?.[k])]));
  return typeof base === 'number' ? (Number.isFinite(given) ? given : base) : given ?? base;
};
function repairCurve(points) {
  const sorted = (points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
  if (sorted.length < 2) return linearCurve();
  const kept = [{ x: 0, y: clamp(sorted[0].y, 0, 255) }];
  for (const p of sorted.slice(1, -1)) { const x = clamp(p.x, 2.55, 252.45); if (x > kept[kept.length - 1].x + 2.55) kept.push({ x, y: clamp(p.y, 0, 255) }); }
  kept.push({ x: 255, y: clamp(sorted[sorted.length - 1].y, 0, 255) });
  return kept;
}
export function normalizeSettings(given) {
  const s = fill(defaultSettings(), given), c = s.curve, o = s.optics;
  c.shadowSplit = clamp(c.shadowSplit, 5, 90); c.darkSplit = clamp(c.darkSplit, c.shadowSplit + 2, 95); c.lightSplit = clamp(c.lightSplit, c.darkSplit + 2, 98);
  c.channels = (given?.curve?.channels || c.channels).slice(0, 4).map(repairCurve);
  while (c.channels.length < 4) c.channels.push(linearCurve());
  if (o.purpleHueLow > o.purpleHueHigh) [o.purpleHueLow, o.purpleHueHigh] = [o.purpleHueHigh, o.purpleHueLow];
  if (o.greenHueLow > o.greenHueHigh) [o.greenHueLow, o.greenHueHigh] = [o.greenHueHigh, o.greenHueLow];
  s.calibration.process = clamp(Math.round(s.calibration.process), 1, 6);
  return s;
}

// ---- color math ---------------------------------------------------------------------------------------------
export const srgbToLinear = (e) => (e <= 0.04045 ? e / 12.92 : Math.pow((e + 0.055) / 1.055, 2.4));
const linearToSrgb = (l) => (l <= 0 ? 0 : l >= 1 ? 1 : l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

// Temperature / Tint that bring one linear-light color to neutral, using the gains the pixel loop multiplies.
export function neutralize(r, g, b) {
  if (r <= 1e-4 || g <= 1e-4 || b <= 1e-4) return null;
  const a1 = TEMPERATURE_GAIN * r, b1 = TINT_RED_BLUE * r + TINT_GREEN * g, c1 = g - r, a2 = -TEMPERATURE_GAIN * b, b2 = TINT_RED_BLUE * b + TINT_GREEN * g, c2 = g - b;
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-8) return null;
  const warm = (c1 * b2 - c2 * b1) / det, magenta = (a1 * c2 - a2 * c1) / det;
  return Number.isFinite(warm) && Number.isFinite(magenta) ? { temperature: clamp(warm * 100, -100, 100), tint: clamp(magenta * 100, -100, 100) } : null;
}
export const neutralizeSrgb = (r, g, b) => neutralize(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));

// Gray-world balance of the opaque pixels.
export function autoBalance({ data: d, width: w, height: h }) {
  const step = Math.max(1, Math.floor(Math.sqrt(w * h / 250000)));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * 4, a = d[i + 3]; if (!a) continue;
    r += srgbToLinear(Math.min(1, d[i] / a)); g += srgbToLinear(Math.min(1, d[i + 1] / a)); b += srgbToLinear(Math.min(1, d[i + 2] / a)); n++;
  }
  return n ? neutralize(r / n, g / n, b / n) : null;
}
export function straightColor({ data: d, width: w, height: h }, x, y) {
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const i = (y * w + x) * 4; if (!d[i + 3]) return null;
  return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
}

// Working colour of the pixel being processed; every stage reads it with `load`, edits it in place and stores it with `save`.
const v = [0, 0, 0];
const load = (d, i) => { v[0] = d[i] / 255; v[1] = d[i + 1] / 255; v[2] = d[i + 2] / 255; };
const save = (d, i) => { d[i] = v[0] * 255; d[i + 1] = v[1] * 255; d[i + 2] = v[2] * 255; };
const lum = () => rec(v[0], v[1], v[2]);
function scaleLuminance(target) {
  target = cl(target);
  const y = lum();
  if (Math.abs(target - y) < 1e-8) return;
  if (y < 1e-8) { if (target > y) v[0] = v[1] = v[2] = target; return; }
  const k = target / y;
  v[0] = cl(v[0] * k); v[1] = cl(v[1] * k); v[2] = cl(v[2] * k);
}
function saturate(factor) {
  const y = lum();
  v[0] = cl(y + (v[0] - y) * factor); v[1] = cl(y + (v[1] - y) * factor); v[2] = cl(y + (v[2] - y) * factor);
}
function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d < 1e-6) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6; if (h < 0) h += 1;
  return [h, s, l];
}
const hueToRgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
function hslToRgb(h, s, l) {
  if (s <= 1e-6) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}
function hueDegrees(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  if (c < 1e-6) return 0;
  const h = (max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4) * 60;
  return h < 0 ? h + 360 : h;
}
const loopPixels = (d, w, h, fn) => { for (let i = 0, n = w * h * 4; i < n; i += 4) if (d[i + 3]) fn(i, (i >> 2) % w, ((i >> 2) / w) | 0); };

// Edge-clamped box blur of a float plane.
function boxBlur(src, w, h, radius) {
  if (radius < 1) return Float32Array.from(src);
  const win = radius * 2 + 1, tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const o = y * w; let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[o + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) { tmp[o + x] = sum / win; sum += src[o + clamp(x + radius + 1, 0, w - 1)] - src[o + clamp(x - radius, 0, w - 1)]; }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = sum / win; sum += tmp[clamp(y + radius + 1, 0, h - 1) * w + x] - tmp[clamp(y - radius, 0, h - 1) * w + x]; }
  }
  return out;
}
const effectsRadius = (r, scale) => Math.round(clamp(r * (scale > 0 ? scale : 1), 1, 64));
function lumaPlane(d, w, h) {
  const out = new Float32Array(w * h);
  loopPixels(d, w, h, (i) => { out[i >> 2] = rec(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255); });
  return out;
}

// ---- Light and Color ----------------------------------------------------------------------------------------
const toneHighlights = (y, a) => { const t = cl((y - 0.5) / 0.5), k = t * t; return a >= 0 ? cl(y + a * k * (1 - y)) : cl(y + a * k * (y - 0.5)); };
const toneShadows = (y, a) => { const t = cl((0.5 - y) / 0.5), k = t * t; return a >= 0 ? cl(y + a * k * (0.5 - y)) : cl(y + a * k * y); };
const toneWhites = (y, a) => (y <= 0.75 ? y : cl(0.75 + (y - 0.75) * (1 + a)));
const toneBlacks = (y, a) => (y >= 0.25 ? y : cl(0.25 + (y - 0.25) * (1 - a)));

function vibranceAndSaturation(vibrance, saturation) {
  const max = Math.max(v[0], v[1], v[2]), min = Math.min(v[0], v[1], v[2]), sat = max <= 1e-8 ? 0 : (max - min) / max, hue = hueDegrees(v[0], v[1], v[2]);
  let skin = 0;
  if (hue >= 10 && hue <= 50) { skin = (hue <= 30 ? (hue - 10) / 20 : (50 - hue) / 20) * cl((sat - 0.15) / 0.35); }
  let amount = vibrance * (1 - sat);
  if (vibrance > 0) amount *= 1 - 0.7 * skin;
  saturate(1 + amount);
  saturate(1 + saturation);
}

function basic(d, w, h, s) {
  const warm = s.temperature / 100, magenta = s.tint / 100;
  const gr = 1 + TEMPERATURE_GAIN * warm + TINT_RED_BLUE * magenta, gg = 1 - TINT_GREEN * magenta, gb = 1 - TEMPERATURE_GAIN * warm + TINT_RED_BLUE * magenta;
  const light = Math.pow(2, s.exposure), contrast = 1 + s.contrast / 100, hi = s.highlights / 100, sh = s.shadows / 100, wh = s.whites / 100, bl = s.blacks / 100, vib = s.vibrance / 100, sat = s.saturation / 100;
  loopPixels(d, w, h, (i) => {
    load(d, i);
    const r = cl(srgbToLinear(v[0]) * gr * light), g = cl(srgbToLinear(v[1]) * gg * light), b = cl(srgbToLinear(v[2]) * gb * light);
    v[0] = cl(0.5 + (linearToSrgb(r) - 0.5) * contrast); v[1] = cl(0.5 + (linearToSrgb(g) - 0.5) * contrast); v[2] = cl(0.5 + (linearToSrgb(b) - 0.5) * contrast);
    scaleLuminance(toneHighlights(lum(), hi));
    scaleLuminance(toneShadows(lum(), sh));
    scaleLuminance(toneWhites(lum(), wh));
    scaleLuminance(toneBlacks(lum(), bl));
    vibranceAndSaturation(vib, sat);
    save(d, i);
  });
}

// ---- Curve, Color Mixer and Color Grading -------------------------------------------------------------------
const pointAt = (pts, x) => {
  if (pts.length < 2) return x;
  let i = 0;
  if (x <= pts[0].x) return pts[0].y; if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
  while (i < pts.length - 2 && pts[i + 1].x <= x) i++;
  const sec = (j) => (pts[j + 1].y - pts[j].y) / (pts[j + 1].x - pts[j].x);
  const slope = (j) => { if (j === 0) return sec(0); if (j === pts.length - 1) return sec(pts.length - 2); const a = sec(j - 1), b = sec(j); return a * b <= 0 ? 0 : 2 / (1 / a + 1 / b); };
  const hh = pts[i + 1].x - pts[i].x, t = clamp((x - pts[i].x) / hh, 0, 1), t2 = t * t, t3 = t2 * t;
  return clamp((2 * t3 - 3 * t2 + 1) * pts[i].y + (t3 - 2 * t2 + t) * hh * slope(i) + (-2 * t3 + 3 * t2) * pts[i + 1].y + (t3 - t2) * hh * slope(i + 1), 0, 255);
};
const channelTable = (pts) => Float32Array.from({ length: 256 }, (_, i) => pointAt(pts, i) / 255);

function parametric(c, tone) {
  const shadow = c.shadowSplit / 100, dark = c.darkSplit / 100, light = c.lightSplit / 100;
  const [amount, low, high] = tone < shadow ? [c.shadows, 0, shadow] : tone < dark ? [c.darks, shadow, dark] : tone < light ? [c.lights, dark, light] : [c.highlights, light, 1];
  const span = Math.max(0.02, high - low), weight = 1 - Math.abs(tone - (low + high) / 2) / (span / 2);
  return cl(tone + amount / 100 * Math.max(0, weight) * 0.22);
}
const lutAt = (lut, x) => { const s = cl(x) * 255, lo = s | 0, hi = lo < 255 ? lo + 1 : 255; return lut[lo] + (lut[hi] - lut[lo]) * (s - lo); };
const circular = (a, b) => { const d = Math.abs(a - b); return d > 0.5 ? 1 - d : d; };

function curveColor(d, w, h, s) {
  const c = s.curve, luma = Float32Array.from({ length: 256 }, (_, i) => pointAt(c.channels[0], parametric(c, i / 255) * 255) / 255);
  const redLut = channelTable(c.channels[1]), greenLut = channelTable(c.channels[2]), blueLut = channelTable(c.channels[3]);
  const refine = c.refineSaturation / 100, m = s.mixer, grade = s.grading, blending = grade.blending / 100, balance = grade.balance / 100;
  const mixing = ADJUSTS.mixer(s), grading = ADJUSTS.grading(s), centers = MIXER_CENTERS.map((x) => x / 360);
  loopPixels(d, w, h, (i) => {
    load(d, i);
    const tone = lum(), mapped = lutAt(luma, tone);
    scaleLuminance(mapped);
    if (refine && tone > 1e-4) saturate(1 + refine * (mapped / tone - 1));
    v[0] = lutAt(redLut, v[0]); v[1] = lutAt(greenLut, v[1]); v[2] = lutAt(blueLut, v[2]);
    if (mixing) {
      let [hh, ss, ll] = rgbToHsl(v[0], v[1], v[2]), hd = 0, sd = 0, ld = 0, ws = 0;
      for (let k = 0; k < 8; k++) {
        const wt = 1 - circular(hh, centers[k]) / (40 / 360);
        if (wt <= 0) continue;
        hd += m.hue[k] / 100 * wt * (30 / 360); sd += m.saturation[k] / 100 * wt; ld += m.luminance[k] / 100 * wt * 0.25; ws += wt;
      }
      if (ws > 1) { hd /= ws; sd /= ws; ld /= ws; }
      hh += hd; if (hh < 0) hh += 1; if (hh >= 1) hh -= 1;
      [v[0], v[1], v[2]] = hslToRgb(hh, cl(ss * (1 + sd)), cl(ll + ld));
    }
    if (grading) {
      const split = 0.5 - balance * 0.2, reach = 0.12 + blending * 0.38, y = lum();
      let sw = cl((split + reach - y) / Math.max(0.05, reach * 2)), hw = cl((y - (split - reach)) / Math.max(0.05, reach * 2)), mw = cl(1 - Math.abs(y - split) / (0.35 + reach));
      const sum = sw + mw + hw;
      if (sum > 1e-4) { sw /= sum; mw /= sum; hw /= sum; }
      const weights = [sw, mw, hw, 1];
      for (let k = 0; k < 4; k++) {
        const g = grade.wheels[k], ws = g.saturation / 100, wl = g.luminance / 100, wt = weights[k];
        if (wt <= 0 || (ws <= 0 && wl === 0)) continue;
        const [cr, cg, cb] = hslToRgb(g.hue / 360, 1, 0.5);
        v[0] = cl(v[0] + (cr - 0.5) * ws * wt * 0.85); v[1] = cl(v[1] + (cg - 0.5) * ws * wt * 0.85); v[2] = cl(v[2] + (cb - 0.5) * ws * wt * 0.85);
        if (wl) scaleLuminance(lum() + wl * 0.25 * wt);
      }
    }
    save(d, i);
  });
}

// ---- Effects ------------------------------------------------------------------------------------------------
function dehaze(amount) {
  const dd = amount / 100, y = lum(), contrast = 1 + 0.8 * dd, pivot = 0.45 - 0.1 * Math.max(0, dd);
  let y2 = cl(pivot + (y - 0.45) * contrast);
  y2 = dd < 0 ? cl(y2 + -dd * (1 - y2) * 0.45) : cl(y2 - dd * Math.max(0, 0.4 - y2));
  scaleLuminance(y2);
  saturate(1 + 0.7 * dd);
}

function effectsVignette(x, y, w, h, s) {
  const amount = s.vignetteAmount; if (!amount) return;
  const mask = vignetteMask(x + 0.5, y + 0.5, w, h, s.vignetteMidpoint, s.vignetteRoundness, s.vignetteFeather);
  let effect = amount / 100 * mask;
  if (effect < 0 && s.vignetteStyle === 'highlight') effect *= 1 - s.vignetteHighlights / 100 * cl((lum() - 0.45) / 0.55);
  if (effect < 0) { const f = 1 + effect; v[0] *= f; v[1] *= f; v[2] *= f; }
  else if (effect > 0) { v[0] += (1 - v[0]) * effect; v[1] += (1 - v[1]) * effect; v[2] += (1 - v[2]) * effect; }
  if (s.vignetteStyle === 'color' && mask > 0) saturate(1 - 0.75 * mask * Math.abs(amount / 100));
}

function effects(d, w, h, s, scale) {
  const { texture, clarity, glow } = s;
  let luma, fine, coarse, glowPlane;
  if (texture || clarity || glow > 0) {
    luma = lumaPlane(d, w, h);
    if (texture) fine = boxBlur(luma, w, h, effectsRadius(1, scale));
    if (clarity) coarse = boxBlur(luma, w, h, effectsRadius(4, scale));
    if (glow > 0) {
      const widened = Math.max(1, (s.glowStyle === 'bloom' ? 2 : 5) * (1 + s.glowSpread / 100)), threshold = 0.55 + 0.4 * (s.glowRange / 100), den = Math.max(0.05, 1 - threshold);
      glowPlane = boxBlur(luma.map((y) => clamp((y - threshold) / den, 0, 1)), w, h, effectsRadius(widened, scale));
    }
  }
  const warmth = s.glowWarmth / 100;
  let gr, gg, gb, gain;
  if (s.glowStyle === 'halation') { gr = 1; gg = 0.35 - 0.3 * warmth; gb = 0.2 - 0.2 * warmth; gain = 1; }
  else { gr = 0.75 + 0.25 * warmth; gg = 0.6 + 0.2 * warmth; gb = 0.75 - 0.6 * warmth; gain = s.glowStyle === 'bloom' ? 1.4 : 1; }
  loopPixels(d, w, h, (i, x, y) => {
    const index = i >> 2;
    load(d, i);
    if (fine || coarse) {
      const tone = lum();
      let delta = 0;
      if (fine) delta += texture / 100 * (tone - fine[index]);
      if (coarse) delta += clarity / 100 * (tone - coarse[index]);
      if (delta) scaleLuminance(tone + delta);
    }
    if (s.dehaze) dehaze(s.dehaze);
    if (glowPlane) { const add = glowPlane[index] * (glow / 100) * gain; v[0] = cl(v[0] + add * gr); v[1] = cl(v[1] + add * gg); v[2] = cl(v[2] + add * gb); }
    effectsVignette(x, y, w, h, s);
    save(d, i);
  });
}

// ---- Optics -------------------------------------------------------------------------------------------------
const hueIn = (hue, lo, hi) => (lo <= hi ? hue >= lo && hue <= hi : hue >= lo || hue <= hi);
function defringe(o) {
  const max = Math.max(v[0], v[1], v[2]), min = Math.min(v[0], v[1], v[2]), chroma = max - min;
  if (chroma < 1e-6) return;
  const hue = hueDegrees(v[0], v[1], v[2]), sat = chroma / max;
  let reduce = 0;
  if (o.purpleAmount > 0 && hueIn(hue, o.purpleHueLow, o.purpleHueHigh)) reduce = Math.max(reduce, o.purpleAmount / 100);
  if (o.greenAmount > 0 && hueIn(hue, o.greenHueLow, o.greenHueHigh)) reduce = Math.max(reduce, o.greenAmount / 100);
  if (reduce > 0) saturate(1 - reduce * sat);
}
function vignetteCorrect(x, y, w, h, amount, midpoint) {
  if (!amount) return;
  const nx = (x + 0.5) / w * 2 - 1, ny = (y + 0.5) / h * 2 - 1, distance = Math.sqrt(nx * nx + ny * ny) / Math.SQRT2, t = cl((distance - midpoint / 100 * 0.85) / 0.35), lift = amount / 100 * (t * t * (3 - 2 * t));
  if (lift > 0) { v[0] = cl(v[0] + (1 - v[0]) * lift); v[1] = cl(v[1] + (1 - v[1]) * lift); v[2] = cl(v[2] + (1 - v[2]) * lift); }
  else { const f = 1 + lift; v[0] *= f; v[1] *= f; v[2] *= f; }
}
// Radial lens warp, the Lens Correction filter's maths with bilinear, alpha-weighted sampling.
function distort(d, w, h, K) {
  const src = new Uint8ClampedArray(d), cx = w / 2, cy = h / 2, norm = Math.sqrt(cx * cx + cy * cy), k = K * 0.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x + 0.5 - cx) / norm, ny = (y + 0.5 - cy) / norm, f = 1 + k * (nx * nx + ny * ny), sx = cx + nx * f * norm - 1, sy = cy + ny * f * norm - 1;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0;
    let r = 0, g = 0, b = 0, a = 0;
    for (let q = 0; q < 4; q++) {
      const px = x0 + (q & 1), py = y0 + (q >> 1);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const j = (py * w + px) * 4, al = src[j + 3] / 255 * ((q & 1 ? tx : 1 - tx) * (q >> 1 ? ty : 1 - ty));
      r += src[j] * al; g += src[j + 1] * al; b += src[j + 2] * al; a += al;
    }
    const o = (y * w + x) * 4;
    d[o] = a ? r / a : 0; d[o + 1] = a ? g / a : 0; d[o + 2] = a ? b / a : 0; d[o + 3] = a * 255;
  }
}
// Slides red and blue apart radially, opposite to how a lens fringes them.
function chromatic(d, w, h, strength) {
  const src = new Uint8ClampedArray(d), cx = w / 2, cy = h / 2, maxR = Math.sqrt(cx * cx + cy * cy);
  loopPixels(d, w, h, (i, x, y) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, radial = Math.sqrt(dx * dx + dy * dy) / maxR, shift = strength * radial * radial * 2.5, row = y * w;
    const pr = (row + clamp(Math.round(x - shift), 0, w - 1)) * 4, pb = (row + clamp(Math.round(x + shift), 0, w - 1)) * 4;
    d[i] = src[pr + 3] ? src[pr] : src[i]; d[i + 2] = src[pb + 3] ? src[pb + 2] : src[i + 2];
  });
}
function optics(d, w, h, o) {
  const K = o.distortion / 100 + (o.lensProfile ? o.profileDistortion / 100 : 0);
  if (K) distort(d, w, h, K);
  if (o.chromatic) chromatic(d, w, h, 0.45);
  const vignette = o.vignetteAmount + (o.lensProfile ? o.profileVignetting / 100 * 35 : 0);
  if (!o.purpleAmount && !o.greenAmount && !vignette) return;
  loopPixels(d, w, h, (i, x, y) => { load(d, i); defringe(o); vignetteCorrect(x, y, w, h, vignette, o.vignetteMidpoint); save(d, i); });
}

// ---- Detail -------------------------------------------------------------------------------------------------
function edgeAt(luma, w, h, x, y, radius) {
  const r = Math.max(1, radius), c = luma[y * w + x];
  let sum = 0, n = 0;
  for (let dy = -r; dy <= r; dy += r) for (let dx = -r; dx <= r; dx += r) {
    if (!dx && !dy) continue;
    const sx = x + dx, sy = y + dy;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    sum += Math.abs(luma[sy * w + sx] - c); n++;
  }
  return n ? sum / n : 0;
}
function detail(d, w, h, o, scale) {
  let luma = lumaPlane(d, w, h);
  if (o.noiseLuminance > 0) {
    const work = boxBlur(luma, w, h, effectsRadius(1 + o.noiseLuminance / 50, scale)), strength = o.noiseLuminance / 100, preserve = o.noiseLuminanceDetail / 100, contrast = o.noiseLuminanceContrast / 100, smoothed = new Float32Array(luma.length);
    loopPixels(d, w, h, (i, x, y) => {
      const index = i >> 2, local = strength * (1 - preserve * Math.min(1, edgeAt(luma, w, h, x, y, 1) * 6));
      let target = luma[index] * (1 - local) + work[index] * local;
      if (contrast) target += contrast * 0.25 * (luma[index] - work[index]);
      smoothed[index] = target;
      load(d, i); scaleLuminance(target); save(d, i);
    });
    luma = smoothed;
  }
  if (o.noiseColor > 0) {
    const chroma = new Float32Array(w * h);
    loopPixels(d, w, h, (i) => { load(d, i); chroma[i >> 2] = rgbToHsl(v[0], v[1], v[2])[1]; });
    const blurred = boxBlur(chroma, w, h, effectsRadius(1 + o.noiseColorSmoothness / 40, scale)), strength = o.noiseColor / 100, preserve = o.noiseColorDetail / 100;
    loopPixels(d, w, h, (i) => {
      const index = i >> 2, local = strength * (1 - preserve * Math.min(1, Math.abs(chroma[index] - blurred[index]) * 4)), sat = chroma[index] * (1 - local) + blurred[index] * local;
      load(d, i);
      const [hh, , l] = rgbToHsl(v[0], v[1], v[2]);
      [v[0], v[1], v[2]] = hslToRgb(hh, sat, l); save(d, i);
    });
  }
  if (o.sharpenAmount > 0) {
    luma = lumaPlane(d, w, h);
    const radius = effectsRadius(clamp(0.5 + o.sharpenRadius / 100 * 2.5, 0.5, 64), 1), work = boxBlur(luma, w, h, radius), amount = o.sharpenAmount / 100, mix = o.sharpenDetail / 100, threshold = o.sharpenMasking / 100 * 0.35;
    loopPixels(d, w, h, (i, x, y) => {
      const index = i >> 2, mask = cl((edgeAt(luma, w, h, x, y, radius) * (0.5 + mix) - threshold) / Math.max(0.04, 0.35 - threshold * 0.5));
      load(d, i); scaleLuminance(luma[index] + (luma[index] - work[index]) * amount * mask * (0.5 + mix)); save(d, i);
    });
  }
}

// ---- Calibration --------------------------------------------------------------------------------------------
function calibrate(d, w, h, c) {
  const k = [0.55, 0.65, 0.75, 0.85, 0.92, 1][c.process - 1], tint = c.shadowTint / 100 * k;
  const rh = c.redHue / 100 * (15 / 360) * k, rs = c.redSaturation / 100 * 0.45 * k, gh = c.greenHue / 100 * (15 / 360) * k, gs = c.greenSaturation / 100 * 0.45 * k, bh = c.blueHue / 100 * (15 / 360) * k, bs = c.blueSaturation / 100 * 0.45 * k;
  loopPixels(d, w, h, (i) => {
    load(d, i);
    const [r, g, b] = v;
    let [hh, ss, ll] = rgbToHsl(r, g, b);
    if (ll < 0.35 && tint) { hh += tint * 0.06; if (hh < 0) hh += 1; if (hh >= 1) hh -= 1; }
    if (Math.max(r, g, b) - Math.min(r, g, b) > 1e-5) {
      if (r >= g && r >= b) { hh += rh; ss = cl(ss * (1 + rs)); } else if (g >= r && g >= b) { hh += gh; ss = cl(ss * (1 + gs)); } else { hh += bh; ss = cl(ss * (1 + bs)); }
      if (hh < 0) hh += 1; if (hh >= 1) hh -= 1;
    }
    [v[0], v[1], v[2]] = hslToRgb(hh, ss, ll); save(d, i);
  });
}

// ---- Pipeline -----------------------------------------------------------------------------------------------
export function cameraRaw(d, w, h, settings, { scale = 1, seed = 1 } = {}) {
  const s = normalizeSettings(settings);
  if (isIdentitySettings(s)) return d;
  if (s.calibration && ADJUSTS.calibration(s)) calibrate(d, w, h, s.calibration);
  if (ADJUSTS.light(s) || ADJUSTS.color(s)) basic(d, w, h, s);
  if (ADJUSTS.curve(s) || ADJUSTS.mixer(s) || ADJUSTS.grading(s)) curveColor(d, w, h, s);
  if (s.texture || s.clarity || s.dehaze || s.glow > 0 || s.vignetteAmount) effects(d, w, h, s, scale);
  if (s.grainAmount > 0) applyAdjustment({ type: 'grain', amount: s.grainAmount, size: 0.5 + s.grainSize / 100 * 19.5, roughness: s.grainRoughness, seed: seed >>> 0 }, d, w, h, 0, 0, 1);
  if (ADJUSTS.optics(s)) optics(d, w, h, s.optics);
  if (ADJUSTS.detail(s)) detail(d, w, h, s.detail, scale);
  return d;
}
