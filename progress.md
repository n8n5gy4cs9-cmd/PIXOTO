# Pixoto — Development Progress

> Updated after every completed feature or sub-phase.
> Status: 🟢 Done | 🔵 In Progress | 🟡 Planned | ⬜ Not Started | 🔴 Blocked

---

# 🚀 PARITY ROADMAP — Photoshop / Photopea Catch-Up

> Goal: stop being a "childish" toy and reach Photoshop/Photopea feature depth.
> Source of truth order: **existing Pixoto code → PixiEditor source → invent only if neither has it.**
> See `update-prompt.md` for the executable build prompt (phases, file lists, acceptance criteria).
> Nothing here is implemented yet — this is the plan. No code changed in this pass.

## Parity Roadmap Status

| ID  | Feature                                             | Priority | Status      | Maps to |
|-----|-----------------------------------------------------|----------|-------------|---------|
| P1  | Open / Place Image **as Layer** (fit + keep aspect) | 🔴 High  | 🟢 Done | new |
| P2  | Shape Tools + Gradient Tool                         | 🔴 High  | 🟢 Done | Phase D |
| P3  | Image menu: Size / Canvas / Rotate / Flip / Trim    | 🔴 High  | 🟢 Done | new |
| P4  | Selection menu (Inverse/Grow/Shrink/Feather/Border) + selection-aware Transform | 🔴 High | 🟢 Done | Phase A deferred |
| P5  | Adjustment Layers — finish (composite/re-edit/save) | 🔴 High  | 🟢 Done | Phase F deferred |
| P6  | Layer Styles / Effects (shadow, stroke, glow, overlay) | 🟠 Med | 🟢 Done | new |
| P7  | Animation Timeline + onion skin + GIF/sprite export | 🟠 Med  | 🟢 Done | Phase H |
| P8  | PSD import / export (+ AVIF/SVG/GIF read)           | 🟠 Med  | ⬜ Not Started | new |
| P9  | Reference layer + Viewport rotation + Rulers/Guides/Snap | 🟡 Low | 🟢 Done | Phase I |
| P10 | History Panel + brush stabilizer + Replace Color    | 🟡 Low  | ⬜ Not Started | new |
| P11 | Multi-Document Tabs                                  | 🟡 Low  | ⬜ Not Started | Phase K |

---

## P1 — Open / Place Image as Layer  🔴 (the reported gap)

**Problem today:** `File ▸ Open` only calls `FileManager.openImage(file, false)` (`app.js:1611`) which **replaces the whole document** with a new project. The `asNewLayer = true` branch exists (`file-manager.js:45-50`) but is never reachable from the UI **and** it just does `layer.ctx.drawImage(img, 0, 0)` — no scaling, no aspect fit, can overflow the canvas.

**Target (Photoshop "Place Embedded" / Photopea "Open & Place"):**

| Feature | Status | Notes |
|---|---|---|
| `File ▸ Place Image…` menu item (desktop + mobile) | ⬜ | next to Open File |
| Add opened image as a **new layer** in current doc | ⬜ | reuse `asNewLayer` branch |
| **Fit to canvas keeping aspect ratio** | ⬜ | `scale = min(docW/imgW, docH/imgH)`, center; never upscale past 100% unless larger-fit chosen |
| Drop into **Free Transform** immediately after place | ⬜ | reuse `tools/transform.js` so user can move/scale/rotate before commit |
| Drag-and-drop image file onto canvas → place as layer | ⬜ | `dragover`/`drop` on `#canvas-viewport` |
| Paste external image from clipboard (Ctrl+V) | ⬜ | `navigator.clipboard.read()` / paste event; falls back to internal clipboard |
| "Open as New Project" vs "Place as Layer" chooser when a doc already exists | ⬜ | small dialog; remember choice |
| Respect pixel vs photo smoothing on scaled draw | ⬜ | smoothing on in photo, off in pixel mode |

**Files:** `file-manager.js`, `app.js`, `index.html`, `tools/transform.js`, `style.css`
**PixiEditor ref:** `PasteImage_UpdateableChange.cs`

---

## P2 — Shape Tools + Gradient Tool  🔴 (Phase D)

| Feature | Status |
|---|---|
| Rectangle / rounded-rect (fill + stroke) | ⬜ |
| Ellipse / circle (fill + stroke) | ⬜ |
| Line tool (width, arrowheads) | ⬜ |
| Polygon / star tool | ⬜ |
| Pixel-perfect mode (Bresenham, no AA) | ⬜ |
| Shift = constrain square/circle, Alt = from center | ⬜ |
| Selection-clipped shapes | ⬜ |
| Live drag preview on UI canvas | ⬜ |
| Gradient tool: linear + radial (+ angular/reflected) | ⬜ |
| Multi-stop gradient editor (add/move/recolor stops) | ⬜ |
| Gradient respects selection + opacity/blend | ⬜ |

**Files:** `tools/shapes.js`, `tools/gradient.js`, `ui/gradient-editor.js`, `index.html`, `tool-manager.js`, `app.js`
**PixiEditor ref:** `DrawRasterRectangle/Ellipse/Line_UpdateableChange.cs`, `RasterRectangle/Ellipse/LineToolViewModel.cs`

---

## P3 — Image Menu: Size / Canvas / Rotate / Flip / Trim  🔴

**Problem today:** `Image` menu only has stubs `resize-image` and `resize-canvas`; no rotate, flip, or trim.

| Feature | Status |
|---|---|
| Image Size dialog (px/%, lock aspect, resample: nearest/bilinear) | ⬜ |
| Canvas Size dialog (9-point anchor, extend color) | ⬜ |
| Rotate document 90° CW / 90° CCW / 180° | ⬜ |
| Rotate document arbitrary angle (with auto-expand) | ⬜ |
| Flip document horizontal / vertical | ⬜ |
| Trim transparent borders | ⬜ |
| Crop to content | ⬜ |
| All ops resize **every** layer + mask + selection, call `_sizeCanvases()` | ⬜ |

**Files:** `canvas-engine.js`, `app.js`, `index.html`, `ui/image-size-dialog.js`
**PixiEditor ref:** `ResizeImage_Change.cs`, `ResizeCanvas_Change.cs`, `RotateImage_Change.cs`, `Crop_Change.cs`

---

## P4 — Selection Menu + Selection-Aware Transform  🔴

**Problem today:** no top-level `Select` menu; Free Transform ignores the active selection (deferred in Phase A).

