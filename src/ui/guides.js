/* ═══════════════════════════════════════════════════════════════
   Pixoto — Rulers & Guides (P9)
   Renders the top/left rulers (screen-space, document coordinates) and
   draggable guides. Guides live on a document-space canvas inside the
   wrapper, so they pan/zoom/rotate with the artwork automatically.

   Drag from a ruler to create a guide; double-click a ruler near a
   guide to delete it. Guide positions feed engine.snapPoint().

   PixiEditor reference: SnappingOverlay.cs, SnappingController.cs
   ═══════════════════════════════════════════════════════════════ */

const NICE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

export class RulerGuides {
    /**
     * @param {object} opts
     * @param {import('../canvas-engine.js').CanvasEngine} opts.engine
     * @param {HTMLCanvasElement} opts.rulerH
     * @param {HTMLCanvasElement} opts.rulerV
     * @param {HTMLCanvasElement} opts.guidesCanvas
     * @param {() => boolean} opts.isVisible - rulers currently shown?
     */
    constructor(opts) {
        this.engine = opts.engine;
        this.rulerH = opts.rulerH;
        this.rulerV = opts.rulerV;
        this.guidesCanvas = opts.guidesCanvas;
        this.isVisible = opts.isVisible || (() => false);

        this._preview = null; // { orientation:'h'|'v', pos:number } while dragging

        this._attachRulerDrag(this.rulerH, 'h');
        this._attachRulerDrag(this.rulerV, 'v');
    }

    // ─── Public ───────────────────────────────────────────────────
    redraw() {
        this.drawRulers();
        this.drawGuides();
    }

    // ─── Rulers ───────────────────────────────────────────────────
    drawRulers() {
        const visible = this.isVisible() && !this.engine.viewRotation;
        this._drawRuler(this.rulerH, 'h', visible);
        this._drawRuler(this.rulerV, 'v', visible);
    }

    _niceStep() {
        const zoom = this.engine.zoom;
        for (const s of NICE_STEPS) { if (s * zoom >= 60) return s; }
        return NICE_STEPS[NICE_STEPS.length - 1];
    }

    _drawRuler(canvas, axis, visible) {
        if (!canvas) return;
        const dpr = this.engine.dpr || 1;
        const rect = canvas.getBoundingClientRect();
        const cw = Math.max(1, Math.round(rect.width));
        const ch = Math.max(1, Math.round(rect.height));
        if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
            canvas.width = cw * dpr; canvas.height = ch * dpr;
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        if (!visible) return;

        ctx.fillStyle = 'rgba(160,170,190,0.9)';
        ctx.strokeStyle = 'rgba(160,170,190,0.6)';
        ctx.font = '9px monospace';
        ctx.lineWidth = 1;

        const step = this._niceStep();
        const docMax = (axis === 'h') ? this.engine.docWidth : this.engine.docHeight;
        // Extend a bit past the document so ticks cover the whole ruler
        const extra = Math.ceil((axis === 'h' ? cw : ch) / (step * this.engine.zoom)) * step;
        for (let d = 0; d <= docMax + extra; d += step) {
            const scr = this.engine.canvasToScreen(axis === 'h' ? d : 0, axis === 'h' ? 0 : d);
            const local = (axis === 'h') ? scr.x - rect.left : scr.y - rect.top;
            if (local < -20 || local > (axis === 'h' ? cw : ch) + 20) continue;
            ctx.beginPath();
            if (axis === 'h') {
                ctx.moveTo(local + 0.5, ch);
                ctx.lineTo(local + 0.5, ch - 8);
                ctx.stroke();
                ctx.fillText(String(d), local + 2, 9);
            } else {
                ctx.moveTo(cw, local + 0.5);
                ctx.lineTo(cw - 8, local + 0.5);
                ctx.stroke();
                ctx.save();
                ctx.translate(8, local - 2);
                ctx.rotate(-Math.PI / 2);
                ctx.fillText(String(d), 0, 0);
                ctx.restore();
            }
        }
    }

    // ─── Guides ───────────────────────────────────────────────────
    drawGuides() {
        const c = this.guidesCanvas;
        if (!c) return;
        const w = this.engine.docWidth, h = this.engine.docHeight;
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        const lw = 1 / this.engine.zoom;
        const draw = (orientation, pos, color) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = lw;
            ctx.beginPath();
            if (orientation === 'v') { ctx.moveTo(pos, 0); ctx.lineTo(pos, h); }
            else { ctx.moveTo(0, pos); ctx.lineTo(w, pos); }
            ctx.stroke();
        };

        for (const x of this.engine.guides.v) draw('v', x, '#00e5ff');
        for (const y of this.engine.guides.h) draw('h', y, '#00e5ff');
        if (this._preview) draw(this._preview.orientation, this._preview.pos, 'rgba(0,229,255,0.5)');
    }

    // ─── Interaction ──────────────────────────────────────────────
    _attachRulerDrag(ruler, axis) {
        if (!ruler) return;
        // top ruler (h) → horizontal guide (constant y); left ruler (v) → vertical guide
        const guideOrientation = (axis === 'h') ? 'h' : 'v';

        ruler.style.pointerEvents = 'auto';
        ruler.style.cursor = (axis === 'h') ? 'ns-resize' : 'ew-resize';

        ruler.addEventListener('pointerdown', (e) => {
            if (this.engine.viewRotation) return; // creating guides only at 0°
            e.preventDefault();
            ruler.setPointerCapture?.(e.pointerId);
            const move = (me) => {
                const p = this.engine.screenToCanvas(me.clientX, me.clientY);
                this._preview = { orientation: guideOrientation, pos: guideOrientation === 'h' ? p.y : p.x };
                this.drawGuides();
            };
            const up = (ue) => {
                ruler.removeEventListener('pointermove', move);
                ruler.removeEventListener('pointerup', up);
                const p = this.engine.screenToCanvas(ue.clientX, ue.clientY);
                const pos = guideOrientation === 'h' ? p.y : p.x;
                const max = guideOrientation === 'h' ? this.engine.docHeight : this.engine.docWidth;
                // Only commit if dropped within the document bounds
                if (pos >= 0 && pos <= max) this.engine.addGuide(guideOrientation, Math.round(pos));
                this._preview = null;
                this.drawGuides();
            };
            ruler.addEventListener('pointermove', move);
            ruler.addEventListener('pointerup', up);
        });

        // Double-click near a guide deletes it
        ruler.addEventListener('dblclick', (e) => {
            const p = this.engine.screenToCanvas(e.clientX, e.clientY);
            const list = (guideOrientation === 'h') ? this.engine.guides.h : this.engine.guides.v;
            const target = (guideOrientation === 'h') ? p.y : p.x;
            const thr = 8 / this.engine.zoom;
            let best = -1, bestD = thr;
            for (let i = 0; i < list.length; i++) {
                const d = Math.abs(list[i] - target);
                if (d <= bestD) { bestD = d; best = i; }
            }
            if (best >= 0) { list.splice(best, 1); this.drawGuides(); }
        });
    }
}
