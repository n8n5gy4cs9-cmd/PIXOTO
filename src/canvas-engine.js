/* ═══════════════════════════════════════════════════════════════
   Pixoto — Canvas Engine (Phase 2)
   Layer system, compositing, zoom/pan, HiDPI, dirty-rect tracking.
   ═══════════════════════════════════════════════════════════════ */

import { AdjustmentLayer, applyAdjustment } from './filters/filters.js';
import { renderLayerEffects, hasEnabledEffect, cloneEffects } from './layer-styles.js';

// ─── Zoom level presets for step zoom (in/out buttons) ───
const ZOOM_PRESETS = [
    10, 15, 20, 25, 33, 50, 66, 75, 100,
    125, 150, 200, 300, 400, 500, 600,
    800, 1000, 1200, 1600, 2000
];

const MIN_ZOOM = 0.10;   // 10%
const MAX_ZOOM = 20.0;   // 2000%
const WHEEL_ZOOM_FACTOR = 1.08; // 8% per wheel tick


// ─── Mask compositing helper: converts grayscale mask canvas to alpha channel ───
function _grayscaleToAlpha(maskCanvas, w, h) {
    let alpha;
    try { alpha = new OffscreenCanvas(w, h); }
    catch { alpha = document.createElement('canvas'); alpha.width = w; alpha.height = h; }
    const alphaCtx = alpha.getContext('2d');
    alphaCtx.drawImage(maskCanvas, 0, 0);
    const data = alphaCtx.getImageData(0, 0, w, h);
    for (let i = 0; i < data.data.length; i += 4) {
        // Luminance formula: preserves perceptual brightness of colored masks
        const lum = Math.round(0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2]);
        data.data[i + 3] = data.data[i + 3] > 0 ? lum : 0;
    }
    alphaCtx.putImageData(data, 0, 0);
    return alpha;
}

// ─── Proxy returned by getActiveLayer() when activeTarget === 'mask' ───
// Routes drawing tool operations to the layer's mask canvas.
class _MaskLayerProxy {
    constructor(layer) {
        this._layer = layer;
        this.canvas = layer.mask;
        this.ctx = layer.mask.getContext('2d');
    }
    get id()             { return this._layer.id; }
    get name()           { return this._layer.name; }
    set name(v)          { this._layer.name = v; }
    get visible()        { return this._layer.visible; }
    set visible(v)       { this._layer.visible = v; }
    get locked()         { return this._layer.locked; }
    set locked(v)        { this._layer.locked = v; }
    get opacity()        { return this._layer.opacity; }
    set opacity(v)       { this._layer.opacity = v; }
    get blendMode()      { return this._layer.blendMode; }
    set blendMode(v)     { this._layer.blendMode = v; }
    get mask()           { return this._layer.mask; }
    get maskEnabled()    { return this._layer.maskEnabled; }
    get alphaLocked()    { return false; }
    get clippedToBelow() { return this._layer.clippedToBelow; }
    get dirty()          { return this._layer.dirty; }
    markDirty()          { this._layer.markAllDirty(); }
    markAllDirty()       { this._layer.markAllDirty(); }
    clearDirty()         { /* delegated to real layer */ }
    clear()              { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this._layer.markAllDirty(); }
    fill(color)          { this.ctx.fillStyle = color; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); this._layer.markAllDirty(); }
}


// ═══════════════════════════════════════════════════════════════
// Layer Class
// ═══════════════════════════════════════════════════════════════

export class Layer {
    /**
     * @param {number} width  - Layer width in pixels
     * @param {number} height - Layer height in pixels
     * @param {string} name   - Display name
     */
    constructor(width, height, name = 'Layer') {
        this.id = Date.now() + Math.floor(Math.random() * 10000);
        this.name = name;
        this.visible = true;
        this.locked = false;
        this.opacity = 1.0;           // 0–1
        this.blendMode = 'source-over'; // Canvas composite operation

        // Phase B — mask & alpha lock
        this.mask = null;             // OffscreenCanvas|HTMLCanvasElement|null
        this.maskEnabled = true;      // Shift+click to toggle
        this.alphaLocked = false;     // Prevent drawing on transparent pixels
        this.clippedToBelow = false;  // Clip layer to alpha of layer below
        this._maskProxy = null;       // Cached _MaskLayerProxy

        // P6 — non-destructive layer styles / effects (null = none)
        this.effects = null;

        // Phase C — group membership
        this.parent = null;           // Parent LayerGroup or null (top-level)

        // Create layer canvas (prefer OffscreenCanvas for performance)
        try {
            this.canvas = new OffscreenCanvas(width, height);
        } catch {
            this.canvas = document.createElement('canvas');
            this.canvas.width = width;
            this.canvas.height = height;
        }
        this.ctx = this.canvas.getContext('2d');

        // Dirty tracking — marks regions that need recompositing
        this._dirty = true;
        this._dirtyRect = { x: 0, y: 0, w: width, h: height };
    }

    get dirty() { return this._dirty; }

    /**
     * Mark a rectangular region as needing recomposite.
     * Expands existing dirty rect to include the new region.
     */
    markDirty(x, y, w, h) {
        if (!this._dirty) {
            this._dirty = true;
            this._dirtyRect = { x, y, w, h };
        } else {
            const r = this._dirtyRect;
            const nx = Math.min(r.x, x);
            const ny = Math.min(r.y, y);
            this._dirtyRect = {
                x: nx,
                y: ny,
                w: Math.max(r.x + r.w, x + w) - nx,
                h: Math.max(r.y + r.h, y + h) - ny
            };
        }
    }

    /** Mark the entire layer as dirty. */
    markAllDirty() {
        this._dirty = true;
        this._dirtyRect = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
    }

    /** Clear the dirty flag after compositing. */
    clearDirty() {
        this._dirty = false;
    }

    /** Clear all pixels on this layer. */
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.markAllDirty();
    }

    /** Fill this layer with a solid color. */
    fill(color) {
        this.ctx.fillStyle = color;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.markAllDirty();
    }

    /** Resize this layer, preserving existing content. */
    resize(newWidth, newHeight) {
        const copyW = Math.min(this.canvas.width, newWidth);
        const copyH = Math.min(this.canvas.height, newHeight);
        const old = this.ctx.getImageData(0, 0, copyW, copyH);
        this.canvas.width = newWidth;
        this.canvas.height = newHeight;
        this.ctx.putImageData(old, 0, 0);
        if (this.mask) {
            const maskCopyW = Math.min(this.mask.width, newWidth);
            const maskCopyH = Math.min(this.mask.height, newHeight);
            const maskOld = this.mask.getContext('2d').getImageData(0, 0, maskCopyW, maskCopyH);
            try { this.mask = new OffscreenCanvas(newWidth, newHeight); }
            catch { this.mask = document.createElement('canvas'); this.mask.width = newWidth; this.mask.height = newHeight; }
            this.mask.getContext('2d').putImageData(maskOld, 0, 0);
            this._maskProxy = null;
        }
        this.markAllDirty();
    }

    /**
     * Generate a small thumbnail canvas for the layers panel.
     * @param {number} size - Thumbnail dimension (square)
     * @returns {HTMLCanvasElement}
     */
    getThumbnail(size = 40) {
        const thumb = document.createElement('canvas');
        thumb.width = size;
        thumb.height = size;
        const ctx = thumb.getContext('2d');

        const scale = Math.min(size / this.canvas.width, size / this.canvas.height);
        const w = this.canvas.width * scale;
        const h = this.canvas.height * scale;
        const x = (size - w) / 2;
        const y = (size - h) / 2;

        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.canvas, x, y, w, h);
        return thumb;
    }

    // ── Phase B: Layer Mask Methods ───────────────────────────

    /** Add a white (reveal-all) or black (hide-all) mask to this layer. */
    addMask(white = true) {
        const w = this.canvas.width;
        const h = this.canvas.height;
        try { this.mask = new OffscreenCanvas(w, h); }
        catch { this.mask = document.createElement('canvas'); this.mask.width = w; this.mask.height = h; }
        const maskCtx = this.mask.getContext('2d');
        maskCtx.fillStyle = white ? '#ffffff' : '#000000';
        maskCtx.fillRect(0, 0, w, h);
        this.maskEnabled = true;
        this._maskProxy = null;
        this.markAllDirty();
    }

    /** Remove this layer's mask (non-destructive — layer content unchanged). */
    removeMask() {
        this.mask = null;
        this._maskProxy = null;
        this.markAllDirty();
    }

    /** Bake mask into layer alpha channel, then discard the mask. */
    applyMask() {
        if (!this.mask) return;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const layerData = this.ctx.getImageData(0, 0, w, h);
        const maskData  = this.mask.getContext('2d').getImageData(0, 0, w, h);
        for (let i = 0; i < layerData.data.length; i += 4) {
            const lum = Math.round(0.299 * maskData.data[i] + 0.587 * maskData.data[i + 1] + 0.114 * maskData.data[i + 2]);
            const maskAlpha = maskData.data[i + 3] > 0 ? lum : 0;
            layerData.data[i + 3] = Math.round(layerData.data[i + 3] * maskAlpha / 255);
        }
        this.ctx.putImageData(layerData, 0, 0);
        this.mask = null;
        this._maskProxy = null;
        this.markAllDirty();
    }

    /** Invert all values in the mask (white↔black). */
    invertMask() {
        if (!this.mask) return;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const maskCtx = this.mask.getContext('2d');
        const data = maskCtx.getImageData(0, 0, w, h);
        for (let i = 0; i < data.data.length; i += 4) {
            data.data[i]     = 255 - data.data[i];
            data.data[i + 1] = 255 - data.data[i + 1];
            data.data[i + 2] = 255 - data.data[i + 2];
        }
        maskCtx.putImageData(data, 0, 0);
        this.markAllDirty();
    }

    /**
     * Generate a small thumbnail of the mask for the layers panel.
     * @param {number} size - Square thumbnail dimension
     * @returns {HTMLCanvasElement|null}
     */
    getMaskThumbnail(size = 40) {
        if (!this.mask) return null;
        const thumb = document.createElement('canvas');
        thumb.width = size;
        thumb.height = size;
        const ctx = thumb.getContext('2d');
        const scale = Math.min(size / this.mask.width, size / this.mask.height);
        const dw = this.mask.width * scale;
        const dh = this.mask.height * scale;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.mask, (size - dw) / 2, (size - dh) / 2, dw, dh);
        return thumb;
    }

    /** Returns cached _MaskLayerProxy (routes drawing to mask canvas). */
    _getMaskProxy() {
        if (!this._maskProxy || this._maskProxy.canvas !== this.mask) {
            this._maskProxy = new _MaskLayerProxy(this);
        }
        return this._maskProxy;
    }
}