| Feature | Status |
|---|---|
| `Select` menu (desktop + mobile drawer section) | ⬜ |
| Inverse selection (Ctrl+Shift+I) | ⬜ |
| Grow / Shrink by N px (morphological dilate/erode) | ⬜ |
| Feather selection (blur mask) | ⬜ |
| Border / Modify selection | ⬜ |
| Smooth selection | ⬜ |
| Transform Selection (move/scale/rotate the mask only) | ⬜ |
| Free Transform respects active selection (transform selected pixels, not whole layer) | ⬜ |
| Save / load selection (alpha channel) | ⬜ |
| Ellipse Select tool | ⬜ |

**Files:** `tools/selection.js`, `tools/transform.js`, `app.js`, `index.html`
**PixiEditor ref:** `TransformSelected_UpdateableChange.cs`, `SelectEllipse_UpdateableChange.cs`, `SetSelection_Change.cs`

---

## P5 — Adjustment Layers: finish the system  🔴

**Problem today:** `AdjustmentLayer` class exists, but engine compositing, double-tap re-edit, and `.pixoto` serialization were all deferred (Phase F).

| Feature | Status |
|---|---|
| Composite adjustment layers inline in `_compositeMembers()` | 🟢 Done |
| Adjustment affects only layers **below** (or clipped to layer below) | 🟢 Done |
| Double-tap / dbl-click adjustment layer → re-open editor | 🟢 Done |
| Serialize adjustment type + params in `.pixoto` | 🟢 Done |
| Adjustment layer thumbnail + icon in layers panel | 🟢 Done |
| Adjustment respects its own layer mask | 🟢 Done |

**Files:** `canvas-engine.js`, `filters/filters.js`, `ui/layers-panel.js`, `file-manager.js`, `ui/filter-dialog.js`
**PixiEditor ref:** `ColorAdjustmentsFilterNode.cs`, `ApplyFilterNode.cs`

---

## P6 — Layer Styles / Effects  🟠

Non-destructive per-layer FX (Photoshop "fx").

| Effect | Status |
|---|---|
| Drop Shadow (offset, blur, color, opacity) | 🟢 Done |
| Inner Shadow | 🟢 Done |
| Outer Glow / Inner Glow | 🟢 Done |
| Stroke (in/center/out) | 🟢 Done (solid color; gradient stroke not yet) |
| Color Overlay | 🟢 Done |
| Gradient Overlay | 🟢 Done |
| Bevel & Emboss (basic) | 🟢 Done |
| Composited live in engine, fx badge in panel, re-editable dialog | 🟢 Done |
| Serialized in `.pixoto`, applied on export | 🟢 Done (v1.3.0) |

**Files:** `layer-styles.js`, `canvas-engine.js`, `ui/layer-styles-dialog.js`, `ui/layers-panel.js`, `file-manager.js`
**PixiEditor ref:** none direct — node graph filters; design from scratch.

---

## P7 — Animation Timeline  🟠 (Phase H)

Frames, onion skin, GIF/APNG/sprite-sheet export. See existing Phase H table below (all ⬜).
**Files:** `animation.js`, `ui/timeline.js`, `lib/gif-encoder.js` (vendored), `ui/export-animation.js`
**PixiEditor ref:** `AnimationData.cs`, `CreateCel_Change.cs`, `SetKeyFrameData_Change.cs`, `SetOnionSettings_Change.cs`

---

## P8 — PSD Import / Export (+ more formats)  🟠

Photopea's headline capability.

| Feature | Status |
|---|---|
| `.psd` import → layers, blend modes, opacity, groups, masks | ⬜ |
| `.psd` export (rasterized layers) | ⬜ |
| Import AVIF / GIF (first frame) / SVG (rasterize) / BMP | ⬜ |
| Export with metadata (DPI) | ⬜ |

**Rules:** vendor PSD library locally (no CDN, no build step), document why. Run heavy parse in a Worker.
**Files:** `lib/psd.js` (vendored), `file-manager.js`, `index.html`

---

## P9 — Reference Layer + Viewport Rotation + Rulers/Guides  🟡 (Phase I)

See existing Phase I table below (all ⬜). Adds: non-destructive reference overlay, two-finger viewport rotation, rulers, draggable guides, snapping.
**PixiEditor ref:** `ReferenceLayerOverlay.cs`, `RotateViewportToolViewModel.cs`, `SnappingOverlay.cs`, `SnappingController.cs`

---

## P10 — History Panel + Brush Stabilizer + Replace Color  🟡

| Feature | Status |
|---|---|
| History panel UI (list of steps, jump-to-step) | ⬜ |
| Visual current-step highlight + step thumbnails | ⬜ |
| Brush stabilizer / lazy-mouse smoothing (strength slider) | ⬜ |
| Symmetry overlay (axis lines) for symmetry drawing | ⬜ |
| Replace Color tool (sample → swap within tolerance) | ⬜ |

**Files:** `ui/history-panel.js`, `tools/brush.js`, `tools/replace-color.js`, `history.js`, `index.html`
**PixiEditor ref:** `SymmetryOverlay.cs`, `ReplaceColor_Change.cs`, `LineBasedPen_UpdateableChange.cs`

---

## P11 — Multi-Document Tabs  🟡 (Phase K)

See existing Phase K table below (all ⬜). Wrap engine state per-document, tab strip, open-in-new-tab, unsaved-close warning, max 8 tabs.
**Files:** `document-manager.js`, `app.js` (refactor), `index.html`, `style.css`

---

# 🐛 BUGHUNT — Open / Suspected Issues

> Re-verify each against current source before fixing (some BUGS.md "fixed" rows contradict the audit body).

