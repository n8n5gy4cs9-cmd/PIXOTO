/* ═══════════════════════════════════════════════════════════════
   Pixoto — Smudge Tool (Phase G)
   Samples pixels under the brush at stroke start, then smears them
   in the direction of movement using alpha-compositing.
   PixiEditor reference: IBrightnessToolHandler.cs (smudge concept)
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';


export class SmudgeTool extends Tool {
    constructor(manager) {
        super('smudge', manager);

        this.size     = 20;   // brush radius in canvas pixels
        this.strength = 0.5;  // 0–1 (fraction of smudge to mix)

        this._strokeActive = false;
        this._lastX = 0;
        this._lastY = 0;

        // Pickup buffer: sampled from the canvas before each dab
        this._pickupCanvas = null;
        this._pickupCtx    = null;
    }

    getCursor() { return 'crosshair'; }

    onPointerDown(cx, cy, e) {
        this._strokeActive = true;
        this._lastX = cx; this._lastY = cy;
        this._ensurePickup();
        this._samplePickup(cx, cy);
    }

    onPointerMove(cx, cy, e) {
        if (!this._strokeActive) return;
        const dx = cx - this._lastX, dy = cy - this._lastY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < this.size * 0.15) return; // skip tiny moves

        this._dab(cx, cy);
        this._lastX = cx; this._lastY = cy;
    }

    onPointerUp(cx, cy, e) {
        this._strokeActive = false;
    }


    // ─── Internal ─────────────────────────────────────────────

    _ensurePickup() {
        const d = this.size * 2 + 2;
        if (!this._pickupCanvas || this._pickupCanvas.width !== d) {
            this._pickupCanvas = document.createElement('canvas');
            this._pickupCanvas.width = this._pickupCanvas.height = d;
            this._pickupCtx = this._pickupCanvas.getContext('2d');
        }
    }

    _samplePickup(cx, cy) {
        const eng = this.manager.engine;
        const layer = eng.getActiveLayer?.();
        if (!layer) return;
        const r = this.size;
        const x = Math.round(cx - r), y = Math.round(cy - r);
        const w = this._pickupCanvas.width, h = this._pickupCanvas.height;
        this._pickupCtx.clearRect(0, 0, w, h);
        this._pickupCtx.drawImage(layer.canvas, x, y, w, h, 0, 0, w, h);
    }

    _dab(cx, cy) {
        const eng = this.manager.engine;
        const layer = eng.getActiveLayer?.();
        if (!layer || layer.locked) return;

        const r = this.size;
        const x = Math.round(cx - r), y = Math.round(cy - r);
        const w = this._pickupCanvas.width, h = this._pickupCanvas.height;

        const ctx = layer.ctx;
        ctx.save();

        // Create circular clip
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();

        // Paint the sampled pickup at the new position, blended by strength
        ctx.globalAlpha = this.strength;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(this._pickupCanvas, x, y, w, h);

        ctx.restore();

        // Re-sample at new position for next dab
        this._samplePickup(cx, cy);

        layer.markAllDirty();
        eng.requestComposite();
    }
}