// ═══════════════════════════════════════════════════════════════
// LayerGroup Class  (Phase C)
// ═══════════════════════════════════════════════════════════════

export class LayerGroup {
    /**
     * @param {string} name - Display name
     */
    constructor(name = 'Group') {
        this.id = Date.now() + Math.floor(Math.random() * 10000);
        this.name = name;
        this.visible = true;
        this.locked = false;
        this.opacity = 1.0;
        this.blendMode = 'source-over';
        this.children = [];     // Array of Layer | LayerGroup (direct children)
        this.parent = null;     // Parent LayerGroup or null (top-level)
        this.collapsed = false; // Collapsed in layers panel
    }

    get dirty() { return this.children.some(c => c.dirty); }
    clearDirty() { this.children.forEach(c => c.clearDirty()); }
    markAllDirty() { this.children.forEach(c => c.markAllDirty()); }
}


// ═══════════════════════════════════════════════════════════════
// Canvas Engine
// ═══════════════════════════════════════════════════════════════

export class CanvasEngine {
    /**
     * @param {HTMLCanvasElement} displayCanvas - Main composited display
     * @param {HTMLCanvasElement} gridCanvas    - Pixel grid overlay
     * @param {HTMLCanvasElement} uiCanvas      - UI overlay (selection, guides)
     * @param {HTMLElement}       viewportEl    - Pan/zoom viewport container
     * @param {HTMLElement}       wrapperEl     - CSS-transformed wrapper
     */
    constructor(displayCanvas, gridCanvas, uiCanvas, viewportEl, wrapperEl) {
        // Canvas elements
        this.display = displayCanvas;
        this.displayCtx = displayCanvas.getContext('2d');
        this.gridCanvas = gridCanvas;
        this.gridCtx = gridCanvas.getContext('2d');
        this.uiCanvas = uiCanvas;
        this.uiCtx = uiCanvas.getContext('2d');
        this.viewport = viewportEl;
        this.wrapper = wrapperEl;

        // Document dimensions (image size, not viewport)
        this.docWidth = 800;
        this.docHeight = 600;

        // Layer stack — flat list of ALL leaf Layer objects (bottom = index 0)
        this.layers = [];
        this.activeLayerIndex = 0;

        // Phase C — hierarchical group tree
        // members = top-level items (Layer | LayerGroup); groups contain children recursively
        this.members = [];
        // Active member can be a Layer (for drawing) or LayerGroup (for opacity/blend UI)
        this.activeMember = null;

        // P7 — animation: onion-skin ghosts to draw under the current frame,
        // and a flag tools check to suspend input during playback.
        this.onionFrames = [];      // [{ members, tint, alpha }]
        this.animationPlaying = false;

        // P9 — view aids
        this.viewRotation = 0;       // radians; CSS-rotates the wrapper
        this.referenceLayer = null;  // { canvas, x, y, scale, opacity, visible, below }
        this.guides = { v: [], h: [] }; // vertical guides at doc-x, horizontal at doc-y
        this.onRotationChange = null;
        this.onViewTransform = null;  // fired on pan/zoom/rotate (rulers/guides redraw)
        this._pinchPrevAngle = null;

        // ── View transform ──
        this.zoom = 1.0;   // 1.0 = 100%
        this.panX = 0;     // Viewport-local pixel offset
        this.panY = 0;

        // ── Rendering mode ──
        this.pixelArtMode = false;

        // ── Navigation state ──
        this.spaceHeld = false;
        this._isPanning = false;
        this._panStartX = 0;
        this._panStartY = 0;
        this._panStartPanX = 0;
        this._panStartPanY = 0;

        // Multi-touch tracking (pinch zoom + two-finger pan)
        this._pointers = new Map();      // pointerId → { x, y }
        this._pinchPrevDist = 0;
        this._pinchPrevMidX = 0;
        this._pinchPrevMidY = 0;
        this._gestureActive = false;     // True during/after multi-touch until all released

        // ── HiDPI ──
        this.dpr = window.devicePixelRatio || 1;

        // ── Compositing ──
        this._needsComposite = true;
        this._rafId = null;
        this._isRunning = false;

        // ── Phase B — mask editing state ──
        this.activeTarget = 'layer';     // 'layer' | 'mask' — which target drawing goes to
        this.maskViewLayer = null;       // Layer currently shown as grayscale mask view

        // ── Callbacks (set by app.js) ──
        this.onZoomChange = null;        // (zoomPercent: number) => void
        this.onCursorMove = null;        // (canvasX: number, canvasY: number) => void
        this.onLayerChange = null;       // () => void
        this.onActiveLayerChange = null; // (index: number) => void
        this.onThreeFingerTap = null;    // () => void
        this.onActiveTargetChange = null;  // (target: 'layer'|'mask') => void
        this.onActiveMemberChange = null;  // (member: Layer|LayerGroup|null) => void

        // ── Pixel engine reference (set by app.js after creation) ──
        this.pixelEngine = null;

        // ── Bound event handlers ──
        this._boundWheel = this._onWheel.bind(this);
        this._boundPointerDown = this._onPointerDown.bind(this);
        this._boundPointerMove = this._onPointerMove.bind(this);
        this._boundPointerUp = this._onPointerUp.bind(this);
        this._boundContextMenu = (e) => e.preventDefault();
    }


    // ═════════════════════════════════════════════════════════
    // Lifecycle
    // ═════════════════════════════════════════════════════════

    /**
     * Initialize (or re-initialize) the engine with document dimensions.
     * Creates one background layer and starts the render loop.
     */
    init(width, height, bgColor = null) {
        console.log(`[CanvasEngine] init(${width}, ${height}, ${bgColor})`);

        // Tear down previous state if re-initializing
        if (this._isRunning) {
            this._stopRenderLoop();
            this._detachEvents();
        }

        this.docWidth = width;
        this.docHeight = height;

        // Size the display and overlay canvases
        this._sizeCanvases(width, height);

        // Reset layer stack
        this.layers = [];
        this.activeLayerIndex = 0;
        this.members = [];
        this.activeMember = null;
        this.activeTarget = 'layer';
        this.maskViewLayer = null;

        // Create the initial background layer
        const bg = new Layer(width, height, 'Background');
        if (bgColor) {
            bg.fill(bgColor);
        }
        this.layers.push(bg);
        this.members.push(bg);

        // Fit canvas nicely in the viewport
        this.fitToScreen();

        // Start the compositing render loop
        this._needsComposite = true;
        this._startRenderLoop();

        // Attach navigation event listeners
        this._attachEvents();

        // Notify listeners
        this.activeMember = bg;
        if (this.onLayerChange) this.onLayerChange();
        if (this.onActiveLayerChange) this.onActiveLayerChange(0);
        if (this.onActiveMemberChange) this.onActiveMemberChange(bg);
    }

    /** Clean up event listeners and stop render loop. */
    destroy() {
        this._stopRenderLoop();
        this._detachEvents();
    }


    // ═════════════════════════════════════════════════════════
    // Layer Management
    // ═════════════════════════════════════════════════════════

    /**
     * Returns the active layer. When activeTarget === 'mask', returns a proxy
     * that routes drawing tool operations to the layer's mask canvas.
     * @returns {Layer|_MaskLayerProxy|null}
     */
    getActiveLayer() {
        const layer = this.layers[this.activeLayerIndex] || null;
        if (!layer) return null;
        if (this.activeTarget === 'mask' && layer.mask) {
            return layer._getMaskProxy();
        }
        return layer;
    }

    /** Returns the real Layer at the active index (never a mask proxy). */
    getActiveLayerReal() {
        return this.layers[this.activeLayerIndex] || null;
    }

    /** @returns {Layer|null} */
    getLayer(index) {
        return this.layers[index] || null;
    }

    /** @returns {number} */
    getLayerCount() {
        return this.layers.length;
    }

    /** Set the active layer by index (indexes engine.layers leaf list). Exits mask edit mode if new layer has no mask. */
    setActiveLayer(index) {
        if (index < 0 || index >= this.layers.length) return;
        this.activeLayerIndex = index;
        this.activeMember = this.layers[index];
        // Exit mask mode if the new layer has no mask
        if (this.activeTarget === 'mask' && !this.layers[index]?.mask) {
            this.activeTarget = 'layer';
            if (this.onActiveTargetChange) this.onActiveTargetChange('layer', null);
        }
        if (this.onActiveLayerChange) this.onActiveLayerChange(index);
        if (this.onActiveMemberChange) this.onActiveMemberChange(this.activeMember);
    }

    /** Set the active member to a LayerGroup (for UI opacity/blend controls). */
    setActiveGroup(group) {
        this.activeMember = group;
        if (this.onActiveMemberChange) this.onActiveMemberChange(group);
    }

    /**
     * Rebuild engine.layers (flat leaf list) from engine.members tree.
     * Call after any structural change to the group tree.
     * @private
     */
    _syncLayers() {
        const flat = [];
        function walk(children) {
            for (const m of children) {
                if (m instanceof LayerGroup) {
                    walk(m.children);
                } else {
                    flat.push(m);
                }
            }
        }
        walk(this.members);
        this.layers = flat;
        // Clamp activeLayerIndex
        if (this.activeLayerIndex >= this.layers.length) {
            this.activeLayerIndex = Math.max(0, this.layers.length - 1);
        }
        this.activeMember = this.layers[this.activeLayerIndex] || null;
    }

    /**
     * Find the parent group of a member, and its siblings array.
     * Returns { parent: LayerGroup|null, siblings: Array } where siblings is the array containing member.
     * @private
     */
    _findParent(member) {
        function search(list, target) {
            for (const m of list) {
                if (m === target) return { parent: null, siblings: list };
                if (m instanceof LayerGroup) {
                    const r = search(m.children, target);
                    if (r) return r.parent === null ? { parent: m, siblings: m.children } : r;
                }
            }
            return null;
        }
        const r = search(this.members, member);
        if (!r) return { parent: null, siblings: this.members };
        // If search found it in a child, recalculate
        return this._findParentInternal(member);
    }