| ID | Severity | Area | Description | Verify |
|----|----------|------|-------------|--------|
| BH-01 | 🔴 | file-manager | Place-as-layer draws at native size, can overflow canvas; no aspect fit (P1) | `file-manager.js:45-50` |
| BH-02 | ✅ Fixed | filters | Adjustment layers now composite (masked/clip/opacity), serialize (v1.2.0), and re-edit; `addAdjustmentLayer()` fixed the members/layers desync that nullified them (P5) | `canvas-engine.js _compositeMembers`, `file-manager.js`, `ui/filter-dialog.js` |
| BH-03 | 🟠 | transform | Free Transform ignores active selection — transforms whole layer | `tools/transform.js`, Phase A row |
| BH-04 | 🟠 | mobile | Layer drag-reorder uses HTML5 DnD → fails on touch (BUGS row claims fixed but audit body still flags it — confirm) | `ui/layers-panel.js:144-170` |
| BH-05 | 🟠 | events | `onLayerChange`/`onActiveLayerChange` overwritten not chained — single subscriber, future systems silently miss events | `ui/layers-panel.js:33-34` (MEM-002) |
| BH-06 | 🟠 | memory | Color picker registers 6 global pointer listeners, never removed | `ui/color-picker.js:114-145` (MEM-001) |
| BH-07 | 🟠 | data-loss | Auto-save silently skips projects >4MB localStorage → user loses recovery | `file-manager.js:384` |
| BH-08 | 🟠 | iOS | Export blob download may silently fail on iOS Safari/PWA (confirm share fallback path works) | `file-manager.js:138-164` (PWA-001) |
| BH-09 | 🟡 | dedupe | Color conversion still duplicated in brush/eyedropper/pixel-engine despite `color-utils.js` | `tools/brush.js`, `tools/eyedropper.js`, `pixel-engine.js` (DUP-001) |
| BH-10 | 🟡 | render | Pixelate uses `layer.canvas.width` instead of `engine.docWidth` (fragile after crop) | `tools/pixelate.js:329-330` (RENDER-002) |
| BH-11 | 🟡 | PWA | SW cache list hardcoded; new module files won't cache offline | `sw.js` (PWA-002) |
| BH-12 | 🟡 | touch | `touch-action: none` only via CSS class; specificity override re-enables browser gestures | `index.html` canvases (TOUCH-002) |
| BH-13 | 🟡 | memory | Flood-fill stack growth on huge uniform areas (confirm scanline really applied) | `pixel-engine.js` (MEM-003) |
| BH-14 | 🟡 | file | `.pixoto` stores every layer as base64 PNG — large, slow, no compression | `file-manager.js _serializeProject` |

---

# 🧱 SYSTEM IMPROVEMENTS — Make the App Better

| ID | System | Improvement |
|----|--------|-------------|
| SYS-1 | Storage | Move auto-save + project recovery from localStorage (≈5MB) to **IndexedDB** (no cap, async, blobs) |
| SYS-2 | Events | Replace single-callback props (`onLayerChange`, …) with a tiny **multi-subscriber event bus** (fixes BH-05 root cause) |
| SYS-3 | Color | Finish **single source of truth** color module; delete duplicated converters (BH-09) |
| SYS-4 | Commands | Central **command/action + keyboard-shortcut registry** feeding menus, mobile drawer, future command palette (single map, remappable) |
| SYS-5 | Compositing | Investigate **tile/dirty-rect compositing** (PixiEditor ChunkyImage style) for large-canvas perf |
| SYS-6 | PWA | **Auto-generate** SW cache manifest from a module list (fixes BH-11) |
| SYS-7 | UI | Unified **modal/dialog + toast** system (consistent open/close, focus trap, mobile sheet) |
| SYS-8 | Export | Hardened cross-platform export (iOS share + File System Access API where available) |
| SYS-9 | Input | Inline `touch-action: none` on canvases + JS guard (fixes BH-12) |
| SYS-10 | Perf | Offload heavy ops (PSD parse, big filters, GIF encode) to **Web Workers / OffscreenCanvas** consistently |

---

## Overall Status

| Phase | Name                        | Status    | Started    | Completed  |
|-------|-----------------------------|-----------|------------|------------|
| 1     | Foundation & App Shell      | 🟢 Done   | —          | —          |
| 2     | Canvas Engine               | 🟢 Done   | —          | —          |
| 3     | Pixel Engine & Grid         | 🟢 Done   | —          | —          |
| 4     | Drawing Tools               | 🟢 Done   | —          | —          |
| 5a    | Selection System Core       | 🟢 Done   | —          | —          |
| 5b    | Lasso + Magic Wand          | 🟢 Done   | —          | —          |
| 5c    | Crop & Pixelate             | 🟢 Done   | —          | —          |
| 6     | Layers UI & Color Picker    | 🟢 Done   | —          | —          |
| 7     | History & File Manager      | 🟢 Done   | —          | —          |
| A     | Free Transform Tool         | 🟢 Done   | 2026-05-31 | 2026-05-31 |
| B     | Layer Masking & Alpha Lock  | 🟢 Done   | 2026-05-31 | 2026-05-31 |
| C     | Layer Groups / Folders      | 🟢 Done   | 2026-05-31 | 2026-05-31 |
| D     | Shape Tools & Gradient      | 🟢 Done   | 2026-06-24 | 2026-06-24 |
| E     | Text Tool                   | 🟢 Done   | 2026-05-31 | 2026-05-31 |
| F     | Filters & Adjustment Layers | 🟢 Done   | 2026-05-31 | 2026-05-31 |
| G     | Advanced Brushes            | 🟢 Done   | 2026-05-31 | 2026-05-31 |
| H     | Animation & Sprite Sheet    | 🟢 Done   | 2026-06-25 | 2026-06-25 |
| I     | Reference Layer & View Aids | 🟢 Done   | 2026-06-25 | 2026-06-25 |
| J     | Color System Upgrade        | 🟢 Done   | 2026-05-31 | 2026-05-31 |
| K     | Multi-Document Tabs         | ⬜ Not Started | —     | —          |
| L     | Node Graph (Stretch)        | ⬜ Not Started | —     | —          |

---

## Known Deferred Bugs (from BUGS.md)

| ID       | Description                                  | Status      |
|----------|----------------------------------------------|-------------|
| DUP-001  | Color conversion duplicated across 4 files   | ✅ Fixed     |
| TOUCH-002| touch-action: none only in CSS               | ⬜ Deferred  |
| PWA-002  | SW cache list hardcoded                      | ⬜ Deferred  |

---

## Phase A — Free Transform Tool

**Goal:** Move, scale, rotate, flip layer content or selection with interactive handles.

| Feature                            | Status        | Notes |
|------------------------------------|---------------|-------|
| Move layer contents                | 🟢 Done | |
| Scale via 8 handles                | 🟢 Done | corner + edge handles |
| Rotate via rotation handle         | 🟢 Done | drag outside bbox |
| Flip horizontal / vertical         | 🟢 Done | applied at rasterize time |
| Constrain aspect ratio (Shift)     | 🟢 Done | Shift+corner |
| Respect active selection           | ⬜ Not Started | deferred — transforms full layer |
| Confirm/cancel (Enter/Escape)      | 🟢 Done | |
| Numeric W/H/X/Y/Angle inputs       | 🟢 Done | |
| Touch handles (44px targets)       | 🟢 Done | 22px hit radius |
| Floating confirm/cancel on mobile  | 🟢 Done | #transform-floating-bar |

**Files to create:** `tools/transform.js`
**Files to modify:** `canvas-engine.js`, `index.html`, `app.js`, `tool-manager.js`

---

## Phase B — Layer Masking & Alpha Lock

**Goal:** Non-destructive hide/reveal via masks. Lock painting to existing alpha.

