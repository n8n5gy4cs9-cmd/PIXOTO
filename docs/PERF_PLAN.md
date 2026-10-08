# PERF_PLAN: real-time filters and adjustments (GPU, proxy preview, workers, memory)

Status: planned, not started. Tracking is in `tasks.md` (section "Performance"). Machine-readable spec is in `docs/PERF_PRD.json`. AI implementer docs are in `docs/ai/`.

## 1. Root causes (verified by reading the code)

All live edits go through `app/core/ops/preview.js` (`PreviewSession`). On every slider `input` event:

| # | Cause | Where | Cost |
|---|-------|-------|------|
| R1 | Full-resolution layer is processed on every tick (a 24 MP photo is about 96 MB RGBA). | `PreviewSession.run` sends `image.width x image.height` | Linear in megapixels; the preview needs only about 2 MP |
| R2 | The whole `image.data` is copied each tick: `new Uint8ClampedArray(this.image.data).buffer`. | `preview.js` `run()` | About 96 MB allocation plus memcpy per tick, GC pressure |
| R3 | Worker structured-clone copy of that buffer in `compute()` (`w.postMessage` without a transfer list), then the result is transferred back. | `core/compute.js` | A second 96 MB copy |
| R4 | Pure-CPU per-pixel loops in JS (`applyAdjustment`, `runFilter`, `gaussianBlur`, Camera Raw). | `core/filters/*.js` | Tens to hundreds of ms per 24 MP image |
| R5 | `new ImageData(...)`, `makeCanvas(w,h)` plus `putData` on every result; `mixBySelection` loops over all pixels on the main thread; `imageToMask`/`maskToImage` allocate per tick. | `preview.js` `show()` | Allocation plus an upload of the full image per tick |
| R6 | `layer.canvas` is replaced by a brand-new canvas each tick, so the compositor re-rasterises the full image and drops the old backing store. | `preview.js` `show()` | GC churn, canvas backing-store allocation |
| R7 | No coalescing. `seq` discards stale results, but every `input` event still starts a job, and jobs queue behind each other in one worker. | `fieldRow` in `ui/live-dialog.js`, `PreviewSession.run` | The worker backlog grows during a drag |
| R8 | Camera Raw dialog does its own `putImageData`/CPU path. | `ui/camera-raw-dialog.js:74` | Same as R4 |

Conclusion: the architecture (preview session, undo on commit, worker) is sound. The bottleneck is "full-res CPU work plus 2 to 3 full copies per tick". The fix keeps `PreviewSession` as the single entry point and swaps its engine.

## 2. Target architecture

```
slider input -> rAF coalescer (latest value wins)
             -> PreviewSession.update(op, args)
                 |- GPU path (WebGL2): proxy texture -> shader pass(es) -> proxy canvas   [every tick, ~1-3 ms]
                 |- CPU path (worker): proxy RGBA buffer -> compute worker -> proxy canvas [fallback / unsupported ops]
             -> doc shows proxy through a layer "preview override" (render.js)
slider release / OK -> PreviewSession.commit()
                 |- GPU full-res pass (tiled when larger than MAX_TEXTURE_SIZE) or CPU worker
                 |- one history step, layer.canvas replaced once
```

### 2.1 Modules (new files in bold)

- **`app/core/gpu/context.js`** WebGL2 singleton on an `OffscreenCanvas` (fallback to `HTMLCanvasElement`). Texture pool, framebuffer pool, program cache, `contextlost` / `contextrestored` handling, `isGpuAvailable()`.
- **`app/core/gpu/shaders.js`** GLSL ES 3.00 sources (fullscreen-triangle vertex shader and one fragment shader per adjustment/filter). Pure strings, no DOM.
- **`app/core/gpu/adjust-gpu.js`** `canRunOnGpu(adjustment)`, `runAdjustmentGpu(adjustment, src, dst, opts)`; uniform packing, LUT textures (curves, levels, 3D LUT), multi-pass blur.
- **`app/core/gpu/filter-gpu.js`** GPU versions of the filters that are worth it (blur family, sharpen, noise, vignette, pixelate, etc., chosen in phase 4 from `core/filters/filters.js`).
- **`app/core/gpu/pipeline.js`** `GpuLayerPipeline`: owns the source texture, ping-pong FBOs, selection-mask texture and the output canvas for one `PreviewSession`. Reuses everything between ticks.
- **`app/core/scheduler.js`** `createCoalescer(fn)` (one run per animation frame, latest args win, never more than one job in flight) and `pickPreviewSize(layerW, layerH, viewW, viewH, dpr, cap)`.
- **`app/core/bufpool.js`** Typed-array and `ArrayBuffer` pool keyed by byteLength, for the CPU path.
- Modified: `core/ops/preview.js`, `core/compute.js`, `workers/compute.worker.js`, `core/render.js` (preview override), `core/pixels.js` (reuse helpers), `ui/live-dialog.js` (coalesced `onInput`, `onCommitInput` for pointer release), `ui/adjust-dialogs.js`, `ui/tool-dialogs.js`, `ui/camera-raw-dialog.js`, `sw.js` (cache the new files), docs.