    /** @private */
    _findParentInternal(member) {
        function search(list, parent) {
            for (const m of list) {
                if (m === member) return { parent, siblings: list };
                if (m instanceof LayerGroup) {
                    const r = search(m.children, m);
                    if (r) return r;
                }
            }
            return null;
        }
        return search(this.members, null) || { parent: null, siblings: this.members };
    }

    /** @private Find the depth of a member in the tree (0 = top-level). */
    _getMemberDepth(member) {
        function search(list, depth) {
            for (const m of list) {
                if (m === member) return depth;
                if (m instanceof LayerGroup) {
                    const d = search(m.children, depth + 1);
                    if (d >= 0) return d;
                }
            }
            return -1;
        }
        return search(this.members, 0);
    }

    /** Add a new empty layer above the active layer (inside active group if any). Returns the new Layer. */
    addLayer(name = null) {
        const n = name || `Layer ${this.layers.length + 1}`;
        const layer = new Layer(this.docWidth, this.docHeight, n);
        const activeLayer = this.layers[this.activeLayerIndex];
        if (activeLayer) {
            const { parent, siblings } = this._findParentInternal(activeLayer);
            const pos = siblings.indexOf(activeLayer);
            siblings.splice(pos + 1, 0, layer);
            layer.parent = parent;
        } else {
            this.members.push(layer);
        }
        this._syncLayers();
        this.activeLayerIndex = this.layers.indexOf(layer);
        this.activeMember = layer;
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
        if (this.onActiveLayerChange) this.onActiveLayerChange(this.activeLayerIndex);
        if (this.onActiveMemberChange) this.onActiveMemberChange(layer);
        return layer;
    }

    /**
     * Insert an existing member (e.g. an AdjustmentLayer) above the active layer
     * in the members tree, keeping engine.layers/members in sync so it composites.
     * Returns the inserted member.
     */
    addAdjustmentLayer(member) {
        const activeLayer = this.layers[this.activeLayerIndex];
        if (activeLayer) {
            const { parent, siblings } = this._findParentInternal(activeLayer);
            const pos = siblings.indexOf(activeLayer);
            siblings.splice(pos + 1, 0, member);
            member.parent = parent;
        } else {
            this.members.push(member);
            member.parent = null;
        }
        this._syncLayers();
        const idx = this.layers.indexOf(member);
        if (idx >= 0) this.activeLayerIndex = idx;
        this.activeMember = member;
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
        if (this.onActiveLayerChange) this.onActiveLayerChange(this.activeLayerIndex);
        if (this.onActiveMemberChange) this.onActiveMemberChange(member);
        return member;
    }

    /** Delete a layer by index (defaults to active). Can't delete the last layer. */
    deleteLayer(index = null) {
        const idx = index ?? this.activeLayerIndex;
        if (this.layers.length <= 1) return;
        if (idx < 0 || idx >= this.layers.length) return;
        const layer = this.layers[idx];
        // Remove from tree
        const { siblings } = this._findParentInternal(layer);
        const pos = siblings.indexOf(layer);
        if (pos >= 0) siblings.splice(pos, 1);
        this._syncLayers();
        this.activeLayerIndex = Math.max(0, Math.min(idx, this.layers.length - 1));
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
        if (this.onActiveLayerChange) this.onActiveLayerChange(this.activeLayerIndex);
    }

    /** Duplicate a layer. Returns the new Layer. */
    duplicateLayer(index = null) {
        const idx = index ?? this.activeLayerIndex;
        const src = this.layers[idx];
        if (!src) return null;

        const dup = new Layer(this.docWidth, this.docHeight, `${src.name} copy`);
        dup.opacity = src.opacity;
        dup.blendMode = src.blendMode;
        dup.visible = src.visible;
        dup.alphaLocked = src.alphaLocked;
        dup.clippedToBelow = src.clippedToBelow;
        dup.ctx.drawImage(src.canvas, 0, 0);
        if (src.mask) {
            const mw = src.mask.width;
            const mh = src.mask.height;
            try { dup.mask = new OffscreenCanvas(mw, mh); }
            catch { dup.mask = document.createElement('canvas'); dup.mask.width = mw; dup.mask.height = mh; }
            dup.mask.getContext('2d').drawImage(src.mask, 0, 0);
            dup.maskEnabled = src.maskEnabled;
        }
        dup.markAllDirty();

        // Insert copy next to original in tree
        const { parent, siblings } = this._findParentInternal(src);
        const pos = siblings.indexOf(src);
        siblings.splice(pos + 1, 0, dup);
        dup.parent = parent;
        this._syncLayers();
        this.activeLayerIndex = this.layers.indexOf(dup);
        this.activeMember = dup;

        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
        if (this.onActiveLayerChange) this.onActiveLayerChange(this.activeLayerIndex);
        return dup;
    }

    /**
     * Move a layer/group from one flat index to another within the same parent container.
     * For cross-group moves, use moveMember().
     */
    reorderLayer(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        if (fromIndex < 0 || fromIndex >= this.layers.length) return;
        if (toIndex < 0 || toIndex >= this.layers.length) return;

        const layerFrom = this.layers[fromIndex];
        const layerTo = this.layers[toIndex];
        const { siblings: fromSibs } = this._findParentInternal(layerFrom);
        const { siblings: toSibs } = this._findParentInternal(layerTo);

        if (fromSibs === toSibs) {
            // Same container: reorder within it
            const fPos = fromSibs.indexOf(layerFrom);
            const tPos = toSibs.indexOf(layerTo);
            fromSibs.splice(fPos, 1);
            fromSibs.splice(tPos, 0, layerFrom);
        } else {
            // Cross-group: move layerFrom to target container
            fromSibs.splice(fromSibs.indexOf(layerFrom), 1);
            const tPos = toSibs.indexOf(layerTo);
            toSibs.splice(tPos, 0, layerFrom);
            layerFrom.parent = layerTo.parent;
        }

        this._syncLayers();
        this.activeLayerIndex = this.layers.indexOf(layerFrom);
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
    }

    /**
     * Move any member (Layer or LayerGroup) to a target container at a target position.
     * @param {Layer|LayerGroup} member
     * @param {Layer[]|null} targetSiblings - null means top-level
     * @param {number} targetPos - position in targetSiblings (appended if >= length)
     */
    moveMember(member, targetSiblings, targetPos) {
        const { siblings: fromSibs } = this._findParentInternal(member);
        fromSibs.splice(fromSibs.indexOf(member), 1);
        const dest = targetSiblings || this.members;
        targetPos = Math.max(0, Math.min(targetPos, dest.length));
        dest.splice(targetPos, 0, member);
        // Update parent reference
        if (dest === this.members) {
            member.parent = null;
        } else {
            // Find which group owns dest
            const findGroup = (list) => {
                for (const m of list) {
                    if (m instanceof LayerGroup) {
                        if (m.children === dest) return m;
                        const r = findGroup(m.children);
                        if (r) return r;
                    }
                }
                return null;
            };
            member.parent = findGroup(this.members);
        }
        this._syncLayers();
        if (member instanceof Layer) this.activeLayerIndex = this.layers.indexOf(member);
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
    }

    /** Merge active layer down onto the one below it (within the same parent). */
    mergeDown(index = null) {
        const idx = index ?? this.activeLayerIndex;
        if (idx <= 0 || idx >= this.layers.length) return;

        const upper = this.layers[idx];
        const lower = this.layers[idx - 1];

        // Only merge if in the same parent
        if (upper.parent !== lower.parent) return;

        lower.ctx.globalAlpha = upper.opacity;
        lower.ctx.globalCompositeOperation = upper.blendMode;
        lower.ctx.drawImage(upper.canvas, 0, 0);
        lower.ctx.globalAlpha = 1;
        lower.ctx.globalCompositeOperation = 'source-over';
        lower.markAllDirty();

        // Remove upper from tree
        const { siblings } = this._findParentInternal(upper);
        siblings.splice(siblings.indexOf(upper), 1);
        this._syncLayers();
        this.activeLayerIndex = this.layers.indexOf(lower);

        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
        if (this.onActiveLayerChange) this.onActiveLayerChange(this.activeLayerIndex);
    }

    /** Merge all visible layers into one (uses flattened canvas for groups). */
    mergeVisible() {
        const merged = new Layer(this.docWidth, this.docHeight, 'Merged');
        const flat = this.getFlattenedCanvas();
        merged.ctx.drawImage(flat, 0, 0);
        merged.markAllDirty();
        this.layers = [merged];
        this.members = [merged];
        this.activeLayerIndex = 0;
        this.activeMember = merged;
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
        if (this.onActiveLayerChange) this.onActiveLayerChange(0);
        return merged;
    }

    /** Flatten all layers into a single layer. */
    flattenAll() {
        const result = new Layer(this.docWidth, this.docHeight, 'Background');
        const flat = this.getFlattenedCanvas();
        result.ctx.drawImage(flat, 0, 0);
        result.markAllDirty();
        this.layers = [result];
        this.members = [result];
        this.activeLayerIndex = 0;
        this.activeMember = result;
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
        if (this.onActiveLayerChange) this.onActiveLayerChange(0);
        return result;
    }

    setLayerOpacity(index, opacity) {
        const layer = this.layers[index];
        if (!layer) return;
        layer.opacity = Math.max(0, Math.min(1, opacity));
        layer.markAllDirty();
        this._needsComposite = true;
    }

    setLayerBlendMode(index, mode) {
        const layer = this.layers[index];
        if (!layer) return;
        layer.blendMode = mode;
        layer.markAllDirty();
        this._needsComposite = true;
    }

    setLayerVisibility(index, visible) {
        const layer = this.layers[index];
        if (!layer) return;
        layer.visible = visible;
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
    }

    setLayerLocked(index, locked) {
        const layer = this.layers[index];
        if (!layer) return;
        layer.locked = locked;
        if (this.onLayerChange) this.onLayerChange();
    }

    renameLayer(index, name) {
        const layer = this.layers[index];
        if (!layer) return;
        layer.name = name;
        if (this.onLayerChange) this.onLayerChange();
    }


