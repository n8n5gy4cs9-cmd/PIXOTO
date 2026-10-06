// Copy, cut and paste (port of Composa EditorSession.Pixels clipboard section). Pixels copied inside the app are kept
// here, shared by every open project; layers copied whole (Copy with nothing selected) come back complete on paste.
import { Layer, identityTransform } from '../model.js';
import { makeCanvas, ctxOf, getData } from '../pixels.js';
import { renderer } from '../render.js';
import { clearSelection } from './pixels.js';
import { deleteSelectedLayers, duplicateSelectedLayers } from './layers.js';
import { remapMask } from '../mask.js';
import * as G from '../geom.js';

export const clip = { image: null, layers: null };      // image: { canvas, origin {x,y} }; layers: { layers, source, w, h }
const full = (doc) => ({ x: 0, y: 0, w: doc.width, h: doc.height });

// `source` covers `sourceArea` of the document; the result is trimmed to the selection.
function grab(doc, source, sourceArea) {
  const b = doc.selection ? G.intersect(doc.selection.bounds(), sourceArea) : sourceArea;
  if (G.isEmpty(b)) return null;
  const c = makeCanvas(b.w, b.h), ctx = ctxOf(c);
  ctx.drawImage(source, sourceArea.x - b.x, sourceArea.y - b.y);
  if (doc.selection) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(doc.selection.canvas(), -b.x, -b.y); }
  return { canvas: c, origin: { x: b.x, y: b.y } };
}
function grabLayer(doc, layer) {
  const copy = layer.clone();
  copy.visible = true; copy.opacity = 1; copy.blend = 'normal'; copy.clipped = false;
  const area = doc.selection ? full(doc) : G.union(full(doc), G.roundOut(layer.bounds));
  return grab(doc, renderer.renderLayers([copy], area), area);
}
export const canCopyLayers = (doc) => !!doc.active && !doc.selection && !doc.isEditingMask;
export const canCopy = (doc) => !!doc.active && (!!doc.active.canvas || canCopyLayers(doc));

export function copy(doc) {
  clip.layers = canCopyLayers(doc) ? { layers: doc.selectedRoots().map((l) => l.clone()), source: doc, w: doc.width, h: doc.height } : null;
  const l = doc.active;
  const image = l?.canvas ? grabLayer(doc, l) : null;
  if (!image) {
    if (!clip.layers) return false;
    clip.image = l?.isGroup ? grabLayer(doc, l) : null;
    return true;
  }
  clip.image = image;
  return true;
}
export function copyMerged(doc) {
  const image = grab(doc, renderer.render(doc), full(doc));
  if (!image) return false;
  clip.image = image; clip.layers = null;
  return true;
}
export function cut(doc) { if (!copy(doc)) return; if (doc.selection) clearSelection(doc); else deleteSelectedLayers(doc); }

// Pastes as a new layer: where it was copied from when that still fits the canvas, otherwise centred.
export function paste(doc, image = null, name = 'Pasted Layer') {
  if (!image && clip.layers) return pasteLayers(doc, clip.layers);
  image = image || clip.image;
  if (!image) return null;
  const c = image.canvas, placed = { x: image.origin.x, y: image.origin.y, w: c.width, h: c.height };
  const fits = placed.x >= 0 && placed.y >= 0 && placed.x + placed.w <= doc.width && placed.y + placed.h <= doc.height;
  const copyC = makeCanvas(c.width, c.height); ctxOf(copyC).drawImage(c, 0, 0);
  const layer = Layer.raster(doc.uniqueName(name), copyC, fits ? placed.x : Math.round((doc.width - c.width) / 2), fits ? placed.y : Math.round((doc.height - c.height) / 2));
  doc.apply('Paste', () => doc.insertAboveActive(layer));
  doc.editingMask = false;
  doc.invalidate(doc.affectedArea(layer)); doc.layersChanged();
  return layer;
}
// Layers copied whole: in their own project they keep their place; in another they are centred together.
function pasteLayers(doc, copied) {
  if (!copied.layers.length) return null;
  const pasted = copied.layers.map((l) => l.clone(true));
  const all = pasted.flatMap((l) => [l, ...doc.allLayers(l.children)]);
  if (copied.source !== doc) {
    const rects = all.filter((l) => l.canvas).map((l) => l.bounds);
    const covered = rects.length ? rects.reduce((a, b) => G.union(a, b)) : { x: 0, y: 0, w: copied.w, h: copied.h };
    const dx = Math.round(doc.width / 2 - (covered.x + covered.w / 2)), dy = Math.round(doc.height / 2 - (covered.y + covered.h / 2));
    for (const l of all) {
      if (l.canvas) l.transform = { ...l.transform, x: l.transform.x + dx, y: l.transform.y + dy };
      else if (l.mask && (dx || dy || l.mask.width !== doc.width || l.mask.height !== doc.height)) l.mask = remapMask(l.mask, doc.width, doc.height, G.translate(dx, dy), 255);
    }
  }
  doc.apply(pasted.length > 1 ? 'Paste Layers' : 'Paste Layer', () => {
    const a = doc.active;
    if (a) {
      const inside = a.isGroup && !a.collapsed, sib = inside ? a.children : doc.siblingsOf(a.id), at = inside ? sib.length : sib.indexOf(a) + 1;
      sib.splice(at, 0, ...pasted);
    } else doc.layers.push(...pasted);
    doc.setActive(pasted.at(-1).id, false);
    for (const l of pasted) doc.selectedIds.add(l.id);
  });
  doc.editingMask = false;
  doc.invalidate(null); doc.layersChanged();
  return pasted.at(-1);
}
// Ctrl+J: the selected pixels on a new layer, or a duplicate of the layer when nothing is selected.
export function layerViaCopy(doc) {
  if (!doc.selection) { duplicateSelectedLayers(doc); return; }
  const src = doc.active;
  if (!src?.canvas) return;
  const image = grabLayer(doc, src); if (!image) return;
  const layer = Layer.raster(doc.uniqueName('Layer'), image.canvas, image.origin.x, image.origin.y);
  doc.apply('Layer via Copy', () => { doc.insertAboveActive(layer); doc.selection = null; });
  doc.editingMask = false;
  doc.invalidate(doc.affectedArea(layer)); doc.layersChanged(); doc.selectionChanged();
}
// PNG of the clipboard image, for the system clipboard.
export const clipboardBlob = (image) => new Promise((res) => image.canvas.toBlob(res, 'image/png'));
