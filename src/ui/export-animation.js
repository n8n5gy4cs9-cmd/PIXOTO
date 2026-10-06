/* ═══════════════════════════════════════════════════════════════
   Pixoto — Animation export / import (P7)
   Export the timeline as an animated GIF, a PNG sprite sheet, or a
   PNG sequence. Import a sprite sheet by slicing it into frames.
   ═══════════════════════════════════════════════════════════════ */

import { encodeGIF } from '../lib/gif-encoder.js';

function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export class ExportAnimation {
    /**
     * @param {object} opts
     * @param {HTMLElement} opts.dialog   - #export-anim-dialog
     * @param {HTMLElement} opts.title    - #export-anim-title
     * @param {HTMLElement} opts.controls - #export-anim-controls
     * @param {HTMLElement} opts.btnGo    - #export-anim-go
     * @param {HTMLElement} opts.btnCancel- #export-anim-cancel
     * @param {import('../animation.js').AnimationManager} opts.anim
     * @param {import('../canvas-engine.js').CanvasEngine} opts.engine
     */
    constructor(opts) {
        this._dialog = opts.dialog;
        this._title = opts.title;
        this._controls = opts.controls;
        this._btnGo = opts.btnGo;
        this._btnCancel = opts.btnCancel;
        this.anim = opts.anim;
        this.engine = opts.engine;

        this._format = 'gif';

        this._btnGo?.addEventListener('click', () => this._run());
        this._btnCancel?.addEventListener('click', () => this.close());
        this._dialog?.querySelector('.modal-overlay')?.addEventListener('click', () => this.close());
        this._dialog?.querySelector('.modal-close')?.addEventListener('click', () => this.close());
    }

    open() {
        if (this._title) this._title.textContent = 'Export / Import Animation';
        this._build();
        if (this._dialog) this._dialog.hidden = false;
    }

    close() { if (this._dialog) this._dialog.hidden = true; }

    // ─── Build controls ───────────────────────────────────────────
    _build() {
        if (!this._controls) return;
        this._controls.innerHTML = '';

        const fmtRow = document.createElement('div');
        fmtRow.className = 'fx-row';
        fmtRow.innerHTML = '<span class="fx-row-label">Format</span>';
        const sel = document.createElement('select');
        [['gif', 'Animated GIF'], ['sheet', 'Sprite Sheet (PNG)'], ['sequence', 'PNG Sequence'], ['import', 'Import Sprite Sheet…']]
            .forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); });
        sel.value = this._format;
        sel.addEventListener('change', () => { this._format = sel.value; this._buildFields(); });
        fmtRow.appendChild(sel);
        this._controls.appendChild(fmtRow);

        this._fields = document.createElement('div');
        this._controls.appendChild(this._fields);
        this._buildFields();
    }

    _buildFields() {
        this._fields.innerHTML = '';
        const add = (el) => this._fields.appendChild(el);

        if (this._format === 'gif') {
            this._loop = this._checkRow('Loop forever', true);
            add(this._loop.row);
            add(this._info(`${this.anim.count} frame(s), per-frame duration from the timeline.`));
            this._setGo('Export GIF');
        } else if (this._format === 'sheet') {
            this._cols = this._numRow('Columns', Math.ceil(Math.sqrt(this.anim.count)), 1, 64);
            this._pad = this._numRow('Padding (px)', 0, 0, 64);
            add(this._cols.row); add(this._pad.row);
            this._setGo('Export Sheet');
        } else if (this._format === 'sequence') {
            add(this._info(`Downloads ${this.anim.count} PNG file(s), one per frame.`));
            this._setGo('Export Sequence');
        } else if (this._format === 'import') {
            this._file = document.createElement('input');
            this._file.type = 'file';
            this._file.accept = 'image/*';
            const fr = document.createElement('div'); fr.className = 'fx-row';
            fr.innerHTML = '<span class="fx-row-label">Image</span>';
            fr.appendChild(this._file);
            add(fr);
            this._impCols = this._numRow('Columns', 4, 1, 64);
            this._impRows = this._numRow('Rows', 1, 1, 64);
            add(this._impCols.row); add(this._impRows.row);
            add(this._info('Slices the image into a grid and appends each cell as a new frame.'));
            this._setGo('Import Frames');
        }
    }

    _setGo(label) { if (this._btnGo) this._btnGo.textContent = label; }

    _checkRow(label, checked) {
        const row = document.createElement('div'); row.className = 'fx-row';
        row.innerHTML = `<span class="fx-row-label">${label}</span>`;
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
        row.appendChild(input);
        return { row, get value() { return input.checked; } };
    }
    _numRow(label, value, min, max) {
        const row = document.createElement('div'); row.className = 'fx-row';
        row.innerHTML = `<span class="fx-row-label">${label}</span>`;
        const input = document.createElement('input'); input.type = 'number';
        input.value = value; input.min = min; input.max = max;
        row.appendChild(input);
        return { row, get value() { return parseInt(input.value) || min; } };
    }
    _info(text) {
        const d = document.createElement('div');
        d.className = 'export-anim-info';
        d.textContent = text;
        return d;
    }

    // ─── Run ──────────────────────────────────────────────────────
    _run() {
        try {
            if (this._format === 'gif') this._exportGIF(this._loop.value);
            else if (this._format === 'sheet') this._exportSheet(this._cols.value, this._pad.value);
            else if (this._format === 'sequence') this._exportSequence();
            else if (this._format === 'import') { this._importSheet(); return; } // closes async
        } catch (err) {
            console.error('[ExportAnimation]', err);
            alert('Export failed: ' + err.message);
        }
        this.close();
    }

    _frameCanvas(i) {
        const w = this.engine.docWidth, h = this.engine.docHeight;
        const src = this.anim.flattenFrame(i);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = !this.engine.pixelArtMode;
        ctx.drawImage(src, 0, 0);
        return c;
    }

    _exportGIF(loop) {
        const w = this.engine.docWidth, h = this.engine.docHeight;
        const frames = [];
        for (let i = 0; i < this.anim.count; i++) {
            const c = this._frameCanvas(i);
            const data = c.getContext('2d').getImageData(0, 0, w, h).data;
            frames.push({ data, delay: this.anim.frames[i].duration });
        }
        const bytes = encodeGIF(frames, { width: w, height: h, loop: loop ? 0 : 1 });
        download(new Blob([bytes], { type: 'image/gif' }), 'pixoto.gif');
    }

    _exportSheet(cols, pad) {
        const w = this.engine.docWidth, h = this.engine.docHeight, n = this.anim.count;
        cols = Math.max(1, cols);
        const rows = Math.ceil(n / cols);
        const sw = cols * w + (cols + 1) * pad;
        const sh = rows * h + (rows + 1) * pad;
        const c = document.createElement('canvas'); c.width = sw; c.height = sh;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = !this.engine.pixelArtMode;
        for (let i = 0; i < n; i++) {
            const r = Math.floor(i / cols), col = i % cols;
            ctx.drawImage(this._frameCanvas(i), pad + col * (w + pad), pad + r * (h + pad));
        }
        c.toBlob((b) => download(b, 'pixoto-sheet.png'), 'image/png');
    }

    _exportSequence() {
        for (let i = 0; i < this.anim.count; i++) {
            const c = this._frameCanvas(i);
            const name = `pixoto-frame-${String(i + 1).padStart(3, '0')}.png`;
            c.toBlob((b) => download(b, name), 'image/png');
        }
    }

    _importSheet() {
        const file = this._file?.files?.[0];
        if (!file) { alert('Choose an image to import.'); return; }
        const cols = this._impCols.value, rows = this._impRows.value;
        const img = new Image();
        img.onload = () => {
            const cellW = Math.floor(img.width / cols);
            const cellH = Math.floor(img.height / rows);
            const canvases = [];
            for (let r = 0; r < rows; r++) {
                for (let col = 0; col < cols; col++) {
                    const c = document.createElement('canvas');
                    c.width = cellW; c.height = cellH;
                    c.getContext('2d').drawImage(img, col * cellW, r * cellH, cellW, cellH, 0, 0, cellW, cellH);
                    canvases.push(c);
                }
            }
            this.anim.importFrames(canvases);
            URL.revokeObjectURL(img.src);
            this.close();
        };
        img.onerror = () => { alert('Could not load that image.'); };
        img.src = URL.createObjectURL(file);
    }
}
