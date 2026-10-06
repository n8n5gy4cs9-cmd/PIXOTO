// Live text and shape layers (port of Composa EditorSession.Text and the shape parts of .Pixels).
import { Layer, identityTransform } from '../model.js';
import { TextLayout, PADDING, renderText } from '../text/layout.js';
import { TextEditor } from '../text/editor.js';
import { clampStyle, layerNameOf, scaledStyle, sameStyle, asDefaults, withColor, isBox, MIN_BOX, defaultTextStyle } from '../text/style.js';
import { renderShape, shapeName } from '../shape.js';
import { resampleMask } from './canvas.js';
import { setLiveRescale } from './transform.js';
import { live } from '../live.js';
import { selectLayer } from './layers.js';
import { fitsSurface } from '../limits.js';
import * as G from '../geom.js';

live.renderText = renderText; live.scaleText = scaledStyle; live.renderShape = renderShape;

// Swaps in regenerated pixels for a live layer; its mask is resampled to stay the size of the pixels.
export function replaceLivePixels(layer, canvas) {
  layer.canvas = canvas;
  const t = layer.transform;
  // Freshly drawn pixels are only sharp when they sit on the pixel grid at their own size.
  if (!t.rotation && !t.distort && Math.abs(t.width - canvas.width) < 1 && Math.abs(t.height - canvas.height) < 1) layer.transform = { ...t, x: Math.round(t.x), y: Math.round(t.y), width: canvas.width, height: canvas.height };
  if (layer.mask && (layer.mask.width !== canvas.width || layer.mask.height !== canvas.height)) layer.mask = resampleMask(layer.mask, canvas.width, canvas.height);
}
// After scaling, text is redrawn at the matching font size instead of being stretched.
function rescaleText(layer) {
  const style = layer.text, c = layer.canvas;
  const fx = layer.transform.width / c.width, fy = layer.transform.height / c.height;
  if ((Math.abs(fy - 1) < 0.01 && (!isBox(style) || Math.abs(fx - 1) < 0.01)) || layer.transform.distort) return;
  const resized = isBox(style) ? scaledStyle(style, fx, fy) : scaledStyle(style, fy), t = layer.transform, cx = t.x + t.width / 2, cy = t.y + t.height / 2, rendered = renderText(resized);
  layer.text = resized;
  layer.transform = { ...t, x: cx - rendered.width / 2, y: cy - rendered.height / 2, width: rendered.width, height: rendered.height };
  replaceLivePixels(layer, rendered);
}
export function rescaleLive(doc, layer) {
  if (layer.text) rescaleText(layer);
  else if (layer.shape) {
    const w = Math.max(1, Math.round(layer.transform.width)), h = Math.max(1, Math.round(layer.transform.height));
    if (w !== layer.canvas.width || h !== layer.canvas.height) replaceLivePixels(layer, renderShape(layer.shape, w, h));
  }
}
setLiveRescale(rescaleLive);

// ---- shapes -------------------------------------------------------------------------------------
function addShapeLayer(doc, style, rect, stem, problem) {
  if (!fitsSurface(rect.w, rect.h)) { problem?.('That shape is too large for this browser.'); return null; }
  const layer = Layer.raster(doc.uniqueName(stem), renderShape(style, rect.w, rect.h), rect.x, rect.y);
  layer.shape = style;
  doc.apply(stem, () => doc.insertAboveActive(layer));
  doc.invalidate(doc.affectedArea(layer)); doc.layersChanged();
  return layer;
}
export function addShape(doc, kind, rect, { fill, cornerRadius }, problem) {
  rect = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
  if (rect.w < 1 || rect.h < 1) return null;
  return addShapeLayer(doc, { kind, fill, cornerRadius, lineWidth: 0, startX: null, startY: null, endX: null, endY: null }, rect, shapeName(kind), problem);
}
// A live line between two document points, drawn `width` thick with round ends.
export function addLine(doc, from, to, fill, width, problem) {
  const t = G.clamp(width, 1, 5000);
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite) || (from.x === to.x && from.y === to.y)) return null;
  const half = t / 2;
  let x = Math.floor(Math.min(from.x, to.x) - half), y = Math.floor(Math.min(from.y, to.y) - half);
  const w = Math.ceil(Math.max(from.x, to.x) + half) - x, h = Math.ceil(Math.max(from.y, to.y) + half) - y;
  if (w < 1 || h < 1) return null;
  const style = { kind: 'line', fill, cornerRadius: 0, lineWidth: t, startX: (from.x - x) / w, startY: (from.y - y) / h, endX: (to.x - x) / w, endY: (to.y - y) / h };
  return addShapeLayer(doc, style, { x, y, w, h }, 'Line', problem);
}
export function rasterizeLayer(doc, layer) {
  if (!layer.isLive) return;
  doc.apply('Rasterize Layer', () => { layer.shape = null; layer.text = null; });
  doc.layersChanged();
}

