/* ═══════════════════════════════════════════════════════════════
   Pixoto — Brush Tool (Phase 4)
   Unified soft brush + pixel pen.
   Soft brush: radial gradient stamp, Bezier interpolation, AA.
   Pixel pen: integer-snapped, Bresenham lines, no AA.
   Pixel-perfect pen: L-shape corner removal (PixiEditor behavior).
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';
import { hexToRgb } from '../ui/color-utils.js';


export class BrushTool extends Tool {
    constructor(manager) {
        super('brush', manager);

        // ── Stroke state ──
        this._lastX = 0;
        this._lastY = 0;
        this._strokeActive = false;

        // ── Soft brush stamp cache ──
        this._stampCanvas = null;
        this._stampCtx = null;
        this._stampSize = -1;
        this._stampHardness = -1;
        this._stampOpacity = -1;
        this._stampColor = '';

        // ── Spacing for soft brush ──
        this._distAccum = 0;  // accumulated distance since last stamp

        // ── Pressure tracking ──
        this._lastPressure = 0.5;
        this._lastTime = 0;

        // ── Pixel-perfect pen (PixiEditor L-shape removal) ──
        // Tracks the last few distinct pixel waypoints of the stroke.
        // When 3 consecutive waypoints form an L-shape (the middle pixel is
        // a diagonal corner), the corner pixel is erased so diagonal strokes
        // look clean without 90° jaggies.
        this._ppPoints = [];  // { x, y }[]
    }

    activate() {
        // Invalidate stamp cache on activation so it picks up current settings
        this._stampSize = -1;
    }

    deactivate() {
        this._strokeActive = false;
        this._ppPoints = [];
    }

    getCursor() {
        return 'crosshair';
    }


    // ═════════════════════════════════════════════════════════
    // Pointer Events
    // ═════════════════════════════════════════════════════════

    onPointerDown(cx, cy, e) {
        const mode = this.manager.brushMode;

        this._strokeActive = true;
        this._lastTime = performance.now();

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

        const mode = this.manager.brushMode;

        if (mode === 'pixel') {
            this._pixelUp(cx, cy, e);
        } else {
            this._softUp(cx, cy, e);
        }

        this._strokeActive = false;

        // Recomposite to show final result
        this.manager.engine.requestComposite();
    }


    // ═════════════════════════════════════════════════════════
    // PIXEL PEN MODE — Integer-snapped, Bresenham, no AA
    // ═════════════════════════════════════════════════════════

    /** @private */
    _pixelDown(cx, cy, e) {
        const x = Math.floor(cx);
        const y = Math.floor(cy);
        const color = this.manager.foregroundColor;
        const size = this._getPixelPenSize();

        this._ppPoints = [{ x, y }];

        this.manager.pixelEngine.drawLine(x, y, x, y, color, size);
        this.manager.engine.requestComposite();

        this._lastX = x;
        this._lastY = y;
    }

    /** @private */
    _pixelMove(cx, cy, e) {
        const x = Math.floor(cx);
        const y = Math.floor(cy);

        if (x === this._lastX && y === this._lastY) return;

        const color = this.manager.foregroundColor;
        const size = this._getPixelPenSize();

        this.manager.pixelEngine.drawLine(this._lastX, this._lastY, x, y, color, size);
        this.manager.engine.requestComposite();

        this._lastX = x;
        this._lastY = y;

        // Pixel-perfect: track waypoints and remove L-shape corners (size=1 only)
        if (this.manager.pixelPerfectMode && size === 1) {
            this._ppPoints.push({ x, y });
            if (this._ppPoints.length >= 3) {
                this._removePixelPerfectCorner();
            }
            if (this._ppPoints.length > 4) this._ppPoints.shift();
        }
    }

    /** @private */
    _pixelUp(cx, cy, e) {
        this._ppPoints = [];
    }

    /**
     * Detect an L-shape in the last 3 stroke waypoints and erase the corner pixel.
     * Ported from PixiEditor's PixelPerfectPen_UpdateableChange.cs (IsLShape logic).
     *
     * An L-shape occurs when:
     *   - first and third positions differ in BOTH x and y (diagonal from each other)
     *   - second is taxicab-adjacent (distance == 1) to BOTH first and third
     *
     * The middle pixel (second) is the redundant "elbow" that makes diagonals jagged.
     * @private
     */
    _removePixelPerfectCorner() {
        const n = this._ppPoints.length;
        const first  = this._ppPoints[n - 3];
        const second = this._ppPoints[n - 2];
        const third  = this._ppPoints[n - 1];

        const taxi = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

        if (first.x !== third.x && first.y !== third.y &&
            taxi(second, first) === 1 && taxi(second, third) === 1) {

            const layer = this.manager.engine.getActiveLayer();
            if (layer && !layer.locked) {
                layer.ctx.clearRect(second.x, second.y, 1, 1);
                layer.markDirty(second.x, second.y, 1, 1);
                this.manager.engine.requestComposite();
            }
            // Remove the erased waypoint so it isn't re-checked next iteration
            this._ppPoints.splice(n - 2, 1);
        }
    }

    /**
     * Get pixel pen size. In pixel mode, sizes snap to 1, 2, 4, 8, 16.
     * @private
     * @returns {number}
     */
    _getPixelPenSize() {
        const raw = this.manager.brushSize;
        // Snap to nearest allowed pixel pen size
        const sizes = [1, 2, 4, 8, 16];
        let best = 1;
        for (const s of sizes) {
            if (raw >= s) best = s;
        }
        return best;
    }


    // ═════════════════════════════════════════════════════════
    // SOFT BRUSH MODE — Radial gradient stamp, spacing, AA
    // ═════════════════════════════════════════════════════════

    /** @private */
    _softDown(cx, cy, e) {
        const pressure = this._getPressure(e);

        this._lastX = cx;
        this._lastY = cy;
        this._lastPressure = pressure;
        this._distAccum = 0;

        // Stamp at initial position
        this._stampAt(cx, cy, pressure);
        this.manager.engine.requestComposite();
    }

    /** @private */
    _softMove(cx, cy, e) {
        const pressure = this._getPressure(e);

        // Calculate distance from last position
        const dx = cx - this._lastX;
        const dy = cy - this._lastY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.5) return; // Skip sub-pixel jitter

        // Spacing: stamp every X% of brush diameter
        const size = this.manager.brushSize;
        const spacing = Math.max(1, size * 0.15); // 15% of diameter

        this._distAccum += dist;

        // How many stamps to place along the path
        while (this._distAccum >= spacing) {
            this._distAccum -= spacing;

            // Interpolate position
            const t = 1 - (this._distAccum / dist);
            const ix = this._lastX + dx * t;
            const iy = this._lastY + dy * t;
            const ip = this._lastPressure + (pressure - this._lastPressure) * t;

            this._stampAt(ix, iy, ip);
        }

        this.manager.engine.requestComposite();

        this._lastX = cx;
        this._lastY = cy;
        this._lastPressure = pressure;
    }

    /** @private */
    _softUp(cx, cy, e) {
        // Nothing extra — stamps were placed along the path
    }

    /**
     * Place a single brush stamp at the given canvas position.
     * @private
     * @param {number} cx - Canvas X (float)
     * @param {number} cy - Canvas Y (float)
     * @param {number} pressure - 0–1
     */
    _stampAt(cx, cy, pressure) {
        const layer = this.manager.engine.getActiveLayer();
        if (!layer || layer.locked) return;

        const size = this.manager.brushSize;
        const opacity = this.manager.brushOpacity / 100;
        const hardness = this.manager.brushHardness / 100;
        const color = this.manager.foregroundColor;

        // Scale size by pressure (30–100% range)
        const pSize = Math.max(1, size * (0.3 + 0.7 * pressure));
        const pOpacity = opacity * (0.3 + 0.7 * pressure);

        // Build or reuse stamp
        const stamp = this._getStamp(Math.ceil(pSize), hardness, pOpacity, color);

        // Draw stamp centered at cx, cy
        const ctx = layer.ctx;
        const half = stamp.width / 2;
        const sx = cx - half;
        const sy = cy - half;

        ctx.drawImage(stamp, sx, sy);

        // Mark dirty region
        layer.markDirty(
            Math.floor(sx), Math.floor(sy),
            stamp.width + 1, stamp.height + 1
        );
    }

    /**
     * Get (or rebuild) the brush stamp canvas.
     * Radial gradient from center: inner color → transparent.
     * Hardness controls the gradient transition point.
     * @private
     * @param {number} size - Stamp diameter in pixels
     * @param {number} hardness - 0–1 (0 = soft, 1 = hard edge)
     * @param {number} opacity - 0–1
     * @param {string} color - CSS hex color
     * @returns {HTMLCanvasElement|OffscreenCanvas}
     */
    _getStamp(size, hardness, opacity, color) {
        // Return cached if params match
        if (
            this._stampCanvas &&
            this._stampSize === size &&
            this._stampHardness === hardness &&
            this._stampOpacity === opacity &&
            this._stampColor === color
        ) {
            return this._stampCanvas;
        }

        // Create stamp canvas
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
        const cx = radius;
        const cy = radius;

        // Parse color to RGB
        const rgb = hexToRgb(color);

        // Create radial gradient
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);

        // Hardness determines where the hard inner circle ends
        // hardness=1.0: solid circle → sharp falloff at edge
        // hardness=0.0: gradient starts from center
        const innerStop = Math.min(0.99, hardness);

        grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`);
        grad.addColorStop(innerStop, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`);
        grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, diam, diam);

        // Cache
        this._stampCanvas = canvas;
        this._stampSize = size;
        this._stampHardness = hardness;
        this._stampOpacity = opacity;
        this._stampColor = color;

        return canvas;
    }


    // ═════════════════════════════════════════════════════════
    // Helpers
    // ═════════════════════════════════════════════════════════

    /**
     * Get pressure from pointer event, with fallback for mouse.
     * For mouse: simulate pressure from movement speed.
     * @private
     * @param {PointerEvent} e
     * @returns {number} 0–1
     */
    _getPressure(e) {
        // Pen/stylus: use actual pressure
        if (e.pointerType === 'pen' && e.pressure > 0) {
            return Math.max(0.05, Math.min(1, e.pressure));
        }

        // Mouse: simulate from speed (faster = less pressure)
        if (e.pointerType === 'mouse') {
            const now = performance.now();
            const dt = now - this._lastTime;
            this._lastTime = now;

            if (dt <= 0) return 0.5;

            const dx = e.movementX || 0;
            const dy = e.movementY || 0;
            const speed = Math.sqrt(dx * dx + dy * dy) / dt; // px/ms

            // Map speed to pressure: slow → high pressure, fast → low
            // speed 0 → pressure 1.0, speed 2 → pressure 0.3
            const p = Math.max(0.3, 1.0 - speed * 0.35);
            return p;
        }

        // Touch: usually has pressure, otherwise default
        if (e.pressure > 0) {
            return Math.max(0.05, Math.min(1, e.pressure));
        }

        return 0.5;
    }

}
