/* ═══════════════════════════════════════════════════════════════
   Pixoto — Pixel Filter Library (Phase F)
   Pure ImageData transforms. All functions mutate in-place and return
   the same ImageData for chaining.
   PixiEditor reference: ApplyFilterNode.cs, ColorAdjustmentsFilterNode.cs,
   ColorMatrixFilterNode.cs, BlurNode.cs
   ═══════════════════════════════════════════════════════════════ */


// ─── Helpers ─────────────────────────────────────────────────────

function clamp(v, lo = 0, hi = 255) { return v < lo ? lo : v > hi ? hi : v; }

/** RGB → HSL; returns [h 0-360, s 0-1, l 0-1] */
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
}

function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
}

/** HSL → RGB; returns [r 0-255, g 0-255, b 0-255] */
function hslToRgb(h, s, l) {
    h /= 360;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
        Math.round(hue2rgb(p, q, h + 1/3) * 255),
        Math.round(hue2rgb(p, q, h)       * 255),
        Math.round(hue2rgb(p, q, h - 1/3) * 255)
    ];
}


// ═══════════════════════════════════════════════════════════════
// Destructive Filters
// ═══════════════════════════════════════════════════════════════

export function invertFilter(imageData) {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
        d[i]   = 255 - d[i];
        d[i+1] = 255 - d[i+1];
        d[i+2] = 255 - d[i+2];
    }
    return imageData;
}

export function grayscaleFilter(imageData) {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
        const v = Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]);
        d[i] = d[i+1] = d[i+2] = v;
    }
    return imageData;
}

export function sepiaFilter(imageData) {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i+1], b = d[i+2];
        d[i]   = clamp(r * 0.393 + g * 0.769 + b * 0.189);
        d[i+1] = clamp(r * 0.349 + g * 0.686 + b * 0.168);
        d[i+2] = clamp(r * 0.272 + g * 0.534 + b * 0.131);
    }
    return imageData;
}

/**
 * @param {number} brightness  -100 … +100  (0 = no change)
 * @param {number} contrast    -100 … +100  (0 = no change)
 */
export function brightnessContrastFilter(imageData, brightness = 0, contrast = 0) {
    const d = imageData.data;
    const b = brightness * 2.55;  // map to -255..+255
    const factor = contrast === 0 ? 1
        : (259 * (contrast + 255)) / (255 * (259 - contrast));

    for (let i = 0; i < d.length; i += 4) {
        d[i]   = clamp(Math.round(factor * (d[i]   + b - 128) + 128));
        d[i+1] = clamp(Math.round(factor * (d[i+1] + b - 128) + 128));
        d[i+2] = clamp(Math.round(factor * (d[i+2] + b - 128) + 128));
    }
    return imageData;
}

/**
 * @param {number} hue         -180 … +180 degrees shift
 * @param {number} saturation  -100 … +100
 * @param {number} lightness   -100 … +100
 */
export function hueSaturationFilter(imageData, hue = 0, saturation = 0, lightness = 0) {
    const d = imageData.data;
    const sShift = saturation / 100;
    const lShift = lightness  / 100;

    for (let i = 0; i < d.length; i += 4) {
        if (d[i+3] === 0) continue;
        let [h, s, l] = rgbToHsl(d[i], d[i+1], d[i+2]);
        h = (h + hue + 360) % 360;
        s = clamp(s + sShift, 0, 1);
        l = clamp(l + lShift, 0, 1);
        const [r, g, b] = hslToRgb(h, s, l);
        d[i] = r; d[i+1] = g; d[i+2] = b;
    }
    return imageData;
}

/**
 * @param {number} inBlack    0–254
 * @param {number} inWhite    1–255
 * @param {number} gamma      0.1–9.99  (1.0 = no change)
 * @param {number} outBlack   0–254
 * @param {number} outWhite   1–255
 */
export function levelsFilter(imageData, inBlack = 0, inWhite = 255, gamma = 1.0, outBlack = 0, outWhite = 255) {
    const d = imageData.data;
    const inv = 1 / (inWhite - inBlack);
    const outRange = outWhite - outBlack;
    const gammaInv = gamma > 0 ? 1 / gamma : 1;

    // Precompute lookup table
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        let v = (i - inBlack) * inv;
        v = clamp(v, 0, 1);
        v = Math.pow(v, gammaInv);
        lut[i] = Math.round(v * outRange + outBlack);
    }

    for (let i = 0; i < d.length; i += 4) {
        d[i]   = lut[d[i]];
        d[i+1] = lut[d[i+1]];
        d[i+2] = lut[d[i+2]];
    }
    return imageData;
}

