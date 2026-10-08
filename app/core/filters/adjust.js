// Colour adjustments (port of Composa.Filters.Adjustments). One set of settings drives a destructive Image-menu
// command and a live adjustment layer. Adjustments are plain objects { type, ...settings }, replaced rather than
// mutated. `applyAdjustment` changes straight RGBA bytes in place and leaves alpha alone. Pure: runs in a worker too.
import { gaussianBlur } from './blur.js';
import { applyLut } from './lut.js';

export const ADJUSTMENT_TYPES = ['brightnessContrast', 'levels', 'curves', 'hueSaturation', 'exposure', 'blackAndWhite', 'colorBalance', 'gradientMap', 'lut', 'grain', 'invert',
  'vibrance', 'threshold', 'posterize', 'desaturate', 'sepia', 'solarize', 'gaussianBlur', 'motionBlur', 'addNoise'];
export const ADJUSTMENT_NAMES = {
  brightnessContrast: 'Brightness/Contrast', levels: 'Levels', curves: 'Curves', hueSaturation: 'Hue/Saturation', exposure: 'Exposure', blackAndWhite: 'Black & White',
  colorBalance: 'Color Balance', gradientMap: 'Gradient Map', lut: 'LUT', grain: 'Grain', invert: 'Invert', vibrance: 'Vibrance', threshold: 'Threshold', posterize: 'Posterize',
  desaturate: 'Desaturate', sepia: 'Sepia', solarize: 'Solarize', gaussianBlur: 'Gaussian Blur', motionBlur: 'Motion Blur', addNoise: 'Add Noise',
};
const seed = () => (Math.random() * 4294967296) >>> 0;
const range = () => ({ inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 });
const line = () => [{ x: 0, y: 0 }, { x: 255, y: 255 }];

export function createAdjustment(type) {
  switch (type) {
    case 'brightnessContrast': return { type, brightness: 0, contrast: 0 };
    case 'levels': return { type, ranges: [range(), range(), range(), range()] };
    case 'curves': return { type, channels: [line(), line(), line(), line()] };
    case 'hueSaturation': return { type, shifts: Array.from({ length: 7 }, () => ({ hue: 0, saturation: 0, lightness: 0 })), colorize: false };
    case 'exposure': return { type, exposure: 0, offset: 0, gamma: 1 };
    case 'lut': return { type, preset: 'leikuNatural', amount: 100, cube: null, cubeName: '' };
    case 'gradientMap': return { type, shadows: '#000000', highlights: '#ffffff', reversed: false };
    case 'grain': return { type, amount: 25, size: 1.5, roughness: 50, seed: seed() };
    case 'invert': return { type };
    case 'blackAndWhite': return { type, weights: [40, 60, 40, 60, 20, 80], tint: false, tintHue: 40, tintSaturation: 20 };
    case 'colorBalance': return { type, shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true };
    case 'vibrance': return { type, amount: 0, saturation: 0 };
    case 'threshold': return { type, level: 128 };
    case 'posterize': return { type, levels: 4 };
    case 'desaturate': case 'sepia': return { type, amount: 100 };
    case 'solarize': return { type, threshold: 128 };
    case 'gaussianBlur': return { type, radius: 10 };
    case 'motionBlur': return { type, angle: 0, distance: 10 };
    case 'addNoise': return { type, amount: 10, gaussian: false, monochromatic: false, seed: seed() };
    default: throw new Error('Unknown adjustment ' + type);
  }
}
export const adjustmentName = (a) => ADJUSTMENT_NAMES[a.type] || a.type;
export const isBlurAdjustment = (a) => a.type === 'gaussianBlur' || a.type === 'motionBlur';
// How far (document pixels) a pixel's result depends on its neighbours.
export const samplingMargin = (a) => (a.type === 'gaussianBlur' ? Math.min(250, Math.max(0, a.radius)) * 3 + 2 : a.type === 'motionBlur' ? Math.min(2000, Math.max(0, a.distance)) / 2 + 2 : 0);

