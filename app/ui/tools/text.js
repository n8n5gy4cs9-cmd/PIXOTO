// Type tool (Composa CanvasView.Text): click for point text, drag a box for paragraph text, click text to edit it. Typing
// goes through a hidden textarea so IMEs, dead keys and phone keyboards work; editing keys are handled here.
import { state } from '../../core/state.js';
import { textSession, textLayerAt } from '../../core/ops/live.js';
import { PADDING } from '../../core/text/layout.js';
import { MIN_BOX } from '../../core/text/style.js';
import { hitFrame, drawFrame } from './move.js';
import { dragRect } from './selection.js';
import * as G from '../../core/geom.js';
import { rectPath } from './common.js';

const CURSORS = { tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize' };

export class TextTool {
  constructor(app) {
    this.app = app; this.mode = null; this.caretOn = true; this.hoverCursor = 'text';
    this.input = document.createElement('textarea');
    Object.assign(this.input.style, { position: 'fixed', left: '-1000px', top: '0', width: '10px', height: '10px', opacity: '0' });
    this.input.setAttribute('aria-label', 'Text input'); this.input.autocapitalize = 'off'; this.input.spellcheck = false;
    document.body.append(this.input);
    this.input.addEventListener('input', () => this.onInput());
    this.input.addEventListener('compositionend', () => this.onInput());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('copy', (e) => this.clip(e, false));
    this.input.addEventListener('cut', (e) => this.clip(e, true));
    this.input.addEventListener('paste', (e) => { e.preventDefault(); const t = e.clipboardData.getData('text/plain'); if (t && textSession.editor) textSession.editor.insert(t); });
    textSession.onChange = () => { this.sync(); app.onTextChange?.(); };
    setInterval(() => { if (textSession.active) { this.caretOn = !this.caretOn; app.view.invalidate(); } }, 530);
  }
  get editor() { return textSession.editor; }
  cursor() { return this.hoverCursor; }
  sync() {
    if (textSession.active) { this.caretOn = true; if (document.activeElement !== this.input) this.input.focus({ preventScroll: true }); }
    else if (document.activeElement === this.input) this.input.blur();
    this.app.view.invalidate();
  }
  onInput() {
    if (this.input.value === '') return;
    const v = this.input.value.replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
    this.input.value = '';
    if (v && this.editor) this.editor.insert(v);
  }
  clip(e, cut) {
    const ed = this.editor; if (!ed) return;
    e.preventDefault();
    if (!ed.hasSelection) return;
    e.clipboardData.setData('text/plain', ed.selectedText);
    if (cut) ed.insert('');
  }
  onKey(e) {
    const ed = this.editor, doc = this.app.doc; if (!ed) return;
    const shift = e.shiftKey, ctrl = e.ctrlKey || e.metaKey, alt = e.altKey, step = shift ? 10 : 1;
    const used = () => { e.preventDefault(); e.stopPropagation(); return true; };
    if (e.isComposing) return;
    switch (e.key) {
      case 'Escape': if (this.mode) { this.mode = null; return used(); } textSession.cancel(); return used();
      case 'Enter': if (ctrl) { textSession.finish(); return used(); } ed.insert('\n'); return used();
      case 'Tab': ed.insert('\t'); return used();
      case 'Backspace': ed.backspace(ctrl); return used();
      case 'Delete': ed.delete(ctrl); return used();
      case 'ArrowLeft': if (alt) textSession.changeStyle(doc, (s) => ({ ...s, tracking: s.tracking - step })); else ed.moveHorizontal(-1, shift, ctrl); return used();
      case 'ArrowRight': if (alt) textSession.changeStyle(doc, (s) => ({ ...s, tracking: s.tracking + step })); else ed.moveHorizontal(1, shift, ctrl); return used();
      case 'ArrowUp': if (alt) textSession.changeStyle(doc, (s) => ({ ...s, leading: Math.max(1, (s.leading > 0 ? s.leading : s.size * 1.2) - step) })); else ed.moveVertical(-1, shift); return used();
      case 'ArrowDown': if (alt) textSession.changeStyle(doc, (s) => ({ ...s, leading: (s.leading > 0 ? s.leading : s.size * 1.2) + step })); else ed.moveVertical(1, shift); return used();
      case 'Home': if (ctrl) ed.moveToDocumentEdge(false, shift); else ed.moveToLineEdge(false, shift); return used();
      case 'End': if (ctrl) ed.moveToDocumentEdge(true, shift); else ed.moveToLineEdge(true, shift); return used();
    }
    if (ctrl) {
      const k = e.key.toLowerCase();
      if (k === 'a') { ed.selectAll(); return used(); }
      if (k === 'z') { if (shift) ed.redo(); else ed.undo(); return used(); }
      if (k === 'y') { ed.redo(); return used(); }
      if (k === 'c' || k === 'x' || k === 'v') return;          // handled by the clipboard events
      return used();
    }
  }

  // ---- pointer ----------------------------------------------------------------------------------
  local(layer, p) { const inv = G.invert(layer.matrix); return inv ? G.mapPoint(inv, p.x, p.y) : p; }
  inside(layer, p) { const q = this.local(layer, p); return q.x >= 0 && q.y >= 0 && q.x <= layer.canvas.width && q.y <= layer.canvas.height; }
  down(ev) {
    const { doc, view, p, screen, shift } = ev, ts = textSession, ed = ts.editor;
    if (ed) {
      const layer = ts.layer, h = hitFrame(view, layer.corners, screen, false);
      if (h !== 'none' && h !== 'move') {
        this.handle = h; this.mode = 'resize';
        const lay = ed.layout;
        this.boxStart = { w: ed.style.boxWidth ?? lay.width, h: ed.style.boxHeight ?? lay.height }; this.tStart = layer.transform;
        return;
      }
      if (this.inside(layer, p)) { const q = this.local(layer, p); if (ev.clickCount >= 2) ed.selectWordAt(ed.layout.indexAt(q)); else ed.clickAt(q, shift); this.mode = 'select'; return; }
      ts.finish();
    }
    const hit = textLayerAt(doc, p), opened = hit && ts.edit(doc, hit);
    if (opened) { opened.clickAt(this.local(hit, p), shift); this.mode = 'select'; this.sync(); return; }
    this.mode = 'box';
  }
  move(ev) {
    const ts = textSession, ed = ts.editor;
    if (this.mode === 'select' && ed) ed.moveTo(ed.layout.indexAt(this.local(ts.layer, ev.p)), true);
    else if (this.mode === 'resize' && ed) this.dragBox(ev);
  }
  // Drags one edge or corner of the box; the opposite edge stays where it is.
  dragBox(ev) {
    const start = this.tStart, h = this.handle, c = { x: start.x + start.width / 2, y: start.y + start.height / 2 }, un = G.rotate(-start.rotation, c.x, c.y);
    const from = G.mapPoint(un, ev.press.x, ev.press.y), to = G.mapPoint(un, ev.p.x, ev.p.y);
    const sx = start.width / this.boxStart.w, sy = start.height / this.boxStart.h;
    let dx = (to.x - from.x) / Math.max(1e-6, sx), dy = (to.y - from.y) / Math.max(1e-6, sy);
    if (start.flipH) dx = -dx; if (start.flipV) dy = -dy;
    const mL = ['tl', 'l', 'bl'].includes(h), mR = ['tr', 'r', 'br'].includes(h), mT = ['tl', 't', 'tr'].includes(h), mB = ['bl', 'b', 'br'].includes(h);
    textSession.setBox(Math.max(MIN_BOX, this.boxStart.w + (mR ? dx : mL ? -dx : 0)), Math.max(MIN_BOX, this.boxStart.h + (mB ? dy : mT ? -dy : 0)), mL ? 1 : 0, mT ? 1 : 0);
  }
  up(ev) {
    const m = this.mode; this.mode = null;
    if (m !== 'box') return;
    const { doc } = ev;
    if (ev.moved) textSession.beginBox(doc, dragRect(ev.press, ev.p, false, false), state.fg);
    else textSession.beginPoint(doc, ev.press, state.fg);
    this.sync();
  }
  cancel() { this.mode = null; }
  hover(ev) {
    let c = 'text';
    const ts = textSession;
    if (ts.editor) { const h = hitFrame(ev.view, ts.layer.corners, ev.screen, false); if (CURSORS[h]) c = CURSORS[h]; }
    if (c !== this.hoverCursor) { this.hoverCursor = c; ev.view.canvas.style.cursor = c; }
  }
  // Double-click with the Move tool opens live text under the pointer.
  editAt(ev) {
    const hit = textLayerAt(ev.doc, ev.p), ed = hit && textSession.edit(ev.doc, hit);
    if (!ed) return false;
    ed.clickAt(this.local(hit, ev.p), ev.shift); this.app.selectTool('text'); this.sync();
    return true;
  }
  deactivate() { textSession.finish(); }
  overlay(ctx, view, dpr) {
    const ts = textSession, ed = ts.editor;
    if (this.mode === 'box' && view.drag) {
      ctx.save(); ctx.strokeStyle = '#3d9bff'; ctx.lineWidth = dpr; ctx.beginPath(); rectPath(ctx, view, dpr, dragRect(view.drag.press, view.hover || view.drag.press, false, false)); ctx.stroke(); ctx.restore();
    }
    if (!ed || !ts.layer?.canvas) return;
    const layer = ts.layer, lay = ed.layout, m = layer.matrix, tp = (x, y) => { const q = G.mapPoint(m, x, y), s = view.canvasToScreen(q.x, q.y); return { x: s.x * dpr, y: s.y * dpr }; };
    drawFrame(ctx, view, dpr, layer.corners, true);
    ctx.save();
    if (ed.hasSelection) {
      ctx.fillStyle = 'rgba(61,155,255,.35)';
      for (const r of lay.selectionRects(ed.selectionStart, ed.selectionEnd)) { const p0 = tp(r.x, r.y), p1 = tp(r.x + r.w, r.y), p2 = tp(r.x + r.w, r.y + r.h), p3 = tp(r.x, r.y + r.h); ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.fill(); }
    } else if (this.caretOn) {
      const c = lay.caretAt(ed.caret);
      if (!(lay.style.boxWidth != null && c.top > lay.height - PADDING)) { const a = tp(c.x, c.top), b = tp(c.x, c.bottom); ctx.strokeStyle = '#000'; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = dpr * 0.8; ctx.stroke(); }
    }
    if (lay.overflows) { const p = layer.corners[2], s = view.canvasToScreen(p.x, p.y); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.moveTo(s.x * dpr - 2.5 * dpr, s.y * dpr); ctx.lineTo(s.x * dpr + 2.5 * dpr, s.y * dpr); ctx.moveTo(s.x * dpr, s.y * dpr - 2.5 * dpr); ctx.lineTo(s.x * dpr, s.y * dpr + 2.5 * dpr); ctx.stroke(); }
    ctx.restore();
  }
}
