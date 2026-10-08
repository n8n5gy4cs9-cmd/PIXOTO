// Coalesces rapid calls (slider input events) into one run per animation frame with the latest arguments.
// A run never starts while the previous one (possibly async) is still going.
export function createCoalescer(fn) {
  let args = null, queued = false, busy = false, dead = false, waiters = [];
  const settle = () => { if (!queued && !busy) { const w = waiters; waiters = []; w.forEach((f) => f()); } };
  const tick = async () => {
    queued = false;
    if (dead) { args = null; settle(); return; }
    if (busy) { schedule(); return; }
    if (!args) { settle(); return; }
    const a = args; args = null; busy = true;
    try { await fn(...a); } catch (e) { console.warn(e); }
    busy = false;
    if (args && !dead) schedule(); else settle();
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(tick); } };
  const push = (...a) => { if (dead) return; args = a; schedule(); };
  push.idle = () => (queued || busy ? new Promise((res) => waiters.push(res)) : Promise.resolve());
  push.cancel = () => { dead = true; args = null; settle(); };
  return push;
}

// Preview proxy size: never upscaled, fits the viewport in device pixels and a pixel-area cap (default 1080p).
export function pickPreviewSize(lw, lh, vw, vh, dpr = 1, cap = 1920 * 1080) {
  let s = Math.min(1, (vw * dpr) / lw, (vh * dpr) / lh);
  if (lw * lh * s * s > cap) s = Math.sqrt(cap / (lw * lh));
  return { w: Math.max(1, Math.round(lw * s)), h: Math.max(1, Math.round(lh * s)), scale: s };
}
