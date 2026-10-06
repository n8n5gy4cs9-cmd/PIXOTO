// Painting a stroke onto the active layer or its mask (port of Composa EditorSession.Painting).
import { BrushStroke, BrushMode } from '../paint/stroke.js';
import { inpaint, MAX_AREA } from '../paint/inpaint.js';
import { maskMatrix, renderer } from '../render.js';
import { getData, putData, ctxOf, touchCanvas } from '../pixels.js';
import { growToCanvas, selectionInTargetSpace, mixBySelection } from './pixels.js';
import { isPureTranslation } from '../model.js';
import * as G from '../geom.js';

const NAMES = { erase: 'Eraser', clone: 'Clone Stamp', heal: 'Spot Healing Brush', liquify: 'Liquify', blur: 'Blur', smudge: 'Smudge', dodge: 'Dodge', burn: 'Burn', paint: 'Brush' };

export class PaintSession {
  constructor() { this.stroke = null; this.lastEnd = null; this.cloneSource = null; this.cloneOffset = null; this.viewZoom = 1; this.pressureSensitive = true; this.onProblem = () => {}; }

  get active() { return !!this.stroke; }
  setCloneSource(p) { this.cloneSource = p; this.cloneOffset = null; }
  // Where the clone source currently is while painting, for the crosshair overlay.
  cloneSamplePoint(cursor, aligned) {
    if (!this.cloneSource) return null;
    return this.cloneOffset && aligned ? { x: cursor.x + this.cloneOffset.x, y: cursor.y + this.cloneOffset.y } : this.cloneSource;
  }

  // Starts painting at a document point. Returns null, or the reason the active layer can't be painted.
  begin(doc, point, { mode, brush, color, aligned = true, sampleAll = false, lineFromLast = false }) {
    const layer = doc.active;
    if (!layer) return 'Select a layer to paint on.';
    const editMask = doc.isEditingMask;
    if (!editMask && !layer.canvas) return layer.isGroup ? "Folders can't be painted on. Select a layer inside." : 'Adjustment layers have no pixels. Add a mask to paint on.';
    if (!editMask && layer.isLive) return `This is live ${layer.text ? 'text' : 'shape'}. Rasterize it (Layer menu) to paint on it.`;
    if (!editMask && layer.transform.distort) return 'This layer is distorted. Rasterize or commit the transform first.';
    if (!doc.isEffectivelyVisible(layer)) return 'The layer is hidden.';
    if (mode === BrushMode.clone && !this.cloneSource) return 'Alt-click to set the clone source first.';
    if (mode === BrushMode.heal && editMask) return 'The Spot Healing Brush works on pixels, not masks.';

    doc.begin(NAMES[mode] || 'Brush');
    // A brush on a mask can paint anywhere on the canvas, growing the mask past its layer; the smearing brushes stay inside it.
    if (!editMask || mode === BrushMode.paint || mode === BrushMode.erase) growToCanvas(doc, layer);
    const mask = editMask ? layer.mask : null, canvas = layer.canvas;
    const matrix = editMask ? maskMatrix(layer) : layer.matrix, inv = G.invert(matrix);
    if (!inv) { doc.cancel(); return 'The layer is too small to paint on.'; }
    const scale = G.scaleOf(matrix);
    const target = editMask ? mask : getData(canvas);
    const targetForStroke = editMask ? mask : target;

    let cloneSource = null, offset = { x: 0, y: 0 };
    if (mode === BrushMode.clone) {
      if (!aligned || !this.cloneOffset) this.cloneOffset = { x: this.cloneSource.x - point.x, y: this.cloneSource.y - point.y };
      const o = this.cloneOffset;
      const translationOnly = !layer.canvas || isPureTranslation(layer.transform, canvas.width, canvas.height);
      if (sampleAll && !editMask && translationOnly) {
        cloneSource = getData(renderer.render(doc));
        offset = { x: Math.round(o.x + layer.transform.x), y: Math.round(o.y + layer.transform.y) };
      } else {
        cloneSource = editMask ? mask : target;
        const v = G.mapVector(inv, o.x, o.y);
        offset = { x: Math.round(v.x), y: Math.round(v.y) };
      }
    }
    this.layer = layer; this.editMask = editMask; this.canvas = canvas; this.mask = mask; this.matrix = matrix; this.inv = inv;
    this.original = editMask ? mask.data.slice() : target;                      // untouched pixels, for the undo patch
    this.originalCopy = editMask ? null : target.data;
    this.mode = mode; this.brush = brush;
    const col = color || [0, 0, 0, 255];
    this.stroke = new BrushStroke(editMask ? { data: mask.data, width: mask.width, height: mask.height } : target, brush, mode, mode === BrushMode.paint ? col : [0, 0, 0, 255], scale,
      { selection: doc.selection, toDocument: matrix, cloneSource, cloneOffset: offset });
    this.doc = doc;
    if (canvas) canvas.live = true;
    if (lineFromLast && this.lastEnd) this.stroke.addPoint(...this.mapPt(this.lastEnd));
    this.anchor = this.pointer = point;
    this.paint(point, 1);
    if (lineFromLast) doc.invalidate(doc.affectedArea(layer));
    return null;
  }
  mapPt(p) { const q = G.mapPoint(this.inv, p.x, p.y); return [q.x, q.y]; }

