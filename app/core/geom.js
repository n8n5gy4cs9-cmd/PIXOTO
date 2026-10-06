// 2D affine matrices as [a, b, c, d, e, f] (x' = a x + c y + e, y' = b x + d y + f), the same layout as DOMMatrix.
export const IDENTITY = [1, 0, 0, 1, 0, 0];
export const translate = (x, y) => [1, 0, 0, 1, x, y];
export const scale = (sx, sy, cx = 0, cy = 0) => [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
export const rotate = (deg, cx = 0, cy = 0) => {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
};
// concat(a, b): the matrix that applies `a` first, then `b` (Skia's PostConcat).
export const concat = (a, b) => [
  b[0] * a[0] + b[2] * a[1], b[1] * a[0] + b[3] * a[1],
  b[0] * a[2] + b[2] * a[3], b[1] * a[2] + b[3] * a[3],
  b[0] * a[4] + b[2] * a[5] + b[4], b[1] * a[4] + b[3] * a[5] + b[5],
];
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
export const mapPoint = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
export const mapVector = (m, x, y) => ({ x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y });
export const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
export function mapRect(m, r) {
  const pts = [mapPoint(m, r.x, r.y), mapPoint(m, r.x + r.w, r.y), mapPoint(m, r.x + r.w, r.y + r.h), mapPoint(m, r.x, r.y + r.h)];
  return boundsOf(pts);
}
export function boundsOf(pts) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const p of pts) { l = Math.min(l, p.x); t = Math.min(t, p.y); r = Math.max(r, p.x); b = Math.max(b, p.y); }
  return { x: l, y: t, w: r - l, h: b - t };
}
export const isPureTranslation = (m) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1;

// ---- rectangles { x, y, w, h } -------------------------------------------------
export const rect = (x, y, w, h) => ({ x, y, w, h });
export const emptyRect = () => ({ x: 0, y: 0, w: 0, h: 0 });
export const isEmpty = (r) => !r || r.w <= 0 || r.h <= 0;
export const roundOut = (r) => {
  const x = Math.floor(r.x), y = Math.floor(r.y);
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
};
export function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), r = Math.min(a.x + a.w, b.x + b.w), bt = Math.min(a.y + a.h, b.y + b.h);
  return r - x <= 0 || bt - y <= 0 ? emptyRect() : { x, y, w: r - x, h: bt - y };
}
export function union(a, b) {
  if (isEmpty(a)) return b;
  if (isEmpty(b)) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
export const inflate = (r, dx, dy = dx) => ({ x: r.x - dx, y: r.y - dy, w: r.w + 2 * dx, h: r.h + 2 * dy });
export const contains = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

// ---- perspective ---------------------------------------------------------------
// Heckbert's unit-square-to-quad mapping, as Composa's Geometry.RectToQuad. Returns a function (x, y) -> point for
// a source rectangle (0,0,w,h) carried onto quad [TL, TR, BR, BL].
export function rectToQuad(w, h, q) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = [q[0].x, q[0].y, q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g = 0, hh = 0;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0; }
  else {
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-12) return (x, y) => ({ x, y });
    g = (dx3 * dy2 - dx2 * dy3) / det; hh = (dx1 * dy3 - dx3 * dy1) / det;
    a = x1 - x0 + g * x1; b = x3 - x0 + hh * x3; c = x0; d = y1 - y0 + g * y1; e = y3 - y0 + hh * y3; f = y0;
  }
  return (px, py) => {
    const u = px / w, v = py / h, z = g * u + hh * v + 1;
    return { x: (a * u + b * v + c) / z, y: (d * u + e * v + f) / z };
  };
}
// A quad a perspective can take: no corner pulled past its neighbours.
export function isConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s; else if (sign !== s) return false;
  }
  return sign !== 0;
}
// The affine map taking three points onto three others, or null when the source triangle has no area.
export function affine3(s0, s1, s2, d0, d1, d2) {
  const ux = s1.x - s0.x, uy = s1.y - s0.y, vx = s2.x - s0.x, vy = s2.y - s0.y, det = ux * vy - vx * uy;
  if (Math.abs(det) < 1e-9) return null;
  const px = d1.x - d0.x, py = d1.y - d0.y, qx = d2.x - d0.x, qy = d2.y - d0.y;
  const a = (px * vy - qx * uy) / det, c = (qx * ux - px * vx) / det, b = (py * vy - qy * uy) / det, d = (qy * ux - py * vx) / det;
  return [a, b, c, d, d0.x - (a * s0.x + c * s0.y), d0.y - (b * s0.x + d * s0.y)];
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
