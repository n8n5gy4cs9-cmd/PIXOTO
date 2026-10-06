import { canvasOp } from './blend.js';
import { makeCanvas } from './model.js';

// Composites a document into one canvas. Cached on doc.version + layer versions.
export class Renderer {
  constructor() { this.cache = new WeakMap(); }

  render(doc) {
    let entry = this.cache.get(doc);
    const key = doc.version + ':' + doc.layers.map((l) => l.version).join(',');
    if (entry && entry.key === key && entry.canvas.width === doc.width && entry.canvas.height === doc.height) return entry.canvas;
    if (!entry || entry.canvas.width !== doc.width || entry.canvas.height !== doc.height) entry = { canvas: makeCanvas(doc.width, doc.height) };
    entry.key = key;
    const ctx = entry.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, doc.width, doc.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    for (const l of doc.layers) {
      if (!l.visible || l.opacity <= 0) continue;
      ctx.globalAlpha = l.opacity;
      ctx.globalCompositeOperation = canvasOp(l.blend);
      ctx.setTransform(Math.cos(l.rot) * l.sx, Math.sin(l.rot) * l.sx, -Math.sin(l.rot) * l.sy, Math.cos(l.rot) * l.sy, l.x, l.y);
      ctx.drawImage(l.canvas, -l.canvas.width / 2, -l.canvas.height / 2);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    this.cache.set(doc, entry);
    return entry.canvas;
  }
}
export const renderer = new Renderer();
