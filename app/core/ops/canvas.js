// Canvas and image geometry (port of Composa EditorSession.Canvas + ImageTrim): crop, canvas size, image size, flips and turns.
import { Mask, remapMask } from '../mask.js';
import { makeCanvas, ctxOf, getData } from '../pixels.js';
import { identityTransform, isPureTranslation } from '../model.js';
import { renderer } from '../render.js';
import { live } from '../live.js';
import { LIMITS } from '../limits.js';
import * as G from '../geom.js';

const mapGuides = (doc, fn) => { doc.guides = doc.guides.map(fn); };
const finish = (doc) => { doc.invalidate(null); doc.layersChanged(); doc.selectionChanged(); doc.emit('size'); };
const fullRect = (doc) => ({ x: 0, y: 0, w: doc.width, h: doc.height });

// Smooth resampling of a canvas; big reductions go in halving steps to stay free of aliasing.
export function resampleCanvas(src, w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) { const half = makeCanvas(Math.ceil(cur.width / 2), Math.ceil(cur.height / 2)), c = ctxOf(half); c.imageSmoothingQuality = 'high'; c.drawImage(cur, 0, 0, half.width, half.height); cur = half; }
  const out = makeCanvas(w, h), ctx = ctxOf(out);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(cur, 0, 0, w, h);
  return out;
}
export function resampleMask(mask, w, h) { const c = resampleCanvas(mask.canvas(), w, h); return Mask.fromAlpha(c); }

// Crops (or extends) the canvas to a document-space rectangle. Layer pixels outside it are kept.
export function crop(doc, rect, name = 'Crop') {
  rect = { x: Math.round(rect.x), y: Math.round(rect.y), w: G.clamp(Math.round(rect.w), 1, LIMITS.maxSide), h: G.clamp(Math.round(rect.h), 1, LIMITS.maxSide) };
  if (rect.x === 0 && rect.y === 0 && rect.w === doc.width && rect.h === doc.height) return;
  doc.apply(name, () => {
    const shift = G.translate(-rect.x, -rect.y);
    for (const layer of doc.allLayers()) {
      if (layer.canvas) layer.transform = { ...layer.transform, x: layer.transform.x - rect.x, y: layer.transform.y - rect.y };
      else if (layer.mask) layer.mask = remapMask(layer.mask, rect.w, rect.h, shift, 255);
    }
    if (doc.selection) { const s = remapMask(doc.selection, rect.w, rect.h, shift); doc.selection = s.isEmpty() ? null : s; }
    mapGuides(doc, (g) => ({ ...g, position: g.position - (g.axis === 'v' ? rect.x : rect.y) }));
    doc.width = rect.w; doc.height = rect.h;
  });
  finish(doc);
}
// anchor 0..8: row-major 3x3 grid (0 top-left, 4 centre, 8 bottom-right).
export function resizeCanvas(doc, width, height, anchor) {
  const dx = doc.width - width, dy = doc.height - height, col = anchor % 3, row = Math.floor(anchor / 3);
  const left = col === 0 ? 0 : col === 1 ? Math.trunc(dx / 2) : dx, top = row === 0 ? 0 : row === 1 ? Math.trunc(dy / 2) : dy;
  crop(doc, { x: left, y: top, w: width, h: height }, 'Canvas Size');
}

