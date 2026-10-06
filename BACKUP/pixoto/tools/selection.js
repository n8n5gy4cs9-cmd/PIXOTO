/* ═══════════════════════════════════════════════════════════════
   Pixoto — Selection Tool (Phase 5a)
   Rectangle Select with marching ants.
   Stores selection as a bounding rect + per-pixel mask.
   Renders animated marching ants on the UI canvas.
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';


// ═══════════════════════════════════════════════════════════════
// Selection State — shared by all selection sub-tools
// ═══════════════════════════════════════════════════════════════

/**
 * Manages the selection mask and marching-ants rendering.
 * One instance is shared by RectSelectTool, LassoTool, etc.
 */
export class SelectionManager {
    /**
     * @param {import('../canvas-engine.js').CanvasEngine} engine
     */
    constructor(engine) {
        this.engine = engine;

        /** @type {Uint8Array|null} Per-pixel mask: 0 = unselected, 255 = selected */
        this.mask = null;

        /** Document width/height the mask was created for. */
        this.maskWidth = 0;
        this.maskHeight = 0;

        /** Quick bounding rect of the selection (for fast checks). */
        this.bounds = null; // { x, y, w, h } or null

        /** Whether any selection is active. */
        this.hasSelection = false;

        // ── Marching ants animation ──
        this._antOffset = 0;
        this._antAnimId = null;
        this._antRunning = false;

        /** Callback: fired when selection changes. */
        this.onSelectionChange = null;
    }

    // ═════════════════════════════════════════════════════════
    // Selection Operations
    // ═════════════════════════════════════════════════════════

    /**
     * Set the selection to a rectangle.
     * @param {number} x - Left (integer)
     * @param {number} y - Top (integer)
     * @param {number} w - Width (integer, >= 1)
     * @param {number} h - Height (integer, >= 1)
     * @param {'replace'|'add'|'subtract'} mode
     */
    setRect(x, y, w, h, mode = 'replace') {
        this._ensureMask();

        if (mode === 'replace') {
            this.mask.fill(0);
        }

        const docW = this.maskWidth;
        const docH = this.maskHeight;
        const val = mode === 'subtract' ? 0 : 255;

        const x0 = Math.max(0, x | 0);
        const y0 = Math.max(0, y | 0);
        const x1 = Math.min(docW, (x + w) | 0);
        const y1 = Math.min(docH, (y + h) | 0);

        for (let py = y0; py < y1; py++) {
            const row = py * docW;
            for (let px = x0; px < x1; px++) {
                this.mask[row + px] = val;
            }
        }

        this._updateBounds();
        this._notifyChange();
    }

    /**
     * Select the entire document.
     */
    selectAll() {
        this._ensureMask();
        this.mask.fill(255);
        this.bounds = { x: 0, y: 0, w: this.maskWidth, h: this.maskHeight };
        this.hasSelection = true;
        this._startAnts();
        if (this.onSelectionChange) this.onSelectionChange();
    }

    /**
     * Clear the selection entirely.
     */
    deselect() {
        if (this.mask) this.mask.fill(0);
        this.bounds = null;
        this.hasSelection = false;
        this._stopAnts();
        this._clearUI();
        if (this.onSelectionChange) this.onSelectionChange();
    }

    /**
     * Check if a pixel is inside the selection.
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    isSelected(x, y) {
        if (!this.hasSelection || !this.mask) return false;
        x = x | 0; y = y | 0;
        if (x < 0 || y < 0 || x >= this.maskWidth || y >= this.maskHeight) return false;
        return this.mask[y * this.maskWidth + x] > 0;
    }

    /**
     * Get the bounding rect of the selection, or null if no selection.
     * @returns {{ x: number, y: number, w: number, h: number } | null}
     */
    getBounds() {
        return this.bounds;
    }


    // ═════════════════════════════════════════════════════════
    // Polygon & Flood Selection
    // ═════════════════════════════════════════════════════════

