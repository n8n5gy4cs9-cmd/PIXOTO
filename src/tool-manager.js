/* ═══════════════════════════════════════════════════════════════
   Pixoto — Tool Manager (Phase 4)
   Routes pointer events from the canvas viewport to the active tool.
   Handles tool switching with activate/deactivate lifecycle.
   ═══════════════════════════════════════════════════════════════ */


// ═══════════════════════════════════════════════════════════════
// Tool Base Class — all tools extend this
// ═══════════════════════════════════════════════════════════════

export class Tool {
    /**
     * @param {string} name - Tool identifier (e.g., 'brush', 'eraser')
     * @param {ToolManager} manager - Parent tool manager reference
     */
    constructor(name, manager) {
        this.name = name;
        this.manager = manager;
    }

    /** Called when this tool becomes active. Override in subclass. */
    activate() {}

    /** Called when switching away from this tool. Override in subclass. */
    deactivate() {}

    /**
     * Called on pointer down (primary button, not navigation).
     * @param {number} cx - Canvas X coordinate
     * @param {number} cy - Canvas Y coordinate
     * @param {PointerEvent} e - Original event
     */
    onPointerDown(cx, cy, e) {}

    /**
     * Called on pointer move while drawing.
     * @param {number} cx - Canvas X coordinate
     * @param {number} cy - Canvas Y coordinate
     * @param {PointerEvent} e - Original event
     */
    onPointerMove(cx, cy, e) {}

    /**
     * Called on pointer up (stroke finished).
     * @param {number} cx - Canvas X coordinate
     * @param {number} cy - Canvas Y coordinate
     * @param {PointerEvent} e - Original event
     */
    onPointerUp(cx, cy, e) {}

    /**
     * Update cursor style for this tool.
     * @returns {string} CSS cursor value
     */
    getCursor() {
        return 'crosshair';
    }
}


// ═══════════════════════════════════════════════════════════════
// Tool Manager
// ═══════════════════════════════════════════════════════════════

export class ToolManager {
    /**
     * @param {import('./canvas-engine.js').CanvasEngine} engine
     * @param {import('./pixel-engine.js').PixelEngine} pixelEngine
     * @param {HTMLElement} viewport - The #canvas-viewport element
     */
    constructor(engine, pixelEngine, viewport) {
        this.engine = engine;
        this.pixelEngine = pixelEngine;
        this.viewport = viewport;

        /** @type {Map<string, Tool>} */
        this._tools = new Map();

        /** @type {Tool|null} */
        this._activeTool = null;

        /** @type {string} */
        this._activeToolName = '';

        // ── Common tool state ──
        this.foregroundColor = '#ffffff';
        this.backgroundColor = '#000000';
        this.brushSize = 10;
        this.brushOpacity = 100;     // 1–100
        this.brushHardness = 80;     // 0–100
        this.brushMode = 'soft';     // 'soft' or 'pixel'
        this.fillTolerance = 0;      // 0–255
        this.fillContiguous = true;
        this.wandTolerance = 32;     // 0–255 (magic wand)
        this.wandContiguous = true;  // magic wand contiguous mode
        this.pixelPerfectMode = false; // Pixel-perfect pen (PixiEditor behavior)

        // ── Drawing state ──
        this._isDrawing = false;
        this._drawingPointerId = -1;

        // ── Alpha lock ── snapshot taken before stroke to restore alpha after
        this._alphaLockSnap = null;

        // ── Bind event handlers ──
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);

        this._attachEvents();

