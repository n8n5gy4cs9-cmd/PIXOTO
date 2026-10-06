/* ═══════════════════════════════════════════════════════════════
   Pixoto — Color Utilities
   Single source of truth for color conversion. Fixes DUP-001.
   ═══════════════════════════════════════════════════════════════ */

/**
 * Parse a CSS hex color → { r, g, b, a } (0–255 each).
 * Handles #RGB, #RRGGBB, #RRGGBBAA.
 * Returns null if the input is invalid.
 * @param {string} color
 * @returns {{ r: number, g: number, b: number, a: number } | null}
 */
export function hexToRgb(color) {
    if (!color || color[0] !== '#') return null;

    let hex = color.slice(1);
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length === 6) hex += 'ff';
    if (hex.length !== 8) return null;

    return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16),
    };
}

/**
 * RGB(A) components → CSS hex string.
 * @param {number} r - 0–255
 * @param {number} g - 0–255
 * @param {number} b - 0–255
 * @param {number} [a=255] - 0–255
 * @returns {string} e.g. '#ff6b35' or '#ff6b3580'
 */
export function rgbToHex(r, g, b, a = 255) {
    const hex = (v) => (v & 0xff).toString(16).padStart(2, '0');
    return a === 255
        ? `#${hex(r)}${hex(g)}${hex(b)}`
        : `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`;
}

/**
 * RGB (0–255) → HSL (h: 0–360, s: 0–100, l: 0–100).
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {{ h: number, s: number, l: number }}
 */
export function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100),
    };
}

/**
 * HSL (h: 0–360, s: 0–100, l: 0–100) → RGB (0–255 each).
 * @param {number} h
 * @param {number} s
 * @param {number} l
 * @returns {{ r: number, g: number, b: number }}
 */
export function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;

    if (s === 0) {
        const v = Math.round(l * 255);
        return { r: v, g: v, b: v };
    }

    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    return {
        r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        g: Math.round(hue2rgb(p, q, h) * 255),
        b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    };
}

/**
 * HSL → CSS hex string (convenience wrapper).
 * @param {number} h - 0–360
 * @param {number} s - 0–100
 * @param {number} l - 0–100
 * @returns {string}
 */
export function hslToHex(h, s, l) {
    const { r, g, b } = hslToRgb(h, s, l);
    return rgbToHex(r, g, b);
}

/**
 * RGB (0–255) → HSB/HSV (h: 0–360, s: 0–100, b: 0–100).
 * PixiEditor uses HSB ("Brightness") for the color picker.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {{ h: number, s: number, b: number }}
 */
export function rgbToHsb(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    if (delta > 0) {
        if (max === r)      h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / delta + 2) / 6;
        else                h = ((r - g) / delta + 4) / 6;
    }

    const s = max === 0 ? 0 : delta / max;
    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        b: Math.round(max * 100),
    };
}

/**
 * HSB/HSV (h: 0–360, s: 0–100, b: 0–100) → RGB (0–255 each).
 * @param {number} h
 * @param {number} s
 * @param {number} b  (brightness / value)
 * @returns {{ r: number, g: number, b: number }}
 */
export function hsbToRgb(h, s, bv) {
    h /= 360; s /= 100; bv /= 100;

    if (s === 0) {
        const v = Math.round(bv * 255);
        return { r: v, g: v, b: v };
    }

    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = bv * (1 - s);
    const q = bv * (1 - f * s);
    const t = bv * (1 - (1 - f) * s);

    let r, g, b;
    switch (i % 6) {
        case 0: r = bv; g = t;  b = p;  break;
        case 1: r = q;  g = bv; b = p;  break;
        case 2: r = p;  g = bv; b = t;  break;
        case 3: r = p;  g = q;  b = bv; break;
        case 4: r = t;  g = p;  b = bv; break;
        case 5: r = bv; g = p;  b = q;  break;
        default: r = g = b = 0;
    }
    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255),
    };
}

/**
 * CSS hex → HSB (convenience wrapper).
 * @param {string} hex
 * @returns {{ h: number, s: number, b: number } | null}
 */
export function hexToHsb(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    return rgbToHsb(rgb.r, rgb.g, rgb.b);
}

/**
 * CMYK display values (0–100 each) computed from RGB — display only, no print conversion.
 * @param {number} r 0–255
 * @param {number} g 0–255
 * @param {number} b 0–255
 * @returns {{ c: number, m: number, y: number, k: number }}
 */
export function rgbToCmyk(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const k = 1 - Math.max(r, g, b);
    if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
    return {
        c: Math.round(((1 - r - k) / (1 - k)) * 100),
        m: Math.round(((1 - g - k) / (1 - k)) * 100),
        y: Math.round(((1 - b - k) / (1 - k)) * 100),
        k: Math.round(k * 100),
    };
}
