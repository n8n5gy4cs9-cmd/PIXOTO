// Layer commands (port of Composa EditorSession.Layers): every function is one undoable step on a Doc.
import { Layer, identityTransform } from '../model.js';
import { makeCanvas, ctxOf, getData, putData, cloneCanvas } from '../pixels.js';
import { Mask, remapMask } from '../mask.js';
import { renderer } from '../render.js';
import { adjustmentName } from '../filters/adjust.js';
import { LIMITS } from '../limits.js';
import * as G from '../geom.js';

const full = (doc) => ({ x: 0, y: 0, w: doc.width, h: doc.height });
const done = (doc) => { doc.invalidate(null); doc.layersChanged(); };

export function selectLayer(doc, id, { extend = false, range = false } = {}) {
  if (!doc.find(id)) return;
  if (range && doc.activeId != null) {
    const order = [...doc.allLayers()].map((l) => l.id);
    let a = order.indexOf(doc.activeId), b = order.indexOf(id);
    if (a > b) [a, b] = [b, a];
    for (let i = a; i <= b; i++) doc.selectedIds.add(order[i]);
    doc.activeId = id;
  } else if (extend) {
    if (doc.selectedIds.has(id) && doc.selectedIds.size > 1) { doc.selectedIds.delete(id); if (doc.activeId === id) doc.activeId = [...doc.selectedIds][0]; }
    else { doc.selectedIds.add(id); doc.activeId = id; }
  } else doc.setActive(id, false);
  if (!doc.active?.mask) doc.editingMask = false;
  doc.layersChanged();
}

export function addBlankLayer(doc) {
  const layer = Layer.raster(doc.uniqueName('Layer'), makeCanvas(doc.width, doc.height));
  doc.apply('New Layer', () => doc.insertAboveActive(layer));
  done(doc);
  return layer;
}
// Adds decoded pixels as a new layer, centred (or at `center`) and scaled down to fit the canvas.
export function addImageLayer(doc, name, canvas, { center, fit = true, scale = 1, undoName = 'Add Image' } = {}) {
  const layer = Layer.raster(name, canvas);
  if (fit) scale *= Math.min(1, doc.width / canvas.width, doc.height / canvas.height);
  const w = canvas.width * scale, h = canvas.height * scale, c = center || { x: doc.width / 2, y: doc.height / 2 };
  layer.transform = identityTransform(w, h, Math.round(c.x - w / 2), Math.round(c.y - h / 2));
  doc.apply(undoName, () => doc.insertAboveActive(layer));
  done(doc);
  return layer;
}
// commit = false leaves the edit open so a settings dialog can still cancel the whole layer.
export function addAdjustmentLayer(doc, adjustment, commit = true) {
  const layer = Layer.adjustment(adjustment, doc.uniqueName(adjustmentName(adjustment)));
  doc.begin('New Adjustment Layer');
  doc.insertAboveActive(layer);
  if (doc.selection) layer.mask = doc.selection.clone();
  if (commit) doc.commit();
  done(doc);
  return layer;
}
export function setAdjustment(doc, layer, adjustment) { layer.adjustment = adjustment; doc.invalidate(null); }

export function deleteSelectedLayers(doc) {
  const roots = doc.selectedRoots();
  if (!roots.length) return;
  doc.apply(roots.length > 1 ? 'Delete Layers' : 'Delete Layer', () => {
    let next = null;
    for (const layer of roots) {
      const sib = doc.siblingsOf(layer.id), parent = doc.parentOf(layer.id), i = sib.indexOf(layer);
      sib.splice(i, 1);
      if (!layer.clipped) for (let k = i; k < sib.length && sib[k].clipped; k++) sib[k].clipped = false;
      next = sib.length ? sib[G.clamp(i - 1, 0, sib.length - 1)].id : parent?.id ?? null;
    }
    doc.setActive(next ?? doc.layers.at(-1)?.id ?? null, false);
  });
  doc.editingMask = false;
  done(doc);
}

export function duplicateSelectedLayers(doc, name = 'Duplicate Layer') {
  const roots = doc.selectedRoots();
  if (!roots.length) return;
  doc.apply(roots.length > 1 && name === 'Duplicate Layer' ? 'Duplicate Layers' : name, () => {
    const copies = roots.map((l) => { const c = l.clone(true); c.name = l.name + ' copy'; return [l, c]; });
    if (copies.length === 1) { const sib = doc.siblingsOf(roots[0].id); sib.splice(sib.indexOf(roots[0]) + 1, 0, copies[0][1]); }
    else { const top = roots.at(-1), sib = doc.siblingsOf(top.id); sib.splice(sib.indexOf(top) + 1, 0, ...copies.map((c) => c[1])); }
    const active = (copies.find((c) => c[0].id === doc.activeId) || copies.at(-1))[1];
    doc.setActive(active.id, false);
    for (const [, c] of copies) doc.selectedIds.add(c.id);
  });
  done(doc);
}

