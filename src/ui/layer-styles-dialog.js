/* ═══════════════════════════════════════════════════════════════
   Pixoto — Layer Styles Dialog (P6)
   Live, non-destructive editor for per-layer effects. Mutates
   layer.effects and re-composites on every change (the real canvas
   is the preview). Touch-friendly bottom-sheet on mobile.
   ═══════════════════════════════════════════════════════════════ */

import { defaultEffects, EFFECT_ORDER, EFFECT_LABELS, hasEnabledEffect } from '../layer-styles.js';

const BLEND_MODES = [
    { value: 'source-over', label: 'Normal' },
    { value: 'multiply',    label: 'Multiply' },
    { value: 'screen',      label: 'Screen' },
    { value: 'overlay',     label: 'Overlay' },
    { value: 'darken',      label: 'Darken' },
    { value: 'lighten',     label: 'Lighten' },
    { value: 'color-dodge', label: 'Color Dodge' },
    { value: 'color-burn',  label: 'Color Burn' },
    { value: 'hard-light',  label: 'Hard Light' },
    { value: 'soft-light',  label: 'Soft Light' },
];

// Field definitions per effect — drives the control builder.
const FIELDS = {
    dropShadow: [
        { p: 'color', t: 'color', l: 'Color' },
        { p: 'opacity', t: 'slider', l: 'Opacity', min: 0, max: 1, step: 0.05 },
        { p: 'distance', t: 'slider', l: 'Distance', min: 0, max: 100, step: 1, suffix: 'px' },
        { p: 'angle', t: 'slider', l: 'Angle', min: 0, max: 360, step: 1, suffix: '°' },
        { p: 'blur', t: 'slider', l: 'Blur', min: 0, max: 50, step: 1, suffix: 'px' },
    ],
    outerGlow: [
        { p: 'color', t: 'color', l: 'Color' },
        { p: 'opacity', t: 'slider', l: 'Opacity', min: 0, max: 1, step: 0.05 },
        { p: 'blur', t: 'slider', l: 'Blur', min: 0, max: 100, step: 1, suffix: 'px' },
        { p: 'spread', t: 'slider', l: 'Spread', min: 0, max: 50, step: 1, suffix: 'px' },
    ],
    stroke: [
        { p: 'color', t: 'color', l: 'Color' },
        { p: 'opacity', t: 'slider', l: 'Opacity', min: 0, max: 1, step: 0.05 },
        { p: 'size', t: 'slider', l: 'Size', min: 0, max: 50, step: 1, suffix: 'px' },
        { p: 'position', t: 'select', l: 'Position', options: [
            { value: 'out', label: 'Outside' }, { value: 'center', label: 'Center' }, { value: 'in', label: 'Inside' } ] },
    ],
    colorOverlay: [
        { p: 'color', t: 'color', l: 'Color' },
        { p: 'opacity', t: 'slider', l: 'Opacity', min: 0, max: 1, step: 0.05 },
        { p: 'blend', t: 'select', l: 'Blend', options: BLEND_MODES },
    ],
    gradientOverlay: [
        { p: 'color1', t: 'color', l: 'Color 1' },
        { p: 'color2', t: 'color', l: 'Color 2' },
        { p: 'angle', t: 'slider', l: 'Angle', min: 0, max: 360, step: 1, suffix: '°' },
        { p: 'opacity', t: 'slider', l: 'Opacity', min: 0, max: 1, step: 0.05 },
        { p: 'blend', t: 'select', l: 'Blend', options: BLEND_MODES },
    ],
    innerShadow: [
        { p: 'color', t: 'color', l: 'Color' },
        { p: 'opacity', t: 'slider', l: 'Opacity', min: 0, max: 1, step: 0.05 },
        { p: 'distance', t: 'slider', l: 'Distance', min: 0, max: 50, step: 1, suffix: 'px' },
        { p: 'angle', t: 'slider', l: 'Angle', min: 0, max: 360, step: 1, suffix: '°' },
        { p: 'blur', t: 'slider', l: 'Blur', min: 0, max: 50, step: 1, suffix: 'px' },
    ],
    innerGlow: [
        { p: 'color', t: 'color', l: 'Color' },
        { p: 'opacity', t: 'slider', l: 'Opacity', min: 0, max: 1, step: 0.05 },
        { p: 'blur', t: 'slider', l: 'Blur', min: 0, max: 50, step: 1, suffix: 'px' },
    ],
    bevel: [
        { p: 'size', t: 'slider', l: 'Size', min: 0, max: 50, step: 1, suffix: 'px' },
        { p: 'angle', t: 'slider', l: 'Angle', min: 0, max: 360, step: 1, suffix: '°' },
        { p: 'depth', t: 'slider', l: 'Depth', min: 0, max: 1, step: 0.05 },
        { p: 'highlight', t: 'color', l: 'Highlight' },
        { p: 'shadow', t: 'color', l: 'Shadow' },
    ],
};

