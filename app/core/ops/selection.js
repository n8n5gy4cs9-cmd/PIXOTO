// Selection commands (port of Composa EditorSession.Selection and .FloatingSelection).
import { Mask, MaskMode, combine, rectMask, ellipseMask, polygonMask, allMask, invertMask, expandMask, contractMask, featherMask, translateMask } from '../mask.js';
import { wandPlane, objectPlane, subjectPlane } from '../select/wand.js';
import { renderer } from '../render.js';
import { makeCanvas, ctxOf, getData, cloneCanvas, touchCanvas } from '../pixels.js';
import { ensureCoversCanvas } from './pixels.js';
import { selectionInLayerSpace } from './layers.js';
import { isPureTranslation } from '../model.js';
import * as G from '../geom.js';

export function setSelection(doc, name, selection) {
  if (!selection && !doc.selection) return;
  doc.apply(name, () => { doc.selection = selection; });
  doc.selectionChanged();
}
// Replaces the selection without an undo step, for live previews while dragging.
export function previewSelection(doc, selection) { doc.selection = selection; doc.selectionChanged(); }
export function select(doc, shape, mode, name = 'Select') { setSelection(doc, name, combine(doc.selection, shape, mode)); }

export const selectRect = (doc, r, mode = MaskMode.replace, feather = 0) => select(doc, rectMask(doc.width, doc.height, r, feather), mode, 'Rectangular Marquee');
export const selectEllipse = (doc, r, mode = MaskMode.replace, feather = 0) => select(doc, ellipseMask(doc.width, doc.height, r, feather), mode, 'Elliptical Marquee');
export const selectPolygon = (doc, pts, mode = MaskMode.replace, feather = 0) => select(doc, polygonMask(doc.width, doc.height, pts, feather), mode, 'Lasso');
export const selectAll = (doc) => setSelection(doc, 'Select All', allMask(doc.width, doc.height));
export const deselect = (doc) => setSelection(doc, 'Deselect', null);
export function invertSelection(doc) {
  if (!doc.selection) { selectAll(doc); return; }
  const inv = invertMask(doc.selection);
  setSelection(doc, 'Select Inverse', inv.isEmpty() ? null : inv);
}
export const expandSelection = (doc, px) => { if (doc.selection && px > 0) setSelection(doc, 'Expand Selection', expandMask(doc.selection, px)); };
export const contractSelection = (doc, px) => { if (doc.selection && px > 0) setSelection(doc, 'Contract Selection', contractMask(doc.selection, px)); };
export const featherSelection = (doc, r) => { if (doc.selection && r > 0) setSelection(doc, 'Feather Selection', featherMask(doc.selection, r)); };
export const moveSelection = (doc, dx, dy) => { if (doc.selection && (dx || dy)) setSelection(doc, 'Move Selection', translateMask(doc.selection, dx, dy)); };

// The coverage of a layer's pixels (alpha) or of its mask in document space.
export function selectionFromLayer(doc, layer, fromMask) {
  const src = fromMask ? layer.mask?.canvas() : layer.canvas;
  if (!src) return null;
  const c = makeCanvas(doc.width, doc.height), ctx = ctxOf(c);
  const m = fromMask ? (layer.canvas ? layer.matrix : G.IDENTITY) : layer.matrix;
  ctx.setTransform(...(fromMask && layer.canvas ? maskMatrixOf(layer) : m)); ctx.imageSmoothingEnabled = true; ctx.drawImage(src, 0, 0);
  const mask = Mask.fromAlpha(c);
  return mask.isEmpty() ? null : mask;
}
import { maskMatrix as maskMatrixOf } from '../render.js';
export const selectLayerPixels = (doc, layer, mode = MaskMode.replace) => { const s = selectionFromLayer(doc, layer, false); if (s) select(doc, s, mode, 'Load Selection'); };
export const selectLayerMask = (doc, layer, mode = MaskMode.replace) => { const s = selectionFromLayer(doc, layer, true); if (s) select(doc, s, mode, 'Load Selection'); };

