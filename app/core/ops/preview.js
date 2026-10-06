// Live, cancellable edits of the active layer's pixels or mask (port of Composa's BeginPreview / Preview / CommitPreview
// in EditorSession.Pixels): adjustments, filters and Content-Aware Fill run in the compute worker, and every change is
// shown on the canvas at once. Nothing reaches the undo history until commit.
import { Mask } from '../mask.js';
import { makeCanvas, getData, putData } from '../pixels.js';
import { compute } from '../compute.js';
import { ensureCoversCanvas, selectionInTargetSpace, mixBySelection } from './pixels.js';
import { identityTransform, isPureTranslation } from '../model.js';
import { FILTER_BY_ID, defaultParams } from '../filters/filters.js';
import { adjustmentName, isIdentity } from '../filters/adjust.js';
import { maskMatrix } from '../render.js';
import { isClear } from '../pixels.js';
import * as G from '../geom.js';

const maskToImage = (m) => { const img = new ImageData(m.width, m.height); for (let i = 0; i < m.data.length; i++) { const v = m.data[i]; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; } return img; };
const imageToMask = (img) => { const m = new Mask(img.width, img.height), d = img.data; for (let i = 0; i < m.data.length; i++) m.data[i] = d[i * 4 + 3] === 0 ? 0 : d[i * 4]; return m; };

export class PreviewSession {
  // Returns null when the active layer cannot take pixel edits.
  static begin(doc, name, { coverCanvas = false } = {}) {
    const layer = doc.editableLayer; if (!layer) return null;
    const s = new PreviewSession();
    doc.begin(name);
    if (coverCanvas && !doc.isEditingMask) ensureCoversCanvas(doc, layer);
    Object.assign(s, { doc, layer, mask: doc.isEditingMask, seq: 0, running: 0, closed: false, startTransform: layer.transform, originalMask: layer.mask, selection: selectionInTargetSpace(doc, layer) });
    s.original = s.mask ? layer.mask : layer.canvas;
    s.image = s.mask ? maskToImage(layer.mask) : getData(layer.canvas);
    s.matrix = s.mask ? maskMatrix(layer) : layer.matrix;
    s.scale = G.scaleOf(s.matrix) || 1;
    s.waiters = [];
    return s;
  }
  get width() { return this.image.width; }
  get height() { return this.image.height; }
  get empty() { return isClear(this.original); }

  // Runs `op` ('filter' | 'adjust' | 'inpaint') with args over a copy of the original and shows the result.
  async run(op, args, { mix = true } = {}) {
    if (this.closed) return;
    const seq = ++this.seq; this.running++;
    try {
      const out = await compute(op, { ...args, w: this.image.width, h: this.image.height }, new Uint8ClampedArray(this.image.data).buffer);
      if (this.closed || seq !== this.seq) return;
      const r = out.result, data = op === 'filter' ? new Uint8ClampedArray(out.buffer) : new Uint8ClampedArray(out.buffer);
      this.show({ data, w: r.w ?? this.image.width, h: r.h ?? this.image.height, growX: r.growX || 0, growY: r.growY || 0 }, mix);
    } finally { this.running--; if (!this.running) { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); } }
  }
  showOriginal() { this.seq++; this.show({ data: new Uint8ClampedArray(this.image.data), w: this.image.width, h: this.image.height, growX: 0, growY: 0 }, false); }
  idle() { return this.running ? new Promise((res) => this.waiters.push(res)) : Promise.resolve(); }

  filter(id, params, env = {}) {
    const f = FILTER_BY_ID[id], p = { ...defaultParams(f), ...params };
    // Pixel-sized settings are in document pixels; a scaled layer has several of its own pixels to each.
    if (Math.abs(this.scale - 1) > 1e-3) for (const q of f.params) if (q.unit === ' px') p[q.key] = p[q.key] / this.scale;
    const layer = this.layer, b = layer.canvas ? layer.bounds : { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    const clampEdges = b.x <= 0.5 && b.y <= 0.5 && b.x + b.w >= this.doc.width - 0.5 && b.y + b.h >= this.doc.height - 0.5;
    const e = { seed: 1, clampEdges, ...env };
    if (id === 'vignette' && this.fillsClear && !this.mask) { const inv = G.invert(this.matrix); if (inv) { e.fillsClear = true; e.frame = G.mapRect(inv, { x: 0, y: 0, w: this.doc.width, h: this.doc.height }); } }
    return this.run('filter', { id, params: p, env: e });
  }
  adjust(adjustment) { return this.run('adjust', { adjustment, ox: this.startTransform.x, oy: this.startTransform.y, step: 1 }); }
  contentAwareFill() {
    if (!this.selection || this.mask) return Promise.resolve();
    const m = this.selection.data;
    return this.run('inpaint', { mask: m.buffer.slice(0) }, { mix: false });
  }

  show(r, mix) {
    const { doc, layer } = this;
    const before = doc.affectedArea(layer);
    let { data, w, h, growX, growY } = r;
    const canGrow = !this.mask && !this.selection && !this.originalMask && isPureTranslation(this.startTransform, this.image.width, this.image.height);
    if ((growX || growY) && !canGrow) {
      const o = new Uint8ClampedArray(this.image.data.length), ow = this.image.width, oh = this.image.height;
      for (let y = 0; y < oh; y++) o.set(data.subarray(((y + growY) * w + growX) * 4, ((y + growY) * w + growX + ow) * 4), y * ow * 4);
      data = o; w = ow; h = oh; growX = growY = 0;
    }
    const img = new ImageData(data, w, h);
    if (!growX && !growY && mix) mixBySelection(this.image, img, this.selection);
    if (this.mask) { layer.mask = imageToMask(img); layer.transform = this.startTransform; }
    else {
      const c = makeCanvas(w, h); putData(c, img);
      layer.canvas = c;
      layer.transform = growX || growY ? identityTransform(w, h, this.startTransform.x - growX, this.startTransform.y - growY) : this.startTransform;
    }
    doc.invalidate(G.union(before, doc.affectedArea(layer)));
  }
  async commit() {
    await this.idle();
    if (this.closed) return;
    this.closed = true; this.doc.commit(); this.doc.layersChanged();
  }
  cancel() { if (this.closed) return; this.closed = true; this.seq++; this.doc.cancel(); }
}

export async function applyFilterNow(doc, id, params, name) {
  const s = PreviewSession.begin(doc, name || FILTER_BY_ID[id].name); if (!s) return false;
  await s.filter(id, params); await s.commit(); return true;
}
export async function applyAdjustmentNow(doc, adjustment) {
  const s = PreviewSession.begin(doc, adjustmentName(adjustment)); if (!s) return false;
  await s.adjust(adjustment); await s.commit(); return true;
}
export async function contentAwareFill(doc) {
  if (!doc.selection || doc.isEditingMask) return;
  const s = PreviewSession.begin(doc, 'Content-Aware Fill', { coverCanvas: true }); if (!s) return;
  await s.contentAwareFill(); await s.commit();
}
