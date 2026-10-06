/* ═══════════════════════════════════════════════════════════════
   Pixoto — Shape Tools (Phase D / P2)
   Rectangle, rounded-rect, ellipse, line, polygon / star.
   Pixel-perfect mode uses the PixelEngine (no AA); photo mode uses
   anti-aliased canvas paths. Shift = constrain, Alt = from center.
   Shapes are clipped to the active selection.
   Ported behaviour from PixiEditor DrawRaster{Rectangle,Ellipse,Line}_UpdateableChange.cs.
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';


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


export class ShapeTool extends Tool {
    /**
     * @param {import('../tool-manager.js').ToolManager} manager
     * @param {'rect'|'rounded-rect'|'ellipse'|'line'|'polygon'} shapeType
     * @param {string} name - Tool id used by ToolManager
     */
    constructor(manager, shapeType, name) {
        super(name, manager);
        this.shapeType = shapeType;

        // ── Options (settable from app.js tool-options panel) ──
        this.fill = shapeType !== 'line';
        this.strokeOn = shapeType === 'line';
        this.strokeWidth = 2;
        this.cornerRadius = 12;
        this.sides = 5;
        this.star = false;
        this.pixelPerfect = null; // null = follow engine.pixelArtMode

        // ── Drag state ──
        this._startX = 0; this._startY = 0;
        this._curX = 0; this._curY = 0;
        this._drawing = false;

        // History hook set by app.js → saveSnapshot
        this.onBeforeStroke = null;
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


    // ── Pointer events ──────────────────────────────────────────

    onPointerDown(cx, cy, e) {
        this._startX = cx; this._startY = cy;
        this._curX = cx; this._curY = cy;
        this._drawing = true;
        // Pause marching ants so they don't fight the preview on the UI canvas.
        const sm = this._sm();
        if (sm && sm._stopAnts) sm._stopAnts();
    }

    onPointerMove(cx, cy, e) {
        if (!this._drawing) return;
        this._curX = cx; this._curY = cy;
        const g = this._computeGeom(cx, cy, e.shiftKey, e.altKey);
        this._drawPreview(g);
    }

    onPointerUp(cx, cy, e) {
        if (!this._drawing) return;
        this._drawing = false;
        this._curX = cx; this._curY = cy;
        this._clearUI();

        const g = this._computeGeom(cx, cy, e.shiftKey, e.altKey);
        const layer = this.manager.engine.getActiveLayer();
        if (this._isValid(g) && layer && !layer.locked) {
            if (this.onBeforeStroke) this.onBeforeStroke();
            this._commit(g);
        }

        // Resume marching ants for any still-active selection.
        const sm = this._sm();
        if (sm && sm.hasSelection && sm._startAnts) sm._startAnts();
    }


    // ── Geometry ────────────────────────────────────────────────

    _computeGeom(curX, curY, shift, alt) {
        const sx = this._startX, sy = this._startY;

        if (this.shapeType === 'line') {
            let x1 = curX, y1 = curY;
            if (shift) {
                const ang = Math.atan2(y1 - sy, x1 - sx);
                const step = Math.PI / 4;
                const snapped = Math.round(ang / step) * step;
                const len = Math.hypot(x1 - sx, y1 - sy);
                x1 = sx + Math.cos(snapped) * len;
                y1 = sy + Math.sin(snapped) * len;
            }
            return { x0: sx, y0: sy, x1, y1 };
        }

        if (this.shapeType === 'polygon') {
            const dx = curX - sx, dy = curY - sy;
            const radius = Math.hypot(dx, dy);
            let angle = Math.atan2(dy, dx);
            if (shift) { const step = Math.PI / 12; angle = Math.round(angle / step) * step; }
            return { cx: sx, cy: sy, radius, angle, sides: Math.max(3, this.sides | 0), star: this.star };
        }

        // rect / rounded-rect / ellipse
        let dx = curX - sx, dy = curY - sy;
        if (shift) {
            const m = Math.max(Math.abs(dx), Math.abs(dy));
            dx = (dx < 0 ? -1 : 1) * m;
            dy = (dy < 0 ? -1 : 1) * m;
        }
        if (alt) {
            return { x: sx - Math.abs(dx), y: sy - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
        }
        return { x: Math.min(sx, sx + dx), y: Math.min(sy, sy + dy), w: Math.abs(dx), h: Math.abs(dy) };
    }

    _isValid(g) {
        if (this.shapeType === 'line') return Math.hypot(g.x1 - g.x0, g.y1 - g.y0) >= 1;
        if (this.shapeType === 'polygon') return g.radius >= 1;
        return g.w >= 1 && g.h >= 1;
    }


    // ── Path building (shared by preview + smooth commit) ───────

    _buildPath(ctx, g) {
        ctx.beginPath();
        switch (this.shapeType) {
            case 'rect':
                ctx.rect(g.x, g.y, g.w, g.h);
                break;
            case 'rounded-rect': {
                const r = Math.min(this.cornerRadius, g.w / 2, g.h / 2);
                const x = g.x, y = g.y, w = g.w, h = g.h;
                ctx.moveTo(x + r, y);
                ctx.arcTo(x + w, y, x + w, y + h, r);
                ctx.arcTo(x + w, y + h, x, y + h, r);
                ctx.arcTo(x, y + h, x, y, r);
                ctx.arcTo(x, y, x + w, y, r);
                ctx.closePath();
                break;
            }
            case 'ellipse':
                ctx.ellipse(g.x + g.w / 2, g.y + g.h / 2, g.w / 2, g.h / 2, 0, 0, Math.PI * 2);
                break;
            case 'line':
                ctx.moveTo(g.x0, g.y0);
                ctx.lineTo(g.x1, g.y1);
                break;
            case 'polygon': {
                const count = g.star ? g.sides * 2 : g.sides;
                for (let i = 0; i < count; i++) {
                    const r = g.star ? (i % 2 === 0 ? g.radius : g.radius * 0.5) : g.radius;
                    const a = g.angle + (i * Math.PI * 2 / count);
                    const px = g.cx + Math.cos(a) * r;
                    const py = g.cy + Math.sin(a) * r;
                    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                }
                ctx.closePath();
                break;
            }
        }
    }


    // ── Preview ─────────────────────────────────────────────────

    _drawPreview(g) {
        const engine = this.manager.engine;
        const ctx = engine.uiCtx;
        if (!ctx) return;
        ctx.clearRect(0, 0, engine.docWidth, engine.docHeight);
        if (!this._isValid(g)) return;

        ctx.save();
        ctx.lineWidth = 1;
        this._buildPath(ctx, g);
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = 0;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.stroke();
        ctx.lineDashOffset = 4;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.stroke();
        ctx.restore();
    }


    // ── Commit ──────────────────────────────────────────────────

    _commit(g) {
        const engine = this.manager.engine;
        const pixel = this.pixelPerfect !== null ? this.pixelPerfect : engine.pixelArtMode;
        const pixelable = (this.shapeType === 'rect' || this.shapeType === 'ellipse' || this.shapeType === 'line');

        if (pixel && pixelable) this._commitPixel(g);
        else this._commitSmooth(g);
    }

    _commitPixel(g) {
        const engine = this.manager.engine;
        const pe = this.manager.pixelEngine;
        const fg = this.manager.foregroundColor;

        if (this.shapeType === 'rect') {
            const x = Math.round(g.x), y = Math.round(g.y), w = Math.round(g.w), h = Math.round(g.h);
            if (this.fill) pe.drawRectFilled(x, y, w, h, fg);
            else           pe.drawRect(x, y, w, h, fg);
        } else if (this.shapeType === 'ellipse') {
            const cx = Math.round(g.x + g.w / 2), cy = Math.round(g.y + g.h / 2);
            const rx = Math.round(g.w / 2), ry = Math.round(g.h / 2);
            if (this.fill) pe.drawEllipseFilled(cx, cy, rx, ry, fg);
            else           pe.drawEllipse(cx, cy, rx, ry, fg);
        } else if (this.shapeType === 'line') {
            pe.drawLine(Math.round(g.x0), Math.round(g.y0), Math.round(g.x1), Math.round(g.y1),
                        fg, Math.max(1, Math.round(this.strokeWidth)));
        }
        engine.requestComposite();
    }

    _commitSmooth(g) {
        const engine = this.manager.engine;
        const layer = engine.getActiveLayer();
        if (!layer || layer.locked) return;
        const w = engine.docWidth, h = engine.docHeight;

        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const tctx = tmp.getContext('2d');
        tctx.imageSmoothingEnabled = !engine.pixelArtMode;

        this._buildPath(tctx, g);

        if (this.shapeType === 'line') {
            // Lines only stroke, using the foreground colour.
            tctx.strokeStyle = this.manager.foregroundColor;
            tctx.lineWidth = Math.max(1, this.strokeWidth);
            tctx.lineCap = 'round';
            tctx.stroke();
        } else {
            if (this.fill) { tctx.fillStyle = this.manager.foregroundColor; tctx.fill(); }
            if (this.strokeOn) {
                tctx.strokeStyle = this.manager.backgroundColor;
                tctx.lineWidth = Math.max(1, this.strokeWidth);
                tctx.stroke();
            }
        }

        // Clip to active selection.
        const sm = this._sm();
        if (sm && sm.hasSelection) {
            const mc = _selectionMaskCanvas(sm, w, h);
            tctx.globalCompositeOperation = 'destination-in';
            tctx.drawImage(mc, 0, 0);
            tctx.globalCompositeOperation = 'source-over';
        }

        layer.ctx.drawImage(tmp, 0, 0);
        layer.markAllDirty();
        engine.requestComposite();
    }
}
