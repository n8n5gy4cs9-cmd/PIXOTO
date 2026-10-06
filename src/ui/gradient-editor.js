/* ═══════════════════════════════════════════════════════════════
   Pixoto — Gradient Stop Editor (Phase D / P2)
   Touch-friendly multi-stop editor bound to a GradientTool.
   Add stop (tap bar), move stop (drag), recolor (color + alpha),
   remove stop (when more than two).
   ═══════════════════════════════════════════════════════════════ */

import { hexToRgb, rgbToHex } from './color-utils.js';
import { sampleStops } from '../tools/gradient.js';


export class GradientEditor {
    /**
     * @param {HTMLElement} container
     * @param {import('../tools/gradient.js').GradientTool} tool
     */
    constructor(container, tool) {
        this.container = container;
        this.tool = tool;
        this.selected = 0;
        this._dragIndex = -1;
        if (!container) return;
        this._build();
        tool.onStopsChange = () => this.render();
        this.render();
    }

    _build() {
        this.container.innerHTML = '';
        this.container.classList.add('gradient-editor');

        // Gradient preview bar + stop track
        this.bar = document.createElement('div');
        this.bar.className = 'gradient-bar';
        this.bar.style.cssText = 'position:relative;height:28px;border-radius:4px;border:1px solid var(--border,#444);' +
            'background-image:repeating-conic-gradient(#888 0% 25%, #aaa 0% 50%);background-size:12px 12px;cursor:copy;margin:6px 0;';

        this.fill = document.createElement('div');
        this.fill.style.cssText = 'position:absolute;inset:0;border-radius:3px;';
        this.bar.appendChild(this.fill);

        this.markers = document.createElement('div');
        this.markers.style.cssText = 'position:absolute;inset:0;';
        this.bar.appendChild(this.markers);

        this.bar.addEventListener('pointerdown', (e) => this._onBarDown(e));

        // Controls row: color, alpha, delete
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

        this.colorInput = document.createElement('input');
        this.colorInput.type = 'color';
        this.colorInput.className = 'color-input-sm';
        this.colorInput.title = 'Stop colour';
        this.colorInput.addEventListener('input', () => this._setSelectedColor());

        this.alphaInput = document.createElement('input');
        this.alphaInput.type = 'range';
        this.alphaInput.min = '0'; this.alphaInput.max = '255'; this.alphaInput.step = '1';
        this.alphaInput.title = 'Stop opacity';
        this.alphaInput.style.flex = '1';
        this.alphaInput.addEventListener('input', () => this._setSelectedAlpha());

        this.delBtn = document.createElement('button');
        this.delBtn.className = 'btn btn-sm btn-secondary';
        this.delBtn.textContent = 'Delete Stop';
        this.delBtn.style.minHeight = '36px';
        this.delBtn.addEventListener('click', () => this._deleteSelected());

        row.append(this.colorInput, this.alphaInput, this.delBtn);

        this.container.append(this.bar, row);
    }

    _stops() { return this.tool.stops; }

    render() {
        if (!this.bar) return;
        const stops = [...this._stops()].sort((a, b) => a.pos - b.pos);
        this.tool.stops = stops;
        if (this.selected >= stops.length) this.selected = stops.length - 1;
        if (this.selected < 0) this.selected = 0;

        // Fill bar
        const css = stops.map(s => `${s.color} ${Math.round(s.pos * 100)}%`).join(', ');
        this.fill.style.background = `linear-gradient(90deg, ${css})`;

        // Markers
        this.markers.innerHTML = '';
        stops.forEach((s, i) => {
            const m = document.createElement('div');
            const sel = i === this.selected;
            m.style.cssText = 'position:absolute;top:-4px;width:14px;height:36px;margin-left:-7px;border-radius:3px;' +
                `left:${s.pos * 100}%;background:${s.color};border:2px solid ${sel ? '#00d4ff' : '#fff'};` +
                'box-shadow:0 0 0 1px #000;cursor:grab;touch-action:none;';
            m.addEventListener('pointerdown', (e) => this._onMarkerDown(e, i));
            this.markers.appendChild(m);
        });

        // Controls reflect selected stop
        const sel = stops[this.selected];
        if (sel) {
            const c = hexToRgb(sel.color) || { r: 0, g: 0, b: 0, a: 255 };
            this.colorInput.value = rgbToHex(c.r, c.g, c.b);
            this.alphaInput.value = String(c.a);
        }
        this.delBtn.disabled = stops.length <= 2;
    }

    _posFromEvent(e) {
        const rect = this.bar.getBoundingClientRect();
        return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }

    _onBarDown(e) {
        if (e.target !== this.bar && e.target !== this.fill) return; // marker handled separately
        const pos = this._posFromEvent(e);
        const stops = this._stops();
        stops.push({ pos, color: sampleStops([...stops].sort((a, b) => a.pos - b.pos), pos) });
        stops.sort((a, b) => a.pos - b.pos);
        this.selected = stops.findIndex(s => s.pos === pos);
        this.render();
    }

    _onMarkerDown(e, index) {
        e.stopPropagation();
        e.preventDefault();
        this.selected = index;
        this._dragIndex = index;
        const move = (ev) => {
            const stops = this._stops();
            if (this._dragIndex < 0 || this._dragIndex >= stops.length) return;
            stops[this._dragIndex].pos = this._posFromEvent(ev);
            // keep sorted, track moving stop by identity
            const moving = stops[this._dragIndex];
            stops.sort((a, b) => a.pos - b.pos);
            this._dragIndex = stops.indexOf(moving);
            this.selected = this._dragIndex;
            this.render();
        };
        const up = () => {
            this._dragIndex = -1;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        this.render();
    }

    _setSelectedColor() {
        const stops = this._stops();
        const s = stops[this.selected];
        if (!s) return;
        const cur = hexToRgb(s.color) || { a: 255 };
        const rgb = hexToRgb(this.colorInput.value) || { r: 0, g: 0, b: 0 };
        s.color = rgbToHex(rgb.r, rgb.g, rgb.b, cur.a);
        this.render();
    }

    _setSelectedAlpha() {
        const stops = this._stops();
        const s = stops[this.selected];
        if (!s) return;
        const c = hexToRgb(s.color) || { r: 0, g: 0, b: 0, a: 255 };
        s.color = rgbToHex(c.r, c.g, c.b, parseInt(this.alphaInput.value));
        this.render();
    }

    _deleteSelected() {
        const stops = this._stops();
        if (stops.length <= 2) return;
        stops.splice(this.selected, 1);
        this.selected = Math.max(0, this.selected - 1);
        this.render();
    }
}
