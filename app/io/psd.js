// Photoshop (.psd / .psb) import, after Composa.IO.Psd: 8-bit RGB files, layers and folders, masks, clipping, opacity,
// fill and blend modes. Anything that cannot be carried over (effects, adjustments, live type and shapes, smart objects)
// is converted or skipped and listed in a report. Photoshop files are opened, never written.
import { Doc, Layer, identityTransform } from '../core/model.js';
import { Mask } from '../core/mask.js';
import { makeCanvas, putData } from '../core/pixels.js';
import { inflateZlib } from './zip.js';
import { LIMITS, fitsSurface } from '../core/limits.js';

const BLENDS = { norm: 'normal', 'mul ': 'multiply', scrn: 'screen', over: 'overlay', dark: 'darken', lite: 'lighten', diff: 'difference', 'div ': 'colorDodge', idiv: 'colorBurn', sLit: 'softLight', hLit: 'hardLight', smud: 'exclusion',
  'hue ': 'hue', 'sat ': 'saturation', colr: 'color', 'lum ': 'luminosity', lbrn: 'linearBurn', lddg: 'linearDodge', vLit: 'vividLight', lLit: 'linearLight', pLit: 'pinLight', hMix: 'hardMix', fsub: 'subtract', fdiv: 'divide' };
const LARGE_KEYS = new Set(['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD']);
const TEXT = ['TySh', 'tySh', 'txt2'], VECTOR = ['vmsk', 'vsms', 'vogk'], SMART = ['SoLd', 'SoLE'], EFFECTS = ['lfx2', 'lrFX', 'lmfx'], ADJ = ['levl', 'curv', 'hue2', 'hue ', 'brit', 'expA', 'nvrt', 'blnc', 'blwh', 'mixr', 'selc', 'thrs', 'post', 'phfl', 'grdm', 'vibA'];

export class PsdError extends Error {}
const truncated = () => new PsdError('The Photoshop file could not be read. It may be damaged or incomplete.');
export const isPsd = (bytes) => bytes.length >= 4 && bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53;

class Cursor {
  constructor(bytes) { this.b = bytes; this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.o = 0; }
  need(n) { if (n < 0 || this.o + n > this.b.length) throw truncated(); }
  skip(n) { this.need(n); this.o += n; }
  seek(o) { if (o < 0 || o > this.b.length) throw truncated(); this.o = o; }
  u8() { this.need(1); return this.b[this.o++]; }
  u16() { this.need(2); const v = this.v.getUint16(this.o); this.o += 2; return v; }
  i16() { this.need(2); const v = this.v.getInt16(this.o); this.o += 2; return v; }
  u32() { this.need(4); const v = this.v.getUint32(this.o); this.o += 4; return v; }
  i32() { this.need(4); const v = this.v.getInt32(this.o); this.o += 4; return v; }
  u64() { const hi = this.u32(), lo = this.u32(); return hi * 4294967296 + lo; }
  bytes(n) { this.need(n); const s = this.b.subarray(this.o, this.o + n); this.o += n; return s; }
  ascii(n) { return String.fromCharCode(...this.bytes(n)); }
}
const length = (c, large) => { const v = large ? c.u64() : c.u32(); if (v > 2147483647) throw new PsdError('The Photoshop file is larger than this browser can hold.'); return v; };

