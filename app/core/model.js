import { History } from './history.js';

export const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  return c;
};

let nextId = 1;
const LAYER_PROPS = ['name', 'visible', 'opacity', 'blend', 'x', 'y', 'sx', 'sy', 'rot', 'locked'];

// A pixel layer: its own canvas, placed in the document by a non-destructive transform
// (x,y = centre in document pixels, sx/sy = scale, rot = radians). Mirrors Composa.Model.Layer.
export class Layer {
  constructor({ name = 'Layer', canvas, width = 1, height = 1 } = {}) {
    this.id = nextId++;
    this.kind = 'pixel';
    this.name = name;
    this.visible = true;
    this.opacity = 1;
    this.blend = 'normal';
    this.locked = false;
    this.canvas = canvas || makeCanvas(width, height);
    this.x = this.canvas.width / 2; this.y = this.canvas.height / 2;
    this.sx = 1; this.sy = 1; this.rot = 0;
    this.version = 0;
  }
  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }
  touch() { this.version++; }
}

const snapshotLayer = (l) => Object.fromEntries(LAYER_PROPS.map((k) => [k, l[k]]));

export class Doc {
  constructor({ width, height, name = 'Untitled', resolution = 72 }) {
    this.id = nextId++;
    this.name = name;
    this.width = width; this.height = height; this.resolution = resolution;
    this.layers = [];            // bottom -> top
    this.activeId = null;
    this.history = new History();
    this.modified = false;
    this.version = 0;            // bumps on any visual change; the renderer caches on it
    this.view = { zoom: 1, panX: 0, panY: 0, fitted: false };
    this.listeners = new Set();
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed(structure = false) { this.version++; this.modified = true; for (const fn of this.listeners) fn(structure); }

  get active() { return this.layers.find((l) => l.id === this.activeId) || null; }
  setActive(id) { if (this.activeId !== id) { this.activeId = id; for (const fn of this.listeners) fn(true); } }

  // ---- structural undo ---------------------------------------------------
  capture() { return { order: [...this.layers], props: new Map(this.layers.map((l) => [l, snapshotLayer(l)])), active: this.activeId }; }
  restore(s) {
    this.layers = [...s.order];
    for (const [l, p] of s.props) Object.assign(l, p);
    this.activeId = s.active;
    this.changed(true);
  }
  // Runs `fn` as one named undo step.
  edit(name, fn) {
    const before = this.capture();
    fn();
    const after = this.capture();
    this.history.push({ name, undo: () => this.restore(before), redo: () => this.restore(after) });
    this.changed(true);
  }

  // ---- layer operations --------------------------------------------------
  insertIndex() { const i = this.layers.findIndex((l) => l.id === this.activeId); return i < 0 ? this.layers.length : i + 1; }
  addLayer(layer, name = 'New Layer') {
    this.edit(name, () => { this.layers.splice(this.insertIndex(), 0, layer); this.activeId = layer.id; });
    return layer;
  }
  newLayer() {
    const n = this.layers.length + 1;
    return this.addLayer(new Layer({ name: `Layer ${n}`, width: this.width, height: this.height }), 'New Layer');
  }
  deleteLayer(layer = this.active) {
    if (!layer) return;
    this.edit('Delete Layer', () => {
      const i = this.layers.indexOf(layer);
      this.layers.splice(i, 1);
      this.activeId = (this.layers[Math.min(i, this.layers.length - 1)] || {}).id ?? null;
    });
  }
  duplicateLayer(layer = this.active) {
    if (!layer) return;
    const copy = new Layer({ name: layer.name + ' copy', width: layer.width, height: layer.height });
    copy.canvas.getContext('2d').drawImage(layer.canvas, 0, 0);
    Object.assign(copy, { x: layer.x, y: layer.y, sx: layer.sx, sy: layer.sy, rot: layer.rot, opacity: layer.opacity, blend: layer.blend, visible: layer.visible });
    this.edit('Duplicate Layer', () => { this.layers.splice(this.layers.indexOf(layer) + 1, 0, copy); this.activeId = copy.id; });
  }
  moveLayer(layer, toIndex) {
    const from = this.layers.indexOf(layer);
    toIndex = Math.max(0, Math.min(this.layers.length - 1, toIndex));
    if (from < 0 || from === toIndex) return;
    this.edit('Reorder Layer', () => { this.layers.splice(from, 1); this.layers.splice(toIndex, 0, layer); });
  }
  // Property edits from sliders coalesce into one step per gesture: call begin, set many times, then end.
  beginProps(layer, name) { this._pending = { layer, name, before: this.capture() }; }
  setProp(layer, key, value) { layer[key] = value; this.changed(false); }
  endProps() {
    const p = this._pending; this._pending = null;
    if (!p) return;
    const after = this.capture();
    this.history.push({ name: p.name, undo: () => this.restore(p.before), redo: () => this.restore(after) });
    this.changed(true);
  }
  setPropStep(layer, key, value, name) { this.edit(name, () => { layer[key] = value; }); }
}
