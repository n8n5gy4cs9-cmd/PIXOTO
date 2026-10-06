# Pixoto Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed- **BUG: PWA installs to wrong URL when deployed in subfolder** — All paths were absolute (`/`) so `softa.site/pixoto/` installed as `softa.site/`. Changed `start_url`, `file_handlers.action`, `share_target.action` in manifest.json to `./`. Changed all SW cached asset paths to `./` relative. Changed SW registration to `./sw.js`. Bumped cache to `pixoto-v2.1.0`. (manifest.json, sw.js, app.js)- **BUG: Mobile tool drawer vanishes after Fit to Screen** — CSS `visibility` approach on `.drawer` conflicted with the `hidden` attribute pattern the tool drawer uses. Reverted `.drawer` to pure `hidden` + `requestAnimationFrame` (which works for bottom sheets). Also fixed backdrop: now starts `hidden` in HTML and JS manages `hidden` attr alongside `.visible` class, so it’s `display:none` when no side drawer is open (prevents z-index interference with touch events on bottom toolbar). Side drawers (hamburger/layers) keep CSS `visibility` approach. (style.css, index.html, app.js)
- **BUG: Undo/Redo buttons do nothing on mobile** — `#btn-undo` and `#btn-redo` had NO click event listeners. Only keyboard shortcuts (Ctrl+Z/Y) and three-finger tap called `performUndo()`/`performRedo()`. Added `addEventListener('click', ...)` for both buttons. (app.js)
- **BUG: Mobile tool settings missing color selector** — The color section (preview, hex input, swatches) was only in the right panel, which is hidden on mobile. `_populateMobileToolOptions()` now moves `#color-section` into the drawer alongside tool options, and `_returnMobileToolOptions()` returns it to the desktop panel on close. Drawer `max-height` increased from 50vh to 75vh. (app.js, style.css)
- **BUG: Hamburger menu not visible after Fit to Screen** — The previous fix using `hidden` attribute + reflow + `requestAnimationFrame` was unreliable on mobile browsers. Replaced entirely with CSS `visibility: hidden` / `pointer-events: none` on `.side-drawer:not(.open)` and `.drawer-backdrop`. Removed `hidden` attributes from HTML and all `hidden`/reflow/setTimeout juggling from JS. (app.js, style.css, index.html)
- **BUG-001: Undo for drawing tools broken** — `Pixoto.toolManager._viewport` → `.viewport` (no underscore). Auto-snapshot capture listener was never registered because `_viewport` was always undefined. (app.js:1389)
- **BUG-002: Crop-to-selection breaks coordinates** — `performCropToSelection()` now calls `engine._sizeCanvases(w, h)` instead of manually setting canvas dimensions. (app.js:1155)
- **BUG-003: Zombie `origPointerDown` variable** — Removed unused variable. (app.js:1387)
- **BUG-004: File deserialize uses stale activeLayerIndex** — Reset `engine.activeLayerIndex = -1` before addLayer loop. (file-manager.js:239)
- **BUG-005: Color picker cursor wrong on first open** — Switched from `getBoundingClientRect()` pixel positioning to percentage-based `left`/`top` so it works when modal is hidden. (ui/color-picker.js)
- **MEM-001: Color picker leaks 6 document listeners** — Replaced permanent document-level listeners with on-demand attach/detach (added on pointerdown, removed on pointerup). (ui/color-picker.js)
- **MEM-002: Layer callbacks overwritten not chained** — `layers-panel.js` now chains with existing `onLayerChange`/`onActiveLayerChange` callbacks. (ui/layers-panel.js:33)
- **TOUCH-001: Layer drag reorder desktop-only** — Replaced HTML5 Drag API with Pointer Events-based touch reorder. (ui/layers-panel.js:152)
- **PWA-001: Export fails on iOS Safari** — Added `navigator.share()` fallback for iOS. (file-manager.js)
- **RENDER-002: Pixelate uses layer.canvas.width** — Changed to `engine.docWidth`/`engine.docHeight` for defensive bounds. (tools/pixelate.js)
- **MEM-003: Flood fill OOM on large canvases** — Replaced naive 4-push per-pixel with scanline algorithm. (pixel-engine.js)

