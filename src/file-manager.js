/* ═══════════════════════════════════════════════════════════════
   Pixoto — File Manager (Phase 7 + Phase B/C)
   Open images, export (PNG/JPG/WebP), save/load .pixoto projects,
   auto-save to localStorage.
   ═══════════════════════════════════════════════════════════════ */

import { Layer, LayerGroup } from './canvas-engine.js';
import { AdjustmentLayer } from './filters/filters.js';

export class FileManager {
    /**
     * @param {import('./canvas-engine.js').CanvasEngine} engine
     */
    constructor(engine) {
        this.engine = engine;

        /** Auto-save interval ID. */
        this._autoSaveTimer = null;

        /** Seconds between auto-saves. */
        this.autoSaveInterval = 60;
    }


    // ═════════════════════════════════════════════════════════
    // Open Image File
    // ═════════════════════════════════════════════════════════

    /**
     * Open an image file and load it onto the canvas.
     * If `asNewLayer` is true, adds as a new layer; otherwise replaces canvas.
     * @param {File} file
     * @param {boolean} [asNewLayer=false]
     * @returns {Promise<void>}
     */
    async openImage(file, asNewLayer = false) {
        if (!file) return;

        // Handle .pixoto project files
        if (file.name.endsWith('.pixoto')) {
            return this.loadProject(file);
        }

        const img = await this._loadImageFromFile(file);
        const name = file.name.replace(/\.[^.]+$/, '');

        if (asNewLayer) {
            // P1 — Place image as a new layer, fit to canvas keeping aspect ratio.
            return this.placeImageAsLayer(img, name);
        } else {
            // Replace canvas: resize to image dimensions, draw onto background layer
            this.engine.init(img.width, img.height, null);
            const layer = this.engine.getActiveLayer();
            if (layer) {
                layer.ctx.drawImage(img, 0, 0);
                layer.markAllDirty();
            }
            this.engine.requestComposite();
        }

        console.log(`[FileManager] Opened: ${file.name} (${img.width}×${img.height})`);
    }

    /**
     * P1 — Place an already-loaded image into the CURRENT document as a new layer,
     * fit to the canvas keeping aspect ratio and centered. Never upscales past the
     * image's native size unless `fill` is requested. Respects pixel/photo smoothing.
     * Ported behaviour from PixiEditor PasteImage_UpdateableChange.cs.
     * @param {HTMLImageElement|ImageBitmap|HTMLCanvasElement} img
     * @param {string} [name='Image']
     * @param {{fill?: boolean}} [opts]
     * @returns {{ layer: import('./canvas-engine.js').Layer, x: number, y: number, w: number, h: number }}
     */
    placeImageAsLayer(img, name = 'Image', { fill = false } = {}) {
        const engine = this.engine;
        const docW = engine.docWidth;
        const docH = engine.docHeight;
        const iw = img.width || img.naturalWidth;
        const ih = img.height || img.naturalHeight;
        if (!iw || !ih) return null;

        // scale = min(docW/imgW, docH/imgH); don't upscale past native unless fill
        let scale = Math.min(docW / iw, docH / ih);
        if (!fill) scale = Math.min(scale, 1);

        const w = Math.max(1, Math.round(iw * scale));
        const h = Math.max(1, Math.round(ih * scale));
        const x = Math.round((docW - w) / 2);
        const y = Math.round((docH - h) / 2);

        const layer = engine.addLayer(name);
        layer.ctx.imageSmoothingEnabled = !engine.pixelArtMode;
        if (!engine.pixelArtMode) layer.ctx.imageSmoothingQuality = 'high';
        layer.ctx.drawImage(img, x, y, w, h);
        layer.markAllDirty();
        engine.requestComposite();

        console.log(`[FileManager] Placed image as layer: ${name} (${w}×${h} @ ${x},${y})`);
        return { layer, x, y, w, h };
    }

    /**
     * Load an image from a Blob (e.g. clipboard or drag-drop) into an HTMLImageElement.
     * @param {Blob} blob
     * @returns {Promise<HTMLImageElement>}
     */
    loadImageFromBlob(blob) {
        return this._loadImageFromFile(blob);
    }