/**
 * Per-channel tone curve: applies a simple 4-point spline (highlights, lights, darks, shadows).
 * curve: { shadows, darks, lights, highlights } each in -100…+100 per channel
 * channel: 'rgb' | 'r' | 'g' | 'b'
 */
export function curvesFilter(imageData, params = {}) {
    const d = imageData.data;

    function buildLut(shadows = 0, darks = 0, lights = 0, highlights = 0) {
        const lut = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            // Blend adjustments weighted by position along the tonal range
            const sW = Math.max(0, 1 - t * 4);
            const dW = Math.max(0, 1 - Math.abs(t - 0.25) * 4);
            const lW = Math.max(0, 1 - Math.abs(t - 0.75) * 4);
            const hW = Math.max(0, (t - 0.75) * 4);
            const shift = shadows * sW + darks * dW + lights * lW + highlights * hW;
            lut[i] = clamp(Math.round(i + shift * 1.28));
        }
        return lut;
    }

    const rp = params.r || {};
    const gp = params.g || {};
    const bp = params.b || {};
    const rgb = params.rgb || {};

    const rgbLut = buildLut(rgb.shadows, rgb.darks, rgb.lights, rgb.highlights);
    const rLut   = buildLut(rp.shadows,  rp.darks,  rp.lights,  rp.highlights);
    const gLut   = buildLut(gp.shadows,  gp.darks,  gp.lights,  gp.highlights);
    const bLut   = buildLut(bp.shadows,  bp.darks,  bp.lights,  bp.highlights);

    for (let i = 0; i < d.length; i += 4) {
        d[i]   = rLut[rgbLut[d[i]]];
        d[i+1] = gLut[rgbLut[d[i+1]]];
        d[i+2] = bLut[rgbLut[d[i+2]]];
    }
    return imageData;
}

/**
 * @param {number} shadows     -100 … +100 per RGB balance
 * @param {number} midtones    -100 … +100
 * @param {number} highlights  -100 … +100
 * Each is {r, g, b} adjustments
 */
export function colorBalanceFilter(imageData, shadows = {}, midtones = {}, highlights = {}) {
    const d = imageData.data;
    const s  = { r: (shadows.r    || 0) * 0.5, g: (shadows.g    || 0) * 0.5, b: (shadows.b    || 0) * 0.5 };
    const m  = { r: (midtones.r   || 0) * 0.5, g: (midtones.g   || 0) * 0.5, b: (midtones.b   || 0) * 0.5 };
    const h  = { r: (highlights.r || 0) * 0.5, g: (highlights.g || 0) * 0.5, b: (highlights.b || 0) * 0.5 };

    for (let i = 0; i < d.length; i += 4) {
        const t = (d[i] + d[i+1] + d[i+2]) / (3 * 255);
        const sW = Math.max(0, 1 - t * 2);
        const hW = Math.max(0, t * 2 - 1);
        const mW = 1 - sW - hW;
        d[i]   = clamp(d[i]   + s.r * sW + m.r * mW + h.r * hW);
        d[i+1] = clamp(d[i+1] + s.g * sW + m.g * mW + h.g * hW);
        d[i+2] = clamp(d[i+2] + s.b * sW + m.b * mW + h.b * hW);
    }
    return imageData;
}

/**
 * Boosts saturation of low-saturation pixels more than already-saturated ones.
 * @param {number} amount  -100 … +100
 */
export function vibranceFilter(imageData, amount = 0) {
    const d = imageData.data;
    const a = amount / 100;

    for (let i = 0; i < d.length; i += 4) {
        if (d[i+3] === 0) continue;
        const [h, s, l] = rgbToHsl(d[i], d[i+1], d[i+2]);
        // Less-saturated pixels get a stronger boost
        const boost = a * (1 - s);
        const ns = clamp(s + boost, 0, 1);
        const [r, g, b] = hslToRgb(h, ns, l);
        d[i] = r; d[i+1] = g; d[i+2] = b;
    }
    return imageData;
}

