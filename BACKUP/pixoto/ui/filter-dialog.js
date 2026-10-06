/* ═══════════════════════════════════════════════════════════════
   Pixoto — Filter Dialog (Phase F)
   Manages the filter/adjustment modal: live preview, controls,
   worker dispatch, apply to active layer.
   PixiEditor reference: ApplyFilterNode.cs, ColorAdjustmentsFilterNode.cs
   ═══════════════════════════════════════════════════════════════ */

import { AdjustmentLayer, applyAdjustment } from '../filters/filters.js';

// ─── Filter metadata ──────────────────────────────────────────────
// Maps action string → { title, workerType, adjType, buildControls, defaultParams }

const FILTER_DEFS = {
    // ── Destructive filters ──────────────────────────────────────
    'filter-gaussian-blur': {
        title: 'Gaussian Blur',
        workerType: 'gaussian-blur',
        destructive: true,
        defaultParams: { radius: 3 },
        buildControls: (p) => [
            sliderRow('Radius', 'radius', 1, 100, p.radius, 'px'),
        ],
    },
    'filter-sharpen': {
        title: 'Sharpen',
        workerType: 'sharpen',
        destructive: true,
        defaultParams: { amount: 1 },
        buildControls: (p) => [
            sliderRow('Amount', 'amount', 0.1, 5, p.amount, '', 0.1),
        ],
    },
    'filter-unsharp-mask': {
        title: 'Unsharp Mask',
        workerType: 'unsharp-mask',
        destructive: true,
        defaultParams: { amount: 0.5 },
        buildControls: (p) => [
            sliderRow('Amount', 'amount', 0.1, 3, p.amount, '', 0.1),
        ],
    },
    'filter-invert': {
        title: 'Invert',
        workerType: 'invert',
        destructive: true,
        defaultParams: {},
        buildControls: () => [],
    },
    'filter-grayscale': {
        title: 'Grayscale',
        workerType: 'grayscale',
        destructive: true,
        defaultParams: {},
        buildControls: () => [],
    },
    'filter-sepia': {
        title: 'Sepia',
        workerType: 'sepia',
        destructive: true,
        defaultParams: {},
        buildControls: () => [],
    },
    'filter-posterize': {
        title: 'Posterize',
        workerType: 'posterize',
        destructive: true,
        defaultParams: { levels: 4 },
        buildControls: (p) => [
            sliderRow('Levels', 'levels', 2, 32, p.levels),
        ],
    },
    'filter-noise': {
        title: 'Add Noise',
        workerType: 'noise',
        destructive: true,
        defaultParams: { amount: 25, monochrome: true },
        buildControls: (p) => [
            sliderRow('Amount', 'amount', 1, 100, p.amount, '%'),
            checkRow('Monochrome', 'monochrome', p.monochrome),
        ],
    },
    'filter-outline': {
        title: 'Outline / Glow',
        workerType: 'outline',
        destructive: true,
        defaultParams: { color: '#000000', thickness: 2 },
        buildControls: (p) => [
            colorRow('Color', 'color', p.color),
            sliderRow('Thickness', 'thickness', 1, 20, p.thickness, 'px'),
        ],
    },

    // ── Adjustment layer types ──────────────────────────────────
    'adj-brightness-contrast': {
        title: 'Brightness / Contrast',
        workerType: 'brightness-contrast',
        destructive: false,
        adjType: 'brightness-contrast',
        defaultParams: { brightness: 0, contrast: 0 },
        buildControls: (p) => [
            sliderRow('Brightness', 'brightness', -100, 100, p.brightness),
            sliderRow('Contrast', 'contrast', -100, 100, p.contrast),
        ],
    },
    'adj-hue-saturation': {
        title: 'Hue / Saturation',
        workerType: 'hue-saturation',
        destructive: false,
        adjType: 'hue-saturation',
        defaultParams: { hue: 0, saturation: 0, lightness: 0 },
        buildControls: (p) => [
            sliderRow('Hue', 'hue', -180, 180, p.hue, '°'),
            sliderRow('Saturation', 'saturation', -100, 100, p.saturation),
            sliderRow('Lightness', 'lightness', -100, 100, p.lightness),
        ],
    },
    'adj-levels': {
        title: 'Levels',
        workerType: 'levels',
        destructive: false,
        adjType: 'levels',
        defaultParams: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
        buildControls: (p) => [
            sliderRow('In Black',  'inBlack',  0, 254, p.inBlack),
            sliderRow('In White',  'inWhite',  1, 255, p.inWhite),
            sliderRow('Gamma',     'gamma',    0.1, 9.99, p.gamma, '', 0.01),
            sliderRow('Out Black', 'outBlack', 0, 254, p.outBlack),
            sliderRow('Out White', 'outWhite', 1, 255, p.outWhite),
        ],
    },
    'adj-curves': {
        title: 'Curves (RGB)',
        workerType: 'curves',
        destructive: false,
        adjType: 'curves',
        defaultParams: { rgb: { shadows:0, darks:0, lights:0, highlights:0 } },
        buildControls: (p) => {
            const rp = p.rgb || {};
            return [
                sliderRow('Shadows',    'rgb.shadows',    -100, 100, rp.shadows    ?? 0),
                sliderRow('Darks',      'rgb.darks',      -100, 100, rp.darks      ?? 0),
                sliderRow('Lights',     'rgb.lights',     -100, 100, rp.lights     ?? 0),
                sliderRow('Highlights', 'rgb.highlights', -100, 100, rp.highlights ?? 0),
            ];
        },
    },
    'adj-color-balance': {
        title: 'Color Balance',
        workerType: 'color-balance',
        destructive: false,
        adjType: 'color-balance',
        defaultParams: { shadows:{r:0,g:0,b:0}, midtones:{r:0,g:0,b:0}, highlights:{r:0,g:0,b:0} },
        buildControls: (p) => {
            const s = p.shadows||{}, m = p.midtones||{}, h = p.highlights||{};
            return [
                labelRow('Shadows'),
                sliderRow('R', 'shadows.r', -100, 100, s.r ?? 0),
                sliderRow('G', 'shadows.g', -100, 100, s.g ?? 0),
                sliderRow('B', 'shadows.b', -100, 100, s.b ?? 0),
                labelRow('Midtones'),
                sliderRow('R', 'midtones.r', -100, 100, m.r ?? 0),
                sliderRow('G', 'midtones.g', -100, 100, m.g ?? 0),
                sliderRow('B', 'midtones.b', -100, 100, m.b ?? 0),
                labelRow('Highlights'),
                sliderRow('R', 'highlights.r', -100, 100, h.r ?? 0),
                sliderRow('G', 'highlights.g', -100, 100, h.g ?? 0),
                sliderRow('B', 'highlights.b', -100, 100, h.b ?? 0),
            ];
        },
    },
    'adj-vibrance': {
        title: 'Vibrance',
        workerType: 'vibrance',
        destructive: false,
        adjType: 'vibrance',
        defaultParams: { amount: 0 },
        buildControls: (p) => [
            sliderRow('Amount', 'amount', -100, 100, p.amount),
        ],
    },
    'adj-gradient-map': {
        title: 'Gradient Map',
        workerType: 'gradient-map',
        destructive: false,
        adjType: 'gradient-map',
        defaultParams: { colorLow: '#000000', colorHigh: '#ffffff' },
        buildControls: (p) => [
            colorRow('Shadow color',    'colorLow',  p.colorLow),
            colorRow('Highlight color', 'colorHigh', p.colorHigh),
        ],
    },
    'adj-threshold': {
        title: 'Threshold',
        workerType: 'threshold',
        destructive: false,
        adjType: 'threshold',
        defaultParams: { threshold: 128 },
        buildControls: (p) => [
            sliderRow('Threshold', 'threshold', 0, 255, p.threshold),
        ],
    },
};