| Feature                              | Status        | Notes |
|--------------------------------------|---------------|-------|
| Add mask to layer (white / black)    | 🟢 Done | Layer menu + panel mask button |
| Mask thumbnail in layers panel       | 🟢 Done | 40×40 canvas alongside layer thumb |
| Click to switch active target        | 🟢 Done | click mask/layer thumb; _MaskLayerProxy |
| Disable/enable mask (Shift+click)    | 🟢 Done | Shift+click mask thumb |
| View mask in grayscale (Alt+click)   | 🟢 Done | Alt+click mask thumb; maskViewLayer |
| Apply mask                           | 🟢 Done | bakes mask into layer alpha |
| Delete mask                          | 🟢 Done | non-destructive remove |
| Invert mask                          | 🟢 Done | |
| Clipping mask (clip to layer below)  | 🟢 Done | destination-in against layer below |
| Alpha lock (lock transparent pixels) | 🟢 Done | pre/post stroke alpha snapshot restore |
| Mask compositing in canvas engine    | 🟢 Done | _grayscaleToAlpha + destination-in |
| Mask serialization in .pixoto        | 🟢 Done | base64 PNG in maskData field |
| Mask undo/redo support               | 🟢 Done | maskData in history snapshots |
| Mask editing banner on mobile        | 🟢 Done | #mask-editing-banner, fixed bar |

**Files created:** `ui/mask-utils.js`
**Files modified:** `canvas-engine.js`, `ui/layers-panel.js`, `index.html`, `tool-manager.js`, `history.js`, `file-manager.js`, `app.js`, `style.css`, `sw.js`

---

## Phase C — Layer Groups / Folders

**Goal:** Organize layers hierarchically. Apply shared opacity/blend to groups.

| Feature                          | Status        | Notes |
|----------------------------------|---------------|-------|
| Create group (Ctrl+G)            | 🟢 Done | createGroup(); groups active layer |
| Collapse/expand group            | 🟢 Done | collapsed flag + chevron toggle |
| Drag layers into/out of groups   | 🟢 Done | moveMember(); reorderLayer cross-group |
| Group opacity and blend mode     | 🟢 Done | activeMember for controls |
| Merge group to single layer      | 🟢 Done | mergeGroup() via context menu |
| Delete group (keep/delete layers)| 🟢 Done | deleteGroup(keepChildren) |
| Duplicate group                  | 🟢 Done | duplicateGroup() deep copy |
| Lock group                       | 🟢 Done | group.locked flag |
| Nested groups (up to 4 levels)   | 🟢 Done | depth check in createGroup |
| Group compositing in engine      | 🟢 Done | _compositeMembers() recursive |
| Group serialization in .pixoto   | 🟢 Done | tree field in v1.1.0 format |
| Tree rendering in layers panel   | 🟢 Done | renderMembers() with indentation |

**Files modified:** `canvas-engine.js`, `ui/layers-panel.js`, `file-manager.js`, `history.js`, `app.js`, `index.html`, `style.css`

---

## Phase E — Text Tool

**Goal:** Place editable text, committed to raster on confirm.

| Feature                         | Status        | Notes |
|---------------------------------|---------------|-------|
| Click-to-place text box         | 🟢 Done | |
| Textarea overlay on canvas      | 🟢 Done | #text-overlay |
| Font family selection           | 🟢 Done | 7 font options |
| Font size (8–500px)             | 🟢 Done | |
| Bold / italic / underline       | 🟢 Done | |
| Color (foreground)              | 🟢 Done | uses toolManager.foregroundColor |
| Alignment (left/center/right)   | 🟢 Done | |
| Multi-line support              | 🟢 Done | |
| Move text box while editing     | 🟢 Done | drag handle |
| Confirm to raster (Enter / ✓)  | 🟢 Done | Ctrl+Enter |
| Cancel (Escape / ✗)             | 🟢 Done | |
| Mobile virtual keyboard support | 🟢 Done | delayed focus via rAF |

**Files created:** `tools/text.js`
**Files modified:** `index.html`, `app.js`, `style.css`

---

## Phase F — Filters & Adjustment Layers

**Goal:** Destructive filters + non-destructive adjustment layers.

### Destructive Filters

| Filter          | Status        | Notes |
|-----------------|---------------|-------|
| Gaussian Blur   | 🟢 Done | Web Worker |
| Sharpen         | 🟢 Done | |
| Unsharp Mask    | 🟢 Done | |
| Invert          | 🟢 Done | |
| Grayscale       | 🟢 Done | |
| Sepia           | 🟢 Done | |
| Posterize       | 🟢 Done | |
| Outline/Glow    | 🟢 Done | |
| Noise           | 🟢 Done | |
| Live preview modal | 🟢 Done | scaled preview canvas |

### Adjustment Layers

| Adjustment Layer   | Status        | Notes |
|--------------------|---------------|-------|
| Brightness/Contrast| 🟢 Done | |
| Hue/Saturation/L   | 🟢 Done | |
| Levels             | 🟢 Done | |
| Curves             | 🟢 Done | |
| Color Balance      | 🟢 Done | |
| Vibrance           | 🟢 Done | |
| Gradient Map       | 🟢 Done | |
| Threshold          | 🟢 Done | |
| Adjustment compositing in engine | 🟢 Done | masked + clip-to-below + opacity blend in `_compositeMembers()`; `addAdjustmentLayer()` keeps members/layers in sync |
| Double-tap to re-edit            | 🟢 Done | dbl-click adjustment thumb → `FilterDialog.openForEdit()` |
| Serialization in .pixoto         | 🟢 Done | `kind:'adjustment'` + adjustType/params (format v1.2.0) |

**Files created:** `filters/filters.js` (prior session), `filters/filter-worker.js`, `ui/filter-dialog.js`
**Files modified:** `index.html`, `app.js`

---

## Phase G — Advanced Brushes

**Goal:** Smudge, dodge, burn, clone stamp.

| Feature              | Status        | Notes |
|----------------------|---------------|-------|
| Smudge tool          | 🟢 Done | pickup-buffer approach |
| Dodge tool           | 🟢 Done | |
| Burn tool            | 🟢 Done | |
| Clone stamp tool     | 🟢 Done | |
| Clone source marker  | 🟢 Done | crosshair overlay canvas |
| Long-press for clone source (mobile) | 🟢 Done | 600ms timer |

**Files created:** `tools/smudge.js`, `tools/dodge-burn.js`, `tools/clone-stamp.js`
**Files modified:** `index.html`, `app.js`

---

## Phase D — Shape Tools & Gradient Tool

**Goal:** Anti-aliased geometric shapes and linear/radial gradient fills.

