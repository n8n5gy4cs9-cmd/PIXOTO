/* ═══════════════════════════════════════════════════════════════
   Pixoto — History System (Phase 7)
   Undo/redo with per-layer ImageData snapshots.
   Named history steps, jump-to-step support.
   ═══════════════════════════════════════════════════════════════ */

import { Layer, LayerGroup } from './canvas-engine.js';


// ═══════════════════════════════════════════════════════════════
// History Step
// ═══════════════════════════════════════════════════════════════

class HistoryStep {
    /**
     * @param {string} name - Human-readable description (e.g., "Brush stroke")
     * @param {Array<{layerIndex: number, imageData: ImageData}>} layerSnapshots
     * @param {number} activeLayerIndex
     */
    constructor(name, layerSnapshots, activeLayerIndex, docWidth, docHeight, treeSnapshot = null) {
        this.name = name;
        this.snapshots = layerSnapshots;
        this.activeLayerIndex = activeLayerIndex;
        this.docWidth = docWidth;
        this.docHeight = docHeight;
        this.treeSnapshot = treeSnapshot; // Phase C: group tree structure
        this.timestamp = Date.now();
    }
}


// ═══════════════════════════════════════════════════════════════
// History Manager
// ═══════════════════════════════════════════════════════════════

export class HistoryManager {
    /**
     * @param {import('./canvas-engine.js').CanvasEngine} engine
     * @param {number} [maxSteps=50] - Max undo steps to retain
     */
    constructor(engine, maxSteps = 50) {
        this.engine = engine;

        /** @type {HistoryStep[]} */
        this._undoStack = [];

        /** @type {HistoryStep[]} */
        this._redoStack = [];

        this._maxSteps = maxSteps;

        /** Callback: fired when undo/redo stack changes. */
        this.onHistoryChange = null;

        /** If true, we're currently in a batch (multiple operations = one undo step). */
        this._batchName = null;
        this._batchSnapshot = null;
    }

    /** @returns {number} Number of undo steps available. */
    get undoCount() { return this._undoStack.length; }

    /** @returns {number} Number of redo steps available. */
    get redoCount() { return this._redoStack.length; }

    /** @returns {boolean} */
    get canUndo() { return this._undoStack.length > 0; }

    /** @returns {boolean} */
    get canRedo() { return this._redoStack.length > 0; }

    /**
     * Get list of history step names (for the history panel).
     * Returns from oldest to newest.
     * @returns {Array<{name: string, isCurrent: boolean}>}
     */
    getStepList() {
        const list = this._undoStack.map((s, i) => ({
            name: s.name,
            isCurrent: i === this._undoStack.length - 1
        }));
        return list;
    }


    // ═════════════════════════════════════════════════════════
    // Snapshot & Push
    // ═════════════════════════════════════════════════════════

    /**
     * Take a snapshot of the current state BEFORE making a change.
     * Call this before any destructive operation (brush stroke, fill, delete, etc.)
     * @param {string} name - Description of the action that follows
     */
    saveSnapshot(name = 'Edit') {
        // If in a batch, only save the first snapshot
        if (this._batchName !== null) return;

        const snapshots = this._captureLayerSnapshots();
        const treeSnap = this._captureTreeSnapshot();
        const step = new HistoryStep(name, snapshots, this.engine.activeLayerIndex, this.engine.docWidth, this.engine.docHeight, treeSnap);

        this._undoStack.push(step);

        // Trim if over max
        while (this._undoStack.length > this._maxSteps) {
            this._undoStack.shift();
        }

        // Any new action clears the redo stack
        this._redoStack.length = 0;

        this._notifyChange();
    }

    /**
     * Begin a batch operation. All changes until endBatch() are one undo step.
     * @param {string} name
     */
    beginBatch(name = 'Batch Edit') {
        if (this._batchName !== null) return; // Already in batch
        this._batchName = name;
        this._batchSnapshot = this._captureLayerSnapshots();
        this._batchTreeSnapshot = this._captureTreeSnapshot();
        this._batchDocWidth = this.engine.docWidth;
        this._batchDocHeight = this.engine.docHeight;
    }

