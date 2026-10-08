// Document model, ported from Composa.Model: a tree of layers (raster, folder, adjustment), each raster layer a canvas
// placed by a LayerTransform, plus selection, guides and undo history.
import { History, canvasPatch, swap } from './history.js';
import { makeCanvas, ctxOf, getData } from './pixels.js';
import * as G from './geom.js';

let nextId = 1;
export const newId = () => nextId++;

// ---- LayerTransform ------------------------------------------------------------------
// Places a layer's source pixels on the document without resampling them: the source is scaled to width x height,
// flipped, optionally distorted corner by corner, rotated about its centre and moved to x, y (top-left, unrotated).
export const identityTransform = (width, height, x = 0, y = 0) => ({ x, y, width, height, rotation: 0, flipH: false, flipV: false, distort: null });

export function transformMatrix(t, sw, sh) {
  let m = G.scale(t.width / Math.max(1, sw), t.height / Math.max(1, sh));
  if (t.flipH) m = G.concat(m, G.scale(-1, 1, t.width / 2, 0));
  if (t.flipV) m = G.concat(m, G.scale(1, -1, 0, t.height / 2));
  m = G.concat(m, G.translate(t.x, t.y));
  if (t.rotation) m = G.concat(m, G.rotate(t.rotation, t.x + t.width / 2, t.y + t.height / 2));
  return m;
}
// Maps a source pixel position to the document, including a distortion. Returns (sx, sy) => {x, y}.
export function transformMapper(t, sw, sh) {
  const affine = transformMatrix(t, sw, sh);
  if (!t.distort) return (x, y) => G.mapPoint(affine, x, y);
  const d = t.distort, w = t.width, h = t.height;
  let flip = G.scale(t.width / Math.max(1, sw), t.height / Math.max(1, sh));
  if (t.flipH) flip = G.concat(flip, G.scale(-1, 1, w / 2, 0));
  if (t.flipV) flip = G.concat(flip, G.scale(1, -1, 0, h / 2));
  const quad = [{ x: d[0], y: d[1] }, { x: w + d[2], y: d[3] }, { x: w + d[4], y: h + d[5] }, { x: d[6], y: h + d[7] }];
  const persp = G.rectToQuad(w, h, quad);
  const after = G.concat(G.translate(t.x, t.y), t.rotation ? G.rotate(t.rotation, t.x + t.width / 2, t.y + t.height / 2) : G.IDENTITY);
  return (x, y) => { const p = G.mapPoint(flip, x, y), q = persp(p.x, p.y); return G.mapPoint(after, q.x, q.y); };
}
// Document-space corners TL, TR, BR, BL of a source of sw x sh.
export function transformCorners(t, sw, sh) {
  const f = transformMapper(t, sw, sh);
  return [f(0, 0), f(sw, 0), f(sw, sh), f(0, sh)];
}
export const isPureTranslation = (t, sw, sh) => !t.rotation && !t.flipH && !t.flipV && !t.distort && t.width === sw && t.height === sh && t.x === Math.round(t.x) && t.y === Math.round(t.y);

// ---- Layer -----------------------------------------------------------------------------
export class Layer {
  constructor(kind, name) {
    this.id = newId();
    this.kind = kind;                 // 'raster' | 'group' | 'adjustment'
    this.name = name;
    this.visible = true; this.opacity = 1; this.blend = 'normal';
    this.canvas = null;               // straight-alpha RGBA pixels (raster layers)
    this.transform = null;
    this.mask = null; this.maskEnabled = true;   // Mask: raster layers match canvas size, others the document
    this.clipped = false;
    this.adjustment = null;           // { type, params }
    this.shape = null;                // live shape settings
    this.text = null;                 // live text settings
    this.effects = null;              // Stroke, shadows, glows, overlay
    this.children = [];
    this.collapsed = false;
    this.preview = null;              // live-preview override { canvas, matrix } (never serialized)
  }
  static raster(name, canvas, x = 0, y = 0) {
    const l = new Layer('raster', name);
    l.canvas = canvas; l.transform = identityTransform(canvas.width, canvas.height, x, y);
    return l;
  }
  static group(name) { return new Layer('group', name); }
  static adjustment(adjustment, name) { const l = new Layer('adjustment', name); l.adjustment = adjustment; return l; }

  get isGroup() { return this.kind === 'group'; }
  get isAdjustment() { return this.kind === 'adjustment'; }
  get isLive() { return !!(this.shape || this.text); }
  get hasPixels() { return !!this.canvas; }
  get matrix() { return this.canvas ? transformMatrix(this.transform, this.canvas.width, this.canvas.height) : G.IDENTITY; }
  get corners() { return transformCorners(this.transform, this.canvas.width, this.canvas.height); }
  // Document-space bounds of the layer's pixels; empty for folders and adjustments.
  get bounds() { return this.canvas ? G.boundsOf(this.corners) : G.emptyRect(); }
  get effectMargin() { return this.canvas && this.effects ? effectMargin(this.effects) : 0; }
  get visibleBounds() {
    if (!this.canvas) return G.emptyRect();
    const m = this.effectMargin;
    return m ? G.mapRect(this.matrix, { x: -m, y: -m, w: this.canvas.width + 2 * m, h: this.canvas.height + 2 * m }) : this.bounds;
  }
  // Structural copy sharing the (replace-don't-mutate) canvas, mask and settings objects.
  clone(newIds = false) {
    const c = new Layer(this.kind, this.name);
    for (const k of ['visible', 'opacity', 'blend', 'canvas', 'transform', 'mask', 'maskEnabled', 'clipped', 'adjustment', 'shape', 'text', 'effects', 'collapsed']) c[k] = this[k];
    c.id = newIds ? newId() : this.id;
    c.children = this.children.map((k) => k.clone(newIds));
    return c;
  }
}

