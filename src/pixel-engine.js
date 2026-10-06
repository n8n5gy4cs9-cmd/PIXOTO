/* ═══════════════════════════════════════════════════════════════
   Pixoto — Pixel Engine (Phase 3)
   Pixel-perfect drawing algorithms, grid overlay, palette system.
   No anti-aliasing anywhere. Every operation is integer-snapped.
   ═══════════════════════════════════════════════════════════════ */

import { hexToRgb, rgbToHex } from './ui/color-utils.js';


// ═══════════════════════════════════════════════════════════════
// Preloaded Palettes
// ═══════════════════════════════════════════════════════════════

const PALETTES = {
    'pico-8': {
        name: 'PICO-8',
        colors: [
            '#000000', '#1d2b53', '#7e2553', '#008751',
            '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
            '#ff004d', '#ffa300', '#ffec27', '#00e436',
            '#29adff', '#83769c', '#ff77a8', '#ffccaa'
        ]
    },
    'game-boy': {
        name: 'Game Boy',
        colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f']
    },
    'nes': {
        name: 'NES',
        colors: [
            '#000000', '#fcfcfc', '#f8f8f8', '#bcbcbc',
            '#7c7c7c', '#a4e4fc', '#3cbcfc', '#0078f8',
            '#0000fc', '#b8b8f8', '#6888fc', '#0058f8',
            '#0000bc', '#d8b8f8', '#9878f8', '#6844fc',
            '#4428bc', '#f8b8f8', '#f878f8', '#d800cc',
            '#940084', '#f8a4c0', '#f85898', '#e40058',
            '#a80020', '#f0d0b0', '#f87858', '#f83800',
            '#a81000', '#fce0a8', '#fca044', '#e45c10',
            '#881400', '#f8d878', '#f8b800', '#ac7c00',
            '#503000', '#d8f878', '#b8f818', '#00b800',
            '#007800', '#b8f8b8', '#58d854', '#00a800',
            '#006800', '#b8f8d8', '#58f898', '#00a844',
            '#005800', '#00fcfc', '#00e8d8', '#008888',
            '#004058', '#f8d8f8', '#787878', '#000000'
        ]
    },
    'cga': {
        name: 'CGA',
        colors: [
            '#000000', '#0000aa', '#00aa00', '#00aaaa',
            '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
            '#555555', '#5555ff', '#55ff55', '#55ffff',
            '#ff5555', '#ff55ff', '#ffff55', '#ffffff'
        ]
    },
    'endesga-32': {
        name: 'Endesga 32',
        colors: [
            '#be4a2f', '#d77643', '#ead4aa', '#e4a672',
            '#b86f50', '#733e39', '#3e2731', '#a22633',
            '#e43b44', '#f77622', '#feae34', '#fee761',
            '#63c74d', '#3e8948', '#265c42', '#193c3e',
            '#124e89', '#0099db', '#2ce8f5', '#ffffff',
            '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
            '#262b44', '#181425', '#ff0044', '#68386c',
            '#b55088', '#f6757a', '#e8b796', '#c28569'
        ]
    }
};

// Default grid settings — white works with mix-blend-mode:difference on grid canvas
const DEFAULT_GRID_COLOR = 'rgba(255, 255, 255, 0.8)';
const DEFAULT_SUBGRID_COLOR = 'rgba(255, 255, 255, 0.4)';
const GRID_AUTO_SHOW_ZOOM = 4.0; // 400%


// ═══════════════════════════════════════════════════════════════
// Bresenham Algorithms — Pure integer, no anti-aliasing
// ═══════════════════════════════════════════════════════════════

/**
 * Bresenham line — calls plot(x, y) for each pixel.
 * @param {number} x0 - Start X (integer)
 * @param {number} y0 - Start Y (integer)
 * @param {number} x1 - End X (integer)
 * @param {number} y1 - End Y (integer)
 * @param {function} plot - Callback (x, y) => void
 */