    // ═════════════════════════════════════════════════════════
    // Phase B — Mask & Alpha Lock Management
    // ═════════════════════════════════════════════════════════

    /**
     * Switch drawing target between 'layer' and 'mask'.
     * Does nothing if switching to mask on a layer that has no mask.
     */
    setActiveTarget(target) {
        if (target === 'mask') {
            const layer = this.layers[this.activeLayerIndex];
            if (!layer || !layer.mask) return;
        }
        this.activeTarget = target;
        this._needsComposite = true;
        if (this.onActiveTargetChange) this.onActiveTargetChange(target, this.layers[this.activeLayerIndex] || null);
        if (this.onLayerChange) this.onLayerChange();
    }

    /**
     * Enable or disable grayscale mask view for a layer (Alt+click on mask thumb).
     * When enabled, the display shows only that layer's mask as grayscale.
     */
    setMaskViewMode(layer, enabled) {
        this.maskViewLayer = enabled ? layer : null;
        this._needsComposite = true;
    }

    /** Add a white (reveal-all) or black (hide-all) mask to a layer. */
    addMaskToLayer(index = null, white = true) {
        const idx = index ?? this.activeLayerIndex;
        const layer = this.layers[idx];
        if (!layer) return;
        layer.addMask(white);
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
    }

    /** Remove mask from a layer (non-destructive). */
    removeMaskFromLayer(index = null) {
        const idx = index ?? this.activeLayerIndex;
        const layer = this.layers[idx];
        if (!layer) return;
        if (this.maskViewLayer === layer) this.maskViewLayer = null;
        if (this.activeTarget === 'mask' && this.activeLayerIndex === idx) {
            this.activeTarget = 'layer';
            if (this.onActiveTargetChange) this.onActiveTargetChange('layer', null);
        }
        layer.removeMask();
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
    }

    /** Bake mask into layer alpha, then discard mask. */
    applyMaskToLayer(index = null) {
        const idx = index ?? this.activeLayerIndex;
        const layer = this.layers[idx];
        if (!layer || !layer.mask) return;
        if (this.maskViewLayer === layer) this.maskViewLayer = null;
        if (this.activeTarget === 'mask' && this.activeLayerIndex === idx) {
            this.activeTarget = 'layer';
            if (this.onActiveTargetChange) this.onActiveTargetChange('layer', null);
        }
        layer.applyMask();
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
    }

    /** Invert the mask on a layer. */
    invertMaskOnLayer(index = null) {
        const idx = index ?? this.activeLayerIndex;
        const layer = this.layers[idx];
        if (!layer || !layer.mask) return;
        layer.invertMask();
        this._needsComposite = true;
    }

    /** Toggle mask enabled/disabled on a layer. */
    toggleMaskEnabled(index = null) {
        const idx = index ?? this.activeLayerIndex;
        const layer = this.layers[idx];
        if (!layer || !layer.mask) return;
        layer.maskEnabled = !layer.maskEnabled;
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
    }

    /** Toggle alpha lock on a layer (painting only affects existing opaque pixels). */
    toggleAlphaLock(index = null) {
        const idx = index ?? this.activeLayerIndex;
        const layer = this.layers[idx];
        if (!layer) return;
        layer.alphaLocked = !layer.alphaLocked;
        if (this.onLayerChange) this.onLayerChange();
    }

    /** Toggle clip-to-below on a layer (clips to alpha of layer directly below). */
    toggleClipToBelow(index = null) {
        const idx = index ?? this.activeLayerIndex;
        const layer = this.layers[idx];
        if (!layer) return;
        layer.clippedToBelow = !layer.clippedToBelow;
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
    }


    // ═════════════════════════════════════════════════════════
    // Phase C — Layer Group Management
    // ═════════════════════════════════════════════════════════

    /**
     * Create a group from the currently selected layers.
     * If layerIndices is provided, those layers are grouped; otherwise groups active layer alone.
     * @param {string} [name='Group']
     * @param {number[]} [layerIndices] - Indices in engine.layers to group
     * @returns {LayerGroup}
     */
    createGroup(name = 'Group', layerIndices = null) {
        const indices = layerIndices
            ? [...new Set(layerIndices)].sort((a, b) => a - b)
            : [this.activeLayerIndex];

        const toLayers = indices.map(i => this.layers[i]).filter(Boolean);
        if (!toLayers.length) return null;

        // Check max nesting depth (4 levels)
        const maxDepth = Math.max(...toLayers.map(l => this._getMemberDepth(l)));
        if (maxDepth >= 4) return null; // Would exceed nesting limit

        const group = new LayerGroup(name);

        // Use the position of the first (bottom-most) selected layer in its container
        const firstLayer = toLayers[0];
        const { parent, siblings } = this._findParentInternal(firstLayer);
        const insertPos = siblings.indexOf(firstLayer);

        // Remove all selected layers from their current positions
        for (const layer of toLayers) {
            const { siblings: s } = this._findParentInternal(layer);
            s.splice(s.indexOf(layer), 1);
            layer.parent = group;
            group.children.push(layer);
        }

        // Insert group at original position of first selected layer
        const destSibs = parent ? parent.children : this.members;
        const pos = Math.min(insertPos, destSibs.length);
        destSibs.splice(pos, 0, group);
        group.parent = parent;

        this._syncLayers();
        this.activeLayerIndex = this.layers.indexOf(toLayers[0]);
        this.activeMember = group;
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
        if (this.onActiveMemberChange) this.onActiveMemberChange(group);
        return group;
    }

    /**
     * Ungroup: move all children of a group up to the group's parent level.
     * @param {LayerGroup} group
     */
    ungroup(group) {
        if (!(group instanceof LayerGroup)) return;
        const { parent, siblings } = this._findParentInternal(group);
        const groupPos = siblings.indexOf(group);

        // Insert children in place of the group
        const children = [...group.children];
        siblings.splice(groupPos, 1); // Remove group
        for (let i = 0; i < children.length; i++) {
            children[i].parent = parent;
            siblings.splice(groupPos + i, 0, children[i]);
        }
        group.children = [];

        this._syncLayers();
        this.activeLayerIndex = Math.max(0, Math.min(this.activeLayerIndex, this.layers.length - 1));
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
    }

    /**
     * Merge a group into a single flat layer.
     * @param {LayerGroup} group
     * @returns {Layer}
     */
    mergeGroup(group) {
        if (!(group instanceof LayerGroup)) return null;
        const w = this.docWidth;
        const h = this.docHeight;
        const merged = new Layer(w, h, group.name);
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = w; tmpCanvas.height = h;
        const tmpCtx = tmpCanvas.getContext('2d');
        this._compositeMembers(group.children, tmpCtx, w, h);
        merged.ctx.globalAlpha = 1;
        merged.ctx.drawImage(tmpCanvas, 0, 0);
        merged.opacity = group.opacity;
        merged.blendMode = group.blendMode;
        merged.markAllDirty();

        const { parent, siblings } = this._findParentInternal(group);
        const pos = siblings.indexOf(group);
        siblings.splice(pos, 1, merged); // Replace group with merged layer
        merged.parent = parent;

        this._syncLayers();
        this.activeLayerIndex = this.layers.indexOf(merged);
        this.activeMember = merged;
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
        return merged;
    }

    /**
     * Delete a group.
     * @param {LayerGroup} group
     * @param {boolean} [keepChildren=false] - Keep children (moves them to parent) or delete all
     */
    deleteGroup(group, keepChildren = false) {
        if (!(group instanceof LayerGroup)) return;
        const { parent, siblings } = this._findParentInternal(group);
        const pos = siblings.indexOf(group);
        if (keepChildren) {
            siblings.splice(pos, 1);
            const dest = parent ? parent.children : this.members;
            for (let i = 0; i < group.children.length; i++) {
                group.children[i].parent = parent;
                dest.splice(pos + i, 0, group.children[i]);
            }
        } else {
            siblings.splice(pos, 1);
        }
        this._syncLayers();
        this.activeLayerIndex = Math.max(0, Math.min(this.activeLayerIndex, this.layers.length - 1));
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
    }

    /**
     * Duplicate a group (deep copy of all children).
     * @param {LayerGroup} group
     * @returns {LayerGroup}
     */
    duplicateGroup(group) {
        if (!(group instanceof LayerGroup)) return null;
        const dup = this._deepCopyGroup(group);

        const { parent, siblings } = this._findParentInternal(group);
        const pos = siblings.indexOf(group);
        siblings.splice(pos + 1, 0, dup);
        dup.parent = parent;

        this._syncLayers();
        this._needsComposite = true;
        if (this.onLayerChange) this.onLayerChange();
        return dup;
    }

    /** @private Deep-copy a LayerGroup. */
    _deepCopyGroup(group) {
        const dup = new LayerGroup(`${group.name} copy`);
        dup.opacity = group.opacity;
        dup.blendMode = group.blendMode;
        dup.visible = group.visible;
        dup.locked = group.locked;
        for (const child of group.children) {
            if (child instanceof LayerGroup) {
                const childDup = this._deepCopyGroup(child);
                childDup.parent = dup;
                dup.children.push(childDup);
            } else {
                const childDup = this.duplicateLayerObject(child);
                childDup.parent = dup;
                dup.children.push(childDup);
            }
        }
        return dup;
    }

    /** Create a duplicate Layer object without inserting it into the tree. */
    duplicateLayerObject(src) {
        const dup = new Layer(this.docWidth, this.docHeight, `${src.name} copy`);
        dup.opacity = src.opacity;
        dup.blendMode = src.blendMode;
        dup.visible = src.visible;
        dup.alphaLocked = src.alphaLocked;
        dup.clippedToBelow = src.clippedToBelow;
        dup.ctx.drawImage(src.canvas, 0, 0);
        if (src.mask) {
            try { dup.mask = new OffscreenCanvas(src.mask.width, src.mask.height); }
            catch { dup.mask = document.createElement('canvas'); dup.mask.width = src.mask.width; dup.mask.height = src.mask.height; }
            dup.mask.getContext('2d').drawImage(src.mask, 0, 0);
            dup.maskEnabled = src.maskEnabled;
        }
        dup.effects = src.effects ? cloneEffects(src.effects) : null;
        dup.markAllDirty();
        return dup;
    }