/**
 * @param {number} threshold  0–255 (< threshold → black, >= → white)
 */
export function thresholdFilter(imageData, threshold = 128) {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
        const v = lum >= threshold ? 255 : 0;
        d[i] = d[i+1] = d[i+2] = v;
    }
    return imageData;
}

/**
 * Maps pixel luminance to a gradient between two colors.
 * @param {string} colorLow   Hex color for shadows
 * @param {string} colorHigh  Hex color for highlights
 */
export function gradientMapFilter(imageData, colorLow = '#000000', colorHigh = '#ffffff') {
    const d = imageData.data;
    const lo = _hexToRgb(colorLow)  || [0, 0, 0];
    const hi = _hexToRgb(colorHigh) || [255, 255, 255];

    for (let i = 0; i < d.length; i += 4) {
        const t = (0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]) / 255;
        d[i]   = Math.round(lo[0] + (hi[0] - lo[0]) * t);
        d[i+1] = Math.round(lo[1] + (hi[1] - lo[1]) * t);
        d[i+2] = Math.round(lo[2] + (hi[2] - lo[2]) * t);
    }
    return imageData;
}

/**
 * @param {number} levels  2–32 (number of steps per channel)
 */
export function posterizeFilter(imageData, levels = 4) {
    const d = imageData.data;
    const step = 255 / (levels - 1);
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        lut[i] = Math.round(Math.round(i / step) * step);
    }
    for (let i = 0; i < d.length; i += 4) {
        d[i]   = lut[d[i]];
        d[i+1] = lut[d[i+1]];
        d[i+2] = lut[d[i+2]];
    }
    return imageData;
}

/**
 * @param {number} amount  0–100 noise intensity
 * @param {boolean} monochrome  true = grayscale noise, false = color noise
 */
export function noiseFilter(imageData, amount = 25, monochrome = true) {
    const d   = imageData.data;
    const amp = amount * 2.55;
    for (let i = 0; i < d.length; i += 4) {
        if (monochrome) {
            const n = (Math.random() - 0.5) * amp;
            d[i]   = clamp(d[i]   + n);
            d[i+1] = clamp(d[i+1] + n);
            d[i+2] = clamp(d[i+2] + n);
        } else {
            d[i]   = clamp(d[i]   + (Math.random() - 0.5) * amp);
            d[i+1] = clamp(d[i+1] + (Math.random() - 0.5) * amp);
            d[i+2] = clamp(d[i+2] + (Math.random() - 0.5) * amp);
        }
    }
    return imageData;
}

/** Convolution with a 3×3 kernel. */
export function convolveFilter(imageData, width, height, kernel, divisor = 1, offset = 0) {
    const src  = new Uint8ClampedArray(imageData.data);
    const dst  = imageData.data;
    const div  = divisor || 1;

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const pi = (y * width + x) * 4;
            for (let c = 0; c < 3; c++) {
                let acc = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const ni = ((y + ky) * width + (x + kx)) * 4 + c;
                        acc += src[ni] * kernel[(ky + 1) * 3 + (kx + 1)];
                    }
                }
                dst[pi + c] = clamp(Math.round(acc / div + offset));
            }
        }
    }
    return imageData;
}

export function sharpenFilter(imageData, width, height, amount = 1) {
    const center = 1 + 4 * amount;
    const edge   = -amount;
    return convolveFilter(imageData, width, height,
        [0, edge, 0, edge, center, edge, 0, edge, 0]);
}

export function unsharpMaskFilter(imageData, width, height, amount = 0.5) {
    // Simple unsharp: original + (original - blurred) * amount
    const blurred = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
    gaussianBlurFilter(blurred, width, height, 2);
    const d = imageData.data;
    const b = blurred.data;
    for (let i = 0; i < d.length; i += 4) {
        d[i]   = clamp(d[i]   + (d[i]   - b[i])   * amount);
        d[i+1] = clamp(d[i+1] + (d[i+1] - b[i+1]) * amount);
        d[i+2] = clamp(d[i+2] + (d[i+2] - b[i+2]) * amount);
    }
    return imageData;
}

/**
 * Box-blur approximation of Gaussian using 3 passes (fast for large radii).
 * @param {number} radius  1–100
 */
