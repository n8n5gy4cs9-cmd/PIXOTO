/* ═══════════════════════════════════════════════════════════════
   Pixoto — Crop Tool (Phase 5d)
   Visual overlay with 8 handles, center drag, aspect ratio presets.
   Confirm/Cancel on Enter/Escape or buttons.
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';


export class CropTool extends Tool {
    /**
     * @param {import('../tool-manager.js').ToolManager} manager
     */
    constructor(manager) {
        super('crop', manager);

        // Crop region (in document coords)
        this._rect = null; // { x, y, w, h }
        this._active = false;

        // Interaction state
        this._handle = null;    // Which handle is being dragged (or 'move')
        this._dragStart = null; // { x, y } starting mouse pos
        this._rectStart = null; // { x, y, w, h } rect at drag start

        // Aspect ratio: null = free, otherwise { w, h }
        this._aspect = null;

        // Handle hit-test size (in document pixels)
        this._handleSize = 8;
    }

    getCursor() {
        return this._active ? 'move' : 'crosshair';
    }

    activate() {
        // Initialize crop rect to full document
        const w = this.manager.engine.docWidth;
        const h = this.manager.engine.docHeight;
        this._rect = { x: 0, y: 0, w, h };
        this._active = true;
        this._draw();
    }

    deactivate() {
        this._active = false;
        this._rect = null;
        this._clearUI();
    }

    onPointerDown(cx, cy, e) {
        if (!this._rect) return;

        // Hit-test handles first, then body
        this._handle = this._hitTest(cx, cy);
        this._dragStart = { x: cx, y: cy };
        this._rectStart = { ...this._rect };
    }

    onPointerMove(cx, cy, e) {
        if (!this._handle || !this._dragStart) return;

        const dx = cx - this._dragStart.x;
        const dy = cy - this._dragStart.y;
        const r = this._rectStart;
        const docW = this.manager.engine.docWidth;
        const docH = this.manager.engine.docHeight;

        let { x, y, w, h } = r;

        switch (this._handle) {
            case 'move':
                x = Math.max(0, Math.min(docW - r.w, r.x + dx));
                y = Math.max(0, Math.min(docH - r.h, r.y + dy));
                w = r.w;
                h = r.h;
                break;
            case 'nw':
                x = Math.max(0, r.x + dx);
                y = Math.max(0, r.y + dy);
                w = r.w - (x - r.x);
                h = r.h - (y - r.y);
                break;
            case 'ne':
                y = Math.max(0, r.y + dy);
                w = Math.max(1, r.w + dx);
                h = r.h - (y - r.y);
                break;
            case 'sw':
                x = Math.max(0, r.x + dx);
                w = r.w - (x - r.x);
                h = Math.max(1, r.h + dy);
                break;
            case 'se':
                w = Math.max(1, r.w + dx);
                h = Math.max(1, r.h + dy);
                break;
            case 'n':
                y = Math.max(0, r.y + dy);
                h = r.h - (y - r.y);
                break;
            case 's':
                h = Math.max(1, r.h + dy);
                break;
            case 'w':
                x = Math.max(0, r.x + dx);
                w = r.w - (x - r.x);
                break;
            case 'e':
                w = Math.max(1, r.w + dx);
                break;
        }

        // Enforce minimum size
        w = Math.max(1, w);
        h = Math.max(1, h);

        // Clamp to document bounds
        x = Math.max(0, Math.min(docW - 1, x));
        y = Math.max(0, Math.min(docH - 1, y));
        w = Math.min(w, docW - x);
        h = Math.min(h, docH - y);

        // Enforce aspect ratio if set
        if (this._aspect && this._handle !== 'move') {
            const ar = this._aspect.w / this._aspect.h;
            if (w / h > ar) {
                w = Math.round(h * ar);
            } else {
                h = Math.round(w / ar);
            }
        }

        this._rect = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
        this._draw();
    }

    onPointerUp(cx, cy, e) {
        this._handle = null;
        this._dragStart = null;
        this._rectStart = null;
    }

    /**
     * Confirm crop — actually resize all layers.
     */
    confirmCrop() {
        if (!this._rect || this._rect.w < 1 || this._rect.h < 1) return;

        const { x, y, w, h } = this._rect;
        const engine = this.manager.engine;

        // Crop each layer
        for (const layer of engine.layers) {
            const imgData = layer.ctx.getImageData(x, y, w, h);
            layer.canvas.width = w;
            layer.canvas.height = h;
            layer.ctx.putImageData(imgData, 0, 0);
            layer.markAllDirty();
        }

        // Update engine document size and all canvas/wrapper CSS dimensions
        engine.docWidth = w;
        engine.docHeight = h;
        engine._sizeCanvases(w, h);

        engine.requestComposite();
        engine.fitToScreen();

        if (engine.onLayerChange) engine.onLayerChange();

        this._rect = { x: 0, y: 0, w, h };
        this._clearUI();
        this._active = false;

        console.log(`[CropTool] Cropped to ${w}×${h}`);
    }

    /** Cancel crop and restore full-document overlay. */
    cancelCrop() {
        const w = this.manager.engine.docWidth;
        const h = this.manager.engine.docHeight;
        this._rect = { x: 0, y: 0, w, h };
        this._draw();
    }

    /**
     * Set aspect ratio constraint.
     * @param {number|null} w - Width ratio (null = free)
     * @param {number|null} h - Height ratio
     */
    setAspectRatio(w, h) {
        if (w && h) {
            this._aspect = { w, h };
        } else {
            this._aspect = null;
        }
    }


    // ═════════════════════════════════════════════════════════
    // Hit Testing
    // ═════════════════════════════════════════════════════════

    /**
     * Determine which handle or region was clicked.
     * @private
     * @param {number} cx
     * @param {number} cy
     * @returns {string} 'nw','ne','sw','se','n','s','e','w','move', or null
     */
    _hitTest(cx, cy) {
        const r = this._rect;
        if (!r) return null;

        const hs = this._handleSize;
        const handles = {
            'nw': { x: r.x,         y: r.y },
            'ne': { x: r.x + r.w,   y: r.y },
            'sw': { x: r.x,         y: r.y + r.h },
            'se': { x: r.x + r.w,   y: r.y + r.h },
            'n':  { x: r.x + r.w/2, y: r.y },
            's':  { x: r.x + r.w/2, y: r.y + r.h },
            'w':  { x: r.x,         y: r.y + r.h/2 },
            'e':  { x: r.x + r.w,   y: r.y + r.h/2 },
        };

        for (const [name, pos] of Object.entries(handles)) {
            if (Math.abs(cx - pos.x) <= hs && Math.abs(cy - pos.y) <= hs) {
                return name;
            }
        }

        // Inside the rect = move
        if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
            return 'move';
        }

        // Outside = start new drag (treat as drawing a new rect)
        return 'se'; // Default to creating new rect from corner
    }


    // ═════════════════════════════════════════════════════════
    // Drawing
    // ═════════════════════════════════════════════════════════

    /** @private Draw the crop overlay on the UI canvas. */
    _draw() {
        const ctx = this.manager.engine.uiCtx;
        const dw = this.manager.engine.docWidth;
        const dh = this.manager.engine.docHeight;
        const r = this._rect;
        if (!ctx || !r) return;

        ctx.clearRect(0, 0, dw, dh);

        // Semi-transparent overlay on the excluded areas
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        // Top
        ctx.fillRect(0, 0, dw, r.y);
        // Bottom
        ctx.fillRect(0, r.y + r.h, dw, dh - r.y - r.h);
        // Left
        ctx.fillRect(0, r.y, r.x, r.h);
        // Right
        ctx.fillRect(r.x + r.w, r.y, dw - r.x - r.w, r.h);

        // Crop border
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

        // Rule of thirds
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 0.5;
        const thirdW = r.w / 3;
        const thirdH = r.h / 3;
        for (let i = 1; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(r.x + thirdW * i, r.y);
            ctx.lineTo(r.x + thirdW * i, r.y + r.h);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(r.x, r.y + thirdH * i);
            ctx.lineTo(r.x + r.w, r.y + thirdH * i);
            ctx.stroke();
        }

        // Draw 8 handles
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        const hs = 5; // Handle visual size
        const handles = [
            [r.x, r.y], [r.x + r.w, r.y],
            [r.x, r.y + r.h], [r.x + r.w, r.y + r.h],
            [r.x + r.w / 2, r.y], [r.x + r.w / 2, r.y + r.h],
            [r.x, r.y + r.h / 2], [r.x + r.w, r.y + r.h / 2]
        ];
        for (const [hx, hy] of handles) {
            ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
            ctx.strokeRect(hx - hs, hy - hs, hs * 2, hs * 2);
        }
    }

    /** @private */
    _clearUI() {
        const ctx = this.manager.engine.uiCtx;
        if (ctx) {
            ctx.clearRect(0, 0, this.manager.engine.docWidth, this.manager.engine.docHeight);
        }
    }
}
