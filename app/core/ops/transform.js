// Interactive move / scale / rotate / distort of the selected layers (port of Composa TransformEdit). Every change is
// computed from the transforms captured when the drag started, so rounding never accumulates.
import { remapMask } from '../mask.js';
import { transformCorners } from '../model.js';
import * as G from '../geom.js';

export const Handle = { none: 'none', move: 'move', tl: 'tl', t: 't', tr: 'tr', r: 'r', br: 'br', b: 'b', bl: 'bl', l: 'l', rotate: 'rotate' };

// Hooks the text/shape modules register to redraw live layers sharply after a transform.
let liveRescale = () => {};
export const setLiveRescale = (fn) => { liveRescale = fn; };

const normalize = (deg) => { deg %= 360; if (deg > 180) deg -= 360; if (deg <= -180) deg += 360; return Math.round(deg * 100) / 100; };
const rot = (deg, cx, cy) => G.rotate(deg, cx, cy);
const same = (a, b) => ['x', 'y', 'width', 'height', 'rotation', 'flipH', 'flipV'].every((k) => a[k] === b[k]) && JSON.stringify(a.distort) === JSON.stringify(b.distort);
export const sameTransform = same;

// The raster layers a transform applies to: the selection, including everything inside selected folders.
export function transformTargets(doc) {
  const out = new Set();
  for (const r of doc.selectedRoots()) for (const l of [r, ...doc.allLayers(r.children)]) if (l.canvas) out.add(l);
  return [...out];
}

export class TransformEdit {
  constructor(doc, targets, maskOwners) {
    this.doc = doc;
    this.layers = targets.map((l) => ({ layer: l, start: l.transform }));
    this.masks = maskOwners.map((l) => ({ layer: l, start: l.mask }));
    this.startRotation = 0;
    if (!this.layers.length) this.startFrame = { x: 0, y: 0, w: doc.width, h: doc.height };
    else if (this.layers.length === 1) { const t = this.layers[0].start; this.startFrame = { x: t.x, y: t.y, w: t.width, h: t.height }; this.startRotation = t.rotation; }
    else { let b = G.emptyRect(); for (const { layer } of this.layers) b = G.union(b, layer.bounds); this.startFrame = b; }
    this.frame = { ...this.startFrame }; this.rotation = this.startRotation;
  }
  get layerList() { return this.layers.map((l) => l.layer); }
  // The frame's document-space corners TL, TR, BR, BL. A distorted layer's frame is the distorted shape itself.
  corners() {
    if (this.layers.length === 1 && this.layers[0].layer.transform.distort) { const l = this.layers[0].layer; return transformCorners(l.transform, l.canvas.width, l.canvas.height); }
    const f = this.frame, m = rot(this.rotation, f.x + f.w / 2, f.y + f.h / 2), P = (x, y) => G.mapPoint(m, x, y);
    return [P(f.x, f.y), P(f.x + f.w, f.y), P(f.x + f.w, f.y + f.h), P(f.x, f.y + f.h)];
  }
  set(frame, rotation) {
    if (this.doc.transformEdit !== this) return;
    const before = this.area();
    this.frame = frame; this.rotation = rotation;
    this.update();
    this.doc.invalidate(G.union(before, this.area()));
  }
  moveBy(dx, dy) { const s = this.startFrame; this.set({ x: s.x + dx, y: s.y + dy, w: s.w, h: s.h }, this.rotation); }