export function gaussianBlurFilter(imageData, width, height, radius = 2) {
    radius = Math.max(1, Math.round(radius));
    // 3-pass box blur approximates Gaussian
    for (let pass = 0; pass < 3; pass++) {
        _boxBlurH(imageData, width, height, radius);
        _boxBlurV(imageData, width, height, radius);
    }
    return imageData;
}

function _boxBlurH(imageData, width, height, radius) {
    const d   = imageData.data;
    const tmp = new Uint8ClampedArray(d.length);
    const iarr = 1 / (radius + radius + 1);

    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let c = 0; c < 3; c++) {
            let acc = 0;
            const firstI = row * 4 + c;
            const lastI  = (row + width - 1) * 4 + c;
            // Fill accumulator with first pixel repeated
            for (let x = -radius; x <= radius; x++) {
                acc += d[(row + Math.max(0, Math.min(width - 1, x))) * 4 + c];
            }
            for (let x = 0; x < width; x++) {
                tmp[(row + x) * 4 + c] = Math.round(acc * iarr);
                acc -= d[(row + Math.max(0, x - radius)) * 4 + c];
                acc += d[(row + Math.min(width - 1, x + radius + 1)) * 4 + c];
            }
        }
        for (let x = 0; x < width; x++) {
            const i = (row + x) * 4;
            d[i] = tmp[i]; d[i+1] = tmp[i+1]; d[i+2] = tmp[i+2];
        }
    }
}

function _boxBlurV(imageData, width, height, radius) {
    const d   = imageData.data;
    const tmp = new Uint8ClampedArray(d.length);
    const iarr = 1 / (radius + radius + 1);

    for (let x = 0; x < width; x++) {
        for (let c = 0; c < 3; c++) {
            let acc = 0;
            for (let y = -radius; y <= radius; y++) {
                acc += d[(Math.max(0, Math.min(height - 1, y)) * width + x) * 4 + c];
            }
            for (let y = 0; y < height; y++) {
                tmp[(y * width + x) * 4 + c] = Math.round(acc * iarr);
                acc -= d[(Math.max(0, y - radius) * width + x) * 4 + c];
                acc += d[(Math.min(height - 1, y + radius + 1) * width + x) * 4 + c];
            }
        }
        for (let y = 0; y < height; y++) {
            const i = (y * width + x) * 4;
            d[i] = tmp[i]; d[i+1] = tmp[i+1]; d[i+2] = tmp[i+2];
        }
    }
}

/** Edge detection → adds a glow/outline around opaque areas */
export function outlineFilter(imageData, width, height, color = '#000000', thickness = 1) {
    const d    = imageData.data;
    const orig = new Uint8ClampedArray(d);
    const [or, og, ob] = _hexToRgb(color) || [0, 0, 0];
    const r = thickness;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (orig[i + 3] > 10) continue; // already opaque — skip
            // Check if any neighbour within radius is opaque
            let found = false;
            outer: for (let dy = -r; dy <= r && !found; dy++) {
                for (let dx = -r; dx <= r && !found; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    if (orig[(ny * width + nx) * 4 + 3] > 10) found = true;
                }
            }
            if (found) {
                d[i] = or; d[i+1] = og; d[i+2] = ob; d[i+3] = 255;
            }
        }
    }
    return imageData;
}


// ═══════════════════════════════════════════════════════════════
// AdjustmentLayer class
// ═══════════════════════════════════════════════════════════════

export class AdjustmentLayer {
    constructor(adjustType, params = {}, name = null) {
        this.id         = Date.now() + Math.floor(Math.random() * 10000);
        this.adjustType = adjustType;
        this.params     = { ...params };
        this.name       = name || _adjLabel(adjustType);
        this.visible    = true;
        this.locked     = false;
        this.opacity    = 1.0;
        this.blendMode  = 'source-over';
        this.parent     = null;
        this._dirty     = true;

        // Fake canvas stub so layer-panel code that iterates layers doesn't crash
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1; this.canvas.height = 1;
        this.ctx = this.canvas.getContext('2d');
        this.mask        = null;
        this.maskEnabled = true;
        this.alphaLocked = false;
        this.clippedToBelow = false;
        this._maskProxy  = null;
    }