// ─── Control builders ─────────────────────────────────────────────

function sliderRow(label, key, min, max, value, suffix = '', step = 1) {
    const row = document.createElement('div');
    row.className = 'filter-row';

    const lbl = document.createElement('label');
    lbl.textContent = label;
    row.appendChild(lbl);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min; slider.max = max; slider.step = step;
    slider.value = value;
    slider.dataset.key = key;
    row.appendChild(slider);

    const val = document.createElement('span');
    val.className = 'filter-val';
    val.textContent = `${value}${suffix}`;
    row.appendChild(val);

    slider.addEventListener('input', () => {
        val.textContent = `${parseFloat(slider.value).toFixed(step < 1 ? 2 : 0)}${suffix}`;
    });

    return row;
}

function checkRow(label, key, checked) {
    const row = document.createElement('div');
    row.className = 'filter-row';

    const lbl = document.createElement('label');
    lbl.style.cursor = 'pointer';

    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!checked; cb.dataset.key = key;
    cb.style.marginRight = '6px';

    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(label));
    row.appendChild(lbl);
    return row;
}

function colorRow(label, key, value) {
    const row = document.createElement('div');
    row.className = 'filter-row';

    const lbl = document.createElement('label');
    lbl.textContent = label;
    row.appendChild(lbl);

    const inp = document.createElement('input');
    inp.type = 'color'; inp.value = value || '#000000';
    inp.dataset.key = key;
    inp.style.cssText = 'width:48px;height:24px;border:none;padding:0;border-radius:3px;cursor:pointer;';
    row.appendChild(inp);
    return row;
}

