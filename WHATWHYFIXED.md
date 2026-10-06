# WHATWHYFIXED — Pixoto Change Log

---

## 2026-03-08 — PWA Subfolder Fix + Mobile Tool Drawer + Undo Buttons + Color Section + Hamburger Fix

### What was changed

**Tool drawer fix (corrected approach):**
- Reverted `.drawer` CSS to pure `transform` without `visibility` rules — the bottom sheet tool drawer works correctly with `hidden` attribute + `requestAnimationFrame` (unlike side drawers which need CSS visibility).
- Reverted `openToolDrawer()` / `closeToolDrawer()` to `hidden` + rAF pattern with guarded `setTimeout` for DOM return.
- Backdrop (`#drawer-backdrop`): starts `hidden` in HTML. JS sets `hidden = false` before showing, and `hidden = true` (via guarded setTimeout) after all side drawers close. This keeps the backdrop `display: none` when unused, preventing z-index interference with bottom toolbar touch events.

**Undo/Redo buttons:**
- Added `$('#btn-undo')?.addEventListener('click', () => performUndo())` and same for redo. Previously these buttons had NO click handlers — undo only worked via keyboard shortcuts (Ctrl+Z/Y) or three-finger tap.

**Tool drawer fix (`.drawer` bottom sheet):**
- **style.css:** Added `.drawer:not(.open) { visibility: hidden; pointer-events: none }` and `visibility: visible` on `.drawer.open`. Same pattern as side drawers. Added `transition-delay` on `.drawer-backdrop` visibility (300ms delay when hiding, 0s when showing) for smooth fade-out.
- **index.html:** Removed `hidden` attribute from `#tool-drawer`.
- **app.js:** `openToolDrawer()` — removed `DOM.toolDrawer.hidden = false` and `requestAnimationFrame` wrapper. Now just calls `_populateMobileToolOptions()` + adds `.open` class. `closeToolDrawer()` — removed `DOM.toolDrawer.hidden = true`. Returns DOM nodes via `setTimeout` only if drawer is still closed (guards against rapid open/close).

**app.js:**
- `_populateMobileToolOptions()` now also moves `#color-section` (color preview, hex input, swatches) from the desktop right panel into the mobile tool drawer alongside tool options.
- `_returnMobileToolOptions()` now returns the color section back to `#right-panel` when the drawer closes.
- `openLayersDrawer()` / `closeLayersDrawer()` — removed `hidden` attribute toggling, reflow hacks (`void el.offsetHeight`), `requestAnimationFrame` wrapping, and `setTimeout` cleanup. Now just adds/removes `.open` class.
- `openHamburger()` / `closeHamburger()` — same simplification.
- Removed `_layersCloseTimer` and `_hamburgerCloseTimer` variables (no longer needed).
- Backdrop close handlers no longer need to manage `hidden` attribute.

**style.css:**
- `.drawer` `max-height` increased from `50vh` to `75vh` so tool options + color section fit.
- Replaced `.side-drawer[hidden] { display: none !important }` with `.side-drawer:not(.open) { visibility: hidden; pointer-events: none }` — drawers are already off-screen via `transform`, this makes them officially invisible and inaccessible without `display:none` timing issues.
- `.side-drawer.open` now includes `visibility: visible` alongside `transform: translateX(0)`.
- `.drawer-backdrop` now uses `visibility: hidden` by default and `visibility: visible` in `.visible` state, instead of relying on `hidden` HTML attribute.

**index.html:**
- Removed `hidden` attribute from `#layers-drawer`, `#drawer-backdrop`, and `#hamburger-menu`. CSS visibility now handles initial hidden state.

### Why
- **Color section missing on mobile:** The color section was in the right panel which is hidden at < 768px. Mobile users had no way to change colors or pick from swatches.
- **Hamburger menu invisible:** The `hidden` attribute + reflow + rAF approach was unreliable on mobile browsers. The timing between removing `hidden` (which sets `display: none → flex`) and adding the `.open` class (which triggers a CSS transition) was a race condition — sometimes the transition never fired, leaving the drawer invisible.

