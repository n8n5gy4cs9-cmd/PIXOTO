/* ═══════════════════════════════════════════════════════════════
   Pixoto — GIF89a animated encoder (P7)
   Written from scratch (no dependency): median-cut quantization,
   per-frame local color tables, GIF-LZW compression, Graphic Control
   Extensions for per-frame delay + transparency, and a NETSCAPE2.0
   loop block. Pure JS, runs in browser or Node.

   Public API:
     encodeGIF(frames, { width, height, loop=0 }) -> Uint8Array
   where each frame = { data: Uint8ClampedArray (RGBA), delay: ms }
   ═══════════════════════════════════════════════════════════════ */

// ─── Growable byte buffer ─────────────────────────────────────────
class ByteBuf {
    constructor() { this.bytes = []; }
    u8(v) { this.bytes.push(v & 0xff); }
    u16(v) { this.bytes.push(v & 0xff, (v >> 8) & 0xff); } // little-endian
    str(s) { for (let i = 0; i < s.length; i++) this.bytes.push(s.charCodeAt(i) & 0xff); }
    arr(a) { for (let i = 0; i < a.length; i++) this.bytes.push(a[i] & 0xff); }
    toUint8() { return Uint8Array.from(this.bytes); }
}

// ─── Median-cut quantization ──────────────────────────────────────
// Returns { palette: [[r,g,b],...], transparent: bool }
function quantize(rgba, maxColors) {
    // Sample opaque colors (cap to keep palette build fast)
    const colors = [];
    let transparent = false;
    const n = rgba.length / 4;
    const step = Math.max(1, Math.floor(n / 20000)); // sample up to ~20k pixels
    for (let i = 0; i < n; i += step) {
        const a = rgba[i * 4 + 3];
        if (a < 128) { transparent = true; continue; }
        colors.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
    }
    // also scan full image for any transparency (sampling may miss it)
    if (!transparent) {
        for (let i = 3; i < rgba.length; i += 4) { if (rgba[i] < 128) { transparent = true; break; } }
    }

    const slots = transparent ? maxColors - 1 : maxColors;
    let palette;
    if (colors.length === 0) {
        palette = [[0, 0, 0]];
    } else {
        palette = medianCut(colors, Math.max(1, slots));
    }
    return { palette, transparent };
}

function medianCut(pixels, maxColors) {
    let buckets = [pixels];
    while (buckets.length < maxColors) {
        // pick the bucket with the largest channel range
        let bestIdx = -1, bestRange = -1, bestChan = 0;
        for (let b = 0; b < buckets.length; b++) {
            const bucket = buckets[b];
            if (bucket.length < 2) continue;
            const min = [255, 255, 255], max = [0, 0, 0];
            for (const p of bucket) {
                for (let c = 0; c < 3; c++) {
                    if (p[c] < min[c]) min[c] = p[c];
                    if (p[c] > max[c]) max[c] = p[c];
                }
            }
            for (let c = 0; c < 3; c++) {
                const range = max[c] - min[c];
                if (range > bestRange) { bestRange = range; bestIdx = b; bestChan = c; }
            }
        }
        if (bestIdx < 0) break; // every bucket has <2 colors
        const bucket = buckets[bestIdx];
        bucket.sort((a, b) => a[bestChan] - b[bestChan]);
        const mid = bucket.length >> 1;
        buckets.splice(bestIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
    }
    return buckets.map((bucket) => {
        let r = 0, g = 0, b = 0;
        for (const p of bucket) { r += p[0]; g += p[1]; b += p[2]; }
        const k = Math.max(1, bucket.length);
        return [Math.round(r / k), Math.round(g / k), Math.round(b / k)];
    });
}

// Map every pixel to the nearest palette index (with transparency index).
function mapPixels(rgba, palette, transparentIndex) {
    const n = rgba.length / 4;
    const out = new Uint8Array(n);
    const cache = new Map();
    for (let i = 0; i < n; i++) {
        const a = rgba[i * 4 + 3];
        if (transparentIndex >= 0 && a < 128) { out[i] = transparentIndex; continue; }
        const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
        const key = (r << 16) | (g << 8) | b;
        let idx = cache.get(key);
        if (idx === undefined) {
            let best = 0, bestDist = Infinity;
            for (let p = 0; p < palette.length; p++) {
                const dr = r - palette[p][0], dg = g - palette[p][1], db = b - palette[p][2];
                const d = dr * dr + dg * dg + db * db;
                if (d < bestDist) { bestDist = d; best = p; if (d === 0) break; }
            }
            idx = best;
            cache.set(key, idx);
        }
        out[i] = idx;
    }
    return out;
}

// ─── GIF-LZW compression ──────────────────────────────────────────
// Returns a flat array of compressed bytes (not yet sub-blocked).
export function lzwEncode(indices, minCodeSize) {
    const clear = 1 << minCodeSize;
    const eoi = clear + 1;

    let codeSize = minCodeSize + 1;
    let dict = new Map();
    let next = eoi + 1;

    const out = [];
    let cur = 0, curBits = 0;
    const emit = (code) => {
        cur |= code << curBits;
        curBits += codeSize;
        while (curBits >= 8) { out.push(cur & 0xff); cur >>= 8; curBits -= 8; }
    };

    emit(clear);
    if (indices.length === 0) { emit(eoi); if (curBits > 0) out.push(cur & 0xff); return out; }

    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const key = (prefix << 8) | k;
        if (dict.has(key)) {
            prefix = dict.get(key);
        } else {
            emit(prefix);
            if (next < 4096) {
                dict.set(key, next);
                if (next === (1 << codeSize) && codeSize < 12) codeSize++;
                next++;
            } else {
                emit(clear);
                dict = new Map();
                next = eoi + 1;
                codeSize = minCodeSize + 1;
            }
            prefix = k;
        }
    }
    emit(prefix);
    emit(eoi);
    if (curBits > 0) out.push(cur & 0xff);
    return out;
}

