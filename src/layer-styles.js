/* ═══════════════════════════════════════════════════════════════
   Pixoto — Layer Styles / Effects (P6)
   Non-destructive per-layer FX (Photoshop "fx"): drop shadow,
   outer/inner glow, inner shadow, stroke, color/gradient overlay,
   basic bevel & emboss.

   PixiEditor has no direct equivalent (node-graph filters), so this
   is designed from scratch using only browser-native Canvas 2D
   (including native `ctx.filter = 'blur()'`). No external dependency.
   ═══════════════════════════════════════════════════════════════ */

// ─── Canvas helpers ───────────────────────────────────────────────

function makeCanvas(w, h) {
    let c;
    try { c = new OffscreenCanvas(w, h); }
    catch { c = document.createElement('canvas'); c.width = w; c.height = h; }
    return c;
}

function ctxOf(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    return ctx;
}

/** Solid-colored silhouette of `src` (src alpha filled with `color`). */
function silhouette(src, color, w, h) {
    const c = makeCanvas(w, h);
    const x = ctxOf(c);
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, w, h);
    return c;
}

/** Gaussian-blur copy of `src` via native canvas filter. */
function blurred(src, radius, w, h) {
    if (!radius || radius <= 0) return src;
    const c = makeCanvas(w, h);
    const x = ctxOf(c);
    x.filter = `blur(${radius}px)`;
    x.drawImage(src, 0, 0);
    x.filter = 'none';
    return c;
}

/** Translated copy of `src`. */
function offsetCanvas(src, dx, dy, w, h) {
    const c = makeCanvas(w, h);
    ctxOf(c).drawImage(src, dx, dy);
    return c;
}

/** Morphological dilation of alpha by `r` px (union of radial offset stamps). */
function dilate(src, r, w, h) {
    if (!r || r <= 0) return src;
    const c = makeCanvas(w, h);
    const x = ctxOf(c);
    const steps = 16;
    for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        x.drawImage(src, Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r));
    }
    x.drawImage(src, 0, 0);
    return c;
}

/** Opaque where `src` is transparent (alpha inverse), filled black. */
function invertAlpha(src, w, h) {
    const c = makeCanvas(w, h);
    const x = ctxOf(c);
    x.fillStyle = '#000';
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(src, 0, 0);
    return c;
}

/** Morphological erosion of alpha by `r` px. */
function erode(src, r, w, h) {
    if (!r || r <= 0) return src;
    return invertAlpha(dilate(invertAlpha(src, w, h), r, w, h), w, h);
}

/** Copy of `a` with `b`'s alpha removed (a − b). */
function subtract(a, b, w, h) {
    const c = makeCanvas(w, h);
    const x = ctxOf(c);
    x.drawImage(a, 0, 0);
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(b, 0, 0);
    return c;
}

/** Copy of `src` clipped to `mask`'s alpha (src ∩ mask). */
function clipTo(src, mask, w, h) {
    const c = makeCanvas(w, h);
    const x = ctxOf(c);
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(mask, 0, 0);
    return c;
}

function angleOffset(angleDeg, dist) {
    const rad = angleDeg * Math.PI / 180;
    return { dx: Math.round(Math.cos(rad) * dist), dy: Math.round(Math.sin(rad) * dist) };
}

function clampOpacity(v) { return Math.max(0, Math.min(1, v == null ? 1 : v)); }


// ─── Effect defaults ──────────────────────────────────────────────

export function defaultEffects() {
    return {
        dropShadow:      { enabled: false, color: '#000000', opacity: 0.5, distance: 6, angle: 135, blur: 6 },
        outerGlow:       { enabled: false, color: '#ffd24d', opacity: 0.6, blur: 12, spread: 2 },
        innerShadow:     { enabled: false, color: '#000000', opacity: 0.5, distance: 5, angle: 135, blur: 5 },
        innerGlow:       { enabled: false, color: '#ffffff', opacity: 0.5, blur: 8 },
        stroke:          { enabled: false, color: '#000000', opacity: 1, size: 3, position: 'out' },
        colorOverlay:    { enabled: false, color: '#ff3860', opacity: 1, blend: 'source-over' },
        gradientOverlay: { enabled: false, color1: '#000000', color2: '#ffffff', angle: 90, opacity: 1, blend: 'source-over' },
        bevel:           { enabled: false, size: 5, angle: 135, depth: 0.6, highlight: '#ffffff', shadow: '#000000' },
    };
}

/** Stable display order + labels for the dialog UI. */
export const EFFECT_ORDER = [
    'dropShadow', 'outerGlow', 'stroke', 'colorOverlay',
    'gradientOverlay', 'innerShadow', 'innerGlow', 'bevel',
];

export const EFFECT_LABELS = {
    dropShadow: 'Drop Shadow',
    outerGlow: 'Outer Glow',
    stroke: 'Stroke',
    colorOverlay: 'Color Overlay',
    gradientOverlay: 'Gradient Overlay',
    innerShadow: 'Inner Shadow',
    innerGlow: 'Inner Glow',
    bevel: 'Bevel & Emboss',
};

export function hasEnabledEffect(fx) {
    if (!fx) return false;
    for (const k in fx) { if (fx[k] && fx[k].enabled) return true; }
    return false;
}

export function cloneEffects(fx) {
    if (!fx) return null;
    try { return structuredClone(fx); }
    catch { return JSON.parse(JSON.stringify(fx)); }
}


// ─── Master renderer ──────────────────────────────────────────────

