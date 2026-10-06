// Alpha8 coverage bitmaps: layer masks (white = 255 reveals) and the document selection. Selection operations
// return new masks and never change one in place (a Mask given to history is shared, as Composa shares bitmaps).
import { makeCanvas, ctxOf } from './pixels.js';
import { gaussianBlur, morph } from './filters/blur.js';
import { intersect, isEmpty, mapPoint, invert as invertMatrix } from './geom.js';

export class Mask {
  constructor(width, height, data) {
    this.width = Math.max(1, width | 0); this.height = Math.max(1, height | 0);
    this.data = data || new Uint8Array(this.width * this.height);
    this.version = 0; this._canvas = null; this._canvasVersion = -1;
  }
  static filled(w, h, v = 255) { const m = new Mask(w, h); m.data.fill(v); return m; }
  clone() { return new Mask(this.width, this.height, this.data.slice()); }
  touch() { this.version++; }
  // White canvas whose alpha is the mask, for DstIn / source-in drawing.
  canvas() {
    if (this._canvas && this._canvasVersion === this.version) return this._canvas;
    const c = this._canvas || makeCanvas(this.width, this.height);
    const img = new ImageData(this.width, this.height), d = img.data, s = this.data;
    for (let i = 0, j = 3; i < s.length; i++, j += 4) { d[j - 3] = d[j - 2] = d[j - 1] = 255; d[j] = s[i]; }
    ctxOf(c).putImageData(img, 0, 0);
    this._canvas = c; this._canvasVersion = this.version;
    return c;
  }
  // The coverage drawn gray-on-opaque, for thumbnails and the mask-only view.
  grayCanvas() {
    const c = makeCanvas(this.width, this.height), img = new ImageData(this.width, this.height), d = img.data, s = this.data;
    for (let i = 0, j = 0; i < s.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = s[i]; d[j + 3] = 255; }
    ctxOf(c).putImageData(img, 0, 0);
    return c;
  }
  isEmpty() { for (let i = 0; i < this.data.length; i++) if (this.data[i]) return false; return true; }
  // The smallest rectangle holding every pixel at or above `threshold`, or an empty rect.
  bounds(threshold = 1) {
    const { width: w, height: h, data } = this;
    let l = w, t = h, r = -1, b = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let first = -1;
      for (let x = 0; x < w; x++) if (data[row + x] >= threshold) { first = x; break; }
      if (first < 0) continue;
      let last = w - 1;
      while (data[row + last] < threshold) last--;
      if (first < l) l = first; if (last > r) r = last;
      if (y < t) t = y; b = y;
    }
    return r < 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: l, y: t, w: r - l + 1, h: b - t + 1 };
  }
  at(x, y) { return x < 0 || y < 0 || x >= this.width || y >= this.height ? 0 : this.data[y * this.width + x]; }
  // The mask a canvas's alpha channel makes.
  static fromAlpha(canvas) {
    const img = ctxOf(canvas).getImageData(0, 0, canvas.width, canvas.height).data, m = new Mask(canvas.width, canvas.height);
    for (let i = 0; i < m.data.length; i++) m.data[i] = img[i * 4 + 3];
    return m;
  }
}

export const MaskMode = { replace: 'replace', add: 'add', subtract: 'subtract', intersect: 'intersect' };

export const maskGray = (r, g, b) => (r * 54 + g * 183 + b * 19) >> 8;

// ---- shapes ---------------------------------------------------------------------
// Rasterises whatever `draw(ctx)` fills (black, antialiased) inside `box` only, so a small shape on a big
// document costs a small canvas.
function shape(w, h, box, draw, feather = 0) {
  const m = new Mask(w, h);
  const area = intersect({ x: Math.floor(box.x) - 1, y: Math.floor(box.y) - 1, w: Math.ceil(box.w) + 3, h: Math.ceil(box.h) + 3 }, { x: 0, y: 0, w, h });
  if (!isEmpty(area)) {
    const c = makeCanvas(area.w, area.h), ctx = ctxOf(c);
    ctx.translate(-area.x, -area.y); ctx.fillStyle = '#000'; draw(ctx);
    const px = ctx.getImageData(0, 0, area.w, area.h).data;
    for (let y = 0; y < area.h; y++) for (let x = 0; x < area.w; x++) m.data[(y + area.y) * w + x + area.x] = px[(y * area.w + x) * 4 + 3];
  }
  return feather > 0 ? featherMask(m, feather) : m;
}
export function rectMask(w, h, r, feather = 0) {
  const m = new Mask(w, h);
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y)), x1 = Math.min(w, Math.round(r.x + r.w)), y1 = Math.min(h, Math.round(r.y + r.h));
  for (let y = y0; y < y1; y++) m.data.fill(255, y * w + x0, y * w + x1);
  return feather > 0 ? featherMask(m, feather) : m;
}
export const ellipseMask = (w, h, r, feather = 0) => shape(w, h, r, (c) => { c.beginPath(); c.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.01, r.w / 2), Math.max(0.01, r.h / 2), 0, 0, Math.PI * 2); c.fill(); }, feather);
export function polygonMask(w, h, pts, feather = 0) {
  if (pts.length < 3) return new Mask(w, h);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), x = Math.min(...xs), y = Math.min(...ys);
  return shape(w, h, { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }, (c) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.fill('evenodd'); }, feather);
}
export const allMask = (w, h) => Mask.filled(w, h, 255);

