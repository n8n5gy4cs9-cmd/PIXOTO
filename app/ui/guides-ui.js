// Rulers, guides and the layout grid, drawn over the canvas and edited with the pointer (Composa CanvasView.Guides).
// Drag out of a ruler for a new guide; with the Move tool drag a guide to move it, or drop it back on a ruler to delete it.
import { state } from '../core/state.js';
import * as G from '../core/ops/guides.js';

const RULER = 18, HIT = 4;
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

export function installGuidesUi(app) {
  const view = app.view;
  let drag = null;       // { axis, id|null, pos }

  const guideScreen = (g) => (g.axis === 'v' ? view.canvasToScreen(g.position, 0).x : view.canvasToScreen(0, g.position).y);
  const rulersOn = () => state.view.rulers && view.doc && !view.rotated;
  const overRuler = (s) => rulersOn() && (s.x < RULER || s.y < RULER);
  const rulerAxis = (s) => (s.x < RULER && s.y >= RULER ? 'v' : s.y < RULER && s.x >= RULER ? 'h' : null);   // a vertical guide comes out of the left ruler
  const hitGuide = (s) => {
    if (!state.view.guides || !view.doc) return null;
    for (const g of view.doc.guides) if (Math.abs(guideScreen(g) - (g.axis === 'v' ? s.x : s.y)) <= HIT) return g;
    return null;
  };
  const snapPos = (axis, p, id) => {
    const raw = axis === 'v' ? p.x : p.y;
    return G.snapGuidePosition(view.doc, axis, Math.floor(raw) + 0.5, id, 8 / view.zoom);
  };

  view.interceptHover = (e, s) => {
    if (!view.doc || drag) return false;
    if (state.tool === 'move' || view.ctrlDown === false) {
      const g = state.tool === 'move' && !state.view.lockGuides ? hitGuide(s) : null;
      if (g) { view.canvas.style.cursor = g.axis === 'v' ? 'ew-resize' : 'ns-resize'; return false; }
    }
    return false;
  };
  view.interceptDown = (e, s, p) => {
    const doc = view.doc;
    if (state.view.lockGuides || view.rotated) return false;
    const ax = rulerAxis(s);
    if (ax && e.button === 0) { drag = { axis: ax, id: null, pos: snapPos(ax, p, null) }; return start(e); }
    if (overRuler(s)) return true;
    if (state.tool === 'move' && !e.ctrlKey && e.button === 0) {
      const g = hitGuide(s);
      if (g) { drag = { axis: g.axis, id: g.id, pos: g.position }; return start(e); }
    }
    return false;
  };
  function start(e) {
    const mv = (ev) => { const p = view.screenToCanvas(ev.clientX, ev.clientY); drag.pos = snapPos(drag.axis, p, drag.id); drag.screen = view.local(ev); view.invalidate(); };
    const up = (ev) => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      const s = view.local(ev), d = drag; drag = null;
      const inside = !overRuler(s) && s.x >= 0 && s.y >= 0 && s.x <= view.canvas.clientWidth && s.y <= view.canvas.clientHeight;
      if (d.id != null) { if (inside) G.moveGuide(view.doc, d.id, d.pos); else G.removeGuide(view.doc, d.id); }
      else if (inside) { const doc = view.doc, pos = d.pos; if (pos >= 0 && pos <= (d.axis === 'v' ? doc.width : doc.height)) { G.addGuide(doc, d.axis, pos); if (!state.view.guides) app.problem('Guides are hidden: View > Show Guides.'); } }
      view.invalidate();
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    view.canvas.setPointerCapture?.(e.pointerId);
    view.invalidate();
    return true;
  }

  view.overlays.push((ctx, v, dpr) => {
    const doc = v.doc; if (!doc || v.rotated) return;
    const W = ctx.canvas.width, H = ctx.canvas.height, z = doc.view.zoom;
    // layout grid: a major line every 64 px with eight subdivisions
    if (state.view.grid) {
      ctx.save(); ctx.lineWidth = dpr;
      const draw = (step, color) => { ctx.strokeStyle = color; ctx.beginPath(); for (let x = 0; x <= doc.width; x += step) { const sx = Math.round(v.canvasToScreen(x, 0).x * dpr) + 0.5; ctx.moveTo(sx, v.canvasToScreen(0, 0).y * dpr); ctx.lineTo(sx, v.canvasToScreen(0, doc.height).y * dpr); } for (let y = 0; y <= doc.height; y += step) { const sy = Math.round(v.canvasToScreen(0, y).y * dpr) + 0.5; ctx.moveTo(v.canvasToScreen(0, 0).x * dpr, sy); ctx.lineTo(v.canvasToScreen(doc.width, 0).x * dpr, sy); } ctx.stroke(); };
      if (z * G.GRID_STEP >= 6) draw(G.GRID_STEP, 'rgba(120,200,255,.18)');
      if (z * G.GRID_SPACING >= 6) draw(G.GRID_SPACING, 'rgba(120,200,255,.4)');
      ctx.restore();
    }
    if (state.view.guides) {
      ctx.save(); ctx.lineWidth = dpr; ctx.strokeStyle = '#00d0ff';
      ctx.beginPath();
      for (const g of doc.guides) { if (drag?.id === g.id) continue; const s = guideScreen(g) * dpr; if (g.axis === 'v') { ctx.moveTo(Math.round(s) + 0.5, 0); ctx.lineTo(Math.round(s) + 0.5, H); } else { ctx.moveTo(0, Math.round(s) + 0.5); ctx.lineTo(W, Math.round(s) + 0.5); } }
      ctx.stroke(); ctx.restore();
    }
    if (drag) {
      ctx.save(); ctx.lineWidth = dpr; ctx.strokeStyle = '#00d0ff'; ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.beginPath();
      const s = guideScreen({ axis: drag.axis, position: drag.pos }) * dpr;
      if (drag.axis === 'v') { ctx.moveTo(s, 0); ctx.lineTo(s, H); } else { ctx.moveTo(0, s); ctx.lineTo(W, s); }
      ctx.stroke(); ctx.restore();
    }
    if (rulersOn()) drawRulers(ctx, v, dpr);
  });
}