  continue(point, pressure = 1) {
    if (!this.stroke) return;
    this.pointer = point;
    const p = this.smoothed(point);
    if (p) this.paint(p, pressure);
  }
  get smoothing() { return (this.mode === BrushMode.paint || this.mode === BrushMode.erase) && this.brush.smoothing > 0; }
  // With Smoothing on the brush trails the pointer on a string and only moves once the pointer pulls it taut.
  smoothed(point) {
    if (!this.smoothing || !this.anchor) return point;
    const radius = this.brush.smoothing / Math.max(0.01, this.viewZoom), dx = point.x - this.anchor.x, dy = point.y - this.anchor.y, dist = Math.hypot(dx, dy);
    if (dist <= radius) return null;
    const step = (dist - radius) / dist, moved = { x: this.anchor.x + dx * step, y: this.anchor.y + dy * step };
    this.anchor = moved;
    return moved;
  }
  paint(point, pressure) {
    const s = this.stroke, [x, y] = this.mapPt(point);
    const changed = s.addPoint(x, y, this.pressureSensitive ? pressure : 1);
    this.lastEnd = point;
    if (!changed.w) return;
    this.flush(changed);
  }
  // Writes the stroke's working pixels for a rectangle (target grid) back to the layer and invalidates the view.
  flush(r) {
    const s = this.stroke;
    if (this.editMask) {
      const m = this.mask;
      for (let y = r.y; y < r.y + r.h; y++) m.data.set(s.working.subarray(y * m.width + r.x, y * m.width + r.x + r.w), y * m.width + r.x);
      m.touch();
    } else { ctxOf(this.canvas).putImageData(s.workImage, 0, 0, r.x, r.y, r.w, r.h); touchCanvas(this.canvas); }
    const area = G.roundOut(G.mapRect(this.matrix, r));
    this.doc.invalidate(G.inflate(area, 1));
  }

  end() {
    const s = this.stroke; if (!s) return;
    const { doc, layer } = this;
    if (this.smoothing && this.pointer && this.anchor && (this.pointer.x !== this.anchor.x || this.pointer.y !== this.anchor.y)) this.paint(this.pointer, 1);
    let rect = s.touched;
    if (!rect.w) { this.close(); doc.cancel(); return; }
    if (this.mode === BrushMode.heal) {
      if (rect.w * rect.h > MAX_AREA) { this.restoreOriginal(); this.close(); doc.cancel(); this.onProblem('That area is too large to heal in one stroke. Heal it in smaller strokes.'); return; }
      const { width: w, height: h } = s, healed = new ImageData(inpaint(this.originalCopy, s.coverageMask(), w, h), w, h);
      const sel = selectionInTargetSpace(doc, layer);
      mixBySelection(new ImageData(new Uint8ClampedArray(this.originalCopy), w, h), healed, sel);
      s.working.set(healed.data);
      rect = { x: 0, y: 0, w, h };
      ctxOf(this.canvas).putImageData(s.workImage, 0, 0); touchCanvas(this.canvas);
      doc.invalidate(doc.affectedArea(layer));
    }
    const orig = this.editMask ? this.original : new ImageData(this.originalCopy, s.width, s.height);
    doc.addPatch(doc.patchFor(this.editMask ? this.mask : this.canvas, rect, orig));
    this.close();
    doc.commit();
    doc.layersChanged();
  }
  cancel() {
    if (!this.stroke) return;
    this.restoreOriginal(); const doc = this.doc; this.close(); doc.cancel();
  }
  restoreOriginal() {
    if (this.editMask) { this.mask.data.set(this.original); this.mask.touch(); }
    else { putData(this.canvas, new ImageData(new Uint8ClampedArray(this.originalCopy), this.stroke.width, this.stroke.height)); touchCanvas(this.canvas); }
    this.doc.invalidate(this.doc.affectedArea(this.layer));
  }
  close() { if (this.canvas) { this.canvas.live = false; touchCanvas(this.canvas); } this.stroke = null; this.anchor = this.pointer = null; }
}
export const paintSession = new PaintSession();
