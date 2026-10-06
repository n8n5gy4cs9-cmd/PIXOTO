// Gradient tool: drag to draw, then drag either end to adjust; Enter applies, Escape cancels (Composa).
import { state } from '../../core/state.js';
import { GradientEdit } from '../../core/ops/gradient.js';
import { dist, constrainAngle } from './common.js';

export class GradientTool {
  constructor(app) { this.app = app; this.edit = null; this.from = null; this.to = null; this.movesStart = false; this.dragging = false; this.pending = false; }
  cursor() { return 'crosshair'; }
  settings() { return { fg: state.fg, bg: state.bg, toTransparent: state.gradientToTransparent, radial: state.gradientRadial, opacity: state.gradientOpacity }; }
  get open() { return this.pending && this.edit && this.edit.doc.hasPendingEdit && this.edit.valid; }

  settle(keep) {
    const e = this.edit;
    if (this.pending && e && e.doc.hasPendingEdit) { if (keep) e.commit(); else e.cancel(); }
    if (e) e.doc.interaction = null;
    this.edit = null; this.pending = false; this.dragging = false;
    this.app.view.invalidate();
  }
  down(ev) {
    const { view, doc, p, screen } = ev;
    if (this.open) {
      const s0 = view.canvasToScreen(this.from.x, this.from.y), s1 = view.canvasToScreen(this.to.x, this.to.y);
      const nearStart = dist(s0, screen) <= 10;
      if (nearStart || dist(s1, screen) <= 10) { this.movesStart = nearStart; this.dragging = true; return; }
    }
    this.settle(true);
    const layer = doc.editableLayer;
    if (!layer) { this.app.problem('Select a pixel layer or a mask to draw a gradient on.'); return; }
    this.edit = new GradientEdit(doc, layer);
    doc.interaction = { finish: () => { this.pending = true; this.settle(true); } };
    this.from = this.to = p; this.movesStart = false; this.dragging = true; this.pending = true;
  }
  move(ev) {
    if (!this.dragging || !this.edit) return;
    if (this.movesStart) this.from = constrainAngle(this.to, ev.p, ev.shift); else this.to = constrainAngle(this.from, ev.p, ev.shift);
    this.edit.draw(this.from, this.to, this.settings());
  }
  up(ev) {
    this.dragging = false;
    if (!ev.moved && this.to === this.from) this.settle(false);   // a click that drew nothing is dropped
  }
  cancel() { this.dragging = false; this.settle(false); }
  key(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (/^Digit\d$/.test(e.code) && !e.shiftKey) { const n = +e.code.slice(5); this.app.setGradientOpacity(n === 0 ? 1 : n / 10); if (this.open) this.edit.draw(this.from, this.to, this.settings()); return true; }
    if (!this.open || this.dragging) return false;
    if (e.key === 'Enter') { this.settle(true); return true; }
    if (e.key === 'Escape') { this.settle(false); return true; }
    return false;
  }
  deactivate() { this.settle(true); }
  overlay(ctx, view, dpr) {
    if (!this.open) return;
    const a = view.canvasToScreen(this.from.x, this.from.y), b = view.canvasToScreen(this.to.x, this.to.y);
    ctx.save(); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.moveTo(a.x * dpr, a.y * dpr); ctx.lineTo(b.x * dpr, b.y * dpr); ctx.stroke();
    ctx.lineWidth = dpr; ctx.strokeStyle = '#fff'; ctx.stroke();
    for (const s of [a, b]) { ctx.beginPath(); ctx.arc(s.x * dpr, s.y * dpr, 5 * dpr, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke(); }
    ctx.restore();
  }
}