function drawRulers(ctx, v, dpr) {
  const doc = v.doc, z = doc.view.zoom, W = ctx.canvas.width, H = ctx.canvas.height, R = RULER * dpr;
  ctx.save();
  ctx.fillStyle = '#2b2b2b'; ctx.fillRect(0, 0, W, R); ctx.fillRect(0, 0, R, H);
  ctx.strokeStyle = '#555'; ctx.fillStyle = '#9a9a9a'; ctx.lineWidth = dpr; ctx.font = `${9 * dpr}px system-ui, sans-serif`; ctx.textBaseline = 'top';
  const step = STEPS.find((s) => s * z >= 60) || STEPS.at(-1), minor = step / (step >= 10 ? 5 : 1);
  const o = v.canvasToScreen(0, 0);
  const x0 = Math.floor(-o.x / z / minor) * minor, x1 = (W / dpr - o.x) / z;
  ctx.beginPath();
  for (let d = x0; d <= x1; d += minor) { const sx = Math.round((o.x + d * z) * dpr) + 0.5, major = d % step === 0; ctx.moveTo(sx, R); ctx.lineTo(sx, R - (major ? 9 : 4) * dpr); if (major) ctx.fillText(String(d), sx + 2 * dpr, 2 * dpr); }
  const y0 = Math.floor(-o.y / z / minor) * minor, y1 = (H / dpr - o.y) / z;
  for (let d = y0; d <= y1; d += minor) { const sy = Math.round((o.y + d * z) * dpr) + 0.5, major = d % step === 0; ctx.moveTo(R, sy); ctx.lineTo(R - (major ? 9 : 4) * dpr, sy); if (major) { ctx.save(); ctx.translate(2 * dpr, sy + 2 * dpr); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'top'; ctx.fillText(String(d), -12 * dpr, 0); ctx.restore(); } }
  ctx.stroke();
  ctx.fillStyle = '#242424'; ctx.fillRect(0, 0, R, R);
  ctx.restore();
}
