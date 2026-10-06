/* ═══════════════════════════════════════════════════════════════
   Pixoto — Fill Bucket Tool (Phase 4)
   Flood fill using PixelEngine.floodFill().
   Supports tolerance and contiguous/global mode.
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';


export class FillTool extends Tool {
    constructor(manager) {
        super('fill', manager);
    }

    getCursor() {
        // Crosshair works for fill — user clicks to fill
        return 'crosshair';
    }

    onPointerDown(cx, cy, e) {
        const x = Math.floor(cx);
        const y = Math.floor(cy);
        const color = this.manager.foregroundColor;
        const tolerance = this.manager.fillTolerance;
        const contiguous = this.manager.fillContiguous;

        this.manager.pixelEngine.floodFill(x, y, color, tolerance, contiguous);
        this.manager.engine.requestComposite();
    }

    // Fill is a single-click tool — no move/up needed
    onPointerMove(cx, cy, e) {}
    onPointerUp(cx, cy, e) {}
}
