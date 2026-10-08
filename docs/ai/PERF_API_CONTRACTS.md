# API contracts and reference skeletons

Skeletons show shape and the performance-critical idioms; fill details from the existing code. Keep style dense.

## app/core/scheduler.js
```js
// One run per animation frame, latest args win, never overlaps the previous (possibly async) run.
export function createCoalescer(fn) {
  let args, queued = false, busy = false, dead = false;
  const tick = async () => {
    queued = false;
    if (dead) return;
    if (busy) { schedule(); return; }
    busy = true; const a = args;
    try { await fn(...a); } finally { busy = false; }
  };
  const schedule = () => { if (!queued && !dead) { queued = true; requestAnimationFrame(tick); } };
  const push = (...a) => { args = a; schedule(); };
  push.flush = async () => { dead = false; if (args) { while (busy) await new Promise(requestAnimationFrame); busy = true; try { await fn(...args); } finally { busy = false; } } };
  push.cancel = () => { dead = true; };
  return push;
}
// Proxy size: never upscale, fit viewport device pixels and a pixel-area cap.
export function pickPreviewSize(lw, lh, vw, vh, dpr, cap = 1920 * 1080) {
  let s = Math.min(1, (vw * dpr) / lw, (vh * dpr) / lh);
  if (lw * lh * s * s > cap) s = Math.sqrt(cap / (lw * lh));
  return { w: Math.max(1, Math.round(lw * s)), h: Math.max(1, Math.round(lh * s)), scale: s };
}
```
`flush` must be callable after `cancel` only within a single session; simplify if it complicates (keep `push`, `cancel`, and a promise-returning `idle()`).

## app/core/bufpool.js
```js
const pool = new Map();   // key `${kind}:${w}x${h}` -> array of free objects
export function acquireImageData(w, h) { const k = `i:${w}x${h}`, l = pool.get(k); return (l && l.pop()) || new ImageData(w, h); }
export function releaseImageData(img) { const k = `i:${img.width}x${img.height}`; (pool.get(k) || pool.set(k, []).get(k)).push(img); }
export function acquireBytes(n) { const k = `b:${n}`, l = pool.get(k); return (l && l.pop()) || new Uint8ClampedArray(n); }
export function releaseBytes(a) { const k = `b:${a.length}`; (pool.get(k) || pool.set(k, []).get(k)).push(a); }
export const clearPool = () => pool.clear();   // call when the document closes; cap list length at 3 per key
```

## app/core/gpu/context.js
```js
let gl = null, canvas = null, dead = false, caps = null;
const programs = new Map(), freeTex = new Map(), freeFbo = [];
export function isGpuAvailable() { return !!getGl(); }
export function getGl() {
  if (dead) return null;
  if (gl) return gl;
  try {
    canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) return null;
    caps = { maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), halfFloat: !!gl.getExtension('EXT_color_buffer_half_float') || !!gl.getExtension('EXT_color_buffer_float') };
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); dead = true; gl = null; programs.clear(); freeTex.clear(); freeFbo.length = 0; });
  } catch { gl = null; }
  return gl;
}
export const gpuCaps = () => (getGl(), caps);
export const gpuCanvas = () => (getGl(), canvas);
export function program(name, frag) { /* compile VERT + frag once, cache by name, throw Error(log) on failure; return { prog, uni(name) cached getUniformLocation } */ }
export function texture(w, h, fmt = 'rgba8') { /* pop from freeTex[`${fmt}:${w}x${h}`] or create with NEAREST/CLAMP; texStorage2D immutable */ }
export function release(tex, w, h, fmt = 'rgba8') { /* push to freeTex, cap 4 per key */ }
export function fbo(tex) { /* reuse a framebuffer object from freeFbo; framebufferTexture2D(tex) */ }
export function upload(tex, source, w, h) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, source);   // source: canvas, ImageBitmap or Uint8Array
}
export function drawFullscreen(p, target /* fbo or null */, w, h) { /* bind, viewport, gl.drawArrays(gl.TRIANGLES, 0, 3) with an empty VAO bound */ }
export function readPixels(fboOrNull, w, h, out /* pooled Uint8Array/Uint8ClampedArray */) { gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out); }
```
Texture-flip convention and exact attribute defaults must be verified in code review against `PERF_GLSL_SPEC.md`.

