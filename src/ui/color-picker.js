/* ═══════════════════════════════════════════════════════════════
   Pixoto — Color Picker (Phase J upgrade)
   HSL sat/light canvas + hue slider + alpha slider.
   Mode tabs: RGB / HSL / HSB / CMYK (display-only).
   RGB and HSB sliders with live updates.
   Hex input without leading #.
   PixiEditor reference: ColorPicker control (Avalonia).
   ═══════════════════════════════════════════════════════════════ */

import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb, rgbToHsb, hsbToRgb, rgbToCmyk } from './color-utils.js';

export class ColorPicker {
    /**
     * @param {object} opts
     * @param {HTMLCanvasElement} opts.pickerCanvas
     * @param {HTMLElement}       opts.pickerCursor
     * @param {HTMLCanvasElement} opts.hueCanvas
     * @param {HTMLElement}       opts.hueThumb
     * @param {HTMLCanvasElement} opts.alphaCanvas
     * @param {HTMLElement}       opts.alphaThumb
     * @param {HTMLInputElement}  opts.hexInput       — #picker-hex (WITHOUT leading #)
     * @param {HTMLInputElement}  opts.rInput         — #picker-r
     * @param {HTMLInputElement}  opts.gInput         — #picker-g
     * @param {HTMLInputElement}  opts.bInput         — #picker-b
     * @param {HTMLInputElement}  opts.hInput         — #picker-h (HSL)
     * @param {HTMLInputElement}  opts.sInput         — #picker-s (HSL)
     * @param {HTMLInputElement}  opts.lInput         — #picker-l (HSL)
     * @param {HTMLElement}       opts.colorOld
     * @param {HTMLElement}       opts.colorNew
     * @param {function}          opts.onChange       — (hexColor, alpha) => void
     */
    constructor(opts) {
        this.pickerCanvas = opts.pickerCanvas;
        this.pickerCursor = opts.pickerCursor;
        this.hueCanvas    = opts.hueCanvas;
        this.hueThumb     = opts.hueThumb;
        this.alphaCanvas  = opts.alphaCanvas;
        this.alphaThumb   = opts.alphaThumb;
        this.hexInput     = opts.hexInput;
        this.rInput       = opts.rInput;
        this.gInput       = opts.gInput;
        this.bInput       = opts.bInput;
        this.hInput       = opts.hInput;
        this.sInput       = opts.sInput;
        this.lInput       = opts.lInput;
        this.colorOld     = opts.colorOld;
        this.colorNew     = opts.colorNew;
        this.onChange     = opts.onChange || null;

        // Core HSL state (0–360, 0–100, 0–100)
        this._hue   = 0;
        this._sat   = 0;
        this._light = 100;
        this._alpha = 1;

        // Active mode tab
        this._mode = 'rgb';

        // Drag state
        this._pickingArea  = false;
        this._pickingHue   = false;
        this._pickingAlpha = false;

        this._init();
    }

    /** Set current color from a hex string '#rrggbb'. */
    setColor(hex) {
        const rgb = hexToRgb(hex);
        if (!rgb) return;
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        this._hue   = hsl.h;
        this._sat   = hsl.s;
        this._light = hsl.l;
        if (this.colorOld) this.colorOld.style.background = hex;
        this._updateAll();
    }

    /** Get current color as '#rrggbb'. */
    getHex() {
        const rgb = hslToRgb(this._hue, this._sat, this._light);
        return rgbToHex(rgb.r, rgb.g, rgb.b);
    }

    /** Get current alpha 0–1. */
    getAlpha() { return this._alpha; }


    // ═══════════════════════════════════════════════════════════
    // Init
    // ═══════════════════════════════════════════════════════════

    _init() {
        this._drawHueStrip();
        this._drawAlphaStrip();
        this._drawPickerArea();
        this._updateAll();
        this._wireEvents();
        this._wireModeTab();
    }

