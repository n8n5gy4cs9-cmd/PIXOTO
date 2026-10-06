// One drag of a brush-like tool over a bitmap (layer pixels or a mask). Port of Composa.Painting.BrushStroke: the stroke
// works on a private copy and recomputes touched pixels from the untouched original plus the coverage painted so far,
// so overlapping dabs never build up past the stroke's opacity.
import { gaussianBlur, blurRGBA } from '../filters/blur.js';
import { mapPoint } from '../geom.js';
import { grayOf } from '../pixels.js';

export const BrushMode = { paint: 'paint', erase: 'erase', clone: 'clone', heal: 'heal', blur: 'blur', smudge: 'smudge', dodge: 'dodge', burn: 'burn', liquify: 'liquify' };
export const defaultBrush = () => ({ size: 40, hardness: 0.8, opacity: 1, spacing: 0.08, smoothing: 0 });

const emptyRect = { x: 0, y: 0, w: 0, h: 0 };
const unionRect = (a, b) => {
  if (!a.w || !a.h) return b; if (!b.w || !b.h) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

export class BrushStroke {
  // target: ImageData (colour) or { data: Uint8Array, width, height } (mask). `opts`: selection (Mask), toDocument (matrix
  // from target pixels to document), cloneSource (ImageData), cloneOffset {x, y}.
  constructor(target, settings, mode, color = [0, 0, 0, 255], scale = 1, opts = {}) {
    this.isMask = target.data instanceof Uint8Array;
    this.bpp = this.isMask ? 1 : 4;
    this.width = target.width; this.height = target.height;
    this.original = this.isMask ? target.data.slice() : target.data;   // a mask is edited live, so the stroke keeps its own untouched copy
    this.working = this.isMask ? target.data.slice() : new Uint8ClampedArray(target.data);
    this.workImage = this.isMask ? null : new ImageData(this.working, this.width, this.height);
    this.settings = settings; this.mode = mode;
    this.coverage = new Uint8Array(this.width * this.height);
    this.fullRadius = Math.max(0.5, settings.size / 2 / Math.max(1e-6, scale));
    this.radius = this.fullRadius; this.lastPressure = 1;
    const a = color[3] / 255;
    this.premul = [color[0] * a, color[1] * a, color[2] * a, color[3]];
    this.maskValue = grayOf(color[0], color[1], color[2]);
    this.selection = opts.selection || null; this.toDocument = opts.toDocument || [1, 0, 0, 1, 0, 0];
    this.cloneSource = opts.cloneSource || null; this.cloneOffset = opts.cloneOffset || { x: 0, y: 0 };
    this.touched = emptyRect;
    this.last = null; this.lastDab = null; this.residual = 0;
    this.blurred = null; this.carry = null; this.carrySize = 0;
  }

  radiusFor(p) { return Math.max(0.5, this.fullRadius * (0.15 + 0.85 * p)); }

  // Extends the stroke to a point (target pixel coordinates). Returns the changed rectangle.
  addPoint(px, py, pressure = 1) {
    pressure = Math.max(0, Math.min(1, pressure));
    let dirty = emptyRect;
    if (!this.last) {
      this.lastPressure = pressure; this.radius = this.radiusFor(pressure);
      dirty = this.dab(px, py);
      this.last = { x: px, y: py }; this.residual = 0;
    } else {
      const from = this.last, spacing = Math.max(0.5, this.radiusFor(Math.min(pressure, this.lastPressure)) * 2 * this.settings.spacing);
      const dx = px - from.x, dy = py - from.y, length = Math.hypot(dx, dy);
      if (length <= 0) return dirty;
      let travelled = spacing - this.residual;
      while (travelled <= length) {
        const t = travelled / length;
        this.radius = this.radiusFor(this.lastPressure + (pressure - this.lastPressure) * t);
        dirty = unionRect(dirty, this.dab(from.x + dx * t, from.y + dy * t));
        travelled += spacing;
      }
      this.residual = length - (travelled - spacing);
      this.last = { x: px, y: py }; this.lastPressure = pressure;
    }
    if (dirty.w > 0) this.touched = unionRect(this.touched, dirty);
    return dirty;
  }

  falloff(distance) {
    const hardness = Math.max(0, Math.min(1, this.settings.hardness)), r = this.radius;
    const edge = Math.max(0, Math.min(1, r - distance + 0.5));
    if (hardness >= 0.995) return edge;
    const inner = r * hardness;
    if (distance <= inner) return edge;
    const t = Math.max(0, Math.min(1, (distance - inner) / Math.max(1e-3, r - inner)));
    return 0.5 * (1 + Math.cos(Math.PI * t)) * edge;
  }

  dab(cx, cy) {
    const r = this.radius;
    const x0 = Math.max(0, Math.floor(cx - r - 1)), y0 = Math.max(0, Math.floor(cy - r - 1)), x1 = Math.min(this.width, Math.ceil(cx + r + 1)), y1 = Math.min(this.height, Math.ceil(cy + r + 1));
    if (x1 <= x0 || y1 <= y0) return emptyRect;
    const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    if (this.mode === BrushMode.smudge) return this.smudge(cx, cy, rect) ? rect : emptyRect;
    if (this.mode === BrushMode.liquify) return this.push(cx, cy, rect);
    let changed = false;
    const cov = this.coverage, w = this.width;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, c = Math.floor(this.falloff(Math.sqrt(dx * dx + dy * dy)) * 255 + 0.5);
      if (c <= cov[y * w + x]) continue;
      cov[y * w + x] = c; changed = true;
    }
    if (!changed) return emptyRect;
    this.recompute(rect);
    return rect;
  }

  selectionAt(x, y) {
    const s = this.selection;
    if (!s) return 1;
    const p = mapPoint(this.toDocument, x + 0.5, y + 0.5), sx = Math.floor(p.x), sy = Math.floor(p.y);
    if (sx < 0 || sy < 0 || sx >= s.width || sy >= s.height) return 0;
    return s.data[sy * s.width + sx] / 255;
  }

  makeBlurred() {
    const sigma = Math.max(1.5, this.radius * 0.25), copy = this.original.slice ? this.original.slice() : new Uint8ClampedArray(this.original);
    if (this.isMask) gaussianBlur(copy, this.width, this.height, sigma, sigma, 1, 'clamp');
    else blurRGBA(copy, this.width, this.height, sigma, sigma, 'clamp');
    return copy;
  }

  recompute(rect) {
    const m = this.mode, bpp = this.bpp, src = this.original, dst = this.working, w = this.width, opacity = Math.max(0, Math.min(1, this.settings.opacity));
    if (m === BrushMode.blur && !this.blurred) this.blurred = this.makeBlurred();
    const soft = this.blurred, clone = this.cloneSource, off = this.cloneOffset, S = [0, 0, 0, 0];
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const c = this.coverage[y * w + x];
      if (!c) continue;
      let a = c / 255 * opacity * this.selectionAt(x, y);
      const index = (y * w + x) * bpp;
      if (a <= 0) { for (let i = 0; i < bpp; i++) dst[index + i] = src[index + i]; continue; }
      // Premultiplied source pixel of the original.
      let o0, o1 = 0, o2 = 0, oa = 255;
      if (bpp === 4) { oa = src[index + 3]; o0 = src[index] * oa / 255; o1 = src[index + 1] * oa / 255; o2 = src[index + 2] * oa / 255; } else o0 = src[index];
      switch (m) {
        case BrushMode.paint: if (this.isMask) S[0] = this.maskValue; else { S[0] = this.premul[0]; S[1] = this.premul[1]; S[2] = this.premul[2]; S[3] = this.premul[3]; } break;
        case BrushMode.erase: S[0] = S[1] = S[2] = S[3] = 0; break;
        case BrushMode.heal: S[0] = S[1] = S[2] = 0; S[3] = 255; a *= 0.45; break;
        case BrushMode.clone: {
          const cx = x + off.x, cy = y + off.y;
          if (!clone || cx < 0 || cy < 0 || cx >= clone.width || cy >= clone.height) { S[0] = S[1] = S[2] = S[3] = 0; a = 0; }
          else if (this.isMask) S[0] = clone.data[cy * clone.width + cx];
          else { const ci = (cy * clone.width + cx) * 4, ca = clone.data[ci + 3]; S[0] = clone.data[ci] * ca / 255; S[1] = clone.data[ci + 1] * ca / 255; S[2] = clone.data[ci + 2] * ca / 255; S[3] = ca; }
          break;
        }
        case BrushMode.blur:
          if (this.isMask) S[0] = soft[index]; else { const ba = soft[index + 3]; S[0] = soft[index] * ba / 255; S[1] = soft[index + 1] * ba / 255; S[2] = soft[index + 2] * ba / 255; S[3] = ba; }
          break;
        case BrushMode.dodge: case BrushMode.burn:
          if (this.isMask) S[0] = m === BrushMode.dodge ? o0 + (255 - o0) * 0.5 : o0 * 0.5;
          else { S[0] = m === BrushMode.dodge ? o0 + (oa - o0) * 0.5 : o0 * 0.5; S[1] = m === BrushMode.dodge ? o1 + (oa - o1) * 0.5 : o1 * 0.5; S[2] = m === BrushMode.dodge ? o2 + (oa - o2) * 0.5 : o2 * 0.5; S[3] = oa; }
          break;
      }
      if (bpp === 1) { dst[index] = o0 * (1 - a) + S[0] * a + 0.5; continue; }
      const pa = oa * (1 - a) + S[3] * a, p0 = o0 * (1 - a) + S[0] * a, p1 = o1 * (1 - a) + S[1] * a, p2 = o2 * (1 - a) + S[2] * a;
      dst[index + 3] = pa + 0.5;
      if (pa > 0) { dst[index] = Math.min(255, p0 * 255 / pa + 0.5); dst[index + 1] = Math.min(255, p1 * 255 / pa + 0.5); dst[index + 2] = Math.min(255, p2 * 255 / pa + 0.5); }
      else dst[index] = dst[index + 1] = dst[index + 2] = 0;
    }
  }

  // Smudge drags a buffer of paint along: each dab lays the carried pixels down, then picks up what was beneath.
  smudge(cx, cy, rect) {
    const bpp = this.bpp, size = Math.ceil(this.fullRadius * 2 + 3), dst = this.working, w = this.width, h = this.height;
    const ox = Math.floor(cx - this.radius - 1), oy = Math.floor(cy - this.radius - 1);
    if (!this.carry) {
      this.carrySize = size; this.carry = new Float32Array(size * size * 4);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const px = Math.max(0, Math.min(w - 1, ox + x)), py = Math.max(0, Math.min(h - 1, oy + y));
        for (let i = 0; i < bpp; i++) this.carry[(y * size + x) * 4 + i] = dst[(py * w + px) * bpp + i];
      }
      return false;
    }
    const strength = Math.max(0, Math.min(1, this.settings.opacity)) * 0.95, cs = this.carrySize, carry = this.carry;
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const lx = x - ox, ly = y - oy;
      if (lx < 0 || ly < 0 || lx >= cs || ly >= cs) continue;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, c = this.falloff(Math.sqrt(dx * dx + dy * dy)) * this.selectionAt(x, y);
      const index = (y * w + x) * bpp, slot = (ly * cs + lx) * 4;
      for (let i = 0; i < bpp; i++) {
        const under = dst[index + i];
        carry[slot + i] = carry[slot + i] * strength + under * (1 - strength);
        if (c > 0) dst[index + i] = under + (carry[slot + i] - under) * c + 0.5;
      }
    }
    return true;
  }

  // Liquify pushes pixels along the drag: every pixel under the brush is re-read from a little way back along the movement.
  push(cx, cy, rect) {
    const prev = this.lastDab; this.lastDab = { x: cx, y: cy };
    if (!prev) return emptyRect;
    const dx = cx - prev.x, dy = cy - prev.y;
    if (!dx && !dy) return emptyRect;
    const bpp = this.bpp, strength = Math.max(0, Math.min(1, this.settings.opacity)), reach = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))) + 2, W = this.width, H = this.height;
    const ax = Math.max(0, rect.x - reach), ay = Math.max(0, rect.y - reach), aw = Math.min(W, rect.x + rect.w + reach) - ax, ah = Math.min(H, rect.y + rect.h + reach) - ay;
    const dst = this.working, snap = new Uint8ClampedArray(aw * ah * bpp);
    for (let y = 0; y < ah; y++) snap.set(dst.subarray(((y + ay) * W + ax) * bpp, ((y + ay) * W + ax + aw) * bpp), y * aw * bpp);
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const px = x + 0.5 - cx, py = y + 0.5 - cy, weight = this.falloff(Math.sqrt(px * px + py * py)) * strength * this.selectionAt(x, y);
      if (weight <= 0) continue;
      const sx = x - dx * weight - ax, sy = y - dy * weight - ay, x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0;
      const xa = Math.max(0, Math.min(aw - 1, x0)), xb = Math.max(0, Math.min(aw - 1, x0 + 1)), ya = Math.max(0, Math.min(ah - 1, y0)), yb = Math.max(0, Math.min(ah - 1, y0 + 1));
      const index = (y * W + x) * bpp;
      for (let i = 0; i < bpp; i++) {
        const top = snap[(ya * aw + xa) * bpp + i] * (1 - tx) + snap[(ya * aw + xb) * bpp + i] * tx, bottom = snap[(yb * aw + xa) * bpp + i] * (1 - tx) + snap[(yb * aw + xb) * bpp + i] * tx;
        dst[index + i] = top * (1 - ty) + bottom * ty + 0.5;
      }
    }
    return rect;
  }

  // The painted coverage as an Alpha8 plane, for tools that finish after the drag (healing).
  coverageMask() { return this.coverage; }
}
