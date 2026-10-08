import { makeCanvas, ctxOf } from '../core/pixels.js';
import { renderer } from '../core/render.js';
import { writeProject, readProject, EXTENSION } from './project.js';

// Decode any browser-readable image into a canvas (EXIF orientation honoured). SVG falls back to <img>.
export async function loadImage(file) {
  let source;
  try { source = await createImageBitmap(file); }
  catch {
    const url = URL.createObjectURL(file);
    try { source = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Cannot read ' + file.name)); i.src = url; }); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 10000); }
  }
  const w = source.width || source.naturalWidth, h = source.height || source.naturalHeight;
  if (!w || !h) throw new Error('Cannot read ' + file.name);
  const canvas = makeCanvas(w, h);
  ctxOf(canvas).drawImage(source, 0, 0);
  source.close?.();
  return canvas;
}
export const baseName = (n) => n.replace(/\.[^.]+$/, '');
export const extOf = (n) => (n.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
export const kindOf = (file) => { const e = extOf(file.name); return e === 'cmps' ? 'project' : e === 'psd' || e === 'psb' ? 'psd' : 'image'; };

export const hasFilePicker = () => typeof window.showSaveFilePicker === 'function';
export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const TYPES = {
  cmps: { description: 'Pixoto / Composa project', accept: { 'application/zip': ['.cmps'] } },
  png: { description: 'PNG image', accept: { 'image/png': ['.png'] } }, jpg: { description: 'JPEG image', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }, webp: { description: 'WebP image', accept: { 'image/webp': ['.webp'] } },
};
// Saves a blob through the File System Access API when there is one (asking where), otherwise as a download.
// Returns { name, handle } or null when the person cancelled.
export async function saveBlob(blob, suggestedName, ext, handle = null) {
  if (hasFilePicker()) {
    try {
      let h = handle;
      if (!h) h = await window.showSaveFilePicker({ suggestedName, types: [TYPES[ext]] });
      const w = await h.createWritable(); await w.write(blob); await w.close();
      return { name: h.name, handle: h };
    } catch (e) { if (e.name === 'AbortError') return null; if (handle) return saveBlob(blob, suggestedName, ext, null); }
  }
  download(blob, suggestedName);
  return { name: suggestedName, handle: null };
}
export async function pickOpen(multiple = true) {
  if (typeof window.showOpenFilePicker === 'function') {
    try { const hs = await window.showOpenFilePicker({ multiple, types: [{ description: 'Images and projects', accept: { 'image/*': [], 'application/zip': ['.cmps'], 'image/vnd.adobe.photoshop': ['.psd', '.psb'] } }] }); return Promise.all(hs.map(async (h) => Object.assign(await h.getFile(), { handle: h }))); }
    catch (e) { if (e.name === 'AbortError') return []; }
  }
  return new Promise((res) => {
    const i = Object.assign(document.createElement('input'), { type: 'file', multiple, accept: 'image/*,.cmps,.psd,.psb' });
    i.onchange = () => res([...i.files]); i.oncancel = () => res([]); i.click();
  });
}

export async function saveProject(doc, { saveAs = false } = {}) {
  const blob = await writeProject(doc);
  const res = await saveBlob(blob, `${doc.name}${EXTENSION}`, 'cmps', saveAs ? null : doc.fileHandle);
  if (!res) return false;
  if (res.handle) doc.fileHandle = res.handle;
  doc.savedBlob = blob;
  doc.name = baseName(res.name);
  doc.markSaved();
  return true;
}

// Flattened export. JPEG has no alpha, so it is composited over white.
export function flatCanvas(doc, format) {
  const merged = renderer.render(doc);
  if (format !== 'jpeg') return merged;
  const c = makeCanvas(doc.width, doc.height), x = ctxOf(c);
  x.fillStyle = '#fff'; x.fillRect(0, 0, doc.width, doc.height); x.drawImage(merged, 0, 0);
  return c;
}
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
export const encode = (canvas, format, quality = 0.9) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('This browser cannot encode ' + format.toUpperCase()))), MIME[format], quality));
export async function exportDoc(doc, format, quality = 0.9) {
  const blob = await encode(flatCanvas(doc, format), format, quality), ext = format === 'jpeg' ? 'jpg' : format;
  return saveBlob(blob, `${doc.name}.${ext}`, ext);
}
export { readProject };
