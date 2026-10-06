// Document renderer (port of Composa DocumentRenderer): flattens the layer tree with blend modes, opacity, masks,
// clipping masks, folders, effects and adjustment layers. Only the document's dirty area is re-rendered.
import { canvasOp, isCustomBlend } from './blend.js';
import { makeCanvas, ctxOf, getData, putData } from './pixels.js';
import { compositeSeparable } from './sepblend.js';
import { applyAdjustment, isIdentity, samplingMargin } from './filters/adjust.js';
import { renderedEffects } from './effects.js';
import { transformMapper } from './model.js';
import * as G from './geom.js';

// ---- tiles ---------------------------------------------------------------------------------
const pool = [];
function acquire(w, h) {
  const i = pool.findIndex((c) => c.width === w && c.height === h);
  const c = i >= 0 ? pool.splice(i, 1)[0] : makeCanvas(w, h);
  const ctx = ctxOf(c);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, w, h);
  return c;
}
function release(c) { pool.push(c); while (pool.length > 8) pool.shift(); }

// A buffer covering `area` of the document; its context draws in document coordinates.
class Tile {
  constructor(area) {
    this.area = area; this.canvas = acquire(area.w, area.h); this.ctx = ctxOf(this.canvas);
    this.ctx.translate(-area.x, -area.y);
  }
  sibling() { return new Tile(this.area); }
  // Draws a canvas covering the same area straight onto this tile.
  drawRaw(src, op = 'source-over', alpha = 1) {
    const c = this.ctx;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = op; c.globalAlpha = alpha; c.drawImage(src, 0, 0); c.restore();
  }
  release() { release(this.canvas); }
}

// ---- layer drawing -----------------------------------------------------------------------------
// Draws a canvas through a distorted layer's mapping, as a mesh of small affine triangles.
function drawDistorted(ctx, img, layer, fx) {
  const t = layer.transform, sw = layer.canvas.width, sh = layer.canvas.height, map = transformMapper(t, sw, sh), N = 12;
  const inset = fx ? fx.inset : 0, iw = img.width, ih = img.height;
  const sx = (u) => u / N * iw - inset, sy = (v) => v / N * ih - inset;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const s = [[sx(i), sy(j)], [sx(i + 1), sy(j)], [sx(i + 1), sy(j + 1)], [sx(i), sy(j + 1)]];
    const d = s.map(([x, y]) => map(x, y));
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
      const m = G.affine3({ x: s[a][0] + inset, y: s[a][1] + inset }, { x: s[b][0] + inset, y: s[b][1] + inset }, { x: s[c][0] + inset, y: s[c][1] + inset }, d[a], d[b], d[c]);
      if (!m) continue;
      const cx = (d[a].x + d[b].x + d[c].x) / 3, cy = (d[a].y + d[b].y + d[c].y) / 3, grow = (p) => ({ x: p.x + Math.sign(p.x - cx) * 0.5, y: p.y + Math.sign(p.y - cy) * 0.5 });
      ctx.save();
      ctx.beginPath(); [a, b, c].forEach((k, n) => { const p = grow(d[k]); n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.clip();
      ctx.transform(...m); ctx.drawImage(img, 0, 0);
      ctx.restore();
    }
  }
}

function drawPixels(layer, ctx, opacity, blend, fx) {
  const c = layer.canvas; if (!c) return;
  ctx.save();
  ctx.globalAlpha = opacity; ctx.globalCompositeOperation = isCustomBlend(blend) ? 'source-over' : canvasOp(blend);
  const m = layer.matrix, exact = !layer.transform.distort && m[0] === 1 && m[3] === 1 && !m[1] && !m[2] && m[4] === Math.round(m[4]) && m[5] === Math.round(m[5]);
  ctx.imageSmoothingEnabled = !exact; ctx.imageSmoothingQuality = 'high';
  const img = fx ? fx.result : c;
  if (layer.transform.distort) drawDistorted(ctx, img, layer, fx);
  else {
    ctx.transform(...m);
    ctx.drawImage(img, fx ? -fx.inset : 0, fx ? -fx.inset : 0);
    if (fx && c.live && !layer.mask) ctx.drawImage(c, 0, 0);   // wet paint over the effects of the stroke's start
  }
  ctx.restore();
}

