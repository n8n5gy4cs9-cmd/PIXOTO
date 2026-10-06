# Pixoto — Update Build Prompt

> Executable plan to bring Pixoto to Photoshop / Photopea depth.
> Companion to the **PARITY ROADMAP** in `progress.md` (feature IDs P1–P11, bugs BH-01…BH-14, systems SYS-1…SYS-10).
> Greet the user as **Crowelian**.

---

## Ground Rules (from CLAUDE.md — do not skip)

1. **Search first:** existing Pixoto code → PixiEditor source (`TEMP_TO_BE_REMOVED/PixiEditor-master`) → invent only if neither solves it. Read `PIXIEDITOR_AI_HELPER.md` before touching PixiEditor source.
2. **Plan before editing.** State what changes, files touched, why, risks. Ask *"Does this plan look correct before I proceed?"* and wait for approval.
3. **Phase large work.** If a task touches >2 files, adds a system, or exceeds ~30 lines, split into phases and require approval between phases.
4. **Ask first** before: deleting >20 lines, removing systems/functions, renaming shared symbols, architecture changes, adding a dependency, or touching >3 files.
5. **Read target files before writing.** Never assume architecture.
6. **Coordinates:** always `engine.screenToCanvas(clientX, clientY)`. Never manual conversion.
7. **Pointer Events only** (`pointerdown/move/up`). Never `mouse*`. Canvas needs `touch-action: none`.
8. **Both render modes must work:** Photo (`imageSmoothingEnabled = true`) and Pixel (`= false`). Verify smoothing, transforms, zoom, grid, brush + selection rendering.
9. **Mobile first.** Must work on mobile, tablet, desktop, installed PWA. 44px touch targets.
10. **No build step / no CDN / no runtime downloads.** Vendor every dependency locally and document why.
11. **Never run servers.** The user (Crowelian) tests manually.
12. **After every change:** update `progress.md` + `docs/FEATURES.md`, bump `sw.js` cache version, and end the response with a `Files changed:` summary.
13. **Bug not fixed until traced:** Input → Event → Tool → State → Render → Output.

---

## Execution Order

Do them top-to-bottom. Each is its own approval gate.

### Stage 0 — Bughunt quick wins (safety, cheap, do first)
- **BH-09 / SYS-3:** finish color single-source-of-truth; delete duplicated converters in `tools/brush.js`, `tools/eyedropper.js`, `pixel-engine.js` → import from `ui/color-utils.js`.
- **BH-12 / SYS-9:** add inline `touch-action: none` on all canvases.
- **BH-11 / SYS-6:** auto-generate SW cache list from a module manifest.
- **BH-10:** pixelate uses `engine.docWidth/docHeight`, not `layer.canvas.width`.
- **BH-13:** confirm flood fill is truly scanline; cap stack if not.
- Re-verify **BH-04** (mobile layer reorder) and **BH-06** (color-picker listeners) — fix if still open.
- **Acceptance:** undo works for every stroke; no console errors; mobile layer reorder works by touch; no duplicated color helpers remain.

### Stage 1 — Core systems that unblock features
- **SYS-2 (event bus):** replace single-callback props (`onLayerChange`, `onActiveLayerChange`, …) with a minimal multi-subscriber emitter. Fixes **BH-05**. Keep old callback names working as thin wrappers during migration.
- **SYS-1 (IndexedDB):** move auto-save + recovery off localStorage; remove the 4MB silent-drop (**BH-07**). Warn the user only on real failure.
- **SYS-4 (command/shortcut registry):** one map of `{id, label, shortcut, run, menu}` feeding desktop menus + mobile drawer. Foundation for remapping + future command palette.
- **Acceptance:** layers panel, history, file manager all receive layer events; large projects auto-save & restore; every existing menu action routes through the registry with identical behavior.

### Stage 2 — P1: Open / Place Image as Layer  🔴 (the reported gap)
**Goal:** add an image into the **current** document as a new layer, **fit to canvas keeping aspect ratio**, then enter Free Transform. Plus drag-drop and clipboard paste.

**Plan:**
- Add `File ▸ Place Image…` (`data-action="place-image"`) to desktop dropdown + mobile drawer; wire to `fileManager.openImage(file, true)`.
- Rewrite the `asNewLayer` branch in `file-manager.js`: compute `scale = min(docW/imgW, docH/imgH)`, center the image, draw scaled with correct smoothing per mode. Do **not** upscale past native size unless the user picks "fill".
- After placing, activate `tools/transform.js` on the new layer so the user can adjust before commit.
- If a document already exists, show a small chooser: **Open as New Project** vs **Place as Layer** (remember choice).
- Drag-and-drop: `dragover`/`drop` on `#canvas-viewport` → place as layer.
- Clipboard: Ctrl+V tries external image via `navigator.clipboard.read()`/paste event, else internal clipboard.

**Files:** `file-manager.js`, `app.js`, `index.html`, `tools/transform.js`, `style.css`
**PixiEditor ref:** `PasteImage_UpdateableChange.cs`
**Acceptance:** open a 4000×3000 photo into an 800×600 doc → lands centered, fully visible, aspect preserved, as a new layer, in transform mode; works via menu, drag-drop, and paste; correct in both render modes; mobile OK.