function labelRow(text) {
    const row = document.createElement('div');
    row.className = 'filter-row';
    const lbl = document.createElement('label');
    lbl.textContent = text;
    lbl.style.cssText = 'min-width:100%;font-weight:600;color:var(--text);padding-top:6px;';
    row.appendChild(lbl);
    return row;
}


// ─── Read params from DOM controls ───────────────────────────────

function readParams(controlsEl) {
    const params = {};

    controlsEl.querySelectorAll('[data-key]').forEach(el => {
        const key = el.dataset.key;
        let value;
        if (el.type === 'checkbox') value = el.checked;
        else if (el.type === 'color') value = el.value;
        else value = parseFloat(el.value);

        // Support dotted keys like 'rgb.shadows'
        const parts = key.split('.');
        let obj = params;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!obj[parts[i]]) obj[parts[i]] = {};
            obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
    });

    return params;
}


// ═══════════════════════════════════════════════════════════════
// FilterDialog class
// ═══════════════════════════════════════════════════════════════

export class FilterDialog {
    /**
     * @param {object} opts
     * @param {HTMLElement} opts.dialog       — #filter-dialog
     * @param {HTMLElement} opts.title        — #filter-dialog-title
     * @param {HTMLCanvasElement} opts.preview — #filter-preview-canvas
     * @param {HTMLElement} opts.controls     — #filter-controls
     * @param {HTMLElement} opts.btnApply     — #filter-apply
     * @param {HTMLElement} opts.btnCancel    — #filter-cancel
     * @param {import('../canvas-engine.js').CanvasEngine} opts.engine
     * @param {import('../history.js').HistoryManager|null} opts.history
     */
    constructor(opts) {
        this._dialog   = opts.dialog;
        this._titleEl  = opts.title;
        this._preview  = opts.preview;
        this._controls = opts.controls;
        this._btnApply  = opts.btnApply;
        this._btnCancel = opts.btnCancel;
        this.engine    = opts.engine;
        this.history   = opts.history;

        this._action   = null;
        this._def      = null;
        this._srcData  = null;   // Original ImageData snapshot
        this._previewW = 0;
        this._previewH = 0;
        this._worker   = null;
        this._previewDebounce = null;

        this._btnApply?.addEventListener('click',  () => this._onApply());
        this._btnCancel?.addEventListener('click', () => this.close());

        // Close on modal overlay click
        this._dialog?.querySelector('.modal-overlay')
            ?.addEventListener('click', () => this.close());
        this._dialog?.querySelector('.modal-close')
            ?.addEventListener('click', () => this.close());
    }

    /** Open the dialog for a given action string. */
    open(action) {
        const def = FILTER_DEFS[action];
        if (!def) { console.warn('[FilterDialog] Unknown action:', action); return; }

        this._action = action;
        this._def    = def;

        // Snapshot active layer
        const layer = this.engine?.getActiveLayer?.();
        if (!layer) return;

        this._srcData = layer.ctx.getImageData(0, 0, this.engine.docWidth, this.engine.docHeight);

        // Build preview at reduced size (max 240px on longest edge)
        const maxDim = 240;
        const scale  = Math.min(1, maxDim / Math.max(this.engine.docWidth, this.engine.docHeight));
        this._previewW = Math.max(1, Math.round(this.engine.docWidth  * scale));
        this._previewH = Math.max(1, Math.round(this.engine.docHeight * scale));

        if (this._preview) {
            this._preview.width  = this._previewW;
            this._preview.height = this._previewH;
            this._updatePreviewFromSource();
        }

        // Set title
        if (this._titleEl) this._titleEl.textContent = def.title;

        // Build controls
        if (this._controls) {
            this._controls.innerHTML = '';
            const rows = def.buildControls({ ...def.defaultParams });
            rows.forEach(r => this._controls.appendChild(r));
            // Live preview on control change
            this._controls.addEventListener('input', () => this._schedulePreview());
        }

        // Show dialog
        if (this._dialog) this._dialog.hidden = false;

        // Initial preview
        this._schedulePreview();
    }

    close() {
        if (this._dialog) this._dialog.hidden = true;
        this._terminateWorker();
        this._srcData = null;
    }

    // ─── Internal ────────────────────────────────────────────────

    /** Draw source data scaled into preview canvas. */
    _updatePreviewFromSource() {
        if (!this._srcData || !this._preview) return;
        const tmp = document.createElement('canvas');
        tmp.width = this.engine.docWidth; tmp.height = this.engine.docHeight;
        tmp.getContext('2d').putImageData(this._srcData, 0, 0);
        const ctx = this._preview.getContext('2d');
        ctx.clearRect(0, 0, this._previewW, this._previewH);
        ctx.drawImage(tmp, 0, 0, this._previewW, this._previewH);
    }