// How far effects reach beyond a layer's pixels, in layer pixels (ported with the effects in core/effects.js).
let effectMargin = () => 0;
export const setEffectMarginFn = (fn) => { effectMargin = fn; };

// ---- Doc -----------------------------------------------------------------------------------
export class Doc {
  constructor({ width, height, name = 'Untitled', resolution = 72 }) {
    this.id = newId();
    this.name = name;
    this.width = width; this.height = height; this.resolution = resolution;
    this.layers = [];                 // root list, bottom -> top
    this.activeId = null; this.selectedIds = new Set();
    this.selection = null;            // Mask (document size) or null
    this.guides = [];                 // { horizontal, position }
    this.editingMask = false;
    this.history = new History();
    this.modified = false; this.revision = 0; this.savedRevision = 0;
    this.filePath = null; this.fileHandle = null;
    this.version = 0;                 // bumps on any visual change
    this.dirty = { x: 0, y: 0, w: width, h: height };   // document area to re-render
    this.view = { zoom: 1, panX: 0, panY: 0, fitted: false };
    this.listeners = new Set();
    this.pendingBefore = null; this.pendingName = ''; this.pendingPatches = [];
    this.interaction = null;          // { finish() } while a tool holds an uncommitted edit
    this.transformEdit = null; this.inspectorEdit = null;
    this.solo = null;
  }