Core stays DOM-free except `gpu/context.js`, which may create a canvas through `OffscreenCanvas` or `document.createElement` guarded by a feature test (acceptable: the Composa-style `pixels.js` already creates canvases in core). Core must not import from `ui`.

### 2.2 Key decisions (defaults, so nobody has to ask)

1. **WebGL2, not WebGPU.** Universal Safari/iOS/Chrome/Firefox support, no secure-context quirks on shared hosting, simpler. WebGPU stays out of scope (documented in `docs/PLAN.md`).
2. **GPU runs on the main thread** with an `OffscreenCanvas` (draw calls are async and cheap; the main thread only issues commands). The worker keeps all CPU work. Moving WebGL into a worker is optional phase 6 and only if profiling shows main-thread stalls from texture uploads.
3. **Preview = proxy.** Size is `min(layer size, viewport device pixels, 1920x1080-equivalent area cap)`, never upscaled. Rebuilt on dialog open, and when zoom or viewport changes by more than 1.5x. The proxy is made by a GPU downscale (or `drawImage` with `imageSmoothingQuality='high'`) of `layer.canvas`.
4. **Full-res only on commit** (OK / pointer release when the user expects exact pixels). Intermediate drag ticks never touch the full image.
5. **Exactness policy.** Deterministic per-pixel adjustments must match the CPU result within 1/255 (see `docs/ai/PERF_GLSL_SPEC.md`). Random operations (grain, addNoise) preview on the GPU with an approximate hash, but **commit runs on the CPU worker** so saved results and old documents stay identical. Anything not ported stays on the CPU worker, running on the proxy during preview.
6. **Straight vs premultiplied alpha.** CPU code works on straight RGBA from `getImageData`. GPU upload must keep straight alpha: `UNPACK_PREMULTIPLY_ALPHA_WEBGL=false`, and output with `premultipliedAlpha:false` context attributes. Verify with a semi-transparent layer, as in Composa's tests.
7. **Colour space.** `UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE`. Do the maths on gamma-encoded values exactly like the CPU code.
8. **Selection mixing** (`mixBySelection`) moves into the shader: the selection coverage plane is uploaded once as an `R8` texture; `mix(original, result, coverage)`.
9. **Layer masks** (`this.mask` branch) stay on the CPU path (small, single channel) unless profiling says otherwise.
10. **Fallback chain:** GPU -> CPU worker -> inline main thread. A GPU failure (no WebGL2, context lost, shader compile error, texture too large) is caught, logged to console once, and the session silently continues on the CPU path. The app must never break because the GPU path failed.

### 2.3 Memory rules

- One `GpuLayerPipeline` per session: allocate textures/FBOs once; resize only when the proxy size changes; delete in `close()`.
- Never call `new ImageData` or `getImageData` inside the tick path. Reuse one `Uint8ClampedArray` plus one `ImageData` per proxy size (`bufpool.js`).
- The CPU worker path transfers (not copies) buffers. Keep a pool of two proxy-size buffers in a ring: main sends A, worker returns A, main reuses it. The proxy is about 8 MB, so copies are cheap, but the ring keeps allocations at zero.
- Full-res commit allocates once per commit, not per tick.
- The preview canvas is created once and drawn into; `layer.canvas` is not swapped per tick (see 2.4).

### 2.4 Render integration

`doc.invalidate(rect)` triggers a recomposite in `core/render.js`. Add an optional `layer.preview = { canvas, matrix }` override that the compositor uses instead of `layer.canvas`/`layer.matrix` while a session is open (matrix = layer matrix scaled by `layerW / proxyW`). `PreviewSession.commit()` clears the override. `cancel()` clears the override and the document is untouched, because the original `layer.canvas` was never modified. This removes R6 and makes cancel free. Code that reads `layer.canvas` elsewhere (thumbnails, hit-testing) keeps working on the original during the preview, which is acceptable.