function unpackRows(data, counts, width, height, plane, planeOffset) {
  let off = 0;
  for (let row = 0; row < height; row++) {
    const end = off + counts[row]; if (end > data.length) throw truncated();
    const target = planeOffset + row * width; let written = 0;
    while (written < width) {
      if (off >= end) throw truncated();
      const n = (data[off++] << 24) >> 24;
      if (n >= 0) { const c = n + 1; if (written + c > width || off + c > end) throw truncated(); plane.set(data.subarray(off, off + c), target + written); off += c; written += c; }
      else if (n !== -128) { const c = 1 - n; if (written + c > width || off >= end) throw truncated(); plane.fill(data[off++], target + written, target + written + c); written += c; }
    }
    off = end;
  }
  return off;
}
async function decodePlane(compression, width, height, data, large) {
  const expected = width * height;
  if (!expected) return new Uint8Array(0);
  if (compression === 0) { if (data.length < expected) throw truncated(); return data.slice(0, expected); }
  if (compression === 1) {
    const c = new Cursor(data), counts = new Array(height);
    for (let r = 0; r < height; r++) counts[r] = large ? c.u32() : c.u16();
    const plane = new Uint8Array(expected);
    unpackRows(data.subarray(c.o), counts, width, height, plane, 0);
    return plane;
  }
  if (compression === 2 || compression === 3) {
    const plane = (await inflateZlib(data)).slice(0, expected);
    if (plane.length < expected) throw truncated();
    if (compression === 3) for (let row = 0; row < height; row++) { const s = row * width; for (let x = 1; x < width; x++) plane[s + x] = (plane[s + x] + plane[s + x - 1]) & 255; }
    return plane;
  }
  throw new PsdError("This Photoshop file uses a compression method that isn't supported.");
}
function colorCanvas(w, h, R, G, B, A) {
  const img = new ImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) { d[i * 4] = R ? R[i] : 0; d[i * 4 + 1] = G ? G[i] : 0; d[i * 4 + 2] = B ? B[i] : 0; d[i * 4 + 3] = A ? A[i] : 255; }
  const c = makeCanvas(w, h); putData(c, img); return c;
}

function readRecord(c, large) {
  const L = { top: c.i32(), left: c.i32(), bottom: c.i32(), right: c.i32(), channels: [], extra: {}, name: '' };
  const n = c.u16(); if (n > 56) throw new PsdError('The Photoshop file is larger than this browser can hold.');
  for (let i = 0; i < n; i++) L.channels.push({ id: c.i16(), length: length(c, large) });
  if (c.ascii(4) !== '8BIM') throw truncated();
  L.blendKey = c.ascii(4); L.opacity = c.u8(); L.clipping = c.u8() !== 0; const flags = c.u8(); L.hidden = (flags & 2) !== 0; c.skip(1);
  const extraEnd = c.o + c.u32() + 0; if (extraEnd > c.b.length) throw truncated();
  const maskLen = c.u32(), maskEnd = c.o + maskLen;
  L.maskDefault = 255;
  if (maskLen >= 20) {
    L.hasMask = true; L.mTop = c.i32(); L.mLeft = c.i32(); L.mBottom = c.i32(); L.mRight = c.i32(); L.maskDefault = c.u8();
    const mf = c.u8(); L.maskLinked = (mf & 1) === 0; L.maskDisabled = (mf & 2) !== 0; L.maskFromRender = (mf & 8) !== 0;
  }
  c.seek(maskEnd); c.skip(c.u32());
  const nl = c.u8(); L.name = String.fromCharCode(...c.bytes(nl)); c.skip((4 - (nl + 1) % 4) % 4);
  while (c.o + 12 <= extraEnd) {
    const sig = c.ascii(4); if (sig !== '8BIM' && sig !== '8B64') break;
    const key = c.ascii(4), len = length(c, sig === '8B64' || (large && LARGE_KEYS.has(key)));
    if (c.o + len > extraEnd) throw truncated();
    L.extra[key] = c.bytes(len);
    if (len % 2 === 1 && c.o < extraEnd) c.skip(1);
  }
  c.seek(extraEnd);
  const uni = L.extra.luni;
  if (uni && uni.length >= 4) { const cc = new Cursor(uni), cnt = cc.u32(); let s = ''; for (let i = 0; i < cnt && cc.o + 2 <= uni.length; i++) s += String.fromCharCode(cc.u16()); s = s.replace(/\0+$/, ''); if (s) L.name = s; }
  L.fill = L.extra.iOpa?.[0] ?? 255;
  const sect = L.extra.lsct || L.extra.lsdk;
  if (sect && sect.length >= 4) L.section = new DataView(sect.buffer, sect.byteOffset, 4).getUint32(0);
  return L;
}

