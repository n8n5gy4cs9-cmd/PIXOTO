// Marquee, Lasso and Magic (Wand / Object): selection tools (Composa CanvasView.Input).
import { state } from '../../core/state.js';
import { MaskMode, translateMask } from '../../core/mask.js';
import * as S from '../../core/ops/selection.js';
import { modeFor, dist, snap, rectPath } from './common.js';

// Strokes a path function twice, white then black dashed, so it reads on any picture.
export function antsStroke(ctx, dpr, draw, phase = 0) {
  ctx.save(); ctx.lineWidth = dpr;
  ctx.setLineDash([]); ctx.strokeStyle = '#fff'; ctx.beginPath(); draw(); ctx.stroke();
  ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.lineDashOffset = phase; ctx.strokeStyle = '#000'; ctx.beginPath(); draw(); ctx.stroke();
  ctx.restore();
}
const insideSelection = (doc, p) => { const s = doc.selection, x = Math.floor(p.x), y = Math.floor(p.y); return !!s && s.at(x, y) >= 128; };

// The rectangle dragged from the press point, optionally square and/or grown from its centre.
export function dragRect(press, cur, square, fromCenter) {
  let dx = snap(cur.x) - snap(press.x), dy = snap(cur.y) - snap(press.y);
  if (square) { const side = Math.max(Math.abs(dx), Math.abs(dy)); dx = (dx < 0 ? -1 : 1) * side; dy = (dy < 0 ? -1 : 1) * side; }
  const px = snap(press.x), py = snap(press.y);
  if (fromCenter) return { x: px - Math.abs(dx), y: py - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
  return { x: Math.min(px, px + dx), y: Math.min(py, py + dy), w: Math.abs(dx), h: Math.abs(dy) };
}

class SelectionBase {
  constructor(app) { this.app = app; }
  cursor() { return 'crosshair'; }
  nudge(e) {
    const doc = this.app.doc;
    if (!doc?.selection || !e.code.startsWith('Arrow') || e.ctrlKey || e.metaKey || e.altKey) return false;
    const step = e.shiftKey ? 10 : 1;
    S.moveSelection(doc, e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0, e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0);
    return true;
  }
  // Drag inside a selection with Replace mode moves its outline (live preview, one undo step on release).
  beginMoveSelection(ev) { this.moveStart = ev.doc.selection; this.dragKind = 'moveSelection'; }
  moveSelectionTo(ev) {
    const dx = Math.round(ev.p.x - ev.press.x), dy = Math.round(ev.p.y - ev.press.y);
    S.previewSelection(ev.doc, (dx || dy ? translateMask(this.moveStart, dx, dy) : null) ?? this.moveStart);
  }
  endMoveSelection(ev) {
    const doc = ev.doc, dx = Math.round(ev.p.x - ev.press.x), dy = Math.round(ev.p.y - ev.press.y);
    doc.selection = this.moveStart; this.moveStart = null;
    if (ev.moved) S.moveSelection(doc, dx, dy); else S.deselect(doc);
    doc.selectionChanged();
  }
}

export class MarqueeTool extends SelectionBase {
  usesCtrl(ev) { return !!(ev.doc.selection && S.canMovePixels(ev.doc) && insideSelection(ev.doc, ev.p)); }
  down(ev) {
    const { doc } = ev;
    this.mode = modeFor({ ...ev, ctrl: false });
    if (!doc.selection && this.mode === MaskMode.add) this.mode = MaskMode.replace;
    this.shiftReleased = false; this.shiftHeld = ev.shift;
    if (ev.ctrl && insideSelection(doc, ev.p)) { const f = S.FloatSession.begin(doc, ev.alt); if (f) { this.float = f; this.dragKind = 'pixels'; return; } }
    if (this.mode === MaskMode.replace && insideSelection(doc, ev.p)) this.beginMoveSelection(ev); else this.dragKind = 'marquee';
    this.cur = ev.p;
  }
  constrains(shift) { return shift && (this.mode !== MaskMode.add && this.mode !== MaskMode.intersect || this.shiftReleased); }
  move(ev) {
    this.cur = ev.p; this.curShift = ev.shift;
    if (this.dragKind === 'marquee' && !ev.shift) this.shiftReleased = true;
    if (this.dragKind === 'pixels') { let dx = ev.p.x - ev.press.x, dy = ev.p.y - ev.press.y; if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } this.float.moveBy(Math.round(dx), Math.round(dy)); }
    else if (this.dragKind === 'moveSelection') this.moveSelectionTo(ev);
  }
  up(ev) {
    const { doc } = ev, k = this.dragKind; this.dragKind = null;
    if (k === 'pixels') { this.float.end(ev.moved); this.float = null; return; }
    if (k === 'moveSelection') { this.endMoveSelection(ev); return; }
    if (k !== 'marquee') return;
    if (!ev.moved) { if (this.mode === MaskMode.replace) S.deselect(doc); return; }
    const r = dragRect(ev.press, ev.p, this.constrains(ev.shift), false);
    if (state.modes.marquee === 1) S.selectEllipse(doc, r, this.mode, state.feather); else S.selectRect(doc, r, this.mode, state.feather);
  }
  cancel() {
    if (this.float) { this.float.end(false); this.float = null; }
    if (this.moveStart) { this.app.doc.selection = this.moveStart; this.moveStart = null; this.app.doc.selectionChanged(); }
    this.dragKind = null;
  }
  key(e) { return this.nudge(e); }
  overlay(ctx, view, dpr) {
    if (this.dragKind !== 'marquee' || !view.drag) return;
    const r = dragRect(view.drag.press, this.cur, this.constrains(this.curShift ?? false), false);
    antsStroke(ctx, dpr, () => rectPath(ctx, view, dpr, r, state.modes.marquee === 1));
  }
}