    /**
     * Set selection from a polygon (array of {x,y} points).
     * Uses scanline rasterization to fill the polygon into the mask.
     * @param {Array<{x: number, y: number}>} points - Polygon vertices
     * @param {'replace'|'add'|'subtract'} mode
     */
    setFromPolygon(points, mode = 'replace') {
        if (!points || points.length < 3) return;

        this._ensureMask();

        if (mode === 'replace') {
            this.mask.fill(0);
        }

        const val = mode === 'subtract' ? 0 : 255;
        const docW = this.maskWidth;
        const docH = this.maskHeight;

        // Find vertical bounding box of polygon
        let minY = docH, maxY = 0;
        for (const p of points) {
            const py = Math.floor(p.y);
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
        }
        minY = Math.max(0, minY);
        maxY = Math.min(docH - 1, maxY);

        // Scanline fill
        const n = points.length;
        for (let y = minY; y <= maxY; y++) {
            const intersections = [];
            const scanY = y + 0.5; // Center of pixel row

            for (let i = 0; i < n; i++) {
                const j = (i + 1) % n;
                const yi = points[i].y;
                const yj = points[j].y;

                // Check if edge crosses this scanline
                if ((yi <= scanY && yj > scanY) || (yj <= scanY && yi > scanY)) {
                    const t = (scanY - yi) / (yj - yi);
                    const xInt = points[i].x + t * (points[j].x - points[i].x);
                    intersections.push(xInt);
                }
            }

            // Sort intersections left to right
            intersections.sort((a, b) => a - b);

            // Fill between pairs
            const row = y * docW;
            for (let k = 0; k < intersections.length - 1; k += 2) {
                const xStart = Math.max(0, Math.ceil(intersections[k]));
                const xEnd = Math.min(docW - 1, Math.floor(intersections[k + 1]));
                for (let x = xStart; x <= xEnd; x++) {
                    this.mask[row + x] = val;
                }
            }
        }

        this._updateBounds();
        this._notifyChange();
    }

    /**
     * Set selection using flood-fill from a seed point (magic wand).
     * Reads pixel colors from provided imageData and fills matching
     * pixels into the selection mask.
     * @param {number} startX - Seed X (integer)
     * @param {number} startY - Seed Y (integer)
     * @param {number} tolerance - Color match tolerance (0-255)
     * @param {boolean} contiguous - Whether to flood-fill or select all matching
     * @param {'replace'|'add'|'subtract'} mode
     * @param {ImageData} imageData - Source pixel data to sample from
     */
    setFromFlood(startX, startY, tolerance, contiguous, mode, imageData) {
        startX = startX | 0;
        startY = startY | 0;

        const w = imageData.width;
        const h = imageData.height;
        if (startX < 0 || startY < 0 || startX >= w || startY >= h) return;

        this._ensureMask();

        if (mode === 'replace') {
            this.mask.fill(0);
        }

        const val = mode === 'subtract' ? 0 : 255;
        const data = imageData.data;

        // Get target color at seed point
        const idx = (startY * w + startX) * 4;
        const tr = data[idx], tg = data[idx + 1], tb = data[idx + 2], ta = data[idx + 3];

        const matchFn = (i) => {
            return Math.abs(data[i] - tr) <= tolerance &&
                   Math.abs(data[i + 1] - tg) <= tolerance &&
                   Math.abs(data[i + 2] - tb) <= tolerance &&
                   Math.abs(data[i + 3] - ta) <= tolerance;
        };

        if (contiguous) {
            // Stack-based flood fill into mask
            const visited = new Uint8Array(w * h);
            const stack = [[startX, startY]];

            while (stack.length > 0) {
                const [cx, cy] = stack.pop();
                if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
                const vi = cy * w + cx;
                if (visited[vi]) continue;
                const pi = vi * 4;
                if (!matchFn(pi)) continue;

                visited[vi] = 1;
                this.mask[vi] = val;

                stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
            }
        } else {
            // Global: select all matching pixels
            for (let i = 0; i < w * h; i++) {
                if (matchFn(i * 4)) {
                    this.mask[i] = val;
                }
            }
        }

        this._updateBounds();
        this._notifyChange();
    }


