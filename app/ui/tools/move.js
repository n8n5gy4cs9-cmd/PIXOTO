// Move / Transform tool (Composa): drag layers, resize/rotate/distort through handles, Auto Select, snapping, nudging.
import { state } from '../../core/state.js';
import { getData } from '../../core/pixels.js';
import * as T from '../../core/ops/transform.js';
import { FloatSession, canMovePixels } from '../../core/ops/selection.js';
import { selectLayer } from '../../core/ops/layers.js';
import { snapMove } from '../../core/ops/guides.js';
import { dist } from './common.js';
import * as G from '../../core/geom.js';

const insideSel = (doc, p) => !!doc.selection && doc.selection.at(Math.floor(p.x), Math.floor(p.y)) >= 128;
const containsPoly = (poly, p) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) inside = !inside;
  return inside;
};

// The topmost visible layer with a non-transparent pixel under a document point.
export function layerAt(doc, p) {
  const all = [...doc.allLayers()].reverse();
  for (const l of all) {
    if (!l.canvas || !doc.isEffectivelyVisible(l)) continue;
    const inv = G.invert(l.matrix); if (!inv) continue;
    const q = G.mapPoint(inv, p.x, p.y), x = Math.floor(q.x), y = Math.floor(q.y);
    if (x < 0 || y < 0 || x >= l.canvas.width || y >= l.canvas.height) continue;
    if (getData(l.canvas, x, y, 1, 1).data[3] > 12) return l;
  }
  return null;
}

