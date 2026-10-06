// Magic Wand, backdrop detection, Object and Subject selection (port of Composa MagicWand / ObjectSelection /
// ImageFilters.Backdrop). Pure functions over straight RGBA bytes returning Uint8 coverage planes; workers can run them.
import { gaussianBlur } from '../filters/blur.js';
import { morph } from '../filters/blur.js';

// Selects pixels within `tol` (largest channel difference) of the seed colour, connected to it or anywhere.
export function wandPlane(d, w, h, sx, sy, tol, contiguous, smooth = true) {
  const out = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const si = (sy * w + sx) * 4, sr = d[si], sg = d[si + 1], sb = d[si + 2], sa = d[si + 3];
  const match = (i) => Math.abs(d[i] - sr) <= tol && Math.abs(d[i + 1] - sg) <= tol && Math.abs(d[i + 2] - sb) <= tol && Math.abs(d[i + 3] - sa) <= tol;
  if (!contiguous) for (let i = 0; i < w * h; i++) { if (match(i * 4)) out[i] = 255; }
  else floodSpans(out, w, h, sx, sy, (x, y) => match((y * w + x) * 4));
  if (smooth) gaussianBlur(out, w, h, 0.5, 0.5, 1, 'zero');
  return out;
}

// Scanline flood fill of `out` from a seed over pixels where `ok(x, y)` holds.
export function floodSpans(out, w, h, sx, sy, ok) {
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop(), row = y * w;
    if (out[row + x] || !ok(x, y)) continue;
    let l = x, r = x;
    while (l > 0 && !out[row + l - 1] && ok(l - 1, y)) l--;
    while (r < w - 1 && !out[row + r + 1] && ok(r + 1, y)) r++;
    for (let i = l; i <= r; i++) out[row + i] = 255;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      const nr = ny * w;
      let run = false;
      for (let i = l; i <= r; i++) {
        const open = !out[nr + i] && ok(i, ny);
        if (open && !run) stack.push(i, ny);
        run = open;
      }
    }
  }
}

// The plain backdrop: every pixel connected to the edges within `tol` of the edge colour it grew from.
export function backdropPlane(d, w, h, tol) {
  const bg = new Uint8Array(w * h), stepX = Math.max(1, Math.floor(w / 24)), stepY = Math.max(1, Math.floor(h / 24)), seeds = [];
  for (let x = 0; x < w; x += stepX) seeds.push([x, 0], [x, h - 1]);
  for (let y = 0; y < h; y += stepY) seeds.push([0, y], [w - 1, y]);
  for (const [x, y] of seeds) {
    if (bg[y * w + x]) continue;
    const region = wandPlane(d, w, h, x, y, tol, true, false);
    for (let i = 0; i < region.length; i++) if (region[i]) bg[i] = 255;
  }
  return bg;
}
function removeTransparent(d, plane) { for (let i = 0; i < plane.length; i++) if (d[i * 4 + 3] < 8) plane[i] = 0; }
const invertPlane = (p) => { const o = new Uint8Array(p.length); for (let i = 0; i < p.length; i++) o[i] = 255 - p[i]; return o; };

// Everything that is not the border-connected backdrop. Null when there is none.
export function subjectPlane(d, w, h) {
  const subject = invertPlane(backdropPlane(d, w, h, 40));
  removeTransparent(d, subject);
  if (!subject.some((v) => v)) return null;
  gaussianBlur(subject, w, h, 0.5, 0.5, 1, 'zero');
  return subject;
}
// The connected foreground piece around a point, tightened (positive offset) or loosened by `offset` pixels. Null on the backdrop.
export function objectPlane(d, w, h, x, y, offset, smooth = true) {
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const backdrop = backdropPlane(d, w, h, 40);
  if (backdrop[y * w + x] || d[(y * w + x) * 4 + 3] < 8) return null;
  const fg = invertPlane(backdrop);
  removeTransparent(d, fg);
  const piece = new Uint8Array(w * h);
  floodSpans(piece, w, h, x, y, (px, py) => fg[py * w + px] >= 128);
  let result = piece;
  const steps = Math.min(10, Math.abs(offset));
  if (steps > 0) {
    result = morph(piece, w, h, steps, offset < 0);
    if (!result.some((v) => v)) return null;
  }
  if (smooth) { result = result === piece ? piece.slice() : result; gaussianBlur(result, w, h, 1, 1, 1, 'zero'); }
  return result;
}