export function isIdentity(a) {
  switch (a.type) {
    case 'brightnessContrast': return !a.brightness && !a.contrast;
    case 'levels': return a.ranges.every((r) => r.inputBlack === 0 && r.inputWhite === 255 && r.gamma === 1 && r.outputBlack === 0 && r.outputWhite === 255);
    case 'curves': return a.channels.every((c) => c.every((p) => p.x === p.y));
    case 'hueSaturation': return !a.colorize && a.shifts.every((s) => !s.hue && !s.saturation && !s.lightness);
    case 'exposure': return !a.exposure && !a.offset && a.gamma === 1;
    case 'grain': case 'addNoise': return a.amount <= 0;
    case 'colorBalance': return [a.shadows, a.midtones, a.highlights].every((v) => v.every((x) => !x));
    case 'vibrance': return !a.amount && !a.saturation;
    case 'lut': return a.amount <= 0 || (a.preset === 'custom' && !a.cube);
    case 'gaussianBlur': return a.radius <= 0;
    case 'motionBlur': return a.distance <= 0;
    case 'desaturate': case 'sepia': return a.amount <= 0;
    default: return false;
  }
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const toByte = (u) => { const v = Math.round(u * 255); return v < 0 ? 0 : v > 255 ? 255 : v; };
const luma = (r, g, b) => (r * 54 + g * 183 + b * 19) >> 8;

// ---- hashing noise (Composa GrainAdjustment.Hash / ImageFilters.Noise) ---------------------------
export function hash(x, y, sd) {
  let h = (Math.imul(x, 0x85EBCA6B) ^ Math.imul(y, 0xC2B2AE35) ^ Math.imul(sd, 0x27D4EB2F)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297A2D39) >>> 0; h ^= h >>> 15;
  return ((h & 0xFFFFFF) / 0xFFFFFF) * 2 - 1;
}
export function noise(x, y, sd, channel, gaussian) {
  const key = (sd + Math.imul(channel, 0x9E3779B9)) >>> 0, n = hash(x, y, key);
  if (!gaussian) return n;
  const sum = n + hash(x, y, (key + 0x7F4A7C15) >>> 0) + hash(x, y, (key + 0x3C6EF372) >>> 0);
  return Math.max(-1, Math.min(1, sum / 3 * 1.7));
}
function smoothNoise(x, y, sd) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  let fx = x - x0, fy = y - y0;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, sd), top = a + (hash(x0 + 1, y0, sd) - a) * fx, c = hash(x0, y0 + 1, sd), bottom = c + (hash(x0 + 1, y0 + 1, sd) - c) * fx;
  return top + (bottom - top) * fy;
}