function multiplyByMask(layer, content) {
  const mask = layer.mask, ctx = content.ctx;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in'; ctx.globalAlpha = 1;
  if (layer.canvas) {
    ctx.transform(...maskMatrix(layer));
    ctx.imageSmoothingEnabled = true;
  }
  ctx.drawImage(mask.canvas(), 0, 0);
  ctx.restore();
}
export function maskMatrix(layer) {
  if (!layer.mask || !layer.canvas) return G.IDENTITY;
  return transformMatrixFor(layer, layer.mask.width, layer.mask.height);
}
import { transformMatrix } from './model.js';
const transformMatrixFor = (layer, w, h) => transformMatrix(layer.transform, w, h);

const effectsOf = (layer) => (layer.canvas && layer.effects ? renderedEffects(layer.canvas, layer.mask && layer.maskEnabled ? layer.mask : null, layer.effects) : null);

// tile = tile * (1 - m) + replacement * m, where m is the layer's mask times its opacity.
function mix(tile, replacement, layer, hasMask) {
  if (!hasMask && layer.opacity >= 1) { tile.drawRaw(replacement, 'copy'); return; }
  const cov = tile.sibling();
  cov.ctx.save(); cov.ctx.setTransform(1, 0, 0, 1, 0, 0); cov.ctx.globalAlpha = layer.opacity; cov.ctx.fillStyle = '#000'; cov.ctx.fillRect(0, 0, cov.area.w, cov.area.h); cov.ctx.restore();
  if (hasMask) multiplyByMask(layer, cov);
  const rep = ctxOf(replacement);
  rep.save(); rep.setTransform(1, 0, 0, 1, 0, 0); rep.globalCompositeOperation = 'destination-in'; rep.drawImage(cov.canvas, 0, 0); rep.restore();
  tile.drawRaw(cov.canvas, 'destination-out');
  tile.drawRaw(replacement, 'lighter');
  cov.release();
}

function makeOpaque(canvas) {
  const img = getData(canvas), d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) d[i] = 255;
  putData(canvas, img);
}

function applyAdjustmentLayer(layer, tile) {
  const adj = layer.adjustment;
  if (!adj || isIdentity(adj)) return;
  const img = getData(tile.canvas);
  applyAdjustment(adj, img.data, img.width, img.height, tile.area.x, tile.area.y, 1);
  const adjusted = makeCanvas(img.width, img.height);
  putData(adjusted, img);
  mix(tile, adjusted, layer, !!(layer.mask && layer.maskEnabled));
}

function blendOnto(dstTile, srcCanvas, blend, opacity) {
  if (isCustomBlend(blend)) {
    const dst = getData(dstTile.canvas), src = getData(srcCanvas);
    compositeSeparable(dst.data, src.data, blend, opacity);
    putData(dstTile.canvas, dst);
  } else dstTile.drawRaw(srcCanvas, canvasOp(blend), opacity);
}

function renderNodes(nodes, tile) {
  for (let i = 0; i < nodes.length; i++) {
    const layer = nodes[i], clipped = [];
    while (i + 1 < nodes.length && nodes[i + 1].clipped) clipped.push(nodes[++i]);
    if (layer.clipped) continue;
    if (!layer.visible || layer.opacity <= 0) continue;
    renderUnit(layer, clipped.filter((l) => l.visible && l.opacity > 0), tile);
  }
}

function drawContent(layer, tile, fx) {
  if (layer.isGroup) renderNodes(layer.children, tile);
  else drawPixels(layer, tile.ctx, 1, 'normal', fx);
}

