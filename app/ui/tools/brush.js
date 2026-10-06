// Brush, Spot Healing, Clone Stamp and Smear: all drag a BrushStroke over the active layer or mask.
import { state, update } from '../../core/state.js';
import { BrushMode, defaultBrush } from '../../core/paint/stroke.js';
import { paintSession } from '../../core/ops/paint.js';
import { rgba, brushKey, ring, cross } from './common.js';
import { pickColor } from './view-tools.js';

const SMEAR_MODES = [BrushMode.liquify, BrushMode.blur, BrushMode.smudge, BrushMode.dodge, BrushMode.burn];

class BrushLikeTool {
  constructor(app, toolId) { this.app = app; this.id = toolId; }
  mode() {
    switch (this.id) {
      case 'heal': return BrushMode.heal;
      case 'clone': return BrushMode.clone;
      case 'smear': return SMEAR_MODES[state.modes.smear ?? 0];
      default: return state.modes.brush === 1 ? BrushMode.erase : BrushMode.paint;
    }
  }
  settings() { return { ...defaultBrush(), ...state.brush }; }
  cursor() { return 'none'; }
  usesCtrl() { return false; }

  down(ev) {
    const { doc, alt, shift, p } = ev;
    if (alt && this.id === 'clone') { paintSession.setCloneSource(p); ev.view.invalidate(); this.picked = true; return; }
    if (alt && this.id === 'brush') { pickColor(ev, false); this.picking = true; return; }
    paintSession.viewZoom = ev.view.zoom;
    paintSession.onProblem = this.app.problem;
    const problem = paintSession.begin(doc, p, {
      mode: this.mode(), brush: this.settings(), color: rgba(state.fg), aligned: state.cloneAligned, sampleAll: state.cloneAllLayers,
      lineFromLast: shift && !!paintSession.lastEnd,
    });
    if (problem) { this.app.problem(problem); this.active = false; return; }
    this.active = true;
  }
  move(ev) {
    if (this.picking) { pickColor(ev, false); return; }
    if (!this.active) return;
    paintSession.viewZoom = ev.view.zoom;
    for (const pt of ev.points) paintSession.continue(pt.p, pt.pressure);
  }
  up() { if (this.active) paintSession.end(); this.active = false; this.picking = false; this.picked = false; }
  cancel() { if (this.active) paintSession.cancel(); this.active = false; this.picking = false; }
  key(e) { return brushKey(e); }
  overlay(ctx, view, dpr) {
    const h = view.hover; if (!h) return;
    const r = state.brush.size / 2;
    ring(ctx, view, dpr, h, r);
    if (this.id === 'clone') {
      const s = paintSession.cloneSamplePoint(h, state.cloneAligned);
      if (s) cross(ctx, view, dpr, s);
    }
  }
}
export const createBrushTools = (app) => ({
  brush: new BrushLikeTool(app, 'brush'), heal: new BrushLikeTool(app, 'heal'), clone: new BrushLikeTool(app, 'clone'), smear: new BrushLikeTool(app, 'smear'),
});