export function setVisible(doc, layer, visible) {
  if (layer.visible === visible) return;
  doc.apply(visible ? 'Show Layer' : 'Hide Layer', () => { layer.visible = visible; });
  done(doc);
}
export function setBlend(doc, layer, blend) {
  if (layer.blend === blend) return;
  doc.apply('Blend Mode', () => { layer.blend = blend; });
  done(doc);
}
export function renameLayer(doc, layer, name) {
  name = name.trim();
  if (!name || name === layer.name) return;
  doc.apply('Rename Layer', () => { layer.name = name; });
  doc.layersChanged();
}
export function canClip(doc, layer) { const s = doc.siblingsOf(layer.id); return !!s && (layer.clipped || s.indexOf(layer) > 0); }
export function toggleClippingMask(doc, layer) {
  if (!canClip(doc, layer)) return;
  doc.apply(layer.clipped ? 'Release Clipping Mask' : 'Create Clipping Mask', () => { layer.clipped = !layer.clipped; });
  done(doc);
}

const fixClipBases = (doc) => { for (const list of [doc.layers, ...[...doc.allLayers()].map((l) => l.children)]) if (list.length && list[0].clipped) list[0].clipped = false; };

export function groupSelectedLayers(doc) {
  const roots = doc.selectedRoots();
  if (!roots.length) return;
  doc.apply('Group Layers', () => {
    const top = roots.at(-1), sib = doc.siblingsOf(top.id), group = Layer.group(doc.uniqueName('Folder'));
    sib.splice(sib.indexOf(top) + 1, 0, group);
    for (const l of roots) { const s = doc.siblingsOf(l.id); s.splice(s.indexOf(l), 1); group.children.push(l); }
    if (group.children[0].clipped) {
      for (const c of group.children) { if (!c.clipped) break; c.clipped = false; }
      group.clipped = sib.indexOf(group) > 0;
    }
    fixClipBases(doc);
    doc.setActive(group.id, false);
  });
  done(doc);
}
export function ungroup(doc, group) {
  if (!group.isGroup) return;
  doc.apply('Ungroup Layers', () => {
    const sib = doc.siblingsOf(group.id), i = sib.indexOf(group);
    sib.splice(i, 1, ...group.children);
    doc.setActive(group.children.at(-1)?.id ?? sib.at(-1)?.id ?? null, false);
  });
  done(doc);
}
// Moves layers next to `target`: 'above', 'below', or 'into' when it is a folder; target null = top of the stack.
export function moveLayers(doc, layers, target, drop = 'above') {
  const inside = (l, t) => [...doc.allLayers(l.children)].some((c) => c.id === t.id);
  layers = layers.filter((l) => !target || (l.id !== target.id && !inside(l, target)));
  if (!layers.length) return;
  doc.apply('Reorder Layers', () => {
    for (const l of layers) { const s = doc.siblingsOf(l.id); s.splice(s.indexOf(l), 1); }
    if (!target) doc.layers.push(...layers);
    else if (drop === 'into' && target.isGroup) target.children.push(...layers);
    else { const s = doc.siblingsOf(target.id); s.splice(s.indexOf(target) + (drop === 'above' ? 1 : 0), 0, ...layers); }
    fixClipBases(doc);
  });
  done(doc);
}
export function moveOutOfFolder(doc, layer) { const p = doc.parentOf(layer.id); if (p) moveLayers(doc, [layer], p, 'above'); }
export function moveActiveLayer(doc, dir) {
  const layer = doc.active; if (!layer) return;
  const sib = doc.siblingsOf(layer.id), i = sib.indexOf(layer), t = i + dir;
  if (t < 0 || t >= sib.length) return;
  doc.apply('Reorder Layers', () => { sib.splice(i, 1); sib.splice(t, 0, layer); if (sib[0].clipped) sib[0].clipped = false; });
  done(doc);
}

