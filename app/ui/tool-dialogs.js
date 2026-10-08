// Glue between the live-preview dialogs and the document: filters, adjustments (destructive and as layers) and layer effects.
import { liveDialog } from './live-dialog.js';
import { runAdjustmentDialog } from './adjust-dialogs.js';
import { PreviewSession, applyAdjustmentNow } from '../core/ops/preview.js';
import { addAdjustmentLayer, setAdjustment } from '../core/ops/layers.js';
import { FILTER_BY_ID, defaultParams, isIdentityFilter } from '../core/filters/filters.js';
import { createAdjustment, adjustmentName, histogramOf, autoLevels, isIdentity } from '../core/filters/adjust.js';
import { renderer } from '../core/render.js';
import { getData, isClear } from '../core/pixels.js';
import { EFFECT_KINDS, DEFAULTS, effectName, effectKey, withEffect, withoutEffect, hasEffect, clampEffect, effectEnabled } from '../core/effects.js';
import { state } from '../core/state.js';
import { lastFilter } from './last-filter.js';
import { runCameraRawDialog } from './camera-raw-dialog.js';

// ---- filters ----------------------------------------------------------------------------------------------
function paramFields(f, holder) {
  return f.params.map((q) => {
    const base = { ...q, def: q.value, get: () => holder.p[q.key], set: (v) => { holder.p[q.key] = v; } };
    if (q.type === 'select') return { ...base, string: typeof q.value === 'string' };
    return base;
  });
}
export async function runFilterDialog(app, id, { repeat = false } = {}) {
  if (id === 'cameraRaw' && !repeat) return runCameraRawDialog(app);
  const doc = app.doc, f = FILTER_BY_ID[id];
  const layer = doc.editableLayer;
  const fills = id === 'vignette' && !doc.isEditingMask && layer?.canvas && isClear(layer.canvas);
  const s = PreviewSession.begin(doc, f.name, { coverCanvas: fills });
  if (!s) { app.problem('Select a pixel layer or a mask to filter.'); return false; }
  s.fillsClear = fills;
  const holder = { p: { ...defaultParams(f), ...(repeat && lastFilter.id === id ? lastFilter.params : {}) } };
  let on = true;
  const preview = s.liveUpdater('filter');
  const run = () => { if (on) preview(id, { ...holder.p }); };
  if (repeat) { await s.filter(id, holder.p); if (isIdentityFilter(f, holder.p)) s.cancel(); else { await s.commit(); } return true; }
  run();
  const ok = await liveDialog({
    title: f.name, fields: () => paramFields(f, holder), onInput: run,
    onPreviewToggle: (v) => { on = v; if (v) run(); else s.showOriginal(); },
    resetFn: () => { holder.p = defaultParams(f); },
  });
  if (!ok) { s.cancel(); return false; }
  if (isIdentityFilter(f, holder.p)) { s.cancel(); return true; }
  preview.cancel();
  await s.filter(id, holder.p);
  await s.commit();
  lastFilter.id = id; lastFilter.params = { ...holder.p };
  return true;
}