    /** End a batch operation — push the pre-batch snapshot as one undo step. */
    endBatch() {
        if (this._batchName === null) return;

        const step = new HistoryStep(
            this._batchName,
            this._batchSnapshot,
            this.engine.activeLayerIndex,
            this._batchDocWidth,
            this._batchDocHeight,
            this._batchTreeSnapshot
        );
        this._undoStack.push(step);

        while (this._undoStack.length > this._maxSteps) {
            this._undoStack.shift();
        }

        this._redoStack.length = 0;
        this._batchName = null;
        this._batchSnapshot = null;
        this._batchDocWidth = null;
        this._batchDocHeight = null;

        this._notifyChange();
    }


    // ═════════════════════════════════════════════════════════
    // Undo / Redo
    // ═════════════════════════════════════════════════════════

    /** Undo the last action. */
    undo() {
        if (!this.canUndo) return;

        // Save current state to redo stack
        const currentSnap = this._captureLayerSnapshots();
        const redoStep = new HistoryStep('Redo', currentSnap, this.engine.activeLayerIndex, this.engine.docWidth, this.engine.docHeight);
        this._redoStack.push(redoStep);

        // Pop the last undo step and restore it
        const step = this._undoStack.pop();
        this._restoreSnapshots(step);

        this._notifyChange();
    }

    /** Redo the last undone action. */
    redo() {
        if (!this.canRedo) return;

        // Save current state to undo stack
        const currentSnap = this._captureLayerSnapshots();
        const undoStep = new HistoryStep('Undo', currentSnap, this.engine.activeLayerIndex, this.engine.docWidth, this.engine.docHeight);
        this._undoStack.push(undoStep);

        // Pop the last redo step and restore it
        const step = this._redoStack.pop();
        this._restoreSnapshots(step);

        this._notifyChange();
    }

    /**
     * Jump to a specific step in the undo stack by index.
     * @param {number} targetIndex
     */
    jumpTo(targetIndex) {
        if (targetIndex < 0 || targetIndex >= this._undoStack.length) return;

        // How many times to undo to reach targetIndex
        const undoCount = this._undoStack.length - 1 - targetIndex;
        for (let i = 0; i < undoCount; i++) {
            this.undo();
        }
    }

    /** Clear all history. */
    clear() {
        this._undoStack.length = 0;
        this._redoStack.length = 0;
        this._notifyChange();
    }


    // ═════════════════════════════════════════════════════════
    // Internal
    // ═════════════════════════════════════════════════════════

    /**
     * Capture ImageData snapshots for all layers (including masks).
     * @private
     * @returns {Array}
     */
    _captureLayerSnapshots() {
        const snaps = [];
        const w = this.engine.docWidth;
        const h = this.engine.docHeight;

        for (let i = 0; i < this.engine.layers.length; i++) {
            const layer = this.engine.layers[i];
            let maskData = null;
            if (layer.mask) {
                try { maskData = layer.mask.getContext('2d').getImageData(0, 0, w, h); }
                catch { /* OffscreenCanvas may fail outside worker in some browsers */ }
            }
            snaps.push({
                layerIndex: i,
                imageData: layer.ctx.getImageData(0, 0, w, h),
                name: layer.name,
                visible: layer.visible,
                locked: layer.locked,
                opacity: layer.opacity,
                blendMode: layer.blendMode,
                maskData,
                maskEnabled: layer.maskEnabled,
                alphaLocked: layer.alphaLocked,
                clippedToBelow: layer.clippedToBelow,
            });
        }
        return snaps;
    }

