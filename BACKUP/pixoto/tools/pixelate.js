/* ═══════════════════════════════════════════════════════════════
   Pixoto — Pixelation Tools (Phase 5e)
   Brush pixelate, rect pixelate, pixel sort.
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';


/**
 * Pixelate brush — drag to pixelate regions under the brush.
 */
export class PixelateBrushTool extends Tool {
    constructor(manager) {
        super('pixelate-brush', manager);
        this._blockSize = 8;
        this._brushSize = 40;
        this._drawing = false;
        this._lastX = null;
        this._lastY = null;
    }

    getCursor() { return 'crosshair'; }

    get blockSize() { return this._blockSize; }
    set blockSize(v) { this._blockSize = Math.max(2, Math.min(200, v | 0)); }

    get brushSize() { return this._brushSize; }
    set brushSize(v) { this._brushSize = Math.max(4, Math.min(300, v | 0)); }

    onPointerDown(cx, cy, e) {
        this._drawing = true;
        this._lastX = cx;
        this._lastY = cy;
        this._pixelateAt(cx, cy);
    }

    onPointerMove(cx, cy, e) {
        if (!this._drawing) return;
        this._pixelateAt(cx, cy);
        this._lastX = cx;
        this._lastY = cy;
    }

    onPointerUp(cx, cy, e) {
        this._drawing = false;
        this._lastX = null;
        this._lastY = null;
    }

    /**
     * Pixelate a circular region around (cx, cy).
     * @private
     */
    _pixelateAt(cx, cy) {
        const layer = this.manager.engine.getActiveLayer();
        if (!layer || layer.locked) return;

        const ctx = layer.ctx;
        const bs = this._blockSize;
        const radius = this._brushSize / 2;

        // Compute affected bounding box
        const x1 = Math.max(0, Math.floor(cx - radius));
        const y1 = Math.max(0, Math.floor(cy - radius));
        const x2 = Math.min(this.manager.engine.docWidth, Math.ceil(cx + radius));
        const y2 = Math.min(this.manager.engine.docHeight, Math.ceil(cy + radius));
        const w = x2 - x1;
        const h = y2 - y1;
        if (w <= 0 || h <= 0) return;

        const imgData = ctx.getImageData(x1, y1, w, h);
        const data = imgData.data;
        const radiusSq = radius * radius;

        // For each block in the affected area
        for (let by = 0; by < h; by += bs) {
            for (let bx = 0; bx < w; bx += bs) {
                const bw = Math.min(bs, w - bx);
                const bh = Math.min(bs, h - by);

                // Check if center of block is within brush circle
                const bcx = bx + bw / 2;
                const bcy = by + bh / 2;
                const ddx = (x1 + bcx) - cx;
                const ddy = (y1 + bcy) - cy;
                if (ddx * ddx + ddy * ddy > radiusSq) continue;

                // Average color in this block
                let r = 0, g = 0, b = 0, a = 0, count = 0;
                for (let dy = 0; dy < bh; dy++) {
                    for (let dx = 0; dx < bw; dx++) {
                        const idx = ((by + dy) * w + (bx + dx)) * 4;
                        r += data[idx];
                        g += data[idx + 1];
                        b += data[idx + 2];
                        a += data[idx + 3];
                        count++;
                    }
                }
                r = Math.round(r / count);
                g = Math.round(g / count);
                b = Math.round(b / count);
                a = Math.round(a / count);

                // Fill block with averaged color
                for (let dy = 0; dy < bh; dy++) {
                    for (let dx = 0; dx < bw; dx++) {
                        const idx = ((by + dy) * w + (bx + dx)) * 4;
                        data[idx]     = r;
                        data[idx + 1] = g;
                        data[idx + 2] = b;
                        data[idx + 3] = a;
                    }
                }
            }
        }

        ctx.putImageData(imgData, x1, y1);
        layer.markDirty(x1, y1, w, h);
        this.manager.engine.requestComposite();
    }
}


/**
 * Rectangle pixelate — drag a region, pixelate on release.
 */
export class RectPixelateTool extends Tool {
    constructor(manager) {
        super('pixelate-rect', manager);
        this._blockSize = 8;
        this._startX = null;
        this._startY = null;
        this._dragging = false;
    }

    getCursor() { return 'crosshair'; }

    get blockSize() { return this._blockSize; }
    set blockSize(v) { this._blockSize = Math.max(2, Math.min(200, v | 0)); }

