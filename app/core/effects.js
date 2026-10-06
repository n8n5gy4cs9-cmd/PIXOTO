// Layer effects (Composa.Model.LayerEffects + LayerEffectsRenderer). Effects are plain immutable objects kept on the
// layer: { stroke, shadow, colorOverlay, innerShadow, outerGlow, innerGlow }, each null (absent) or settings with
// `enabled`. The renderer draws the layer with its effects on a canvas grown by `inset` pixels on every side.
import { makeCanvas, ctxOf, hexToRgb } from './pixels.js';
import { gaussianBlur, morph } from './filters/blur.js';
import { setEffectMarginFn } from './model.js';
import { clamp } from './geom.js';

export const EFFECT_KINDS = ['stroke', 'dropShadow', 'colorOverlay', 'innerShadow', 'outerGlow', 'innerGlow'];
const KEY = { stroke: 'stroke', dropShadow: 'shadow', colorOverlay: 'colorOverlay', innerShadow: 'innerShadow', outerGlow: 'outerGlow', innerGlow: 'innerGlow' };
export const effectKey = (kind) => KEY[kind];
export const effectName = (kind) => ({ stroke: 'Stroke', dropShadow: 'Drop Shadow', colorOverlay: 'Color Overlay', innerShadow: 'Inner Shadow', outerGlow: 'Outer Glow', innerGlow: 'Inner Glow' })[kind];

export const DEFAULTS = {
  stroke: { enabled: true, size: 4, color: '#000000', opacity: 1, inside: false },
  dropShadow: { enabled: true, angle: 90, distance: 20, blur: 20, color: '#000000', opacity: 0.5 },
  colorOverlay: { enabled: true, color: '#000000', opacity: 1 },
  innerShadow: { enabled: true, angle: 90, distance: 20, blur: 20, color: '#000000', opacity: 0.5 },
  outerGlow: { enabled: true, size: 20, color: '#ffffff', opacity: 0.75 },
  innerGlow: { enabled: true, size: 10, color: '#ffffff', opacity: 0.75 },
};

const num = (v, lo, hi, d) => (Number.isFinite(v) ? clamp(v, lo, hi) : d);
export function clampEffect(kind, e) {
  const o = { ...e };
  o.opacity = num(e.opacity, 0, 1, DEFAULTS[kind].opacity);
  if ('size' in e) o.size = num(e.size, 0, 500, DEFAULTS[kind].size);
  if (kind === 'dropShadow' || kind === 'innerShadow') { o.angle = num(e.angle, -360, 360, 90); o.distance = num(e.distance, 0, 5000, 20); o.blur = num(e.blur, 0, 500, 20); }
  return o;
}
export const shadowOffset = (s) => { const r = s.angle * Math.PI / 180; return { x: -Math.cos(r) * s.distance, y: Math.sin(r) * s.distance }; };

export const isEmptyEffects = (e) => !e || EFFECT_KINDS.every((k) => !e[KEY[k]]);
export const hasEffect = (e, kind) => !!e?.[KEY[kind]];
export const effectEnabled = (e, kind) => !!e?.[KEY[kind]]?.enabled;
export const withEffect = (e, kind, settings) => ({ ...(e || {}), [KEY[kind]]: settings });
export const withoutEffect = (e, kind) => { const o = { ...e, [KEY[kind]]: null }; return isEmptyEffects(o) ? null : o; };
export const effectKinds = (e) => EFFECT_KINDS.filter((k) => e?.[KEY[k]]);

// Only the effects switched on, clamped; null when none.
export function visibleEffects(e) {
  if (!e) return null;
  const out = {};
  let any = false;
  for (const k of EFFECT_KINDS) { const s = e[KEY[k]]; if (s?.enabled) { out[KEY[k]] = clampEffect(k, s); any = true; } }
  return any ? out : null;
}
export function margin(e) {
  const v = visibleEffects(e);
  if (!v) return 0;
  let m = 0;
  if (v.stroke && !v.stroke.inside && v.stroke.opacity > 0) m = Math.max(m, v.stroke.size);
  if (v.shadow && v.shadow.opacity > 0) m = Math.max(m, v.shadow.distance + v.shadow.blur * 3);
  if (v.outerGlow && v.outerGlow.opacity > 0) m = Math.max(m, v.outerGlow.size * 1.5);
  return Math.ceil(m) + 2;
}
setEffectMarginFn(margin);

// ---- rendering --------------------------------------------------------------------------
const MAX_PIXELS = 100_000_000;
const cache = [];        // { canvas, rev, mask, maskVersion, effects, result, inset }
const MAX_ENTRIES = 12;