### What it achieved
- Mobile tool drawer now shows tool options AND color section (preview, hex input, 10 swatches) in one scrollable panel.
- Hamburger menu reliably opens and closes on all browsers, including after Fit to Screen.
- Layers drawer uses same reliable CSS visibility approach.
- No timers, no reflow hacks, no race conditions.

---

## 2026-03-08 — Resize Image + Resize Canvas

### What was changed

**canvas-engine.js:**
- Added `resizeImage(newW, newH, smooth)` method: saves each layer to a temp canvas, resizes the layer buffer, then draws the old content scaled to the new dimensions. Supports bilinear (smooth) and nearest-neighbor (pixel art) resampling via `imageSmoothingEnabled`. Updates `docWidth`/`docHeight`, calls `_sizeCanvases()` and `fitToScreen()`.
- Added `resizeCanvas(newW, newH, anchorX, anchorY)` method: saves each layer, resizes the buffer, then places the old content at a calculated offset based on the anchor (-1=left/top, 0=center, 1=right/bottom). No scaling — just repositioning.

**index.html:**
- Added Resize Image modal (`#resize-image-modal`) with width/height inputs, lock-aspect-ratio button, and Smooth/Nearest resampling toggle.
- Added Resize Canvas modal (`#resize-canvas-modal`) with width/height inputs and a 3×3 anchor grid.
- Added "Image" section to mobile hamburger menu with Resize Image, Resize Canvas, and Crop to Selection.

**app.js:**
- `handleMenuAction` cases `resize-image` / `resize-canvas` now open the respective modals instead of showing an alert.
- `openResizeImageModal()`: populates current dimensions, stores aspect ratio for lock mode.
- `openResizeCanvasModal()`: populates current dimensions, resets anchor to center.
- Apply handlers: save undo snapshot, clear selection, call engine method, update `Pixoto.canvas` and status bar.
- Aspect ratio lock: toggle button swaps lock/unlock icon, linked input handlers auto-calculate the constrained dimension.
- Anchor grid: click handler toggles active state on the 9 anchor cells.

**style.css:**
- `.resize-content`, `.resize-current-size`, `.resize-lock-btn` (with active/hover states)
- `.resize-option-row` for resampling and anchor sections
- `.anchor-grid` (3×3 CSS grid) and `.anchor-cell` (with ::after dot indicator, active/hover states)

### Why
- Resize Image and Resize Canvas were the only two remaining placeholder menu items. Users need to scale images (e.g., shrink a photo for web) and change canvas size (e.g., add padding, crop borders) without re-creating the project.

### What it achieved
- Full resize image with scaling (bilinear or nearest-neighbor) across all layers, with undo support.
- Full canvas resize with 9-anchor positioning, with undo support.
- Both accessible from desktop Image menu and mobile hamburger menu.
- Aspect ratio lock for proportional scaling.

---

## 2026-03-08 — Clear App Data + Export Filename + Hamburger Menu Fix

### What was changed

