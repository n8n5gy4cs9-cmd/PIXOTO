// Canvas and pixel helpers shared by everything that touches bitmaps. Layer canvases are straight-alpha RGBA.
export const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
};
// Layer canvases are read back constantly (brushes, filters, selections), so they live in software.
export const ctxOf = (canvas) => canvas.getContext('2d', { willReadFrequently: true });

export function cloneCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  ctxOf(c).drawImage(src, 0, 0);
  return c;
}
// Bumps a canvas's revision; caches (thumbnails, layer effects) key on it.
export const touchCanvas = (c) => { c.rev = (c.rev || 0) + 1; };
export const getData = (canvas, x = 0, y = 0, w = canvas.width, h = canvas.height) => ctxOf(canvas).getImageData(x, y, w, h);
export const putData = (canvas, data, x = 0, y = 0) => ctxOf(canvas).putImageData(data, x, y);
export function fillCanvas(canvas, color) {
  const c = ctxOf(canvas);
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'copy'; c.fillStyle = color; c.fillRect(0, 0, canvas.width, canvas.height); c.restore();
}
export function clearCanvas(canvas) { ctxOf(canvas).clearRect(0, 0, canvas.width, canvas.height); }
export function isClear(canvas) {
  const d = getData(canvas).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
  return true;
}

// ---- colors --------------------------------------------------------------------
export const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const grayOf = (r, g, b) => (r * 54 + g * 183 + b * 19) >> 8;   // Composa's mask gray

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, max ? d / max : 0, max];
}
export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360 / 60;
  const i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [r * 255, g * 255, b * 255];
}
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p) * 255; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

// ---- premultiplication on ImageData-like arrays ----------------------------------
export function premultiply(d) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;
    d[i] = (d[i] * a + 127) / 255; d[i + 1] = (d[i + 1] * a + 127) / 255; d[i + 2] = (d[i + 2] * a + 127) / 255;
  }
}
export function unpremultiply(d) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255 || a === 0) continue;
    d[i] = Math.min(255, (d[i] * 255 + a / 2) / a); d[i + 1] = Math.min(255, (d[i + 1] * 255 + a / 2) / a); d[i + 2] = Math.min(255, (d[i + 2] * 255 + a / 2) / a);
  }
}