// ---- tables -----------------------------------------------------------------------------------------
function levelsMap(r, v) {
  const span = Math.max(1, r.inputWhite - r.inputBlack);
  let t = Math.max(0, Math.min(1, (v - r.inputBlack) / span));
  t = Math.pow(t, 1 / Math.max(0.1, Math.min(9.99, r.gamma)));
  return r.outputBlack + (r.outputWhite - r.outputBlack) * t;
}
// Shape-preserving cubic Hermite through the curve points, so it never overshoots its handles.
export function curveValue(p, x) {
  if (x <= p[0].x) return p[0].y;
  if (x >= p[p.length - 1].x) return p[p.length - 1].y;
  let i = 0;
  while (i < p.length - 2 && p[i + 1].x <= x) i++;
  const secant = (j) => (p[j + 1].y - p[j].y) / (p[j + 1].x - p[j].x);
  const slope = (j) => {
    if (j === 0) return secant(0);
    if (j === p.length - 1) return secant(p.length - 2);
    const a = secant(j - 1), b = secant(j);
    return a * b <= 0 ? 0 : 2 / (1 / a + 1 / b);
  };
  const h = p[i + 1].x - p[i].x, t = Math.max(0, Math.min(1, (x - p[i].x) / h)), t2 = t * t, t3 = t2 * t;
  const y = (2 * t3 - 3 * t2 + 1) * p[i].y + (t3 - 2 * t2 + t) * h * slope(i) + (-2 * t3 + 3 * t2) * p[i + 1].y + (t3 - t2) * h * slope(i + 1);
  return Math.max(0, Math.min(255, y));
}
function lutsFor(a) {
  const t = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
  switch (a.type) {
    case 'brightnessContrast': {
      const c = Math.max(-100, Math.min(100, a.contrast)) / 100, slope = c >= 0 ? 1 / Math.max(0.004, 1 - c) : 1 + c, lift = Math.max(-100, Math.min(100, a.brightness)) / 100 * 0.5;
      for (let i = 0; i < 256; i++) t[0][i] = toByte((i / 255 - 0.5) * slope + 0.5 + lift);
      t[1] = t[2] = t[0]; break;
    }
    case 'levels':
      for (let c = 0; c < 3; c++) for (let i = 0; i < 256; i++) t[c][i] = Math.max(0, Math.min(255, Math.round(levelsMap(a.ranges[0], levelsMap(a.ranges[c + 1], i)))));
      break;
    case 'curves':
      for (let c = 0; c < 3; c++) for (let i = 0; i < 256; i++) t[c][i] = Math.round(curveValue(a.channels[0], curveValue(a.channels[c + 1], i)));
      break;
    case 'exposure': {
      const scale = Math.pow(2, Math.max(-20, Math.min(20, a.exposure))), gamma = Math.max(0.01, Math.min(9.99, a.gamma));
      for (let i = 0; i < 256; i++) {
        const e = i / 255; let lin = e <= 0.04045 ? e / 12.92 : Math.pow((e + 0.055) / 1.055, 2.4);
        lin = Math.pow(Math.max(0, lin * scale + a.offset), 1 / gamma);
        t[0][i] = toByte(lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055);
      }
      t[1] = t[2] = t[0]; break;
    }
    case 'invert': for (let i = 0; i < 256; i++) t[0][i] = 255 - i; t[1] = t[2] = t[0]; break;
    case 'threshold': break;
    case 'posterize': {
      const n = Math.max(2, Math.min(255, Math.round(a.levels)));
      for (let i = 0; i < 256; i++) t[0][i] = Math.round(Math.round(i / 255 * (n - 1)) / (n - 1) * 255);
      t[1] = t[2] = t[0]; break;
    }
    case 'solarize': for (let i = 0; i < 256; i++) t[0][i] = i < a.threshold ? i : 255 - i; t[1] = t[2] = t[0]; break;
  }
  return t;
}
const hexRgb = (h) => { const n = parseInt(h.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d < 1e-9) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return [h, s, l];
}
function hueCh(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
}
function hslToRgb(h, s, l) {
  if (s <= 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hueCh(p, q, h / 360 + 1 / 3), hueCh(p, q, h / 360), hueCh(p, q, h / 360 - 1 / 3)];
}
const applySat = (s, amt) => Math.max(0, Math.min(1, amt >= 0 ? s * (1 + amt / 100 * 2) : s * (1 + amt / 100)));
const applyLight = (l, amt) => (amt >= 0 ? l + (1 - l) * amt / 100 : l * (1 + amt / 100));
const rangeWeight = (idx, hue) => {
  const center = (idx - 1) * 60, d = Math.abs((((hue - center) % 360) + 540) % 360 - 180);
  return d <= 15 ? 1 : d >= 45 ? 0 : (45 - d) / 30;
};
function tonalWeights(v) {
  const a = 0.25, b = 0.333, scale = 0.7, cl = (x) => Math.max(0, Math.min(1, x));
  return [cl((v - b) / -a + 0.5) * scale, cl((v - b) / a + 0.5) * cl((v + b - 1) / -a + 0.5) * scale, cl((v + b - 1) / a + 0.5) * scale];
}
export function blackWhiteGray(r, g, b, w) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), mid = r + g + b - max - min;
  let p, s;
  if (max === r) { p = 0; s = g >= b ? 1 : 5; } else if (max === g) { p = 2; s = r >= b ? 1 : 3; } else { p = 4; s = g >= r ? 3 : 5; }
  return Math.max(0, Math.min(1, min + (mid - min) * w[s] + (max - mid) * w[p]));
}