| Feature                              | Status        | Notes |
|--------------------------------------|---------------|-------|
| Rectangle tool (filled/outlined)     | ⬜ Not Started | |
| Ellipse tool (filled/outlined)       | ⬜ Not Started | |
| Line tool                            | ⬜ Not Started | |
| Polygon tool                         | ⬜ Not Started | |
| Pixel-perfect mode for shape tools   | ⬜ Not Started | |
| Shift-constrain to square/circle     | ⬜ Not Started | |
| Selection clipping for shapes        | ⬜ Not Started | |
| Gradient tool (linear)               | ⬜ Not Started | |
| Gradient tool (radial)               | ⬜ Not Started | |
| Multi-stop gradient editor           | ⬜ Not Started | |
| Gradient respects selection          | ⬜ Not Started | |
| Live preview while dragging          | ⬜ Not Started | |
| Constrain toggle (mobile, no Shift)  | ⬜ Not Started | |

**Files to create:** `tools/shapes.js`, `tools/gradient.js`, `ui/gradient-editor.js`
**Files to modify:** `index.html`, `tool-manager.js`, `app.js`

---

## Phase E — Text Tool

**Goal:** Place editable text, committed to raster on confirm.

| Feature                         | Status        | Notes |
|---------------------------------|---------------|-------|
| Click-to-place text box         | ⬜ Not Started | |
| Textarea overlay on canvas      | ⬜ Not Started | |
| Font family selection           | ⬜ Not Started | |
| Font size (8–500px)             | ⬜ Not Started | |
| Bold / italic / underline       | ⬜ Not Started | |
| Color (foreground)              | ⬜ Not Started | |
| Alignment (left/center/right)   | ⬜ Not Started | |
| Multi-line support              | ⬜ Not Started | |
| Move text box while editing     | ⬜ Not Started | |
| Confirm to raster (Enter / ✓)  | ⬜ Not Started | |
| Cancel (Escape / ✗)             | ⬜ Not Started | |
| Mobile virtual keyboard support | ⬜ Not Started | |

**Files to create:** `tools/text.js`
**Files to modify:** `index.html`, `tool-manager.js`, `app.js`, `style.css`

---

## Phase F — Filters & Adjustment Layers

**Goal:** Destructive filters + non-destructive adjustment layers.

### Destructive Filters

| Filter          | Status        | Notes |
|-----------------|---------------|-------|
| Gaussian Blur   | ⬜ Not Started | Web Worker |
| Sharpen         | ⬜ Not Started | |
| Unsharp Mask    | ⬜ Not Started | |
| Invert          | ⬜ Not Started | |
| Grayscale       | ⬜ Not Started | |
| Sepia           | ⬜ Not Started | |
| Posterize       | ⬜ Not Started | |
| Outline/Glow    | ⬜ Not Started | |
| Noise           | ⬜ Not Started | |
| Live preview modal | ⬜ Not Started | |

### Adjustment Layers

| Adjustment Layer   | Status        | Notes |
|--------------------|---------------|-------|
| Brightness/Contrast| ⬜ Not Started | |
| Hue/Saturation/L   | ⬜ Not Started | |
| Levels             | ⬜ Not Started | |
| Curves             | ⬜ Not Started | Bezier per channel |
| Color Balance      | ⬜ Not Started | |
| Vibrance           | ⬜ Not Started | |
| Gradient Map       | ⬜ Not Started | |
| Threshold          | ⬜ Not Started | |
| Adjustment compositing in engine | ⬜ Not Started | |
| Double-tap to re-edit            | ⬜ Not Started | |
| Serialization in .pixoto         | ⬜ Not Started | |

**Files to create:** `filters/filters.js`, `filters/filter-worker.js`, `ui/filter-dialog.js`, `ui/adjustment-layer.js`
**Files to modify:** `canvas-engine.js`, `ui/layers-panel.js`, `index.html`, `app.js`, `history.js`, `file-manager.js`

---

## Phase G — Advanced Brushes

**Goal:** Smudge, dodge, burn, clone stamp.

| Feature              | Status        | Notes |
|----------------------|---------------|-------|
| Smudge tool          | ⬜ Not Started | |
| Dodge tool           | ⬜ Not Started | |
| Burn tool            | ⬜ Not Started | |
| Clone stamp tool     | ⬜ Not Started | |
| Clone source marker  | ⬜ Not Started | crosshair overlay |
| Long-press for clone source (mobile) | ⬜ Not Started | |

**Files to create:** `tools/smudge.js`, `tools/dodge-burn.js`, `tools/clone-stamp.js`
**Files to modify:** `index.html`, `tool-manager.js`, `app.js`

---

## Phase H — Animation & Sprite Sheet

**Goal:** Frame timeline, onion skinning, animated GIF export.

| Feature                         | Status        | Notes |
|---------------------------------|---------------|-------|
| Frame system in canvas engine   | 🟢 Done | Option A: each frame = full members snapshot; `AnimationManager` |
| Timeline panel (desktop docked) | 🟢 Done | `#timeline-panel` docked above status bar |
| Timeline panel (mobile drawer)  | 🟢 Done | same panel, responsive bottom strip (44px targets) |
| Add / delete / duplicate frame  | 🟢 Done | + Frame / Blank / Duplicate / Delete |
| Reorder frames (drag)           | 🟢 Done | pointer-event drag |
| Per-frame duration              | 🟢 Done | per-cell ms input |
| Playback with FPS control       | 🟢 Done | setTimeout chain honoring per-frame duration |
| Loop toggle                     | 🟢 Done | |
| Onion skinning (prev/next)      | 🟢 Done | red/blue ghosts via `engine.onionFrames` in `_composite` |
| Animated GIF export             | 🟢 Done | **from-scratch** encoder (`lib/gif-encoder.js`), validated via sips |
| PNG sprite sheet export         | 🟢 Done | columns + padding |
| PNG sequence export             | 🟢 Done | one PNG per frame |
| Sprite sheet slice import       | 🟢 Done | grid → frames |
| Frame serialization in .pixoto  | 🟢 Done | format v1.4.0 (frames + fps/loop/activeFrame) |
| Frame-aware undo/redo           | 🟢 Done | drawing-within-frame + active-frame restore (structural frame add/delete not yet in undo) |

**Files to create:** `animation.js`, `ui/timeline.js`, `lib/gif-encoder.js`, `ui/export-animation.js`
**Files to modify:** `canvas-engine.js`, `file-manager.js`, `history.js`, `index.html`, `app.js`, `style.css`

---

## Phase I — Reference Layer & View Aids

**Goal:** Non-destructive reference overlay, viewport rotation, rulers/guides.

