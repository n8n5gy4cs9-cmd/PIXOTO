// Guides, the layout grid and snapping (port of Composa EditorSession.Guides). Guides are { id, axis: 'h'|'v', position }.
import { state } from '../state.js';
import { newId } from '../model.js';

export const GRID_SPACING = 64, GRID_SUBDIVISIONS = 8, GRID_STEP = GRID_SPACING / GRID_SUBDIVISIONS;
export const gridLines = (length) => { const out = []; for (let v = 0; v <= length + 0.001; v += GRID_STEP) out.push(Math.round(v)); return out; };

export function addGuide(doc, axis, position) {
  if (state.view.lockGuides || !Number.isFinite(position) || doc.guides.length >= 1000) return null;
  const g = { id: newId(), axis, position };
  doc.apply('New Guide', () => { doc.guides.push(g); });
  doc.emit('guides');
  return g;
}
export function moveGuide(doc, id, position) {
  const g = doc.guides.find((x) => x.id === id);
  if (state.view.lockGuides || !g || !Number.isFinite(position) || g.position === position) return;
  doc.apply('Move Guide', () => { doc.guides = doc.guides.map((x) => (x.id === id ? { ...x, position } : x)); });
  doc.emit('guides');
}
export function removeGuide(doc, id) {
  if (state.view.lockGuides || !doc.guides.some((g) => g.id === id)) return;
  doc.apply('Delete Guide', () => { doc.guides = doc.guides.filter((g) => g.id !== id); });
  doc.emit('guides');
}
export function clearGuides(doc) {
  if (!doc.guides.length) return;
  doc.apply('Clear Guides', () => { doc.guides = []; });
  doc.emit('guides');
}

// Alignment lines a move or crop may snap to, per View > Snap and Snap To.
export function snapTargets(doc, moving = null, includeCenters = true) {
  const xs = [], ys = [], v = state.view;
  if (!v.snap) return { xs, ys };
  if (v.snapBounds) { xs.push(0, doc.width); ys.push(0, doc.height); if (includeCenters) { xs.push(doc.width / 2); ys.push(doc.height / 2); } }
  if (v.snapLayers) {
    let n = 0;
    for (const l of doc.allLayers()) {
      if (!l.canvas || (moving && moving.has(l.id)) || !doc.isEffectivelyVisible(l)) continue;
      if (++n > 60) break;
      const b = l.bounds;
      xs.push(Math.round(b.x), Math.round(b.x + b.w)); ys.push(Math.round(b.y), Math.round(b.y + b.h));
      if (includeCenters) { xs.push(Math.round(b.x + b.w / 2)); ys.push(Math.round(b.y + b.h / 2)); }
    }
  }
  if (v.snapGrid && v.grid) { xs.push(...gridLines(doc.width)); ys.push(...gridLines(doc.height)); }
  if (v.snapGuides && v.guides) for (const g of doc.guides) (g.axis === 'v' ? xs : ys).push(g.position);
  return { xs, ys };
}
export function snapGuidePosition(doc, axis, position, excluding, tolerance) {
  if (!state.view.snap) return position;
  const { xs, ys } = snapTargets(doc, null, true), targets = axis === 'v' ? xs : ys;
  const own = excluding != null ? doc.guides.find((g) => g.id === excluding) : null;
  let best = position, bd = tolerance;
  for (const t of targets) { if (own && t === own.position) continue; const d = Math.abs(t - position); if (d <= bd) { bd = d; best = t; } }
  return best;
}
// Pulls a move onto the snap targets; returns the adjusted offsets and the positions snapped to.
export function snapMove(doc, box, moving, dx, dy, tolerance) {
  const { xs, ys } = snapTargets(doc, moving, true);
  let bx = tolerance, by = tolerance, ax = 0, ay = 0, snapX = null, snapY = null;
  for (const edge of [box.x, box.x + box.w / 2, box.x + box.w]) for (const t of xs) { const d = Math.abs(edge + dx - t); if (d < bx) { bx = d; ax = t - (edge + dx); snapX = t; } }
  for (const edge of [box.y, box.y + box.h / 2, box.y + box.h]) for (const t of ys) { const d = Math.abs(edge + dy - t); if (d < by) { by = d; ay = t - (edge + dy); snapY = t; } }
  return { dx: dx + ax, dy: dy + ay, snapX, snapY };
}
export function snapCropEdge(doc, value, horizontal, tolerance) {
  const { xs, ys } = snapTargets(doc, null, false);
  let best = value, bd = tolerance;
  for (const t of horizontal ? xs : ys) { const d = Math.abs(t - value); if (d < bd) { bd = d; best = t; } }
  return best;
}