    /**
     * Load an image from a File object.
     * @private
     * @param {File} file
     * @returns {Promise<HTMLImageElement>}
     */
    _loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error(`Failed to load image: ${file.name}`));
            };
            img.src = url;
        });
    }


    // ═════════════════════════════════════════════════════════
    // Export Image
    // ═════════════════════════════════════════════════════════

    /**
     * Export the flattened canvas as an image file.
     * @param {'png'|'jpg'|'webp'} format
     * @param {number} [quality=0.92] - Quality for JPG/WebP (0–1)
     * @param {string} [filename='pixoto-export']
     */
    exportImage(format = 'png', quality = 0.92, filename = 'pixoto-export') {
        const canvas = this.engine.getFlattenedCanvas();

        let mimeType, ext;
        switch (format) {
            case 'jpg':
                mimeType = 'image/jpeg';
                ext = 'jpg';
                break;
            case 'webp':
                mimeType = 'image/webp';
                ext = 'webp';
                break;
            default:
                mimeType = 'image/png';
                ext = 'png';
                break;
        }

        // For OffscreenCanvas → Blob; for regular canvas → toBlob
        if (canvas.convertToBlob) {
            canvas.convertToBlob({ type: mimeType, quality })
                .then(blob => this._downloadBlob(blob, `${filename}.${ext}`));
        } else {
            canvas.toBlob(
                (blob) => this._downloadBlob(blob, `${filename}.${ext}`),
                mimeType,
                quality
            );
        }

        console.log(`[FileManager] Exported: ${filename}.${ext} (${format})`);
    }

    /**
     * Download a Blob as a file.
     * @private
     * @param {Blob} blob
     * @param {string} filename
     */
    _downloadBlob(blob, filename) {
        // Try navigator.share first (works on iOS Safari PWA)
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] })) {
            const file = new File([blob], filename, { type: blob.type });
            navigator.share({ files: [file], title: filename }).catch(() => {
                // Share cancelled or failed — fall back to anchor download
                this._anchorDownload(blob, filename);
            });
            return;
        }
        this._anchorDownload(blob, filename);
    }

    /**
     * Classic anchor-click download fallback.
     * @private
     */
    _anchorDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }


    // ═════════════════════════════════════════════════════════
    // .pixoto Project Save / Load
    // ═════════════════════════════════════════════════════════

    /**
     * Save the entire project state as a .pixoto file.
     * Format: JSON with base64-encoded layer image data.
     */
    saveProject(filename = 'project') {
        const project = this._serializeProject();
        const json = JSON.stringify(project);
        const blob = new Blob([json], { type: 'application/json' });
        this._downloadBlob(blob, `${filename}.pixoto`);
        console.log('[FileManager] Project saved');
    }

    /**
     * Load a .pixoto project file.
     * @param {File} file
     * @returns {Promise<void>}
     */
    async loadProject(file) {
        try {
            const text = await file.text();
            const project = JSON.parse(text);
            await this._deserializeProject(project);
            console.log('[FileManager] Project loaded');
        } catch (err) {
            console.error('[FileManager] Failed to load project:', err);
        }
    }

    /** @private Serialize one Layer/AdjustmentLayer to a descriptor. */
    _serializeLayer(layer) {
        if (layer instanceof AdjustmentLayer) {
            let aMaskURL = null;
            if (layer.mask) {
                const mt = document.createElement('canvas');
                mt.width = layer.mask.width; mt.height = layer.mask.height;
                mt.getContext('2d').drawImage(layer.mask, 0, 0);
                aMaskURL = mt.toDataURL('image/png');
            }
            return {
                id: layer.id, name: layer.name, visible: layer.visible, locked: layer.locked,
                opacity: layer.opacity, blendMode: layer.blendMode, clippedToBelow: layer.clippedToBelow,
                maskEnabled: layer.maskEnabled, maskData: aMaskURL,
                kind: 'adjustment', adjustType: layer.adjustType, params: layer.params,
            };
        }
        let dataURL;
        if (layer.canvas instanceof OffscreenCanvas) {
            const temp = document.createElement('canvas');
            temp.width = layer.canvas.width; temp.height = layer.canvas.height;
            temp.getContext('2d').drawImage(layer.canvas, 0, 0);
            dataURL = temp.toDataURL('image/png');
        } else {
            dataURL = layer.canvas.toDataURL('image/png');
        }
        let maskURL = null;
        if (layer.mask) {
            const maskTemp = document.createElement('canvas');
            maskTemp.width = layer.mask.width; maskTemp.height = layer.mask.height;
            maskTemp.getContext('2d').drawImage(layer.mask, 0, 0);
            maskURL = maskTemp.toDataURL('image/png');
        }
        return {
            id: layer.id, name: layer.name, visible: layer.visible, locked: layer.locked,
            opacity: layer.opacity, blendMode: layer.blendMode, alphaLocked: layer.alphaLocked,
            clippedToBelow: layer.clippedToBelow, maskEnabled: layer.maskEnabled,
            maskData: maskURL, effects: layer.effects || null, data: dataURL,
        };
    }

    /** @private Flat leaf list of a members tree. */
    _flattenMembers(members) {
        const flat = [];
        const walk = (list) => {
            for (const m of list) {
                if (m.children !== undefined) walk(m.children);
                else flat.push(m);
            }
        };
        walk(members);
        return flat;
    }

    /** @private Serialize a members tree to id-referencing nodes. */
    _serializeMembersTree(members) {
        const ser = (m) => {
            if (m.children !== undefined) {
                return { type: 'group', id: m.id, name: m.name, visible: m.visible, locked: m.locked,
                    opacity: m.opacity, blendMode: m.blendMode, collapsed: m.collapsed,
                    children: m.children.map(ser) };
            }
            return { type: 'layer', id: m.id };
        };
        return members.map(ser);
    }

    /** @private Serialize {layers, tree} for an arbitrary members tree. */
    _serializeMembers(members) {
        return {
            layers: this._flattenMembers(members).map((l) => this._serializeLayer(l)),
            tree: this._serializeMembersTree(members),
        };
    }

    /** @private Serialize project state to a plain object (P7: multi-frame). */
    _serializeProject() {
        const engine = this.engine;
        const anim = (typeof window !== 'undefined') ? (window.Pixoto && window.Pixoto.animation) : null;

        const base = {
            version: '1.4.0',
            format: 'pixoto',
            docWidth: engine.docWidth,
            docHeight: engine.docHeight,
            activeLayerIndex: engine.activeLayerIndex,
            timestamp: Date.now(),
        };

        if (anim && anim.frames && anim.frames.length) {
            base.fps = anim.fps;
            base.loop = anim.loop;
            base.activeFrame = anim.activeIndex;
            base.frames = anim.frames.map((f) => ({
                duration: f.duration,
                ...this._serializeMembers(f.members),
            }));
        } else {
            const m = this._serializeMembers(engine.members);
            base.layers = m.layers;
            base.tree = m.tree;
        }
        return base;
    }

    /** @private Build a Layer/AdjustmentLayer from a serialized descriptor. */
    async _buildLayer(layerData, lw, lh) {
        if (layerData.kind === 'adjustment') {
            const a = new AdjustmentLayer(layerData.adjustType, layerData.params || {}, layerData.name);
            if (layerData.id) a.id = layerData.id;
            a.canvas.width = lw; a.canvas.height = lh;
            a.visible   = layerData.visible ?? true;
            a.locked    = layerData.locked ?? false;
            a.opacity   = layerData.opacity ?? 1;
            a.blendMode = layerData.blendMode || 'source-over';
            a.clippedToBelow = layerData.clippedToBelow ?? false;
            a.maskEnabled    = layerData.maskEnabled ?? true;
            if (layerData.maskData) {
                const maskImg = await this._loadImageFromDataURL(layerData.maskData);
                try { a.mask = new OffscreenCanvas(lw, lh); }
                catch { a.mask = document.createElement('canvas'); a.mask.width = lw; a.mask.height = lh; }
                a.mask.getContext('2d').drawImage(maskImg, 0, 0);
            }
            a.markAllDirty();
            return a;
        }

        const img = await this._loadImageFromDataURL(layerData.data);
        const l = new Layer(lw, lh, layerData.name);
        if (layerData.id) l.id = layerData.id;
        l.visible = layerData.visible;
        l.locked = layerData.locked;
        l.opacity = layerData.opacity;
        l.blendMode = layerData.blendMode;
        l.alphaLocked = layerData.alphaLocked ?? false;
        l.clippedToBelow = layerData.clippedToBelow ?? false;
        l.maskEnabled = layerData.maskEnabled ?? true;
        l.effects = layerData.effects || null;
        l.ctx.drawImage(img, 0, 0);
        if (layerData.maskData) {
            const maskImg = await this._loadImageFromDataURL(layerData.maskData);
            try { l.mask = new OffscreenCanvas(lw, lh); }
            catch { l.mask = document.createElement('canvas'); l.mask.width = lw; l.mask.height = lh; }
            l.mask.getContext('2d').drawImage(maskImg, 0, 0);
        }
        l.markAllDirty();
        return l;
    }

    /** @private Build a members tree from serialized layers + tree nodes. */
    async _buildMembers(layerDescriptors, treeNodes, lw, lh) {
        const layerById = new Map();
        const flat = [];
        for (const ld of (layerDescriptors || [])) {
            const l = await this._buildLayer(ld, lw, lh);
            layerById.set(l.id, l);
            flat.push(l);
        }
        if (!treeNodes) return flat;
        const build = (node, parent) => {
            if (node.type === 'layer') {
                const l = layerById.get(node.id);
                if (l) l.parent = parent;
                return l || null;
            }
            const g = new LayerGroup(node.name);
            g.id = node.id;
            g.visible = node.visible; g.locked = node.locked;
            g.opacity = node.opacity; g.blendMode = node.blendMode;
            g.collapsed = node.collapsed ?? false; g.parent = parent;
            g.children = node.children.map((c) => build(c, g)).filter(Boolean);
            return g;
        };
        return treeNodes.map((n) => build(n, null)).filter(Boolean);
    }

    /**
     * Deserialize and restore project state (P7: multi-frame aware).
     * @private
     * @param {object} project
     * @returns {Promise<void>}
     */
    async _deserializeProject(project) {
        if (project.format !== 'pixoto') {
            throw new Error('Invalid project format');
        }

        const engine = this.engine;
        const lw = project.docWidth;
        const lh = project.docHeight;
        engine.init(lw, lh, null);

        const anim = (typeof window !== 'undefined') ? (window.Pixoto && window.Pixoto.animation) : null;

        if (project.frames && project.frames.length) {
            const frameMembers = [];
            const durations = [];
            for (const f of project.frames) {
                frameMembers.push(await this._buildMembers(f.layers, f.tree, lw, lh));
                durations.push(f.duration || 100);
            }
            if (anim) {
                anim.loadFrames(frameMembers, durations, {
                    fps: project.fps, loop: project.loop, activeIndex: project.activeFrame || 0,
                });
            } else {
                engine.members = frameMembers[project.activeFrame || 0] || frameMembers[0];
                engine._syncLayers();
            }
        } else {
            // Legacy single-frame project (v1.0.0 – v1.3.x)
            engine.members = await this._buildMembers(project.layers, project.tree, lw, lh);
            engine._syncLayers();
            if (anim) anim.reset();
        }

        engine.activeLayerIndex = Math.min(project.activeLayerIndex || 0, Math.max(0, engine.layers.length - 1));
        engine.activeMember = engine.layers[engine.activeLayerIndex] || null;

        engine.requestComposite();
        if (engine.onLayerChange) engine.onLayerChange();
        if (engine.onActiveLayerChange) engine.onActiveLayerChange(engine.activeLayerIndex);
        if (engine.onActiveMemberChange) engine.onActiveMemberChange(engine.activeMember);
    }

    /**
     * Load an image from a data URL.
     * @private
     * @param {string} dataURL
     * @returns {Promise<HTMLImageElement>}
     */
    _loadImageFromDataURL(dataURL) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load layer data'));
            img.src = dataURL;
        });
    }


    // ═════════════════════════════════════════════════════════
    // Auto-Save to localStorage
    // ═════════════════════════════════════════════════════════

    /** Start auto-saving every N seconds. */
    startAutoSave() {
        this.stopAutoSave();
        this._autoSaveTimer = setInterval(() => {
            this._autoSave();
        }, this.autoSaveInterval * 1000);
        console.log(`[FileManager] Auto-save started (every ${this.autoSaveInterval}s)`);
    }

    /** Stop auto-saving. */
    stopAutoSave() {
        if (this._autoSaveTimer) {
            clearInterval(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }
    }

    /** @private Perform auto-save to localStorage. */
    _autoSave() {
        try {
            const project = this._serializeProject();
            const json = JSON.stringify(project);

            // Check size — localStorage typically has ~5MB limit
            if (json.length > 4 * 1024 * 1024) {
                console.warn('[FileManager] Auto-save skipped: project too large for localStorage');
                return;
            }

            localStorage.setItem('pixoto-autosave', json);
            console.log('[FileManager] Auto-saved');
        } catch (err) {
            console.warn('[FileManager] Auto-save failed:', err.message);
        }
    }

    /**
     * Restore from auto-saved session.
     * @returns {Promise<boolean>} True if restored successfully.
     */
    async restoreSession() {
        const json = localStorage.getItem('pixoto-autosave');
        if (!json) return false;

        try {
            const project = JSON.parse(json);
            await this._deserializeProject(project);
            console.log('[FileManager] Session restored');
            return true;
        } catch (err) {
            console.warn('[FileManager] Session restore failed:', err.message);
            localStorage.removeItem('pixoto-autosave');
            return false;
        }
    }

    /** Check if an auto-saved session exists. */
    hasAutoSave() {
        return localStorage.getItem('pixoto-autosave') !== null;
    }

    /** Clear auto-saved session. */
    clearAutoSave() {
        localStorage.removeItem('pixoto-autosave');
    }

    /** Clean up. */
    destroy() {
        this.stopAutoSave();
    }
}
