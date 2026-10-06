// Crop tool (Composa): drag a box, handles adjust it, ratios, symmetric with Alt, Enter applies, Escape cancels.
import { state } from '../../core/state.js';
import * as C from '../../core/ops/canvas.js';
import { snapCropEdge } from '../../core/ops/guides.js';
import { hitFrame, drawFrame } from './move.js';
import { snap, rectPath } from './common.js';

export const CROP_RATIOS = ['Free', 'Original', '1:1', '4:3', '3:4', '16:9', '9:16'];
const aspectOf = (doc) => ({ Original: doc.width / doc.height, '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16 })[state.cropRatio] ?? null;
const rectCorners = (r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
const std = (l, t, r, b) => ({ x: Math.min(l, r), y: Math.min(t, b), w: Math.abs(r - l), h: Math.abs(b - t) });

export class CropTool {
  constructor(app) { this.app = app; this.rect = null; this.handle = 'none'; this.start = null; }
  cursor() { return 'crosshair'; }
  get has() { return !!this.rect; }

  // With a selection, the crop starts at its bounds, as Photoshop's does.
  activate() {
    const doc = this.app.doc;
    if (!this.rect && doc?.selection) { const b = doc.selection.bounds(); if (b.w) this.rect = this.constrain({ ...b }); }
    this.app.view.invalidate();
  }
  deactivate() { this.rect = null; this.app.onToolState?.(); }

  // Reshapes a box to the chosen ratio about its centre, kept to the width or height that still fits the canvas.
  constrain(box) {
    const doc = this.app.doc, aspect = aspectOf(doc);
    if (!aspect || box.w < 1 || box.h < 1) return box;
    let w = box.w, h = w / aspect;
    if (h > doc.height) { h = doc.height; w = h * aspect; }
    if (w > doc.width) { w = doc.width; h = w / aspect; }
    let x = box.x + box.w / 2 - w / 2, y = box.y + box.h / 2 - h / 2;
    x += Math.max(0, -x) - Math.max(0, x + w - doc.width); y += Math.max(0, -y) - Math.max(0, y + h - doc.height);
    return { x, y, w, h };
  }
  ratioChanged() { if (this.rect) this.rect = this.constrain(this.rect); this.app.view.invalidate(); this.app.onToolState?.(); }

  usesCtrl(ev) { return !!this.rect && hitFrame(ev.view, rectCorners(this.rect), ev.screen, false) !== 'none'; }
  down(ev) {
    this.handle = this.rect ? hitFrame(ev.view, rectCorners(this.rect), ev.screen, false) : 'none';
    if (this.handle === 'none') { this.rect = null; this.handle = 'br'; this.start = { x: snap(ev.p.x), y: snap(ev.p.y), w: 0, h: 0 }; }
    else this.start = { ...this.rect };
  }
  snapEdge(ev, v, horizontal) { return ev.ctrl ? v : snapCropEdge(ev.doc, v, horizontal, 8 / ev.view.zoom); }
  move(ev) {
    const s = this.start, h = this.handle;
    let l = s.x, t = s.y, r = s.x + s.w, b = s.y + s.h;
    const px = this.snapEdge(ev, snap(ev.p.x), true), py = this.snapEdge(ev, snap(ev.p.y), false);
    if (h === 'move') { this.rect = { x: s.x + snap(ev.p.x - ev.press.x), y: s.y + snap(ev.p.y - ev.press.y), w: s.w, h: s.h }; this.app.onToolState?.(); return; }
    const mL = ['tl', 'l', 'bl'].includes(h), mR = ['tr', 'r', 'br'].includes(h), mT = ['tl', 't', 'tr'].includes(h), mB = ['bl', 'b', 'br'].includes(h);
    if (mL) l = px; if (mR) r = px; if (mT) t = py; if (mB) b = py;
    // The bar's ratio always holds; without one, Shift keeps the box's proportions (a fresh box becomes square).
    const ratio = aspectOf(ev.doc) ?? (ev.shift ? (s.w > 0 && s.h > 0 ? s.w / s.h : 1) : null);
    if (ratio) {
      const ax = mL ? s.x + s.w : s.x, ay = mT ? s.y + s.h : s.y, dx = mL ? l : r, dy = mT ? t : b;
      let w = Math.abs(dx - ax), hh = Math.abs(dy - ay);
      if ((mL || mR) && !mT && !mB) { hh = w / ratio; l = dx >= ax ? ax : ax - w; r = l + w; t = s.y + s.h / 2 - hh / 2; b = t + hh; }
      else if ((mT || mB) && !mL && !mR) { w = hh * ratio; t = dy >= ay ? ay : ay - hh; b = t + hh; l = s.x + s.w / 2 - w / 2; r = l + w; }
      else { if (w / ratio > hh) hh = w / ratio; else w = hh * ratio; l = dx >= ax ? ax : ax - w; r = l + w; t = dy >= ay ? ay : ay - hh; b = t + hh; }
    }
    if (ev.alt) {
      // Symmetric cropping: the opposite edge mirrors the dragged one.
      const cx = s.w > 0 ? s.x + s.w / 2 : s.x, cy = s.h > 0 ? s.y + s.h / 2 : s.y;
      if (l !== s.x) r = 2 * cx - l; else if (r !== s.x + s.w) l = 2 * cx - r;
      if (t !== s.y) b = 2 * cy - t; else if (b !== s.y + s.h) t = 2 * cy - b;
    }
    this.rect = std(l, t, r, b);
    this.app.onToolState?.();
  }
  up() { if (this.rect && (this.rect.w < 1 || this.rect.h < 1)) this.rect = null; this.app.onToolState?.(); }
  apply() {
    const r = this.rect, doc = this.app.doc; if (!r || !doc) return;
    this.rect = null;
    const ri = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
    if (ri.w >= 1 && ri.h >= 1) C.crop(doc, ri);
    this.app.view.fit(); this.app.onToolState?.();
  }
  cancelCrop() { this.rect = null; this.app.view.invalidate(); this.app.onToolState?.(); }
  key(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Enter' && this.rect) { this.apply(); return true; }
    if (e.key === 'Escape' && this.rect) { this.cancelCrop(); return true; }
    return false;
  }
  cancel() {}
  overlay(ctx, view, dpr) {
    const r = this.rect; if (!r) return;
    const W = ctx.canvas.width, H = ctx.canvas.height, P = (x, y) => { const s = view.canvasToScreen(x, y); return [s.x * dpr, s.y * dpr]; };
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.rect(0, 0, W, H); rectPath(ctx, view, dpr, r); ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = dpr; ctx.beginPath();
    for (const k of [1, 2]) { ctx.moveTo(...P(r.x + r.w * k / 3, r.y)); ctx.lineTo(...P(r.x + r.w * k / 3, r.y + r.h)); ctx.moveTo(...P(r.x, r.y + r.h * k / 3)); ctx.lineTo(...P(r.x + r.w, r.y + r.h * k / 3)); }
    ctx.stroke(); ctx.restore();
    drawFrame(ctx, view, dpr, rectCorners(r), true);
  }
}