// ---- adjustments --------------------------------------------------------------------------------------------
// Image > Adjustments: changes the active layer's pixels (or mask) for good.
export async function adjustPixels(app, type) {
  const doc = app.doc;
  if (type === 'invert') { if (!(await applyAdjustmentNow(doc, createAdjustment('invert')))) app.problem('Select a pixel layer or a mask to adjust.'); return; }
  const s = PreviewSession.begin(doc, adjustmentName(createAdjustment(type)));
  if (!s) { app.problem('Select a pixel layer or a mask to adjust.'); return; }
  const hist = histogramOf(s.image.data);
  const preview = s.liveUpdater('adjust');
  const adj = await runAdjustmentDialog(createAdjustment(type), { hist, preview: (a) => (a ? preview(a) : s.showOriginal()) });
  if (!adj || isIdentity(adj)) { s.cancel(); return; }
  preview.cancel();
  await s.adjust(adj);
  await s.commit();
}
export async function autoLevelsNow(app) {
  const doc = app.doc, s = PreviewSession.begin(doc, 'Auto Levels');
  if (!s) { app.problem('Select a pixel layer or a mask to adjust.'); return; }
  const a = autoLevels(histogramOf(s.image.data));
  if (isIdentity(a)) { s.cancel(); return; }
  await s.adjust(a); await s.commit();
}
// Layer > New Adjustment Layer: a live layer whose settings stay editable.
export async function newAdjustmentLayer(app, type) {
  const doc = app.doc;
  const layer = addAdjustmentLayer(doc, createAdjustment(type), false);
  const hist = histogramOf(getData(renderer.render(doc)).data);
  const adj = await runAdjustmentDialog(layer.adjustment, { hist, preview: (a) => setAdjustment(doc, layer, a || createAdjustment('invert') && { type: 'brightnessContrast', brightness: 0, contrast: 0 }) });
  if (!adj) { doc.cancel(); doc.layersChanged(); return; }
  setAdjustment(doc, layer, adj);
  doc.commit(); doc.layersChanged();
}
export async function editAdjustmentLayer(app, layer) {
  const doc = app.doc, original = layer.adjustment;
  doc.begin('Edit Adjustment');
  const hist = histogramOf(getData(renderer.render(doc)).data);
  const adj = await runAdjustmentDialog(original, { hist, title: layer.name, preview: (a) => setAdjustment(doc, layer, a || { type: 'brightnessContrast', brightness: 0, contrast: 0 }) });
  if (!adj) { doc.cancel(); doc.layersChanged(); return; }
  setAdjustment(doc, layer, adj);
  doc.commit(); doc.layersChanged();
}

// ---- layer effects ----------------------------------------------------------------------------------------------
const R = (label, get, set, min, max, step = 1, def = 0, unit = '') => ({ type: 'range', label, get, set, min, max, step, def, unit });
function effectFields(kind, holder) {
  const g = (k) => () => holder.v[k], set = (k) => (v) => { holder.v[k] = v; };
  const col = (label) => ({ type: 'color', label, get: g('color'), set: set('color') });
  switch (kind) {
    case 'stroke': return [R('Size', g('size'), set('size'), 0, 500, 1, 4, ' px'), col('Color'), R('Opacity', () => Math.round(holder.v.opacity * 100), (v) => { holder.v.opacity = v / 100; }, 0, 100, 1, 100, '%'), { type: 'check', label: 'Inside', get: g('inside'), set: set('inside') }];
    case 'dropShadow': case 'innerShadow': return [col('Color'), R('Opacity', () => Math.round(holder.v.opacity * 100), (v) => { holder.v.opacity = v / 100; }, 0, 100, 1, 50, '%'), R('Angle', g('angle'), set('angle'), -180, 180, 1, 90, '°'), R('Distance', g('distance'), set('distance'), 0, 500, 1, 20, ' px'), R('Blur', g('blur'), set('blur'), 0, 500, 1, 20, ' px')];
    case 'colorOverlay': return [col('Color'), R('Opacity', () => Math.round(holder.v.opacity * 100), (v) => { holder.v.opacity = v / 100; }, 0, 100, 1, 100, '%')];
    default: return [R('Size', g('size'), set('size'), 0, 500, 1, kind === 'outerGlow' ? 20 : 10, ' px'), col('Color'), R('Opacity', () => Math.round(holder.v.opacity * 100), (v) => { holder.v.opacity = v / 100; }, 0, 100, 1, 75, '%')];
  }
}
export async function editEffectDialog(app, layer, kind) {
  const doc = app.doc, key = effectKey(kind), existing = layer.effects?.[key];
  doc.begin(existing ? 'Edit ' + effectName(kind) : 'Add ' + effectName(kind));
  const holder = { v: { ...(existing || DEFAULTS[kind]), enabled: true } };
  const apply = () => { layer.effects = withEffect(layer.effects, kind, clampEffect(kind, holder.v)); doc.invalidate(doc.affectedArea(layer)); };
  apply();
  const before = layer.effects;
  let on = true;
  const ok = await liveDialog({
    title: effectName(kind), fields: () => effectFields(kind, holder), onInput: () => { if (on) apply(); },
    onPreviewToggle: (v) => { on = v; if (v) apply(); else { layer.effects = existing ? withEffect(layer.effects, kind, existing) : withoutEffect(layer.effects, kind); doc.invalidate(doc.affectedArea(layer)); } },
    resetFn: () => { holder.v = { ...DEFAULTS[kind] }; },
  });
  if (!ok) { doc.cancel(); doc.layersChanged(); return; }
  apply(); doc.commit(); doc.layersChanged();
}