    /** Toggle group collapse state in the layers panel. */
    toggleGroupCollapsed(group) {
        if (!(group instanceof LayerGroup)) return;
        group.collapsed = !group.collapsed;
        if (this.onLayerChange) this.onLayerChange();
    }

    /** Set group opacity (activeMember must be a LayerGroup). */
    setGroupOpacity(group, opacity) {
        if (!(group instanceof LayerGroup)) return;
        group.opacity = Math.max(0, Math.min(1, opacity));
        this._needsComposite = true;
    }

    /** Set group blend mode. */
    setGroupBlendMode(group, mode) {
        if (!(group instanceof LayerGroup)) return;
        group.blendMode = mode;
        this._needsComposite = true;
    }


    // ═════════════════════════════════════════════════════════
    // Document Resize
    // ═════════════════════════════════════════════════════════

    /**
     * Resize the image — scales all layer content to new dimensions.
     * @param {number} newW - New width
     * @param {number} newH - New height
     * @param {boolean} [smooth=true] - Bilinear (true) or nearest-neighbor (false)
     */
    resizeImage(newW, newH, smooth = true) {
        newW = Math.max(1, Math.min(8192, Math.round(newW)));
        newH = Math.max(1, Math.min(8192, Math.round(newH)));
        const oldW = this.docWidth;
        const oldH = this.docHeight;

        for (const layer of this.layers) {
            // Save old content to a temporary canvas
            const temp = document.createElement('canvas');
            temp.width = oldW;
            temp.height = oldH;
            temp.getContext('2d').drawImage(layer.canvas, 0, 0);

            // Resize layer buffer (clears content + ctx state)
            layer.canvas.width = newW;
            layer.canvas.height = newH;

            // Draw scaled content
            layer.ctx.imageSmoothingEnabled = smooth;
            if (smooth) layer.ctx.imageSmoothingQuality = 'high';
            layer.ctx.drawImage(temp, 0, 0, newW, newH);

            // Resize mask if present
            if (layer.mask) {
                const maskTemp = document.createElement('canvas');
                maskTemp.width = oldW; maskTemp.height = oldH;
                maskTemp.getContext('2d').drawImage(layer.mask, 0, 0);
                try { layer.mask = new OffscreenCanvas(newW, newH); }
                catch { layer.mask = document.createElement('canvas'); layer.mask.width = newW; layer.mask.height = newH; }
                const maskCtx = layer.mask.getContext('2d');
                maskCtx.imageSmoothingEnabled = smooth;
                if (smooth) maskCtx.imageSmoothingQuality = 'high';
                maskCtx.drawImage(maskTemp, 0, 0, newW, newH);
                layer._maskProxy = null;
            }

            layer.markAllDirty();
        }

        this.docWidth = newW;
        this.docHeight = newH;
        this._sizeCanvases(newW, newH);
        this._needsComposite = true;
        this.fitToScreen();

        if (this.onLayerChange) this.onLayerChange();
        console.log(`[CanvasEngine] resizeImage(${newW}, ${newH}, smooth=${smooth})`);
    }

    /**
     * Resize the canvas — changes document size without scaling content.
     * Existing pixel data is repositioned based on the anchor point.
     * @param {number} newW - New width
     * @param {number} newH - New height
     * @param {number} [anchorX=0] - Horizontal anchor: -1 (left), 0 (center), 1 (right)
     * @param {number} [anchorY=0] - Vertical anchor: -1 (top), 0 (center), 1 (bottom)
     */
    resizeCanvas(newW, newH, anchorX = 0, anchorY = 0) {
        newW = Math.max(1, Math.min(8192, Math.round(newW)));
        newH = Math.max(1, Math.min(8192, Math.round(newH)));
        const oldW = this.docWidth;
        const oldH = this.docHeight;

        // Calculate content offset based on anchor
        let offsetX, offsetY;
        if (anchorX === -1) offsetX = 0;
        else if (anchorX === 1) offsetX = newW - oldW;
        else offsetX = Math.round((newW - oldW) / 2);

        if (anchorY === -1) offsetY = 0;
        else if (anchorY === 1) offsetY = newH - oldH;
        else offsetY = Math.round((newH - oldH) / 2);

        for (const layer of this.layers) {
            // Save old content
            const temp = document.createElement('canvas');
            temp.width = oldW;
            temp.height = oldH;
            temp.getContext('2d').drawImage(layer.canvas, 0, 0);

            // Resize layer buffer (clears it)
            layer.canvas.width = newW;
            layer.canvas.height = newH;

            // Place old content at offset (no scaling)
            layer.ctx.drawImage(temp, offsetX, offsetY);

            // Resize mask if present
            if (layer.mask) {
                const maskTemp = document.createElement('canvas');
                maskTemp.width = oldW; maskTemp.height = oldH;
                maskTemp.getContext('2d').drawImage(layer.mask, 0, 0);
                try { layer.mask = new OffscreenCanvas(newW, newH); }
                catch { layer.mask = document.createElement('canvas'); layer.mask.width = newW; layer.mask.height = newH; }
                // White-fill new mask area (reveal-all for expanded area)
                const maskCtx = layer.mask.getContext('2d');
                maskCtx.fillStyle = '#ffffff';
                maskCtx.fillRect(0, 0, newW, newH);
                maskCtx.drawImage(maskTemp, offsetX, offsetY);
                layer._maskProxy = null;
            }

            layer.markAllDirty();
        }

        this.docWidth = newW;
        this.docHeight = newH;
        this._sizeCanvases(newW, newH);
        this._needsComposite = true;
        this.fitToScreen();

        if (this.onLayerChange) this.onLayerChange();
        console.log(`[CanvasEngine] resizeCanvas(${newW}, ${newH}, anchor=${anchorX},${anchorY}, offset=${offsetX},${offsetY})`);
    }


    // ═════════════════════════════════════════════════════════
    // P3 — Rotate / Flip / Trim (whole-document operations)
    // Every op transforms ALL layers + their masks, then re-sizes canvases.
    // Lossless (no smoothing) for flip / 90° / 180°.
    // ═════════════════════════════════════════════════════════

    /** @private Transform every layer canvas (and mask) in place using a draw callback. */
    _transformAllLayers(newW, newH, applyTransform) {
        const oldW = this.docWidth;
        const oldH = this.docHeight;

        const run = (srcCanvas) => {
            const tmp = document.createElement('canvas');
            tmp.width = oldW; tmp.height = oldH;
            tmp.getContext('2d').drawImage(srcCanvas, 0, 0);
            // Resize destination buffer (clears + resets ctx state)
            srcCanvas.width = newW;
            srcCanvas.height = newH;
            const ctx = srcCanvas.getContext('2d');
            ctx.imageSmoothingEnabled = false; // lossless flip/rotate
            ctx.save();
            applyTransform(ctx, oldW, oldH, newW, newH);
            ctx.drawImage(tmp, 0, 0);
            ctx.restore();
            return ctx;
        };

        for (const layer of this.layers) {
            run(layer.canvas);
            layer.ctx = layer.canvas.getContext('2d');
            if (layer.mask) {
                run(layer.mask);
                layer._maskProxy = null;
            }
            layer.markAllDirty();
        }

        this.docWidth = newW;
        this.docHeight = newH;
        this._sizeCanvases(newW, newH);
        this._needsComposite = true;
        this.fitToScreen();
        if (this.onLayerChange) this.onLayerChange();
    }

    /** Flip the whole document horizontally. */
    flipHorizontal() {
        this._transformAllLayers(this.docWidth, this.docHeight, (ctx, ow, oh, nw) => {
            ctx.translate(nw, 0);
            ctx.scale(-1, 1);
        });
        console.log('[CanvasEngine] flipHorizontal');
    }

    /** Flip the whole document vertically. */
    flipVertical() {
        this._transformAllLayers(this.docWidth, this.docHeight, (ctx, ow, oh, nw, nh) => {
            ctx.translate(0, nh);
            ctx.scale(1, -1);
        });
        console.log('[CanvasEngine] flipVertical');
    }

    /**
     * Rotate the whole document 90°.
     * @param {'cw'|'ccw'} [dir='cw']
     */
    rotate90(dir = 'cw') {
        const newW = this.docHeight;
        const newH = this.docWidth;
        this._transformAllLayers(newW, newH, (ctx, ow, oh, nw, nh) => {
            if (dir === 'ccw') { ctx.translate(0, nh); ctx.rotate(-Math.PI / 2); }
            else               { ctx.translate(nw, 0); ctx.rotate(Math.PI / 2); }
        });
        console.log(`[CanvasEngine] rotate90 ${dir}`);
    }

    /** Rotate the whole document 180°. */
    rotate180() {
        this._transformAllLayers(this.docWidth, this.docHeight, (ctx, ow, oh, nw, nh) => {
            ctx.translate(nw, nh);
            ctx.rotate(Math.PI);
        });
        console.log('[CanvasEngine] rotate180');
    }

    /**
     * Rotate the whole document by an arbitrary angle, auto-expanding the canvas
     * to fit the rotated content. Uses smoothing in photo mode.
     * @param {number} deg
     */
    rotateArbitrary(deg) {
        const rad = (deg * Math.PI) / 180;
        const oldW = this.docWidth, oldH = this.docHeight;
        const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
        const newW = Math.max(1, Math.round(oldW * cos + oldH * sin));
        const newH = Math.max(1, Math.round(oldW * sin + oldH * cos));
        const smooth = !this.pixelArtMode;

        const run = (srcCanvas) => {
            const tmp = document.createElement('canvas');
            tmp.width = oldW; tmp.height = oldH;
            tmp.getContext('2d').drawImage(srcCanvas, 0, 0);
            srcCanvas.width = newW; srcCanvas.height = newH;
            const ctx = srcCanvas.getContext('2d');
            ctx.imageSmoothingEnabled = smooth;
            if (smooth) ctx.imageSmoothingQuality = 'high';
            ctx.save();
            ctx.translate(newW / 2, newH / 2);
            ctx.rotate(rad);
            ctx.drawImage(tmp, -oldW / 2, -oldH / 2);
            ctx.restore();
        };

        for (const layer of this.layers) {
            run(layer.canvas);
            layer.ctx = layer.canvas.getContext('2d');
            if (layer.mask) { run(layer.mask); layer._maskProxy = null; }
            layer.markAllDirty();
        }

        this.docWidth = newW;
        this.docHeight = newH;
        this._sizeCanvases(newW, newH);
        this._needsComposite = true;
        this.fitToScreen();
        if (this.onLayerChange) this.onLayerChange();
        console.log(`[CanvasEngine] rotateArbitrary ${deg}° → ${newW}×${newH}`);
    }