    // ═════════════════════════════════════════════════════════
    // Mask Management
    // ═════════════════════════════════════════════════════════

    /** @private Ensure mask array matches current document size. */
    _ensureMask() {
        const w = this.engine.docWidth;
        const h = this.engine.docHeight;
        if (!this.mask || this.maskWidth !== w || this.maskHeight !== h) {
            this.mask = new Uint8Array(w * h);
            this.maskWidth = w;
            this.maskHeight = h;
        }
    }

    /** @private Recalculate bounding rect from mask. */
    _updateBounds() {
        if (!this.mask) {
            this.bounds = null;
            this.hasSelection = false;
            return;
        }

        const w = this.maskWidth;
        const h = this.maskHeight;
        let minX = w, minY = h, maxX = -1, maxY = -1;

        for (let y = 0; y < h; y++) {
            const row = y * w;
            for (let x = 0; x < w; x++) {
                if (this.mask[row + x] > 0) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (maxX < 0) {
            this.bounds = null;
            this.hasSelection = false;
            this._stopAnts();
            this._clearUI();
        } else {
            this.bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
            this.hasSelection = true;
            this._startAnts();
        }
    }

    /** @private Notify listeners of selection change. */
    _notifyChange() {
        if (this.onSelectionChange) this.onSelectionChange();
    }


    // ═════════════════════════════════════════════════════════
    // Marching Ants Rendering
    // ═════════════════════════════════════════════════════════

    /** @private Start the marching ants animation loop. */
    _startAnts() {
        if (this._antRunning) return;
        this._antRunning = true;
        this._antOffset = 0;
        this._tickAnts();
    }

    /** @private Stop the marching ants animation loop. */
    _stopAnts() {
        this._antRunning = false;
        if (this._antAnimId) {
            cancelAnimationFrame(this._antAnimId);
            this._antAnimId = null;
        }
    }

    /** @private Animation tick — advance ant offset and redraw. */
    _tickAnts() {
        if (!this._antRunning) return;
        this._antAnimId = requestAnimationFrame(() => this._tickAnts());

        // Advance offset every ~80ms (not every frame) for visibility
        this._antOffset = (this._antOffset + 0.3) % 12;
        this._drawAnts();
    }

    /** @private Draw marching ants on the UI canvas. */
    _drawAnts() {
        const ctx = this.engine.uiCtx;
        const w = this.engine.docWidth;
        const h = this.engine.docHeight;

        // Clear UI canvas
        ctx.clearRect(0, 0, w, h);

        if (!this.hasSelection || !this.bounds) return;

        // For rectangular selections, draw the rect outline with marching ants
        // For complex masks, trace the boundary edges
        if (this._isSimpleRect()) {
            this._drawRectAnts(ctx);
        } else {
            this._drawMaskAnts(ctx);
        }
    }

    /**
     * Check if the current mask is a simple filled rectangle
     * (optimization: skip expensive edge tracing).
     * @private
     * @returns {boolean}
     */
    _isSimpleRect() {
        if (!this.bounds || !this.mask) return false;
        const { x, y, w, h } = this.bounds;
        const docW = this.maskWidth;

        // Check that every pixel in bounds is selected and count matches
        let count = 0;
        for (let py = y; py < y + h; py++) {
            const row = py * docW;
            for (let px = x; px < x + w; px++) {
                if (this.mask[row + px] > 0) count++;
                else return false;
            }
        }

        // Total selected pixels should equal bounds area
        return count === w * h;
    }

    /**
     * Draw marching ants for a simple rectangle.
     * @private
     */
    _drawRectAnts(ctx) {
        const b = this.bounds;

        ctx.save();
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -this._antOffset;

        // Black background stroke
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);

        // White foreground stroke (offset to create march effect)
        ctx.lineDashOffset = -(this._antOffset + 4);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);

        ctx.restore();
    }