### Added
- **Mobile tool settings drawer** — Tapping a tool on the bottom toolbar now opens a bottom sheet showing that tool's options (Size, Opacity, Hardness, Block Size, Mode buttons, etc.). Tap active tool again to toggle closed. (app.js)
- **About overlay** — Help > About Pixoto shows modal with logo, "PIXOTO — Simple photo editor by Crowelian © 2026 v1.0.0". Available from desktop Help menu and mobile hamburger menu. (index.html, style.css, app.js)
- **Help menu** — Added "Help" to desktop menu bar with "About Pixoto" item. (index.html)
- **Clear App Data** — Help > Clear App Data shows confirmation modal then removes all Pixoto localStorage keys, unregisters service workers, deletes all caches, and reloads. Available in desktop Help dropdown and mobile hamburger menu. (index.html, app.js, style.css)
- **Export filename input** — Export dialog now includes a filename text field (defaults to "pixoto-export"). The entered name is passed to `fileManager.exportImage()`. Works on both desktop and mobile. (index.html, app.js, style.css)
- **Resize Image** — Image > Resize Image opens a modal with width/height inputs, aspect ratio lock toggle, and Smooth/Nearest resampling mode. Scales all layers to new dimensions with undo support. (canvas-engine.js, index.html, app.js, style.css)
- **Resize Canvas** — Image > Resize Canvas opens a modal with width/height inputs and a 9-point anchor grid. Expands or trims the canvas without scaling content, positioning existing data based on anchor. Undo supported. (canvas-engine.js, index.html, app.js, style.css)
- **Mobile Image section** — Hamburger menu now has an "Image" section with Resize Image, Resize Canvas, and Crop to Selection. (index.html)

### Fixed (Post-Audit)
- **Hamburger menu breaks after Fit to Screen** — *(Superseded: see new fix above using CSS visibility approach)* Original fix with `[hidden] { display: none !important }` + reflow + rAF was insufficient on some mobile browsers. (app.js, style.css, index.html)

### Previous Fixes
- **BUG: Crop breaks all coordinates** — `confirmCrop()` now calls `engine._sizeCanvases(w, h)` to update display canvas CSS, uiCanvas CSS, and wrapper element dimensions. Previously only buffer dimensions were updated, causing `screenToCanvas()` to return wrong coords and `fitToScreen()` to display incorrectly. (tools/crop.js)
- **BUG: Undo only works once** — `HistoryStep` now stores `docWidth`/`docHeight`. `_restoreSnapshots()` detects dimension changes and resizes all engine canvases + layer canvases before restoring pixel data. Replaced plain-object layer shim (`_createLayer`) with proper imported `Layer` class. (history.js)
- **BUG: Lasso/RectSelect flickers during draw** — Marching ants animation now stopped in `onPointerDown()` for both `RectSelectTool` and `LassoTool` to prevent UI canvas conflict with drag preview rendering. Ants restart automatically when new selection is confirmed. (tools/selection.js)
- **BUG: Pixelate brush offset from crosshair** — Same root cause as crop coordinate bug: wrapper CSS dimensions not updated. Fixed by Phase 1 crop fix. (tools/crop.js)
- **BUG: Guides menu does nothing** — Added placeholder handler with console log. (app.js)

### Added
- **Phase 5c — Selection Actions**
  - Cut (Ctrl+X), Copy (Ctrl+C), Paste (Ctrl+V) as new layer, Delete (Delete/Backspace)
  - Crop to selection: resizes all layers to selection bounds
  - Internal clipboard system (`Pixoto.clipboard`)

- **Phase 5d — Crop Tool**
  - `tools/crop.js`: CropTool with visual overlay (dark excluded areas, white border, rule-of-thirds grid), 8 draggable handles, center drag, aspect ratio presets (Free/1:1/4:3/3:2/16:9), confirm (Enter) / cancel (Esc)
  - Tool options panel with aspect ratio buttons + confirm/cancel actions

- **Phase 5e — Pixelation Tools**
  - `tools/pixelate.js`: PixelateBrushTool (drag to pixelate, configurable block + brush size), RectPixelateTool (drag region with live preview), PixelSortTool (glitch art, sorts pixel rows/columns by brightness)
  - Tool options panel with block size slider + mode toggle (Brush/Rectangle/Pixel Sort)

- **Phase 6 — UI Panels**
  - `ui/layers-panel.js`: Dynamic layer list with thumbnails, visibility/lock toggles, name editing (dblclick), drag-and-drop reorder, blend mode dropdown + opacity slider sync
  - `ui/color-picker.js`: HSV/HSL picker canvas, hue strip, alpha strip, hex/RGB/HSL inputs, old/new color comparison

