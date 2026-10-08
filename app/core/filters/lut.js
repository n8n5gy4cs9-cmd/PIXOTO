// 3D colour LUTs: four built-in looks (generated, not sampled from any camera) and .cube import. A LUT is
// { size, data: Float32Array } with red varying fastest. Pure: runs in a worker too.
const sCurve = (x, k) => x + k * (x * x * (3 - 2 * x) - x);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// contrast: S-curve strength; sat: saturation multiplier; shadow/high: colour pushed into darks/lights; lift: raised black point.
const look = ({ contrast, sat, shadow, high, lift }) => (r, g, b) => {
  const c = [sCurve(r, contrast), sCurve(g, contrast), sCurve(b, contrast)];
  const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722, ws = (1 - l) * (1 - l), wh = l * l;
  return c.map((v, i) => clamp01(lift + (1 - lift) * clamp01(l + (v - l) * sat + shadow[i] * ws + high[i] * wh)));
};

export const LUT_PRESETS = {
  leikuVivid: { name: 'Leiku Vivid', fn: look({ contrast: 0.55, sat: 1.3, shadow: [0, 0, 0.01], high: [0.02, 0.01, -0.015], lift: 0 }) },
  leikuNatural: { name: 'Leiku Natural', fn: look({ contrast: 0.15, sat: 1.05, shadow: [0, 0, 0.005], high: [0.01, 0.005, -0.005], lift: 0.01 }) },
  leikuStandard: { name: 'Leiku Standard', fn: look({ contrast: 0.3, sat: 1.15, shadow: [-0.005, 0, 0.01], high: [0.005, 0.005, 0], lift: 0 }) },
  cinematic: { name: 'Cinematic', fn: look({ contrast: 0.35, sat: 0.9, shadow: [-0.04, 0, 0.04], high: [0.05, 0.02, -0.05], lift: 0.04 }) },
};

export function parseCube(text) {
  let size = 0, data = null, n = 0;
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s[0] === '#') continue;
    const p = s.split(/\s+/);
    if (p[0] === 'LUT_3D_SIZE') { size = +p[1]; data = new Float32Array(size * size * size * 3); }
    else if (/^[A-Z_]+$/.test(p[0])) { if (p[0] === 'LUT_1D_SIZE') throw new Error('Only 3D .cube LUTs are supported.'); }
    else if (data && n < data.length && p.length >= 3) { data[n++] = +p[0]; data[n++] = +p[1]; data[n++] = +p[2]; }
  }
  if (!data || size < 2 || n !== data.length) throw new Error('This is not a valid 3D .cube LUT.');
  return { size, data };
}

const SIZE = 33;
const cache = new Map();
export function lutFor(a) {
  const key = a.preset === 'custom' ? a.cube : a.preset;
  if (!key) return null;
  let lut = cache.get(key);
  if (!lut) {
    if (a.preset === 'custom') lut = parseCube(a.cube);
    else {
      const fn = LUT_PRESETS[a.preset]?.fn; if (!fn) return null;
      const data = new Float32Array(SIZE ** 3 * 3); let i = 0;
      for (let b = 0; b < SIZE; b++) for (let g = 0; g < SIZE; g++) for (let r = 0; r < SIZE; r++) { const o = fn(r / (SIZE - 1), g / (SIZE - 1), b / (SIZE - 1)); data[i++] = o[0]; data[i++] = o[1]; data[i++] = o[2]; }
      lut = { size: SIZE, data };
    }
    if (cache.size > 8) cache.clear();
    cache.set(key, lut);
  }
  return lut;
}

// Trilinear lookup, blended with the original by amount (0..100).
export function applyLut(a, d, n) {
  const lut = lutFor(a); if (!lut) return;
  const { size, data } = lut, m = size - 1, k = Math.max(0, Math.min(100, a.amount)) / 100, s1 = size * 3, s2 = size * size * 3;
  for (let i = 0; i < n * 4; i += 4) {
    if (!d[i + 3]) continue;
    const fr = d[i] / 255 * m, fg = d[i + 1] / 255 * m, fb = d[i + 2] / 255 * m;
    const r0 = Math.min(m - 1, fr | 0), g0 = Math.min(m - 1, fg | 0), b0 = Math.min(m - 1, fb | 0);
    const tr = fr - r0, tg = fg - g0, tb = fb - b0, base = b0 * s2 + g0 * s1 + r0 * 3;
    for (let c = 0; c < 3; c++) {
      const o = base + c;
      const c00 = data[o] + (data[o + 3] - data[o]) * tr, c10 = data[o + s1] + (data[o + s1 + 3] - data[o + s1]) * tr;
      const c01 = data[o + s2] + (data[o + s2 + 3] - data[o + s2]) * tr, c11 = data[o + s2 + s1] + (data[o + s2 + s1 + 3] - data[o + s2 + s1]) * tr;
      const v = (c00 + (c10 - c00) * tg) + ((c01 + (c11 - c01) * tg) - (c00 + (c10 - c00) * tg)) * tb;
      const src = d[i + c], out = Math.round(clamp01(v) * 255);
      d[i + c] = src + (out - src) * k;
    }
  }
}
