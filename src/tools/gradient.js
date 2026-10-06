/* ═══════════════════════════════════════════════════════════════
   Pixoto — Gradient Tool (Phase D / P2)
   Linear / radial / angular / reflected multi-stop gradients.
   Respects the active selection and a tool opacity / blend mode.
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';
import { hexToRgb, rgbToHex } from '../ui/color-utils.js';


/** Build a docW×docH mask canvas (white where selected) for destination-in clipping. */
function _selectionMaskCanvas(sm, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const mask = sm.mask;
    const len = Math.min(mask.length, w * h);
    for (let i = 0; i < len; i++) {
        const di = i * 4;
        img.data[di] = img.data[di + 1] = img.data[di + 2] = 255;
        img.data[di + 3] = mask[i];
    }
    ctx.putImageData(img, 0, 0);
    return c;
}

/** Interpolate the gradient stop colour at position p (0–1). */
export function sampleStops(stops, p) {
    if (!stops.length) return '#00000000';
    if (p <= stops[0].pos) return stops[0].color;
    if (p >= stops[stops.length - 1].pos) return stops[stops.length - 1].color;
    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i], b = stops[i + 1];
        if (p >= a.pos && p <= b.pos) {
            const t = (b.pos - a.pos) < 1e-9 ? 0 : (p - a.pos) / (b.pos - a.pos);
            const ca = hexToRgb(a.color) || { r: 0, g: 0, b: 0, a: 255 };
            const cb = hexToRgb(b.color) || { r: 0, g: 0, b: 0, a: 255 };
            return rgbToHex(
                Math.round(ca.r + (cb.r - ca.r) * t),
                Math.round(ca.g + (cb.g - ca.g) * t),
                Math.round(ca.b + (cb.b - ca.b) * t),
                Math.round(ca.a + (cb.a - ca.a) * t)
            );
        }
    }
    return stops[stops.length - 1].color;
}


export class GradientTool extends Tool {
    constructor(manager) {
        super('gradient', manager);

        this.gradientType = 'linear'; // linear | radial | angular | reflected
        this.opacity = 1;             // 0–1
        this.blendMode = 'source-over';

        /** @type {{pos:number,color:string}[]} sorted by pos ascending */
        this.stops = [
            { pos: 0, color: '#000000ff' },
            { pos: 1, color: '#ffffffff' },
        ];

        this._startX = 0; this._startY = 0;
        this._curX = 0; this._curY = 0;
        this._drawing = false;

        this.onBeforeStroke = null;  // history hook
        this.onStopsChange = null;   // editor refresh hook
    }

    getCursor() { return 'crosshair'; }
    activate() {}
    deactivate() { this._drawing = false; this._clearUI(); }

    _sm() {
        return this.manager.selectionManager || (window.Pixoto && window.Pixoto.selectionManager);
    }

    _clearUI() {
        const e = this.manager.engine;
        if (e?.uiCtx) e.uiCtx.clearRect(0, 0, e.docWidth, e.docHeight);
    }

    /** Set first/last stop colours from the current fg/bg. */
    syncEndpointsFromColors() {
        if (this.stops.length >= 2) {
            this.stops[0].color = this.manager.foregroundColor;
            this.stops[this.stops.length - 1].color = this.manager.backgroundColor;
        }
        if (this.onStopsChange) this.onStopsChange();
    }


    // ── Pointer events ──────────────────────────────────────────

    onPointerDown(cx, cy, e) {
        this._startX = cx; this._startY = cy;
        this._curX = cx; this._curY = cy;
        this._drawing = true;
        const sm = this._sm();
        if (sm && sm._stopAnts) sm._stopAnts();
    }

    onPointerMove(cx, cy, e) {
        if (!this._drawing) return;
        // Shift = constrain to 45°
        if (e.shiftKey) {
            const ang = Math.atan2(cy - this._startY, cx - this._startX);
            const step = Math.PI / 4;
            const snapped = Math.round(ang / step) * step;
            const len = Math.hypot(cx - this._startX, cy - this._startY);
            cx = this._startX + Math.cos(snapped) * len;
            cy = this._startY + Math.sin(snapped) * len;
        }
        this._curX = cx; this._curY = cy;
        this._drawPreview();
    }