- **Phase 7 — History & File Management**
  - `history.js`: HistoryManager with undo/redo stacks (50 steps), per-layer ImageData snapshots, batch operations, jump-to-step
  - `file-manager.js`: Open image/project, export PNG/JPG/WebP, save/load .pixoto JSON format, auto-save to localStorage (60s interval), session restore
  - Auto-snapshot before drawing tool strokes (capture phase pointer event)

- **Phase 8 — PWA Polish**
  - Service Worker updated to v2.0.0, all new modules in cache list

### Changed
- `app.js`: Full integration of all new modules. Imports HistoryManager, FileManager, CropTool, PixelateBrushTool, RectPixelateTool, PixelSortTool, LayersPanel, ColorPicker. Undo/redo wired (Ctrl+Z/Y + three-finger tap). File operations wired (save/export/open). Layer buttons wired. Selection actions wired (Ctrl+X/C/V, Delete). Crop Enter/Escape. Pixelate mode switching
- `tool-manager.js`: Added `getTool(name)` method for tool lookup by name
- `index.html`: Added crop tool options panel (aspect ratio + confirm/cancel), pixelate tool options panel (block size + mode)
- `style.css`: Crop tool overlay styles, btn-group-wrap, layer drag states, color picker cursor/slider/value styles
- `sw.js`: Cache v2.0.0, added all new files to asset list

### Added
- **Phase 5b — Lasso + Magic Wand Tools**
  - `tools/selection.js`: LassoTool (freehand polygon selection with scanline rasterization, live preview with closing-line hint, downsample filter for performance), MagicWandTool (flood-fill based color selection from composited display, tolerance + contiguous controls)
  - SelectionManager extensions: `setFromPolygon(points, mode)` — scanline polygon-to-mask rasterizer, `setFromFlood(startX, startY, tolerance, contiguous, mode, imageData)` — flood-fill selection with tolerance matching
  - Magic wand SVG icon in sprite, sidebar button (W shortcut), mobile bottom toolbar button
  - Magic wand tool option panel: tolerance slider (0–255, default 32), contiguous checkbox, Select All / Deselect buttons
  - `canvas-engine.js`: `compositeNow()` method for synchronous compositing (used by magic wand to read fresh pixels)
  - `tool-manager.js`: `wandTolerance` and `wandContiguous` state + setters

### Changed
- `app.js`: Imports LassoTool + MagicWandTool, creates + registers both in init(), W shortcut, wand-tolerance slider + wand-contiguous checkbox wired, showToolOptions maps magic-wand, drawer names updated
- `index.html`: Magic wand icon in SVG sprite, button in sidebar + bottom toolbar, tool option panel with tolerance/contiguous/buttons

### Added
- **Phase 5a — Selection System Core**
  - `tools/selection.js`: SelectionManager class (per-pixel Uint8Array mask, bounding rect, rect set with replace/add/subtract modes, selectAll, deselect), animated marching ants (dual black+white dashed stroke on UI canvas, edge detection for complex masks), RectSelectTool (drag to select, shift to add, alt to subtract, click to deselect, live preview while dragging)
  - Selection tool option panels in `index.html` (select-rect, lasso hint + buttons)

### Changed
- `app.js`: Imports SelectionManager + RectSelectTool, creates selectionManager in init(), registers rectSelectTool, Ctrl+A→selectAll, Ctrl+D→deselect, Escape→deselect, menu actions wired, tool option button handlers, showToolOptions maps select-rect and lasso
- `sw.js`: Strategy changed from cache-first to **network-first** (always serves fresh code when online, cache as offline fallback). Cache version bumped to v1.6.0. Added tools/selection.js
- `index.html`: Added select-rect and lasso tool option panels with Select All / Deselect buttons + hint text

### Added
- **Phase 4 — Drawing Tools**
  - `tool-manager.js`: Tool base class + ToolManager — routes pointer events from viewport to active tool with navigation guard, multi-touch safety, common tool state (colors, brush size/opacity/hardness/mode, fill tolerance/contiguous), non-linear brush size adjust
  - `tools/brush.js`: Unified soft brush + pixel pen — radial gradient stamp with spacing/pressure, Bresenham pixel pen with snap-to-grid sizes
  - `tools/eraser.js`: Soft eraser (destination-out) + pixel eraser (clearRect) — mirrors brush settings
  - `tools/fill.js`: Flood fill tool — single-click, uses PixelEngine.floodFill with tolerance + contiguous toggle
  - `tools/eyedropper.js`: Color sampler — composited display sampling, live preview while dragging, updates all color UI
  - Fill/eraser/eyedropper tool option panels added to `index.html`

