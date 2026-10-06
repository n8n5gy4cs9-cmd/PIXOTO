// Painterly filter (port of Composa.Filters.Painterly), after Hertzmann's "Painterly Rendering with Curved Brush Strokes
// of Multiple Sizes". The largest brush paints first; each smaller one repaints only what is still too rough. The same
// seed paints the same strokes. Pure: runs in the filter worker.
import { blurStraight } from './adjust.js';
import { rgbToHsv, hsvToRgb } from '../pixels.js';

export const PAINTERLY_STYLES = ['impressionist', 'expressionist', 'coloristWash', 'pointillist'];
export const defaultPainterly = () => ({ style: 'impressionist', brushSize: 0, passes: 3, detail: 50 });
const PARAMS = {
  expressionist: { threshold: 50, curvature: 0.25, blur: 0.5, opacity: 0.7, hardness: 0.85, minLength: 10, maxLength: 16, hue: 0, sat: 0, val: 0.5 },
  coloristWash: { threshold: 200, curvature: 1, blur: 0.5, opacity: 0.5, hardness: 0.7, minLength: 4, maxLength: 16, hue: 0.1, sat: 0.3, val: 0.3 },
  pointillist: { threshold: 100, curvature: 1, blur: 0.5, opacity: 1, hardness: 0.95, minLength: 0, maxLength: 0, hue: 0.3, sat: 0, val: 1 },
  impressionist: { threshold: 100, curvature: 1, blur: 0.5, opacity: 1, hardness: 0.9, minLength: 4, maxLength: 16, hue: 0, sat: 0, val: 0 },
};
const MAX_DISTANCE = 441.68;
function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function reference(soft, w, h) {
  const n = w * h, R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n), L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = soft[i * 4 + 3] / 255; if (!a) continue;
    R[i] = soft[i * 4]; G[i] = soft[i * 4 + 1]; B[i] = soft[i * 4 + 2]; A[i] = a; L[i] = (0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]) * a;
  }
  return { w, h, R, G, B, A, L };
}
const clampi = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function gradient(ref, x, y) {
  const { w, h, L } = ref, at = (px, py) => L[clampi(py, 0, h - 1) * w + clampi(px, 0, w - 1)];
  return [at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1), at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)];
}
const dist = (r1, g1, b1, r2, g2, b2) => Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
// canvas is premultiplied RGBA bytes
function error(ref, i, canvas, ci) {
  const a = canvas[ci + 3] / 255;
  if (a <= 0) return MAX_DISTANCE;
  return dist(ref.R[i], ref.G[i], ref.B[i], canvas[ci] / a, canvas[ci + 1] / a, canvas[ci + 2] / a) * a + MAX_DISTANCE * (1 - a);
}
function makeStroke(ref, canvas, w, x0, y0, radius, st) {
  const h = ref.h, start = y0 * w + x0, red = ref.R[start], green = ref.G[start], blue = ref.B[start], pts = [[x0 + 0.5, y0 + 0.5]];
  let x = x0 + 0.5, y = y0 + 0.5, lastDx = 0, lastDy = 0;
  for (let i = 1; i <= st.maxLength; i++) {
    const px = Math.floor(x), py = Math.floor(y), at = py * w + px;
    if (i > st.minLength) {
      const ci = (py * w + px) * 4, painted = canvas[ci + 3] / 255;
      const cd = painted <= 0 ? MAX_DISTANCE : dist(ref.R[at], ref.G[at], ref.B[at], canvas[ci] / painted, canvas[ci + 1] / painted, canvas[ci + 2] / painted);
      if (cd < dist(ref.R[at], ref.G[at], ref.B[at], red, green, blue)) break;
    }
    const [gx, gy] = gradient(ref, px, py), mag = Math.sqrt(gx * gx + gy * gy);
    if (mag < 1e-3) break;
    let dx = -gy / mag, dy = gx / mag;
    if (lastDx * dx + lastDy * dy < 0) { dx = -dx; dy = -dy; }
    dx = st.curvature * dx + (1 - st.curvature) * lastDx; dy = st.curvature * dy + (1 - st.curvature) * lastDy;
    const len = Math.sqrt(dx * dx + dy * dy); if (len < 1e-6) break;
    dx /= len; dy /= len; x += radius * dx; y += radius * dy; lastDx = dx; lastDy = dy;
    if (x < 0 || y < 0 || x >= w || y >= h || ref.A[Math.floor(y) * w + Math.floor(x)] <= 0.01) break;
    pts.push([x, y]);
  }
  return { red, green, blue, pts };
}
function brushTable(radius, hardness) {
  const STEPS = 4096, reach = radius + 1, scale = STEPS / (reach * reach), table = new Float32Array(STEPS + 1), inner = radius * hardness;
  for (let i = 0; i <= STEPS; i++) {
    const d = Math.sqrt(i / scale), edge = Math.max(0, Math.min(1, radius - d + 0.5));
    if (hardness >= 0.995 || d <= inner) table[i] = edge; else { const t = Math.max(0, Math.min(1, (d - inner) / Math.max(1e-3, radius - inner))); table[i] = 0.5 * (1 + Math.cos(Math.PI * t)) * edge; }
  }
  return { radius, reach, at: (d2) => { const i = Math.floor(d2 * scale); return i >= STEPS ? 0 : table[i]; } };
}
function dab(cov, cw, ch, left, top, cx, cy, brush) {
  const r = brush.reach, x0 = Math.max(0, Math.floor(cx - r) - left), y0 = Math.max(0, Math.floor(cy - r) - top), x1 = Math.min(cw, Math.ceil(cx + r) - left), y1 = Math.min(ch, Math.ceil(cy + r) - top);
  for (let y = y0; y < y1; y++) { const dy = top + y + 0.5 - cy; for (let x = x0; x < x1; x++) { const dx = left + x + 0.5 - cx, c = brush.at(dx * dx + dy * dy); if (c > cov[y * cw + x]) cov[y * cw + x] = c; } }
}
function paintStroke(canvas, w, h, stroke, color, brush, st) {
  const reach = brush.reach;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of stroke.pts) { minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); }
  const left = Math.max(0, Math.floor(minX - reach)), top = Math.max(0, Math.floor(minY - reach)), right = Math.min(w, Math.ceil(maxX + reach)), bottom = Math.min(h, Math.ceil(maxY + reach));
  if (right <= left || bottom <= top) return;
  const cw = right - left, ch = bottom - top, cov = new Float32Array(cw * ch), spacing = Math.max(0.5, brush.radius * 0.4);
  dab(cov, cw, ch, left, top, stroke.pts[0][0], stroke.pts[0][1], brush);
  let residual = 0;
  for (let i = 1; i < stroke.pts.length; i++) {
    const [fx, fy] = stroke.pts[i - 1], [tx, ty] = stroke.pts[i], dx = tx - fx, dy = ty - fy, len = Math.sqrt(dx * dx + dy * dy);
    if (len <= 0) continue;
    let travelled = spacing - residual;
    while (travelled <= len) { const t = travelled / len; dab(cov, cw, ch, left, top, fx + dx * t, fy + dy * t, brush); travelled += spacing; }
    residual = len - (travelled - spacing);
  }
  const [r, g, b] = color;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const a = cov[y * cw + x] * st.opacity; if (a <= 0) continue;
    const p = ((top + y) * w + left + x) * 4, keep = 1 - a;
    canvas[p] = r * a + canvas[p] * keep + 0.5; canvas[p + 1] = g * a + canvas[p + 1] * keep + 0.5; canvas[p + 2] = b * a + canvas[p + 2] * keep + 0.5; canvas[p + 3] = 255 * a + canvas[p + 3] * keep + 0.5;
  }
}
function jitter(s, st, rnd) {
  if (st.hue <= 0 && st.sat <= 0 && st.val <= 0) return [s.red, s.green, s.blue];
  let [h, sa, v] = rgbToHsv(Math.max(0, Math.min(255, s.red)), Math.max(0, Math.min(255, s.green)), Math.max(0, Math.min(255, s.blue)));
  h = (h + (rnd() * 2 - 1) * st.hue * 90 + 360) % 360;
  sa = Math.max(0, Math.min(1, sa + (rnd() * 2 - 1) * st.sat * 0.5));
  v = Math.max(0, Math.min(1, v + (rnd() * 2 - 1) * st.val * 0.5));
  return hsvToRgb(h, sa, v);
}

