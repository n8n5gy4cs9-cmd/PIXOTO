import { renderer } from '../core/render.js';
import { state } from '../core/state.js';
import { outlineSegments } from '../core/mask.js';

export const ZOOM_STOPS = [0.01, 0.02, 0.05, 0.0625, 0.125, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
export const MIN_ZOOM = 0.01, MAX_ZOOM = 64;
const PIXEL_GRID_ZOOM = 8;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Viewport onto the active document: zoom/pan, drawing, and pointer input. Tools are handler objects registered in
// `view.tools[id]` with optional down/move/up/cancel/hover/overlay/key/cursor methods; each receives an event context
// `ev` { e, view, doc, p (document point), screen (css px), press, pressScreen, moved, shift, alt, ctrl, pressure, points }.
export class CanvasView {
  constructor(canvas, viewport) {
    this.canvas = canvas; this.viewport = viewport;
    this.ctx = canvas.getContext('2d');
    this.doc = null;
    this.space = false; this.drag = null; this.gestureState = null; this.lastDown = { t: 0, x: 0, y: 0, n: 0 };
    this.pointers = new Map();
    this.tools = {};
    this.hover = null;                               // pointer position in document space, null when outside
    this.sticky = { shift: false, alt: false, ctrl: false };   // on-screen modifier toggles for touch screens
    this.onChange = () => {}; this.onPointer = () => {}; this.onPick = () => {}; this.onToolState = () => {};
    this.overlays = [];                              // (ctx, view, dpr) => void, drawn in device pixels over the document
    this.dirty = true;
    new ResizeObserver(() => this.resize()).observe(viewport);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.cancelPointer(e));
    canvas.addEventListener('lostpointercapture', (e) => { if (this.drag && this.drag.pointerId === e.pointerId && !this.drag.ended) this.cancelDrag(); });
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.onPointer(null); this.invalidate(); });
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.typing(e)) { if (this.doc) e.preventDefault(); if (!this.space) { this.space = true; this.updateCursor(); } }
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { this.space = false; this.updateCursor(); } this.mods(e); });
    window.addEventListener('keydown', (e) => this.mods(e), true);
    window.addEventListener('blur', () => { this.space = false; });
    this.pattern = this.makeChecker();
    this.antsPhase = 0;
    const loop = (t) => {
      if (this.doc?.selection) { const p = Math.floor(t / 90) % 16; if (p !== this.antsPhase) { this.antsPhase = p; this.dirty = true; } }
      if (this.dirty) { this.dirty = false; this.draw(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Shift/Alt/Ctrl as the keyboard reports them, so overlays that depend on a modifier redraw when it changes mid-drag.
  mods(e) {
    if (this.shiftDown !== e.shiftKey || this.altDown !== e.altKey) { this.shiftDown = e.shiftKey; this.altDown = e.altKey; if (this.drag) this.invalidate(); }
    this.ctrlDown = e.ctrlKey || e.metaKey;
  }
  typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  makeChecker() {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
    x.fillStyle = '#cfcfcf'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
    return c;
  }
  get tool() { return this.tools[state.tool]; }

  setDoc(doc) {
    if (this.drag) this.cancelDrag();
    this.doc = doc;
    this.dirty = true;
    if (doc && !doc.view.fitted) this.fit();
    this.updateCursor();
    this.onChange();
  }
  invalidate() { this.dirty = true; }

  get zoom() { return this.doc ? this.doc.view.zoom : 1; }
  size() { const r = this.viewport.getBoundingClientRect(); return { w: r.width, h: r.height }; }
  resize() {
    const { w, h } = this.size(), dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(w * dpr)); this.canvas.height = Math.max(1, Math.round(h * dpr));
    if (this.doc && !this.doc.view.fitted) this.fit();
    this.dirty = true;
  }

  // The only place screen coordinates become document coordinates. The view may be rotated (View > Rotate View).
  screenToCanvas(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return this.localToDoc(clientX - r.left, clientY - r.top);
  }
  localToDoc(lx, ly) {
    const v = this.doc.view, x = lx - v.panX, y = ly - v.panY, c = Math.cos(v.rot || 0), s = Math.sin(v.rot || 0);
    return { x: (x * c + y * s) / v.zoom, y: (-x * s + y * c) / v.zoom };
  }
  // Document point to css pixels inside the canvas element.
  canvasToScreen(x, y) {
    const v = this.doc.view, c = Math.cos(v.rot || 0), s = Math.sin(v.rot || 0);
    return { x: v.zoom * (x * c - y * s) + v.panX, y: v.zoom * (x * s + y * c) + v.panY };
  }
  get rotated() { return !!this.doc?.view.rot; }

  // Composa: fit the window without going above 100 %.
  fit() {
    if (!this.doc) return;
    const { w, h } = this.size(), d = this.doc, pad = 48;
    if (w < 10 || h < 10) return;
    const z = Math.min(1, Math.max(MIN_ZOOM, Math.min((w - pad) / d.width, (h - pad) / d.height)));
    d.view.rot = 0;
    this.setView(z, (w - d.width * z) / 2, (h - d.height * z) / 2);
    d.view.fitted = true;
  }
  setView(zoom, panX, panY) {
    const v = this.doc.view;
    v.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)); v.panX = panX; v.panY = panY;
    this.dirty = true; this.onChange();
  }
  zoomAt(newZoom, cx, cy) {
    if (!this.doc) return;
    const v = this.doc.view, z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom)), p = this.localToDoc(cx, cy), c = Math.cos(v.rot || 0), s = Math.sin(v.rot || 0);
    v.fitted = true;
    this.setView(z, cx - z * (p.x * c - p.y * s), cy - z * (p.x * s + p.y * c));
  }
  // Turns the view about the centre of the window by `deg` degrees (0 resets).
  rotateView(deg) {
    if (!this.doc) return;
    const v = this.doc.view, ctr = this.centre(), p = this.localToDoc(ctr.x, ctr.y);
    v.rot = deg === 0 ? 0 : (((v.rot || 0) + deg * Math.PI / 180) % (2 * Math.PI));
    if (Math.abs(v.rot) < 1e-9) v.rot = 0;
    const c = Math.cos(v.rot), s = Math.sin(v.rot);
    v.fitted = true;
    this.setView(v.zoom, ctr.x - v.zoom * (p.x * c - p.y * s), ctr.y - v.zoom * (p.x * s + p.y * c));
  }
  centre() { const { w, h } = this.size(); return { x: w / 2, y: h / 2 }; }
  zoomTo(z) { const c = this.centre(); this.zoomAt(z, c.x, c.y); }
  stepZoom(dir, at) {
    const z = this.zoom, c = at || this.centre();
    const next = dir > 0 ? ZOOM_STOPS.find((s) => s > z * 1.001) ?? MAX_ZOOM : [...ZOOM_STOPS].reverse().find((s) => s < z / 1.001) ?? MIN_ZOOM;
    this.zoomAt(next, c.x, c.y);
  }
  zoomIn() { this.stepZoom(1); }
  zoomOut() { this.stepZoom(-1); }
  panBy(dx, dy) { const v = this.doc.view; v.fitted = true; this.setView(v.zoom, v.panX + dx, v.panY + dy); }

  // ---- input -------------------------------------------------------------
  local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  panMode(e) { return this.space || e.button === 1 || state.tool === 'hand'; }

  makeEvent(e) {
    const screen = this.local(e), p = this.screenToCanvas(e.clientX, e.clientY), d = this.drag;
    return {
      e, view: this, doc: this.doc, p, screen, shift: e.shiftKey || this.sticky.shift, alt: e.altKey || this.sticky.alt, ctrl: e.ctrlKey || e.metaKey || this.sticky.ctrl,
      pressure: e.pointerType === 'pen' ? e.pressure : 1, temporary: !!d?.temporary, press: d?.press ?? p, pressScreen: d?.pressScreen ?? screen,
      moved: d ? dist(d.pressScreen, screen) > 2 : false, clickCount: d?.clickCount ?? 1, points: [{ p, pressure: e.pointerType === 'pen' ? e.pressure : 1 }],
    };
  }

  down(e) {
    if (!this.doc) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.local(e));
    if (this.pointers.size === 2) { this.startGesture(); return; }
    if (this.pointers.size > 2 || this.drag) return;
    const screen = this.local(e), p = this.screenToCanvas(e.clientX, e.clientY);
    if (!this.panMode(e) && this.interceptDown?.(e, screen, p)) { this.pointers.delete(e.pointerId); return; }
    const now = performance.now(), last = this.lastDown;
    const n = now - last.t < 400 && dist(last, screen) < 5 ? last.n + 1 : 1;
    this.lastDown = { t: now, x: screen.x, y: screen.y, n };
    this.drag = { pointerId: e.pointerId, button: e.button, press: p, pressScreen: screen, clickCount: n, ended: false, tool: null, pan: null };
    if (this.panMode(e)) { this.drag.pan = { sx: screen.x, sy: screen.y, px: this.doc.view.panX, py: this.doc.view.panY }; this.updateCursor(true); return; }
    if (e.button !== 0) { this.drag = null; return; }
    const ev = this.makeEvent(e);
    const handler = this.pickHandler(ev);
    this.drag.tool = handler;
    handler?.down?.(ev);
    this.invalidate();
  }
  // Ctrl-drag with any tool but Move moves layers (Photoshop's temporary Move), unless the tool uses Ctrl itself.
  pickHandler(ev) {
    const h = this.tool;
    if (ev.ctrl && state.tool !== 'move' && this.tools.move && !h?.usesCtrl?.(ev)) { this.drag.temporary = ev.temporary = true; return this.tools.move; }
    return h;
  }
  move(e) {
    if (!this.doc) return;
    const screen = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, screen);
    this.hover = this.screenToCanvas(e.clientX, e.clientY); this.shiftDown = e.shiftKey; this.altDown = e.altKey;
    this.onPointer(this.hover);
    if (this.pointers.size === 2) { this.gesture(); return; }
    const d = this.drag;
    if (!d) { this.interceptHover?.(e, screen); this.tool?.hover?.(this.makeEvent(e)); this.invalidate(); return; }
    if (d.pointerId !== e.pointerId) return;
    if (d.pan) { this.setView(this.zoom, d.pan.px + screen.x - d.pan.sx, d.pan.py + screen.y - d.pan.sy); return; }
    if (!d.tool?.move) return;
    const ev = this.makeEvent(e);
    const co = e.getCoalescedEvents?.() || [];
    if (co.length > 1) ev.points = co.map((c) => ({ p: this.screenToCanvas(c.clientX, c.clientY), pressure: c.pointerType === 'pen' ? c.pressure : 1 }));
    d.tool.move(ev);
    this.invalidate();
  }
  up(e) {
    const d = this.drag;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gestureState = null;
    if (!d || d.pointerId !== e.pointerId) return;
    d.ended = true; this.drag = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch {}
    if (d.tool?.up) d.tool.up({ ...this.endEvent(e, d) });
    this.updateCursor(); this.invalidate();
  }
  endEvent(e, d) { this.drag = d; const ev = this.makeEvent(e); this.drag = null; return ev; }
  cancelPointer(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gestureState = null;
    if (this.drag?.pointerId === e.pointerId) this.cancelDrag();
  }
  cancelDrag() {
    const d = this.drag; if (!d) return;
    d.ended = true; this.drag = null;
    d.tool?.cancel?.(this);
    this.updateCursor(); this.invalidate();
  }
  startGesture() {
    const [a, b] = [...this.pointers.values()];
    this.gestureState = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, z: this.zoom, px: this.doc.view.panX, py: this.doc.view.panY };
    if (this.drag) { this.drag.tool?.cancel?.(this); this.drag.ended = true; this.drag = null; }
  }
  gesture() {
    const g = this.gestureState; if (!g) return;
    const [a, b] = [...this.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, g.z * d / g.dist)), k = z / g.z;
    this.doc.view.fitted = true;
    this.setView(z, mid.x - (g.mid.x - g.px) * k, mid.y - (g.mid.y - g.py) * k);
  }
  wheel(e) {
    if (!this.doc) return;
    e.preventDefault();
    const p = this.local(e), v = this.doc.view;
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || e.altKey || e.metaKey) this.zoomAt(this.zoom * Math.exp(-e.deltaY * scale * (e.ctrlKey && !e.altKey ? 0.01 : 0.0025)), p.x, p.y);
    else { v.fitted = true; this.setView(this.zoom, v.panX - (e.shiftKey ? e.deltaY : e.deltaX) * scale, v.panY - (e.shiftKey ? 0 : e.deltaY) * scale); }
  }
  // Tool keys that depend on what the canvas is doing. Returns true when the key was used.
  handleKey(e) {
    if (!this.doc) return false;
    if (this.drag && e.key === 'Escape') { this.cancelDrag(); return true; }
    return !!this.tool?.key?.(e, this);
  }
  isDragging() { return !!this.drag && !this.drag.pan; }

  updateCursor(grabbing = false) {
    const t = state.tool, h = this.tools[t];
    let c = 'crosshair';
    if (!this.doc) c = 'default';
    else if (this.space || t === 'hand') c = grabbing ? 'grabbing' : 'grab';
    else if (h?.cursor) c = h.cursor(this);
    this.canvas.style.cursor = c;
  }

  // ---- drawing -----------------------------------------------------------
  draw() {
    const { ctx, canvas, doc } = this, dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!doc) return;
    const v = doc.view, z = v.zoom * dpr, ox = v.panX * dpr, oy = v.panY * dpr, rot = v.rot || 0, c = Math.cos(rot), s = Math.sin(rot);
    const T = [z * c, z * s, -z * s, z * c, ox, oy], dw = doc.width * z, dh = doc.height * z;
    ctx.setTransform(...T);
    ctx.fillStyle = '#00000066'; ctx.fillRect(2 / z, 3 / z, doc.width, doc.height);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, doc.width, doc.height); ctx.clip();
    const pat = ctx.createPattern(this.pattern, 'repeat');
    if (pat.setTransform) pat.setTransform(new DOMMatrix([1 / z, 0, 0, 1 / z, 0, 0]));   // the checkerboard keeps its screen size at any zoom
    ctx.fillStyle = pat; ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.imageSmoothingEnabled = v.zoom < 1;       // photo smoothing zoomed out, crisp pixels zoomed in
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(renderer.render(doc), 0, 0);
    ctx.restore();
    if (!rot && v.zoom >= PIXEL_GRID_ZOOM && state.view.pixelGrid) this.drawPixelGrid(z, ox, oy);
    ctx.save(); ctx.setTransform(...T); ctx.strokeStyle = '#000'; ctx.lineWidth = 1 / z * dpr; ctx.strokeRect(0, 0, doc.width, doc.height); ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (doc.selection) this.drawAnts(doc.selection, T);
    for (const o of this.overlays) o(ctx, this, dpr);
    this.tool?.overlay?.(ctx, this, dpr);
  }
  drawPixelGrid(z, ox, oy) {
    const { ctx, canvas, doc } = this;
    const x0 = Math.max(0, Math.floor(-ox / z)), x1 = Math.min(doc.width, Math.ceil((canvas.width - ox) / z));
    const y0 = Math.max(0, Math.floor(-oy / z)), y1 = Math.min(doc.height, Math.ceil((canvas.height - oy) / z));
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) { const px = Math.round(ox + x * z) + 0.5; ctx.moveTo(px, Math.max(0, oy + y0 * z)); ctx.lineTo(px, Math.min(canvas.height, oy + y1 * z)); }
    for (let y = y0; y <= y1; y++) { const py = Math.round(oy + y * z) + 0.5; ctx.moveTo(Math.max(0, ox + x0 * z), py); ctx.lineTo(Math.min(canvas.width, ox + x1 * z), py); }
    ctx.strokeStyle = 'rgba(128,128,128,.45)'; ctx.lineWidth = 1; ctx.stroke();
  }
  // Marching ants along the selection's outline, traced at one screen pixel per block of pixels when zoomed out.
  drawAnts(mask, T) {
    const { ctx } = this, zoom = this.zoom, z = Math.hypot(T[0], T[1]), block = zoom < 1 ? Math.min(64, Math.ceil(1 / zoom)) : 1;
    let c = this.antsCache;
    if (!c || c.mask !== mask || c.version !== mask.version || c.block !== block) {
      const segs = outlineSegments(mask, block), path = new Path2D();
      for (let i = 0; i < segs.length; i += 4) { path.moveTo(segs[i], segs[i + 1]); path.lineTo(segs[i + 2], segs[i + 3]); }
      c = this.antsCache = { mask, version: mask.version, block, path };
    }
    ctx.save();
    ctx.setTransform(...T);
    const px = 1 / z;
    ctx.lineWidth = px; ctx.setLineDash([]); ctx.strokeStyle = '#fff'; ctx.stroke(c.path);
    ctx.setLineDash([4 * px, 4 * px]); ctx.lineDashOffset = -this.antsPhase / 2 * px; ctx.strokeStyle = '#000'; ctx.stroke(c.path);
    ctx.restore();
  }
}