export class LassoTool extends SelectionBase {
  constructor(app) { super(app); this.poly = []; this.freehand = null; }
  get polygonal() { return state.modes.lasso === 1; }
  down(ev) {
    const { doc, view } = ev;
    if (!this.poly.length) this.mode = modeFor(ev);
    if (!this.polygonal) {
      if (this.mode === MaskMode.replace && insideSelection(doc, ev.p)) { this.beginMoveSelection(ev); return; }
      this.freehand = [ev.p]; this.dragKind = 'free'; return;
    }
    this.dragKind = 'poly';
    const closes = this.poly.length > 2 && dist(view.canvasToScreen(this.poly[0].x, this.poly[0].y), ev.screen) < 8;
    if (ev.clickCount >= 2 || closes) this.finishPolygon(doc); else this.poly.push(ev.p);
  }
  finishPolygon(doc) {
    if (this.poly.length > 2) S.selectPolygon(doc, this.poly, this.mode, state.feather);
    this.poly = []; this.app.view.invalidate();
  }
  move(ev) {
    this.cur = ev.p;
    if (this.dragKind === 'free') { for (const pt of ev.points) { const last = this.freehand.at(-1); if (dist(ev.view.canvasToScreen(last.x, last.y), ev.view.canvasToScreen(pt.p.x, pt.p.y)) >= 2) this.freehand.push(pt.p); } }
    else if (this.dragKind === 'moveSelection') this.moveSelectionTo(ev);
  }
  up(ev) {
    const k = this.dragKind; if (k !== 'poly') this.dragKind = null;
    if (k === 'moveSelection') this.endMoveSelection(ev);
    else if (k === 'free') {
      if (this.freehand.length > 2) S.selectPolygon(ev.doc, this.freehand, this.mode, state.feather);
      else if (this.mode === MaskMode.replace) S.deselect(ev.doc);
      this.freehand = null;
    }
  }
  cancel() { this.freehand = null; this.dragKind = null; if (this.moveStart) { this.app.doc.selection = this.moveStart; this.moveStart = null; } }
  key(e) {
    const doc = this.app.doc;
    if (this.poly.length) {
      if (e.key === 'Enter') { this.finishPolygon(doc); return true; }
      if (e.key === 'Backspace' || e.key === 'Delete') { this.poly.pop(); this.app.view.invalidate(); return true; }
      if (e.key === 'Escape') { this.poly = []; this.app.view.invalidate(); return true; }
    }
    return this.nudge(e);
  }
  deactivate() { this.poly = []; }
  overlay(ctx, view, dpr) {
    const pts = this.dragKind === 'free' ? this.freehand : this.poly.length ? [...this.poly, ...(view.hover ? [view.hover] : [])] : null;
    if (!pts || pts.length < 2) return;
    antsStroke(ctx, dpr, () => pts.forEach((p, i) => { const s = view.canvasToScreen(p.x, p.y); i ? ctx.lineTo(s.x * dpr, s.y * dpr) : ctx.moveTo(s.x * dpr, s.y * dpr); }));
  }
}

export class MagicTool extends SelectionBase {
  down(ev) {
    const { doc, p } = ev, x = Math.floor(p.x), y = Math.floor(p.y), mode = modeFor(ev);
    if (state.modes.wand === 1) S.selectObject(doc, x, y, { edge: state.objectEdge ?? 0, sampleAll: state.wandAllLayers, mode });
    else S.selectWand(doc, x, y, { tolerance: state.wandTolerance, contiguous: state.wandContiguous, sampleAll: state.wandAllLayers, mode });
  }
  key(e) { return this.nudge(e); }
}
