/* ═══════════════════════════════════════════════════════════════
   Pixoto — Clone Stamp Tool (Phase G)
   Alt+click (or long-press on mobile) sets the source point.
   Subsequent painting copies pixels from source + offset to destination.
   Draws a crosshair overlay at the source point while painting.
   PixiEditor reference: clone stamp concept (not in PixiEditor source)
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';


export class CloneStampTool extends Tool {
    constructor(manager) {
        super('clone-stamp', manager);

        this.size    = 30;   // brush radius in canvas pixels
        this.opacity = 1.0;  // 0–1

        /** Callback: called when source is set — ({x, y}) */
        this.onSourceSet = null;

        // Source point
        this._srcX = null;
        this._srcY = null;
        this._hasSource = false;

        // Stroke state
        this._strokeActive = false;
        this._strokeStartX = 0;  // canvas X where stroke began
        this._strokeStartY = 0;  // canvas Y where stroke began
        this._srcOffsetX = 0;    // source = strokeStart + offset
        this._srcOffsetY = 0;

        this._lastX = 0;
        this._lastY = 0;

        // Crosshair overlay canvas
        this._overlayCanvas = null;
        this._overlayCtx    = null;

        // Long-press timer for mobile source setting
        this._longPressTimer = null;
        this._longPressCX = 0;
        this._longPressCY = 0;
    }

    activate() {
        this._ensureOverlay();
        this._renderOverlay();
    }

    deactivate() {
        this._strokeActive = false;
        if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = null; }
        this._clearOverlay();
    }

    getCursor() { return 'crosshair'; }


    // ─── Pointer Events ──────────────────────────────────────────

    onPointerDown(cx, cy, e) {
        // Alt+click → set source
        if (e.altKey) {
            this._setSource(cx, cy);
            return;
        }

        // Long-press on mobile → set source after 600ms
        this._longPressCX = cx; this._longPressCY = cy;
        this._longPressTimer = setTimeout(() => {
            this._setSource(this._longPressCX, this._longPressCY);
            this._longPressTimer = null;
        }, 600);

        if (!this._hasSource) return; // No source yet — do nothing

        this._strokeActive = true;
        this._strokeStartX = cx;
        this._strokeStartY = cy;
        this._srcOffsetX   = this._srcX - cx;
        this._srcOffsetY   = this._srcY - cy;
        this._lastX = cx; this._lastY = cy;
        this._dab(cx, cy);
    }

    onPointerMove(cx, cy, e) {
        if (this._longPressTimer) {
            // Moved too far during long-press — cancel it
            const dx = cx - this._longPressCX, dy = cy - this._longPressCY;
            if (dx*dx + dy*dy > 16) {
                clearTimeout(this._longPressTimer);
                this._longPressTimer = null;
            }
        }

        if (!this._strokeActive) return;
        const dx = cx - this._lastX, dy = cy - this._lastY;
        if (dx*dx + dy*dy < (this.size * 0.2) ** 2) return;
        this._dab(cx, cy);
        this._lastX = cx; this._lastY = cy;
    }

    onPointerUp(cx, cy, e) {
        if (this._longPressTimer) {
            clearTimeout(this._longPressTimer);
            this._longPressTimer = null;
        }
        this._strokeActive = false;
        this._renderOverlay(); // Re-draw crosshair at current source
    }


    // ─── Internal ────────────────────────────────────────────────

    _setSource(cx, cy) {
        this._srcX = cx; this._srcY = cy;
        this._hasSource = true;
        this._renderOverlay();
        if (this.onSourceSet) this.onSourceSet(cx, cy);
    }

    _dab(cx, cy) {
        const eng   = this.manager.engine;
        const layer = eng.getActiveLayer?.();
        if (!layer || layer.locked) return;

        const r  = this.size;
        const diam = r * 2;

        // Destination region
        const dx1 = Math.round(cx - r), dy1 = Math.round(cy - r);

        // Source region (follows stroke delta from source point)
        const srcCX = cx + this._srcOffsetX;
        const srcCY = cy + this._srcOffsetY;
        const sx1 = Math.round(srcCX - r), sy1 = Math.round(srcCY - r);

        const canvasW = eng.docWidth, canvasH = eng.docHeight;

        // Clamp destination
        const dx1c = Math.max(0, dx1), dy1c = Math.max(0, dy1);
        const dx2c = Math.min(canvasW, dx1 + diam), dy2c = Math.min(canvasH, dy1 + diam);
        if (dx2c <= dx1c || dy2c <= dy1c) return;
        const dw = dx2c - dx1c, dh = dy2c - dy1c;

        // Read source pixels (may be partially off-canvas → padded with transparent)
        const srcData = this._readRegion(layer, sx1, sy1, diam, diam, canvasW, canvasH);

        // Composite src onto dst with circular soft mask
        const dstData = layer.ctx.getImageData(dx1c, dy1c, dw, dh);
        const src = srcData.data, dst = dstData.data;
        const srcOffX = dx1c - dx1, srcOffY = dy1c - dy1; // alignment correction

        for (let py = 0; py < dh; py++) {
            for (let px = 0; px < dw; px++) {
                const lx = (dx1c + px) - cx, ly = (dy1c + py) - cy;
                const dist = Math.sqrt(lx * lx + ly * ly);
                if (dist > r) continue;

                // Soft falloff
                const falloff = 1 - dist / r;
                const alpha = this.opacity * falloff;

                const si = ((srcOffY + py) * diam + (srcOffX + px)) * 4;
                const di = (py * dw + px) * 4;

                const sa = (src[si+3] / 255) * alpha;
                if (sa < 0.002) continue;

                const da = dst[di+3] / 255;
                const outA = sa + da * (1 - sa);
                if (outA < 0.001) continue;

                dst[di]   = Math.round((src[si]   * sa + dst[di]   * da * (1-sa)) / outA);
                dst[di+1] = Math.round((src[si+1] * sa + dst[di+1] * da * (1-sa)) / outA);
                dst[di+2] = Math.round((src[si+2] * sa + dst[di+2] * da * (1-sa)) / outA);
                dst[di+3] = Math.round(outA * 255);
            }
        }

        layer.ctx.putImageData(dstData, dx1c, dy1c);
        layer.markAllDirty();
        eng.requestComposite();

        // Update crosshair to show current effective source
        this._renderOverlayAt(srcCX, srcCY);
    }

    /** Read a region from layer canvas, returning an in-bounds ImageData of (w×h) */
    _readRegion(layer, sx, sy, w, h, canvasW, canvasH) {
        const tmp = new ImageData(w, h);
        const cx1 = Math.max(0, sx), cy1 = Math.max(0, sy);
        const cx2 = Math.min(canvasW, sx + w), cy2 = Math.min(canvasH, sy + h);
        if (cx2 <= cx1 || cy2 <= cy1) return tmp;
        const cw = cx2 - cx1, ch = cy2 - cy1;
        const sub = layer.ctx.getImageData(cx1, cy1, cw, ch);
        const offX = cx1 - sx, offY = cy1 - sy;
        for (let py = 0; py < ch; py++) {
            for (let px = 0; px < cw; px++) {
                const si = (py * cw + px) * 4;
                const di = ((offY + py) * w + (offX + px)) * 4;
                tmp.data[di]   = sub.data[si];
                tmp.data[di+1] = sub.data[si+1];
                tmp.data[di+2] = sub.data[si+2];
                tmp.data[di+3] = sub.data[si+3];
            }
        }
        return tmp;
    }


    // ─── Overlay (crosshair at source point) ─────────────────────

    _ensureOverlay() {
        if (this._overlayCanvas) return;
        this._overlayCanvas = document.createElement('canvas');
        this._overlayCanvas.style.cssText = `
            position:absolute;top:0;left:0;
            pointer-events:none;z-index:150;
        `;
        const viewport = this.manager.engine?.viewport;
        if (viewport) viewport.appendChild(this._overlayCanvas);
        this._overlayCtx = this._overlayCanvas.getContext('2d');
    }

    _clearOverlay() {
        if (!this._overlayCtx) return;
        this._overlayCtx.clearRect(0, 0, this._overlayCanvas.width, this._overlayCanvas.height);
    }

    _renderOverlay() {
        if (!this._hasSource) { this._clearOverlay(); return; }
        this._renderOverlayAt(this._srcX, this._srcY);
    }

    _renderOverlayAt(cx, cy) {
        if (!this._overlayCanvas) return;
        const eng = this.manager.engine;
        const viewport = eng?.viewport;
        if (!viewport) return;

        // Resize overlay to match viewport
        const rect = viewport.getBoundingClientRect();
        if (this._overlayCanvas.width !== rect.width || this._overlayCanvas.height !== rect.height) {
            this._overlayCanvas.width  = rect.width;
            this._overlayCanvas.height = rect.height;
        }

        const ctx = this._overlayCtx;
        ctx.clearRect(0, 0, this._overlayCanvas.width, this._overlayCanvas.height);

        if (!this._hasSource) return;

        // Convert canvas → screen
        const sp = eng.canvasToScreen(cx, cy);
        const vpRect = eng.viewport.getBoundingClientRect();
        const sx = sp.x - vpRect.left;
        const sy = sp.y - vpRect.top;

        const arm = 10, gap = 3;

        ctx.save();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 2;

        ctx.beginPath();
        // Horizontal arms
        ctx.moveTo(sx - arm, sy); ctx.lineTo(sx - gap, sy);
        ctx.moveTo(sx + gap, sy); ctx.lineTo(sx + arm, sy);
        // Vertical arms
        ctx.moveTo(sx, sy - arm); ctx.lineTo(sx, sy - gap);
        ctx.moveTo(sx, sy + gap); ctx.lineTo(sx, sy + arm);
        // Circle
        ctx.arc(sx, sy, gap + 1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}