function renderUnit(layer, clipped, tile) {
  if (layer.isAdjustment) { applyAdjustmentLayer(layer, tile); return; }
  const fx = effectsOf(layer);
  const hasMask = !!(layer.mask && layer.maskEnabled) && !fx;
  if (layer.isGroup && !hasMask && layer.opacity >= 1 && layer.blend === 'normal' && !clipped.length) { renderNodes(layer.children, tile); return; }
  if (layer.kind === 'raster' && !hasMask && !clipped.length && !isCustomBlend(layer.blend)) { drawPixels(layer, tile.ctx, layer.opacity, layer.blend, fx); return; }

  // A Normal folder renders over a copy of what lies beneath and is mixed back by mask and opacity, which lets
  // adjustment layers inside see (and change) the picture below.
  if (layer.isGroup && layer.blend === 'normal' && !clipped.length) {
    const seeded = tile.sibling();
    seeded.drawRaw(tile.canvas, 'copy');
    renderNodes(layer.children, seeded);
    mix(tile, seeded.canvas, layer, hasMask);
    seeded.release();
    return;
  }
  const content = tile.sibling();
  drawContent(layer, content, fx);
  if (hasMask) multiplyByMask(layer, content);
  if (clipped.length) {
    // Clipped layers paint onto the base's colours as if it were opaque; the base's own coverage applies at the end.
    const baseAlpha = makeCanvas(content.area.w, content.area.h);
    ctxOf(baseAlpha).drawImage(content.canvas, 0, 0);
    makeOpaque(content.canvas);
    for (const top of clipped) {
      if (top.isAdjustment) { applyAdjustmentLayer(top, content); continue; }
      const over = tile.sibling(), topFx = effectsOf(top);
      drawContent(top, over, topFx);
      if (top.mask && top.maskEnabled && !topFx) multiplyByMask(top, over);
      blendOnto(content, over.canvas, top.blend, top.opacity);
      over.release();
    }
    content.ctx.save(); content.ctx.setTransform(1, 0, 0, 1, 0, 0); content.ctx.globalCompositeOperation = 'destination-in'; content.ctx.drawImage(baseAlpha, 0, 0); content.ctx.restore();
  }
  blendOnto(tile, content.canvas, layer.blend, layer.opacity);
  content.release();
}

// ---- document -----------------------------------------------------------------------------------
const whole = (doc) => ({ x: 0, y: 0, w: doc.width, h: doc.height });
function samplingPad(doc) {
  let m = 0;
  for (const l of doc.allLayers()) if (l.adjustment && l.visible && l.opacity > 0 && doc.isEffectivelyVisible(l)) m = Math.max(m, samplingMargin(l.adjustment));
  return Math.ceil(m);
}

export class Renderer {
  constructor() { this.cache = new WeakMap(); }
  // The flattened document, brought up to date. Treat the returned canvas as read-only.
  render(doc) {
    let e = this.cache.get(doc);
    if (!e || e.canvas.width !== doc.width || e.canvas.height !== doc.height) { e = { canvas: makeCanvas(doc.width, doc.height), version: -1 }; this.cache.set(doc, e); doc.dirty = whole(doc); }
    if (e.version === doc.version && G.isEmpty(doc.dirty)) return e.canvas;
    const area = G.isEmpty(doc.dirty) ? whole(doc) : doc.dirty;
    this.renderArea(doc, e.canvas, area);
    doc.dirty = G.emptyRect(); e.version = doc.version;
    return e.canvas;
  }
  renderArea(doc, target, area) {
    area = G.intersect(area, whole(doc));
    if (G.isEmpty(area)) return;
    const pad = samplingPad(doc), padded = pad ? G.intersect(G.inflate(area, pad), whole(doc)) : area;
    const tile = new Tile(padded);
    renderNodes(doc.layers, tile);
    const ctx = ctxOf(target);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'copy'; ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();
    ctx.drawImage(tile.canvas, padded.x, padded.y);
    ctx.restore();
    tile.release();
  }
  // A fresh flattened copy, independent of the cache, for export and Copy Merged.
  flatten(doc) {
    const c = makeCanvas(doc.width, doc.height);
    this.renderArea(doc, c, whole(doc));
    return c;
  }
  // Only the given layers (and their clipped followers) over a document-space area, for merges and copies.
  renderLayers(layers, area) {
    const tile = new Tile({ x: area.x, y: area.y, w: area.w, h: area.h });
    renderNodes(layers, tile);
    const c = makeCanvas(area.w, area.h);
    ctxOf(c).drawImage(tile.canvas, 0, 0);
    tile.release();
    return c;
  }
}
export const renderer = new Renderer();
