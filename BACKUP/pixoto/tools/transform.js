/* ═══════════════════════════════════════════════════════════════
   Pixoto — Free Transform Tool (Phase A)
   Move, scale, rotate, flip layer content via 8-handle overlay.
   Ported from PixiEditor TransformOverlay + DocumentTransformViewModel.
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';


// ── Constants ──────────────────────────────────────────────────

const HANDLE_VIS_PX  = 8;   // visual handle size in screen px
const HANDLE_HIT_PX  = 22;  // hit-test radius (44px touch target)
const ROTATE_ZONE_PX = 30;  // px outside bbox that activates rotate
const SNAP_ANGLE_DEG = 15;  // rotation snap when Shift held


// ── Math helpers ───────────────────────────────────────────────

function dot(a, b)     { return a.x * b.x + a.y * b.y; }
function mid(a, b)     { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

function norm(v) {
    const len = Math.hypot(v.x, v.y);
    return len < 1e-9 ? { x: 1, y: 0 } : { x: v.x / len, y: v.y / len };
}


// ═══════════════════════════════════════════════════════════════
// TransformTool
// ═══════════════════════════════════════════════════════════════

export class TransformTool extends Tool {

    constructor(manager) {
        super('transform', manager);

        // ── Transform state (document / canvas coords) ──
        this._cx = 0;       // bounding box center x
        this._cy = 0;       // bounding box center y
        this._tw = 100;     // width
        this._th = 100;     // height
        this._tAngle = 0;   // rotation in radians

        // ── Flip flags — applied at commit time ──
        this._flipH = false;
        this._flipV = false;

        // ── Source snapshot (for cancel / rasterise) ──
        this._originalData = null;
        this._originalW    = 0;
        this._originalH    = 0;

        // ── Session flag ──
        this._isActive = false;

        // ── Drag state ──
        this._dragMode       = null;   // 'move'|'tl'|'tr'|'bl'|'br'|'t'|'b'|'l'|'r'|'rotate'
        this._startCx        = 0;
        this._startCy        = 0;
        this._startTW        = 0;
        this._startTH        = 0;
        this._startAngle     = 0;
        this._startMouseCx   = 0;
        this._startMouseCy   = 0;
        this._startCorners   = null;   // { tl,tr,bl,br } at drag start

        // ── Hover zone (for cursor) ──
        this._hoverZone = null;

        // ── Callbacks set by app.js ──
        this.onBeforeConfirm = null;   // () => void — save history

        // ── Numeric input elements set by app.js ──
        this.inputW     = null;
        this.inputH     = null;
        this.inputX     = null;
        this.inputY     = null;
        this.inputAngle = null;

        this._boundHoverMove = this._onHoverMove.bind(this);
    }


    // ════════════════════════════════════════════════════════════
    // Lifecycle
    // ════════════════════════════════════════════════════════════

    activate() {
        const engine = this.manager.engine;
        const layer  = engine.getActiveLayer();
        if (!layer) return;

        // Snapshot original pixels for cancel
        this._originalData = layer.ctx.getImageData(0, 0, engine.docWidth, engine.docHeight);
        this._originalW    = engine.docWidth;
        this._originalH    = engine.docHeight;

        // Initialize transform to full layer
        this._cx     = engine.docWidth  / 2;
        this._cy     = engine.docHeight / 2;
        this._tw     = engine.docWidth;
        this._th     = engine.docHeight;
        this._tAngle = 0;
        this._flipH  = false;
        this._flipV  = false;
        this._isActive   = true;
        this._dragMode   = null;

        this._syncInputs();
        this._drawOverlay();

        engine.viewport.addEventListener('pointermove', this._boundHoverMove);
        this._showFloatingBar(true);

        console.log('[TransformTool] Activated');
    }

    deactivate() {
        const engine = this.manager.engine;
        engine.viewport.removeEventListener('pointermove', this._boundHoverMove);
        this._clearUI();
        this._isActive = false;
        this._showFloatingBar(false);
        console.log('[TransformTool] Deactivated');
    }

    getCursor() {
        return this._getCursorForZone(this._hoverZone);
    }


    // ════════════════════════════════════════════════════════════
    // Pointer Events (routed by ToolManager during drag)
    // ════════════════════════════════════════════════════════════

    onPointerDown(cx, cy, e) {
        if (!this._isActive) return;

        const zone = this._hitTest(cx, cy);
        if (!zone) return;

        this._dragMode     = zone;
        this._startCx      = this._cx;
        this._startCy      = this._cy;
        this._startTW      = this._tw;
        this._startTH      = this._th;
        this._startAngle   = this._tAngle;
        this._startMouseCx = cx;
        this._startMouseCy = cy;
        this._startCorners = this._getCorners();
    }

    onPointerMove(cx, cy, e) {
        if (!this._isActive || !this._dragMode) return;

        const shift = e.shiftKey;
        const ctrl  = e.ctrlKey || e.metaKey;

        switch (this._dragMode) {
            case 'move':   this._applyMove(cx, cy);                        break;
            case 'rotate': this._applyRotate(cx, cy, shift);               break;
            case 'tl': case 'tr': case 'bl': case 'br':
                this._applyCornerScale(this._dragMode, cx, cy, shift, ctrl); break;
            case 't': case 'b': case 'l': case 'r':
                this._applyEdgeScale(this._dragMode, cx, cy, shift, ctrl);   break;
        }

        this._syncInputs();
        this._drawOverlay();
    }

    onPointerUp(cx, cy, e) {
        this._dragMode = null;
    }


    // ════════════════════════════════════════════════════════════
    // Public API (called from app.js)
    // ════════════════════════════════════════════════════════════

    confirmTransform() {
        if (!this._isActive) return;

        if (this.onBeforeConfirm) this.onBeforeConfirm();

        const engine = this.manager.engine;
        const layer  = engine.getActiveLayer();
        if (!layer || !this._originalData) return;

        const { a, b, c, d, e, f } = this._computeMatrix();
        const w = this._originalW;
        const h = this._originalH;

        // Build temp canvas from original pixels
        const tmp    = document.createElement('canvas');
        tmp.width    = w;
        tmp.height   = h;
        tmp.getContext('2d').putImageData(this._originalData, 0, 0);

        // Rasterise
        layer.ctx.clearRect(0, 0, engine.docWidth, engine.docHeight);
        layer.ctx.save();
        layer.ctx.setTransform(a, b, c, d, e, f);
        layer.ctx.imageSmoothingEnabled = !engine.pixelArtMode;

        // Apply flip in local (pre-transform) space
        if (this._flipH || this._flipV) {
            layer.ctx.translate(
                this._flipH ? w : 0,
                this._flipV ? h : 0
            );
            layer.ctx.scale(
                this._flipH ? -1 : 1,
                this._flipV ? -1 : 1
            );
        }

        layer.ctx.drawImage(tmp, 0, 0);
        layer.ctx.restore();
        layer.markAllDirty();

        engine.requestComposite();
        this._clearUI();
        this._isActive = false;
        this._showFloatingBar(false);
    }

    cancelTransform() {
        if (!this._isActive) return;

        const engine = this.manager.engine;
        const layer  = engine.getActiveLayer();
        if (layer && this._originalData) {
            layer.ctx.putImageData(this._originalData, 0, 0);
            layer.markAllDirty();
        }

        engine.requestComposite();
        this._clearUI();
        this._isActive = false;
        this._showFloatingBar(false);
    }

    flipHorizontal() {
        this._flipH = !this._flipH;
        this._drawOverlay();
        this._syncInputs();
    }

    flipVertical() {
        this._flipV = !this._flipV;
        this._drawOverlay();
        this._syncInputs();
    }

    /** Apply values from the numeric toolbar inputs. */
    applyFromInputs(w, h, cx, cy, angleDeg) {
        if (w > 0) this._tw = w;
        if (h > 0) this._th = h;
        this._cx     = cx;
        this._cy     = cy;
        this._tAngle = (angleDeg * Math.PI) / 180;
        this._drawOverlay();
    }


    // ════════════════════════════════════════════════════════════
    // Hit Testing
    // ════════════════════════════════════════════════════════════

    _hitTest(cx, cy) {
        const zoom  = this.manager.engine.zoom;
        const hitR  = HANDLE_HIT_PX  / zoom;
        const rotR  = ROTATE_ZONE_PX / zoom;

        for (const [name, pos] of Object.entries(this._getHandlePositions())) {
            if (Math.hypot(cx - pos.x, cy - pos.y) < hitR) return name;
        }

        if (this._isInsideRect(cx, cy)) return 'move';
        if (this._isNearRect(cx, cy, rotR)) return 'rotate';
        return null;
    }

    _isInsideRect(px, py) {
        const dx  = px - this._cx, dy = py - this._cy;
        const cos = Math.cos(-this._tAngle), sin = Math.sin(-this._tAngle);
        const lx  = dx * cos - dy * sin;
        const ly  = dx * sin + dy * cos;
        return Math.abs(lx) < this._tw / 2 && Math.abs(ly) < this._th / 2;
    }

    _isNearRect(px, py, extra) {
        const dx  = px - this._cx, dy = py - this._cy;
        const cos = Math.cos(-this._tAngle), sin = Math.sin(-this._tAngle);
        const lx  = Math.abs(dx * cos - dy * sin);
        const ly  = Math.abs(dx * sin + dy * cos);
        return lx < this._tw / 2 + extra && ly < this._th / 2 + extra;
    }


    // ════════════════════════════════════════════════════════════
    // Transform Operations
    // ════════════════════════════════════════════════════════════

    _applyMove(cx, cy) {
        this._cx = this._startCx + (cx - this._startMouseCx);
        this._cy = this._startCy + (cy - this._startMouseCy);
    }

    _applyRotate(cx, cy, snap) {
        const ox = this._cx, oy = this._cy;
        const startAng = Math.atan2(this._startMouseCy - oy, this._startMouseCx - ox);
        const curAng   = Math.atan2(cy - oy, cx - ox);
        let delta = curAng - startAng;

        if (snap) {
            const step  = (SNAP_ANGLE_DEG * Math.PI) / 180;
            const total = this._startAngle + delta;
            delta       = Math.round(total / step) * step - this._startAngle;
        }

        this._tAngle = this._startAngle + delta;
    }

    _applyCornerScale(handle, mx, my, shift, ctrl) {
        const sc       = this._startCorners;
        const widthDir = norm({ x: sc.tr.x - sc.tl.x, y: sc.tr.y - sc.tl.y });
        const heightDir= norm({ x: sc.bl.x - sc.tl.x, y: sc.bl.y - sc.tl.y });
        const oppMap   = { tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' };
        const opp      = sc[oppMap[handle]];

        if (ctrl) {
            // Scale from center — center stays fixed
            const dx  = mx - this._startCx, dy = my - this._startCy;
            const cos = Math.cos(-this._startAngle), sin = Math.sin(-this._startAngle);
            const lx  = dx * cos - dy * sin;
            const ly  = dx * sin + dy * cos;
            const sx  = (handle === 'tl' || handle === 'bl') ? -1 : 1;
            const sy  = (handle === 'tl' || handle === 'tr') ? -1 : 1;
            let hw = Math.max(1, sx * lx);
            let hh = Math.max(1, sy * ly);
            if (shift) {
                const scale = Math.max(hw / (this._startTW / 2), hh / (this._startTH / 2));
                hw = (this._startTW / 2) * scale;
                hh = (this._startTH / 2) * scale;
            }
            this._tw = hw * 2;
            this._th = hh * 2;
            this._cx = this._startCx;
            this._cy = this._startCy;
            return;
        }

        // Default: opposite corner stays fixed
        let newCorner = { x: mx, y: my };

        if (shift) {
            // Constrain to the diagonal direction from opp through start handle
            const diagDir = norm({ x: sc[handle].x - opp.x, y: sc[handle].y - opp.y });
            const t       = dot({ x: mx - opp.x, y: my - opp.y }, diagDir);
            newCorner     = { x: opp.x + diagDir.x * t, y: opp.y + diagDir.y * t };
        }

        // Project (newCorner - opp) onto width and height axes
        const diag  = { x: newCorner.x - opp.x, y: newCorner.y - opp.y };
        const projW = dot(diag, widthDir);
        const projH = dot(diag, heightDir);

        // Reconstruct the dragged corner from the projection
        // (ensures the rect stays axis-aligned to widthDir / heightDir)
        const newHandlePos = {
            x: opp.x + projW * widthDir.x + projH * heightDir.x,
            y: opp.y + projW * widthDir.y + projH * heightDir.y,
        };

        this._cx = (opp.x + newHandlePos.x) / 2;
        this._cy = (opp.y + newHandlePos.y) / 2;
        this._tw = Math.max(1, Math.abs(projW));
        this._th = Math.max(1, Math.abs(projH));
    }

    _applyEdgeScale(handle, mx, my, shift, ctrl) {
        const sc = this._startCorners;

        // Map each edge to [movingCorner1, movingCorner2, fixedCorner1, fixedCorner2]
        const edgeMap = {
            t: ['tl', 'tr', 'bl', 'br'],
            b: ['bl', 'br', 'tl', 'tr'],
            l: ['tl', 'bl', 'tr', 'br'],
            r: ['tr', 'br', 'tl', 'bl'],
        };

        const [, , opp1, opp2] = edgeMap[handle];
        const oppCenter  = mid(sc[opp1], sc[opp2]);
        const edgeCenter = mid(sc[edgeMap[handle][0]], sc[edgeMap[handle][1]]);
        const moveDir    = norm({ x: edgeCenter.x - oppCenter.x, y: edgeCenter.y - oppCenter.y });

        const isHorizEdge = (handle === 't' || handle === 'b');

        if (ctrl) {
            // Symmetric: both edges move, center stays
            const projLen   = dot({ x: mx - this._startCx, y: my - this._startCy }, moveDir);
            const newExtent = Math.max(1, Math.abs(projLen) * 2);
            if (isHorizEdge) this._th = newExtent;
            else             this._tw = newExtent;
            return;
        }

        // Opposite edge stays fixed — project mouse onto moveDir from oppCenter
        const projLen = dot({ x: mx - oppCenter.x, y: my - oppCenter.y }, moveDir);
        const newLen  = Math.max(1, Math.abs(projLen));

        if (shift) {
            const aspect = this._startTW / this._startTH;
            if (isHorizEdge) {
                this._th = newLen;
                this._tw = Math.max(1, newLen * aspect);
            } else {
                this._tw = newLen;
                this._th = Math.max(1, newLen / aspect);
            }
        } else {
            if (isHorizEdge) this._th = newLen;
            else             this._tw = newLen;
        }

        // Reposition center (midpoint between fixed opp edge and new edge)
        this._cx = oppCenter.x + moveDir.x * projLen / 2;
        this._cy = oppCenter.y + moveDir.y * projLen / 2;
    }


    // ════════════════════════════════════════════════════════════
    // Matrix Computation (maps original pixels → new positions)
    // ════════════════════════════════════════════════════════════

    _computeMatrix() {
        const w   = this._originalW;
        const h   = this._originalH;
        if (w < 1 || h < 1) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

        const corners = this._getCorners();
        const tl = corners.tl, tr = corners.tr, bl = corners.bl;

        // Canvas 2D setTransform(a,b,c,d,e,f):
        //   screen_x = a * local_x + c * local_y + e
        //   screen_y = b * local_x + d * local_y + f
        //
        // Solve from 3 known mappings:
        //   (0,0) → tl,  (w,0) → tr,  (0,h) → bl
        const e_v = tl.x, f_v = tl.y;
        const a_v = (tr.x - e_v) / w,  b_v = (tr.y - f_v) / w;
        const c_v = (bl.x - e_v) / h,  d_v = (bl.y - f_v) / h;

        return { a: a_v, b: b_v, c: c_v, d: d_v, e: e_v, f: f_v };
    }


    // ════════════════════════════════════════════════════════════
    // Corner / Handle Helpers
    // ════════════════════════════════════════════════════════════

    _getCorners() {
        const { _cx: cx, _cy: cy, _tw: w, _th: h, _tAngle: a } = this;
        const cos = Math.cos(a), sin = Math.sin(a);
        const hw = w / 2, hh = h / 2;
        // Rotate offset (dx, dy) around center: rx = dx*cos - dy*sin, ry = dx*sin + dy*cos
        return {
            tl: { x: cx + (-hw)*cos - (-hh)*sin, y: cy + (-hw)*sin + (-hh)*cos },
            tr: { x: cx + ( hw)*cos - (-hh)*sin, y: cy + ( hw)*sin + (-hh)*cos },
            bl: { x: cx + (-hw)*cos - ( hh)*sin, y: cy + (-hw)*sin + ( hh)*cos },
            br: { x: cx + ( hw)*cos - ( hh)*sin, y: cy + ( hw)*sin + ( hh)*cos },
        };
    }

    _getHandlePositions() {
        const c = this._getCorners();
        return {
            tl: c.tl,
            tr: c.tr,
            bl: c.bl,
            br: c.br,
            t:  mid(c.tl, c.tr),
            b:  mid(c.bl, c.br),
            l:  mid(c.tl, c.bl),
            r:  mid(c.tr, c.br),
        };
    }


    // ════════════════════════════════════════════════════════════
    // Overlay Drawing (on uiCanvas in document coords)
    // ════════════════════════════════════════════════════════════

    _drawOverlay() {
        const engine = this.manager.engine;
        const ctx    = engine.uiCtx;
        if (!ctx) return;

        this._clearUI();

        const zoom      = engine.zoom;
        const corners   = this._getCorners();
        const handles   = this._getHandlePositions();
        const handleVis = HANDLE_VIS_PX / zoom;
        const lineW     = 1 / zoom;

        ctx.save();

        // ── Bounding box (PixiEditor-style double-dash: black + white) ──
        const drawBox = () => {
            ctx.beginPath();
            ctx.moveTo(corners.tl.x, corners.tl.y);
            ctx.lineTo(corners.tr.x, corners.tr.y);
            ctx.lineTo(corners.br.x, corners.br.y);
            ctx.lineTo(corners.bl.x, corners.bl.y);
            ctx.closePath();
        };

        ctx.lineWidth = lineW;
        ctx.setLineDash([2 / zoom, 4 / zoom]);

        ctx.lineDashOffset = 0;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        drawBox(); ctx.stroke();

        ctx.lineDashOffset = 2 / zoom;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        drawBox(); ctx.stroke();

        ctx.setLineDash([]);

        // ── Eight scale handles ──
        ctx.lineWidth = lineW;
        for (const pos of Object.values(handles)) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(pos.x - handleVis / 2, pos.y - handleVis / 2, handleVis, handleVis);
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.strokeRect(pos.x - handleVis / 2, pos.y - handleVis / 2, handleVis, handleVis);
        }

        // ── Center crosshair ──
        const cm = 4 / zoom;
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth   = lineW;
        ctx.beginPath();
        ctx.moveTo(this._cx - cm, this._cy);
        ctx.lineTo(this._cx + cm, this._cy);
        ctx.moveTo(this._cx, this._cy - cm);
        ctx.lineTo(this._cx, this._cy + cm);
        ctx.stroke();

        // ── Flip indicator badges ──
        if (this._flipH || this._flipV) {
            const fs = Math.max(8, 10 / zoom);
            ctx.font         = `bold ${fs}px sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle    = 'rgba(255,200,0,0.95)';
            const badge = (this._flipH ? '↔' : '') + (this._flipV ? '↕' : '');
            ctx.fillText(badge, this._cx, this._cy);
        }

        ctx.restore();
    }

    _clearUI() {
        const engine = this.manager.engine;
        if (engine?.uiCtx) {
            engine.uiCtx.clearRect(0, 0, engine.docWidth, engine.docHeight);
        }
    }


    // ════════════════════════════════════════════════════════════
    // Cursor Management
    // ════════════════════════════════════════════════════════════

    _onHoverMove(e) {
        if (!this._isActive) return;
        if (this.manager.engine.spaceHeld) return;

        const engine  = this.manager.engine;
        const pos     = engine.screenToCanvas(e.clientX, e.clientY);
        this._hoverZone = this._hitTest(pos.x, pos.y);
        engine.viewport.style.cursor = this._getCursorForZone(this._hoverZone);
    }

    _getCursorForZone(zone) {
        if (!zone)           return 'default';
        if (zone === 'move') return 'move';
        if (zone === 'rotate') return 'crosshair';
        const map = {
            tl: 'nwse-resize', br: 'nwse-resize',
            tr: 'nesw-resize', bl: 'nesw-resize',
            t: 'ns-resize',    b: 'ns-resize',
            l: 'ew-resize',    r: 'ew-resize',
        };
        return map[zone] || 'crosshair';
    }


    // ════════════════════════════════════════════════════════════
    // Numeric Input Sync
    // ════════════════════════════════════════════════════════════

    _syncInputs() {
        const deg = (this._tAngle * 180 / Math.PI);
        const normalised = ((deg % 360) + 360) % 360;
        if (this.inputW)     this.inputW.value     = Math.round(this._tw);
        if (this.inputH)     this.inputH.value     = Math.round(this._th);
        if (this.inputX)     this.inputX.value     = Math.round(this._cx);
        if (this.inputY)     this.inputY.value     = Math.round(this._cy);
        if (this.inputAngle) this.inputAngle.value = normalised.toFixed(1);
    }


    // ════════════════════════════════════════════════════════════
    // Floating Confirm / Cancel Bar
    // ════════════════════════════════════════════════════════════

    _showFloatingBar(visible) {
        const bar = document.getElementById('transform-floating-bar');
        if (bar) bar.hidden = !visible;
    }
}