  // ---- events and invalidation ----------------------------------------------------------
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind, arg) { for (const fn of [...this.listeners]) fn(kind, arg); }
  // Marks a document area (null = everything) as needing a re-render. kind 'canvas' for pixel changes.
  invalidate(area = null) {
    this.version++;
    this.dirty = area ? G.union(this.dirty, G.intersect(G.roundOut(area), { x: 0, y: 0, w: this.width, h: this.height })) : { x: 0, y: 0, w: this.width, h: this.height };
    this.emit('canvas', area);
  }
  layersChanged() { this.emit('layers'); }
  selectionChanged() { this.emit('selection'); }
  get isModified() { return this.revision !== this.savedRevision; }
  markSaved() { this.savedRevision = this.revision; this.modified = false; this.emit('history'); }
  markModified() { this.revision++; this.modified = true; this.emit('history'); }

  // ---- tree ----------------------------------------------------------------------------------
  *allLayers(list = this.layers) { for (const l of list) { yield* this.allLayers(l.children); yield l; } }
  find(id) { for (const l of this.allLayers()) if (l.id === id) return l; return null; }
  parentOf(id) { for (const l of this.allLayers()) if (l.children.some((c) => c.id === id)) return l; return null; }
  siblingsOf(id) { if (this.layers.some((l) => l.id === id)) return this.layers; return this.parentOf(id)?.children ?? null; }
  get active() { return this.activeId == null ? null : this.find(this.activeId); }
  isEffectivelyVisible(layer) {
    if (!layer.visible) return false;
    for (let p = this.parentOf(layer.id); p; p = this.parentOf(p.id)) if (!p.visible) return false;
    return true;
  }
  setActive(id, notify = true) {
    this.activeId = id; this.selectedIds = new Set(id == null ? [] : [id]);
    if (!this.active?.mask) this.editingMask = false;
    if (notify) this.layersChanged();
  }
  // Selected layers as roots: a layer inside a selected folder travels with the folder. Bottom to top.
  selectedRoots() {
    const ids = this.selectedIds.size ? this.selectedIds : new Set(this.activeId == null ? [] : [this.activeId]);
    const out = [], walk = (list) => { for (const l of list) { if (ids.has(l.id)) out.push(l); else walk(l.children); } };
    walk(this.layers);
    return out;
  }
  insertAboveActive(layer) {
    const a = this.active;
    if (a) {
      if (a.isGroup && !a.collapsed) a.children.push(layer);
      else { const sib = this.siblingsOf(a.id); sib.splice(sib.indexOf(a) + 1, 0, layer); }
    } else this.layers.push(layer);
    this.setActive(layer.id, false);
  }
  uniqueName(stem) {
    const names = new Set([...this.allLayers()].map((l) => l.name));
    for (let i = 1; ; i++) if (!names.has(`${stem} ${i}`)) return `${stem} ${i}`;
  }
  get editableLayer() { const l = this.active; return l && ((this.editingMask && l.mask) || (l.canvas && !l.isLive)) ? l : null; }
  get isEditingMask() { return this.editingMask && !!this.active?.mask; }
  // The edit target of a layer: its mask while editing the mask, otherwise its pixels.
  targetOf(layer) { return this.isEditingMask ? layer.mask : layer.canvas; }
  // The affected document area when a layer changes.
  affectedArea(layer) {
    if (!layer.canvas) return { x: 0, y: 0, w: this.width, h: this.height };
    let b = G.inflate(G.roundOut(layer.visibleBounds), 2);
    const sib = this.siblingsOf(layer.id);
    if (sib) for (let i = sib.indexOf(layer) + 1; i < sib.length && sib[i].clipped; i++) b = sib[i].canvas ? G.union(b, G.roundOut(sib[i].visibleBounds)) : { x: 0, y: 0, w: this.width, h: this.height };
    return b;
  }

  // ---- snapshots and history ------------------------------------------------------------------------
  snapshot() {
    return { width: this.width, height: this.height, resolution: this.resolution, layers: this.layers.map((l) => l.clone()), activeId: this.activeId,
      selectedIds: new Set(this.selectedIds), selection: this.selection, guides: this.guides.map((g) => ({ ...g })) };
  }
  restore(s) {
    const resized = s.width !== this.width || s.height !== this.height;
    this.width = s.width; this.height = s.height; this.resolution = s.resolution;
    this.layers = s.layers.map((l) => l.clone());
    this.activeId = s.activeId; this.selectedIds = new Set(s.selectedIds);
    this.selection = s.selection; this.guides = s.guides.map((g) => ({ ...g }));
    if (!this.active?.mask) this.editingMask = false;
    this.version++; this.dirty = { x: 0, y: 0, w: this.width, h: this.height };
    this.revision++; this.modified = true;
    this.emit(resized ? 'size' : 'canvas', null); this.layersChanged(); this.selectionChanged(); this.emit('history');
  }
  // Starts an edit that may be previewed live and later committed or cancelled.
  begin(name) {
    this.finishInteraction();
    this.pendingBefore = this.snapshot(); this.pendingName = name; this.pendingPatches = [];
  }
  finishInteraction() {
    const i = this.interaction;
    if (i) { this.interaction = null; i.finish(); }
    if (this.pendingBefore) this.commit();
  }
  get hasPendingEdit() { return !!this.pendingBefore; }
  addPatch(p) { if (this.pendingBefore) this.pendingPatches.push(p); }
  // Saves the region of an in-place edit's target before it changes. `before` is the full ImageData (canvas) or Uint8Array (mask).
  patchFor(target, rect, before) {
    if (target.data instanceof Uint8Array) {   // Mask
      const { x, y, w, h } = rect, out = new Uint8Array(w * h);
      for (let r = 0; r < h; r++) out.set(before.subarray((y + r) * target.width + x, (y + r) * target.width + x + w), r * w);
      return { mask: target, rect, data: out, bytes: out.length };
    }
    const { x, y, w, h } = rect, out = new ImageData(w, h), bw = before.width;
    for (let r = 0; r < h; r++) out.data.set(before.data.subarray(((y + r) * bw + x) * 4, ((y + r) * bw + x + w) * 4), r * w * 4);
    return canvasPatch(target, rect, out);
  }
  commit() {
    if (!this.pendingBefore) return;
    this.history.push({ name: this.pendingName, before: this.pendingBefore, after: this.snapshot(), patches: this.pendingPatches });
    this.pendingBefore = null; this.pendingPatches = [];
    this.revision++; this.modified = true;
    this.emit('history');
  }
  cancel() {
    if (!this.pendingBefore) return;
    for (let i = this.pendingPatches.length - 1; i >= 0; i--) swap(this.pendingPatches[i]);
    const b = this.pendingBefore, rev = this.revision, mod = this.modified;
    this.pendingBefore = null; this.pendingPatches = [];
    this.restore(b);
    this.revision = rev; this.modified = mod; this.emit('history');
  }
  apply(name, fn) {
    this.begin(name);
    try { fn(); } catch (e) { this.cancel(); throw e; }
    this.commit();
  }
  get canUndo() { return this.history.canUndo && !this.pendingBefore; }
  get canRedo() { return this.history.canRedo && !this.pendingBefore; }
  undo() { this.finishInteraction(); if (this.history.undo(this)) this.emit('history'); }
  redo() { this.finishInteraction(); if (this.history.redo(this)) this.emit('history'); }

  // ---- layer property edits that coalesce into one undo step per gesture (sliders) -------------------------
  beginProps(name) { this.begin(name); }
  setProp(layer, key, value) { layer[key] = value; this.invalidate(null); }
  endProps() { this.commit(); this.layersChanged(); }
  setPropStep(layer, key, value, name) { this.apply(name, () => { layer[key] = value; }); this.invalidate(null); this.layersChanged(); }

  // ---- reading pixels ---------------------------------------------------------------------------------
  sampleMerged(renderer, x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const d = getData(renderer.render(this), x, y, 1, 1).data;
    return d[3] ? [d[0], d[1], d[2], d[3]] : null;
  }
}

export function newRasterLayer(doc, name, w = doc.width, h = doc.height) { return Layer.raster(name, makeCanvas(w, h)); }
export const ctx = ctxOf;
