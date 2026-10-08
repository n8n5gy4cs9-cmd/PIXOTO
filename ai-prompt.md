# ai-prompt.md: how to run the performance refactor with DeepSeek V4 Pro

Run one phase per session so the context stays small. Phases are in `docs/PERF_PRD.json`: P0, P1, P2, P3, P4, P5, P6. Strict order. Start the next session with the same prompt and the next phase name.

The thinking-level names below are generic (medium / high / max). Map them to whatever DeepSeek offers.

## Prompt (paste as-is, replace PHASE)

```text
You are implementing the Pixoto performance refactor. Work autonomously, do not ask questions.

Read first, in this order: CLAUDE.md, docs/ai/PERF_AGENT_BRIEF.md, docs/PERF_PLAN.md, docs/PERF_PRD.json, docs/ai/PERF_REPO_FINDINGS.md, docs/ai/PERF_GLSL_SPEC.md, docs/ai/PERF_API_CONTRACTS.md.
Already written and syntax-checked, do not rewrite: app/core/scheduler.js, app/core/bufpool.js, app/core/gpu/context.js.

Your job now: do PHASE <P2 | P3 | ...> from docs/PERF_PRD.json, every task in it, in order.
Rules: static app/ folder, ES modules, no build, no servers, no running tests. Verify with `node --check` and by tracing the full path by reading code. Port maths line by line from the existing CPU files, never from memory. Keep public APIs of PreviewSession unchanged. Fall back to the CPU path if GPU fails. Core must not import ui.
When the phase is done: tick tasks.md ([x]/[ ] lines only), append to progress.md, update docs/FEATURES.md if user-visible, add new files to app/sw.js and bump its VERSION.
End with:
Files changed:
- file: summary
```

## Thinking level by task

| Task | Level | Why |
|---|---|---|
| P0 leftovers (settings flag), P6 docs, `sw.js` list | medium | Mechanical |
| P1.1 to P1.3 context, program cache, texture/FBO pools | medium | `app/core/gpu/context.js` is already written. The task is to review it against the PRD and fix gaps |
| P1.4 upload and readback round-trip (straight alpha, Y-flip) | **high** | Alpha and flip mistakes here break every later phase. Check it with an asymmetric, semi-transparent test image |
| P2.1 simple shaders (invert, threshold, posterize, desaturate, sepia, solarize, brightness/contrast, exposure) | medium | Direct ports |
| P2.2 levels, curves, gradient map tables | high | Lookup tables must match the CPU maths exactly |
| P2.3 hue/saturation, colour balance, black & white, vibrance | high | Long formulas, easy to drift by one |
| P2.4 3D LUT, trilinear in shader | **max** | Axis order and atlas layout errors are subtle |
| P3.1 `GpuLayerPipeline` | **max** | Core of the refactor: texture/FBO lifetime, flip and alpha bugs |
| P3.2 render override | high | Small edit, but touches `drawPixels`, `drawDistorted`, `effectsOf` |
| P3.3 `PreviewSession` rewrite | **max** | Highest regression risk: undo, cancel, masks, selections, stale results |
| P3.4 selection mix on GPU | high | |
| P3.5 tiled full-res commit | **max** | Overlap maths, seams |
| P3.6, P3.7 dialog wiring, adjustment layers | high | |
| P4.1 blur shaders | high | Alpha handling, large radii |
| P4.2 filter audit | medium | |
| P4.3 Camera Raw shader | **max** | Many stages that must match `cameraraw.js` |
| P4.4 CPU-only filters on release | medium | |
| P5.1 worker queue and transfers | high | Races, worker-failure fallback |
| P5.2 worker docs | medium | |
| P5.3 region-of-interest preview when zoomed in | high | |
| P6.1 to P6.4 polish | medium | |

Rule of thumb: max only for P2.4, P3.1, P3.3, P3.5 and P4.3. High for state, concurrency or exact numeric parity. Medium for everything else.

## After P3

Start a fresh session and ask it to review P2 and P3 against the parity rules in `docs/ai/PERF_GLSL_SPEC.md` at max. Mistakes there are the most expensive to find later.

## Manual checks you do after each phase (no tests are run for you)

- Drag every adjustment slider on a large photo: smooth, no stutter.
- OK, Cancel, Undo, Redo after an edit.
- Edit with a selection active, on a layer mask, and on a semi-transparent layer.
- Zoom out and zoom in during a preview.
- Turn the GPU off (`localStorage.setItem('pixoto.gpu','off')`, once P0.3 exists) and confirm the CPU fallback works.