export function mergeTitle(doc) {
  const r = doc.selectedRoots();
  return r.length > 1 ? 'Merge Layers' : r.length === 1 && r[0].isGroup ? 'Merge Group' : 'Merge Down';
}
export function canMerge(doc) {
  const r = doc.selectedRoots();
  if (r.length > 1) return true;
  if (!r.length) return false;
  if (r[0].isGroup) return r[0].children.length > 0;
  const s = doc.siblingsOf(r[0].id), i = s.indexOf(r[0]);
  return i > 0 && !s[i - 1].isAdjustment && s[i - 1].visible && r[0].visible;
}
export function mergeLayers(doc) {
  if (!canMerge(doc)) return;
  const roots = doc.selectedRoots(), title = mergeTitle(doc);
  if (roots.length === 1 && !roots[0].isGroup) { const s = doc.siblingsOf(roots[0].id); roots.unshift(s[s.indexOf(roots[0]) - 1]); }
  doc.apply(title, () => {
    const bottom = roots[0];
    let area = full(doc);
    for (const r of roots) for (const l of [r, ...doc.allLayers(r.children)]) if (l.canvas) area = G.union(area, G.roundOut(l.visibleBounds));
    if (area.w * area.h > LIMITS.maxPixels || area.w > LIMITS.maxSide * 2 || area.h > LIMITS.maxSide * 2) area = full(doc);
    const single = roots.length === 1;
    const rendered = roots.map((l, i) => {
      const c = l.clone(); c.visible = true;
      if (i === 0 || single) { c.blend = 'normal'; c.opacity = 1; c.clipped = false; }
      if (bottom.clipped) c.clipped = false;
      return c;
    }).filter((c, i) => roots[i].visible);
    const canvas = renderer.renderLayers(rendered, area);
    const merged = Layer.raster(roots.at(-1).isGroup || roots.length > 2 ? roots.at(-1).name : bottom.name, canvas, area.x, area.y);
    merged.blend = bottom.blend; merged.opacity = bottom.opacity; merged.clipped = bottom.clipped;
    const target = doc.siblingsOf(roots.at(-1).id);
    target.splice(target.indexOf(roots.at(-1)) + 1, 0, merged);
    for (const l of roots) { const s = doc.siblingsOf(l.id); s.splice(s.indexOf(l), 1); }
    doc.setActive(merged.id, false);
    trimToContent(merged);
  });
  doc.editingMask = false;
  done(doc);
}
export function flattenImage(doc) {
  doc.apply('Flatten Image', () => {
    const merged = Layer.raster('Background', renderer.flatten(doc));
    doc.layers = [merged];
    doc.setActive(merged.id, false);
  });
  doc.editingMask = false;
  done(doc);
}
// Crops a pure-translation layer's canvas to its non-transparent pixels, so merges don't hoard memory.
export function trimToContent(layer) {
  const c = layer.canvas, t = layer.transform;
  if (!c || t.rotation || t.flipH || t.flipV || t.distort || t.width !== c.width || t.height !== c.height) return;
  const d = getData(c).data, w = c.width, h = c.height;
  let l = w, tp = h, r = -1, b = -1;
  for (let y = 0; y < h; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]) { if (first < 0) first = x; last = x; }
    if (first < 0) continue;
    l = Math.min(l, first); r = Math.max(r, last); tp = Math.min(tp, y); b = y;
  }
  if (r < 0 || (l === 0 && tp === 0 && r === w - 1 && b === h - 1)) return;
  const out = makeCanvas(r - l + 1, b - tp + 1);
  ctxOf(out).drawImage(c, -l, -tp);
  layer.canvas = out; layer.transform = identityTransform(out.width, out.height, t.x + l, t.y + tp);
  if (layer.mask) layer.mask = null;
}

// ---- masks -----------------------------------------------------------------------------------
export function selectionInLayerSpace(doc, layer) {
  if (!doc.selection || !layer.canvas) return null;
  const inv = G.invert(layer.matrix);
  return inv ? remapMask(doc.selection, layer.canvas.width, layer.canvas.height, inv) : new Mask(layer.canvas.width, layer.canvas.height);
}
export function addMask(doc, layer, hideAll = false) {
  if (layer.mask) return;
  doc.apply('Add Layer Mask', () => {
    if (!layer.canvas) layer.mask = doc.selection ? doc.selection.clone() : Mask.filled(doc.width, doc.height, hideAll ? 0 : 255);
    else if (doc.selection) layer.mask = selectionInLayerSpace(doc, layer);
    else layer.mask = Mask.filled(layer.canvas.width, layer.canvas.height, hideAll ? 0 : 255);
    layer.maskEnabled = true;
  });
  doc.editingMask = true;
  done(doc);
}
export function deleteMask(doc, layer) {
  if (!layer.mask) return;
  doc.apply('Delete Layer Mask', () => { layer.mask = null; });
  doc.editingMask = false;
  done(doc);
}
export function applyMask(doc, layer) {
  if (!layer.mask || !layer.canvas) return;
  doc.apply('Apply Layer Mask', () => {
    const c = cloneCanvas(layer.canvas), ctx = ctxOf(c);
    ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(layer.mask.canvas(), 0, 0, c.width, c.height);
    layer.canvas = c; layer.mask = null;
  });
  doc.editingMask = false;
  done(doc);
}
export function invertMaskOf(doc, layer) {
  if (!layer.mask) return;
  doc.apply('Invert Layer Mask', () => { const m = layer.mask.clone(); for (let i = 0; i < m.data.length; i++) m.data[i] = 255 - m.data[i]; layer.mask = m; });
  done(doc);
}
export function setMaskEnabled(doc, layer, enabled) {
  if (!layer.mask || layer.maskEnabled === enabled) return;
  doc.apply(enabled ? 'Enable Layer Mask' : 'Disable Layer Mask', () => { layer.maskEnabled = enabled; });
  done(doc);
}
