/* ═══════════════════════════════════════════════════════════════
   Pixoto — Eraser Tool (Phase 4)
   Soft mode: destination-out composite with brush stamp.
   Pixel mode: integer-snapped clearRect via PixelEngine.eraseLine.
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';


export class EraserTool extends Tool {
    constructor(manager) {
        super('eraser', manager);

        // ── Stroke state ──
        this._lastX = 0;
        this._lastY = 0;
        this._strokeActive = false;

        // ── Soft eraser stamp cache ──
        this._stampCanvas = null;
        this._stampSize = -1;
        this._stampHardness = -1;
        this._stampOpacity = -1;

        // ── Spacing ──
        this._distAccum = 0;
    }

    activate() {
        this._stampSize = -1; // Invalidate cache
    }

    deactivate() {
        this._strokeActive = false;
    }

    getCursor() {
        return 'crosshair';
    }


    // ═════════════════════════════════════════════════════════
    // Pointer Events
    // ═════════════════════════════════════════════════════════

    onPointerDown(cx, cy, e) {
        this._strokeActive = true;
        const mode = this.manager.brushMode;

        if (mode === 'pixel') {
            this._pixelDown(cx, cy, e);
        } else {
            this._softDown(cx, cy, e);
        }
    }

    onPointerMove(cx, cy, e) {
        if (!this._strokeActive) return;
        const mode = this.manager.brushMode;

        if (mode === 'pixel') {
            this._pixelMove(cx, cy, e);
        } else {
            this._softMove(cx, cy, e);
        }
    }

    onPointerUp(cx, cy, e) {
        if (!this._strokeActive) return;
        this._strokeActive = false;
        this.manager.engine.requestComposite();
    }


    // ═════════════════════════════════════════════════════════
    // PIXEL ERASER — Integer-snapped clearRect
    // ═════════════════════════════════════════════════════════

    /** @private */
    _pixelDown(cx, cy, e) {
        const x = Math.floor(cx);
        const y = Math.floor(cy);
        const size = this._getPixelSize();

        this.manager.pixelEngine.eraseLine(x, y, x, y, size);
        this.manager.engine.requestComposite();

        this._lastX = x;
        this._lastY = y;
    }

    /** @private */
    _pixelMove(cx, cy, e) {
        const x = Math.floor(cx);
        const y = Math.floor(cy);

        if (x === this._lastX && y === this._lastY) return;

        const size = this._getPixelSize();
        this.manager.pixelEngine.eraseLine(this._lastX, this._lastY, x, y, size);
        this.manager.engine.requestComposite();

        this._lastX = x;
        this._lastY = y;
    }

    /** @private */
    _getPixelSize() {
        const raw = this.manager.brushSize;
        const sizes = [1, 2, 4, 8, 16];
        let best = 1;
        for (const s of sizes) {
            if (raw >= s) best = s;
        }
        return best;
    }


    // ═════════════════════════════════════════════════════════
    // SOFT ERASER — destination-out with radial stamp
    // ═════════════════════════════════════════════════════════

    /** @private */
    _softDown(cx, cy, e) {
        this._lastX = cx;
        this._lastY = cy;
        this._distAccum = 0;

        this._eraseStampAt(cx, cy);
        this.manager.engine.requestComposite();
    }

    /** @private */
    _softMove(cx, cy, e) {
        const dx = cx - this._lastX;
        const dy = cy - this._lastY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.5) return;

        const size = this.manager.brushSize;
        const spacing = Math.max(1, size * 0.15);

        this._distAccum += dist;

        while (this._distAccum >= spacing) {
            this._distAccum -= spacing;
            const t = 1 - (this._distAccum / dist);
            const ix = this._lastX + dx * t;
            const iy = this._lastY + dy * t;

            this._eraseStampAt(ix, iy);
        }

        this.manager.engine.requestComposite();

        this._lastX = cx;
        this._lastY = cy;
    }

    /**
     * Place an eraser stamp using destination-out.
     * @private
     */
    _eraseStampAt(cx, cy) {
        const layer = this.manager.engine.getActiveLayer();
        if (!layer || layer.locked) return;

        const size = this.manager.brushSize;
        const opacity = this.manager.brushOpacity / 100;
        const hardness = this.manager.brushHardness / 100;

        const stamp = this._getEraseStamp(Math.ceil(size), hardness, opacity);
        const ctx = layer.ctx;
        const half = stamp.width / 2;
        const sx = cx - half;
        const sy = cy - half;

        // Save composite mode, switch to destination-out, restore
        const prevComp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(stamp, sx, sy);
        ctx.globalCompositeOperation = prevComp;

        layer.markDirty(
            Math.floor(sx), Math.floor(sy),
            stamp.width + 1, stamp.height + 1
        );
    }

    /**
     * Build eraser stamp (white radial gradient — used with destination-out).
     * @private
     */
    _getEraseStamp(size, hardness, opacity) {
        if (
            this._stampCanvas &&
            this._stampSize === size &&
            this._stampHardness === hardness &&
            this._stampOpacity === opacity
        ) {
            return this._stampCanvas;
        }

        const diam = Math.max(2, size);
        let canvas;
        try {
            canvas = new OffscreenCanvas(diam, diam);
        } catch {
            canvas = document.createElement('canvas');
            canvas.width = diam;
            canvas.height = diam;
        }
        const ctx = canvas.getContext('2d');
        const radius = diam / 2;
        const center = radius;

        const grad = ctx.createRadialGradient(center, center, 0, center, center, radius);
        const innerStop = Math.min(0.99, hardness);

        // White alpha stamp — destination-out uses the alpha channel to erase
        grad.addColorStop(0, `rgba(255, 255, 255, ${opacity})`);
        grad.addColorStop(innerStop, `rgba(255, 255, 255, ${opacity})`);
        grad.addColorStop(1, `rgba(255, 255, 255, 0)`);

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, diam, diam);

        this._stampCanvas = canvas;
        this._stampSize = size;
        this._stampHardness = hardness;
        this._stampOpacity = opacity;

        return canvas;
    }
}