// The transform frame for the current selection as document-space corners, or null.
export function currentFrame(doc) {
  if (doc.transformEdit) return doc.transformEdit.corners();
  const targets = T.transformTargets(doc);
  if (!targets.length) return null;
  if (targets.length === 1) {
    const l = targets[0];
    if (l.transform.distort) return l.corners;
    const t = l.transform, m = G.rotate(t.rotation, t.x + t.width / 2, t.y + t.height / 2), P = (x, y) => G.mapPoint(m, x, y);
    return [P(t.x, t.y), P(t.x + t.width, t.y), P(t.x + t.width, t.y + t.height), P(t.x, t.y + t.height)];
  }
  let b = G.emptyRect(); for (const l of targets) b = G.union(b, l.bounds);
  return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
}
// Which handle of a frame (document corners) is under a screen point (css px).
export function hitFrame(view, corners, screen, allowRotate) {
  const pts = corners.map((c) => view.canvasToScreen(c.x, c.y)), mid = (a, b) => ({ x: (pts[a].x + pts[b].x) / 2, y: (pts[a].y + pts[b].y) / 2 });
  const handles = [[pts[0], 'tl'], [pts[1], 'tr'], [pts[2], 'br'], [pts[3], 'bl'], [mid(0, 1), 't'], [mid(1, 2), 'r'], [mid(2, 3), 'b'], [mid(3, 0), 'l']];
  for (const [p, h] of handles) if (dist(p, screen) <= 7) return h;
  if (containsPoly(pts, screen)) return 'move';
  if (allowRotate) for (const p of pts) if (dist(p, screen) <= 26) return 'rotate';
  return 'none';
}
const CURSORS = { tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize', rotate: 'crosshair', move: 'move' };

export class MoveTool {
  constructor(app) { this.app = app; this.handle = 'none'; this.snapLines = []; this.mode = null; this.hoverCursor = 'default'; }
  cursor() { return this.hoverCursor; }
  usesCtrl() { return false; }
  hover(ev) {
    let c = 'default';
    if (state.transformControls) { const f = currentFrame(ev.doc); if (f) { const h = hitFrame(ev.view, f, ev.screen, true); if (h !== 'none' && h !== 'move') c = CURSORS[h]; else if (h === 'move') c = 'move'; } }
    if (c !== this.hoverCursor) { this.hoverCursor = c; ev.view.canvas.style.cursor = c; }
  }

  down(ev) {
    const { doc, view } = ev;
    if (ev.temporary) return this.beginTemporary(ev);
    if (ev.clickCount >= 2 && this.app.editTextAt?.(ev)) return;
    if (canMovePixels(doc) && insideSel(doc, ev.p)) { const f = FloatSession.begin(doc, ev.alt); if (f) { this.float = f; this.mode = 'pixels'; return; } }
    this.beginMove(ev);
  }
  beginTemporary(ev) {
    const { doc, view } = ev;
    this.handle = 'move'; this.distort = -1;
    const frame = currentFrame(doc), hit = layerAt(doc, ev.p);
    if (hit && !doc.selectedIds.has(hit.id) && (!frame || hitFrame(view, frame, ev.screen, false) === 'none')) selectLayer(doc, hit.id);
    if (!T.beginTransform(doc, 'Move')) { this.app.problem('Select a layer with pixels to move.'); return; }
    this.temporary = true; this.mode = 'transform';
  }
  beginMove(ev) {
    const { doc, view } = ev;
    const frame = state.transformControls ? currentFrame(doc) : null;
    this.handle = frame ? hitFrame(view, frame, ev.screen, true) : 'none'; this.distort = -1; this.temporary = false;
    const onHandle = this.handle !== 'none' && this.handle !== 'move';
    if (!onHandle) {
      const hit = layerAt(doc, ev.p), active = doc.active;
      const above = !active || !hit || [...doc.allLayers()].indexOf(hit) > [...doc.allLayers()].indexOf(active);
      if (hit && !doc.selectedIds.has(hit.id) && (ev.ctrl || ev.clickCount >= 2 || (state.autoSelect && (this.handle === 'none' || above)))) selectLayer(doc, hit.id, { extend: ev.shift });
      this.handle = 'move';
    } else if ((ev.ctrl || this.isDistorted(doc)) && ['tl', 'tr', 'br', 'bl'].includes(this.handle)) this.distort = { tl: 0, tr: 1, br: 2, bl: 3 }[this.handle];
    const name = this.handle === 'move' ? 'Move' : this.handle === 'rotate' ? 'Rotate' : this.distort >= 0 ? 'Distort' : 'Scale';
    if (!T.beginTransform(doc, name)) { this.app.problem('Select a layer with pixels to move.'); return; }
    this.mode = 'transform';
  }
  isDistorted(doc) { const t = T.transformTargets(doc); return t.length === 1 && !!t[0].transform.distort; }

  move(ev) {
    if (this.mode === 'pixels') { let dx = ev.p.x - ev.press.x, dy = ev.p.y - ev.press.y; if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } this.float.moveBy(Math.round(dx), Math.round(dy)); return; }
    const edit = ev.doc.transformEdit;
    if (this.mode !== 'transform' || !edit) return;
    this.snapLines = [];
    if (this.handle === 'move') {
      let dx = ev.p.x - ev.press.x, dy = ev.p.y - ev.press.y;
      if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      dx = Math.round(dx); dy = Math.round(dy);
      if ((!ev.ctrl || this.temporary) && state.view.snap) {
        const s = edit.startFrame, box = G.mapRect(G.rotate(edit.startRotation, s.x + s.w / 2, s.y + s.h / 2), s);
        const r = snapMove(ev.doc, box, new Set(edit.layerList.map((l) => l.id)), dx, dy, 6 / ev.view.zoom);
        dx = r.dx; dy = r.dy;
        if (r.snapX != null) this.snapLines.push({ v: true, at: r.snapX }); if (r.snapY != null) this.snapLines.push({ v: false, at: r.snapY });
      }
      edit.moveBy(dx, dy);
    } else if (this.handle === 'rotate') edit.rotateTo(ev.press, ev.p, ev.shift);
    else if (this.distort >= 0) edit.distortCorner(this.distort, ev.p);
    else edit.resize(this.handle, ev.p, ev.shift, ev.alt);
    this.app.onTransformChange?.();
  }
  up(ev) {
    const m = this.mode; this.mode = null; this.snapLines = [];
    if (m === 'pixels') { this.float.end(ev.moved); this.float = null; }
    else if (m === 'transform') { if (ev.moved) T.commitTransform(ev.doc); else T.cancelTransform(ev.doc); }
    this.temporary = false;
    this.app.onTransformChange?.();
  }
  cancel() {
    if (this.float) { this.float.end(false); this.float = null; }
    if (this.app.doc) T.cancelTransform(this.app.doc);
    this.mode = null; this.snapLines = [];
  }
  key(e, view) {
    const doc = this.app.doc;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.code.startsWith('Arrow')) {
      const step = e.shiftKey ? 10 : 1;
      T.nudge(doc, e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0, e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0);
      return true;
    }
    if (/^Digit\d$/.test(e.code) && !e.shiftKey && doc.active) { const n = +e.code.slice(5); doc.setPropStep(doc.active, 'opacity', n === 0 ? 1 : n / 10, 'Change Opacity'); return true; }
    return false;
  }
  overlay(ctx, view, dpr) {
    const doc = view.doc;
    for (const l of this.snapLines) {
      const s = l.v ? view.canvasToScreen(l.at, 0).x : view.canvasToScreen(0, l.at).y;
      ctx.save(); ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = dpr; ctx.beginPath();
      if (l.v) { ctx.moveTo(s * dpr, 0); ctx.lineTo(s * dpr, ctx.canvas.height); } else { ctx.moveTo(0, s * dpr); ctx.lineTo(ctx.canvas.width, s * dpr); }
      ctx.stroke(); ctx.restore();
    }
    if (!state.transformControls || this.temporary) return;
    const f = currentFrame(doc); if (!f) return;
    drawFrame(ctx, view, dpr, f, true);
  }
}
// Draws a frame with eight handles; `handles` false draws only the outline (crop shows thirds separately).
export function drawFrame(ctx, view, dpr, corners, handles) {
  const pts = corners.map((c) => { const s = view.canvasToScreen(c.x, c.y); return { x: s.x * dpr, y: s.y * dpr }; });
  ctx.save(); ctx.lineWidth = dpr; ctx.strokeStyle = '#3d9bff';
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
  if (handles) {
    const mid = (a, b) => ({ x: (pts[a].x + pts[b].x) / 2, y: (pts[a].y + pts[b].y) / 2 }), hs = [...pts, mid(0, 1), mid(1, 2), mid(2, 3), mid(3, 0)], r = 4 * dpr;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1b6fd0';
    for (const h of hs) { ctx.beginPath(); ctx.rect(h.x - r, h.y - r, 2 * r, 2 * r); ctx.fill(); ctx.stroke(); }
  }
  ctx.restore();
}