// ---- text -----------------------------------------------------------------------------------------
export function addText(doc, at, style, commit = true) {
  style = clampStyle(style);
  const layer = Layer.raster(layerNameOf(style), renderText(style), Math.round(at.x) - PADDING, Math.round(at.y) - PADDING);
  layer.text = style;
  doc.begin('Text');
  doc.insertAboveActive(layer);
  if (commit) doc.commit();
  doc.editingMask = false;
  doc.invalidate(doc.affectedArea(layer)); doc.layersChanged();
  return layer;
}
// Re-renders a text layer with new settings, keeping its scale, rotation and flips. Point text grows from the edge its
// alignment reads from; a paragraph box keeps its top-left corner. Call inside begin/commit.
export function setText(doc, layer, style) {
  if (!layer.canvas) return;
  style = clampStyle(style);
  const before = doc.affectedArea(layer), t = layer.transform, old = layer.canvas, sx = t.width / old.width, sy = t.height / old.height;
  const unit = isBox(style) ? 0 : style.alignment === 'center' ? 0.5 : style.alignment === 'right' ? 1 : 0;
  const anchorBefore = G.mapPoint(layer.matrix, unit * old.width, 0), canvas = renderText(style);
  if (!layer.text || layer.name === layerNameOf(layer.text)) layer.name = layerNameOf(style);
  layer.text = style; layer.canvas = canvas;
  layer.transform = { ...t, width: canvas.width * sx, height: canvas.height * sy, distort: null };
  const anchorAfter = G.mapPoint(layer.matrix, unit * canvas.width, 0);
  let moved = { ...layer.transform, x: layer.transform.x + anchorBefore.x - anchorAfter.x, y: layer.transform.y + anchorBefore.y - anchorAfter.y };
  if (!moved.rotation && Math.abs(moved.width - canvas.width) < 0.01 && Math.abs(moved.height - canvas.height) < 0.01) moved = { ...moved, x: Math.round(moved.x), y: Math.round(moved.y), width: canvas.width, height: canvas.height };
  layer.transform = moved;
  if (layer.mask && (layer.mask.width !== canvas.width || layer.mask.height !== canvas.height)) layer.mask = resampleMask(layer.mask, canvas.width, canvas.height);
  doc.invalidate(G.union(before, doc.affectedArea(layer)));
}
// The topmost visible text layer whose box holds the point; the gaps between letters count too.
export function textLayerAt(doc, p) {
  for (const l of [...doc.allLayers()].reverse()) {
    if (!l.text || !l.canvas || !doc.isEffectivelyVisible(l)) continue;
    const inv = G.invert(l.matrix); if (!inv) continue;
    const q = G.mapPoint(inv, p.x, p.y);
    if (q.x >= 0 && q.y >= 0 && q.x <= l.canvas.width && q.y <= l.canvas.height) return l;
  }
  return null;
}

// One open text edit at a time. Mirrors Composa's TextEdit / FinishText / CancelText / ChangeTextStyle.
export class TextSession {
  constructor() { this.editor = null; this.layer = null; this.original = null; this.isNew = false; this.defaults = defaultTextStyle(); this.onChange = () => {}; this.styleEdit = null; }
  get active() { return !!this.editor; }
  get currentStyle() { return this.editor?.style ?? this.doc?.active?.text ?? this.defaults; }

