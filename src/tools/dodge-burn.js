/* ═══════════════════════════════════════════════════════════════
   Pixoto — Dodge & Burn Tools (Phase G)
   Dodge: lightens pixels under the brush.
   Burn:  darkens  pixels under the brush.
   Both operate only within the tonal range: shadows/midtones/highlights.
   PixiEditor reference: IBrightnessToolHandler.cs
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';


// ─── Shared base ─────────────────────────────────────────────────

class DodgeBurnBase extends Tool {
    constructor(name, manager, mode) {
        super(name, manager);

        this._mode    = mode;  // 'dodge' | 'burn'
        this.size     = 30;
        this.exposure = 0.30;  // 0–1
        this.range    = 'midtones'; // 'shadows' | 'midtones' | 'highlights'

        this._strokeActive = false;
        this._lastX = 0;
        this._lastY = 0;
    }

    getCursor() { return 'crosshair'; }

    onPointerDown(cx, cy, e) {
        this._strokeActive = true;
        this._lastX = cx; this._lastY = cy;
        this._dab(cx, cy);
    }

    onPointerMove(cx, cy, e) {
        if (!this._strokeActive) return;
        const dx = cx - this._lastX, dy = cy - this._lastY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < this.size * 0.2) return;
        this._dab(cx, cy);
        this._lastX = cx; this._lastY = cy;
    }

    onPointerUp(cx, cy, e) {
        this._strokeActive = false;
    }


    // ─── Internal ────────────────────────────────────────────────

    _dab(cx, cy) {
        const eng   = this.manager.engine;
        const layer = eng.getActiveLayer?.();
        if (!layer || layer.locked) return;

        const r = this.size;
        const sx = Math.round(cx - r), sy = Math.round(cy - r);
        const diam = r * 2;

        // Clamp to canvas bounds
        const canvasW = eng.docWidth, canvasH = eng.docHeight;
        const x1 = Math.max(0, sx), y1 = Math.max(0, sy);
        const x2 = Math.min(canvasW, sx + diam), y2 = Math.min(canvasH, sy + diam);
        if (x2 <= x1 || y2 <= y1) return;

        const w = x2 - x1, h = y2 - y1;
        const imgData = layer.ctx.getImageData(x1, y1, w, h);
        const d = imgData.data;

        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                // Distance check for circular brush
                const lx = (x1 + px) - cx, ly = (y1 + py) - cy;
                const dist2 = lx * lx + ly * ly;
                if (dist2 > r * r) continue;

                // Soft feather: 1 at center, 0 at edge
                const falloff = 1 - Math.sqrt(dist2) / r;
                const strength = this.exposure * falloff;

                const idx = (py * w + px) * 4;
                const ri = d[idx], gi = d[idx+1], bi = d[idx+2];
                const lum = (ri + gi + bi) / (3 * 255);

                // Tonal range weight
                let weight;
                if (this.range === 'shadows')    weight = Math.max(0, 1 - lum * 2);
                else if (this.range === 'highlights') weight = Math.max(0, lum * 2 - 1);
                else weight = Math.max(0, 1 - Math.abs(lum - 0.5) * 4); // midtones bell

                if (weight < 0.01) continue;
                const adj = strength * weight;

                if (this._mode === 'dodge') {
                    // Lighten by multiplying towards 255
                    d[idx]   = _clamp(Math.round(ri   + (255 - ri)   * adj));
                    d[idx+1] = _clamp(Math.round(gi   + (255 - gi)   * adj));
                    d[idx+2] = _clamp(Math.round(bi   + (255 - bi)   * adj));
                } else {
                    // Burn: darken by multiplying towards 0
                    d[idx]   = _clamp(Math.round(ri   - ri   * adj));
                    d[idx+1] = _clamp(Math.round(gi   - gi   * adj));
                    d[idx+2] = _clamp(Math.round(bi   - bi   * adj));
                }
            }
        }

        layer.ctx.putImageData(imgData, x1, y1);
        layer.markAllDirty();
        eng.requestComposite();
    }
}

function _clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }


// ─── Exported classes ────────────────────────────────────────────

export class DodgeTool extends DodgeBurnBase {
    constructor(manager) { super('dodge', manager, 'dodge'); }
}

export class BurnTool extends DodgeBurnBase {
    constructor(manager) { super('burn', manager, 'burn'); }
}