    /**
     * Restore layer state from snapshots.
     * @private
     * @param {HistoryStep} step
     */
    _restoreSnapshots(step) {
        const newW = step.docWidth;
        const newH = step.docHeight;
        const dimsChanged = newW !== this.engine.docWidth || newH !== this.engine.docHeight;

        // If document dimensions changed (e.g. undo after crop), resize engine
        if (dimsChanged) {
            this.engine.docWidth = newW;
            this.engine.docHeight = newH;
            this.engine._sizeCanvases(newW, newH);
        }

        // Rebuild layers array to match snapshot count
        while (this.engine.layers.length > step.snapshots.length) {
            this.engine.layers.pop();
        }
        while (this.engine.layers.length < step.snapshots.length) {
            const newLayer = new Layer(newW, newH, 'Layer');
            this.engine.layers.push(newLayer);
        }

        // Restore each layer's pixel data and properties
        for (const snap of step.snapshots) {
            const layer = this.engine.layers[snap.layerIndex];
            if (!layer) continue;

            // Resize layer canvas if dimensions changed
            if (layer.canvas.width !== newW || layer.canvas.height !== newH) {
                layer.canvas.width = newW;
                layer.canvas.height = newH;
            }

            layer.ctx.putImageData(snap.imageData, 0, 0);
            layer.name = snap.name;
            layer.visible = snap.visible;
            layer.locked = snap.locked;
            layer.opacity = snap.opacity;
            layer.blendMode = snap.blendMode;
            layer.alphaLocked = snap.alphaLocked ?? false;
            layer.clippedToBelow = snap.clippedToBelow ?? false;
            layer.maskEnabled = snap.maskEnabled ?? true;
            layer._maskProxy = null;
            if (snap.maskData) {
                if (!layer.mask || layer.mask.width !== newW || layer.mask.height !== newH) {
                    try { layer.mask = new OffscreenCanvas(newW, newH); }
                    catch { layer.mask = document.createElement('canvas'); layer.mask.width = newW; layer.mask.height = newH; }
                }
                layer.mask.getContext('2d').putImageData(snap.maskData, 0, 0);
            } else {
                layer.mask = null;
            }
            layer.markAllDirty();
        }

        // Restore group tree structure
        this._restoreTree(step.treeSnapshot);

        // Restore active layer
        this.engine.activeLayerIndex = Math.min(
            step.activeLayerIndex,
            this.engine.layers.length - 1
        );
        this.engine.activeMember = this.engine.layers[this.engine.activeLayerIndex] || null;

        // Force recomposite and UI update
        this.engine.requestComposite();
        if (this.engine.onLayerChange) this.engine.onLayerChange();
        if (this.engine.onActiveLayerChange) {
            this.engine.onActiveLayerChange(this.engine.activeLayerIndex);
        }
        if (this.engine.onActiveMemberChange) {
            this.engine.onActiveMemberChange(this.engine.activeMember);
        }

        // Re-fit view if document size changed
        if (dimsChanged) {
            this.engine.fitToScreen();
        }
    }

    /** @private Capture the group tree structure as a JSON-serializable snapshot. */
    _captureTreeSnapshot() {
        const serializeMember = (m) => {
            if (m instanceof LayerGroup) {
                return { type: 'group', id: m.id, name: m.name, visible: m.visible, locked: m.locked,
                    opacity: m.opacity, blendMode: m.blendMode, collapsed: m.collapsed,
                    children: m.children.map(serializeMember) };
            }
            return { type: 'layer', id: m.id };
        };
        return this.engine.members.map(serializeMember);
    }

    /**
     * Restore the group tree structure from a tree snapshot.
     * Maps layer ids back to existing Layer objects; creates new LayerGroups.
     * @private
     */
    _restoreTree(treeSnapshot) {
        if (!treeSnapshot) {
            // No tree snapshot: flat structure (all layers at top level)
            this.engine.members = [...this.engine.layers];
            this.engine.layers.forEach(l => { l.parent = null; });
            return;
        }
        // Build id → Layer map from current engine.layers
        const layerById = new Map(this.engine.layers.map(l => [l.id, l]));

        const deserialize = (node, parent) => {
            if (node.type === 'layer') {
                const layer = layerById.get(node.id);
                if (layer) layer.parent = parent;
                return layer || null;
            }
            const group = new LayerGroup(node.name);
            group.id = node.id;
            group.visible = node.visible;
            group.locked = node.locked;
            group.opacity = node.opacity;
            group.blendMode = node.blendMode;
            group.collapsed = node.collapsed;
            group.parent = parent;
            group.children = node.children.map(c => deserialize(c, group)).filter(Boolean);
            return group;
        };

        this.engine.members = treeSnapshot.map(n => deserialize(n, null)).filter(Boolean);
    }

    /** @private */
    _notifyChange() {
        if (this.onHistoryChange) this.onHistoryChange();
    }
}
