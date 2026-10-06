import { state, update } from '../../core/state.js';
import { hexToRgb } from '../../core/pixels.js';
import { MaskMode } from '../../core/mask.js';

export const rgba = (hex, a = 255) => [...hexToRgb(hex), a];
// Shift adds, Alt subtracts, both intersect (Composa ModeFor).
export const modeFor = (ev) => (ev.shift && ev.alt ? MaskMode.intersect : ev.shift ? MaskMode.add : ev.alt ? MaskMode.subtract : MaskMode.replace);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const snap = (v) => Math.round(v);

// Constrains `to` to a multiple of 45 degrees around `from` when asked.
export function constrainAngle(from, to, on) {
  if (!on) return to;
  const dx = to.x - from.x, dy = to.y - from.y, a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}

export function nextBrushSize(size, grow) {
  const step = (s) => (s < 10 ? 1 : s < 50 ? 5 : s < 100 ? 10 : s < 300 ? 25 : 50);
  return Math.max(1, Math.min(2500, grow ? size + step(size) : size - (size <= 10 ? 1 : size <= 50 ? 5 : size <= 100 ? 10 : size <= 300 ? 25 : 50)));
}
// [ ] size, Shift+[ ] hardness by 25 %, digits opacity. Shared by the brush-like tools.
export function brushKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
    const grow = e.code === 'BracketRight';
    update({ brush: e.shiftKey ? { ...state.brush, hardness: Math.max(0, Math.min(1, state.brush.hardness + (grow ? 0.25 : -0.25))) } : { ...state.brush, size: nextBrushSize(state.brush.size, grow) } });
    return true;
  }
  if (/^Digit\d$/.test(e.code) && !e.shiftKey) {
    const n = +e.code.slice(5);
    update({ brush: { ...state.brush, opacity: n === 0 ? 1 : n / 10 } });
    return true;
  }
  return false;
}

// A ring cursor at a document point, in device pixels.
export function ring(ctx, view, dpr, p, radiusDoc) {
  const s = view.canvasToScreen(p.x, p.y), r = Math.max(1, radiusDoc * view.zoom) * dpr, x = s.x * dpr, y = s.y * dpr;
  ctx.save(); ctx.lineWidth = dpr;
  ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, r + dpr * 0.5, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r - dpr * 0.5, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
export function cross(ctx, view, dpr, p, size = 8) {
  const s = view.canvasToScreen(p.x, p.y), x = s.x * dpr, y = s.y * dpr, k = size * dpr;
  ctx.save(); ctx.lineWidth = dpr;
  for (const [c, off] of [['#000', dpr], ['#fff', 0]]) { ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(x - k + off, y); ctx.lineTo(x + k + off, y); ctx.moveTo(x + off, y - k); ctx.lineTo(x + off, y + k); ctx.stroke(); }
  ctx.restore();
}

// Adds the outline of a document-space rectangle (or its inscribed ellipse) to the current path, in device pixels.
// Corners go through canvasToScreen, so it stays right when the view is rotated.
export function rectPath(ctx, view, dpr, r, ellipse = false) {
  const pts = [];
  if (ellipse) for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; pts.push({ x: r.x + r.w / 2 + Math.cos(a) * r.w / 2, y: r.y + r.h / 2 + Math.sin(a) * r.h / 2 }); }
  else pts.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h });
  pts.forEach((p, i) => { const s = view.canvasToScreen(p.x, p.y); i ? ctx.lineTo(s.x * dpr, s.y * dpr) : ctx.moveTo(s.x * dpr, s.y * dpr); });
  ctx.closePath();
}