  // Drags a resize handle to a document point. Shift frees proportions; Alt scales about the centre.
  resize(handle, point, free, fromCenter) {
    const s = this.startFrame, p = G.mapPoint(rot(-this.startRotation, s.x + s.w / 2, s.y + s.h / 2), point.x, point.y);
    let left = s.x, top = s.y, right = s.x + s.w, bottom = s.y + s.h;
    const mL = ['tl', 'l', 'bl'].includes(handle), mR = ['tr', 'r', 'br'].includes(handle), mT = ['tl', 't', 'tr'].includes(handle), mB = ['bl', 'b', 'br'].includes(handle);
    if (mL) left = p.x; if (mR) right = p.x; if (mT) top = p.y; if (mB) bottom = p.y;
    if (!free && s.w > 0 && s.h > 0) {
      const aspect = s.w / s.h;
      let w = right - left, h = bottom - top;
      if ((mL || mR) && (mT || mB)) {
        if (Math.abs(w) / aspect > Math.abs(h)) h = Math.abs(w) / aspect * Math.sign(h === 0 ? 1 : h); else w = Math.abs(h) * aspect * Math.sign(w === 0 ? 1 : w);
        if (mL) left = right - w; else right = left + w;
        if (mT) top = bottom - h; else bottom = top + h;
      } else if (mL || mR) { h = Math.abs(w) / aspect; top = s.y + s.h / 2 - h / 2; bottom = s.y + s.h / 2 + h / 2; }
      else { w = Math.abs(h) * aspect; left = s.x + s.w / 2 - w / 2; right = s.x + s.w / 2 + w / 2; }
    }
    if (fromCenter) {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const hw = mL ? cx - left : mR ? right - cx : (right - left) / 2, hh = mT ? cy - top : mB ? bottom - cy : (bottom - top) / 2;
      left = cx - hw; right = cx + hw; top = cy - hh; bottom = cy + hh;
    }
    if (Math.abs(right - left) < 1) right = left + 1;
    if (Math.abs(bottom - top) < 1) bottom = top + 1;
    // Resizing moves the centre; keep the opposite edge fixed on screen by rotating the new centre back.
    const c = G.mapPoint(rot(this.startRotation, s.x + s.w / 2, s.y + s.h / 2), (left + right) / 2, (top + bottom) / 2), w = right - left, h = bottom - top;
    this.set({ x: c.x - w / 2, y: c.y - h / 2, w, h }, this.startRotation);
  }
  rotateTo(start, point, snap) {
    const s = this.startFrame, cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    const a0 = Math.atan2(start.y - cy, start.x - cx), a1 = Math.atan2(point.y - cy, point.x - cx);
    let r = this.startRotation + (a1 - a0) * 180 / Math.PI;
    if (snap) r = Math.round(r / 15) * 15;
    this.set(this.frame, normalize(r));
  }
  // Folder and adjustment masks live in document space; they follow a move so they stay over their content.
  moveMasks() {
    const dx = Math.round(this.frame.x + this.frame.w / 2 - (this.startFrame.x + this.startFrame.w / 2)), dy = Math.round(this.frame.y + this.frame.h / 2 - (this.startFrame.y + this.startFrame.h / 2));
    for (const { layer, start } of this.masks) layer.mask = dx || dy ? remapMask(start, start.width, start.height, G.translate(dx, dy), start.data[0]) : start;
  }
  area() {
    if (this.masks.length) return { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    let a = G.emptyRect();
    for (const { layer } of this.layers) a = G.union(a, this.doc.affectedArea(layer));
    return a;
  }
  update() {
    this.moveMasks();
    if (!this.layers.length) return;
    // A negative width or height means the frame was dragged through itself: a flip.
    const f = this.frame, flipX = f.w < 0, flipY = f.h < 0, fr = { x: Math.min(f.x, f.x + f.w), y: Math.min(f.y, f.y + f.h), w: Math.abs(f.w), h: Math.abs(f.h) };
    const scaleD = (d, sx, sy) => d && d.map((v, i) => v * (i % 2 === 0 ? sx : sy));
    if (this.layers.length === 1) {
      const { layer, start } = this.layers[0];
      layer.transform = { ...start, x: fr.x, y: fr.y, width: fr.w, height: fr.h, rotation: this.rotation, flipH: start.flipH !== flipX, flipV: start.flipV !== flipY, distort: scaleD(start.distort, fr.w / start.width, fr.h / start.height) };
      return;
    }
    const s = this.startFrame, sx = fr.w / Math.max(1e-6, s.w), sy = fr.h / Math.max(1e-6, s.h), delta = this.rotation - this.startRotation, spin = rot(delta, fr.x + fr.w / 2, fr.y + fr.h / 2);
    for (const { layer, start } of this.layers) {
      const cx = start.x + start.width / 2, cy = start.y + start.height / 2;
      const nx = (flipX ? s.x + s.w - cx : cx - s.x) * sx + fr.x, ny = (flipY ? s.y + s.h - cy : cy - s.y) * sy + fr.y, c = G.mapPoint(spin, nx, ny), w = start.width * sx, h = start.height * sy;
      layer.transform = { ...start, x: c.x - w / 2, y: c.y - h / 2, width: w, height: h, rotation: normalize(start.rotation * (flipX !== flipY ? -1 : 1) + delta), flipH: start.flipH !== flipX, flipV: start.flipV !== flipY, distort: scaleD(start.distort, sx, sy) };
    }
  }
  get hasChanges() { return this.layers.some((l) => !same(l.layer.transform, l.start)) || this.masks.some((m) => m.layer.mask !== m.start); }
  // Moves one corner freely (Ctrl-drag), distorting a single layer.
  distortCorner(corner, point) {
    if (this.layers.length !== 1 || this.doc.transformEdit !== this) return;
    const before = this.area(), { layer, start } = this.layers[0];
    const p = G.mapPoint(rot(-start.rotation, start.x + start.width / 2, start.y + start.height / 2), point.x, point.y);
    const d = [...(start.distort || new Array(8).fill(0))], bx = corner === 1 || corner === 2 ? start.width : 0, by = corner === 2 || corner === 3 ? start.height : 0;
    d[corner * 2] = p.x - start.x - bx; d[corner * 2 + 1] = p.y - start.y - by;
    layer.transform = { ...start, distort: d.every((v) => Math.abs(v) < 0.01) ? null : d };
    this.doc.invalidate(G.union(before, this.area()));
  }
}

export function beginTransform(doc, name = 'Transform') {
  const targets = transformTargets(doc);
  const maskOwners = doc.selectedRoots().flatMap((r) => [r, ...doc.allLayers(r.children)]).filter((l) => !l.canvas && l.mask);
  if (!targets.length && !maskOwners.length) return null;
  doc.begin(name);
  return (doc.transformEdit = new TransformEdit(doc, targets, [...new Set(maskOwners)]));
}
export function commitTransform(doc) {
  const e = doc.transformEdit; if (!e) return;
  const changed = e.hasChanges;
  for (const layer of e.layerList) if (layer.canvas && (layer.text || layer.shape)) liveRescale(doc, layer);
  doc.transformEdit = null;
  if (changed) doc.commit(); else doc.cancel();
  doc.invalidate(null); doc.layersChanged();
}
export function cancelTransform(doc) { if (!doc.transformEdit) return; doc.transformEdit = null; doc.cancel(); }
export function nudge(doc, dx, dy) {
  const e = beginTransform(doc, 'Nudge'); if (!e) return;
  e.moveBy(dx, dy); commitTransform(doc);
}
// Sets exact values from the transform inspector; a run of edits on one layer undoes as one step.
export function setTransform(doc, layer, t) {
  if (!layer.canvas || same(t, layer.transform)) return;
  doc.apply('Transform', () => { layer.transform = t; if (layer.text || layer.shape) liveRescale(doc, layer); });
  const last = doc.inspectorEdit;
  if (last && last.layerId === layer.id && last.revision === doc.revision - 1) doc.history.mergeLast('Transform');
  doc.inspectorEdit = { layerId: layer.id, revision: doc.revision };
  doc.invalidate(null); doc.layersChanged();
}