    _wireModeTab() {
        document.querySelectorAll('.picker-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.picker-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._mode = btn.dataset.mode;
                document.querySelectorAll('.picker-values-panel').forEach(p => {
                    p.hidden = (p.id !== `picker-panel-${this._mode}`);
                });
                this._updateAll();
            });
        });
    }

    _wireEvents() {
        this._onDocMove = (e) => {
            if (this._pickingArea)  this._handleAreaPick(e);
            if (this._pickingHue)   this._handleHuePick(e);
            if (this._pickingAlpha) this._handleAlphaPick(e);
        };
        this._onDocUp = () => {
            this._pickingArea = this._pickingHue = this._pickingAlpha = false;
            document.removeEventListener('pointermove', this._onDocMove);
            document.removeEventListener('pointerup',   this._onDocUp);
        };
        const startDrag = () => {
            document.addEventListener('pointermove', this._onDocMove);
            document.addEventListener('pointerup',   this._onDocUp);
        };

        this.pickerCanvas?.addEventListener('pointerdown', (e) => {
            e.preventDefault(); this._pickingArea = true; startDrag(); this._handleAreaPick(e);
        });
        this.hueCanvas?.addEventListener('pointerdown', (e) => {
            e.preventDefault(); this._pickingHue = true; startDrag(); this._handleHuePick(e);
        });
        this.alphaCanvas?.addEventListener('pointerdown', (e) => {
            e.preventDefault(); this._pickingAlpha = true; startDrag(); this._handleAlphaPick(e);
        });

        // Hex input (without #)
        this.hexInput?.addEventListener('change', () => {
            let val = this.hexInput.value.replace(/^#/, '').trim();
            if (/^[0-9a-fA-F]{6}$/.test(val)) {
                const rgb = hexToRgb('#' + val);
                if (rgb) {
                    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
                    this._hue = hsl.h; this._sat = hsl.s; this._light = hsl.l;
                    this._updateAll();
                }
            }
        });

        // RGB number inputs
        const rgbHandler = () => {
            const r = Math.max(0, Math.min(255, parseInt(this.rInput?.value) || 0));
            const g = Math.max(0, Math.min(255, parseInt(this.gInput?.value) || 0));
            const b = Math.max(0, Math.min(255, parseInt(this.bInput?.value) || 0));
            const hsl = rgbToHsl(r, g, b);
            this._hue = hsl.h; this._sat = hsl.s; this._light = hsl.l;
            this._updateAll();
        };
        this.rInput?.addEventListener('change', rgbHandler);
        this.gInput?.addEventListener('change', rgbHandler);
        this.bInput?.addEventListener('change', rgbHandler);

        // RGB range sliders
        const q = (id) => document.getElementById(id);
        const rgbRangeHandler = () => {
            const r = parseInt(q('picker-rgb-r')?.value) || 0;
            const g = parseInt(q('picker-rgb-g')?.value) || 0;
            const b = parseInt(q('picker-rgb-b')?.value) || 0;
            const hsl = rgbToHsl(r, g, b);
            this._hue = hsl.h; this._sat = hsl.s; this._light = hsl.l;
            this._updateAll();
        };
        q('picker-rgb-r')?.addEventListener('input', rgbRangeHandler);
        q('picker-rgb-g')?.addEventListener('input', rgbRangeHandler);
        q('picker-rgb-b')?.addEventListener('input', rgbRangeHandler);

        // HSL number inputs
        const hslHandler = () => {
            this._hue   = Math.max(0, Math.min(360, parseInt(this.hInput?.value)  || 0));
            this._sat   = Math.max(0, Math.min(100, parseInt(this.sInput?.value)  || 0));
            this._light = Math.max(0, Math.min(100, parseInt(this.lInput?.value)  || 0));
            this._updateAll();
        };
        this.hInput?.addEventListener('change', hslHandler);
        this.sInput?.addEventListener('change', hslHandler);
        this.lInput?.addEventListener('change', hslHandler);

        // HSL range sliders
        const hslRangeHandler = () => {
            this._hue   = parseInt(q('picker-hsl-h')?.value) || 0;
            this._sat   = parseInt(q('picker-hsl-s')?.value) || 0;
            this._light = parseInt(q('picker-hsl-l')?.value) || 0;
            this._updateAll();
        };
        q('picker-hsl-h')?.addEventListener('input', hslRangeHandler);
        q('picker-hsl-s')?.addEventListener('input', hslRangeHandler);
        q('picker-hsl-l')?.addEventListener('input', hslRangeHandler);

        // HSB range sliders
        const hsbRangeHandler = () => {
            const h = parseInt(q('picker-hsb-h')?.value) || 0;
            const s = parseInt(q('picker-hsb-s')?.value) || 0;
            const b = parseInt(q('picker-hsb-b')?.value) || 0;
            const rgb = hsbToRgb(h, s, b);
            const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
            this._hue = hsl.h; this._sat = hsl.s; this._light = hsl.l;
            this._updateAll();
        };
        q('picker-hsb-h')?.addEventListener('input', hsbRangeHandler);
        q('picker-hsb-s')?.addEventListener('input', hsbRangeHandler);
        q('picker-hsb-b')?.addEventListener('input', hsbRangeHandler);

        // HSB number inputs
        const hsbNumHandler = () => {
            const h = parseInt(q('picker-hsb-hv')?.value) || 0;
            const s = parseInt(q('picker-hsb-sv')?.value) || 0;
            const b = parseInt(q('picker-hsb-bv')?.value) || 0;
            const rgb = hsbToRgb(h, s, b);
            const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
            this._hue = hsl.h; this._sat = hsl.s; this._light = hsl.l;
            this._updateAll();
        };
        q('picker-hsb-hv')?.addEventListener('change', hsbNumHandler);
        q('picker-hsb-sv')?.addEventListener('change', hsbNumHandler);
        q('picker-hsb-bv')?.addEventListener('change', hsbNumHandler);
    }


    // ═══════════════════════════════════════════════════════════
    // Canvas Drawing
    // ═══════════════════════════════════════════════════════════

    _drawPickerArea() {
        if (!this.pickerCanvas) return;
        const ctx = this.pickerCanvas.getContext('2d');
        const w = this.pickerCanvas.width, h = this.pickerCanvas.height;
        const gradH = ctx.createLinearGradient(0, 0, w, 0);
        gradH.addColorStop(0, '#fff');
        gradH.addColorStop(1, `hsl(${this._hue},100%,50%)`);
        ctx.fillStyle = gradH;
        ctx.fillRect(0, 0, w, h);
        const gradV = ctx.createLinearGradient(0, 0, 0, h);
        gradV.addColorStop(0, 'rgba(0,0,0,0)');
        gradV.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = gradV;
        ctx.fillRect(0, 0, w, h);
    }

    _drawHueStrip() {
        if (!this.hueCanvas) return;
        const ctx = this.hueCanvas.getContext('2d');
        const w = this.hueCanvas.width, h = this.hueCanvas.height;
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }

    _drawAlphaStrip() {
        if (!this.alphaCanvas) return;
        const ctx = this.alphaCanvas.getContext('2d');
        const w = this.alphaCanvas.width, h = this.alphaCanvas.height;
        const sz = 4;
        for (let y = 0; y < h; y += sz)
            for (let x = 0; x < w; x += sz) {
                ctx.fillStyle = ((x / sz + y / sz) % 2 === 0) ? '#ccc' : '#999';
                ctx.fillRect(x, y, sz, sz);
            }
        const rgb = hslToRgb(this._hue, this._sat, this._light);
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
        grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},1)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }


    // ═══════════════════════════════════════════════════════════
    // Interaction Handlers
    // ═══════════════════════════════════════════════════════════

    _handleAreaPick(e) {
        if (!this.pickerCanvas) return;
        const rect = this.pickerCanvas.getBoundingClientRect();
        let x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        let y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        // Convert (x=saturation, 1-y=value) in HSV to HSL
        const v = 1 - y;
        const l = v * (1 - x / 2);
        const s = (l === 0 || l === 1) ? 0 : (v - l) / Math.min(l, 1 - l);
        this._sat   = Math.round(s * 100);
        this._light = Math.round(l * 100);
        this._updateAll();
    }

    _handleHuePick(e) {
        if (!this.hueCanvas) return;
        const rect = this.hueCanvas.getBoundingClientRect();
        let x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this._hue = Math.round(x * 360);
        this._drawPickerArea();
        this._updateAll();
    }

    _handleAlphaPick(e) {
        if (!this.alphaCanvas) return;
        const rect = this.alphaCanvas.getBoundingClientRect();
        let x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this._alpha = Math.round(x * 100) / 100;
        this._updateAll();
    }


    // ═══════════════════════════════════════════════════════════
    // State Sync
    // ═══════════════════════════════════════════════════════════

    _updateAll() {
        const rgb = hslToRgb(this._hue, this._sat, this._light);
        const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
        const hexNoHash = hex.slice(1);

        // Hex input (no #)
        if (this.hexInput && document.activeElement !== this.hexInput)
            this.hexInput.value = hexNoHash;

        // RGB number inputs + sliders
        const q = (id) => document.getElementById(id);
        if (this.rInput) this.rInput.value = rgb.r;
        if (this.gInput) this.gInput.value = rgb.g;
        if (this.bInput) this.bInput.value = rgb.b;
        _setIfNotActive(q('picker-rgb-r'), rgb.r);
        _setIfNotActive(q('picker-rgb-g'), rgb.g);
        _setIfNotActive(q('picker-rgb-b'), rgb.b);

        // HSL number inputs + sliders
        if (this.hInput) this.hInput.value = this._hue;
        if (this.sInput) this.sInput.value = this._sat;
        if (this.lInput) this.lInput.value = this._light;
        _setIfNotActive(q('picker-hsl-h'), this._hue);
        _setIfNotActive(q('picker-hsl-s'), this._sat);
        _setIfNotActive(q('picker-hsl-l'), this._light);

        // HSB inputs + sliders
        const hsb = rgbToHsb(rgb.r, rgb.g, rgb.b);
        _setIfNotActive(q('picker-hsb-h'),  hsb.h);
        _setIfNotActive(q('picker-hsb-s'),  hsb.s);
        _setIfNotActive(q('picker-hsb-b'),  hsb.b);
        _setIfNotActive(q('picker-hsb-hv'), hsb.h);
        _setIfNotActive(q('picker-hsb-sv'), hsb.s);
        _setIfNotActive(q('picker-hsb-bv'), hsb.b);

        // CMYK display
        const cmyk = rgbToCmyk(rgb.r, rgb.g, rgb.b);
        const setCmyk = (id, v) => { const el = q(id); if (el) el.textContent = `${v}%`; };
        setCmyk('cmyk-c', cmyk.c);
        setCmyk('cmyk-m', cmyk.m);
        setCmyk('cmyk-y', cmyk.y);
        setCmyk('cmyk-k', cmyk.k);

        // Color preview
        if (this.colorNew) this.colorNew.style.background = hex;

        // Cursor on picker area (HSL→HSV for position)
        if (this.pickerCanvas && this.pickerCursor) {
            const l = this._light / 100, s = this._sat / 100;
            const v = l + s * Math.min(l, 1 - l);
            const sv = v === 0 ? 0 : 2 * (1 - l / v);
            this.pickerCursor.style.left = `${(sv * 100).toFixed(2)}%`;
            this.pickerCursor.style.top  = `${((1 - v) * 100).toFixed(2)}%`;
        }

        // Slider thumbs
        if (this.hueThumb)   this.hueThumb.style.left   = `${(this._hue / 360 * 100).toFixed(2)}%`;
        if (this.alphaThumb) this.alphaThumb.style.left  = `${(this._alpha * 100).toFixed(2)}%`;

        this._drawPickerArea();
        this._drawAlphaStrip();

        if (this.onChange) this.onChange(hex, this._alpha);
    }
}

/** Set input value only if the user is not currently editing it. */
function _setIfNotActive(el, val) {
    if (el && document.activeElement !== el) el.value = val;
}
