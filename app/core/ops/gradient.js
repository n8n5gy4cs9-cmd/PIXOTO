// Gradient drawing (port of Composa EditorSession.DrawGradient): an adjustable gradient on a layer or mask, redrawn
// from the untouched original on every change, limited to the selection. The edit stays open until it is settled.
import { Mask } from '../mask.js';
import { makeCanvas, ctxOf, getData, putData, hexToRgb, grayOf, cloneCanvas, touchCanvas } from '../pixels.js';
import { growToCanvas, selectionInTargetSpace, mixBySelection } from './pixels.js';
import { maskMatrix } from '../render.js';
import * as G from '../geom.js';

export class GradientEdit {
  // Opens the "Gradient" edit on `layer`'s pixels (or mask) and returns false when nothing could be started.
  constructor(doc, layer) {
    this.doc = doc; this.layer = layer; this.mask = doc.isEditingMask;
    doc.begin('Gradient');
    growToCanvas(doc, layer);
    this.matrix = this.mask ? maskMatrix(layer) : layer.matrix;
    this.inv = G.invert(this.matrix);
    this.selection = selectionInTargetSpace(doc, layer);
    if (this.mask) { this.original = layer.mask; this.working = new Mask(this.original.width, this.original.height, this.original.data.slice()); layer.mask = this.working; }
    else {
      this.originalCanvas = layer.canvas; this.originalData = getData(layer.canvas);
      this.working = cloneCanvas(layer.canvas); layer.canvas = this.working;
      this.scratch = makeCanvas(layer.canvas.width, layer.canvas.height);
    }
  }
  get valid() { return !!this.inv && this.doc.find(this.layer.id) !== null; }

  draw(from, to, { fg, bg, toTransparent, radial, opacity }) {
    const { doc, layer } = this;
    if (!this.inv) return;
    const a = G.mapPoint(this.inv, from.x, from.y), b = G.mapPoint(this.inv, to.x, to.y), len = Math.max(0.5, Math.hypot(b.x - a.x, b.y - a.y));
    if (this.mask) {
      const o = this.original, w = o.width, h = o.height, out = this.working.data, g0 = grayOf(...hexToRgb(fg)), g1 = grayOf(...hexToRgb(bg)), dx = (b.x - a.x) / (len * len), dy = (b.y - a.y) / (len * len);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = radial ? Math.min(1, Math.hypot(x + 0.5 - a.x, y + 0.5 - a.y) / len) : Math.max(0, Math.min(1, (x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy));
        const v = g0 + (g1 - g0) * t, i = y * w + x;
        out[i] = o.data[i] + (v - o.data[i]) * opacity;
      }
      mixBySelection(o, this.working, this.selection);
      this.working.touch();
    } else {
      const c = this.scratch, ctx = ctxOf(c), w = c.width, h = c.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
      const grad = radial ? ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, len) : ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      const [r, g, bl] = hexToRgb(fg), [r2, g2, b2] = hexToRgb(bg);
      grad.addColorStop(0, `rgb(${r},${g},${bl})`);
      grad.addColorStop(1, toTransparent ? `rgba(${r},${g},${bl},0)` : `rgb(${r2},${g2},${b2})`);
      ctx.fillStyle = grad; ctx.globalAlpha = opacity; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
      const wctx = ctxOf(this.working);
      wctx.globalCompositeOperation = 'copy'; wctx.drawImage(this.originalCanvas, 0, 0); wctx.globalCompositeOperation = 'source-over'; wctx.drawImage(c, 0, 0);
      if (this.selection) {
        const now = getData(this.working);
        mixBySelection(this.originalData, now, this.selection);
        putData(this.working, now);
      }
      touchCanvas(this.working);
    }
    doc.invalidate(doc.affectedArea(layer));
  }
  commit() { this.doc.commit(); this.doc.layersChanged(); }
  cancel() { this.doc.cancel(); }
}
