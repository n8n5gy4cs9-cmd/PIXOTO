// Undo/redo (Composa keeps 100 steps). A step holds the structure of the document before and after the edit (layer
// tree, selection, guides: cheap, as layers share their canvases) plus pixel patches for the edits that changed a
// canvas or mask in place. Patches swap: applying one stores what it overwrote, so the same call undoes and redoes.
import { getData, putData, touchCanvas } from './pixels.js';

export const MAX_STEPS = 100;
const MEMORY_BUDGET = 1.5 * 1024 * 1024 * 1024;

// A rectangle of a canvas (ImageData) or of a Mask (Uint8Array rows), saved before it is overwritten in place.
export function canvasPatch(canvas, rect, data) { return { canvas, rect, data, bytes: data.data.length }; }
export function maskPatch(mask, rect, data) { return { mask, rect, data, bytes: data.length }; }

export function swap(p) {
  const { x, y, w, h } = p.rect;
  if (p.canvas) {
    const now = getData(p.canvas, x, y, w, h);
    putData(p.canvas, p.data, x, y);
    p.data = now; touchCanvas(p.canvas);
  } else {
    const m = p.mask, now = new Uint8Array(w * h);
    for (let r = 0; r < h; r++) {
      const from = (y + r) * m.width + x;
      now.set(m.data.subarray(from, from + w), r * w);
      m.data.set(p.data.subarray(r * w, r * w + w), from);
    }
    p.data = now; m.touch();
  }
}

export class History {
  constructor() { this.undoStack = []; this.redoStack = []; this.onChange = () => {}; }
  get undoName() { return this.undoStack.at(-1)?.name ?? null; }
  get redoName() { return this.redoStack.at(-1)?.name ?? null; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  push(step) {
    this.undoStack.push(step);
    this.redoStack.length = 0;
    this.trim();
    this.onChange();
  }
  // Folds the newest step into the one before it, so two edits undo as one named step.
  mergeLast(name) {
    if (this.undoStack.length < 2) return;
    const b = this.undoStack.pop(), a = this.undoStack.pop();
    this.undoStack.push({ name, before: a.before, after: b.after, patches: [...a.patches, ...b.patches] });
  }
  discardLast() { this.undoStack.pop(); }
  clear() { this.undoStack = []; this.redoStack = []; this.onChange(); }
  trim() {
    while (this.undoStack.length > MAX_STEPS) this.undoStack.shift();
    while (this.undoStack.length > 1 && this.heldBytes() > MEMORY_BUDGET) this.undoStack.shift();
  }
  // Patches plus the distinct canvases and masks the snapshots keep alive.
  heldBytes() {
    const seen = new Set();
    let total = 0;
    const take = (o, bytes) => { if (o && !seen.has(o)) { seen.add(o); total += bytes; } };
    const walk = (layers) => { for (const l of layers) { if (l.canvas) take(l.canvas, l.canvas.width * l.canvas.height * 4); if (l.mask) take(l.mask, l.mask.data.length); walk(l.children); } };
    for (const s of this.undoStack) {
      for (const p of s.patches) total += p.bytes;
      walk(s.before.layers); walk(s.after.layers);
      if (s.before.selection) take(s.before.selection, s.before.selection.data.length);
    }
    return total;
  }
  undo(doc) {
    const s = this.undoStack.pop(); if (!s) return false;
    for (let i = s.patches.length - 1; i >= 0; i--) swap(s.patches[i]);
    doc.restore(s.before);
    this.redoStack.push(s); this.onChange();
    return true;
  }
  redo(doc) {
    const s = this.redoStack.pop(); if (!s) return false;
    for (const p of s.patches) swap(p);
    doc.restore(s.after);
    this.undoStack.push(s); this.onChange();
    return true;
  }
}
