import { makeCanvas } from '../core/model.js';
import { renderer } from '../core/render.js';

// Decode any browser-readable image into a canvas. SVG falls back to <img> because createImageBitmap rejects it.
export async function loadImage(file) {
  let source;
  try { source = await createImageBitmap(file); }
  catch {
    const url = URL.createObjectURL(file);
    try {
      source = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Cannot read ' + file.name)); i.src = url; });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 10000); }
  }
  const w = source.width || source.naturalWidth, h = source.height || source.naturalHeight;
  if (!w || !h) throw new Error('Cannot read ' + file.name);
  const canvas = makeCanvas(w, h);
  canvas.getContext('2d').drawImage(source, 0, 0);
  source.close?.();
  return canvas;
}

export const baseName = (n) => n.replace(/\.[^.]+$/, '');

const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
// Flattened export of the document. JPEG has no alpha, so it is composited over white.
export async function exportDoc(doc, format, quality = 0.9) {
  const merged = renderer.render(doc);
  let src = merged;
  if (format === 'jpeg') {
    src = makeCanvas(doc.width, doc.height);
    const c = src.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, doc.width, doc.height); c.drawImage(merged, 0, 0);
  }
  const blob = await new Promise((res) => src.toBlob(res, MIME[format], quality));
  if (!blob) throw new Error('This browser cannot encode ' + format.toUpperCase());
  download(blob, `${doc.name}.${format === 'jpeg' ? 'jpg' : format}`);
}
export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