    onPointerDown(cx, cy, e) {
        this._startX = cx;
        this._startY = cy;
        this._dragging = true;
    }

    onPointerMove(cx, cy, e) {
        if (!this._dragging) return;
        this._drawPreview(cx, cy);
    }

    onPointerUp(cx, cy, e) {
        if (!this._dragging) return;
        this._dragging = false;

        const x1 = Math.min(this._startX, cx);
        const y1 = Math.min(this._startY, cy);
        const x2 = Math.max(this._startX, cx);
        const y2 = Math.max(this._startY, cy);

        this._pixelateRegion(Math.round(x1), Math.round(y1),
                             Math.round(x2 - x1), Math.round(y2 - y1));

        // Clear UI overlay
        const uiCtx = this.manager.engine.uiCtx;
        if (uiCtx) {
            uiCtx.clearRect(0, 0, this.manager.engine.docWidth, this.manager.engine.docHeight);
        }
    }

    /** @private */
    _drawPreview(cx, cy) {
        const uiCtx = this.manager.engine.uiCtx;
        if (!uiCtx) return;

        const dw = this.manager.engine.docWidth;
        const dh = this.manager.engine.docHeight;
        uiCtx.clearRect(0, 0, dw, dh);

        const x = Math.min(this._startX, cx);
        const y = Math.min(this._startY, cy);
        const w = Math.abs(cx - this._startX);
        const h = Math.abs(cy - this._startY);

        uiCtx.strokeStyle = '#00d4ff';
        uiCtx.lineWidth = 1;
        uiCtx.setLineDash([4, 4]);
        uiCtx.strokeRect(x + 0.5, y + 0.5, w, h);
        uiCtx.setLineDash([]);
    }

    /**
     * Pixelate a rectangular region on the active layer.
     * @private
     */
    _pixelateRegion(x, y, w, h) {
        const layer = this.manager.engine.getActiveLayer();
        if (!layer || layer.locked || w < 1 || h < 1) return;

        const ctx = layer.ctx;
        const bs = this._blockSize;

        // Clamp to canvas
        x = Math.max(0, x);
        y = Math.max(0, y);
        w = Math.min(w, this.manager.engine.docWidth - x);
        h = Math.min(h, this.manager.engine.docHeight - y);
        if (w <= 0 || h <= 0) return;

        const imgData = ctx.getImageData(x, y, w, h);
        const data = imgData.data;

        for (let by = 0; by < h; by += bs) {
            for (let bx = 0; bx < w; bx += bs) {
                const bw = Math.min(bs, w - bx);
                const bh = Math.min(bs, h - by);

                let r = 0, g = 0, b = 0, a = 0, count = 0;
                for (let dy = 0; dy < bh; dy++) {
                    for (let dx = 0; dx < bw; dx++) {
                        const idx = ((by + dy) * w + (bx + dx)) * 4;
                        r += data[idx];
                        g += data[idx + 1];
                        b += data[idx + 2];
                        a += data[idx + 3];
                        count++;
                    }
                }
                r = Math.round(r / count);
                g = Math.round(g / count);
                b = Math.round(b / count);
                a = Math.round(a / count);

                for (let dy = 0; dy < bh; dy++) {
                    for (let dx = 0; dx < bw; dx++) {
                        const idx = ((by + dy) * w + (bx + dx)) * 4;
                        data[idx]     = r;
                        data[idx + 1] = g;
                        data[idx + 2] = b;
                        data[idx + 3] = a;
                    }
                }
            }
        }

        ctx.putImageData(imgData, x, y);
        layer.markDirty(x, y, w, h);
        this.manager.engine.requestComposite();
    }
}


/**
 * Pixel Sort — glitch art effect on a selected region.
 * Sorts pixel rows by brightness within a threshold range.
 */
export class PixelSortTool extends Tool {
    constructor(manager) {
        super('pixel-sort', manager);
        this._threshold = 80;    // 0-255 brightness threshold
        this._direction = 'horizontal'; // 'horizontal' or 'vertical'
        this._startX = null;
        this._startY = null;
        this._dragging = false;
    }

    getCursor() { return 'crosshair'; }

    get threshold() { return this._threshold; }
    set threshold(v) { this._threshold = Math.max(0, Math.min(255, v | 0)); }

    get direction() { return this._direction; }
    set direction(v) { this._direction = v === 'vertical' ? 'vertical' : 'horizontal'; }