| Feature                          | Status        | Notes |
|----------------------------------|---------------|-------|
| Reference layer type             | 🟢 Done | display-only; excluded from `getFlattenedCanvas` export |
| Reference layer import           | 🟢 Done | View ▸ Import Reference… (fit + centre) |
| Reference transform (independent)| 🟢 Done | opacity, show/hide, above/below, drag-move, scale ±, fit |
| Viewport rotation                | 🟢 Done | `translate·rotate·scale`; rotation-aware screen↔canvas |
| Two-finger rotation gesture      | 🟢 Done | added to pinch handler; end-snap to 0° within 4° |
| Rotation indicator in status bar | 🟢 Done | `#view-rotation-indicator` (click = reset) |
| Reset rotation button            | 🟢 Done | status indicator + View ▸ Reset View Rotation |
| Rulers (top + left edges)        | 🟢 Done | render into `#ruler-h`/`#ruler-v`; hidden while rotated |
| Drag guides from rulers          | 🟢 Done | drag from ruler → guide (touch + mouse) |
| Tap ruler → input guide pos (mobile) | 🟡 Partial | drag-create works on touch; numeric tap-input not implemented |
| Snap to guide                    | 🟢 Done | `engine.snapPoint` (guides + edges + centre); wired into Free Transform |
| Delete guide (drag off / dbl-click) | 🟢 Done | double-click ruler near guide deletes it; + Clear Guides |

**Files to modify:** `canvas-engine.js`, `pixel-engine.js`, `index.html`, `app.js`, `style.css`

---

## Phase J — Color System Upgrade

**Goal:** RGB/HSB sliders, color history, expanded palette import formats.

| Feature                          | Status        | Notes |
|----------------------------------|---------------|-------|
| RGB sliders in color panel       | ⬜ Not Started | |
| HSB sliders in color panel       | ⬜ Not Started | |
| CMYK preview (display only)      | ⬜ Not Started | |
| Color history (last 10)          | ⬜ Not Started | |
| Import palette: GPL format       | ⬜ Not Started | |
| Import palette: HEX format       | ⬜ Not Started | |
| Import palette: PNG extract      | ⬜ Not Started | |
| Sort palette (hue/lightness)     | ⬜ Not Started | |
| Rename palette swatches          | ⬜ Not Started | |

**Files to modify:** `ui/color-picker.js`, `index.html`, `pixel-engine.js`, `style.css`

---

## Phase J — Color System Upgrade

**Goal:** RGB/HSB sliders, color history, expanded palette import formats.

| Feature                          | Status        | Notes |
|----------------------------------|---------------|-------|
| RGB sliders in color panel       | 🟢 Done | slider + number input per channel |
| HSB sliders in color panel       | 🟢 Done | hsbToRgb / rgbToHsb in color-utils.js |
| CMYK preview (display only)      | 🟢 Done | rgbToCmyk approximate screen conversion |
| Color history (last 10)          | 🟢 Done | persisted in localStorage |
| Import palette: GPL format       | 🟢 Done | parses "R G B name" lines |
| Import palette: HEX format       | 🟢 Done | .hex/.txt — one hex per line |
| Import palette: PNG extract      | 🟢 Done | quantized color extraction |
| Sort palette (hue)               | 🟢 Done | btn-palette-sort-hue |
| Add swatch from current color    | 🟢 Done | btn-add-swatch |
| Remove swatch (right-click)      | 🟢 Done | contextmenu on swatch |
| Background color picker          | 🟢 Done | color-preview-bg click |
| Mode tabs (RGB/HSL/HSB/CMYK)     | 🟢 Done | picker-tab buttons |
| Hex input without # prefix       | 🟢 Done | |

**Files modified:** `ui/color-utils.js`, `ui/color-picker.js`, `index.html`, `app.js`, `style.css`

---

## Phase J (bonus) — Lucide Icons

All toolbar and UI chrome SVG symbols replaced with Lucide 0.462 icon paths (MIT license, vendored inline in `index.html`). Tool icons:

| Tool | Lucide icon |
|---|---|
| Brush | lucide:paintbrush |
| Eraser | lucide:eraser |
| Fill | lucide:paint-bucket |
| Select Rect | custom dashed rect |
| Lasso | lucide:lasso |
| Magic Wand | lucide:wand-sparkles |
| Crop | lucide:crop |
| Pixel Pen | lucide:pen-tool |
| Eyedropper | lucide:pipette |
| Pixelate | lucide:grid-3x3 |
| Move | lucide:move |
| Transform | custom bounding box |
| Text | lucide:type |
| Smudge | custom blend curves |
| Dodge | lucide:sun |
| Burn | lucide:moon |
| Clone Stamp | lucide:stamp |

**Files modified:** `index.html`

---

## Phase K — Multi-Document Tabs

**Goal:** Multiple images open simultaneously in separate tabs.

| Feature                          | Status        | Notes |
|----------------------------------|---------------|-------|
| Tab bar UI                       | ⬜ Not Started | |
| Document object wrapping engine state | ⬜ Not Started | |
| Switch active document           | ⬜ Not Started | |
| Open file in new tab             | ⬜ Not Started | |
| New canvas in new tab            | ⬜ Not Started | |
| Close tab with unsaved warning   | ⬜ Not Started | |
| Max 8 tabs enforcement           | ⬜ Not Started | |
| Mobile tab strip                 | ⬜ Not Started | |

**Files to create:** `document-manager.js`
**Files to modify:** `app.js` (major refactor), `index.html`, `style.css`

---

## Phase L — Node Graph (Stretch)

**Goal:** Visual filter pipeline via nodes.

| Feature                  | Status        | Notes |
|--------------------------|---------------|-------|
| Node engine core         | ⬜ Not Started | |
| Node editor UI           | ⬜ Not Started | |
| Image input node         | ⬜ Not Started | |
| Filter nodes (blur etc.) | ⬜ Not Started | |
| Output node              | ⬜ Not Started | |
| Save graph in .pixoto    | ⬜ Not Started | |

**Files to create:** `nodes/node-engine.js`, `ui/node-editor.js`, `nodes/nodes-core.js`

---

## Changelog Summary

