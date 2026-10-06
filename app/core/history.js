// Undo/redo. A step stores structure snapshots (layer order + per-layer properties) and optional pixel diffs
// registered by tools (Phase 2+). Composa keeps 100 steps.
export const MAX_STEPS = 100;

export class History {
  constructor() { this.undoStack = []; this.redoStack = []; this.onChange = () => {}; }
  push(step) {
    this.undoStack.push(step);
    if (this.undoStack.length > MAX_STEPS) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange();
  }
  get undoName() { return this.undoStack.at(-1)?.name ?? null; }
  get redoName() { return this.redoStack.at(-1)?.name ?? null; }
  undo() { const s = this.undoStack.pop(); if (!s) return false; s.undo(); this.redoStack.push(s); this.onChange(); return true; }
  redo() { const s = this.redoStack.pop(); if (!s) return false; s.redo(); this.undoStack.push(s); this.onChange(); return true; }
}