// Applies an adjustment to straight RGBA bytes. (ox, oy) is the document position of pixel (0,0) and `step` the
// document pixels per buffer pixel, so position-dependent adjustments (grain, noise) stay fixed to the document.
export function applyAdjustment(a, d, w, h, ox = 0, oy = 0, step = 1) {
  if (isIdentity(a)) return;
  const n = w * h;
  switch (a.type) {
    case 'brightnessContrast': case 'levels': case 'curves': case 'exposure': case 'invert': case 'posterize': case 'solarize': {
      const [r, g, b] = lutsFor(a);
      for (let i = 0; i < n * 4; i += 4) { if (!d[i + 3]) continue; d[i] = r[d[i]]; d[i + 1] = g[d[i + 1]]; d[i + 2] = b[d[i + 2]]; }
      return;
    }
    case 'threshold':
      for (let i = 0; i < n * 4; i += 4) { if (!d[i + 3]) continue; const v = luma(d[i], d[i + 1], d[i + 2]) >= a.level ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
      return;
    case 'desaturate': case 'sepia': {
      const k = Math.max(0, Math.min(100, a.amount)) / 100, sep = a.type === 'sepia';
      for (let i = 0; i < n * 4; i += 4) {
        if (!d[i + 3]) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let nr, ng, nb;
        if (sep) { nr = r * 0.393 + g * 0.769 + b * 0.189; ng = r * 0.349 + g * 0.686 + b * 0.168; nb = r * 0.272 + g * 0.534 + b * 0.131; }
        else { nr = ng = nb = luma(r, g, b); }
        d[i] = clamp255(r + (nr - r) * k); d[i + 1] = clamp255(g + (ng - g) * k); d[i + 2] = clamp255(b + (nb - b) * k);
      }
      return;
    }
    case 'vibrance': {
      const v = a.amount / 100, sat = a.saturation / 100;
      for (let i = 0; i < n * 4; i += 4) {
        if (!d[i + 3]) continue;
        const [hh, s, l] = rgbToHsl(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
        // Low-saturation pixels get the stronger lift; skin-like oranges are protected a little.
        const skin = hh > 10 && hh < 50 ? 0.55 : 1;
        let ns = v >= 0 ? s + v * (1 - s) * skin : s * (1 + v);
        ns = Math.max(0, Math.min(1, sat >= 0 ? ns + sat * (1 - ns) : ns * (1 + sat)));
        const [r, g, b] = hslToRgb(hh, ns, l);
        d[i] = toByte(r); d[i + 1] = toByte(g); d[i + 2] = toByte(b);
      }
      return;
    }
    case 'lut': applyLut(a, d, n); return;
    case 'gradientMap': {
      const dark = hexRgb(a.reversed ? a.highlights : a.shadows), light = hexRgb(a.reversed ? a.shadows : a.highlights);
      const lr = new Uint8Array(256), lg = new Uint8Array(256), lb = new Uint8Array(256);
      for (let i = 0; i < 256; i++) { const t = i / 255; lr[i] = dark[0] + (light[0] - dark[0]) * t; lg[i] = dark[1] + (light[1] - dark[1]) * t; lb[i] = dark[2] + (light[2] - dark[2]) * t; }
      for (let i = 0; i < n * 4; i += 4) { if (!d[i + 3]) continue; const l = luma(d[i], d[i + 1], d[i + 2]); d[i] = lr[l]; d[i + 1] = lg[l]; d[i + 2] = lb[l]; }
      return;
    }
    case 'grain': {
      const eff = step > 1.01 ? a.amount * Math.min(1, Math.max(a.size, 1) / step) : a.amount;
      const amount = Math.max(0, Math.min(100, eff)) / 100 * 96, size = Math.max(0.5, Math.min(20, a.size)), detail = Math.max(0.5, size * 0.35);
      const rough = Math.max(0, Math.min(100, a.roughness)) / 100, s0 = a.seed >>> 0, s1 = (s0 ^ 0x9E3779B9) >>> 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4; if (!d[i + 3]) continue;
        const px = Math.floor(ox + x * step), py = Math.floor(oy + y * step);
        const smooth = smoothNoise(px / size, py / size, s0) * 1.6, fine = smoothNoise(px / detail, py / detail, s1) * 1.6;
        const nz = smooth + (fine - smooth) * rough, l = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) / 65280, wgt = 4 * l * (1 - l) * 0.75 + 0.25, delta = Math.round(nz * amount * wgt);
        d[i] = clamp255(d[i] + delta); d[i + 1] = clamp255(d[i + 1] + delta); d[i + 2] = clamp255(d[i + 2] + delta);
      }
      return;
    }
    case 'addNoise': {
      const amt = step > 1.01 ? a.amount / step : a.amount, spread = Math.max(0, Math.min(400, amt)) / 100 * 127.5, sd = a.seed >>> 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4; if (!d[i + 3]) continue;
        const px = Math.floor(ox + x * step), py = Math.floor(oy + y * step);
        if (a.monochromatic) { const v = noise(px, py, sd, 0, a.gaussian) * spread; d[i] = clamp255(d[i] + v); d[i + 1] = clamp255(d[i + 1] + v); d[i + 2] = clamp255(d[i + 2] + v); }
        else for (let c = 0; c < 3; c++) d[i + c] = clamp255(d[i + c] + noise(px, py, sd, c, a.gaussian) * spread);
      }
      return;
    }
    case 'blackAndWhite': {
      const wts = a.weights.map((v) => Math.max(-200, Math.min(300, v)) / 100), tint = a.tint && a.tintSaturation > 0, hue = ((a.tintHue % 360) + 360) % 360, sat = Math.max(0, Math.min(100, a.tintSaturation)) / 100;
      for (let i = 0; i < n * 4; i += 4) {
        if (!d[i + 3]) continue;
        const g = blackWhiteGray(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, wts);
        if (!tint) { d[i] = d[i + 1] = d[i + 2] = toByte(g); continue; }
        const [r, gg, b] = hslToRgb(hue, sat, g);
        d[i] = toByte(r); d[i + 1] = toByte(gg); d[i + 2] = toByte(b);
      }
      return;
    }
    case 'colorBalance': {
      const u = (v) => v.map((x) => Math.max(-100, Math.min(100, x)) / 100), S = u(a.shadows), M = u(a.midtones), H = u(a.highlights), c = [0, 0, 0];
      for (let i = 0; i < n * 4; i += 4) {
        if (!d[i + 3]) continue;
        c[0] = d[i] / 255; c[1] = d[i + 1] / 255; c[2] = d[i + 2] / 255;
        const before = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
        for (let k = 0; k < 3; k++) { const [s, m, hh] = tonalWeights(c[k]); c[k] = Math.max(0, Math.min(1, c[k] + S[k] * s + M[k] * m + H[k] * hh)); }
        if (a.preserveLuminosity) {
          const after = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
          if (after > 0.0001) { const ratio = before / after; for (let k = 0; k < 3; k++) c[k] = Math.max(0, Math.min(1, c[k] * ratio)); }
        }
        d[i] = toByte(c[0]); d[i + 1] = toByte(c[1]); d[i + 2] = toByte(c[2]);
      }
      return;
    }
    case 'hueSaturation': {
      const shifts = a.shifts, master = shifts[0], anyRange = shifts.slice(1).some((s) => s.hue || s.saturation || s.lightness);
      for (let i = 0; i < n * 4; i += 4) {
        if (!d[i + 3]) continue;
        let [hh, s, l] = rgbToHsl(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
        if (a.colorize) {
          hh = ((master.hue % 360) + 360) % 360;
          s = master.saturation >= 0 ? 0.25 + master.saturation / 100 * 0.75 : 0.25 * (1 + master.saturation / 100);
        } else {
          if (anyRange && s > 0) for (let k = 1; k < 7; k++) {
            const sh = shifts[k]; if (!sh.hue && !sh.saturation && !sh.lightness) continue;
            const wgt = rangeWeight(k, hh) * Math.min(1, s * 4); if (wgt <= 0) continue;
            hh += sh.hue * wgt; s = applySat(s, sh.saturation * wgt); l = applyLight(l, sh.lightness * wgt);
          }
          hh = (((hh + master.hue) % 360) + 360) % 360; s = applySat(s, master.saturation);
        }
        l = applyLight(l, master.lightness);
        const [r, g, b] = hslToRgb(hh, s, l);
        d[i] = toByte(r); d[i + 1] = toByte(g); d[i + 2] = toByte(b);
      }
      return;
    }
    case 'gaussianBlur': blurStraight(d, w, h, Math.max(0.1, Math.min(250, a.radius)) / Math.max(step, 1e-6)); return;
    case 'motionBlur': {
      const dist = Math.max(1, Math.min(2000, a.distance)) / Math.max(step, 1e-6);
      if (dist >= 1) { const out = motionBlurStraight(d, w, h, dist, Math.max(-90, Math.min(90, a.angle))); d.set(out); }
      return;
    }
  }
}