/**
 * Render a layer's content plus all enabled effects to a new canvas.
 * The caller (canvas engine) then blends the result with the layer's
 * opacity / blend mode / mask.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} content - the layer's pixel canvas
 * @param {object} fx - effects object (see defaultEffects)
 * @param {number} w
 * @param {number} h
 * @returns {HTMLCanvasElement|OffscreenCanvas}
 */
export function renderLayerEffects(content, fx, w, h) {
    const out = makeCanvas(w, h);
    const t = ctxOf(out);

    const draw = (canvas, alpha, blend) => {
        t.globalAlpha = clampOpacity(alpha);
        t.globalCompositeOperation = blend || 'source-over';
        t.drawImage(canvas, 0, 0);
        t.globalAlpha = 1;
        t.globalCompositeOperation = 'source-over';
    };

    // ── BELOW the content ──────────────────────────────────────────

    // Drop Shadow
    try {
        const e = fx.dropShadow;
        if (e && e.enabled) {
            const { dx, dy } = angleOffset(e.angle, e.distance);
            let s = silhouette(content, e.color, w, h);
            s = offsetCanvas(s, dx, dy, w, h);
            s = blurred(s, e.blur, w, h);
            draw(s, e.opacity, 'source-over');
        }
    } catch (err) { console.warn('[LayerStyles] dropShadow:', err); }

    // Outer Glow
    try {
        const e = fx.outerGlow;
        if (e && e.enabled) {
            let s = dilate(content, e.spread, w, h);
            s = silhouette(s, e.color, w, h);
            s = blurred(s, e.blur, w, h);
            draw(s, e.opacity, 'source-over');
        }
    } catch (err) { console.warn('[LayerStyles] outerGlow:', err); }

    // ── The content itself ─────────────────────────────────────────
    draw(content, 1, 'source-over');

    // ── ON TOP, clipped to content alpha ───────────────────────────

    // Color Overlay
    try {
        const e = fx.colorOverlay;
        if (e && e.enabled) {
            const o = makeCanvas(w, h); const x = ctxOf(o);
            x.fillStyle = e.color; x.fillRect(0, 0, w, h);
            draw(clipTo(o, content, w, h), e.opacity, e.blend);
        }
    } catch (err) { console.warn('[LayerStyles] colorOverlay:', err); }

    // Gradient Overlay
    try {
        const e = fx.gradientOverlay;
        if (e && e.enabled) {
            const o = makeCanvas(w, h); const x = ctxOf(o);
            const rad = e.angle * Math.PI / 180;
            const cx = w / 2, cy = h / 2;
            const ext = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
            const gx = Math.cos(rad) * ext, gy = Math.sin(rad) * ext;
            const grad = x.createLinearGradient(cx - gx, cy - gy, cx + gx, cy + gy);
            grad.addColorStop(0, e.color1);
            grad.addColorStop(1, e.color2);
            x.fillStyle = grad; x.fillRect(0, 0, w, h);
            draw(clipTo(o, content, w, h), e.opacity, e.blend);
        }
    } catch (err) { console.warn('[LayerStyles] gradientOverlay:', err); }

    // Inner Shadow
    try {
        const e = fx.innerShadow;
        if (e && e.enabled) {
            const { dx, dy } = angleOffset(e.angle, e.distance);
            let s = invertAlpha(content, w, h);   // opaque outside the shape
            s = offsetCanvas(s, dx, dy, w, h);
            s = blurred(s, e.blur, w, h);
            s = silhouette(s, e.color, w, h);
            draw(clipTo(s, content, w, h), e.opacity, 'source-over');
        }
    } catch (err) { console.warn('[LayerStyles] innerShadow:', err); }

    // Inner Glow
    try {
        const e = fx.innerGlow;
        if (e && e.enabled) {
            let g = invertAlpha(content, w, h);
            g = blurred(g, e.blur, w, h);
            g = silhouette(g, e.color, w, h);
            draw(clipTo(g, content, w, h), e.opacity, 'source-over');
        }
    } catch (err) { console.warn('[LayerStyles] innerGlow:', err); }

    // Bevel & Emboss (basic)
    try {
        const e = fx.bevel;
        if (e && e.enabled) {
            const { dx, dy } = angleOffset(e.angle, Math.max(1, e.size));
            // Highlight toward the light
            let hl = silhouette(content, e.highlight, w, h);
            hl = offsetCanvas(hl, dx, dy, w, h);
            hl = blurred(hl, e.size, w, h);
            draw(clipTo(hl, content, w, h), e.depth, 'screen');
            // Shadow away from the light
            let sh = silhouette(content, e.shadow, w, h);
            sh = offsetCanvas(sh, -dx, -dy, w, h);
            sh = blurred(sh, e.size, w, h);
            draw(clipTo(sh, content, w, h), e.depth, 'multiply');
        }
    } catch (err) { console.warn('[LayerStyles] bevel:', err); }

    // Stroke (drawn last, on top)
    try {
        const e = fx.stroke;
        if (e && e.enabled && e.size > 0) {
            let ring;
            if (e.position === 'in') {
                ring = subtract(content, erode(content, e.size, w, h), w, h);
            } else if (e.position === 'center') {
                const half = Math.max(1, e.size / 2);
                ring = subtract(dilate(content, half, w, h), erode(content, half, w, h), w, h);
            } else { // 'out'
                ring = subtract(dilate(content, e.size, w, h), content, w, h);
            }
            draw(silhouette(ring, e.color, w, h), e.opacity, 'source-over');
        }
    } catch (err) { console.warn('[LayerStyles] stroke:', err); }

    return out;
}