    /**
     * Draw marching ants tracing the boundary of a complex mask.
     * Uses edge detection: draws a line segment for each pixel edge
     * between a selected and an unselected pixel.
     * @private
     */
    _drawMaskAnts(ctx) {
        const mask = this.mask;
        const w = this.maskWidth;
        const h = this.maskHeight;
        const b = this.bounds;
        if (!b) return;

        ctx.save();
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        // Collect boundary edges
        const edges = [];
        const x0 = Math.max(0, b.x - 1);
        const y0 = Math.max(0, b.y - 1);
        const x1 = Math.min(w, b.x + b.w + 1);
        const y1 = Math.min(h, b.y + b.h + 1);

        for (let py = y0; py <= y1; py++) {
            for (let px = x0; px <= x1; px++) {
                const sel = (px >= 0 && py >= 0 && px < w && py < h) ? mask[py * w + px] > 0 : false;
                if (!sel) continue;

                // Check 4 neighbors — if neighbor is unselected or out-of-bounds, draw edge
                // Top edge
                if (py === 0 || mask[(py - 1) * w + px] === 0) {
                    edges.push([px, py, px + 1, py]); // horizontal line at top of pixel
                }
                // Bottom edge
                if (py === h - 1 || mask[(py + 1) * w + px] === 0) {
                    edges.push([px, py + 1, px + 1, py + 1]);
                }
                // Left edge
                if (px === 0 || mask[py * w + (px - 1)] === 0) {
                    edges.push([px, py, px, py + 1]);
                }
                // Right edge
                if (px === w - 1 || mask[py * w + (px + 1)] === 0) {
                    edges.push([px + 1, py, px + 1, py + 1]);
                }
            }
        }

        // Draw black pass
        ctx.lineDashOffset = -this._antOffset;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.beginPath();
        for (const [x0e, y0e, x1e, y1e] of edges) {
            ctx.moveTo(x0e, y0e);
            ctx.lineTo(x1e, y1e);
        }
        ctx.stroke();

        // Draw white pass (offset)
        ctx.lineDashOffset = -(this._antOffset + 4);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        for (const [x0e, y0e, x1e, y1e] of edges) {
            ctx.moveTo(x0e, y0e);
            ctx.lineTo(x1e, y1e);
        }
        ctx.stroke();

        ctx.restore();
    }

    /** @private Clear the UI canvas. */
    _clearUI() {
        if (this.engine.uiCtx) {
            this.engine.uiCtx.clearRect(
                0, 0, this.engine.docWidth, this.engine.docHeight
            );
        }
    }

    /** Stop animation and clean up. */
    destroy() {
        this._stopAnts();
        this._clearUI();
    }
}


// ═══════════════════════════════════════════════════════════════
// Rectangle Select Tool
// ═══════════════════════════════════════════════════════════════

export class RectSelectTool extends Tool {
    /**
     * @param {import('../tool-manager.js').ToolManager} manager
     * @param {SelectionManager} selectionManager
     */
    constructor(manager, selectionManager) {
        super('select-rect', manager);
        this.selection = selectionManager;

        // ── Drag state ──
        this._startX = 0;
        this._startY = 0;
        this._currentX = 0;
        this._currentY = 0;
        this._dragging = false;
    }

    getCursor() {
        return 'crosshair';
    }

    activate() {
        // Show existing selection if any
    }

    deactivate() {
        this._dragging = false;
    }