// Gaussian blur of straight RGBA, edges continued outward.
export function blurStraight(d, w, h, sigma) {
  for (let i = 0; i < d.length; i += 4) { const al = d[i + 3]; if (al !== 255) { d[i] = d[i] * al / 255; d[i + 1] = d[i + 1] * al / 255; d[i + 2] = d[i + 2] * al / 255; } }
  gaussianBlur(d, w, h, sigma, sigma, 4, 'clamp');
  for (let i = 0; i < d.length; i += 4) { const al = d[i + 3]; if (al !== 255 && al !== 0) { d[i] = Math.min(255, d[i] * 255 / al); d[i + 1] = Math.min(255, d[i + 1] * 255 / al); d[i + 2] = Math.min(255, d[i + 2] * 255 / al); } }
}
// Averages samples along a line through each pixel; the border is continued (clamp) so nothing fades out.
export function motionBlurStraight(d, w, h, distance, angle, clampEdge = true) {
  const length = Math.max(1, Math.round(distance)), rad = angle * Math.PI / 180, dx = Math.cos(rad), dy = -Math.sin(rad), samples = Math.min(length, 96);
  const out = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, al = 0;
    for (let i = 0; i < samples; i++) {
      const t = samples === 1 ? 0 : (i / (samples - 1) - 0.5) * length;
      let sx = Math.round(x + dx * t), sy = Math.round(y + dy * t);
      if (clampEdge) { sx = sx < 0 ? 0 : sx >= w ? w - 1 : sx; sy = sy < 0 ? 0 : sy >= h ? h - 1 : sy; } else if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const p = (sy * w + sx) * 4, pa = d[p + 3];
      r += d[p] * pa; g += d[p + 1] * pa; b += d[p + 2] * pa; al += pa;
    }
    const o = (y * w + x) * 4;
    out[o + 3] = al / samples;
    if (al > 0) { out[o] = r / al; out[o + 1] = g / al; out[o + 2] = b / al; }
  }
  return out;
}

// Auto Levels: each channel stretched to its own 0.1% clipped extremes.
export function histogramOf(d) {
  const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const step = Math.max(1, Math.floor(Math.sqrt(d.length / 4 / 1_000_000)));
  for (let i = 0; i < d.length; i += 4 * step) {
    if (d[i + 3] < 8) continue;
    bins[0][d[i]]++; bins[1][d[i + 1]]++; bins[2][d[i + 2]]++; bins[3][luma(d[i], d[i + 1], d[i + 2])]++;
  }
  return bins;
}
export function autoLevels(hist) {
  const a = createAdjustment('levels');
  for (let c = 0; c < 3; c++) {
    const bins = hist[c];
    let total = 0; for (const v of bins) total += v;
    if (!total) continue;
    const clip = Math.max(1, Math.floor(total / 1000));
    let low = 0, high = 255;
    for (let s = 0; low < 255; low++) { s += bins[low]; if (s > clip) break; }
    for (let s = 0; high > 0; high--) { s += bins[high]; if (s > clip) break; }
    if (high - low >= 2) a.ranges[c + 1] = { ...range(), inputBlack: low, inputWhite: high };
  }
  return a;
}