    onPointerUp(cx, cy, e) {
        if (!this._drawing) return;
        this._drawing = false;
        if (e.shiftKey) {
            const ang = Math.atan2(cy - this._startY, cx - this._startX);
            const step = Math.PI / 4;
            const snapped = Math.round(ang / step) * step;
            const len = Math.hypot(cx - this._startX, cy - this._startY);
            cx = this._startX + Math.cos(snapped) * len;
            cy = this._startY + Math.sin(snapped) * len;
        }
        this._curX = cx; this._curY = cy;
        this._clearUI();

        const layer = this.manager.engine.getActiveLayer();
        if (Math.hypot(cx - this._startX, cy - this._startY) >= 1 && layer && !layer.locked) {
            if (this.onBeforeStroke) this.onBeforeStroke();
            this._commit(this._startX, this._startY, cx, cy);
        }

        const sm = this._sm();
        if (sm && sm.hasSelection && sm._startAnts) sm._startAnts();
    }


    // ── Gradient construction ───────────────────────────────────

    _buildGradient(ctx, x0, y0, x1, y1) {
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const stops = [...this.stops].sort((a, b) => a.pos - b.pos);
        const clamp01 = (v) => Math.max(0, Math.min(1, v));

        if (this.gradientType === 'radial') {
            const g = ctx.createRadialGradient(x0, y0, 0, x0, y0, len);
            for (const s of stops) g.addColorStop(clamp01(s.pos), s.color);
            return g;
        }
        if (this.gradientType === 'angular' && ctx.createConicGradient) {
            const g = ctx.createConicGradient(Math.atan2(dy, dx), x0, y0);
            for (const s of stops) g.addColorStop(clamp01(s.pos), s.color);
            return g;
        }
        if (this.gradientType === 'reflected') {
            // Mirror around the start point across the drag direction.
            const g = ctx.createLinearGradient(x0 - dx, y0 - dy, x1, y1);
            const N = 32;
            for (let i = 0; i <= N; i++) {
                const t = i / N;
                g.addColorStop(t, sampleStops(stops, Math.abs(2 * t - 1)));
            }
            return g;
        }
        // linear (and angular fallback)
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        for (const s of stops) g.addColorStop(clamp01(s.pos), s.color);
        return g;
    }


    // ── Preview ─────────────────────────────────────────────────

    _drawPreview() {
        const engine = this.manager.engine;
        const ctx = engine.uiCtx;
        if (!ctx) return;
        const w = engine.docWidth, h = engine.docHeight;
        ctx.clearRect(0, 0, w, h);

        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.fillStyle = this._buildGradient(ctx, this._startX, this._startY, this._curX, this._curY);
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        // Direction line + endpoints
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.moveTo(this._startX, this._startY);
        ctx.lineTo(this._curX, this._curY);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [px, py] of [[this._startX, this._startY], [this._curX, this._curY]]) {
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.stroke();
        }
        ctx.restore();
    }


    // ── Commit ──────────────────────────────────────────────────

    _commit(x0, y0, x1, y1) {
        const engine = this.manager.engine;
        const layer = engine.getActiveLayer();
        if (!layer || layer.locked) return;
        const w = engine.docWidth, h = engine.docHeight;

        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const tctx = tmp.getContext('2d');
        tctx.fillStyle = this._buildGradient(tctx, x0, y0, x1, y1);
        tctx.fillRect(0, 0, w, h);

        const sm = this._sm();
        if (sm && sm.hasSelection) {
            const mc = _selectionMaskCanvas(sm, w, h);
            tctx.globalCompositeOperation = 'destination-in';
            tctx.drawImage(mc, 0, 0);
            tctx.globalCompositeOperation = 'source-over';
        }

        const lc = layer.ctx;
        lc.save();
        lc.globalAlpha = this.opacity;
        lc.globalCompositeOperation = this.blendMode || 'source-over';
        lc.drawImage(tmp, 0, 0);
        lc.restore();

        layer.markAllDirty();
        engine.requestComposite();
    }
}
