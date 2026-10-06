// The .cmps project format (port of Composa.IO.ProjectFile): a zip with manifest.json and images/ holding one PNG per
// layer (and one grayscale PNG per mask). The manifest uses Composa's JSON (camelCase, ARGB integer colours, enum names)
// so projects open in either app; settings Composa does not know (extra adjustments) are written as they are.
import { Doc, Layer, identityTransform } from '../core/model.js';
import { Mask } from '../core/mask.js';
import { makeCanvas, ctxOf, getData, putData } from '../core/pixels.js';
import { writeZip, readZip } from './zip.js';
import { LIMITS } from '../core/limits.js';

export const EXTENSION = '.cmps', FORMAT = 'org.composa.project', VERSION = 4;
const te = new TextEncoder(), td = new TextDecoder();

const argb = (hex) => ((0xFF000000 | parseInt(hex.slice(1, 7), 16)) >>> 0);
const hexOf = (n) => '#' + ((n >>> 0) & 0xFFFFFF).toString(16).padStart(6, '0');
const SHAPE_OUT = { rect: 'rectangle', rounded: 'roundedRectangle', ellipse: 'ellipse', line: 'line' };
const SHAPE_IN = Object.fromEntries(Object.entries(SHAPE_OUT).map(([k, v]) => [v, k]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
const mapColors = (obj, keys, fn) => { if (!obj) return obj; const o = { ...obj }; for (const k of keys) if (o[k] != null) o[k] = fn(o[k]); return o; };

function adjustmentOut(a) {
  switch (a.type) {
    case 'gradientMap': return { ...a, shadows: argb(a.shadows), highlights: argb(a.highlights) };
    case 'blackAndWhite': { const [reds, yellows, greens, cyans, blues, magentas] = a.weights; const { weights, ...rest } = a; return { ...rest, reds, yellows, greens, cyans, blues, magentas }; }
    default: return a;
  }
}
function adjustmentIn(a) {
  switch (a.type) {
    case 'gradientMap': return { ...a, shadows: hexOf(a.shadows), highlights: hexOf(a.highlights) };
    case 'blackAndWhite': { const { reds, yellows, greens, cyans, blues, magentas, ...rest } = a; return { ...rest, weights: [reds, yellows, greens, cyans, blues, magentas] }; }
    default: return a;
  }
}
const effectsOut = (e) => (e ? Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v ? mapColors(v, ['color'], argb) : v])) : e);
const effectsIn = (e) => (e ? Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v ? mapColors(v, ['color'], hexOf) : v])) : e);
const textOut = (t) => ({ ...mapColors(t, ['color'], argb), colorRuns: t.colorRuns ? t.colorRuns.map((r) => ({ ...r, color: argb(r.color) })) : null });
const textIn = (t) => ({ ...mapColors(t, ['color'], hexOf), colorRuns: t.colorRuns ? t.colorRuns.map((r) => ({ ...r, color: hexOf(r.color) })) : null });
const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === undefined ? null : v)), (k, v) => v);
const dropNull = (o) => { for (const k of Object.keys(o)) if (o[k] == null) delete o[k]; return o; };

const canvasBlob = (canvas) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('The browser could not encode a layer.'))), 'image/png'));
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

export async function writeProject(doc) {
  const entries = [], stored = new Map(), ids = new Map();
  const idOf = (l) => { if (!ids.has(l.id)) ids.set(l.id, uuid()); return ids.get(l.id); };
  const store = async (obj, name, canvas) => { if (stored.has(obj)) return stored.get(obj); entries.push({ name: 'images/' + name, data: await bytesOf(await canvasBlob(canvas)) }); stored.set(obj, name); return name; };
  const record = async (l) => {
    const r = { id: idOf(l), name: l.name, kind: l.kind, visible: l.visible, opacity: l.opacity, blend: l.blend };
    if (l.canvas) {
      const t = l.transform;
      r.transform = dropNull({ x: t.x, y: t.y, width: t.width, height: t.height, rotation: t.rotation, flipHorizontal: t.flipH, flipVertical: t.flipV, distort: t.distort });
      r.imageFile = await store(l.canvas, `${r.id}.png`, l.canvas);
    }
    if (l.mask) { r.maskFile = await store(l.mask, `${r.id}.mask.png`, l.mask.grayCanvas()); r.maskEnabled = l.maskEnabled; }
    if (l.clipped) r.clipped = true;
    if (l.collapsed) r.collapsed = true;
    if (l.adjustment) r.adjustment = adjustmentOut(l.adjustment);
    if (l.shape) r.shape = dropNull({ kind: SHAPE_OUT[l.shape.kind], fill: argb(l.shape.fill), cornerRadius: l.shape.cornerRadius, lineWidth: l.shape.lineWidth, startX: l.shape.startX, startY: l.shape.startY, endX: l.shape.endX, endY: l.shape.endY });
    if (l.text) r.text = dropNull(textOut(l.text));
    if (l.effects) r.effects = effectsOut(l.effects);
    if (l.isGroup) r.children = await Promise.all(l.children.map(record));
    return r;
  };
  const layers = []; for (const l of doc.layers) layers.push(await record(l));
  const manifest = { format: FORMAT, version: VERSION, colorSpace: 'sRGB', width: doc.width, height: doc.height, resolution: doc.resolution, activeLayerId: doc.activeId != null ? ids.get(doc.activeId) ?? null : null, layers };
  if (doc.guides.length) manifest.guides = doc.guides.map((g) => ({ id: uuid(), axis: g.axis === 'h' ? 'horizontal' : 'vertical', position: g.position }));
  entries.unshift({ name: 'manifest.json', data: te.encode(JSON.stringify(manifest, null, 1)), deflate: true });
  return writeZip(entries);
}