// Resamples the whole document to a new pixel size.
export function resizeImage(doc, width, height, resolution = null) {
  width = G.clamp(Math.round(width), 1, LIMITS.maxSide); height = G.clamp(Math.round(height), 1, LIMITS.maxSide);
  if (width === doc.width && height === doc.height) {
    if (resolution != null && resolution !== doc.resolution) doc.apply('Image Size', () => { doc.resolution = G.clamp(resolution, 1, 9600); });
    return;
  }
  const sx = width / doc.width, sy = height / doc.height;
  doc.apply('Image Size', () => {
    const scale = G.scale(sx, sy);
    for (const layer of doc.allLayers()) {
      if (layer.canvas) {
        const t = layer.transform, c = layer.canvas;
        if (isPureTranslation(t, c.width, c.height)) {
          let w = Math.max(1, Math.round(c.width * sx)), h = Math.max(1, Math.round(c.height * sy));
          if (layer.text && live.scaleText && (layer.text.boxWidth != null || Math.abs(sx - sy) < 1e-6)) {
            layer.text = live.scaleText(layer.text, sx, sy); const r = live.renderText(layer.text); w = r.width; h = r.height; layer.canvas = r;
          } else if (layer.shape && live.renderShape) {
            layer.shape = { ...layer.shape, cornerRadius: layer.shape.cornerRadius * Math.min(sx, sy), lineWidth: layer.shape.lineWidth * Math.min(sx, sy) };
            layer.canvas = live.renderShape(layer.shape, w, h);
          } else { layer.text = null; layer.shape = null; layer.canvas = resampleCanvas(c, w, h); }
          if (layer.mask) layer.mask = resampleMask(layer.mask, w, h);
          layer.transform = identityTransform(w, h, Math.round(t.x * sx), Math.round(t.y * sy));
        } else if (Math.abs(sx - sy) > 1e-6 && (t.rotation || t.distort)) {
          // Stretching a turned layer unevenly shears it, which a placement cannot express: draw it out and resample that.
          const b = G.roundOut(layer.bounds), plain = layer.clone();
          plain.visible = true; plain.opacity = 1; plain.blend = 'normal'; plain.clipped = false; plain.mask = null;
          const drawn = renderer.renderLayers([plain], b), w = Math.max(1, Math.round(b.w * sx)), h = Math.max(1, Math.round(b.h * sy));
          if (layer.mask) {
            const mc = makeCanvas(b.w, b.h), mctx = ctxOf(mc);
            mctx.translate(-b.x, -b.y); mctx.transform(...layer.matrixForMask?.() ?? layer.matrix); mctx.drawImage(layer.mask.canvas(), 0, 0);
            layer.mask = resampleMask(Mask.fromAlpha(mc), w, h);
          }
          layer.canvas = resampleCanvas(drawn, w, h); layer.shape = null; layer.text = null;
          layer.transform = identityTransform(w, h, Math.round(b.x * sx), Math.round(b.y * sy));
        } else {
          layer.transform = { ...t, x: t.x * sx, y: t.y * sy, width: t.width * sx, height: t.height * sy, distort: t.distort && t.distort.map((v, i) => v * (i % 2 === 0 ? sx : sy)) };
        }
      } else if (layer.mask) layer.mask = remapMask(layer.mask, width, height, scale, 0);
    }
    if (doc.selection) { const s = remapMask(doc.selection, width, height, scale); doc.selection = s.isEmpty() ? null : s; }
    mapGuides(doc, (g) => ({ ...g, position: g.position * (g.axis === 'v' ? sx : sy) }));
    doc.width = width; doc.height = height;
    if (resolution != null) doc.resolution = G.clamp(resolution, 1, 9600);
  });
  finish(doc);
}

