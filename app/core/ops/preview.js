// Live, cancellable edits of the active layer's pixels or mask (port of Composa's BeginPreview / Preview / CommitPreview
// in EditorSession.Pixels): adjustments, filters and Content-Aware Fill run in the compute worker, and every change is
// shown on the canvas at once. Nothing reaches the undo history until commit.
//
// Since PERF P3 the pixel path previews on a downscaled proxy: the GPU (WebGL2) applies adjustments/blurs into a small
// canvas that the compositor shows through `layer.preview`, falling back to the CPU worker on the same proxy when the
// GPU is off or the op is not ported. The full-resolution pass (and the one history step) happens only on commit.
import { Mask } from '../mask.js';
import { makeCanvas, getData, putData } from '../pixels.js';
import { compute } from '../compute.js';
import { ensureCoversCanvas, selectionInTargetSpace, mixBySelection } from './pixels.js';
import { identityTransform, isPureTranslation, transformMatrix } from '../model.js';
import { FILTER_BY_ID, defaultParams } from '../filters/filters.js';
import { adjustmentName, isIdentity } from '../filters/adjust.js';
import { maskMatrix } from '../render.js';
import { isClear } from '../pixels.js';
import * as G from '../geom.js';
import { createCoalescer, pickPreviewSize } from '../scheduler.js';
import { isGpuEnabled } from '../state.js';
import { GpuLayerPipeline } from '../gpu/pipeline.js';
import { canRunOnGpu } from '../gpu/adjust-gpu.js';
import { FILTER_GPU } from '../gpu/filter-gpu.js';

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
    s.pipeline = null;
    return s;
  }
  get width() { return this.image.width; }
  get height() { return this.image.height; }
  get empty() { return isClear(this.original); }

  // ---- full-resolution CPU path (mask edits, CPU commit, inpaint) ----------------------------------------------
  // Runs `op` ('filter' | 'adjust' | 'inpaint') with args over a copy of the original and shows the result on the layer.
  async run(op, args, { mix = true } = {}) {
    if (this.closed) return;
    const seq = ++this.seq; this.running++;
    try {
      const full = { ...args, w: this.image.width, h: this.image.height };
      if (op === 'adjust') { full.ox = args.ox ?? this.startTransform.x; full.oy = args.oy ?? this.startTransform.y; full.step = args.step ?? 1; }
      const out = await compute(op, full, new Uint8ClampedArray(this.image.data).buffer);
      if (this.closed || seq !== this.seq) return;
      const r = out.result, data = new Uint8ClampedArray(out.buffer);
      this.show({ data, w: r.w ?? this.image.width, h: r.h ?? this.image.height, growX: r.growX || 0, growY: r.growY || 0 }, mix);
    } finally { this.running--; if (!this.running) { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); } }
  }
  idle() { return this.running ? new Promise((res) => this.waiters.push(res)) : Promise.resolve(); }

  // ---- public edit API (unchanged shape) ------------------------------------------------------------------------
  filter(id, params, env = {}) { return this.update('filter', this.filterArgs(id, params, env)); }
  adjust(adjustment) { return this.update('adjust', { adjustment }); }
  contentAwareFill() {
    if (!this.selection || this.mask) return Promise.resolve();
    const m = this.selection.data;
    return this.run('inpaint', { mask: m.buffer.slice(0) }, { mix: false });
  }
  // A coalescer that applies the latest arguments once per animation frame (see scheduler.js).
  liveUpdater(op) {
    if (op === 'adjust') return createCoalescer((adjustment) => this.update('adjust', { adjustment }));
    if (op === 'filter') return createCoalescer((id, params, env) => this.update('filter', this.filterArgs(id, params, env)));
    return createCoalescer((args) => this.update(op, args));
  }

  // Resolved filter args (pixel-sized params converted to layer pixels, env computed from the layer's placement).
  filterArgs(id, params, env = {}) {
    const f = FILTER_BY_ID[id], p = { ...defaultParams(f), ...params };
    if (Math.abs(this.scale - 1) > 1e-3) for (const q of f.params) if (q.unit === ' px') p[q.key] = p[q.key] / this.scale;
    const layer = this.layer, b = layer.canvas ? layer.bounds : { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    const clampEdges = b.x <= 0.5 && b.y <= 0.5 && b.x + b.w >= this.doc.width - 0.5 && b.y + b.h >= this.doc.height - 0.5;
    const e = { seed: 1, clampEdges, ...env };
    if (id === 'vignette' && this.fillsClear && !this.mask) { const inv = G.invert(this.matrix); if (inv) { e.fillsClear = true; e.frame = G.mapRect(inv, { x: 0, y: 0, w: this.doc.width, h: this.doc.height }); } }
    return { id, params: p, env: e };
  }

  // ---- proxy preview path ----------------------------------------------------------------------------------------
  update(op, args) {
    if (this.closed) return Promise.resolve();
    if (op === 'adjust' && isIdentity(args.adjustment)) { this.showOriginal(); return Promise.resolve(); }
    this.lastOp = op; this.lastArgs = args;
    if (this.mask) return this.run(op, args);
    const seq = ++this.seq;
    this.ensureProxy();
    const desc = this.descFor(op, args);
    if (desc && this.pipeline && this.canGpuPreview(desc)) {
      try {
        if (this.pipeline.render({ ...desc, step: this.step, ox: this.ox, oy: this.oy })) { this.showPreview(this.pipeline.canvas); return Promise.resolve(); }
      } catch (e) { console.warn('GPU preview failed, using CPU', e); }
    }
    return this.runCpuProxy(op, args, seq);
  }

  descFor(op, args) {
    if (op === 'adjust') return { kind: 'adjust', adjustment: args.adjustment };
    if (op === 'filter') return { kind: 'filter', id: args.id, params: args.params, env: args.env };
    return null;
  }
  canGpuPreview(desc) {
    if (desc.kind === 'adjust') return canRunOnGpu(desc.adjustment).preview;
    if (desc.kind === 'filter') return !!FILTER_GPU[desc.id];
    return false;
  }
  canGpuCommit(desc) { return desc && desc.kind === 'adjust' && canRunOnGpu(desc.adjustment).commit; }

  ensureProxy() {
    if (this.proxy) return;
    const spec = this.computeProxySpec();
    this.proxy = spec;
    this.step = spec.step;
    this.ox = this.startTransform.x + spec.cropX;
    this.oy = this.startTransform.y + spec.cropY;
    const src = makeCanvas(spec.w, spec.h);
    const sctx = src.getContext('2d');
    sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(this.layer.canvas, spec.cropX, spec.cropY, spec.cropW, spec.cropH, 0, 0, spec.w, spec.h);
    this.proxyBuffer = getData(src).data;
    this.proxyCanvas = makeCanvas(spec.w, spec.h);
    this.previewImg = new ImageData(new Uint8ClampedArray(spec.w * spec.h * 4), spec.w, spec.h);
    if (this.selection) this.proxySelection = this.downscaleSelection(spec.w, spec.h);
    if (isGpuEnabled()) this.pipeline = GpuLayerPipeline.create(src, { w: spec.w, h: spec.h }, this.selection ? { data: this.selection.data, w: this.selection.width, h: this.selection.height } : null);
  }

  // Proxy size: the whole layer fitted to the viewport, or (zoomed in, pure translation) the visible crop at device
  // resolution so the preview stays crisp. Matrix maps the proxy onto the same document area the layer occupies.
  computeProxySpec() {
    const lw = this.image.width, lh = this.image.height;
    const zoom = this.doc.view.zoom || 1, dpr = window.devicePixelRatio || 1;
    const vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight);
    const pure = isPureTranslation(this.startTransform, lw, lh);
    if (zoom > 1.001 && pure && !this.doc.view.rot) {
      const vis = { x: -this.doc.view.panX / zoom, y: -this.doc.view.panY / zoom, w: vw / zoom, h: vh / zoom };
      const lx = this.startTransform.x, ly = this.startTransform.y;
      const ix = Math.max(lx, vis.x), iy = Math.max(ly, vis.y), ix2 = Math.min(lx + lw, vis.x + vis.w), iy2 = Math.min(ly + lh, vis.y + vis.h);
      if (ix2 > ix && iy2 > iy) {
        const cx = Math.floor(ix - lx), cy = Math.floor(iy - ly);
        const cw = Math.max(1, Math.ceil(ix2 - lx) - cx), ch = Math.max(1, Math.ceil(iy2 - ly) - cy);
        const pw = Math.max(1, Math.min(4096, Math.round(cw * zoom * dpr)));
        const ph = Math.max(1, Math.min(4096, Math.round(ch * zoom * dpr)));
        return { w: pw, h: ph, cropX: cx, cropY: cy, cropW: cw, cropH: ch, nearest: true, matrix: G.concat(G.scale(cw / pw, ch / ph), G.translate(lx + cx, ly + cy)), step: cw / pw };
      }
    }
    const s = pickPreviewSize(lw, lh, vw, vh, dpr);
    return { w: s.w, h: s.h, cropX: 0, cropY: 0, cropW: lw, cropH: lh, nearest: false, matrix: transformMatrix(this.startTransform, s.w, s.h), step: lw / s.w };
  }

  downscaleSelection(w, h) {
    const sw = this.selection.width, sh = this.selection.height, d = this.selection.data, out = new Mask(w, h);
    for (let y = 0; y < h; y++) { const sy = Math.min(sh - 1, (y * sh / h) | 0); for (let x = 0; x < w; x++) out.data[y * w + x] = d[sy * sw + Math.min(sw - 1, (x * sw / w) | 0)]; }
    return out;
  }

  async runCpuProxy(op, args, seq) {
    this.running++;
    try {
      const pw = this.proxy.w, ph = this.proxy.h;
      const out = await compute(op, { ...args, w: pw, h: ph, ox: this.ox, oy: this.oy, step: this.step }, this.proxyBuffer.slice().buffer, { key: 'proxy', transfer: true, rebuild: () => this.proxyBuffer.slice().buffer });
      if (this.closed || seq !== this.seq) return;
      this.applyProxyResult(out.result, out.buffer);
    } finally { this.running--; if (!this.running) { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); } }
  }

  applyProxyResult(result, buffer) {
    const pw = this.proxy.w, ph = this.proxy.h;
    let data = new Uint8ClampedArray(buffer);
    const gw = result.w ?? pw, gh = result.h ?? ph, gx = result.growX || 0, gy = result.growY || 0;
    if (gw !== pw || gh !== ph) data = this.cropProxy(data, gw, gh, gx, gy);
    this.previewImg.data.set(data);
    if (this.proxySelection) mixBySelection(this.proxyBuffer, this.previewImg, this.proxySelection);
    putData(this.proxyCanvas, this.previewImg);
    this.showPreview(this.proxyCanvas);
  }

  cropProxy(data, w, h, gx, gy) {
    const pw = this.proxy.w, ph = this.proxy.h, o = new Uint8ClampedArray(pw * ph * 4);
    for (let y = 0; y < ph; y++) o.set(data.subarray(((y + gy) * w + gx) * 4, ((y + gy) * w + gx + pw) * 4), y * pw * 4);
    return o;
  }

  showPreview(canvas) {
    this.layer.preview = { canvas, matrix: this.proxy.matrix, nearest: this.proxy.nearest };
    this.doc.invalidate(this.doc.affectedArea(this.layer));
  }
  clearPreview() {
    if (this.layer.preview) { this.layer.preview = null; this.doc.invalidate(this.doc.affectedArea(this.layer)); }
  }
  showOriginal() {
    this.seq++;
    if (this.mask) { this.layer.mask = this.originalMask; this.layer.transform = this.startTransform; this.doc.invalidate(this.doc.affectedArea(this.layer)); }
    else this.clearPreview();
  }
  dispose() { if (this.pipeline) { this.pipeline.dispose(); this.pipeline = null; } }

  // ---- the full-res edit is applied as a single history step, on the original `layer.canvas` --------------------
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
    this.seq++;
    const op = this.lastOp, args = this.lastArgs;
    if (op && !this.mask) {
      const desc = this.descFor(op, args);
      if (this.pipeline && this.canGpuCommit(desc)) {
        const canvas = this.pipeline.commitFull(desc, this.layer.canvas, this.selection ? { data: this.selection.data, w: this.selection.width, h: this.selection.height } : null);
        if (canvas) {
          this.closed = true;
          this.clearPreview(); this.dispose();
          this.layer.canvas = canvas; this.layer.transform = this.startTransform;
          this.doc.invalidate(this.doc.affectedArea(this.layer));
          this.doc.commit(); this.doc.layersChanged();
          return;
        }
      }
      await this.run(op, args);
    }
    this.closed = true;
    this.clearPreview(); this.dispose();
    this.doc.commit(); this.doc.layersChanged();
  }
  cancel() { if (this.closed) return; this.closed = true; this.seq++; this.clearPreview(); this.dispose(); this.doc.cancel(); }
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