async function decodeImage(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const c = makeCanvas(bmp.width, bmp.height); ctxOf(c).drawImage(bmp, 0, 0); bmp.close?.();
  return c;
}
const usable = (t) => t && [t.x, t.y, t.width, t.height, t.rotation].every(Number.isFinite) && t.width >= 1 && t.height >= 1 && t.width <= 1e6 && t.height <= 1e6 && (!t.distort || (t.distort.length === 8 && t.distort.every(Number.isFinite)));

export async function readProject(buffer, name = 'Untitled') {
  const zip = readZip(buffer), mf = await zip.get('manifest.json');
  if (!mf) throw new Error('This is not a Composa project: it has no manifest.');
  const m = JSON.parse(td.decode(mf));
  if (m.format !== FORMAT) throw new Error('This is not a Composa project.');
  if (m.version > VERSION) throw new Error(`This project uses format version ${m.version}; this app supports up to version ${VERSION}.`);
  if (!(m.width >= 1 && m.height >= 1 && m.width <= LIMITS.maxSide && m.height <= LIMITS.maxSide)) throw new Error('The project canvas is larger than this browser can handle.');
  const doc = new Doc({ width: m.width, height: m.height, resolution: Math.min(9600, Math.max(1, m.resolution || 72)), name });
  const cache = new Map(), idMap = new Map();
  const fetchImage = async (file, mask) => {
    if (/\.\.|\/|\\/.test(file)) throw new Error('The project refers to an unsafe path.');
    if (cache.has(file)) return cache.get(file);
    const bytes = await zip.get('images/' + file);
    if (!bytes) throw new Error(`An image inside the project is missing (${file}).`);
    const canvas = await decodeImage(bytes);
    const v = mask ? Mask.fromAlpha(canvas) : canvas;
    if (mask) { const px = getData(canvas).data; for (let i = 0; i < v.data.length; i++) v.data[i] = px[i * 4]; }
    cache.set(file, v); return v;
  };
  let count = 0;
  const build = async (r, depth) => {
    if (++count > 10000 || depth > 64) throw new Error('The project has too many layers.');
    const l = new Layer(r.kind, r.name);
    idMap.set(r.id, l.id);
    l.visible = r.visible !== false; l.opacity = Number.isFinite(r.opacity) ? Math.min(1, Math.max(0, r.opacity)) : 1; l.blend = r.blend || 'normal';
    l.maskEnabled = r.maskEnabled ?? true; l.clipped = !!r.clipped; l.collapsed = !!r.collapsed;
    if (r.adjustment) l.adjustment = adjustmentIn(r.adjustment);
    if (r.shape) l.shape = { kind: SHAPE_IN[r.shape.kind] || 'rect', fill: hexOf(r.shape.fill), cornerRadius: r.shape.cornerRadius ?? 0, lineWidth: r.shape.lineWidth ?? 0, startX: r.shape.startX ?? null, startY: r.shape.startY ?? null, endX: r.shape.endX ?? null, endY: r.shape.endY ?? null };
    if (r.text) l.text = textIn({ boxWidth: null, boxHeight: null, colorRuns: null, ...r.text });
    if (r.imageFile && r.kind === 'raster') {
      l.canvas = await fetchImage(r.imageFile, false);
      const t = r.transform;
      l.transform = usable(t) ? { x: t.x, y: t.y, width: t.width, height: t.height, rotation: t.rotation || 0, flipH: !!t.flipHorizontal, flipV: !!t.flipVertical, distort: t.distort || null } : identityTransform(l.canvas.width, l.canvas.height);
      if (r.effects) l.effects = effectsIn(r.effects);
    } else if (r.kind === 'raster') throw new Error(`Layer "${r.name}" has no image.`);
    if (r.kind === 'adjustment' && !r.adjustment) throw new Error(`Adjustment layer "${r.name}" has no settings.`);
    if (r.maskFile) l.mask = await fetchImage(r.maskFile, true);
    if (r.kind === 'group' && r.children) for (const c of r.children) l.children.push(await build(c, depth + 1));
    return l;
  };
  for (const r of m.layers) doc.layers.push(await build(r, 0));
  for (const g of (m.guides || []).slice(0, 1000)) if (Number.isFinite(g.position)) doc.guides.push({ id: Math.random() * 1e9 | 0, axis: g.axis === 'horizontal' ? 'h' : 'v', position: g.position });
  doc.setActive(idMap.get(m.activeLayerId) ?? doc.layers.at(-1)?.id ?? null, false);
  doc.modified = false;
  return doc;
}