    _schedulePreview() {
        clearTimeout(this._previewDebounce);
        this._previewDebounce = setTimeout(() => this._runPreview(), 60);
    }

    _runPreview() {
        if (!this._srcData || !this._preview || !this._def) return;
        const params = readParams(this._controls);

        // Scale source to preview size
        const tmp = document.createElement('canvas');
        tmp.width = this._previewW; tmp.height = this._previewH;
        const tctx = tmp.getContext('2d');
        const bigTmp = document.createElement('canvas');
        bigTmp.width = this.engine.docWidth; bigTmp.height = this.engine.docHeight;
        bigTmp.getContext('2d').putImageData(this._srcData, 0, 0);
        tctx.drawImage(bigTmp, 0, 0, this._previewW, this._previewH);
        const imgData = tctx.getImageData(0, 0, this._previewW, this._previewH);

        // Run filter synchronously on preview (small canvas — fast enough)
        applyAdjustment(this._def.workerType, params, imgData, this._previewW, this._previewH);

        const pctx = this._preview.getContext('2d');
        pctx.putImageData(imgData, 0, 0);
    }

    _onApply() {
        if (!this._def || !this._srcData) { this.close(); return; }
        const params = readParams(this._controls);
        const layer = this.engine?.getActiveLayer?.();
        if (!layer) { this.close(); return; }

        if (this._def.destructive) {
            // Apply destructively to layer via worker
            this._applyDestructive(layer, params);
        } else {
            // Add a new AdjustmentLayer above the active layer
            this._applyAsAdjustmentLayer(params);
        }

        this.close();
    }

    _applyDestructive(layer, params) {
        if (this.history) this.history.saveSnapshot(this._def.title);

        const w = this.engine.docWidth, h = this.engine.docHeight;
        const imgData = layer.ctx.getImageData(0, 0, w, h);

        // Run in worker for blur-heavy ops; sync for instant ones
        const slowOps = new Set(['gaussian-blur', 'sharpen', 'unsharp-mask', 'outline']);
        if (slowOps.has(this._def.workerType)) {
            this._terminateWorker();
            try {
                const workerUrl = new URL('../filters/filter-worker.js', import.meta.url).href;
                this._worker = new Worker(workerUrl);
                const buf = imgData.data.buffer.slice(0);
                const fallbackSync = (errMsg) => {
                    console.warn('[FilterDialog] Worker failed, running sync:', errMsg);
                    // Re-fetch imgData since buffer was transferred
                    const fallbackData = layer.ctx.getImageData(0, 0, w, h);
                    applyAdjustment(this._def.workerType, params, fallbackData, w, h);
                    layer.ctx.putImageData(fallbackData, 0, 0);
                    layer.markAllDirty();
                    this.engine.requestComposite();
                    this._terminateWorker();
                };
                this._worker.onerror = (e) => fallbackSync(e.message || e);
                this._worker.onmessage = (e) => {
                    if (e.data.error) { fallbackSync(e.data.error); return; }
                    const result = new ImageData(new Uint8ClampedArray(e.data.buffer), w, h);
                    layer.ctx.putImageData(result, 0, 0);
                    layer.markAllDirty();
                    this.engine.requestComposite();
                    this._terminateWorker();
                };
                this._worker.postMessage(
                    { type: this._def.workerType, params, buffer: buf, width: w, height: h },
                    [buf]
                );
            } catch (err) {
                // Worker construction failed (e.g. file:// protocol) — fall back to sync
                console.warn('[FilterDialog] Worker construction failed, running sync:', err);
                applyAdjustment(this._def.workerType, params, imgData, w, h);
                layer.ctx.putImageData(imgData, 0, 0);
                layer.markAllDirty();
                this.engine.requestComposite();
            }
        } else {
            applyAdjustment(this._def.workerType, params, imgData, w, h);
            layer.ctx.putImageData(imgData, 0, 0);
            layer.markAllDirty();
            this.engine.requestComposite();
        }
    }

    _applyAsAdjustmentLayer(params) {
        if (this.history) this.history.saveSnapshot(`Add ${this._def.title}`);

        const adjLayer = new AdjustmentLayer(this._def.adjType, params, this._def.title);
        adjLayer.canvas.width  = this.engine.docWidth;
        adjLayer.canvas.height = this.engine.docHeight;

        // Insert above active layer
        const idx = this.engine.activeLayerIndex;
        this.engine.layers.splice(idx + 1, 0, adjLayer);
        this.engine.activeLayerIndex = idx + 1;

        this.engine.requestComposite();

        // Update layers panel if available
        if (window.Pixoto?.layersPanel) {
            window.Pixoto.layersPanel.render();
        }
    }

    _terminateWorker() {
        if (this._worker) { this._worker.terminate(); this._worker = null; }
    }
}