### Stage 3 — P3: Image menu (Size / Canvas / Rotate / Flip / Trim)  🔴
- Implement real Image Size + Canvas Size dialogs (currently stubs), Rotate 90/180/arbitrary, Flip H/V, Trim, Crop-to-content.
- Every op must resize **all** layers + masks + selection and call `engine._sizeCanvases()` (avoid the BUG-002 coordinate-staleness class).
- **PixiEditor ref:** `ResizeImage_Change.cs`, `ResizeCanvas_Change.cs`, `RotateImage_Change.cs`, `Crop_Change.cs`
- **Acceptance:** after each op, tools draw at correct coords; undo restores; mask/selection follow.

### Stage 4 — P4: Selection menu + selection-aware Transform  🔴
- Add `Select` menu (Inverse, Grow, Shrink, Feather, Border, Smooth, Save/Load), Ellipse Select tool, Transform Selection, and make **Free Transform respect the active selection** (fixes **BH-03**, Phase A deferred item).
- **PixiEditor ref:** `TransformSelected_UpdateableChange.cs`, `SelectEllipse_UpdateableChange.cs`, `SetSelection_Change.cs`
- **Acceptance:** transform with a selection moves only selected pixels; grow/shrink/feather visibly correct via marching ants.

### Stage 5 — P5: Finish Adjustment Layers  🔴 (fixes BH-02)
- Composite adjustment layers inline in `_compositeMembers()` (affect layers below / clip-to-below), double-click to re-edit, serialize type+params in `.pixoto`, panel icon + thumbnail, respect own mask.
- **PixiEditor ref:** `ColorAdjustmentsFilterNode.cs`, `ApplyFilterNode.cs`
- **Acceptance:** add a Curves adjustment → save → reload → export: identical result every time; re-editable.

### Stage 6 — P2: Shape Tools + Gradient Tool  🔴
- Rect/rounded-rect, ellipse, line, polygon/star; pixel-perfect mode; Shift/Alt modifiers; selection clipping; live preview. Gradient: linear/radial/angular/reflected + multi-stop editor; respects selection.
- **PixiEditor ref:** `DrawRasterRectangle/Ellipse/Line_UpdateableChange.cs`, `Raster*ToolViewModel.cs`
- **Acceptance:** shapes crisp in pixel mode (no AA) and smooth in photo mode; gradient stops editable on touch.

### Stage 7 — P8: PSD import / export (+ AVIF/SVG/GIF read)  🟠
- Vendor a PSD library locally (document why in `progress.md`); parse in a Worker. Import layers/blend/opacity/groups/masks; export rasterized.
- **Acceptance:** round-trip a multi-layer PSD; import AVIF/SVG/GIF first frame.

### Stage 8 — P6: Layer Styles / Effects  🟠
- Drop/Inner shadow, Outer/Inner glow, Stroke, Color/Gradient overlay, basic Bevel. Live in engine, re-editable, serialized, applied on export.

### Stage 9 — P7: Animation Timeline  🟠 (Phase H)
- Frames, onion skin, playback/FPS/loop, GIF/APNG + sprite-sheet/PNG-sequence export (vendor encoder), frame-aware undo + serialization.
- **PixiEditor ref:** `AnimationData.cs`, `CreateCel_Change.cs`, `SetKeyFrameData_Change.cs`, `SetOnionSettings_Change.cs`

### Stage 10 — P10: History panel + brush stabilizer + Replace Color  🟡
- History panel UI (jump-to-step, thumbnails), brush stabilizer/lazy-mouse, symmetry overlay, Replace Color tool.
- **PixiEditor ref:** `SymmetryOverlay.cs`, `ReplaceColor_Change.cs`, `LineBasedPen_UpdateableChange.cs`

### Stage 11 — P9: Reference layer + Viewport rotation + Rulers/Guides  🟡 (Phase I)
- **PixiEditor ref:** `ReferenceLayerOverlay.cs`, `RotateViewportToolViewModel.cs`, `SnappingOverlay.cs`, `SnappingController.cs`

### Stage 12 — P11: Multi-Document Tabs  🟡 (Phase K)
- Wrap engine state per document; tab strip (desktop) + mobile strip; open-in-new-tab; unsaved-close warning; max 8 tabs. Major `app.js` refactor — phase carefully.

---

## Definition of Done (every stage)
- [ ] Searched existing code + PixiEditor before building.
- [ ] Works on mobile, tablet, desktop, installed PWA (44px targets).
- [ ] Correct in Photo **and** Pixel render modes.
- [ ] Pointer Events only; coordinates via `screenToCanvas`.
- [ ] Undo/redo + `.pixoto` serialization where applicable.
- [ ] Bug traced Input → Event → Tool → State → Render → Output.
- [ ] `progress.md` + `docs/FEATURES.md` updated; `sw.js` cache bumped.
- [ ] Response ends with `Files changed:` summary.