**Phase 1 — Clear App Data:**
- Added "Clear App Data…" item to desktop Help dropdown and mobile hamburger Help section.
- Added confirmation modal (#clear-data-modal) with warning text and Cancel/Clear Data buttons.
- On confirm: clears all `pixoto*` localStorage keys, unregisters service workers, deletes all Cache API caches, then reloads the page.

**Phase 2 — Export Filename:**
- Added `<input id="export-filename">` to the Export Image dialog, defaulting to "pixoto-export".
- Export confirm handler now reads the input value and passes it as the third argument to `fileManager.exportImage(format, quality, filename)`.
- Added `.export-filename-row` CSS styles.

**Phase 3 — Hamburger menu breaks after Fit to Screen:**
- Root cause: `.side-drawer { display: flex }` overrides the browser's `[hidden] { display: none }` UA rule. The `hidden` attribute had zero effect on `.side-drawer` elements. When `closeHamburger()` setTimeout fired and set `hidden = true` on the backdrop, and then `openHamburger()` set `hidden = false` and used rAF to add the `open` class, the browser could skip the transition because it never saw the intermediate "un-hidden but without .open" state.
- Fix: (a) Added `.side-drawer[hidden] { display: none !important }` so `hidden` actually works. (b) Tracked `_hamburgerCloseTimer` / `_layersCloseTimer` IDs and cancel them in the corresponding open functions. (c) Added `void el.offsetHeight` forced reflow between `hidden = false` and the rAF that adds the `open` class.

### Why
- Clear App Data: Users need a way to reset the app when cache becomes stale or storage is corrupted, especially in PWA mode where manual cache clearing is difficult.
- Export Filename: On mobile, the default filename was hardcoded and users had no way to change it before downloading.
- Hamburger fix: After using Fit to Screen (or any action from the hamburger menu), reopening the menu showed only the dark backdrop with no visible drawer panel.

### What it achieved
- Full app data reset from within the app UI, no need to manually clear browser data.
- Custom filenames when exporting images on any device.
- Reliable hamburger menu open/close on all platforms, including after Fit to Screen.

---

## 2026-03-08 — Audit Bug Fixes + Mobile Tool Settings + About Overlay

### What was changed

**Phase 1 — Critical app.js fixes:**
- BUG-001: `_viewport` → `viewport` in auto-snapshot listener registration. Drawing tool strokes (brush/eraser/fill/pixelate) are now captured in undo history.
- BUG-002: `performCropToSelection()` now calls `engine._sizeCanvases(w, h)` to prevent coordinate offset after crop-to-selection.
- BUG-003: Removed unused `origPointerDown` zombie variable.

**Phase 2 — File manager deserialize:**
- BUG-004: Added `engine.activeLayerIndex = -1` before layer loading loop so `addLayer()` inserts at correct indices.

**Phase 3 — Color picker fixes:**
- MEM-001: 6 permanent document-level pointermove/pointerup listeners replaced with on-demand attach/detach (added on pointerdown, removed on pointerup).
- BUG-005: Cursor/thumb positioning uses percentage-based CSS instead of `getBoundingClientRect()` pixel values (works when modal is hidden).

**Phase 4 — Callback chaining:**
- MEM-002: `layers-panel.js` now chains with existing `onLayerChange`/`onActiveLayerChange` callbacks instead of overwriting them.

**Phase 5 — Mobile tool settings:**
- `openToolDrawer()` moves the active tool's option group DOM node into the mobile drawer (preserving all event bindings).
- Tap active tool again to toggle drawer closed.
- Tool switch while drawer open re-populates content.

**Phase 6 — About overlay:**
- Added Help menu (desktop) + hamburger Help section (mobile) with "About Pixoto" action.
- About modal shows logo, "PIXOTO", "Simple photo editor by Crowelian", "© 2026", "v1.0.0".

**Phase 7 — Remaining LOW fixes:**
- TOUCH-001: Layer reorder replaced HTML5 Drag API with Pointer Events-based drag (works on touch).
- PWA-001: Export now tries `navigator.share()` first (iOS Safari PWA fallback), then falls back to anchor download.
- RENDER-002: Pixelate tools use `engine.docWidth`/`engine.docHeight` instead of `layer.canvas.width`/`height`.
- MEM-003: Flood fill replaced naive 4-push-per-pixel with scanline algorithm (dramatically less stack memory).

### Why it was necessary

The codebase audit found 15 issues. The two HIGH severity bugs (BUG-001 and BUG-002) meant undo didn't work for drawing and crop-to-selection broke coordinates. The mobile tool settings drawer existed in HTML but was never populated with content — mobile users couldn't change brush size, pixelate block size, or any tool setting. The About overlay was requested as a new feature.

---

## 2026-03-08 — Bug Fix Batch: Crop coordinates, Undo, Selection flicker, Menu stubs

### What was changed

**`tools/crop.js` — confirmCrop() canvas sizing fix:**
- Replaced manual `engine.display.width = w` / `engine.uiCanvas.width = w` with a single call to `engine._sizeCanvases(w, h)`, which correctly updates: display canvas buffer + CSS dimensions, uiCanvas buffer + CSS dimensions, and wrapper element CSS width/height.

**`history.js` — Full undo/redo dimension-awareness rewrite:**
- `HistoryStep` constructor now accepts and stores `docWidth` and `docHeight`.
- `saveSnapshot()`, `beginBatch()`/`endBatch()`, `undo()`, `redo()` all pass current `engine.docWidth`/`engine.docHeight` when creating HistoryStep instances.
- `_restoreSnapshots()` now detects if the step's dimensions differ from the current engine dimensions. If so, it calls `engine._sizeCanvases()` to resize all canvases, resizes each layer's canvas buffer, then puts ImageData. Finishes with `fitToScreen()` to recenter.
- Removed 60-line `_createLayer()` method (plain object shim). Replaced with imported `Layer` class from `canvas-engine.js` — proper constructor, OffscreenCanvas, all methods.

**`tools/selection.js` — Marching ants flicker fix:**
- Added `this.selection._stopAnts()` at the start of `RectSelectTool.onPointerDown()` and `LassoTool.onPointerDown()`. This prevents the rAF ants animation from clearing the UI canvas while the tool's `_drawPreview()` is rendering the drag feedback.

**`app.js` — Unimplemented menu action stubs:**
- Added `'resize-image'` and `'resize-canvas'` cases to `handleMenuAction()` — shows a user-facing `alert()` saying the feature is not yet implemented.
- Added `'toggle-guides'` case — logs to console (no visible UI change since guides have no visual implementation yet).

### What it achieved
- After crop, all tools (brush, pixelate, selection) draw at the correct position under the cursor
- Fit to Screen correctly centers the cropped canvas at the right size
- Undo/redo works reliably across multiple strokes, and correctly restores document dimensions after undoing a crop
- Lasso and rectangle selection tools no longer flicker during drag — clean preview lines visible throughout
- Resize Image/Canvas menu items give clear "not implemented" feedback instead of silently doing nothing
- Guides menu item handled gracefully

### Why it was necessary
- The crop bug was the highest-severity issue — it broke ALL tools after any crop operation, making the crop feature effectively unusable
- The undo bug meant users could only undo once, defeating the purpose of the 50-step history system
- The selection flicker made lasso selection visually confusing and hard to use
- Silent no-op menu items are bad UX — users need feedback

---

## 2026-03-08 — Phases 5c–8: Selection Actions, Crop, Pixelate, UI Panels, History, File Management, PWA

### What was changed

**New files created:**
- `tools/crop.js` (~240 lines): CropTool with visual overlay, 8 drag handles, aspect ratio enforcement, rule-of-thirds grid, confirm/cancel
- `tools/pixelate.js` (~310 lines): PixelateBrushTool (circular brush pixelation), RectPixelateTool (drag-region pixelation with preview), PixelSortTool (glitch art brightness sorting)
- `ui/layers-panel.js` (~260 lines): LayersPanel — renders dynamic layer list from engine.layers, thumbnails (40×40 debounced), visibility/lock toggles, name editing (dblclick), drag reorder, blend mode/opacity control sync
- `ui/color-picker.js` (~340 lines): ColorPicker — HSV/HSL picker canvas, hue strip, alpha strip, hex/RGB/HSL bidirectional input sync, old/new color comparison
- `history.js` (~360 lines): HistoryManager with undo/redo stacks, per-layer ImageData snapshots, batch operations, jump-to-step
- `file-manager.js` (~355 lines): FileManager with open image/project, export PNG/JPG/WebP, save/load .pixoto JSON, auto-save (60s), session restore

**Files modified:**
- `app.js`: Imported and integrated all new modules. Wired undo/redo (Ctrl+Z/Y/Shift+Z, three-finger tap), file operations (save/export/open), layer buttons (add/duplicate/merge/delete for desktop + mobile), selection actions (cut/copy/paste/delete/crop-to-selection), crop confirm/cancel + aspect ratio buttons, pixelate mode switching + block size slider. Auto-snapshot before drawing strokes via capture-phase pointer event. Session restore via FileManager. Auto-save started on init.
- `tool-manager.js`: Added `getTool(name)` method for tool lookup
- `index.html`: Added crop tool options panel (aspect ratio presets, confirm/cancel buttons), pixelate tool options panel (block size slider, mode toggle buttons)
- `style.css`: Added crop tool styles (.crop-actions), btn-group-wrap (flex-wrap), layer drag states (.dragging, .drag-over, .locked icon), color picker styles (picker-cursor, slider-thumb, color value inputs, color-preview-compare)
- `sw.js`: Bumped cache to v2.0.0, added all 6 new files to ASSETS_TO_CACHE

### What it achieved
- **Undo/Redo**: Full undo/redo with up to 50 history steps, automatic snapshots before every drawing stroke
- **File I/O**: Open images, export PNG/JPG/WebP, save/load .pixoto projects, auto-save every 60s with session restore
- **Selection Actions**: Cut, copy, paste (as new layer), delete selection, crop to selection
- **Crop Tool**: Visual crop with handles, aspect ratios, rule-of-thirds grid
- **Pixelation**: Three modes — brush (drag to pixelate), rectangle (drag region), pixel sort (glitch art)
- **Layers Panel**: Full layer management UI with thumbnails, drag reorder, visibility/lock/name editing
- **Color Picker**: Interactive HSL picker with all input formats synchronized
- **PWA**: Service worker updated with all new assets cached

### Why it was necessary
- These features complete the core editor functionality from Phase 5c through Phase 8
- Without undo/redo and file management, the editor is unusable for real work
- Layer management UI is essential for multi-layer editing
- Color picker completes the color selection workflow
- Crop and pixelate are standard image editing tools expected by users

### What was changed
- Extended `SelectionManager` in `tools/selection.js` with two new methods: `setFromPolygon()` (scanline polygon rasterizer) and `setFromFlood()` (flood-fill selection with tolerance matching)
- Created `LassoTool` class: freehand polygon selection with point downsampling, live preview (dashed outline + cyan closing-line hint + area fill), scanline commit on pointerUp
- Created `MagicWandTool` class: click-to-select by color from composited display, tolerance + contiguous controls from ToolManager
- Added `compositeNow()` to `canvas-engine.js` for synchronous compositing before magic wand samples pixels
- Added `wandTolerance` (32) and `wandContiguous` (true) state + setters to `tool-manager.js`
- Updated `index.html`: magic wand SVG icon, sidebar button (W shortcut), mobile bottom toolbar button, tool option panel (tolerance slider, contiguous checkbox, Select All/Deselect)
- Updated `app.js`: imports + creates + registers LassoTool and MagicWandTool, W keyboard shortcut, wand slider/checkbox/button wiring, showToolOptions + drawer names updated

### What it achieved
- Users can draw freehand lasso selections with live visual feedback and marching ants on commit
- Users can click with magic wand to select regions by color similarity, with adjustable tolerance and contiguous/global modes
- Both tools support Shift (add) and Alt (subtract) modifier keys for composing complex selections
- All three selection tools (rect, lasso, wand) share the same SelectionManager mask and marching ants system

### Why it was necessary
- Lasso selection is essential for selecting irregular shapes in photo editing
- Magic wand is essential for quick color-based selection (e.g., selecting a background to delete)
- These complete the core selection tool suite needed before Phase 5c (selection actions: cut/copy/paste/delete)

---

## 2026-03-08 — Phase 5a: Selection System Core

### What was changed
- Created `tools/selection.js` with SelectionManager (per-pixel mask, marching ants animation, rect/selectAll/deselect operations) and RectSelectTool (drag-to-select with shift/alt modifiers, live preview)
- Updated `app.js`: imports + creates SelectionManager and RectSelectTool, wires Ctrl+A/D/Escape, menu actions, tool option buttons
- Updated `index.html`: added select-rect and lasso tool option panels
- Changed `sw.js` from cache-first to **network-first** strategy — fixes stale cache issue permanently. Cache v1.6.0

### What it achieved
- Users can drag to create rectangular selections with animated marching ants
- Shift+drag adds to selection, Alt+drag subtracts
- Ctrl+A selects all, Ctrl+D deselects, Escape deselects
- Service worker now always serves fresh code during development — no more manual cache clearing

### Why it was necessary
- Selection is a core editor feature needed before crop, copy/paste, and targeted operations
- The marching ants visual is the standard way to communicate selection boundaries
- The cache-first SW strategy was causing repeated stale-file issues during development

---

## 2026-03-10 — Phase 4: Drawing Tools

### What was changed
- Created `tool-manager.js`: Tool base class with lifecycle (activate/deactivate/onPointerDown/Move/Up) + ToolManager class that routes pointer events from viewport to active tool
- Created `tools/brush.js`: Unified soft brush (radial gradient stamp, spacing, pressure) + pixel pen (Bresenham via PixelEngine, integer-snapped)
- Created `tools/eraser.js`: Soft eraser (destination-out composite) + pixel eraser (clearRect via PixelEngine)
- Created `tools/fill.js`: Flood fill tool using PixelEngine.floodFill with tolerance + contiguous mode
- Created `tools/eyedropper.js`: Color sampler from composited display with live preview on drag
- Updated `index.html`: Added tool option panels for eraser, fill (tolerance slider + contiguous checkbox), eyedropper (hint text)
- Updated `style.css`: Added hidden group rule, option-hint style, fill checkbox accent color
- Updated `app.js`: Imported all tools, created ToolManager in init(), wired tool switching, slider syncing, brush mode buttons, [/] shortcuts, color syncing, eyedropper callback
- Bumped `sw.js` cache to v1.4.0, added tool-manager.js to asset list

### What it achieved
- Users can now actually draw on the canvas with soft brush (anti-aliased, pressure-sensitive) or pixel pen (integer-snapped, Bresenham)
- Eraser removes content with matching brush settings
- Fill bucket flood-fills areas with configurable tolerance
- Eyedropper picks colors from the canvas
- All tools coexist cleanly with navigation (space+drag, pinch-zoom, middle-click) — tool events are suppressed during navigation gestures

### Why it was necessary
Phases 1–3 built the shell, engine, and algorithms — but nothing actually drew on the canvas in response to user input. The tool manager provides a clean architecture for routing pointer events while respecting the canvas engine's navigation priority. Each tool follows a consistent lifecycle pattern making future tools (selection, crop, pixelate) straightforward to add.

---

## 2026-03-08 — Phase 3: Pixel Engine & Grid

### What was changed
- Created `pixel-engine.js` (~700 lines) with PixelEngine class, Bresenham algorithms, grid overlay, palette system
- Updated `canvas-engine.js`: added pixelEngine reference, _updateTransform notifies pixel engine for grid and zoom changes, grid canvas excluded from _sizeCanvases
- Updated `app.js`: imports PixelEngine, creates and links to CanvasEngine on init, toggle-grid wired through pixelEngine.setGridVisible()
- Updated `index.html`: moved grid canvas from inside #canvas-wrapper to #canvas-viewport
- Updated `style.css`: grid canvas restyled as viewport-level overlay (z-index 10, position absolute, pointer-events none)
- Bumped sw.js cache to v1.2.0

### What it achieved
- Pixel-perfect drawing algorithms ready for tools (line, rect, ellipse, circle, flood fill)
- Grid overlay that renders in screen space — lines are always 1 CSS pixel regardless of zoom
- Grid auto-shows at ≥400% zoom, toggleable via G key or menu
- Sub-grid support for 8×8/16×16 sprite boundaries
- Palette system with 5 classic palettes built in
- Symmetry drawing support (horizontal, vertical, quad)

### Why it was necessary
Pixel art mode needs integer-snapped, anti-aliasing-free drawing algorithms. The Canvas 2D API’s built-in line/arc/rect operations use anti-aliasing that cannot be fully disabled. Bresenham algorithms give us exact pixel control. The grid overlay must live in viewport space (not document space) so lines stay 1px wide at all zoom levels.

---

## 2026-03-09 — Phase 2: Canvas Engine & Core State

### What was changed
- Created `canvas-engine.js` (~950 lines) with `Layer` class and `CanvasEngine` class
- Rewrote canvas initialization in `app.js` to use the engine. Removed `initCanvas()` stub and `centerCanvas()`. Added `import { CanvasEngine }` at top. Created engine in `init()` with all DOM element references. Wired 5 engine callbacks (zoom, cursor, three-finger, layer change, active layer). Wired zoom buttons, menu actions, mode toggle, space-to-pan (keydown + keyup), and window resize to engine methods
- Updated `style.css`: added `will-change: transform` to `#canvas-wrapper`, removed redundant `body.pixel-art-mode #canvas-wrapper` image-rendering rule

### What it achieved
The canvas now has a proper rendering engine with:
- Layer system (add/delete/duplicate/reorder/merge/flatten) with OffscreenCanvas and dirty-rect tracking
- rAF-based compositing that only runs when layers are dirty
- Mouse wheel zoom (8% per tick, centered on cursor), pinch-to-zoom with simultaneous pan on touch
- Space+drag pan, middle-mouse pan, two-finger pan
- `screenToCanvas()` / `canvasToScreen()` coordinate transforms
- `fitToScreen()` / `setZoom100()` / `setZoom200()` positioning
- Pixel art mode image-rendering toggle (per-canvas, not per-wrapper)
- Three-finger tap detection for mobile undo gesture
- `isNavigating` flag for tools to check during pointer events

### Why it was necessary
Phase 1 had only stub canvas code — the canvases were sized and centered but had no real rendering pipeline. Without the engine, no tools can draw, no layers exist, zoom/pan doesn't work, and touch gestures do nothing. The engine is the foundation for every subsequent phase.

---

## 2026-03-08 — Phase 1: Foundation & App Shell

### What was changed
Created the complete app shell for Pixoto from scratch:

- **index.html** — Full HTML structure with 30+ inline SVG icon sprites, complete panel layout (top bar, tool sidebar, canvas container, right panel, bottom toolbar, status bar), mobile drawers (tool options, layers, hamburger), modals (color picker, new canvas, export), banners (install, session restore), hidden file input
- **style.css** — 1000+ lines of mobile-first CSS with custom properties for the dark theme, responsive breakpoints at 768px and 1200px, checkerboard transparency pattern, all panel/drawer/modal styles, animations, safe-area-inset support
- **app.js** — Minimal bootstrap: service worker registration, tool selection with ripple, mode toggle, mobile drawer open/close, desktop dropdown menus, modal management, keyboard shortcuts, slider live values, color swatches, basic canvas init, cursor tracking, PWA install prompt
- **manifest.json** — PWA manifest with standalone display, file handlers, share target
- **sw.js** — Cache-first service worker with versioned cache, offline fallback
- **icons/icon.svg** — Pixoto pixel-P logo as SVG with cyan (#00d4ff) pixel blocks on dark background

### What it achieved
A fully interactive, responsive app shell that can be opened in any browser and shows the complete Pixoto UI. All panels, drawers, menus, and modals are functional. Tool selection, mode toggle, keyboard shortcuts, and color selection all work. The layout correctly adapts between mobile, tablet, and desktop breakpoints.

### Why it was necessary
This is the foundation for the entire application. Every subsequent phase (canvas engine, tools, pixel engine, etc.) builds on this HTML/CSS/JS shell. Starting with a complete, well-structured shell means:
1. All UI elements are in place before engine code is written
2. Responsive layout is proven before adding complexity
3. Mobile drawer system and touch targets are established early
4. PWA infrastructure (manifest, SW) is ready from day one