| Date       | Version | Summary |
|------------|---------|---------|
| 2026-05-31 | 1.0.0   | Phases 1–7 complete. prompt2.md + progress.md initialized. |
| 2026-05-31 | 1.1.0   | Phase A complete. Free Transform Tool — move/scale/rotate/flip/numeric inputs/confirm/cancel. |
| 2026-05-31 | 1.2.0   | Phases 1–7 PixiEditor audit + rewrites: color utils deduplication (DUP-001), selection-aware drawing, pixel-perfect pen. |
| 2026-05-31 | 1.3.0   | Phase B complete. Layer masking, alpha lock, clipping mask. _MaskLayerProxy, mask compositing, serialization, undo/redo, mask editing banner. |
| 2026-05-31 | 1.4.0   | Phase C complete. LayerGroup class, engine.members tree, recursive compositing, create/ungroup/merge/duplicate/delete groups, Ctrl+G, tree panel rendering, group undo/redo/serialization. |
| 2026-05-31 | 1.5.0   | Grid fix (Part 0): mix-blend-mode:difference on grid canvas, white grid color, Grid Color picker in View menu. Phase E: Text Tool (click-to-place overlay, rasterize, multi-line, drag to move, keyboard confirm/cancel). Phase F: Destructive filters + Adjustment layers (9 filters, 8 adj types, Web Worker, live preview modal). Phase G: Smudge, Dodge, Burn, Clone Stamp tools with toolbar buttons, tool options panels. |
| 2026-05-31 | 1.6.0   | Lucide icons: replaced all SVG symbol paths with authentic Lucide 0.462 icons (MIT, vendored inline). Phase J: Color System Upgrade — HSB/CMYK conversions, upgraded color picker (mode tabs: RGB/HSL/HSB/CMYK, slider rows, hex without #), color history strip (last 10, persisted), palette import (GPL/HEX/PNG extract), palette sort by hue, add/remove swatches, background color picker. |
| 2026-05-31 | 1.6.1   | Bug fix: All Image > Effects filters now work. Root cause: applyAdjustment() in filters.js only handled adjustment-layer types, not destructive filter types (gaussian-blur, grayscale, sepia, sharpen, unsharp-mask, noise, outline). Added all 7 missing cases to the dispatch switch. Fixed Worker path using import.meta.url for correct absolute URL resolution. Added onerror handler + robust sync fallback for Worker failures. |
| 2026-06-24 | 1.7.0   | Parity pass P1–P4 + bughunt. **P1** Place Image as Layer (aspect-fit + center, Place menu/Ctrl+Shift+P, New-vs-Place chooser, drag-drop, clipboard paste, transform-on-place via TransformTool.setInitialRegion). **P2** Shape tools (rect/rounded/ellipse/line/polygon-star, pixel-perfect + smooth, Shift/Alt, selection-clipped, live preview) + Gradient tool (linear/radial/angular/reflected, tool opacity) + multi-stop GradientEditor; legacy pixel-shape buttons wired. **P3** engine rotate90/rotate180/rotateArbitrary/flipH/flipV/trim + getContentBounds + Image menu items + rotate modal. **P4** Select menu (invert/grow/shrink/feather/border/smooth/save/load), Ellipse Select tool, selection-aware Free Transform (floating-selection lift). Bughunt: BH-12 inline touch-action:none; pixel-engine drawRect/drawEllipse selection clipping; wired Restore Last Session; verified BH-09/BH-10/BH-13 already fixed. sw.js cache → v2.3.0 with full module list. |
| 2026-06-25 | 1.8.0   | **P5 — Adjustment Layers finished** (fixes BH-02). Inline compositing now honors the adjustment's own **opacity**, **layer mask**, and **clip-to-below** (per-pixel blend in `_compositeMembers`). New `CanvasEngine.addAdjustmentLayer()` inserts into the **members tree** (the old splice-into-`layers`-only path meant adj layers never composited and were dropped on the next `_syncLayers`). **Double-click** an adjustment layer thumbnail → `FilterDialog.openForEdit()` re-opens the editor seeded with current params (preview = composite below). **Serialization**: `.pixoto` v1.2.0 stores `kind:'adjustment'` + adjustType/params/mask (was lost before). Layers panel shows the adjustment **"fx" thumbnail + badge**. sw.js → v2.4.0. |
| 2026-06-25 | 1.9.0   | **P6 — Layer Styles / Effects** (new non-destructive per-layer fx). New `layer-styles.js` renders Drop Shadow, Outer Glow, Inner Shadow, Inner Glow, Stroke (out/center/in), Color Overlay, Gradient Overlay, basic Bevel & Emboss — all browser-native Canvas 2D (native `ctx.filter` blur, morphological dilate/erode via offset stamps; **no new dependency**). `Layer.effects` field; `_compositeMembers` pre-renders the styled canvas and feeds it through the existing mask/clip/opacity/blend branches (so **masks clip effects** and **export works** via `getFlattenedCanvas`). New live editor `ui/layer-styles-dialog.js` (sectioned, enable toggles, sliders/colors/selects) opened from **Layer ▸ Layer Styles…** or the panel **fx badge**. `.pixoto` v1.3.0 serializes `effects`; history captures/restores `effects` (undo/redo). sw.js → v2.5.0. |
| 2026-06-25 | —       | **Project restructure:** all 15 runtime files/dirs moved into `src/` (index.html, style.css, manifest.json, sw.js, app.js, canvas-engine.js, pixel-engine.js, layer-styles.js, tool-manager.js, history.js, file-manager.js, tools/, filters/, ui/, icons/). Docs/`.md`/`BACKUP`/`TEMP_TO_BE_REMOVED`/`.github` stay at repo root. No path edits needed (all refs already relative). **`src/` is the new web root** — serve with `cd src && python3 -m http.server 8080`. |
| 2026-06-25 | 1.10.0  | **P7 — Animation Timeline + onion skin + GIF/sprite export** (Phase H). New `animation.js` `AnimationManager` (Option A: each frame = full members snapshot; add/blank/duplicate/delete/reorder/per-frame duration, FPS playback, loop). New `ui/timeline.js` docked panel (frame thumbnails, drag-reorder, play controls, onion toggle, export). **Onion skin** rendered via `engine.onionFrames` in `_composite()` (red/blue ghosts of neighbour frames). New **from-scratch** `lib/gif-encoder.js` (median-cut quantize + GIF-LZW + per-frame delay/transparency + NETSCAPE loop; **no dependency**, independently validated by macOS `sips`). New `ui/export-animation.js`: **GIF / sprite-sheet PNG / PNG-sequence export + sprite-sheet slice import**. `.pixoto` **v1.4.0** stores all frames (+fps/loop/activeFrame); backward compatible (old files load as one frame). History captures/restores the active frame index. Tools suspended during playback (`engine.animationPlaying`). sw.js → v2.6.0 (+animation.js, lib/gif-encoder.js, ui/timeline.js, ui/export-animation.js). |
| 2026-06-25 | 1.11.0  | **P9 — Reference layer + Viewport rotation + Rulers/Guides/Snap** (Phase I). **Reference layer** (`engine.referenceLayer`): import (fit+centre), opacity, show/hide, above/below, drag-move, scale, fit; rendered in `_composite()` only so it's **never exported**. **Viewport rotation**: `_updateTransform` now `translate·rotate·scale`; `screenToCanvas`/`canvasToScreen` made rotation-aware (matrix form) so **all tools stay correct**; two-finger rotate added to the pinch handler (end-snaps to 0° within 4°); status-bar indicator + reset; pixel grid auto-hidden while rotated. **Pinch-zoom + wheel/preset zoom centering rewritten to be rotation-aware** (reduces to original behaviour at 0°). **Rulers** rendered into the existing `#ruler-h`/`#ruler-v` canvases (doc coordinates, hidden while rotated). **Guides** on a new doc-space `#guides-canvas` inside the wrapper (rotates/zooms with art); drag from a ruler to create, double-click ruler to delete, Clear Guides. **Snapping** via `engine.snapPoint` (guides + canvas edges + centre) wired into Free Transform (active only when guides exist). New `ui/guides.js`. sw.js → v2.7.0. |
| 2026-06-25 | 1.11.1  | **Bug fix: layer blend mode / opacity controls did nothing.** Root cause: `addLayer`/`duplicateLayer`/`addAdjustmentLayer` called `_syncLayers()` (which sets `activeMember` from the *old* `activeLayerIndex`) and only afterwards updated `activeLayerIndex` — leaving `engine.activeMember` pointing at the **previous** layer. The panel highlights the active layer by index, but the blend/opacity controls read & wrote `activeMember`, so they edited a different (invisible) layer. Fix: those mutators now set `activeMember` to the new layer; and the layers panel resolves control targets via `layers[activeLayerIndex]` for layers (groups still via `activeMember`), so the controls always act on the highlighted layer. sw.js → v2.7.1. |

---

# 2026-10-06 — Pixoto 2 planning (Composa web clone)

- Files changed: docs/PLAN.md, docs/PRD.md, tasks.md (all new). No code touched.
- What: studied Composa (source of truth) and Compositor; planned a static, no-build web rewrite deployable by upload to a PHP 7.4 shared host.
- Why: user asked for a Composa-style web app with regenerated icons/sprites, tool layout and shortcuts.
- Remaining: user approval, then Phase 1 (see tasks.md).

---

# 2026-10-06 — Phase 1 (Shell) implemented

- Files changed: CLAUDE.md (rewritten: autonomy, Composa reference, hosting rules), tasks.md, docs/FEATURES.md (rewritten), `src/` → `BACKUP/src-old-pixoto/`, tools/make-icons.py, and new `app/`: index.html, manifest.webmanifest, sw.js, app.js, css/app.css, assets/{icons.svg,icon.svg}, core/{blend,history,model,render,tools,state,commands}.js, ui/{dom,dialogs,canvas-view,layers-panel,menu,toolbar,options-bar,tabs}.js, io/files.js.
- What: Composa-style shell, document model with structural undo, canvas compositor (native blend modes), zoom/pan/pixel grid, tabs, layers panel, command registry + default shortcuts, icon sprite from Composa's `Icons.cs`, image open/place/drop, export.
- Why: Phase 1 of tasks.md.
- Decisions: Composa's toolbar has 15 tools (Eraser is the Brush's Erase mode, E key); Filter menu dropped (Composa has none); canvas max 16384 px (4096 on iOS) until the Phase 9 probe; dropping files onto an open doc places them as layers.
- Not verified by running (user tests in a browser): everything was syntax-checked with `node --check` and import/export names cross-checked, nothing else.
- Remaining: Phase 2 onward (see tasks.md). Open items: PNG app icons (Phase 9), blend modes needing pixel pass (Phase 6), `.htaccess`, recent files.