// What selection-from-image tools read: every visible layer as shown, or just the active layer's own pixels.
export function selectionSample(doc, sampleAll) {
  const layer = doc.active;
  if (sampleAll || !layer?.canvas) return getData(renderer.render(doc));
  const copy = layer.clone();
  copy.visible = true; copy.opacity = 1; copy.blend = 'normal'; copy.clipped = false; copy.mask = null; copy.effects = null;
  const c = renderer.renderLayers([copy], { x: 0, y: 0, w: doc.width, h: doc.height });
  return getData(c);
}
const planeMask = (plane, w, h) => new Mask(w, h, plane);
export function selectWand(doc, x, y, { tolerance, contiguous, sampleAll, mode = MaskMode.replace }) {
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
  const img = selectionSample(doc, sampleAll);
  select(doc, planeMask(wandPlane(img.data, img.width, img.height, x, y, tolerance, contiguous), doc.width, doc.height), mode, 'Magic Wand');
}
export function selectObject(doc, x, y, { edge = 0, sampleAll, mode = MaskMode.replace }) {
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
  const img = selectionSample(doc, sampleAll), plane = objectPlane(img.data, img.width, img.height, x, y, edge);
  if (!plane) { if (mode === MaskMode.replace) deselect(doc); return; }
  select(doc, planeMask(plane, doc.width, doc.height), mode, 'Object Selection');
}
export function selectSubject(doc, mode = MaskMode.replace) {
  const img = getData(renderer.render(doc)), plane = subjectPlane(img.data, img.width, img.height);
  if (!plane) return false;
  select(doc, planeMask(plane, doc.width, doc.height), mode, 'Select Subject');
  return true;
}

// ---- moving the selected pixels (floating selection) ----------------------------------------------------
export function canMovePixels(doc) {
  const l = doc.active;
  return !!(doc.selection && !doc.isEditingMask && l?.canvas && !l.isLive && isPureTranslation(l.transform, l.canvas.width, l.canvas.height) && doc.isEffectivelyVisible(l));
}
export class FloatSession {
  // Lifts the selected pixels off the active layer; with `duplicate` the originals stay. Returns null when there is nothing to lift.
  static begin(doc, duplicate) {
    if (!canMovePixels(doc)) return null;
    const layer = doc.active;
    doc.begin(duplicate ? 'Duplicate Selection' : 'Move Selection Pixels');
    ensureCoversCanvas(doc, layer);
    const original = layer.canvas, sel = selectionInLayerSpace(doc, layer), b = sel.bounds();
    if (!b.w) { doc.cancel(); return null; }
    const f = new FloatSession();
    f.doc = doc; f.layer = layer; f.original = original; f.selection = doc.selection; f.origin = { x: b.x, y: b.y }; f.offset = { x: 0, y: 0 };
    f.pixels = makeCanvas(b.w, b.h);
    const pc = ctxOf(f.pixels);
    pc.drawImage(original, -b.x, -b.y);
    pc.globalCompositeOperation = 'destination-in'; pc.drawImage(sel.canvas(), -b.x, -b.y);
    f.base = cloneCanvas(original);
    if (!duplicate) { const bc = ctxOf(f.base); bc.globalCompositeOperation = 'destination-out'; bc.drawImage(sel.canvas(), 0, 0); }
    f.working = cloneCanvas(original);
    layer.canvas = f.working;
    return f;
  }
  moveBy(dx, dy) {
    const { layer, working, base, pixels, origin } = this;
    this.offset = { x: dx, y: dy };
    const ctx = ctxOf(working);
    ctx.globalCompositeOperation = 'copy';
    // Back at the start nothing has moved, so the original lands unchanged (no seam under a feathered selection).
    ctx.drawImage(dx || dy ? base : this.original, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (dx || dy) ctx.drawImage(pixels, origin.x + dx, origin.y + dy);
    touchCanvas(working);
    this.doc.selection = translateMask(this.selection, dx, dy) ?? this.selection;
    this.doc.invalidate(this.doc.affectedArea(layer)); this.doc.selectionChanged();
  }
  end(keep) {
    if (!this.offset.x && !this.offset.y) keep = false;
    if (keep) { this.doc.commit(); this.doc.layersChanged(); } else this.doc.cancel();
  }
}