    onPointerDown(cx, cy, e) {
        // Stop marching ants to prevent UI canvas flicker during drag preview
        this.selection._stopAnts();

        this._startX = Math.floor(cx);
        this._startY = Math.floor(cy);
        this._currentX = this._startX;
        this._currentY = this._startY;
        this._dragging = true;

        // Determine selection mode from modifier keys
        this._mode = 'replace';
        if (e.shiftKey) this._mode = 'add';
        else if (e.altKey) this._mode = 'subtract';
    }

    onPointerMove(cx, cy, e) {
        if (!this._dragging) return;

        this._currentX = Math.floor(cx);
        this._currentY = Math.floor(cy);

        // Live preview: draw a temporary rect on the UI canvas
        this._drawPreview();
    }

    onPointerUp(cx, cy, e) {
        if (!this._dragging) return;
        this._dragging = false;

        this._currentX = Math.floor(cx);
        this._currentY = Math.floor(cy);

        // Compute the final rectangle
        const rect = this._getRect();

        // If rect is too small (click without drag), deselect
        if (rect.w < 1 || rect.h < 1) {
            this.selection.deselect();
            return;
        }

        // Apply selection
        this.selection.setRect(rect.x, rect.y, rect.w, rect.h, this._mode);
    }

    /**
     * Normalize start/current into a positive-size rect.
     * @private
     * @returns {{ x: number, y: number, w: number, h: number }}
     */
    _getRect() {
        const x0 = Math.min(this._startX, this._currentX);
        const y0 = Math.min(this._startY, this._currentY);
        const x1 = Math.max(this._startX, this._currentX);
        const y1 = Math.max(this._startY, this._currentY);

        // Clamp to document bounds
        const docW = this.manager.engine.docWidth;
        const docH = this.manager.engine.docHeight;
        const rx = Math.max(0, x0);
        const ry = Math.max(0, y0);
        const rw = Math.min(docW, x1) - rx;
        const rh = Math.min(docH, y1) - ry;

        return { x: rx, y: ry, w: rw, h: rh };
    }

    /**
     * Draw a temporary selection preview rectangle on the UI canvas.
     * @private
     */
    _drawPreview() {
        const ctx = this.manager.engine.uiCtx;
        const w = this.manager.engine.docWidth;
        const h = this.manager.engine.docHeight;

        ctx.clearRect(0, 0, w, h);

        const rect = this._getRect();
        if (rect.w < 1 || rect.h < 1) return;

        ctx.save();
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        // Black stroke
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

        // White stroke (offset dash)
        ctx.lineDashOffset = 4;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

        // Semi-transparent fill for visual feedback
        ctx.fillStyle = 'rgba(0, 212, 255, 0.08)';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

        ctx.restore();
    }
}


// ═══════════════════════════════════════════════════════════════
// Lasso Select Tool
// ═══════════════════════════════════════════════════════════════

export class LassoTool extends Tool {
    /**
     * @param {import('../tool-manager.js').ToolManager} manager
     * @param {SelectionManager} selectionManager
     */
    constructor(manager, selectionManager) {
        super('lasso', manager);
        this.selection = selectionManager;

        /** @type {Array<{x: number, y: number}>} */
        this._points = [];
        this._dragging = false;
        this._mode = 'replace';
    }

    getCursor() {
        return 'crosshair';
    }

    activate() {
        // Show existing selection if any
    }

    deactivate() {
        this._dragging = false;
        this._points = [];
    }

    onPointerDown(cx, cy, e) {
        // Stop marching ants to prevent UI canvas flicker during drag preview
        this.selection._stopAnts();

        this._points = [{ x: Math.floor(cx), y: Math.floor(cy) }];
        this._dragging = true;

        // Determine selection mode from modifier keys
        this._mode = 'replace';
        if (e.shiftKey) this._mode = 'add';
        else if (e.altKey) this._mode = 'subtract';
    }

