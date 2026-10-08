# Agent brief: Pixoto performance refactor (for DeepSeek V4 Pro or any coding model)

Read in this order, and nothing else until you need it: this file, `docs/PERF_PLAN.md`, `docs/PERF_PRD.json`, `docs/ai/PERF_GLSL_SPEC.md`, `docs/ai/PERF_API_CONTRACTS.md`, `CLAUDE.md`. Greet the user as "Crowelian".

## Rules (from CLAUDE.md, restated)
- Static folder `app/`. ES modules, `.js` extensions, relative paths, no npm/CDN/build, no servers, no tests runnable. Verify with `node --check file.js` and by reading the whole data path.
- `core` must not import `ui`. All shortcuts/menu items go through `core/commands.js`.
- Concise code, no comment noise, no dead code. Match the style of `core/ops/preview.js` (dense, short names).
- Move deleted code to `BACKUP/`, never delete.
- After each phase: tick `tasks.md` (only `[x]`/`[ ]` lines), append to `progress.md`, update `docs/FEATURES.md` when user-visible.
- End the final message with `Files changed:` list.

## Files you must read fully before editing
`app/core/ops/preview.js`, `app/core/compute.js`, `app/workers/compute.worker.js`, `app/core/filters/adjust.js` (all maths to port), `app/core/filters/lut.js`, `app/core/render.js`, `app/core/pixels.js`, `app/core/ops/pixels.js` (`mixBySelection`, `selectionInTargetSpace`), `app/ui/live-dialog.js`, `app/ui/adjust-dialogs.js`, `app/ui/tool-dialogs.js`, `app/ui/camera-raw-dialog.js`, `app/core/filters/filters.js`, `app/sw.js`.
Find every caller of `PreviewSession` with `grep -rn "PreviewSession\|applyAdjustmentNow\|applyFilterNow" app`.

## Work loop per task
1. Read the PRD task and acceptance line.
2. Search `app/` for existing code to reuse.
3. Port formulas from the CPU file line by line (never rewrite maths from memory).
4. Write the code; run `node --check` on each new file (module files with `import` are fine for `--check`).
5. Trace the path: slider -> `fieldRow` -> `onInput` -> coalescer -> `session.update` -> GPU -> proxy canvas -> `layer.preview` -> compositor -> screen; then commit: `commit()` -> full-res -> `doc.commit()` history -> `layer.preview = null`.
6. Tick tasks, log progress.

## Phase order is strict: P0, P1, P2, P3, P4, P5, P6. After P3 the app must already be fully working with the new pipeline.

## Pitfalls checklist
- Straight alpha only; set `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)` and `UNPACK_COLORSPACE_CONVERSION_WEBGL` to `gl.NONE` before every upload. Create context with `{ alpha:true, premultipliedAlpha:false, antialias:false, depth:false, stencil:false, preserveDrawingBuffer:true, powerPreference:'high-performance' }`.
- WebGL texture Y is flipped relative to canvas. Pick ONE convention: upload with `UNPACK_FLIP_Y_WEBGL=false` and flip in the vertex shader uv (`v_uv.y = 1.0 - ...`), or flip on readback. Verify with an asymmetric image.
- `texImage2D` from a canvas that holds premultiplied data: browsers un-premultiply when `UNPACK_PREMULTIPLY_ALPHA_WEBGL=false`; this loses precision on low-alpha pixels exactly like `getImageData`. Accepted.
- Filtering: `NEAREST` for source/LUT-index textures; `LINEAR` only where the shader expects it (3D LUT is trilinear by hand).
- Rounding: CPU stores `Uint8ClampedArray` (round half to even). In GLSL output `vec4` in 0..1; the RGBA8 framebuffer rounds to nearest. Compute in 0..255 domain when the CPU code does integer maths (`floor`, `|0`) and divide by 255 at the end; see the spec.
- Reading results back to a 2D canvas: `ctx2d.drawImage(glCanvas, ...)` is the fast path (GPU to GPU in Chromium/Safari). Use `readPixels` only for CPU hand-off or tiled commit.
- Never leave GL state bound across sessions; each `gpu` call binds what it needs.
- Dispose: `pipeline.dispose()` in `commit` and `cancel`; delete textures obtained from the pool via `release`, not `deleteTexture` directly.
- `PreviewSession.seq` stale-result logic must survive: with GPU there is no async, but CPU fallback is async.
- `isIdentity(adjustment)` must short-circuit (show original) as before.
- Do not change the stored document format or the adjustment-object shapes.
- Service worker: add new files to its asset list (open `app/sw.js` to see the format) and bump its cache version.

## Prompt snippets for sub-tasks (copy into your own plan)
- "Port `<type>` from `core/filters/adjust.js` `applyAdjustment` to a fragment shader. Keep integer rounding behaviour. Uniforms: list. Return GLSL string and a `pack(adj)` function."
- "Rewrite `PreviewSession.run/show/commit` to use `GpuLayerPipeline` with CPU worker fallback, keep public API."

## When unsure
Choose the default in `PERF_PLAN.md` §2.2, note it in `progress.md`, continue. Do not ask the user.