export function renderedEffects(canvas, mask, effects) {
  const visible = visibleEffects(effects);
  if (!visible) return null;
  const live = canvas.live;
  const i = cache.findIndex((e) => e.canvas === canvas && e.mask === mask && e.effects === effects && (live || (e.rev === (canvas.rev || 0) && e.maskVersion === (mask?.version ?? 0))));
  if (i >= 0) { const hit = cache[i]; cache.splice(i, 1); cache.push(hit); return hit; }
  const made = render(canvas, mask, visible);
  if (!made) return null;
  const entry = { canvas, rev: canvas.rev || 0, mask, maskVersion: mask?.version ?? 0, effects, ...made };
  for (let k = cache.length - 1; k >= 0; k--) if (cache[k].canvas === canvas && cache[k].mask === mask) cache.splice(k, 1);
  cache.push(entry);
  while (cache.length > MAX_ENTRIES) cache.shift();
  return entry;
}
export const clearEffectsCache = () => { cache.length = 0; };

// Fills a plane of coverage with a colour at an opacity and draws it on `ctx` (at 0,0).
function tint(ctx, plane, w, h, color, opacity) {
  const [r, g, b] = hexToRgb(color), img = new ImageData(w, h), d = img.data, k = clamp(opacity, 0, 1);
  for (let i = 0, j = 0; i < plane.length; i++, j += 4) { d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = plane[i] * k; }
  const c = makeCanvas(w, h); ctxOf(c).putImageData(img, 0, 0);
  ctx.drawImage(c, 0, 0);
}
function shifted(plane, w, h, dx, dy, sigma) {
  const out = new Uint8ClampedArray(plane.length);
  dx = Math.round(dx); dy = Math.round(dy);
  for (let y = 0; y < h; y++) {
    const sy = y - dy; if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) { const sx = x - dx; if (sx >= 0 && sx < w) out[y * w + x] = plane[sy * w + sx]; }
  }
  if (sigma > 0.01) gaussianBlur(out, w, h, sigma, sigma, 1, 'zero');
  return out;
}
const minus = (a, b) => { const o = new Uint8ClampedArray(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * (255 - b[i]) / 255; return o; };
function ring(coverage, w, h, stroke) {
  const reach = Math.max(1, Math.round(stroke.size));
  if (stroke.inside) return minus(coverage, morph(coverage, w, h, reach, false));
  return minus(morph(coverage, w, h, reach, true), coverage);
}

function render(canvas, mask, v) {
  const inset = margin(v) || 2, w = canvas.width + inset * 2, h = canvas.height + inset * 2;
  if (w * h > MAX_PIXELS) return null;
  const result = makeCanvas(w, h), out = ctxOf(result);
  const shown = makeCanvas(w, h), sctx = ctxOf(shown);
  sctx.drawImage(canvas, inset, inset);
  if (mask) { sctx.globalCompositeOperation = 'destination-in'; sctx.drawImage(mask.canvas(), inset, inset); sctx.globalCompositeOperation = 'source-over'; }
  const px = sctx.getImageData(0, 0, w, h).data, coverage = new Uint8ClampedArray(w * h);
  for (let i = 0; i < coverage.length; i++) coverage[i] = px[i * 4 + 3];

  if (v.shadow?.opacity > 0) { const o = shadowOffset(v.shadow); tint(out, shifted(coverage, w, h, o.x, o.y, v.shadow.blur / 2), w, h, v.shadow.color, v.shadow.opacity); }
  if (v.outerGlow?.opacity > 0 && v.outerGlow.size > 0) {
    const soft = shifted(coverage, w, h, 0, 0, v.outerGlow.size / 2);
    tint(out, minus(soft, coverage), w, h, v.outerGlow.color, v.outerGlow.opacity);
  }
  const stroke = v.stroke && v.stroke.size > 0 && v.stroke.opacity > 0 ? v.stroke : null;
  if (stroke && !stroke.inside) tint(out, ring(coverage, w, h, stroke), w, h, stroke.color, stroke.opacity);
  out.drawImage(shown, 0, 0);
  if (v.colorOverlay?.opacity > 0) tint(out, coverage, w, h, v.colorOverlay.color, v.colorOverlay.opacity);
  if (v.innerGlow?.opacity > 0 && v.innerGlow.size > 0) tint(out, minus(coverage, shifted(coverage, w, h, 0, 0, v.innerGlow.size / 2)), w, h, v.innerGlow.color, v.innerGlow.opacity);
  if (v.innerShadow?.opacity > 0) { const o = shadowOffset(v.innerShadow); tint(out, minus(coverage, shifted(coverage, w, h, o.x, o.y, v.innerShadow.blur / 2)), w, h, v.innerShadow.color, v.innerShadow.opacity); }
  if (stroke?.inside) tint(out, ring(coverage, w, h, stroke), w, h, stroke.color, stroke.opacity);
  return { result, inset };
}