    /**
     * Compute the union bounding box of all non-transparent pixels across every layer.
     * @returns {{x:number,y:number,w:number,h:number}|null} null if fully transparent.
     */
    getContentBounds() {
        const w = this.docWidth, h = this.docHeight;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (const layer of this.layers) {
            if (!layer.visible) continue;
            const data = layer.ctx.getImageData(0, 0, w, h).data;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (data[(y * w + x) * 4 + 3] !== 0) {
                        if (x < minX) minX = x;
                        if (y < minY) minY = y;
                        if (x > maxX) maxX = x;
                        if (y > maxY) maxY = y;
                    }
                }
            }
        }
        if (maxX < minX || maxY < minY) return null;
        return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    }

    /** @private Crop every layer + mask to the given region; updates document size. */
    _cropAllLayers(x, y, w, h) {
        for (const layer of this.layers) {
            const img = layer.ctx.getImageData(x, y, w, h);
            layer.canvas.width = w;
            layer.canvas.height = h;
            layer.ctx = layer.canvas.getContext('2d');
            layer.ctx.putImageData(img, 0, 0);
            if (layer.mask) {
                const mctx = layer.mask.getContext('2d');
                const mimg = mctx.getImageData(x, y, w, h);
                layer.mask.width = w;
                layer.mask.height = h;
                layer.mask.getContext('2d').putImageData(mimg, 0, 0);
                layer._maskProxy = null;
            }
            layer.markAllDirty();
        }
        this.docWidth = w;
        this.docHeight = h;
        this._sizeCanvases(w, h);
        this._needsComposite = true;
        this.fitToScreen();
        if (this.onLayerChange) this.onLayerChange();
    }

    /**
     * Trim transparent borders / crop to content.
     * @returns {boolean} true if the document was cropped.
     */
    trim() {
        const b = this.getContentBounds();
        if (!b) return false;
        if (b.x === 0 && b.y === 0 && b.w === this.docWidth && b.h === this.docHeight) return false;
        this._cropAllLayers(b.x, b.y, b.w, b.h);
        console.log(`[CanvasEngine] trim → ${b.w}×${b.h} @ ${b.x},${b.y}`);
        return true;
    }


    // ═════════════════════════════════════════════════════════
    // View Transform — Zoom & Pan
    // ═════════════════════════════════════════════════════════

    /**
     * Set zoom level. Optionally zoom centered on a screen point.
     * @param {number} percent  - Zoom level (10–2000)
     * @param {number} [cx]     - Center X in client/screen coords
     * @param {number} [cy]     - Center Y in client/screen coords
     */
    setZoom(percent, cx, cy) {
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, percent / 100));

        if (cx !== undefined && cy !== undefined) {
            // Canvas point under the cursor before the zoom change (rotation-aware)
            const cp = this.screenToCanvas(cx, cy);
            this.zoom = newZoom;
            // Re-pan so that same canvas point stays under the cursor
            const after = this.canvasToScreen(cp.x, cp.y);
            this.panX += cx - after.x;
            this.panY += cy - after.y;
        } else {
            this.zoom = newZoom;
        }

        this._updateTransform();
    }

    /** Step zoom in to the next preset level. */
    zoomIn(cx, cy) {
        const current = Math.round(this.zoom * 100);
        const next = ZOOM_PRESETS.find(z => z > current) || ZOOM_PRESETS[ZOOM_PRESETS.length - 1];
        this.setZoom(next, cx, cy);
    }

    /** Step zoom out to the previous preset level. */
    zoomOut(cx, cy) {
        const current = Math.round(this.zoom * 100);
        let prev = ZOOM_PRESETS[0];
        for (const z of ZOOM_PRESETS) {
            if (z >= current) break;
            prev = z;
        }
        this.setZoom(prev, cx, cy);
    }

    /** Fit the canvas into the viewport with padding, capped at 100%. */
    fitToScreen() {
        const vw = this.viewport.clientWidth;
        const vh = this.viewport.clientHeight;

        if (vw === 0 || vh === 0) {
            // Viewport not yet laid out — defer one frame
            requestAnimationFrame(() => this.fitToScreen());
            return;
        }

        const padding = 40;
        const scaleX = (vw - padding * 2) / this.docWidth;
        const scaleY = (vh - padding * 2) / this.docHeight;
        const newZoom = Math.min(scaleX, scaleY, 1); // Don't upscale beyond 100% for fit

        this.zoom = Math.max(MIN_ZOOM, newZoom);

        // Center canvas in viewport
        const scaledW = this.docWidth * this.zoom;
        const scaledH = this.docHeight * this.zoom;
        this.panX = (vw - scaledW) / 2;
        this.panY = (vh - scaledH) / 2;

        this._updateTransform();
    }

    /** Set zoom to exactly 100% and center the canvas. */
    setZoom100() {
        this.zoom = 1.0;
        this._centerAndUpdate();
    }

    /** Set zoom to exactly 200% and center the canvas. */
    setZoom200() {
        this.zoom = 2.0;
        this._centerAndUpdate();
    }

    /** Get current zoom as a percentage integer. */
    getZoom() {
        return Math.round(this.zoom * 100);
    }

    /**
     * Convert screen/client coordinates to canvas document coordinates.
     * @returns {{ x: number, y: number }}
     */
    screenToCanvas(clientX, clientY) {
        const rect = this.viewport.getBoundingClientRect();
        let vx = clientX - rect.left - this.panX;
        let vy = clientY - rect.top  - this.panY;
        const r = this.viewRotation;
        if (r) {
            // inverse rotation R(-θ)
            const cos = Math.cos(r), sin = Math.sin(r);
            const rx =  vx * cos + vy * sin;
            const ry = -vx * sin + vy * cos;
            vx = rx; vy = ry;
        }
        return { x: vx / this.zoom, y: vy / this.zoom };
    }

    /**
     * Convert canvas document coordinates to screen/client coordinates.
     * @returns {{ x: number, y: number }}
     */
    canvasToScreen(canvasX, canvasY) {
        const rect = this.viewport.getBoundingClientRect();
        let sx = canvasX * this.zoom;
        let sy = canvasY * this.zoom;
        const r = this.viewRotation;
        if (r) {
            const cos = Math.cos(r), sin = Math.sin(r);
            const rx = sx * cos - sy * sin;
            const ry = sx * sin + sy * cos;
            sx = rx; sy = ry;
        }
        return {
            x: sx + this.panX + rect.left,
            y: sy + this.panY + rect.top
        };
    }

    /**
     * Whether a navigation gesture (pan/zoom/pinch) is currently active.
     * Tools should check this and NOT draw while true.
     */
    get isNavigating() {
        return this._isPanning || this._pointers.size >= 2 || this._gestureActive;
    }

    /** Number of active pointer contacts. */
    get pointerCount() {
        return this._pointers.size;
    }

    /**
     * Called by app.js when the space key is pressed/released.
     * Enables space-to-pan navigation mode.
     */
    setSpaceHeld(held) {
        this.spaceHeld = held;
        if (!this._isPanning) {
            this.viewport.style.cursor = held ? 'grab' : 'crosshair';
        }
    }


    // ═════════════════════════════════════════════════════════
    // Rendering Mode
    // ═════════════════════════════════════════════════════════

    /** Toggle pixel art mode rendering (nearest-neighbor zoom). */
    setPixelArtMode(enabled) {
        this.pixelArtMode = enabled;
        this._updateImageRendering();
        this._needsComposite = true;
    }

    /** Request a recomposite on the next frame. */
    requestComposite() {
        this._needsComposite = true;
    }

    /** Force an immediate synchronous composite (bypasses rAF scheduling). */
    compositeNow() {
        this._composite();
    }

    /**
     * Get a flattened canvas of all visible layers for export (masks + groups applied).
     * @returns {HTMLCanvasElement}
     */
    getFlattenedCanvas() {
        const canvas = document.createElement('canvas');
        canvas.width = this.docWidth;
        canvas.height = this.docHeight;
        const ctx = canvas.getContext('2d');
        // Temporarily disable mask view mode for export
        const savedView = this.maskViewLayer;
        this.maskViewLayer = null;
        this._compositeMembers(this.members, ctx, this.docWidth, this.docHeight);
        this.maskViewLayer = savedView;
        return canvas;
    }

    /** Handle viewport resize (e.g., window resize). */
    onResize() {
        this.fitToScreen();
    }


    // ═════════════════════════════════════════════════════════
    // Internal: Canvas Sizing
    // ═════════════════════════════════════════════════════════

    /** @private */
    _sizeCanvases(width, height) {
        // Size display + UI overlay canvases (inside wrapper, CSS-scaled)
        [this.display, this.uiCanvas].forEach(c => {
            c.width = width;
            c.height = height;
            c.style.width = `${width}px`;
            c.style.height = `${height}px`;
        });
        // Grid canvas is sized by PixelEngine to viewport dimensions
        this.wrapper.style.width = `${width}px`;
        this.wrapper.style.height = `${height}px`;
    }


    // ═════════════════════════════════════════════════════════
    // Internal: Transform
    // ═════════════════════════════════════════════════════════

    /** @private Apply CSS transform to the wrapper element. */
    _updateTransform() {
        const deg = this.viewRotation * 180 / Math.PI;
        this.wrapper.style.transform =
            `translate(${this.panX}px, ${this.panY}px) rotate(${deg}deg) scale(${this.zoom})`;
        this._updateImageRendering();

        if (this.onZoomChange) {
            this.onZoomChange(this.getZoom());
        }
        if (this.onRotationChange) {
            this.onRotationChange(deg);
        }

        // Notify pixel engine for grid redraw
        if (this.pixelEngine) {
            this.pixelEngine.onZoomChanged(this.zoom);
            this.pixelEngine.onTransformChanged();
        }

        // Notify view-aid overlays (rulers / guides) to redraw
        if (this.onViewTransform) this.onViewTransform();
    }

    // ─── P9: Viewport rotation ────────────────────────────────────

    /** Rotation in degrees (for UI display). */
    getRotationDegrees() { return this.viewRotation * 180 / Math.PI; }

    /**
     * Set absolute view rotation (radians), keeping the pivot point fixed
     * on screen. Pivot defaults to the viewport centre.
     */
    setViewRotation(theta, pivotClientX = null, pivotClientY = null) {
        const rect = this.viewport.getBoundingClientRect();
        const px = (pivotClientX != null) ? pivotClientX : rect.left + rect.width / 2;
        const py = (pivotClientY != null) ? pivotClientY : rect.top + rect.height / 2;
        const cp = this.screenToCanvas(px, py);   // canvas point under pivot (old rotation)
        this.viewRotation = theta;
        const after = this.canvasToScreen(cp.x, cp.y); // where it lands now (old pan)
        this.panX += px - after.x;
        this.panY += py - after.y;
        this._updateTransform();
    }

    /** Rotate the view by a delta (radians) about a pivot. */
    rotateView(delta, pivotClientX = null, pivotClientY = null) {
        if (!delta) return;
        this.setViewRotation(this.viewRotation + delta, pivotClientX, pivotClientY);
    }

    /** Reset view rotation to 0° about the viewport centre. */
    resetViewRotation() {
        if (!this.viewRotation) return;
        this.setViewRotation(0);
    }

    // ─── P9: Reference layer (display-only overlay, excluded from export) ──

    /** Set/replace the reference image; fits it to the document, centred. */
    setReferenceImage(img) {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const scale = Math.min(this.docWidth / c.width, this.docHeight / c.height);
        this.referenceLayer = {
            canvas: c,
            x: (this.docWidth - c.width * scale) / 2,
            y: (this.docHeight - c.height * scale) / 2,
            scale,
            opacity: 0.5,
            visible: true,
            below: false,
        };
        this.requestComposite();
    }

    clearReference() { this.referenceLayer = null; this.requestComposite(); }
    setReferenceOpacity(v) { if (this.referenceLayer) { this.referenceLayer.opacity = Math.max(0, Math.min(1, v)); this.requestComposite(); } }
    toggleReferenceVisible() { if (this.referenceLayer) { this.referenceLayer.visible = !this.referenceLayer.visible; this.requestComposite(); } }
    setReferenceBelow(b) { if (this.referenceLayer) { this.referenceLayer.below = !!b; this.requestComposite(); } }
    moveReference(dxCanvas, dyCanvas) { if (this.referenceLayer) { this.referenceLayer.x += dxCanvas; this.referenceLayer.y += dyCanvas; this.requestComposite(); } }
    scaleReference(factor) {
        const r = this.referenceLayer;
        if (!r) return;
        const cx = r.x + r.canvas.width * r.scale / 2;
        const cy = r.y + r.canvas.height * r.scale / 2;
        r.scale = Math.max(0.02, r.scale * factor);
        r.x = cx - r.canvas.width * r.scale / 2;
        r.y = cy - r.canvas.height * r.scale / 2;
        this.requestComposite();
    }
    fitReference() {
        const r = this.referenceLayer;
        if (!r) return;
        r.scale = Math.min(this.docWidth / r.canvas.width, this.docHeight / r.canvas.height);
        r.x = (this.docWidth - r.canvas.width * r.scale) / 2;
        r.y = (this.docHeight - r.canvas.height * r.scale) / 2;
        this.requestComposite();
    }

    /** @private Draw the reference layer onto a composite context. */
    _drawReference(ctx) {
        const r = this.referenceLayer;
        if (!r || !r.visible || !r.canvas) return;
        ctx.save();
        ctx.globalAlpha = r.opacity;
        ctx.imageSmoothingEnabled = !this.pixelArtMode;
        ctx.drawImage(r.canvas, r.x, r.y, r.canvas.width * r.scale, r.canvas.height * r.scale);
        ctx.restore();
    }

    // ─── P9: Guides + snapping ────────────────────────────────────

    /**
     * Snap a canvas-space point to nearby guides, canvas edges, and centre.
     * Threshold is given in screen pixels (converted to canvas units by zoom).
     * @returns {{ x:number, y:number, snappedX:boolean, snappedY:boolean }}
     */
    snapPoint(cx, cy, { threshold = 8, edges = true } = {}) {
        const t = threshold / this.zoom;
        let x = cx, y = cy, sx = false, sy = false;
        const targetsX = [...this.guides.v];
        const targetsY = [...this.guides.h];
        if (edges) {
            targetsX.push(0, this.docWidth, this.docWidth / 2);
            targetsY.push(0, this.docHeight, this.docHeight / 2);
        }
        let bestX = t, bestY = t;
        for (const gx of targetsX) { const d = Math.abs(cx - gx); if (d <= bestX) { bestX = d; x = gx; sx = true; } }
        for (const gy of targetsY) { const d = Math.abs(cy - gy); if (d <= bestY) { bestY = d; y = gy; sy = true; } }
        return { x, y, snappedX: sx, snappedY: sy };
    }

    addGuide(orientation, pos) {
        if (orientation === 'v') this.guides.v.push(pos);
        else this.guides.h.push(pos);
    }
    clearGuides() { this.guides.v = []; this.guides.h = []; if (this.onViewTransform) this.onViewTransform(); }

    /** @private Update image-rendering CSS on canvas elements. */
    _updateImageRendering() {
        // Pixel art mode: always pixelated
        // Photo mode: pixelated when zoom ≥ 200% for pixel-crisp display
        const pixelated = this.pixelArtMode || this.zoom >= 2.0;
        const val = pixelated ? 'pixelated' : 'auto';
        this.display.style.imageRendering = val;
        this.gridCanvas.style.imageRendering = val;
        this.uiCanvas.style.imageRendering = val;
    }

    /** @private Center canvas in viewport at current zoom and update. */
    _centerAndUpdate() {
        const vw = this.viewport.clientWidth;
        const vh = this.viewport.clientHeight;
        const scaledW = this.docWidth * this.zoom;
        const scaledH = this.docHeight * this.zoom;
        this.panX = (vw - scaledW) / 2;
        this.panY = (vh - scaledH) / 2;
        this._updateTransform();
    }


    // ═════════════════════════════════════════════════════════
    // Internal: Render Loop
    // ═════════════════════════════════════════════════════════

    /** @private */
    _startRenderLoop() {
        if (this._isRunning) return;
        this._isRunning = true;
        this._compositeLoop();
    }

    /** @private */
    _stopRenderLoop() {
        this._isRunning = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    /** @private Main render loop — runs every frame, composites only when dirty. */
    _compositeLoop() {
        if (!this._isRunning) return;
        this._rafId = requestAnimationFrame(() => this._compositeLoop());

        // Only composite if something changed
        const anyDirty = this._needsComposite || this.layers.some(l => l.dirty) ||
            this.members.some(m => m instanceof LayerGroup && m.dirty);
        if (!anyDirty) return;

        this._composite();
    }

    /**
     * Recursive compositing: draw all visible members in `list` onto `ctx`.
     * Handles masks, clipping, and nested groups.
     * @private
     */
    _compositeMembers(list, ctx, w, h) {
        for (let i = 0; i < list.length; i++) {
            const member = list[i];
            if (!member.visible) continue;

            if (member instanceof LayerGroup) {
                // Composite group children to a temp canvas, then blend
                let temp;
                try { temp = new OffscreenCanvas(w, h); }
                catch { temp = document.createElement('canvas'); temp.width = w; temp.height = h; }
                const tempCtx = temp.getContext('2d');
                this._compositeMembers(member.children, tempCtx, w, h);
                ctx.globalAlpha = member.opacity;
                ctx.globalCompositeOperation = member.blendMode;
                ctx.drawImage(temp, 0, 0);
                continue;
            }

            const layer = member;

            // Mask view mode
            if (layer === this.maskViewLayer && layer.mask) {
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(layer.mask, 0, 0);
                continue;
            }

            // P6 — pre-render layer styles. Effects (shadow/glow/stroke) extend
            // beyond the layer's own alpha, so the styled canvas replaces the raw
            // layer canvas in every draw branch below (mask still clips the result).
            const hasFx = (layer instanceof Layer) && layer.effects && hasEnabledEffect(layer.effects);
            const src = hasFx ? renderLayerEffects(layer.canvas, layer.effects, w, h) : layer.canvas;

            // Layer with enabled mask
            if (layer.mask && layer.maskEnabled) {
                let temp;
                try { temp = new OffscreenCanvas(w, h); }
                catch { temp = document.createElement('canvas'); temp.width = w; temp.height = h; }
                const tempCtx = temp.getContext('2d');
                tempCtx.drawImage(src, 0, 0);
                tempCtx.globalCompositeOperation = 'destination-in';
                tempCtx.drawImage(_grayscaleToAlpha(layer.mask, w, h), 0, 0);
                ctx.globalAlpha = layer.opacity;
                ctx.globalCompositeOperation = layer.blendMode;
                ctx.drawImage(temp, 0, 0);
                continue;
            }

            // Clip-to-below
            if (layer.clippedToBelow && i > 0) {
                const base = list[i - 1];
                if (base instanceof Layer) {
                    let temp;
                    try { temp = new OffscreenCanvas(w, h); }
                    catch { temp = document.createElement('canvas'); temp.width = w; temp.height = h; }
                    const tempCtx = temp.getContext('2d');
                    tempCtx.drawImage(src, 0, 0);
                    tempCtx.globalCompositeOperation = 'destination-in';
                    tempCtx.drawImage(base.canvas, 0, 0);
                    ctx.globalAlpha = layer.opacity;
                    ctx.globalCompositeOperation = layer.blendMode;
                    ctx.drawImage(temp, 0, 0);
                    continue;
                }
            }

            // Adjustment layer: apply filter to the composited pixels so far,
            // limited by the adjustment's own opacity, mask, and clip-to-below.
            if (layer instanceof AdjustmentLayer) {
                try {
                    const before = ctx.getImageData(0, 0, w, h);
                    const masked  = !!(layer.mask && layer.maskEnabled);
                    const clipped = !!(layer.clippedToBelow && i > 0 && list[i - 1] instanceof Layer);

                    if (layer.opacity >= 1 && !masked && !clipped) {
                        // Fast path: full-strength adjustment over everything below
                        applyAdjustment(layer.adjustType, layer.params, before, w, h);
                        ctx.putImageData(before, 0, 0);
                    } else {
                        // Compute adjusted pixels on a copy, then blend per-pixel
                        const after = new ImageData(new Uint8ClampedArray(before.data), w, h);
                        applyAdjustment(layer.adjustType, layer.params, after, w, h);

                        let maskAlpha = null;
                        if (masked) {
                            maskAlpha = _grayscaleToAlpha(layer.mask, w, h)
                                .getContext('2d').getImageData(0, 0, w, h).data;
                        }
                        let clipAlpha = null;
                        if (clipped) {
                            let tc;
                            try { tc = new OffscreenCanvas(w, h); }
                            catch { tc = document.createElement('canvas'); tc.width = w; tc.height = h; }
                            const tctx = tc.getContext('2d');
                            tctx.drawImage(list[i - 1].canvas, 0, 0);
                            clipAlpha = tctx.getImageData(0, 0, w, h).data;
                        }

                        const op = layer.opacity;
                        const bd = before.data, ad = after.data;
                        for (let p = 0; p < bd.length; p += 4) {
                            let f = op;
                            if (maskAlpha) f *= maskAlpha[p + 3] / 255;
                            if (clipAlpha) f *= clipAlpha[p + 3] / 255;
                            if (f <= 0) continue;
                            if (f >= 1) {
                                bd[p] = ad[p]; bd[p + 1] = ad[p + 1]; bd[p + 2] = ad[p + 2];
                                continue;
                            }
                            const inv = 1 - f;
                            bd[p]     = bd[p]     * inv + ad[p]     * f;
                            bd[p + 1] = bd[p + 1] * inv + ad[p + 1] * f;
                            bd[p + 2] = bd[p + 2] * inv + ad[p + 2] * f;
                        }
                        ctx.putImageData(before, 0, 0);
                    }
                } catch (err) {
                    console.warn('[CanvasEngine] AdjustmentLayer composite error:', err);
                }
                continue;
            }

            // Normal layer
            ctx.globalAlpha = layer.opacity;
            ctx.globalCompositeOperation = layer.blendMode;
            ctx.drawImage(src, 0, 0);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    /** @private Composite all visible members onto the display canvas. */
    _composite() {
        const ctx = this.displayCtx;
        const w = this.docWidth;
        const h = this.docHeight;

        ctx.imageSmoothingEnabled = !this.pixelArtMode;
        ctx.clearRect(0, 0, w, h);

        // P9 — reference layer below the artwork (display only, never exported)
        if (this.referenceLayer && this.referenceLayer.below) this._drawReference(ctx);

        // P7 — onion-skin ghosts (neighbor frames) drawn faintly behind the current frame
        if (this.onionFrames && this.onionFrames.length) {
            for (const o of this.onionFrames) {
                if (!o || !o.members) continue;
                let temp;
                try { temp = new OffscreenCanvas(w, h); }
                catch { temp = document.createElement('canvas'); temp.width = w; temp.height = h; }
                const tctx = temp.getContext('2d');
                tctx.imageSmoothingEnabled = !this.pixelArtMode;
                this._compositeMembers(o.members, tctx, w, h);
                if (o.tint) {
                    tctx.globalCompositeOperation = 'source-atop';
                    tctx.globalAlpha = 0.55;
                    tctx.fillStyle = o.tint;
                    tctx.fillRect(0, 0, w, h);
                    tctx.globalAlpha = 1;
                    tctx.globalCompositeOperation = 'source-over';
                }
                ctx.globalAlpha = (o.alpha != null) ? o.alpha : 0.4;
                ctx.drawImage(temp, 0, 0);
                ctx.globalAlpha = 1;
            }
        }

        this._compositeMembers(this.members, ctx, w, h);

        // P9 — reference layer above the artwork (display only, never exported)
        if (this.referenceLayer && !this.referenceLayer.below) this._drawReference(ctx);

        // Clear dirty flags on all leaf layers
        for (const layer of this.layers) layer.clearDirty();

        this._needsComposite = false;
    }


    // ═════════════════════════════════════════════════════════
    // Internal: Event Handling (Navigation)
    // ═════════════════════════════════════════════════════════

    /** @private */
    _attachEvents() {
        const vp = this.viewport;
        vp.addEventListener('wheel', this._boundWheel, { passive: false });
        vp.addEventListener('pointerdown', this._boundPointerDown);
        vp.addEventListener('pointermove', this._boundPointerMove);
        vp.addEventListener('pointerup', this._boundPointerUp);
        vp.addEventListener('pointercancel', this._boundPointerUp);
        vp.addEventListener('contextmenu', this._boundContextMenu);
    }

    /** @private */
    _detachEvents() {
        const vp = this.viewport;
        vp.removeEventListener('wheel', this._boundWheel);
        vp.removeEventListener('pointerdown', this._boundPointerDown);
        vp.removeEventListener('pointermove', this._boundPointerMove);
        vp.removeEventListener('pointerup', this._boundPointerUp);
        vp.removeEventListener('pointercancel', this._boundPointerUp);
        vp.removeEventListener('contextmenu', this._boundContextMenu);
    }

    // ─── Mouse Wheel → Zoom ───
    /** @private */
    _onWheel(e) {
        e.preventDefault();

        const delta = -e.deltaY;
        const factor = delta > 0 ? WHEEL_ZOOM_FACTOR : (1 / WHEEL_ZOOM_FACTOR);
        const newZoomPercent = Math.round(this.zoom * factor * 100);

        this.setZoom(newZoomPercent, e.clientX, e.clientY);
    }

    // ─── Pointer Down ───
    /** @private */
    _onPointerDown(e) {
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        // ── Three-finger tap → undo (mobile) ──
        if (this._pointers.size === 3) {
            if (this.onThreeFingerTap) this.onThreeFingerTap();
            return;
        }

        // ── Two pointers → start pinch zoom/pan ──
        if (this._pointers.size === 2) {
            const pts = [...this._pointers.values()];
            this._pinchPrevDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            this._pinchPrevMidX = (pts[0].x + pts[1].x) / 2;
            this._pinchPrevMidY = (pts[0].y + pts[1].y) / 2;
            this._pinchPrevAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
            this._isPanning = true;
            this._gestureActive = true;
            this.viewport.style.cursor = 'grabbing';
            e.preventDefault();
            return;
        }

        // ── Single pointer: check for pan ──
        const isPanGesture = this.spaceHeld || e.button === 1;

        if (isPanGesture) {
            this._isPanning = true;
            this._panStartX = e.clientX;
            this._panStartY = e.clientY;
            this._panStartPanX = this.panX;
            this._panStartPanY = this.panY;
            this.viewport.style.cursor = 'grabbing';
            try {
                this.viewport.setPointerCapture(e.pointerId);
            } catch { /* ignore */ }
            e.preventDefault();
        }
        // Otherwise: single pointer without space/middle = tool event (not handled here)
    }

    // ─── Pointer Move ───
    /** @private */
    _onPointerMove(e) {
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        // Fire cursor position callback (in canvas coordinates)
        if (this.onCursorMove) {
            const pos = this.screenToCanvas(e.clientX, e.clientY);
            this.onCursorMove(Math.floor(pos.x), Math.floor(pos.y));
        }

        // ── Pinch zoom + pan (two pointers active) ──
        if (this._pointers.size === 2 && this._pinchPrevDist > 0) {
            const pts = [...this._pointers.values()];
            const newDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            const newMidX = (pts[0].x + pts[1].x) / 2;
            const newMidY = (pts[0].y + pts[1].y) / 2;

            if (newDist > 0) {
                // Canvas point under the OLD midpoint (rotation-aware)
                const cp = this.screenToCanvas(this._pinchPrevMidX, this._pinchPrevMidY);

                // New zoom from pinch distance ratio
                const scale = newDist / this._pinchPrevDist;
                this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * scale));

                // Re-pan so the same canvas point sits under the NEW midpoint
                const after = this.canvasToScreen(cp.x, cp.y);
                this.panX += newMidX - after.x;
                this.panY += newMidY - after.y;

                this._updateTransform();
            }

            this._pinchPrevDist = newDist;
            this._pinchPrevMidX = newMidX;
            this._pinchPrevMidY = newMidY;

            // ── Two-finger rotation (about the gesture midpoint) ──
            const newAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
            if (this._pinchPrevAngle !== null) {
                let dA = newAngle - this._pinchPrevAngle;
                // normalise to [-π, π]
                if (dA > Math.PI) dA -= 2 * Math.PI;
                else if (dA < -Math.PI) dA += 2 * Math.PI;
                if (Math.abs(dA) > 0.001) this.rotateView(dA, newMidX, newMidY);
            }
            this._pinchPrevAngle = newAngle;

            e.preventDefault();
            return;
        }

        // ── Single-pointer pan ──
        if (this._isPanning && this._pointers.size === 1) {
            this.panX = this._panStartPanX + (e.clientX - this._panStartX);
            this.panY = this._panStartPanY + (e.clientY - this._panStartY);
            this._updateTransform();
            e.preventDefault();
        }
    }

    // ─── Pointer Up / Cancel ───
    /** @private */
    _onPointerUp(e) {
        this._pointers.delete(e.pointerId);

        // Reset pinch state when going below 2 pointers
        if (this._pointers.size < 2) {
            this._pinchPrevDist = 0;
            this._pinchPrevAngle = null;
            // Snap small residual rotations back to 0° for a clean upright view
            if (this.viewRotation && Math.abs(this.getRotationDegrees()) < 4) {
                this.setViewRotation(0);
            }
        }

        // When going from multi-touch to single-touch, stop panning
        // but keep _gestureActive to prevent the remaining pointer from drawing
        if (this._pointers.size === 1 && this._gestureActive) {
            this._isPanning = false;
        }

        // All pointers released — clean up everything
        if (this._pointers.size === 0) {
            this._isPanning = false;
            this._gestureActive = false;
            this.viewport.style.cursor = this.spaceHeld ? 'grab' : 'crosshair';
            try {
                this.viewport.releasePointerCapture(e.pointerId);
            } catch { /* ignore if not captured */ }
        }
    }
}