    onPointerDown(cx, cy, e) {
        this._startX = cx;
        this._startY = cy;
        this._dragging = true;
    }

    onPointerMove(cx, cy, e) {
        if (!this._dragging) return;
        // Preview rect
        const uiCtx = this.manager.engine.uiCtx;
        if (!uiCtx) return;
        const dw = this.manager.engine.docWidth;
        const dh = this.manager.engine.docHeight;
        uiCtx.clearRect(0, 0, dw, dh);
        const x = Math.min(this._startX, cx);
        const y = Math.min(this._startY, cy);
        const w = Math.abs(cx - this._startX);
        const h = Math.abs(cy - this._startY);
        uiCtx.strokeStyle = '#ff6b35';
        uiCtx.lineWidth = 1;
        uiCtx.setLineDash([4, 4]);
        uiCtx.strokeRect(x + 0.5, y + 0.5, w, h);
        uiCtx.setLineDash([]);
    }

    onPointerUp(cx, cy, e) {
        if (!this._dragging) return;
        this._dragging = false;

        const x1 = Math.round(Math.min(this._startX, cx));
        const y1 = Math.round(Math.min(this._startY, cy));
        const x2 = Math.round(Math.max(this._startX, cx));
        const y2 = Math.round(Math.max(this._startY, cy));

        this._applyPixelSort(x1, y1, x2 - x1, y2 - y1);

        const uiCtx = this.manager.engine.uiCtx;
        if (uiCtx) {
            uiCtx.clearRect(0, 0, this.manager.engine.docWidth, this.manager.engine.docHeight);
        }
    }

    /** @private */
    _applyPixelSort(x, y, w, h) {
        const layer = this.manager.engine.getActiveLayer();
        if (!layer || layer.locked || w < 2 || h < 2) return;

        const ctx = layer.ctx;
        x = Math.max(0, x);
        y = Math.max(0, y);
        w = Math.min(w, this.manager.engine.docWidth - x);
        h = Math.min(h, this.manager.engine.docHeight - y);
        if (w <= 0 || h <= 0) return;

        const imgData = ctx.getImageData(x, y, w, h);
        const data = imgData.data;
        const thresh = this._threshold;

        if (this._direction === 'horizontal') {
            for (let row = 0; row < h; row++) {
                const pixels = [];
                for (let col = 0; col < w; col++) {
                    const idx = (row * w + col) * 4;
                    const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
                    pixels.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3], brightness });
                }

                // Sort segments above threshold
                let i = 0;
                while (i < pixels.length) {
                    if (pixels[i].brightness > thresh) {
                        const start = i;
                        while (i < pixels.length && pixels[i].brightness > thresh) i++;
                        const segment = pixels.slice(start, i);
                        segment.sort((a, b) => a.brightness - b.brightness);
                        for (let j = 0; j < segment.length; j++) {
                            pixels[start + j] = segment[j];
                        }
                    } else {
                        i++;
                    }
                }

                for (let col = 0; col < w; col++) {
                    const idx = (row * w + col) * 4;
                    data[idx]     = pixels[col].r;
                    data[idx + 1] = pixels[col].g;
                    data[idx + 2] = pixels[col].b;
                    data[idx + 3] = pixels[col].a;
                }
            }
        } else {
            // Vertical sort
            for (let col = 0; col < w; col++) {
                const pixels = [];
                for (let row = 0; row < h; row++) {
                    const idx = (row * w + col) * 4;
                    const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
                    pixels.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3], brightness });
                }

                let i = 0;
                while (i < pixels.length) {
                    if (pixels[i].brightness > thresh) {
                        const start = i;
                        while (i < pixels.length && pixels[i].brightness > thresh) i++;
                        const segment = pixels.slice(start, i);
                        segment.sort((a, b) => a.brightness - b.brightness);
                        for (let j = 0; j < segment.length; j++) {
                            pixels[start + j] = segment[j];
                        }
                    } else {
                        i++;
                    }
                }

                for (let row = 0; row < h; row++) {
                    const idx = (row * w + col) * 4;
                    data[idx]     = pixels[row].r;
                    data[idx + 1] = pixels[row].g;
                    data[idx + 2] = pixels[row].b;
                    data[idx + 3] = pixels[row].a;
                }
            }
        }

        ctx.putImageData(imgData, x, y);
        layer.markDirty(x, y, w, h);
        this.manager.engine.requestComposite();
    }
}
