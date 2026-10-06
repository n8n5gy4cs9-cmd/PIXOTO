/* ═══════════════════════════════════════════════════════════════
   Pixoto — Eyedropper Tool (Phase 4)
   Samples pixel color on click, updates foreground color.
   Alt-click from any tool is handled by ToolManager, but this
   is the dedicated standalone eyedropper tool.
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';
import { rgbToHex } from '../ui/color-utils.js';


export class EyedropperTool extends Tool {
    constructor(manager) {
        super('eyedropper', manager);

        /** Callback: called with hex color string when a color is sampled. */
        this.onColorPicked = null;
    }

    getCursor() {
        return 'crosshair';
    }

    onPointerDown(cx, cy, e) {
        this._sample(cx, cy);
    }

    onPointerMove(cx, cy, e) {
        // Live preview while dragging
        this._sample(cx, cy);
    }

    onPointerUp(cx, cy, e) {
        // Final sample
        this._sample(cx, cy);
    }

    /**
     * Sample the pixel at canvas coordinates and update foreground color.
     * @private
     */
    _sample(cx, cy) {
        const x = Math.floor(cx);
        const y = Math.floor(cy);

        // Sample from composited display (what the user sees)
        const pixel = this.manager.pixelEngine.getPixel(x, y, true);
        if (!pixel) return;

        // Convert to hex
        const hex = rgbToHex(pixel.r, pixel.g, pixel.b);

        // Update tool manager state
        this.manager.setForegroundColor(hex);

        // Notify app.js to update UI
        if (this.onColorPicked) {
            this.onColorPicked(hex);
        }
    }

}
