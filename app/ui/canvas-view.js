import { renderer } from '../core/render.js';
import { state } from '../core/state.js';

export const ZOOM_STOPS = [0.01, 0.02, 0.05, 0.0625, 0.125, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
export const MIN_ZOOM = 0.01, MAX_ZOOM = 64;
const PIXEL_GRID_ZOOM = 8;

// Viewport onto the active document: zoom/pan, drawing, and pointer input. Painting/selection tools plug in
// through `view.toolHandler` (Phase 2+); Hand, Zoom, Eyedropper and temporary panning live here.
export class CanvasView {
  constructor(canvas, viewport) {
    this.canvas = canvas; this.viewport = viewport;
    this.ctx = canvas.getContext('2d');
    this.doc = null;
    this.space = false; this.dragging = null; this.gestureState = null;
    this.pointers = new Map();
    this.toolHandler = null;
    this.onChange = () => {}; this.onPointer = () => {}; this.onPick = () => {};
    this.dirty = true;
    new ResizeObserver(() => this.resize()).observe(viewport);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('pointerleave', () => this.onPointer(null));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.typing(e)) { if (this.doc) e.preventDefault(); this.space = true; this.updateCursor(); }
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { this.space = false; this.updateCursor(); } });
    window.addEventListener('blur', () => { this.space = false; });
    this.pattern = this.makeChecker();
    const loop = () => { if (this.dirty) { this.dirty = false; this.draw(); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  makeChecker() {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
    x.fillStyle = '#cfcfcf'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
    return c;
  }

  setDoc(doc) {
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

  // The only place screen coordinates become document coordinates.
  screenToCanvas(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect(), v = this.doc.view;
    return { x: (clientX - r.left - v.panX) / v.zoom, y: (clientY - r.top - v.panY) / v.zoom };
  }

  // Composa: fit the window without going above 100 %.
  fit() {
    if (!this.doc) return;
    const { w, h } = this.size(), d = this.doc, pad = 48;
    if (w < 10 || h < 10) return;
    const z = Math.min(1, Math.max(MIN_ZOOM, Math.min((w - pad) / d.width, (h - pad) / d.height)));
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
    const v = this.doc.view, z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom)), k = z / v.zoom;
    v.fitted = true;
    this.setView(z, cx - (cx - v.panX) * k, cy - (cy - v.panY) * k);
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

  // ---- input -------------------------------------------------------------
  local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  panMode(e) { return this.space || e.button === 1 || state.tool === 'hand'; }

  down(e) {
    if (!this.doc) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.local(e));
    if (this.pointers.size === 2) { this.startGesture(); return; }
    if (this.pointers.size > 2) return;
    const p = this.local(e);
    if (this.panMode(e)) { this.dragging = { type: 'pan', sx: p.x, sy: p.y, px: this.doc.view.panX, py: this.doc.view.panY }; this.updateCursor(true); return; }
    if (e.button !== 0) return;
    if (state.tool === 'zoom') this.dragging = { type: 'zoom', sx: p.x, sy: p.y, z0: this.zoom, moved: false, alt: e.altKey };
    else if (state.tool === 'eyedropper') { this.dragging = { type: 'pick' }; this.pick(e); }
    else if (this.toolHandler) { this.dragging = { type: 'tool' }; this.toolHandler.down?.(e, this); }
  }
  move(e) {
    if (!this.doc) return;
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    this.onPointer(this.screenToCanvas(e.clientX, e.clientY));
    if (this.pointers.size === 2) { this.gesture(); return; }
    const d = this.dragging; if (!d) return;
    if (d.type === 'pan') this.setView(this.zoom, d.px + p.x - d.sx, d.py + p.y - d.sy);
    else if (d.type === 'zoom') {
      const dx = p.x - d.sx;
      if (Math.abs(dx) > 4) { d.moved = true; this.zoomAt(d.z0 * Math.exp(dx / 200), d.sx, d.sy); }
    } else if (d.type === 'pick') this.pick(e);
    else if (d.type === 'tool') this.toolHandler.move?.(e, this);
  }
  up(e) {
    const d = this.dragging;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gestureState = null;
    if (!d || this.pointers.size > 0) return;
    if (d.type === 'zoom' && !d.moved) this.stepZoom(d.alt || e.altKey ? -1 : 1, this.local(e));
    if (d.type === 'tool') this.toolHandler.up?.(e, this);
    this.dragging = null; this.updateCursor();
  }
  startGesture() {
    const [a, b] = [...this.pointers.values()];
    this.gestureState = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, z: this.zoom, px: this.doc.view.panX, py: this.doc.view.panY };
    if (this.dragging?.type === 'tool') this.toolHandler.cancel?.(this);
    this.dragging = null;
  }
  gesture() {
    const g = this.gestureState; if (!g) return;
    const [a, b] = [...this.pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, g.z * dist / g.dist)), k = z / g.z;
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
  pick(e) {
    const c = this.screenToCanvas(e.clientX, e.clientY), d = this.doc;
    const x = Math.floor(c.x), y = Math.floor(c.y);
    if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
    const px = renderer.render(d).getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
    if (px[3] === 0) return;
    this.onPick('#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join(''), e.altKey);
  }
  updateCursor(grabbing = false) {
    const t = state.tool;
    this.canvas.style.cursor = !this.doc ? 'default' : (this.space || t === 'hand') ? (grabbing ? 'grabbing' : 'grab')
      : t === 'zoom' ? 'zoom-in' : t === 'move' ? 'default' : t === 'text' ? 'text' : 'crosshair';
  }

  // ---- drawing -----------------------------------------------------------
  draw() {
    const { ctx, canvas, doc } = this, dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!doc) return;
    const v = doc.view, z = v.zoom * dpr, ox = v.panX * dpr, oy = v.panY * dpr;
    const dw = doc.width * z, dh = doc.height * z;
    ctx.fillStyle = '#00000066'; ctx.fillRect(ox + 2, oy + 3, dw, dh);
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, dw, dh); ctx.clip();
    ctx.fillStyle = ctx.createPattern(this.pattern, 'repeat'); ctx.fillRect(ox, oy, dw, dh);
    ctx.imageSmoothingEnabled = v.zoom < 1;       // photo smoothing zoomed out, crisp pixels zoomed in
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(z, 0, 0, z, ox, oy);
    ctx.drawImage(renderer.render(doc), 0, 0);
    ctx.restore();
    if (v.zoom >= PIXEL_GRID_ZOOM && state.view.pixelGrid) this.drawPixelGrid(z, ox, oy);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(ox) - 0.5, Math.round(oy) - 0.5, Math.round(dw) + 1, Math.round(dh) + 1);
    this.overlay?.(ctx, v, dpr);
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
}