    get dirty()     { return this._dirty; }
    clearDirty()    { this._dirty = false; }
    markAllDirty()  { this._dirty = true; }
    markDirty()     { this._dirty = true; }

    /** Apply this adjustment to an ImageData in-place. */
    applyEffect(imageData, width, height) {
        applyAdjustment(this.adjustType, this.params, imageData, width, height);
    }

    /** Thumbnail for layers panel — render a preview swatch. */
    getThumbnail(size = 40) {
        const thumb = document.createElement('canvas');
        thumb.width = size; thumb.height = size;
        const ctx = thumb.getContext('2d');

        // Gradient swatch to show the kind of adjustment
        const grad = ctx.createLinearGradient(0, 0, size, size);
        grad.addColorStop(0, '#222');
        grad.addColorStop(1, '#eee');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        // Tiny adjustment icon overlay
        ctx.fillStyle = 'rgba(0,212,255,0.3)';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#00d4ff';
        ctx.font = `bold ${Math.round(size * 0.3)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Fx', size / 2, size / 2);
        return thumb;
    }

    getMaskThumbnail() { return null; }
    _getMaskProxy()    { return null; }

    resize() {} // no-op for adjustment layers
    clear()  {}
    fill()   {}
    addMask()    {}
    removeMask() {}
    applyMask()  {}
    invertMask() {}
}

function _adjLabel(type) {
    const labels = {
        'brightness-contrast': 'Brightness/Contrast',
        'hue-saturation':      'Hue/Saturation',
        'levels':              'Levels',
        'curves':              'Curves',
        'color-balance':       'Color Balance',
        'vibrance':            'Vibrance',
        'gradient-map':        'Gradient Map',
        'threshold':           'Threshold',
        'invert':              'Invert',
        'posterize':           'Posterize',
    };
    return labels[type] || type;
}


// ═══════════════════════════════════════════════════════════════
// Dispatcher: apply adjustment by type name
// ═══════════════════════════════════════════════════════════════

export function applyAdjustment(type, params, imageData, width, height) {
    switch (type) {
        // ── Adjustment layer types ──────────────────────────────
        case 'brightness-contrast':
            brightnessContrastFilter(imageData, params.brightness ?? 0, params.contrast ?? 0);
            break;
        case 'hue-saturation':
            hueSaturationFilter(imageData, params.hue ?? 0, params.saturation ?? 0, params.lightness ?? 0);
            break;
        case 'levels':
            levelsFilter(imageData, params.inBlack ?? 0, params.inWhite ?? 255, params.gamma ?? 1, params.outBlack ?? 0, params.outWhite ?? 255);
            break;
        case 'curves':
            curvesFilter(imageData, params);
            break;
        case 'color-balance':
            colorBalanceFilter(imageData, params.shadows ?? {}, params.midtones ?? {}, params.highlights ?? {});
            break;
        case 'vibrance':
            vibranceFilter(imageData, params.amount ?? 0);
            break;
        case 'gradient-map':
            gradientMapFilter(imageData, params.colorLow ?? '#000000', params.colorHigh ?? '#ffffff');
            break;
        case 'threshold':
            thresholdFilter(imageData, params.threshold ?? 128);
            break;
        case 'invert':
            invertFilter(imageData);
            break;
        case 'posterize':
            posterizeFilter(imageData, params.levels ?? 4);
            break;

        // ── Destructive filter types ─────────────────────────────
        case 'gaussian-blur':
            gaussianBlurFilter(imageData, width, height, params.radius ?? 3);
            break;
        case 'sharpen':
            sharpenFilter(imageData, width, height, params.amount ?? 1);
            break;
        case 'unsharp-mask':
            unsharpMaskFilter(imageData, width, height, params.amount ?? 0.5);
            break;
        case 'grayscale':
            grayscaleFilter(imageData);
            break;
        case 'sepia':
            sepiaFilter(imageData);
            break;
        case 'noise':
            noiseFilter(imageData, params.amount ?? 25, params.monochrome !== false);
            break;
        case 'outline':
            outlineFilter(imageData, width, height, params.color ?? '#000000', params.thickness ?? 1);
            break;

        default:
            console.warn('[filters] Unknown adjustment type:', type);
    }
}


// ─── Private helpers ──────────────────────────────────────────

function _hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
