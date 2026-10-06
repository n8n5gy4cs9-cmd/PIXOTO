// Runs heavy pixel work in a worker (falling back to the main thread where workers are unavailable), so the UI never
// freezes on a filter. `compute(op, args, buffer)` resolves { result, buffer }. Buffers are transferred, so pass copies.
import { runFilter } from './filters/filters.js';
import { applyAdjustment } from './filters/adjust.js';
import { inpaint } from './paint/inpaint.js';
import { wandPlane, objectPlane, subjectPlane } from './select/wand.js';

let worker = null, failed = false, nextId = 1;
const pending = new Map();

function spawn() {
  if (worker || failed) return worker;
  try {
    worker = new Worker(new URL('../workers/compute.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id); if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve({ result: e.data.result, buffer: e.data.buffer });
    };
    worker.onerror = () => {
      failed = true; worker = null;
      const jobs = [...pending.values()]; pending.clear();
      for (const p of jobs) p.rerun();
    };
  } catch { failed = true; worker = null; }
  return worker;
}

function inline(op, args, buffer) {
  switch (op) {
    case 'filter': { const r = runFilter(args.id, args.params, new Uint8ClampedArray(buffer), args.w, args.h, args.env); return { result: { w: r.w, h: r.h, growX: r.growX, growY: r.growY }, buffer: r.data.buffer }; }
    case 'adjust': { const d = new Uint8ClampedArray(buffer); applyAdjustment(args.adjustment, d, args.w, args.h, args.ox, args.oy, args.step); return { result: {}, buffer: d.buffer }; }
    case 'inpaint': return { result: {}, buffer: inpaint(new Uint8ClampedArray(buffer), new Uint8Array(args.mask), args.w, args.h).buffer };
    case 'wand': return { result: {}, buffer: wandPlane(new Uint8ClampedArray(buffer), args.w, args.h, args.x, args.y, args.tolerance, args.contiguous).buffer };
    case 'object': { const p = objectPlane(new Uint8ClampedArray(buffer), args.w, args.h, args.x, args.y, args.edge); return { result: { empty: !p }, buffer: p ? p.buffer : new ArrayBuffer(0) }; }
    case 'subject': { const p = subjectPlane(new Uint8ClampedArray(buffer), args.w, args.h); return { result: { empty: !p }, buffer: p ? p.buffer : new ArrayBuffer(0) }; }
  }
  throw new Error('Unknown operation ' + op);
}

export function compute(op, args, buffer) {
  const w = spawn();
  return new Promise((resolve, reject) => {
    const run = () => setTimeout(() => { try { resolve(inline(op, args, buffer)); } catch (e) { reject(e); } }, 0);
    if (!w) { run(); return; }
    const id = nextId++;
    // The buffer is copied (not transferred) so the main thread can still run the job if the worker cannot load.
    pending.set(id, { resolve, reject, rerun: run });
    w.postMessage({ id, op, args, buffer });
  });
}