Check both zoom regimes: zoomed out (smoothing on) and zoomed in (nearest-neighbour). A proxy smaller than the layer looks soft when zoomed in; handle it in phase 5 (ROI preview: when the zoom is above 100%, build the proxy from the visible crop at 1:1 device resolution).

### 2.5 Slider hook-up (what the UI does)

`fieldRow` in `ui/live-dialog.js` fires `onInput()` on each `input` event. Keep that API, and put the coalescing in the session:

```js
// in a tool/adjust dialog
const session = PreviewSession.begin(doc, name);          // builds proxy + GPU pipeline once
const preview = session.liveUpdater('adjust');            // = createCoalescer((adj) => session.update('adjust', { adjustment: adj }))
liveDialog({
  ...,
  onInput: () => preview(holder.adj),                     // called per slider tick; cheap, coalesced to 1 per frame
});
// OK: await session.commit();  Cancel: session.cancel();
```

`session.update()` renders on the GPU into the proxy canvas and calls `doc.invalidate()` once. `commit()` runs the full-resolution pass exactly once. `fieldRow` itself needs no change except an optional `onChange` (fired on `change`/pointerup) for expensive CPU-only filters that should render only on release (see `PERF_PRD.json` `slider.releaseOnly`).

## 3. Phases (each ends in a self-consistent, working app)

0. **Baseline and plumbing** (scheduler, bufpool, flags, no behaviour change).
1. **GPU core** (context, program cache, textures, FBO pool, fullscreen pass, readback helpers).
2. **GPU adjustments** (every per-pixel adjustment type, exact-parity shaders, LUT textures).
3. **Proxy preview pipeline** (`PreviewSession` rewrite, render override, commit full-res, selection-mix on GPU).
4. **GPU blurs and filters** (separable Gaussian, motion blur, sharpen, other cheap filters from `filters.js`, Camera Raw pass).
5. **Worker hardening** (latest-wins queue, transferable ring, proxy-size CPU preview, cancel in flight, ROI preview when zoomed in).
6. **Polish** (service-worker cache list, feature flag/setting `Performance > GPU acceleration`, docs, FEATURES.md, help page note, optional GPU-in-worker).

Order matters: 1 -> 2 -> 3 gives the biggest visible win (Brightness/Contrast, Levels, Curves, Hue/Sat, LUT become instant). Do not start 4 before 3 is complete.

## 4. Risks and mitigations

- **Parity drift between GLSL and JS.** Mitigation: port formulas line by line from `core/filters/adjust.js` into `PERF_GLSL_SPEC.md` tables first; add a dev-only `?gpuparity` console function that runs both paths on a test canvas and logs max/mean abs difference (no test runner exists; this is a manual check).
- **iOS Safari WebGL2 limits** (`MAX_TEXTURE_SIZE` 4096-16384, float textures not renderable without `EXT_color_buffer_float`). Use `RGBA8` everywhere; use `RGBA16F` ping-pong only if `EXT_color_buffer_half_float` exists; otherwise RGBA8 with a documented quality note for multi-pass blur.
- **Huge layers** over `MAX_TEXTURE_SIZE`: tile the commit pass (with an overlap equal to `samplingMargin(adjustment)` for blurs), or fall back to the CPU worker.
- **Context loss:** listen for `webglcontextlost`; mark the pipeline dead; the session falls back to CPU for the rest of its life; recreate the context lazily next session.
- **Shared hosting:** no new MIME types are needed; no SharedArrayBuffer (needs COOP/COEP headers, which we do not control), so use transferables only.

## 5. Definition of done

- Dragging any adjustment slider on a 24 MP photo on an M1 Max stays at 60 fps (frame time under 16 ms; GPU tick under 4 ms at the proxy size).
- Commit result equals the old CPU result within 1/255 for deterministic ops; identical for CPU-committed ops.
- Undo/redo, cancel, selection-masked edits, mask editing, adjustment layers and Camera Raw behave as before.
- Works with the GPU path disabled (fallback) and from any sub-folder, with no remote dependencies.
- `tasks.md`, `progress.md`, `docs/FEATURES.md` and `docs/PLAN.md` §5 updated; `sw.js` precache includes the new files.