### Changed
- `app.js`: Imports + creates ToolManager with all 4 tools, setActiveTool wires tool switching + option panel visibility, slider inputs sync to tool manager, [/] shortcuts adjust brush size, color changes sync to tool manager
- `index.html`: Added eraser options, fill options (tolerance + contiguous), eyedropper options panels
- `style.css`: Added `.tool-option-group[hidden]` rule, `.option-hint` style, `#fill-contiguous` accent color
- `sw.js`: Cache version bumped v1.3.0 → v1.4.0, added `tool-manager.js` to asset list

### Added
- **Phase 3 — Pixel Engine & Grid**
  - `pixel-engine.js`: Bresenham algorithms (line, rect, ellipse, circle — outline + filled), pixel drawing primitives, flood fill with tolerance, symmetry drawing, grid overlay system, palette system with 5 preloaded palettes (PICO-8, Game Boy, NES, CGA, Endesga-32), palette import/export
  - Grid overlay: viewport-space rendering (always 1px lines), HiDPI support, auto-show at ≥400% zoom, sub-grid for sprite boundaries

### Changed
- `canvas-engine.js`: Added `pixelEngine` reference, `_updateTransform()` notifies pixel engine for grid redraws, grid canvas excluded from `_sizeCanvases()`
- `app.js`: Imports PixelEngine, creates and links to CanvasEngine, toggle-grid wired to pixelEngine
- `index.html`: Grid canvas moved from `#canvas-wrapper` to `#canvas-viewport`
- `style.css`: Grid canvas restyled as viewport overlay with z-index 10
- `sw.js`: Cache version bumped v1.1.0 → v1.2.0

### Added
- **Phase 2 — Canvas Engine & Core State**
  - `canvas-engine.js`: Full canvas rendering engine — Layer class (OffscreenCanvas, opacity, blend mode, visibility, lock, dirty-rect tracking), CanvasEngine class (compositing, zoom/pan, HiDPI, coordinate transforms, pinch-to-zoom, three-finger undo tap, image-rendering mode control)
  - Engine integration in `app.js`: Engine created on init with callbacks for zoom, cursor position, layer changes; zoom buttons, menu actions, mode toggle, space-to-pan, window resize all wired to engine

### Changed
- `app.js`: Replaced Phase 1 stub canvas init with engine-backed initialization. Removed `centerCanvas()` — engine handles positioning. Cursor tracking now via engine callback instead of direct pointermove listener. Added keyup listener for space-to-pan release. `initCanvas()` now accepts optional bgColor parameter
- `style.css`: Added `will-change: transform` to `#canvas-wrapper`. Removed `body.pixel-art-mode #canvas-wrapper` image-rendering rule (now managed per-canvas by engine)

### Added
- **Phase 1 — Foundation & App Shell** (2026-03-08)
  - `index.html`: Complete app shell with all panels, inline SVG icon sprite sheet (30+ icons), top bar, tool sidebar, canvas container with triple-canvas stack (main, grid, UI overlay), right panel (layers, tool options, color), mobile bottom toolbar, mobile drawers (tool options bottom sheet, layers side drawer, hamburger menu), color picker modal, new canvas dialog with presets, export dialog, status bar, PWA install banner, session restore banner
  - `style.css`: Full dark theme with CSS custom properties, mobile-first responsive design (mobile < 768px, tablet 768–1199px, desktop ≥ 1200px), checkerboard transparency pattern, all panel styles, drawer/modal animations, slider styling, safe-area-inset support for notch devices, pixel-art-mode indicator styles
  - `manifest.json`: PWA manifest with standalone display, file handlers, share target
  - `sw.js`: Service worker with cache-first strategy, offline fallback, cache versioning
  - `app.js`: Minimal Phase 1 bootstrap — service worker registration, tool selection with ripple effect, mode toggle (Photo/Pixel Art), mobile drawer system, desktop dropdown menus, modal open/close, keyboard shortcuts, slider live value display, color swatch selection, basic canvas initialization, cursor position tracking, window resize handling, session restore check, PWA install prompt
  - `icons/icon.svg`: Pixoto pixel-P logo mark as SVG