// Write LZW bytes as GIF sub-blocks (≤255 bytes each, 0x00 terminator).
function writeSubBlocks(buf, data) {
    let off = 0;
    while (off < data.length) {
        const len = Math.min(255, data.length - off);
        buf.u8(len);
        for (let i = 0; i < len; i++) buf.u8(data[off + i]);
        off += len;
    }
    buf.u8(0); // block terminator
}

// ─── Main encoder ─────────────────────────────────────────────────
export function encodeGIF(frames, { width, height, loop = 0 } = {}) {
    const buf = new ByteBuf();

    // Header
    buf.str('GIF89a');

    // Logical Screen Descriptor (no global color table)
    buf.u16(width);
    buf.u16(height);
    buf.u8(0x70);  // GCT flag=0, color resolution=7
    buf.u8(0);     // background color index
    buf.u8(0);     // pixel aspect ratio

    // NETSCAPE2.0 looping extension
    buf.u8(0x21); buf.u8(0xff); buf.u8(0x0b);
    buf.str('NETSCAPE2.0');
    buf.u8(0x03); buf.u8(0x01);
    buf.u16(loop);  // 0 = infinite
    buf.u8(0x00);

    for (const frame of frames) {
        const { palette, transparent } = quantize(frame.data, 256);

        // Color-table size must be a power of two (>=2 entries)
        let bits = 1;
        const needed = palette.length + (transparent ? 1 : 0);
        while ((1 << bits) < needed) bits++;
        if (bits < 1) bits = 1;
        const tableLen = 1 << bits;
        const minCodeSize = Math.max(2, bits);

        const transparentIndex = transparent ? Math.min(tableLen - 1, palette.length) : -1;

        // Graphic Control Extension
        const delayCs = Math.max(1, Math.round((frame.delay || 100) / 10)); // centiseconds
        const disposal = transparent ? 2 : 1; // restore-to-bg vs do-not-dispose
        buf.u8(0x21); buf.u8(0xf9); buf.u8(0x04);
        buf.u8((disposal << 2) | (transparent ? 0x01 : 0x00));
        buf.u16(delayCs);
        buf.u8(transparent ? transparentIndex : 0);
        buf.u8(0x00);

        // Image Descriptor
        buf.u8(0x2c);
        buf.u16(0); buf.u16(0);          // left, top
        buf.u16(width); buf.u16(height); // w, h
        buf.u8(0x80 | (bits - 1));       // LCT flag=1, size = bits-1

        // Local Color Table (padded to tableLen)
        for (let i = 0; i < tableLen; i++) {
            const c = palette[i] || [0, 0, 0];
            buf.u8(c[0]); buf.u8(c[1]); buf.u8(c[2]);
        }

        // Image data
        const indices = mapPixels(frame.data, palette, transparentIndex);
        buf.u8(minCodeSize);
        const lzw = lzwEncode(indices, minCodeSize);
        writeSubBlocks(buf, lzw);
    }

    buf.u8(0x3b); // trailer
    return buf.toUint8();
}
