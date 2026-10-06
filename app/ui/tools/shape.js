// Shape tool: rectangle, rounded rectangle, ellipse and line on live shape layers (Composa).
import { state } from '../../core/state.js';
import { addShape, addLine } from '../../core/ops/live.js';
import { SHAPE_KINDS } from '../../core/shape.js';
import { dragRect } from './selection.js';
import { constrainAngle, rectPath } from './common.js';

export class ShapeTool {
  constructor(app) { this.app = app; }
  cursor() { return 'crosshair'; }
  get kind() { return SHAPE_KINDS[state.modes.shape ?? 0]; }
  down() { this.on = true; }
  up(ev) {
    this.on = false;
    if (!ev.moved) return;
    const { doc } = ev;
    if (this.kind === 'line') addLine(doc, ev.press, constrainAngle(ev.press, ev.p, ev.shift), state.fg, state.shapeLineWidth, this.app.problem);
    else addShape(doc, this.kind, dragRect(ev.press, ev.p, ev.shift, ev.alt), { fill: state.fg, cornerRadius: state.shapeCornerRadius }, this.app.problem);
  }
  cancel() { this.on = false; }
  overlay(ctx, view, dpr) {
    if (!this.on || !view.drag || !view.hover) return;
    const press = view.drag.press, cur = view.hover;
    ctx.save(); ctx.strokeStyle = '#3d9bff'; ctx.lineWidth = dpr;
    if (this.kind === 'line') { const e = constrainAngle(press, cur, view.shiftDown), a = view.canvasToScreen(press.x, press.y), b = view.canvasToScreen(e.x, e.y); ctx.beginPath(); ctx.moveTo(a.x * dpr, a.y * dpr); ctx.lineTo(b.x * dpr, b.y * dpr); ctx.stroke(); }
    else {
      ctx.beginPath(); rectPath(ctx, view, dpr, dragRect(press, cur, view.shiftDown, view.altDown), this.kind === 'ellipse');
      ctx.stroke();
    }
    ctx.restore();
  }
}