function bresenhamLine(x0, y0, x1, y1, plot) {
    x0 = x0 | 0; y0 = y0 | 0;
    x1 = x1 | 0; y1 = y1 | 0;

    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;

    while (true) {
        plot(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

/**
 * Pixel-perfect rectangle outline.
 * @param {number} x - Top-left X
 * @param {number} y - Top-left Y
 * @param {number} w - Width (≥ 1)
 * @param {number} h - Height (≥ 1)
 * @param {function} plot - Callback (x, y) => void
 */
function bresenhamRect(x, y, w, h, plot) {
    x = x | 0; y = y | 0; w = w | 0; h = h | 0;
    if (w < 1 || h < 1) return;

    const x2 = x + w - 1;
    const y2 = y + h - 1;

    // Top and bottom edges
    for (let px = x; px <= x2; px++) {
        plot(px, y);
        if (h > 1) plot(px, y2);
    }
    // Left and right edges (skip corners already drawn)
    for (let py = y + 1; py < y2; py++) {
        plot(x, py);
        if (w > 1) plot(x2, py);
    }
}

/**
 * Pixel-perfect filled rectangle.
 * @param {number} x - Top-left X
 * @param {number} y - Top-left Y
 * @param {number} w - Width (≥ 1)
 * @param {number} h - Height (≥ 1)
 * @param {function} plot - Callback (x, y) => void
 */
function bresenhamRectFilled(x, y, w, h, plot) {
    x = x | 0; y = y | 0; w = w | 0; h = h | 0;
    if (w < 1 || h < 1) return;

    for (let py = y; py < y + h; py++) {
        for (let px = x; px < x + w; px++) {
            plot(px, py);
        }
    }
}

/**
 * Bresenham ellipse outline — pixel-perfect, no AA.
 * Draws an axis-aligned ellipse inside bounding box (cx-rx, cy-ry) to (cx+rx, cy+ry).
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} rx - Horizontal radius
 * @param {number} ry - Vertical radius
 * @param {function} plot - Callback (x, y) => void
 */
function bresenhamEllipse(cx, cy, rx, ry, plot) {
    cx = cx | 0; cy = cy | 0; rx = Math.abs(rx | 0); ry = Math.abs(ry | 0);
    if (rx === 0 && ry === 0) { plot(cx, cy); return; }
    if (rx === 0) {
        for (let y = cy - ry; y <= cy + ry; y++) plot(cx, y);
        return;
    }
    if (ry === 0) {
        for (let x = cx - rx; x <= cx + rx; x++) plot(x, cy);
        return;
    }

    let x = 0;
    let y = ry;
    let rx2 = rx * rx;
    let ry2 = ry * ry;
    let tworx2 = 2 * rx2;
    let twory2 = 2 * ry2;
    let px = 0;
    let py = tworx2 * y;
    let p;

    // Plot 4-way symmetric points
    function plot4(px, py) {
        plot(cx + px, cy + py);
        plot(cx - px, cy + py);
        plot(cx + px, cy - py);
        plot(cx - px, cy - py);
    }

    // Region 1: slope magnitude < 1
    plot4(x, y);
    p = Math.round(ry2 - rx2 * ry + 0.25 * rx2);
    while (px < py) {
        x++;
        px += twory2;
        if (p < 0) {
            p += ry2 + px;
        } else {
            y--;
            py -= tworx2;
            p += ry2 + px - py;
        }
        plot4(x, y);
    }

    // Region 2: slope magnitude ≥ 1
    p = Math.round(ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2);
    while (y > 0) {
        y--;
        py -= tworx2;
        if (p > 0) {
            p += rx2 - py;
        } else {
            x++;
            px += twory2;
            p += rx2 - py + px;
        }
        plot4(x, y);
    }
}

/**
 * Bresenham filled ellipse — scanline fill.
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} rx - Horizontal radius
 * @param {number} ry - Vertical radius
 * @param {function} plotRow - Callback (x1, x2, y) => void — fill from x1 to x2 inclusive
 */
function bresenhamEllipseFilled(cx, cy, rx, ry, plotRow) {
    cx = cx | 0; cy = cy | 0; rx = Math.abs(rx | 0); ry = Math.abs(ry | 0);
    if (rx === 0 && ry === 0) { plotRow(cx, cx, cy); return; }
    if (rx === 0) {
        for (let y = cy - ry; y <= cy + ry; y++) plotRow(cx, cx, y);
        return;
    }
    if (ry === 0) {
        plotRow(cx - rx, cx + rx, cy);
        return;
    }

    // Collect the rightmost x for each y in the top half, then mirror
    const spans = new Int32Array(ry + 1);

    let x = 0;
    let y = ry;
    let rx2 = rx * rx;
    let ry2 = ry * ry;
    let tworx2 = 2 * rx2;
    let twory2 = 2 * ry2;
    let px = 0;
    let py = tworx2 * y;
    let p;

    spans[y] = Math.max(spans[y], x);

    // Region 1
    p = Math.round(ry2 - rx2 * ry + 0.25 * rx2);
    while (px < py) {
        x++;
        px += twory2;
        if (p < 0) {
            p += ry2 + px;
        } else {
            y--;
            py -= tworx2;
            p += ry2 + px - py;
        }
        spans[y] = Math.max(spans[y], x);
    }

    // Region 2
    p = Math.round(ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2);
    while (y > 0) {
        y--;
        py -= tworx2;
        if (p > 0) {
            p += rx2 - py;
        } else {
            x++;
            px += twory2;
            p += rx2 - py + px;
        }
        spans[y] = Math.max(spans[y], x);
    }

    // Draw scanlines symmetrically
    for (let sy = 0; sy <= ry; sy++) {
        const sx = spans[sy];
        plotRow(cx - sx, cx + sx, cy - sy);
        if (sy > 0) plotRow(cx - sx, cx + sx, cy + sy);
    }
}

/**
 * Bresenham circle outline — pixel-perfect.
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} r  - Radius
 * @param {function} plot - Callback (x, y) => void
 */
function bresenhamCircle(cx, cy, r, plot) {
    bresenhamEllipse(cx, cy, r, r, plot);
}


// ═══════════════════════════════════════════════════════════════
// Pixel Engine Class
// ═══════════════════════════════════════════════════════════════

export class PixelEngine {
    /**
     * @param {CanvasEngine} canvasEngine - Reference to the canvas engine
     */
    constructor(canvasEngine) {
        this.engine = canvasEngine;

        // ── Grid settings ──
        this.gridVisible = false;
        this.gridAutoShow = true;        // Auto-show grid at high zoom
        this.gridAutoShowZoom = GRID_AUTO_SHOW_ZOOM;
        this.gridColor = DEFAULT_GRID_COLOR;
        this.subGridColor = DEFAULT_SUBGRID_COLOR;
        this.subGridSize = 0;            // 0 = disabled, 8 or 16 for sprite boundaries

        // Track whether grid is currently drawn (avoid redundant draws)
        this._gridDrawn = false;
        this._lastGridZoom = 0;
        this._lastGridPanX = 0;
        this._lastGridPanY = 0;
        this._manualToggle = false;   // True when user manually toggled grid
        this._wasAutoShown = false;   // True when grid was auto-shown by zoom threshold

        // ── Palette ──
        this.activePalette = 'pico-8';
        this.customColors = [];           // User-added swatches

        // ── Symmetry ──
        this.symmetry = 'none';          // 'none', 'horizontal', 'vertical', 'quad'

        // ── Selection ──
        this.selectionManager = null;    // Set by app.js via setSelectionManager()
    }

    /**
     * Wire in the SelectionManager so drawing tools respect the active selection.
     * When a selection is active, all pixel-level drawing is clipped to selected pixels.
     * @param {import('./tools/selection.js').SelectionManager} sm
     */
    setSelectionManager(sm) {
        this.selectionManager = sm;
    }

    /**
     * Returns true if (x, y) may be drawn — i.e. no selection is active, or the
     * pixel is inside the active selection mask.
     * @private
     */
    _inSelection(x, y) {
        const sm = this.selectionManager;
        if (!sm || !sm.hasSelection) return true;
        return sm.isSelected(x, y);
    }


    // ═════════════════════════════════════════════════════════
    // Grid Overlay
    // ═════════════════════════════════════════════════════════

    /**
     * Toggle grid visibility.
     * @param {boolean} [visible] - Force state, or toggle if omitted
     */
    setGridVisible(visible) {
        if (visible === undefined) {
            this.gridVisible = !this.gridVisible;
        } else {
            this.gridVisible = visible;
        }

        // Track that the user manually toggled the grid
        this._manualToggle = true;
        this._wasAutoShown = false;

        if (this.gridVisible) {
            this.drawGrid();
        } else {
            this.clearGrid();
        }
    }

    /**
     * Set sub-grid size (e.g. 8 for 8×8 sprite boundaries).
     * @param {number} size - 0 to disable, or 8, 16, 32, etc.
     */
    setSubGridSize(size) {
        this.subGridSize = size | 0;
        if (this.gridVisible) this.drawGrid();
    }

    /**
     * Set grid line color.
     * @param {string} color - CSS color string
     */
    setGridColor(color) {
        this.gridColor = color;
        if (this.gridVisible) this.drawGrid();
    }

    /**
     * Set sub-grid color.
     * @param {string} color - CSS color string
     */
    setSubGridColor(color) {
        this.subGridColor = color;
        if (this.gridVisible) this.drawGrid();
    }

    /**
     * Check if grid should auto-show/hide based on zoom level.
     * Called by CanvasEngine after zoom changes.
     * @param {number} zoom - Current zoom level (1.0 = 100%)
     */
    onZoomChanged(zoom) {
        if (!this.gridAutoShow) return;

        const shouldShow = zoom >= this.gridAutoShowZoom;

        // Auto-show: only if user hasn't manually toggled grid on/off
        if (shouldShow && !this.gridVisible && !this._manualToggle) {
            this.gridVisible = true;
            this._wasAutoShown = true;
            this.drawGrid();
        } else if (!shouldShow && this.gridVisible && this._wasAutoShown) {
            // Only auto-hide if it was auto-shown (never touch manual toggle)
            this.gridVisible = false;
            this._wasAutoShown = false;
            this.clearGrid();
        }
    }

    /**
     * Draw the pixel grid overlay on the grid canvas.
     * Grid is drawn in screen space so lines are always 1 CSS pixel wide.
     */
    drawGrid() {
        const eng = this.engine;
        const ctx = eng.gridCtx;
        const zoom = eng.zoom;
        const panX = eng.panX;
        const panY = eng.panY;
        const docW = eng.docWidth;
        const docH = eng.docHeight;
        const canvas = eng.gridCanvas;

        // P9 — the grid canvas is viewport-level and does NOT rotate with the
        // wrapper, so hide it while the view is rotated to avoid misalignment.
        if (eng.viewRotation) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        // Grid canvas must fill the entire viewport, not the document
        const vpW = eng.viewport.clientWidth;
        const vpH = eng.viewport.clientHeight;
        const dpr = eng.dpr;

        // Size grid canvas to viewport (at device pixel ratio)
        if (canvas.width !== vpW * dpr || canvas.height !== vpH * dpr) {
            canvas.width = vpW * dpr;
            canvas.height = vpH * dpr;
            canvas.style.width = `${vpW}px`;
            canvas.style.height = `${vpH}px`;
        }

        // Position grid canvas over viewport (not inside wrapper)
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.pointerEvents = 'none';

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, vpW, vpH);

        // Always draw document boundary when grid is enabled
        const bx0 = Math.round(panX) + 0.5;
        const by0 = Math.round(panY) + 0.5;
        const bx1 = Math.round(panX + docW * zoom) + 0.5;
        const by1 = Math.round(panY + docH * zoom) + 0.5;
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);

        // Per-pixel grid only renders when zoom >= 4.0 (each cell is 4+ px wide)
        if (zoom < 4.0) {
            this._gridDrawn = true;
            this._lastGridZoom = zoom;
            this._lastGridPanX = panX;
            this._lastGridPanY = panY;
            return;
        }

        // Calculate visible document area in viewport coordinates
        const startDocX = Math.max(0, Math.floor(-panX / zoom));
        const startDocY = Math.max(0, Math.floor(-panY / zoom));
        const endDocX = Math.min(docW, Math.ceil((vpW - panX) / zoom));
        const endDocY = Math.min(docH, Math.ceil((vpH - panY) / zoom));

        // ── Draw sub-grid first (behind pixel grid) ──
        if (this.subGridSize > 0) {
            ctx.strokeStyle = this.subGridColor;
            ctx.lineWidth = 1;
            ctx.beginPath();

            const sg = this.subGridSize;

            // Vertical sub-grid lines
            const startSGX = Math.ceil(startDocX / sg) * sg;
            for (let dx = startSGX; dx <= endDocX; dx += sg) {
                const sx = Math.round(panX + dx * zoom) + 0.5;
                if (sx >= 0 && sx <= vpW) {
                    ctx.moveTo(sx, Math.max(0, panY));
                    ctx.lineTo(sx, Math.min(vpH, panY + docH * zoom));
                }
            }

            // Horizontal sub-grid lines
            const startSGY = Math.ceil(startDocY / sg) * sg;
            for (let dy = startSGY; dy <= endDocY; dy += sg) {
                const sy = Math.round(panY + dy * zoom) + 0.5;
                if (sy >= 0 && sy <= vpH) {
                    ctx.moveTo(Math.max(0, panX), sy);
                    ctx.lineTo(Math.min(vpW, panX + docW * zoom), sy);
                }
            }

            ctx.stroke();
        }

        // ── Draw pixel grid ──
        ctx.strokeStyle = this.gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();

        // Vertical lines (one per document pixel column)
        for (let dx = startDocX; dx <= endDocX; dx++) {
            const sx = Math.round(panX + dx * zoom) + 0.5;
            if (sx >= 0 && sx <= vpW) {
                ctx.moveTo(sx, Math.max(0, Math.round(panY + startDocY * zoom)));
                ctx.lineTo(sx, Math.min(vpH, Math.round(panY + endDocY * zoom)));
            }
        }

        // Horizontal lines (one per document pixel row)
        for (let dy = startDocY; dy <= endDocY; dy++) {
            const sy = Math.round(panY + dy * zoom) + 0.5;
            if (sy >= 0 && sy <= vpH) {
                ctx.moveTo(Math.max(0, Math.round(panX + startDocX * zoom)), sy);
                ctx.lineTo(Math.min(vpW, Math.round(panX + endDocX * zoom)), sy);
            }
        }

        ctx.stroke();

        // Reset transform
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        this._gridDrawn = true;
        this._lastGridZoom = zoom;
        this._lastGridPanX = panX;
        this._lastGridPanY = panY;
    }

    /** Clear the grid overlay canvas. */
    clearGrid() {
        const canvas = this.engine.gridCanvas;
        const ctx = this.engine.gridCtx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this._gridDrawn = false;
    }

    /**
     * Called by CanvasEngine after pan/zoom transform updates.
     * Redraws grid if visible and transform changed.
     */
    onTransformChanged() {
        if (!this.gridVisible) return;
        const eng = this.engine;
        if (eng.zoom === this._lastGridZoom &&
            eng.panX === this._lastGridPanX &&
            eng.panY === this._lastGridPanY) return;
        this.drawGrid();
    }


    // ═════════════════════════════════════════════════════════
    // Pixel Drawing Primitives
    // ═════════════════════════════════════════════════════════

    /**
     * Set a single pixel on the active layer.
     * @param {number} x - Document X (integer)
     * @param {number} y - Document Y (integer)
     * @param {string} color - CSS color string
     */
    setPixel(x, y, color) {
        x = x | 0; y = y | 0;
        const layer = this.engine.getActiveLayer();
        if (!layer || layer.locked) return;
        if (x < 0 || y < 0 || x >= this.engine.docWidth || y >= this.engine.docHeight) return;
        if (!this._inSelection(x, y)) return;

        layer.ctx.fillStyle = color;
        layer.ctx.fillRect(x, y, 1, 1);
        layer.markDirty(x, y, 1, 1);
    }

    /**
     * Erase a single pixel on the active layer (set to transparent).
     * @param {number} x - Document X (integer)
     * @param {number} y - Document Y (integer)
     */
    erasePixel(x, y) {
        x = x | 0; y = y | 0;
        const layer = this.engine.getActiveLayer();
        if (!layer || layer.locked) return;
        if (x < 0 || y < 0 || x >= this.engine.docWidth || y >= this.engine.docHeight) return;
        if (!this._inSelection(x, y)) return;

        layer.ctx.clearRect(x, y, 1, 1);
        layer.markDirty(x, y, 1, 1);
    }

    /**
     * Get the color of a pixel on the active layer (or composited).
     * @param {number} x - Document X (integer)
     * @param {number} y - Document Y (integer)
     * @param {boolean} [composited=false] - If true, sample from composited display
     * @returns {{ r: number, g: number, b: number, a: number } | null}
     */
    getPixel(x, y, composited = false) {
        x = x | 0; y = y | 0;
        if (x < 0 || y < 0 || x >= this.engine.docWidth || y >= this.engine.docHeight) return null;

        const ctx = composited ? this.engine.displayCtx : this.engine.getActiveLayer()?.ctx;
        if (!ctx) return null;

        const data = ctx.getImageData(x, y, 1, 1).data;
        return { r: data[0], g: data[1], b: data[2], a: data[3] };
    }

    /**
     * Draw a pixel-perfect line on the active layer.
     * @param {number} x0 - Start X
     * @param {number} y0 - Start Y
     * @param {number} x1 - End X
     * @param {number} y1 - End Y
     * @param {string} color - CSS color string
     * @param {number} [size=1] - Pen size in pixels (1, 2, 4, 8, 16)
     */
    drawLine(x0, y0, x1, y1, color, size = 1) {
        const layer = this.engine.getActiveLayer();
        if (!layer || layer.locked) return;

        const ctx = layer.ctx;
        ctx.fillStyle = color;

        const half = Math.floor(size / 2);

        bresenhamLine(x0, y0, x1, y1, (x, y) => {
            if (size === 1) {
                if (x >= 0 && y >= 0 && x < this.engine.docWidth && y < this.engine.docHeight) {
                    if (this._inSelection(x, y)) ctx.fillRect(x, y, 1, 1);
                }
            } else {
                // Pixel pen with size > 1: stamp a square, per-pixel selection check
                for (let dy = -half; dy < size - half; dy++) {
                    for (let dx = -half; dx < size - half; dx++) {
                        const px = x + dx;
                        const py = y + dy;
                        if (px >= 0 && py >= 0 && px < this.engine.docWidth && py < this.engine.docHeight) {
                            if (this._inSelection(px, py)) ctx.fillRect(px, py, 1, 1);
                        }
                    }
                }
            }
        });

        // Mark dirty region covering the full line bounding box + size
        const minX = Math.max(0, Math.min(x0, x1) - half);
        const minY = Math.max(0, Math.min(y0, y1) - half);
        const maxX = Math.min(this.engine.docWidth, Math.max(x0, x1) + size);
        const maxY = Math.min(this.engine.docHeight, Math.max(y0, y1) + size);
        layer.markDirty(minX, minY, maxX - minX, maxY - minY);
    }

    /**
     * Erase along a pixel-perfect line on the active layer.
     * @param {number} x0 - Start X
     * @param {number} y0 - Start Y
     * @param {number} x1 - End X
     * @param {number} y1 - End Y
     * @param {number} [size=1] - Eraser size in pixels
     */
    eraseLine(x0, y0, x1, y1, size = 1) {
        const layer = this.engine.getActiveLayer();
        if (!layer || layer.locked) return;

        const ctx = layer.ctx;
        const half = Math.floor(size / 2);

        bresenhamLine(x0, y0, x1, y1, (x, y) => {
            if (size === 1) {
                if (this._inSelection(x, y)) ctx.clearRect(x, y, 1, 1);
            } else {
                for (let dy = -half; dy < size - half; dy++) {
                    for (let dx = -half; dx < size - half; dx++) {
                        const px = x + dx;
                        const py = y + dy;
                        if (px >= 0 && py >= 0 && px < this.engine.docWidth && py < this.engine.docHeight) {
                            if (this._inSelection(px, py)) ctx.clearRect(px, py, 1, 1);
                        }
                    }
                }
            }
        });

        const minX = Math.max(0, Math.min(x0, x1) - half);
        const minY = Math.max(0, Math.min(y0, y1) - half);
        const maxX = Math.min(this.engine.docWidth, Math.max(x0, x1) + size);
        const maxY = Math.min(this.engine.docHeight, Math.max(y0, y1) + size);
        layer.markDirty(minX, minY, maxX - minX, maxY - minY);
    }

    /**
     * Draw a pixel-perfect rectangle outline on the active layer.
     * @param {number} x - Top-left X
     * @param {number} y - Top-left Y
     * @param {number} w - Width
     * @param {number} h - Height
     * @param {string} color - CSS color
     */
    drawRect(x, y, w, h, color) {
        const layer = this.engine.getActiveLayer();
        if (!layer || layer.locked) return;

        const ctx = layer.ctx;
        ctx.fillStyle = color;

        bresenhamRect(x, y, w, h, (px, py) => {
            if (px >= 0 && py >= 0 && px < this.engine.docWidth && py < this.engine.docHeight) {
                if (this._inSelection(px, py)) ctx.fillRect(px, py, 1, 1);
            }
        });

        layer.markDirty(
            Math.max(0, x), Math.max(0, y),
            Math.min(w, this.engine.docWidth - x),
            Math.min(h, this.engine.docHeight - y)
        );
    }

    /**
     * Draw a pixel-perfect filled rectangle on the active layer.
     * @param {number} x - Top-left X
     * @param {number} y - Top-left Y
     * @param {number} w - Width
     * @param {number} h - Height
     * @param {string} color - CSS color
     */
    drawRectFilled(x, y, w, h, color) {
        const layer = this.engine.getActiveLayer();
        if (!layer || layer.locked) return;

        // For filled rect, use a single fillRect — no need for per-pixel callback
        layer.ctx.fillStyle = color;
        const clampX = Math.max(0, x | 0);
        const clampY = Math.max(0, y | 0);
        const clampW = Math.min((w | 0), this.engine.docWidth - clampX);
        const clampH = Math.min((h | 0), this.engine.docHeight - clampY);
        const sm = this.selectionManager;
        if (sm && sm.hasSelection) {
            // Selection-clipped: paint only selected pixels.
            for (let py = clampY; py < clampY + clampH; py++) {
                for (let px = clampX; px < clampX + clampW; px++) {
                    if (this._inSelection(px, py)) layer.ctx.fillRect(px, py, 1, 1);
                }
            }
        } else {
            layer.ctx.fillRect(clampX, clampY, clampW, clampH);
        }
        layer.markDirty(clampX, clampY, clampW, clampH);
    }

    /**
     * Draw a pixel-perfect ellipse outline on the active layer.
     * @param {number} cx - Center X
     * @param {number} cy - Center Y
     * @param {number} rx - Horizontal radius
     * @param {number} ry - Vertical radius
     * @param {string} color - CSS color
     */
    drawEllipse(cx, cy, rx, ry, color) {
        const layer = this.engine.getActiveLayer();
        if (!layer || layer.locked) return;

        const ctx = layer.ctx;
        ctx.fillStyle = color;

        bresenhamEllipse(cx, cy, rx, ry, (px, py) => {
            if (px >= 0 && py >= 0 && px < this.engine.docWidth && py < this.engine.docHeight) {
                if (this._inSelection(px, py)) ctx.fillRect(px, py, 1, 1);
            }
        });

        layer.markDirty(
            Math.max(0, cx - rx), Math.max(0, cy - ry),
            Math.min(rx * 2 + 1, this.engine.docWidth),
            Math.min(ry * 2 + 1, this.engine.docHeight)
        );
    }

    /**
     * Draw a pixel-perfect filled ellipse on the active layer.
     * @param {number} cx - Center X
     * @param {number} cy - Center Y
     * @param {number} rx - Horizontal radius
     * @param {number} ry - Vertical radius
     * @param {string} color - CSS color
     */
    drawEllipseFilled(cx, cy, rx, ry, color) {
        const layer = this.engine.getActiveLayer();
        if (!layer || layer.locked) return;

        const ctx = layer.ctx;
        ctx.fillStyle = color;

        const sm = this.selectionManager;
        bresenhamEllipseFilled(cx, cy, rx, ry, (x1, x2, y) => {
            if (y >= 0 && y < this.engine.docHeight) {
                const sx = Math.max(0, x1);
                const ex = Math.min(this.engine.docWidth - 1, x2);
                if (sx <= ex) {
                    if (sm && sm.hasSelection) {
                        for (let px = sx; px <= ex; px++) {
                            if (this._inSelection(px, y)) ctx.fillRect(px, y, 1, 1);
                        }
                    } else {
                        ctx.fillRect(sx, y, ex - sx + 1, 1);
                    }
                }
            }
        });

        layer.markDirty(
            Math.max(0, cx - rx), Math.max(0, cy - ry),
            Math.min(rx * 2 + 1, this.engine.docWidth),
            Math.min(ry * 2 + 1, this.engine.docHeight)
        );
    }

    /**
     * Draw a pixel-perfect circle outline.
     * @param {number} cx - Center X
     * @param {number} cy - Center Y
     * @param {number} r  - Radius
     * @param {string} color - CSS color
     */
    drawCircle(cx, cy, r, color) {
        this.drawEllipse(cx, cy, r, r, color);
    }

    /**
     * Draw a pixel-perfect filled circle.
     * @param {number} cx - Center X
     * @param {number} cy - Center Y
     * @param {number} r  - Radius
     * @param {string} color - CSS color
     */
    drawCircleFilled(cx, cy, r, color) {
        this.drawEllipseFilled(cx, cy, r, r, color);
    }


    // ═════════════════════════════════════════════════════════
    // Flood Fill
    // ═════════════════════════════════════════════════════════

    /**
     * Flood fill from a seed point on the active layer.
     * @param {number} startX - Seed X
     * @param {number} startY - Seed Y
     * @param {string} fillColor - CSS color to fill with
     * @param {number} [tolerance=0] - Color match tolerance (0–255)
     * @param {boolean} [contiguous=true] - Contiguous vs all-matching-pixels
     */
    floodFill(startX, startY, fillColor, tolerance = 0, contiguous = true) {
        startX = startX | 0; startY = startY | 0;
        const layer = this.engine.getActiveLayer();
        if (!layer || layer.locked) return;

        const w = this.engine.docWidth;
        const h = this.engine.docHeight;
        if (startX < 0 || startY < 0 || startX >= w || startY >= h) return;

        const imageData = layer.ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        // Parse fill color
        const fc = hexToRgb(fillColor);
        if (!fc) return;

        // Get target color at seed point
        const idx = (startY * w + startX) * 4;
        const tr = data[idx], tg = data[idx + 1], tb = data[idx + 2], ta = data[idx + 3];

        // Don't fill if seed is outside the selection
        if (!this._inSelection(startX, startY)) return;

        // Don't fill if same color
        if (tr === fc.r && tg === fc.g && tb === fc.b && ta === fc.a) return;

        const matchFn = (i) => {
            return Math.abs(data[i] - tr) <= tolerance &&
                   Math.abs(data[i + 1] - tg) <= tolerance &&
                   Math.abs(data[i + 2] - tb) <= tolerance &&
                   Math.abs(data[i + 3] - ta) <= tolerance;
        };

        if (contiguous) {
            // Scanline flood fill — uses far less stack memory than per-pixel push
            // Selection mask acts as an additional boundary: fill cannot cross into
            // unselected pixels (matches PixiEditor's ApplyClipsSymmetriesEtc behavior).
            const visited = new Uint8Array(w * h);
            const stack = [[startX, startY]];

            while (stack.length > 0) {
                let [sx, sy] = stack.pop();
                if (sy < 0 || sy >= h) continue;

                // Walk left to find scanline start (stop at selection boundary)
                let lx = sx;
                while (lx > 0 && !visited[sy * w + lx - 1] &&
                       matchFn((sy * w + lx - 1) * 4) &&
                       this._inSelection(lx - 1, sy)) lx--;

                // Walk right, filling and checking rows above/below
                let rx = lx;
                let aboveAdded = false;
                let belowAdded = false;

                while (rx < w) {
                    const vi = sy * w + rx;
                    const pi = vi * 4;
                    if (visited[vi] || !matchFn(pi) || !this._inSelection(rx, sy)) break;

                    visited[vi] = 1;
                    data[pi]     = fc.r;
                    data[pi + 1] = fc.g;
                    data[pi + 2] = fc.b;
                    data[pi + 3] = fc.a;

                    // Check pixel above
                    if (sy > 0) {
                        const ai = (sy - 1) * w + rx;
                        if (!visited[ai] && matchFn(ai * 4) && this._inSelection(rx, sy - 1)) {
                            if (!aboveAdded) { stack.push([rx, sy - 1]); aboveAdded = true; }
                        } else {
                            aboveAdded = false;
                        }
                    }

                    // Check pixel below
                    if (sy < h - 1) {
                        const bi = (sy + 1) * w + rx;
                        if (!visited[bi] && matchFn(bi * 4) && this._inSelection(rx, sy + 1)) {
                            if (!belowAdded) { stack.push([rx, sy + 1]); belowAdded = true; }
                        } else {
                            belowAdded = false;
                        }
                    }

                    rx++;
                }
            }
        } else {
            // Global — replace all matching pixels (selection-clipped)
            for (let i = 0; i < data.length; i += 4) {
                if (!matchFn(i)) continue;
                const px = (i / 4) % w;
                const py = Math.floor((i / 4) / w);
                if (!this._inSelection(px, py)) continue;
                data[i] = fc.r;
                data[i + 1] = fc.g;
                data[i + 2] = fc.b;
                data[i + 3] = fc.a;
            }
        }

        layer.ctx.putImageData(imageData, 0, 0);
        layer.markDirty(0, 0, w, h);
    }


    // ═════════════════════════════════════════════════════════
    // Symmetry Drawing
    // ═════════════════════════════════════════════════════════

    /**
     * Set symmetry mode.
     * @param {'none'|'horizontal'|'vertical'|'quad'} mode
     */
    setSymmetry(mode) {
        this.symmetry = mode;
    }

    /**
     * Get symmetry-mirrored points for a given document coordinate.
     * @param {number} x - Document X
     * @param {number} y - Document Y
     * @returns {Array<{x: number, y: number}>} Array of mirrored points including original
     */
    getSymmetryPoints(x, y) {
        const w = this.engine.docWidth;
        const h = this.engine.docHeight;
        const cx = w / 2;
        const cy = h / 2;
        const points = [{ x, y }];

        if (this.symmetry === 'horizontal' || this.symmetry === 'quad') {
            points.push({ x: Math.round(2 * cx - x - 1), y });
        }
        if (this.symmetry === 'vertical' || this.symmetry === 'quad') {
            points.push({ x, y: Math.round(2 * cy - y - 1) });
        }
        if (this.symmetry === 'quad') {
            points.push({ x: Math.round(2 * cx - x - 1), y: Math.round(2 * cy - y - 1) });
        }

        return points;
    }


    // ═════════════════════════════════════════════════════════
    // Palette System
    // ═════════════════════════════════════════════════════════

    /**
     * Get the list of available palette names.
     * @returns {string[]}
     */
    getPaletteNames() {
        return Object.keys(PALETTES);
    }

    /**
     * Get a palette by key.
     * @param {string} key - Palette key (e.g. 'pico-8')
     * @returns {{ name: string, colors: string[] } | null}
     */
    getPalette(key) {
        return PALETTES[key] || null;
    }

    /**
     * Get the currently active palette colors.
     * @returns {string[]}
     */
    getActivePaletteColors() {
        const palette = PALETTES[this.activePalette];
        return palette ? palette.colors : [];
    }

    /**
     * Set the active palette.
     * @param {string} key - Palette key
     */
    setActivePalette(key) {
        if (PALETTES[key]) {
            this.activePalette = key;
        }
    }

    /**
     * Add a custom color swatch.
     * @param {string} color - Hex color
     */
    addCustomColor(color) {
        if (!this.customColors.includes(color)) {
            this.customColors.push(color);
        }
    }

    /**
     * Remove a custom color swatch.
     * @param {string} color - Hex color
     */
    removeCustomColor(color) {
        this.customColors = this.customColors.filter(c => c !== color);
    }

    /**
     * Extract N most-used colors from an ImageData.
     * @param {ImageData} imageData
     * @param {number} [count=16] - Number of colors to extract
     * @returns {string[]} Array of hex color strings
     */
    extractPaletteFromImage(imageData, count = 16) {
        const colorMap = new Map();
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 128) continue; // Skip near-transparent
            const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
            colorMap.set(key, (colorMap.get(key) || 0) + 1);
        }

        // Sort by frequency, take top N
        const sorted = [...colorMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, count);

        return sorted.map(([key]) => {
            const r = (key >> 16) & 0xFF;
            const g = (key >> 8) & 0xFF;
            const b = key & 0xFF;
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        });
    }

    /**
     * Export palette as .hex text file content (one color per line).
     * @param {string} [key] - Palette key, or uses active palette
     * @returns {string} Text content
     */
    exportPaletteHex(key) {
        const colors = key ? (PALETTES[key]?.colors || []) : this.getActivePaletteColors();
        return colors.map(c => c.replace('#', '').toUpperCase()).join('\n');
    }


    // ═════════════════════════════════════════════════════════
    // Utility
    // ═════════════════════════════════════════════════════════

    /** Convert RGBA components to a CSS hex string. */
    rgbaToHex(r, g, b, a = 255) {
        return rgbToHex(r, g, b, a);
    }
}

// Also export the algorithms for direct use by tools
export { bresenhamLine, bresenhamRect, bresenhamRectFilled,
         bresenhamEllipse, bresenhamEllipseFilled, bresenhamCircle,
         PALETTES };