// ---- combining ---------------------------------------------------------------------
// Returns the new selection (or null when nothing remains selected).
export function combine(current, add, mode) {
  if (!current || mode === MaskMode.replace) return mode === MaskMode.subtract || mode === MaskMode.intersect || add.isEmpty() ? null : add;
  const out = current.clone(), a = out.data, b = add.data;
  if (mode === MaskMode.add) for (let i = 0; i < a.length; i++) a[i] = a[i] + b[i] - (a[i] * b[i] + 127) / 255;
  else if (mode === MaskMode.subtract) for (let i = 0; i < a.length; i++) a[i] = (a[i] * (255 - b[i]) + 127) / 255;
  else for (let i = 0; i < a.length; i++) a[i] = (a[i] * b[i] + 127) / 255;
  return out.isEmpty() ? null : out;
}
export function invertMask(m) {
  const out = new Mask(m.width, m.height);
  for (let i = 0; i < m.data.length; i++) out.data[i] = 255 - m.data[i];
  return out;
}
export function expandMask(m, px) { return new Mask(m.width, m.height, morph(m.data, m.width, m.height, px, true)); }
export function contractMask(m, px) {
  const out = new Mask(m.width, m.height, morph(m.data, m.width, m.height, px, false));
  return out.isEmpty() ? null : out;
}
export function featherMask(m, radius) {
  const out = m.clone();
  gaussianBlur(out.data, m.width, m.height, radius / 2, radius / 2, 1, 'zero');
  return out;
}
export function translateMask(m, dx, dy) {
  const out = new Mask(m.width, m.height), w = m.width, h = m.height;
  for (let y = 0; y < h; y++) {
    const sy = y - dy; if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) { const sx = x - dx; if (sx >= 0 && sx < w) out.data[y * w + x] = m.data[sy * w + sx]; }
  }
  return out.isEmpty() ? null : out;
}
// Draws `m` through an affine matrix onto a new w x h mask (used for canvas resizes and transforms).
export function remapMask(m, w, h, matrix, outside = 0) {
  const src = m.canvas(), c = makeCanvas(w, h), ctx = ctxOf(c);
  ctx.setTransform(...matrix); ctx.imageSmoothingEnabled = true; ctx.drawImage(src, 0, 0);
  const out = Mask.fromAlpha(c);
  if (outside) {
    const inv = invertMatrix(matrix);
    if (inv) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = mapPoint(inv, x + 0.5, y + 0.5);
      if (p.x < 0 || p.y < 0 || p.x >= m.width || p.y >= m.height) out.data[y * w + x] = outside;
    }
  }
  return out;
}

// ---- outline for the marching ants -------------------------------------------------
// Boundary segments between pixels at or above 128 and below, as flat [x1,y1,x2,y2,...] in mask coordinates.
// `block` > 1 traces a reduced mask so the path never has more edges than the screen has pixels to show; a reduced
// pixel counts as selected when any pixel in its block is.
export function outlineSegments(m, block = 1) {
  let w = m.width, h = m.height, data = m.data;
  if (block > 1) {
    const rw = Math.ceil(w / block), rh = Math.ceil(h / block), small = new Uint8Array(rw * rh);
    for (let y = 0; y < h; y++) {
      const ry = (y / block) | 0, row = y * w;
      for (let x = 0; x < w; x++) if (data[row + x] >= 128) small[ry * rw + ((x / block) | 0)] = 255;
    }
    w = rw; h = rh; data = small;
  }
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] >= 128;
  const out = [];
  for (let y = 0; y <= h; y++) {                       // horizontal edges on grid line y
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && on(x, y - 1) !== on(x, y);
      if (edge && start < 0) start = x;
      else if (!edge && start >= 0) { out.push(start * block, y * block, x * block, y * block); start = -1; }
    }
  }
  for (let x = 0; x <= w; x++) {                       // vertical edges on grid line x
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && on(x - 1, y) !== on(x, y);
      if (edge && start < 0) start = y;
      else if (!edge && start >= 0) { out.push(x * block, start * block, x * block, y * block); start = -1; }
    }
  }
  return out;
}
