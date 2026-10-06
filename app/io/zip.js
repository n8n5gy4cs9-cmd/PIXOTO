// A small ZIP reader/writer on native streams (no library): entries are stored, or deflated with CompressionStream.
const te = new TextEncoder(), td = new TextDecoder();
let crcTable = null;
function crc32(bytes) {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function pipe(bytes, stream) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}
export const canDeflate = () => typeof CompressionStream !== 'undefined';

// entries: [{ name, data: Uint8Array, deflate?: boolean }]. Returns a Blob.
export async function writeZip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = te.encode(e.name), raw = e.data, crc = crc32(raw);
    let data = raw, method = 0;
    if (e.deflate && canDeflate() && raw.length > 64) { const d = await pipe(raw, new CompressionStream('deflate-raw')); if (d.length < raw.length) { data = d; method = 8; } }
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, raw.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(c.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// Reads a zip into { name -> { method, data (compressed), size } } lazily inflated through get(name).
export function readZip(buffer) {
  const v = new DataView(buffer), u8 = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not a zip archive.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('The archive is damaged.');
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true), nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    entries.set(name, { method, csize, size, off });
    p += 46 + nlen + xlen + clen;
  }
  return {
    has: (n) => entries.has(n), size: (n) => entries.get(n)?.size,
    async get(name) {
      const e = entries.get(name); if (!e) return null;
      const nlen = v.getUint16(e.off + 26, true), xlen = v.getUint16(e.off + 28, true), start = e.off + 30 + nlen + xlen, raw = u8.subarray(start, start + e.csize);
      if (e.method === 0) return raw;
      if (e.method === 8) return pipe(raw, new DecompressionStream('deflate-raw'));
      throw new Error('Unsupported compression in the archive.');
    },
  };
}
// zlib-wrapped deflate (PSD ZIP channels): inflate with the 'deflate' format.
export const inflateZlib = (bytes) => pipe(bytes, new DecompressionStream('deflate'));