---

# Pixoto 2 rewrite log

## 2026-10-06 — Phases 2–7 (+ most of 8–9)
Ported Composa's editing core to `app/`: model/history/renderer (`core/model.js`, `history.js`, `render.js`, `effects.js`, `sepblend.js`), painting (`core/paint/*`, `core/ops/paint.js`, `gradient.js`), selections (`core/mask.js`, `select/wand.js`, `ops/selection.js`), transform/canvas/guides/clipboard/layers ops (`core/ops/*`), text and shapes (`core/text/*`, `shape.js`, `ops/live.js`), adjustments and filters (`core/filters/*`, worker `workers/compute.worker.js`, `core/compute.js`, `ops/preview.js`), files (`io/zip.js`, `project.js`, `psd.js`, `files.js`, `store.js`), UI (`ui/*`: canvas view with tool handlers in `ui/tools/`, layers panel, options bar, colour picker, live dialogs, rulers/guides, shortcut remapping), PWA icons/service worker/`.htaccess`.
Decisions: no fflate (native streams); text uses Canvas fillText per character with kerning corrections; Camera Raw filter and AI control not ported; extra filters added beyond Composa (see tasks.md); defaults for font family Arial.
Verification: syntax and import checks, plus node smoke tests with a software canvas shim covering painting, selections, transforms, layer ops, filters, history (undo-all/redo-all hashes match). Found and fixed: temporary Ctrl-move flag, mask stroke source copy.
Remaining: test on the real shared host; real-browser pass for visual details (text kerning, transforms with rotation, PSD edge cases).

## 2026-10-06 — Auto-update, filter robustness, Help page
- Files: app/sw.js (generated), tools/make-sw.py, app/app.js, app/core/compute.js, app/ui/tool-dialogs.js, app/ui/help.js (new), app/css/app.css, docs/FEATURES.md, tasks.md.
- What: service worker is now network-first with revalidation (cache only offline), registers on any secure context (localhost too; before it only ran on https, so plain http dev relied on the HTTP cache) and reloads open pages once when a new worker activates. Compute worker no longer transfers its buffer, so a worker that fails to load falls back to the main thread; preview errors are shown instead of swallowed. Help page generated from the tool and command registries. Shortcuts dialog moved to Ctrl+K (F1 is Help).
- Filters: algorithms verified in node (all 33 run and change pixels); the cause of "nothing happens" could not be reproduced by reading, most likely stale cached code or a silent worker failure, both addressed. If it persists, an error toast now names the cause.
- Note: after the first load of this version one more manual reload may be needed once, to replace the old service worker.

## 2026-10-06 — About panel
- app/app.js: About text now "Made by Crowelian 2026." and the October update note.

## 2026-10-08 — LUT adjustment
- Files: app/core/filters/lut.js (new), app/core/filters/adjust.js, app/ui/adjust-dialogs.js, app/sw.js, docs/FEATURES.md, tasks.md.
- What: new `lut` adjustment (Image menu and adjustment layer, so layer opacity, blend and mask apply). Four generated looks (Leiku Vivid, Leiku Natural, Leiku Standard, Cinematic) baked to a 33^3 table, trilinear lookup, Amount slider, .cube file import (3D only, stored as text in the layer).
- Note: written without running anything; untested. The Look select does not refresh its label after loading a .cube until the dialog is reopened.
