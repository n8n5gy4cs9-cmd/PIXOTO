// Pixel edits on layers and masks (port of Composa EditorSession.Pixels): grow a layer to the canvas, fill, clear, and
// the selection-limited mixing every destructive edit uses. Edits replace the target's canvas/mask (an undo step each).
import { Mask } from '../mask.js';
import { makeCanvas, ctxOf, getData, putData, cloneCanvas, fillCanvas, hexToRgb, grayOf, touchCanvas } from '../pixels.js';
import { identityTransform, isPureTranslation } from '../model.js';
import { selectionInLayerSpace } from './layers.js';
import { fitsSurface } from '../limits.js';
import * as G from '../geom.js';

// What a mask is past its pixels, and so what grown area starts as: black when its border mostly hides, white otherwise.
export function maskBackground(mask) {
  const { width: w, height: h, data } = mask;
  let total = 0, count = 0;
  for (let y = 0; y < h; y++) {
    if (y === 0 || y === h - 1) { for (let x = 0; x < w; x++) total += data[y * w + x]; count += w; }
    else { total += data[y * w] + data[y * w + w - 1]; count += 2; }
  }
  return !count || total * 2 >= count * 255 ? 255 : 0;
}
export function grownMask(mask, width, height, left, top) {
  const out = Mask.filled(width, height, maskBackground(mask));
  for (let y = 0; y < mask.height; y++) out.data.set(mask.data.subarray(y * mask.width, (y + 1) * mask.width), (y + top) * width + left);
  return out;
}

// Grows a layer so its canvas covers the whole document, making every pixel paintable.
export function ensureCoversCanvas(doc, layer) {
  const c = layer.canvas; if (!c) return;
  const t = layer.transform;
  if (!isPureTranslation(t, c.width, c.height)) { padToCoverCanvas(doc, layer); return; }
  const have = { x: t.x, y: t.y, w: c.width, h: c.height }, want = G.union(have, { x: 0, y: 0, w: doc.width, h: doc.height });
  if (want.x === have.x && want.y === have.y && want.w === have.w && want.h === have.h) return;
  if (!fitsSurface(want.w, want.h)) return;
  const grown = makeCanvas(want.w, want.h);
  ctxOf(grown).drawImage(c, have.x - want.x, have.y - want.y);
  layer.canvas = grown;
  if (layer.mask) layer.mask = grownMask(layer.mask, want.w, want.h, have.x - want.x, have.y - want.y);
  layer.transform = identityTransform(want.w, want.h, want.x, want.y);
}
// The same for a scaled, flipped or rotated layer: transparent pixels are added around the canvas until the document is covered.
function padToCoverCanvas(doc, layer) {
  const c = layer.canvas, t = layer.transform;
  if (t.distort) return;
  const inv = G.invert(layer.matrix); if (!inv) return;
  const need = G.mapRect(inv, { x: 0, y: 0, w: doc.width, h: doc.height });
  const left = Math.max(0, Math.ceil(-need.x)), top = Math.max(0, Math.ceil(-need.y)), right = Math.max(0, Math.ceil(need.x + need.w - c.width)), bottom = Math.max(0, Math.ceil(need.y + need.h - c.height));
  if (left + top + right + bottom === 0) return;
  const w = c.width + left + right, h = c.height + top + bottom;
  if (!fitsSurface(w, h)) return;
  const grown = makeCanvas(w, h); ctxOf(grown).drawImage(c, left, top);
  layer.canvas = grown;
  if (layer.mask) layer.mask = grownMask(layer.mask, w, h, left, top);
  const sx = t.width / c.width, sy = t.height / c.height, padLeft = (t.flipH ? right : left) * sx, padTop = (t.flipV ? bottom : top) * sy;
  let x = t.x - padLeft, y = t.y - padTop;
  const nw = w * sx, nh = h * sy, dX = x + nw / 2 - (t.x + t.width / 2), dY = y + nh / 2 - (t.y + t.height / 2), rad = t.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  x += dX * cos - dY * sin - dX; y += dX * sin + dY * cos - dY;
  layer.transform = { ...t, x, y, width: nw, height: nh };
}
export const growToCanvas = (doc, layer) => { if (!doc.isEditingMask || !layer.isLive) ensureCoversCanvas(doc, layer); };

