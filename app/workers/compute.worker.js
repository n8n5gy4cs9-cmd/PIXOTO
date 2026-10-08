// Heavy pixel work off the main thread: filters, adjustments, content-aware fill, selections from the picture.
// CPU-only by design: the GPU preview path runs on the main thread (see docs/PERF_PLAN.md §2.2). OffscreenCanvas decode
// would help only the image-import resize, which lives in io/files.js, so it is left there (optional future work).
import { runFilter } from '../core/filters/filters.js';
import { applyAdjustment } from '../core/filters/adjust.js';
import { inpaint } from '../core/paint/inpaint.js';
import { wandPlane, objectPlane, subjectPlane } from '../core/select/wand.js';

const handlers = {
  filter: ({ id, params, w, h, env }, buf) => { const r = runFilter(id, params, new Uint8ClampedArray(buf), w, h, env); return { result: { w: r.w, h: r.h, growX: r.growX, growY: r.growY }, buffers: [r.data.buffer], out: r.data.buffer }; },
  adjust: ({ adjustment, w, h, ox, oy, step }, buf) => { const d = new Uint8ClampedArray(buf); applyAdjustment(adjustment, d, w, h, ox, oy, step); return { result: {}, out: d.buffer }; },
  inpaint: ({ w, h, mask }, buf) => { const r = inpaint(new Uint8ClampedArray(buf), new Uint8Array(mask), w, h); return { result: {}, out: r.buffer }; },
  wand: ({ w, h, x, y, tolerance, contiguous }, buf) => { const p = wandPlane(new Uint8ClampedArray(buf), w, h, x, y, tolerance, contiguous); return { result: {}, out: p.buffer }; },
  object: ({ w, h, x, y, edge }, buf) => { const p = objectPlane(new Uint8ClampedArray(buf), w, h, x, y, edge); return { result: { empty: !p }, out: p ? p.buffer : new ArrayBuffer(0) }; },
  subject: ({ w, h }, buf) => { const p = subjectPlane(new Uint8ClampedArray(buf), w, h); return { result: { empty: !p }, out: p ? p.buffer : new ArrayBuffer(0) }; },
};
self.onmessage = (e) => {
  const { id, op, args, buffer } = e.data;
  try { const r = handlers[op](args, buffer); self.postMessage({ id, result: r.result, buffer: r.out }, [r.out]); }
  catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