// source: straight RGBA bytes. Returns a new straight RGBA array; gaps between strokes stay transparent.
export function painterly(source, w, h, settings, seed = 1) {
  const s = { ...defaultPainterly(), ...settings }, st = PARAMS[s.style] || PARAMS.impressionist;
  s.brushSize = Math.max(0, Math.min(500, s.brushSize || 0)); s.passes = Math.max(1, Math.min(4, Math.round(s.passes))); s.detail = Math.max(0, Math.min(100, s.detail));
  const canvas = new Uint8ClampedArray(w * h * 4);
  if (!w || !h) return canvas;
  const largest = s.brushSize > 0 ? s.brushSize / 2 : Math.max(2, Math.min(w, h) / 100), threshold = st.threshold * Math.pow(2, (50 - s.detail) / 25), rnd = rng(seed), radii = [];
  for (let pass = 0; pass < s.passes; pass++) { const r = largest / Math.pow(2, pass); if (r < 1 && radii.length) break; radii.push(Math.max(1, r)); }
  for (const radius of radii) {
    const soft = new Uint8ClampedArray(source); blurStraight(soft, w, h, Math.max(0.1, radius * st.blur));
    const ref = reference(soft, w, h), grid = Math.max(1, Math.round(radius)), strokes = [];
    for (let y0 = 0; y0 < h; y0 += grid) for (let x0 = 0; x0 < w; x0 += grid) {
      let sum = 0, worst = -1, count = 0, wx = 0, wy = 0;
      for (let y = y0; y < Math.min(h, y0 + grid); y++) for (let x = x0; x < Math.min(w, x0 + grid); x++) {
        const i = y * w + x; if (ref.A[i] <= 0.01) continue;
        const e = error(ref, i, canvas, i * 4); sum += e; count++; if (e > worst) { worst = e; wx = x; wy = y; }
      }
      if (!count || sum / count <= threshold) continue;
      strokes.push(makeStroke(ref, canvas, w, wx, wy, radius, st));
    }
    for (let i = strokes.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [strokes[i], strokes[j]] = [strokes[j], strokes[i]]; }
    const brush = brushTable(radius, st.hardness), colors = strokes.map((sk) => jitter(sk, st, rnd));
    strokes.forEach((sk, i) => paintStroke(canvas, w, h, sk, colors[i], brush, st));
  }
  for (let i = 0; i < canvas.length; i += 4) { const a = canvas[i + 3]; if (a > 0 && a < 255) { canvas[i] = Math.min(255, canvas[i] * 255 / a); canvas[i + 1] = Math.min(255, canvas[i + 1] * 255 / a); canvas[i + 2] = Math.min(255, canvas[i + 2] * 255 / a); } }
  return canvas;
}