export class LayerStylesDialog {
    /**
     * @param {object} opts
     * @param {HTMLElement} opts.dialog   - #layer-styles-dialog
     * @param {HTMLElement} opts.title    - #layer-styles-title
     * @param {HTMLElement} opts.controls - #layer-styles-controls
     * @param {HTMLElement} opts.btnClose - #layer-styles-close
     * @param {import('../canvas-engine.js').CanvasEngine} opts.engine
     * @param {import('../history.js').HistoryManager|null} opts.history
     */
    constructor(opts) {
        this._dialog   = opts.dialog;
        this._titleEl  = opts.title;
        this._controls = opts.controls;
        this._btnClose = opts.btnClose;
        this.engine    = opts.engine;
        this.history   = opts.history;

        this._layer = null;

        this._btnClose?.addEventListener('click', () => this.close());
        this._dialog?.querySelector('.modal-overlay')?.addEventListener('click', () => this.close());
        this._dialog?.querySelector('.modal-close')?.addEventListener('click', () => this.close());
    }

    /** Open the editor for a real Layer. */
    open(layer) {
        if (!layer || layer.adjustType !== undefined || !layer.canvas) return;

        this._layer = layer;
        if (!layer.effects) layer.effects = defaultEffects();
        if (this.history) this.history.saveSnapshot('Layer Styles');

        if (this._titleEl) this._titleEl.textContent = `Layer Styles — ${layer.name}`;
        this._build();
        if (this._dialog) this._dialog.hidden = false;
    }

    close() {
        if (this._dialog) this._dialog.hidden = true;
        this._layer = null;
    }

    // ─── Internal ────────────────────────────────────────────────

    _commit() {
        if (!this._layer) return;
        this._layer.markAllDirty?.();
        this.engine.requestComposite();
        if (window.Pixoto?.layersPanel) window.Pixoto.layersPanel.render();
    }

    _set(key, param, value) {
        if (!this._layer?.effects) return;
        this._layer.effects[key][param] = value;
        this._commit();
    }

    _build() {
        if (!this._controls) return;
        this._controls.innerHTML = '';
        const fx = this._layer.effects;

        for (const key of EFFECT_ORDER) {
            const e = fx[key];
            if (!e) continue;

            const section = document.createElement('div');
            section.className = 'fx-section';

            // Header: enable toggle + label
            const header = document.createElement('label');
            header.className = 'fx-section-header';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = !!e.enabled;
            const titleSpan = document.createElement('span');
            titleSpan.textContent = EFFECT_LABELS[key];
            header.appendChild(chk);
            header.appendChild(titleSpan);
            section.appendChild(header);

            // Body
            const body = document.createElement('div');
            body.className = 'fx-section-body';
            body.style.display = e.enabled ? '' : 'none';
            for (const f of FIELDS[key]) {
                body.appendChild(this._field(key, e, f));
            }
            section.appendChild(body);

            chk.addEventListener('change', () => {
                body.style.display = chk.checked ? '' : 'none';
                this._set(key, 'enabled', chk.checked);
            });

            this._controls.appendChild(section);
        }
    }

    _field(key, e, f) {
        const row = document.createElement('div');
        row.className = 'fx-row';
        const lbl = document.createElement('span');
        lbl.className = 'fx-row-label';
        lbl.textContent = f.l;
        row.appendChild(lbl);

        if (f.t === 'color') {
            const inp = document.createElement('input');
            inp.type = 'color';
            inp.value = e[f.p];
            inp.addEventListener('input', () => this._set(key, f.p, inp.value));
            row.appendChild(inp);
        } else if (f.t === 'select') {
            const sel = document.createElement('select');
            for (const o of f.options) {
                const opt = document.createElement('option');
                opt.value = o.value; opt.textContent = o.label;
                if (o.value === e[f.p]) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.addEventListener('change', () => this._set(key, f.p, sel.value));
            row.appendChild(sel);
        } else { // slider
            const inp = document.createElement('input');
            inp.type = 'range';
            inp.min = f.min; inp.max = f.max; inp.step = f.step;
            inp.value = e[f.p];
            const val = document.createElement('span');
            val.className = 'fx-row-val';
            const fmt = (v) => `${f.step < 1 ? (+v).toFixed(2) : v}${f.suffix || ''}`;
            val.textContent = fmt(inp.value);
            inp.addEventListener('input', () => {
                val.textContent = fmt(inp.value);
                this._set(key, f.p, parseFloat(inp.value));
            });
            row.appendChild(inp);
            row.appendChild(val);
        }
        return row;
    }
}