// Reads a .psd/.psb into { width, height, resolution, layers, conversions }.
export async function importPsd(buffer) {
  const bytes = new Uint8Array(buffer), c = new Cursor(bytes);
  if (!isPsd(bytes)) throw new PsdError('This is not a Photoshop file.');
  c.skip(4);
  const version = c.u16(); if (version !== 1 && version !== 2) throw new PsdError("This Photoshop file uses a format version that can't be read.");
  const large = version === 2; c.skip(6);
  const channelsMerged = c.u16(), height = c.i32(), width = c.i32(), depth = c.u16(), mode = c.u16();
  if (!fitsSurface(width, height)) throw new PsdError(`The Photoshop file is larger than this browser can hold (${LIMITS.maxSide} px a side).`);
  if (depth !== 8 || mode !== 3) throw new PsdError('Only 8-bit RGB Photoshop files can be imported.');
  c.skip(c.u32());
  let resolution = 72;
  const resEnd = c.u32() + c.o; if (resEnd > bytes.length) throw truncated();
  while (c.o + 12 <= resEnd) {
    if (c.ascii(4) !== '8BIM') break;
    const id = c.u16(), nl = c.u8(); c.skip(nl); if ((nl + 1) % 2 === 1) c.skip(1);
    const len = c.u32(), start = c.o;
    if (id === 1005 && len >= 4) { const r = c.u32() / 65536; resolution = Number.isFinite(r) && r >= 1 ? Math.min(9600, r) : 72; }
    c.seek(start + len); if (len % 2 === 1) c.skip(1);
  }
  c.seek(resEnd);
  const sectionLen = length(c, large), sectionEnd = c.o + sectionLen; if (sectionEnd > bytes.length) throw truncated();
  const records = [];
  if (sectionLen >= (large ? 10 : 6)) {
    length(c, large);
    const count = Math.abs(c.i16()); if (count > 10000) throw new PsdError('The Photoshop file has too many layers.');
    for (let i = 0; i < count; i++) records.push(readRecord(c, large));
    for (const L of records) {
      const planes = {};
      const w = Math.max(0, L.right - L.left), h = Math.max(0, L.bottom - L.top), mw = L.hasMask ? Math.max(0, L.mRight - L.mLeft) : 0, mh = L.hasMask ? Math.max(0, L.mBottom - L.mTop) : 0;
      if ((w && h && !fitsSurface(w, h)) || (mw && mh && !fitsSurface(mw, mh))) throw new PsdError('A layer in the Photoshop file is larger than this browser can hold.');
      for (const ch of L.channels) {
        const start = c.o;
        if ([-1, 0, 1, 2, -2].includes(ch.id) && ch.length >= 2) {
          const compression = c.u16(), payload = c.bytes(ch.length - 2), isMask = ch.id === -2;
          const pw = isMask ? mw : w, ph = isMask ? mh : h;
          if (pw > 0 && ph > 0) planes[ch.id] = await decodePlane(compression, pw, ph, payload, large);
        }
        c.seek(start + Math.max(0, ch.length));
      }
      L.w = w; L.h = h;
      if (w > 0 && h > 0) L.image = colorCanvas(w, h, planes[0], planes[1], planes[2], planes[-1]);
      if (L.hasMask && mw > 0 && mh > 0 && planes[-2]) { const m = new Mask(mw, mh); m.data.set(planes[-2]); L.maskImage = m; }
    }
  }
  c.seek(sectionEnd);
  const conversions = [], note = (name, msg) => conversions.push({ name, message: msg });
  if (!records.length) {
    // A flattened file: the merged image is all there is.
    if (c.o + 2 > bytes.length) throw truncated();
    const comp = c.u16(), count = width * height, nch = Math.min(channelsMerged, 4), planes = [];
    if (channelsMerged < 3) throw new PsdError('Only 8-bit RGB Photoshop files can be imported.');
    if (comp === 0) for (let i = 0; i < nch; i++) planes.push(c.bytes(count).slice());
    else if (comp === 1) {
      const counts = new Array(channelsMerged * height); for (let i = 0; i < counts.length; i++) counts[i] = large ? c.u32() : c.u16();
      const rest = bytes.subarray(c.o); let used = 0;
      for (let i = 0; i < nch; i++) { const p = new Uint8Array(count); used += unpackRows(rest.subarray(used), counts.slice(i * height, (i + 1) * height), width, height, p, 0); planes.push(p); }
    } else throw new PsdError("This Photoshop file uses an image compression method that isn't supported.");
    return { width, height, resolution, layers: [Layer.raster('Background', colorCanvas(width, height, planes[0], planes[1], planes[2], planes[3]))], conversions };
  }
  // Layers arrive bottom to top: a folder's divider comes first, then its contents, then the folder record.
  const roots = [], pending = new Map(), open = [], clipping = new Set();
  for (const L of records) {
    if (L.section === 3) { const key = {}; open.push(key); pending.set(key, []); continue; }
    const name = L.name || 'Layer';
    let layer, target = open.length ? pending.get(open.at(-1)) : roots;
    if (L.section === 1 || L.section === 2) {
      const key = open.pop();
      layer = Layer.group(name); layer.collapsed = L.section === 2;
      if (key) layer.children.push(...pending.get(key));
      target = open.length ? pending.get(open.at(-1)) : roots;
      if (!['pass', 'norm'].includes(L.blendKey)) note(name, `Folder blend mode "${L.blendKey.trim()}" isn't supported. The folder will be pass-through.`);
    } else {
      const ex = L.extra, has = (keys) => keys.some((k) => k in ex);
      if (has(EFFECTS)) note(name, 'Layer effects were discarded, so the appearance may differ.');
      if (has(ADJ) && !L.image) { note(name, "This adjustment layer type isn't supported and was skipped."); continue; }
      if (has(TEXT)) note(name, 'Type layer was imported as pixels; its text cannot be edited.');
      else if (has(SMART)) note(name, "The smart object was rasterized. Linked contents can't be edited.");
      else if (has(VECTOR)) note(name, 'Vector shape was imported as pixels.');
      else if ('GdFl' in ex || 'PtFl' in ex) note(name, "Gradient and pattern fills aren't supported; the layer was imported as it was rendered.");
      layer = L.image ? Layer.raster(name, L.image, L.left, L.top) : Layer.raster(name, makeCanvas(width, height));
      if (!(L.blendKey in BLENDS) && L.blendKey !== 'pass') note(name, `Blend mode "${L.blendKey.trim()}" isn't supported and will be applied as Normal.`);
      layer.blend = BLENDS[L.blendKey] || 'normal';
      if (L.clipping) clipping.add(layer);
    }
    layer.visible = !L.hidden;
    const hasFx = EFFECTS.some((k) => k in L.extra), op = L.opacity / 255;
    layer.opacity = Math.max(0, Math.min(1, hasFx && L.fill !== 255 ? op : op * (L.fill / 255)));
    if (L.hasMask && !L.maskFromRender) {
      let mw, mh, dx, dy;
      if (layer.canvas) { mw = layer.canvas.width; mh = layer.canvas.height; dx = L.mLeft - Math.round(layer.transform.x); dy = L.mTop - Math.round(layer.transform.y); } else { mw = width; mh = height; dx = L.mLeft; dy = L.mTop; }
      const m = Mask.filled(mw, mh, L.maskDefault);
      if (L.maskImage) { const src = L.maskImage; for (let y = 0; y < src.height; y++) { const ty = y + dy; if (ty < 0 || ty >= mh) continue; for (let x = 0; x < src.width; x++) { const tx = x + dx; if (tx >= 0 && tx < mw) m.data[ty * mw + tx] = src.data[y * src.width + x]; } } }
      layer.mask = m; layer.maskEnabled = !L.maskDisabled;
      if (!L.maskLinked) note(layer.name, 'The mask was unlinked from its layer in Photoshop; here it moves with the layer.');
    }
    target.push(layer);
  }
  while (open.length) roots.push(...pending.get(open.pop()));
  const resolveClip = (list) => {
    list.forEach((layer, i) => {
      if (layer.isGroup) resolveClip(layer.children);
      if (!clipping.has(layer)) return;
      let base = null;
      for (let j = i - 1; j >= 0; j--) if (!clipping.has(list[j])) { base = list[j]; break; }
      if (base?.canvas) layer.clipped = true; else note(layer.name, "This clipping mask's base isn't supported, so clipping was skipped.");
    });
  };
  resolveClip(roots);
  return { width, height, resolution, layers: roots, conversions };
}
export function psdToDoc(imp, name) {
  const doc = new Doc({ width: imp.width, height: imp.height, resolution: imp.resolution, name });
  doc.layers = imp.layers;
  doc.setActive(imp.layers.at(-1)?.id ?? null, false);
  doc.modified = false;
  return doc;
}