        console.log('[ToolManager] Initialized');
    }


    // ═════════════════════════════════════════════════════════
    // Tool Registration
    // ═════════════════════════════════════════════════════════

    /**
     * Register a tool instance.
     * @param {Tool} tool - Must have a .name property
     */
    register(tool) {
        this._tools.set(tool.name, tool);
    }

    /**
     * Get a registered tool by name.
     * @param {string} name
     * @returns {Tool|null}
     */
    getTool(name) {
        return this._tools.get(name) || null;
    }

    /**
     * Switch to a different tool by name.
     * @param {string} name - Tool name (e.g., 'brush', 'eraser')
     */
    switchTool(name) {
        const tool = this._tools.get(name);

        // If switching to an unregistered tool, just deactivate current
        if (this._activeTool) {
            this._activeTool.deactivate();
        }

        if (tool) {
            this._activeTool = tool;
            this._activeToolName = name;
            tool.activate();
            this._updateCursor();
        } else {
            this._activeTool = null;
            this._activeToolName = name; // Keep name even if unregistered
        }
    }

    /** Get the currently active tool instance (or null). */
    get activeTool() {
        return this._activeTool;
    }

    /** Get the currently active tool name. */
    get activeToolName() {
        return this._activeToolName;
    }


    // ═════════════════════════════════════════════════════════
    // State Setters (called by app.js when UI changes)
    // ═════════════════════════════════════════════════════════

    setForegroundColor(color) {
        this.foregroundColor = color;
    }

    setBackgroundColor(color) {
        this.backgroundColor = color;
    }

    setBrushSize(size) {
        this.brushSize = Math.max(1, Math.min(500, size | 0));
    }

    setBrushOpacity(opacity) {
        this.brushOpacity = Math.max(1, Math.min(100, opacity | 0));
    }

    setBrushHardness(hardness) {
        this.brushHardness = Math.max(0, Math.min(100, hardness | 0));
    }

    setBrushMode(mode) {
        if (mode === 'soft' || mode === 'pixel') {
            this.brushMode = mode;
        }
    }

    setFillTolerance(tolerance) {
        this.fillTolerance = Math.max(0, Math.min(255, tolerance | 0));
    }

    setFillContiguous(contiguous) {
        this.fillContiguous = !!contiguous;
    }

    setWandTolerance(tolerance) {
        this.wandTolerance = Math.max(0, Math.min(255, tolerance | 0));
    }

    setWandContiguous(contiguous) {
        this.wandContiguous = !!contiguous;
    }

    setPixelPerfectMode(enabled) {
        this.pixelPerfectMode = !!enabled;
    }

    /** Adjust brush size by a relative delta. */
    adjustBrushSize(delta) {
        // Non-linear step: bigger brushes change faster
        let step;
        if (this.brushSize <= 10) step = 1;
        else if (this.brushSize <= 50) step = 5;
        else if (this.brushSize <= 200) step = 10;
        else step = 25;

        this.setBrushSize(this.brushSize + step * delta);
        return this.brushSize; // Return so app.js can update slider UI
    }


    // ═════════════════════════════════════════════════════════
    // Event Attachment
    // ═════════════════════════════════════════════════════════

    /** @private */
    _attachEvents() {
        // Use capture phase so we see events before grid-canvas might block them
        this.viewport.addEventListener('pointerdown', this._onPointerDown, false);
        this.viewport.addEventListener('pointermove', this._onPointerMove, false);
        this.viewport.addEventListener('pointerup', this._onPointerUp, false);
        this.viewport.addEventListener('pointercancel', this._onPointerUp, false);
    }

    /** Remove all event listeners (cleanup). */
    destroy() {
        this.viewport.removeEventListener('pointerdown', this._onPointerDown, false);
        this.viewport.removeEventListener('pointermove', this._onPointerMove, false);
        this.viewport.removeEventListener('pointerup', this._onPointerUp, false);
        this.viewport.removeEventListener('pointercancel', this._onPointerUp, false);
    }


    // ═════════════════════════════════════════════════════════
    // Pointer Event Handlers
    // ═════════════════════════════════════════════════════════

    /** @private */
    _onPointerDown(e) {
        // Skip if engine is handling navigation (space+drag, pinch, middle-click)
        if (this.engine.isNavigating) return;
        if (this.engine.spaceHeld) return;
        if (this.engine.animationPlaying) return;

        // Only handle primary button (left click / touch)
        if (e.button !== 0) return;

        // Skip multi-touch (engine handles 2+ pointers for pinch/pan)
        if (this.engine.pointerCount > 1) return;

        // Skip if no active tool
        if (!this._activeTool) return;

        // Skip if already drawing with a different pointer
        if (this._isDrawing && this._drawingPointerId !== e.pointerId) return;

        // Convert screen coords to canvas document coords
        const pos = this.engine.screenToCanvas(e.clientX, e.clientY);

        this._isDrawing = true;
        this._drawingPointerId = e.pointerId;

        // Alpha lock: snapshot layer alpha before stroke so we can restore it after
        this._alphaLockSnap = null;
        if (this.engine.activeTarget === 'layer') {
            const realLayer = this.engine.getActiveLayerReal?.() || this.engine.layers[this.engine.activeLayerIndex];
            if (realLayer && realLayer.alphaLocked) {
                const w = this.engine.docWidth;
                const h = this.engine.docHeight;
                try { this._alphaLockSnap = realLayer.ctx.getImageData(0, 0, w, h); }
                catch { /* ignore */ }
            }
        }

        this._activeTool.onPointerDown(pos.x, pos.y, e);
    }

    /** @private */
    _onPointerMove(e) {
        // Only route to tool if actively drawing with this pointer
        if (!this._isDrawing) return;
        if (e.pointerId !== this._drawingPointerId) return;

        // If engine started navigating mid-stroke (e.g., second finger added), abort
        if (this.engine.isNavigating) {
            this._cancelStroke(e);
            return;
        }

        const pos = this.engine.screenToCanvas(e.clientX, e.clientY);
        this._activeTool.onPointerMove(pos.x, pos.y, e);
    }

    /** @private */
    _onPointerUp(e) {
        if (!this._isDrawing) return;
        if (e.pointerId !== this._drawingPointerId) return;

        const pos = this.engine.screenToCanvas(e.clientX, e.clientY);
        this._activeTool.onPointerUp(pos.x, pos.y, e);

        // Alpha lock: restore the original alpha channel after stroke
        if (this._alphaLockSnap) {
            const realLayer = this.engine.getActiveLayerReal?.() || this.engine.layers[this.engine.activeLayerIndex];
            if (realLayer && realLayer.alphaLocked) {
                const w = this.engine.docWidth;
                const h = this.engine.docHeight;
                try {
                    const current = realLayer.ctx.getImageData(0, 0, w, h);
                    const snap = this._alphaLockSnap;
                    for (let i = 3; i < current.data.length; i += 4) {
                        current.data[i] = snap.data[i]; // restore original alpha
                    }
                    realLayer.ctx.putImageData(current, 0, 0);
                    realLayer.markAllDirty();
                } catch { /* ignore */ }
            }
            this._alphaLockSnap = null;
        }

        this._isDrawing = false;
        this._drawingPointerId = -1;

        // Request recomposite to show the final result
        this.engine.requestComposite();
    }

    /** @private — Cancel an in-progress stroke (e.g., pinch started mid-draw). */
    _cancelStroke(e) {
        if (this._activeTool && this._isDrawing) {
            // Deliver a final up event at current position so the tool can clean up
            const pos = this.engine.screenToCanvas(e.clientX, e.clientY);
            this._activeTool.onPointerUp(pos.x, pos.y, e);
        }
        this._isDrawing = false;
        this._drawingPointerId = -1;
    }


    // ═════════════════════════════════════════════════════════
    // Cursor Management
    // ═════════════════════════════════════════════════════════

    /** @private */
    _updateCursor() {
        if (this._activeTool) {
            this.viewport.style.cursor = this._activeTool.getCursor();
        }
    }
}