// The selection resampled into the edit target's grid, or null when nothing is selected.
export function selectionInTargetSpace(doc, layer) {
  if (!doc.selection) return null;
  if (!layer.canvas) return doc.selection;
  return selectionInLayerSpace(doc, layer);
}

// original + (modified - original) * selection, for straight RGBA ImageData or a Uint8 mask plane. Returns `modified`.
export function mixBySelection(original, modified, sel) {
  if (!sel) return modified;
  const o = original.data ?? original, m = modified.data ?? modified, s = sel.data, isMask = !(modified instanceof ImageData);
  if (isMask) {
    for (let i = 0; i < m.length; i++) { const k = i < s.length ? s[i] : 0; if (k !== 255) m[i] = o[i] + (m[i] - o[i]) * k / 255; }
    return modified;
  }
  const w = modified.width, h = modified.height, sw = sel.width;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = x < sw && y < sel.height ? s[y * sw + x] : 0;
    if (k === 255) continue;
    const i = (y * w + x) * 4;
    if (k === 0) { m[i] = o[i]; m[i + 1] = o[i + 1]; m[i + 2] = o[i + 2]; m[i + 3] = o[i + 3]; continue; }
    const f = k / 255, oa = o[i + 3] / 255, ma = m[i + 3] / 255, a = oa + (ma - oa) * f;
    m[i + 3] = a * 255;
    if (a > 0) for (let c = 0; c < 3; c++) m[i + c] = (o[i + c] * oa + (m[i + c] * ma - o[i + c] * oa) * f) / a;
  }
  return modified;
}

// Runs `edit(imageData|Uint8 plane info)` as one undoable step on the active layer's pixels or mask. `edit` receives
// { data: ImageData | null, mask: Mask | null, layer } and returns the new ImageData / Mask (or nothing to keep it edited in place).
function replaceTarget(doc, layer, result) {
  if (doc.isEditingMask) { layer.mask = result; }
  else { const c = makeCanvas(result.width, result.height); putData(c, result); layer.canvas = c; }
}

export function fillTarget(doc, color, name = 'Fill') {
  const layer = doc.editableLayer; if (!layer) return false;
  doc.apply(name, () => {
    growToCanvas(doc, layer);
    const sel = selectionInTargetSpace(doc, layer);
    if (doc.isEditingMask) {
      const orig = layer.mask, out = new Mask(orig.width, orig.height, new Uint8Array(orig.data.length).fill(grayOf(...hexToRgb(color))));
      mixBySelection(orig, out, sel); layer.mask = out;
    } else {
      const orig = getData(layer.canvas), out = new ImageData(orig.width, orig.height), [r, g, b] = hexToRgb(color);
      for (let i = 0; i < out.data.length; i += 4) { out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = 255; }
      mixBySelection(orig, out, sel); replaceTarget(doc, layer, out);
    }
  });
  doc.invalidate(doc.affectedArea(layer)); doc.layersChanged();
  return true;
}
// Delete: erases the selected pixels (or paints the mask black).
export function clearSelection(doc) {
  const layer = doc.editableLayer; if (!layer || !doc.selection) return false;
  doc.apply('Clear', () => {
    const sel = selectionInTargetSpace(doc, layer);
    if (doc.isEditingMask) { const orig = layer.mask, out = new Mask(orig.width, orig.height); mixBySelection(orig, out, sel); layer.mask = out; }
    else { const orig = getData(layer.canvas), out = new ImageData(orig.width, orig.height); mixBySelection(orig, out, sel); replaceTarget(doc, layer, out); }
  });
  doc.invalidate(doc.affectedArea(layer)); doc.layersChanged();
  return true;
}
export { replaceTarget };