## app/core/gpu/adjust-gpu.js
```js
export function canRunOnGpu(adj) -> { preview: boolean, commit: boolean }   // grain/addNoise: { preview:true, commit:false }
export function setupAdjustment(adj) -> { name, frag, bind(gl, prog, uni) }   // pure; picks shader + uniform packer
// Draws src texture -> target fbo (null = default canvas) using the adjustment. Allocation-free after the first call per type.
export function drawAdjustment(adj, srcTex, targetFbo, w, h, { selTex = null } = {})
```
Levels, curves, gradientMap tables are built with the exact CPU helper from `adjust.js` (export it if it is private) and uploaded with `texSubImage2D` into a persistent 256x1 texture.

## app/core/gpu/pipeline.js
```js
export class GpuLayerPipeline {
  // source: layer canvas; proxy size {w,h}; selection plane (Uint8Array coverage at layer res) or null
  static create(sourceCanvas, size, selection) -> GpuLayerPipeline | null   // null => caller uses CPU path
  get canvas()                  // proxy output canvas (a normal 2D canvas, created once, drawImage'd from GL canvas)
  render(adjustmentOrFilter)    // one tick; no allocation
  showOriginal()
  async commitFull(adjustmentOrFilter, fullSourceCanvas) -> HTMLCanvasElement   // full-res pass; tiles if needed; allocates once
  dispose()
}
```
Proxy creation: `drawImage(layer.canvas, 0, 0, w, h)` onto a pooled 2D canvas with `imageSmoothingQuality='high'`, then upload to the source texture once. Output: after `drawFullscreen` to the GL canvas sized `w x h`, `proxyCtx.clearRect; proxyCtx.drawImage(glCanvas, 0, 0)`.

## PreviewSession new/changed API (backwards compatible)
```js
static begin(doc, name, opts)         // builds proxy + pipeline lazily on first update
update(op, args)                      // GPU if canRunOnGpu, else CPU worker on the proxy (latest-wins)
liveUpdater(op)                       // createCoalescer((args) => this.update(op, args))
adjust(adjustment)                    // kept: calls update('adjust', ...)
filter(id, params, env)               // kept
showOriginal()                        // kept
commit()                              // full-res pass (GPU commit or CPU worker), one history step, clears layer.preview, disposes
cancel()                              // clears layer.preview, disposes, doc.cancel()
```
`applyAdjustmentNow` / `applyFilterNow` use the full-res path directly (no proxy).

## Compositor override (render.js)
```js
const src = layer.preview ? layer.preview.canvas : layer.canvas;
const m   = layer.preview ? layer.preview.matrix : layer.matrix;
```
Apply in every place that draws `layer.canvas` for display (find with grep). `layer.preview.matrix = layer.matrix` scaled by `(layerW / proxyW, layerH / proxyH)` applied in layer-local space (use `geom.js` helpers; confirm multiplication order from `layer.matrix` construction in `model.js`).

## compute.js changes (CPU path)
- `compute(op, args, buffer, { key })`: when `key` is given, a newer call with the same key replaces a not-yet-started job, and a result for a superseded job is dropped (reject with `{stale:true}` swallowed by the caller).
- Transfer: `w.postMessage({id, op, args, buffer}, [buffer])`. Keep the main-thread fallback by posting a copy only on the first call, or on `worker.onerror` re-create from the retained source (the session holds `image.data`, so it can re-send). Prefer: retain nothing, and on failure rerun from the session's own copy.
- Ring buffers: session owns `bufA`, `bufB`; send A, receive A back, reuse.