// Reflects a transform across the line in the middle of 0..extent.
function mirror(t, horizontally, extent) {
  let d = null;
  if (t.distort) {
    const v = t.distort;
    d = horizontally ? [-v[2], v[3], -v[0], v[1], -v[6], v[7], -v[4], v[5]] : [v[6], -v[7], v[4], -v[5], v[2], -v[3], v[0], -v[1]];
  }
  return horizontally ? { ...t, x: extent - t.x - t.width, flipH: !t.flipH, rotation: -t.rotation, distort: d } : { ...t, y: extent - t.y - t.height, flipV: !t.flipV, rotation: -t.rotation, distort: d };
}
export function flipCanvas(doc, horizontally) {
  doc.apply(horizontally ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical', () => {
    const m = horizontally ? G.scale(-1, 1, doc.width / 2, 0) : G.scale(1, -1, 0, doc.height / 2);
    for (const layer of doc.allLayers()) {
      if (layer.canvas) layer.transform = mirror(layer.transform, horizontally, horizontally ? doc.width : doc.height);
      else if (layer.mask) layer.mask = remapMask(layer.mask, doc.width, doc.height, m, 255);
    }
    if (doc.selection) doc.selection = remapMask(doc.selection, doc.width, doc.height, m);
    const half = (horizontally ? doc.width : doc.height) / 2;
    mapGuides(doc, (g) => ((horizontally && g.axis === 'v') || (!horizontally && g.axis === 'h') ? { ...g, position: 2 * half - g.position } : g));
  });
  finish(doc);
}
// Turns the whole document a quarter turn. Layers keep their pixels; only their placement changes.
export function rotateCanvas(doc, clockwise) {
  const w = doc.width, h = doc.height;
  doc.apply(clockwise ? 'Rotate Canvas 90° Clockwise' : 'Rotate Canvas 90° Counterclockwise', () => {
    // Clockwise: (x, y) -> (h - y, x). Counterclockwise: (x, y) -> (y, w - x).
    const turn = clockwise ? [0, 1, -1, 0, h, 0] : [0, -1, 1, 0, 0, w];
    for (const layer of doc.allLayers()) {
      if (layer.canvas) {
        const t = layer.transform, c = G.mapPoint(turn, t.x + t.width / 2, t.y + t.height / 2);
        let r = t.rotation + (clockwise ? 90 : -90);
        if (r > 180) r -= 360; if (r <= -180) r += 360;
        layer.transform = { ...t, x: c.x - t.width / 2, y: c.y - t.height / 2, rotation: r };
      } else if (layer.mask) layer.mask = remapMask(layer.mask, h, w, turn, 255);
    }
    if (doc.selection) doc.selection = remapMask(doc.selection, h, w, turn);
    mapGuides(doc, (g) => (g.axis === 'v' ? { ...g, axis: 'h', position: clockwise ? g.position : w - g.position } : { ...g, axis: 'v', position: clockwise ? h - g.position : g.position }));
    doc.width = h; doc.height = w;
  });
  finish(doc);
}
const rasterTargets = (doc) => doc.selectedRoots().flatMap((r) => [r, ...doc.allLayers(r.children)]).filter((l) => l.canvas);
export function rotateLayers(doc, degrees) {
  const layers = rasterTargets(doc); if (!layers.length) return;
  doc.apply('Rotate Layer', () => { for (const l of layers) { let r = (l.transform.rotation + degrees) % 360; if (r > 180) r -= 360; if (r <= -180) r += 360; l.transform = { ...l.transform, rotation: r }; } });
  doc.invalidate(null); doc.layersChanged();
}
export function flipLayers(doc, horizontally) {
  const layers = rasterTargets(doc); if (!layers.length) return;
  doc.apply(horizontally ? 'Flip Layer Horizontal' : 'Flip Layer Vertical', () => {
    for (const l of layers) { const t = l.transform; l.transform = mirror(t, horizontally, horizontally ? 2 * t.x + t.width : 2 * t.y + t.height); }
  });
  doc.invalidate(null); doc.layersChanged();
}

// ---- Trim ---------------------------------------------------------------------------------------
// The part of a flattened picture worth keeping, or null. options: { basedOn: 'transparent'|'topLeft'|'bottomRight', top, bottom, left, right, tolerance }.
export function trimBounds(img, o) {
  const { width: w, height: h, data: d } = img;
  if (!(o.top || o.bottom || o.left || o.right)) return null;
  let left = w, top = h, right = 0, bottom = 0;
  if (o.basedOn === 'transparent') {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]) { if (x < left) left = x; if (x + 1 > right) right = x + 1; if (y < top) top = y; bottom = y + 1; }
    if (right === 0) return null;
  } else {
    const s = o.basedOn === 'topLeft' ? 0 : ((h - 1) * w + w - 1) * 4, tr = d[s], tg = d[s + 1], tb = d[s + 2], ta = d[s + 3], tol = o.tolerance || 0;
    const match = (i) => Math.abs(d[i] - tr) <= tol && Math.abs(d[i + 1] - tg) <= tol && Math.abs(d[i + 2] - tb) <= tol && Math.abs(d[i + 3] - ta) <= tol;
    for (let y = 0; y < h; y++) {
      let first = 0; while (first < w && match((y * w + first) * 4)) first++;
      if (first === w) continue;
      let last = w; while (last > first && match((y * w + last - 1) * 4)) last--;
      left = Math.min(left, first); right = Math.max(right, last); top = Math.min(top, y); bottom = y + 1;
    }
    if (right === 0) return null;
  }
  const r = { x: o.left ? left : 0, y: o.top ? top : 0, w: (o.right ? right : w) - (o.left ? left : 0), h: (o.bottom ? bottom : h) - (o.top ? top : 0) };
  return r.w > 0 && r.h > 0 ? r : null;
}
export function trim(doc, options = { basedOn: 'transparent', top: true, bottom: true, left: true, right: true, tolerance: 0 }) {
  const b = trimBounds(getData(renderer.flatten(doc)), options);
  if (!b || (b.x === 0 && b.y === 0 && b.w === doc.width && b.h === doc.height)) return false;
  crop(doc, b, 'Trim');
  return true;
}