    onPointerMove(cx, cy, e) {
        if (!this._dragging) return;

        // Downsample: skip points that are very close to the previous one
        const last = this._points[this._points.length - 1];
        const dx = Math.floor(cx) - last.x;
        const dy = Math.floor(cy) - last.y;
        if (dx * dx + dy * dy < 4) return; // Skip if < 2px away

        this._points.push({ x: Math.floor(cx), y: Math.floor(cy) });
        this._drawPreview();
    }

    onPointerUp(cx, cy, e) {
        if (!this._dragging) return;
        this._dragging = false;

        // Add final point
        this._points.push({ x: Math.floor(cx), y: Math.floor(cy) });

        // Too few points = click without drag → deselect
        if (this._points.length < 3) {
            this.selection.deselect();
            return;
        }

        // Apply polygon selection
        this.selection.setFromPolygon(this._points, this._mode);
        this._points = [];
    }

    /**
     * Draw a live preview of the lasso polygon on the UI canvas.
     * @private
     */
    _drawPreview() {
        const ctx = this.manager.engine.uiCtx;
        const w = this.manager.engine.docWidth;
        const h = this.manager.engine.docHeight;

        ctx.clearRect(0, 0, w, h);

        if (this._points.length < 2) return;

        ctx.save();
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        // Draw polygon path
        ctx.beginPath();
        ctx.moveTo(this._points[0].x + 0.5, this._points[0].y + 0.5);
        for (let i = 1; i < this._points.length; i++) {
            ctx.lineTo(this._points[i].x + 0.5, this._points[i].y + 0.5);
        }

        // Black stroke
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.stroke();

        // White stroke (offset dash)
        ctx.lineDashOffset = 4;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.stroke();

        // Closing line back to start point (dimmer, shows where polygon will close)
        ctx.beginPath();
        const last = this._points[this._points.length - 1];
        ctx.moveTo(last.x + 0.5, last.y + 0.5);
        ctx.lineTo(this._points[0].x + 0.5, this._points[0].y + 0.5);
        ctx.setLineDash([2, 6]);
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.5)';
        ctx.stroke();

        // Semi-transparent fill for area preview
        ctx.beginPath();
        ctx.moveTo(this._points[0].x, this._points[0].y);
        for (let i = 1; i < this._points.length; i++) {
            ctx.lineTo(this._points[i].x, this._points[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 212, 255, 0.06)';
        ctx.fill();

        ctx.restore();
    }
}


// ═══════════════════════════════════════════════════════════════
// Magic Wand Tool
// ═══════════════════════════════════════════════════════════════

export class MagicWandTool extends Tool {
    /**
     * @param {import('../tool-manager.js').ToolManager} manager
     * @param {SelectionManager} selectionManager
     */
    constructor(manager, selectionManager) {
        super('magic-wand', manager);
        this.selection = selectionManager;
    }

    getCursor() {
        return 'crosshair';
    }

    activate() {
        // Show existing selection if any
    }

    deactivate() {
        // Nothing to clean up
    }

    onPointerDown(cx, cy, e) {
        const x = Math.floor(cx);
        const y = Math.floor(cy);

        // Determine mode from modifier keys
        let mode = 'replace';
        if (e.shiftKey) mode = 'add';
        else if (e.altKey) mode = 'subtract';

        // Force a synchronous composite so displayCtx is up to date
        this.manager.engine.compositeNow();

        // Get composited image data from display canvas
        const w = this.manager.engine.docWidth;
        const h = this.manager.engine.docHeight;
        const displayCtx = this.manager.engine.displayCtx;
        const imageData = displayCtx.getImageData(0, 0, w, h);

        // Read tolerance and contiguous from tool manager
        const tolerance = this.manager.wandTolerance;
        const contiguous = this.manager.wandContiguous;

        this.selection.setFromFlood(x, y, tolerance, contiguous, mode, imageData);
    }

    onPointerMove(cx, cy, e) {
        // Magic wand is a click tool — no drag interaction
    }

    onPointerUp(cx, cy, e) {
        // Nothing to do on up
    }
}