  beginPoint(doc, at, color) {
    this.finish();
    const style = { ...this.defaults, text: '', boxWidth: null, boxHeight: null, colorRuns: null, color };
    const layer = addText(doc, { x: at.x, y: at.y - new TextLayout(style).ascent }, style, false);
    return this.open(doc, layer, true);
  }
  beginBox(doc, box, color) {
    this.finish();
    const style = clampStyle({ ...this.defaults, text: '', colorRuns: null, color, boxWidth: Math.max(MIN_BOX, Math.round(box.w)), boxHeight: Math.max(MIN_BOX, Math.round(box.h)) });
    const layer = addText(doc, { x: box.x + PADDING, y: box.y + PADDING }, style, false);
    return this.open(doc, layer, true);
  }
  edit(doc, layer) {
    if (!layer.text || !layer.canvas || doc.find(layer.id) !== layer) return null;
    if (this.editor && this.layer === layer) return this.editor;
    this.finish();
    selectLayer(doc, layer.id);
    doc.begin('Edit Text');
    return this.open(doc, layer, false);
  }
  open(doc, layer, isNew) {
    this.doc = doc; this.layer = layer; this.isNew = isNew; this.original = layer.text; doc.editingMask = false;
    const editor = new TextEditor(layer.text);
    editor.onChange = () => this.sync();
    this.editor = editor;
    doc.interaction = { finish: () => this.finish() };
    doc.layersChanged();
    this.onChange();
    return editor;
  }
  sync() {
    const { editor, layer, doc } = this;
    if (!editor || !layer || doc.find(layer.id) !== layer) return;
    if (!sameStyle(layer.text, editor.style)) setText(doc, layer, editor.style);
    this.onChange();
  }
  // Ends the open edit, keeping what was typed. Empty new text is thrown away; an edit that changed nothing leaves no step.
  finish() {
    const { editor, layer, doc } = this;
    if (!editor || !layer) return false;
    const { isNew, original } = this, style = editor.style;
    this.close();
    if (isNew && !style.text.trim().length) doc.cancel();
    else if (!isNew && sameStyle(style, original)) doc.cancel();
    else {
      if (doc.find(layer.id) === layer && !sameStyle(layer.text, style)) setText(doc, layer, style);
      doc.commit();
      this.defaults = asDefaults(style);
    }
    doc.invalidate(null); doc.layersChanged(); this.onChange();
    return true;
  }
  cancel() {
    if (!this.editor) return;
    const doc = this.doc; this.close(); doc.cancel(); doc.invalidate(null); doc.layersChanged(); this.onChange();
  }
  close() { if (this.editor) this.editor.onChange = () => {}; if (this.doc) this.doc.interaction = null; this.editor = null; this.layer = null; this.original = null; }

  // A change in the Type bar: of the text being typed, otherwise of the active text layer, otherwise of the defaults.
  changeStyle(doc, fn) {
    if (this.editor) { this.editor.changeStyle(fn); return; }
    const live = doc?.active;
    if (!live?.text) { this.defaults = asDefaults(clampStyle(fn(this.defaults))); this.onChange(); return; }
    const style = clampStyle(fn(live.text));
    if (sameStyle(style, live.text)) return;
    doc.apply('Change Text Style', () => setText(doc, live, style));
    const last = this.styleEdit;
    if (last && last.layerId === live.id && last.revision === doc.revision - 1) doc.history.mergeLast('Change Text Style');
    this.styleEdit = { layerId: live.id, revision: doc.revision };
    this.defaults = asDefaults(style);
    doc.layersChanged(); this.onChange();
  }
  setColor(doc, color) { if (this.editor) this.editor.setColor(color); else this.changeStyle(doc, (s) => withColor(s, color, 0, 0)); }
  // Resizes the open text's box (point text becomes a box first); the point at the anchor fractions of the layer stays put.
  setBox(width, height, ax = 0, ay = 0) {
    const { editor, layer, doc } = this; if (!editor || !layer?.canvas) return;
    const old = layer.canvas, before = G.mapPoint(layer.matrix, ax * old.width, ay * old.height);
    editor.changeStyle((s) => ({ ...s, boxWidth: Math.max(MIN_BOX, Math.round(width)), boxHeight: Math.max(MIN_BOX, Math.round(height)) }));
    if (!layer.canvas || (!ax && !ay)) return;
    const after = G.mapPoint(layer.matrix, ax * layer.canvas.width, ay * layer.canvas.height);
    if (Math.abs(after.x - before.x) < 1e-3 && Math.abs(after.y - before.y) < 1e-3) return;
    const area = doc.affectedArea(layer);
    layer.transform = { ...layer.transform, x: layer.transform.x + before.x - after.x, y: layer.transform.y + before.y - after.y };
    doc.invalidate(G.union(area, doc.affectedArea(layer)));
  }
}
export const textSession = new TextSession();
// Fill with a colour recolours live text and keeps it editable.
export function recolorText(doc, layer, color) {
  if (!layer.text) return false;
  const tinted = withColor(layer.text, color, 0, 0);
  if (sameStyle(tinted, layer.text)) return true;
  if (textSession.editor && textSession.layer === layer) { textSession.editor.changeStyle(() => tinted); return true; }
  doc.apply('Fill Text', () => setText(doc, layer, tinted));
  doc.layersChanged();
  return true;
}
