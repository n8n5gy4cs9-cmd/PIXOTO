# Pixoto — Features Documentation

> This document describes all implemented features and their current status.

---

## Phase 1 — Foundation & App Shell ✅

### UI Layout

- **Top Bar**: Logo + app name, undo/redo buttons, mode toggle (Photo / Pixel Art), hamburger menu (mobile)
- **Desktop Menu Bar**: File, Edit, Image, Layer, View dropdown menus with keyboard shortcut indicators
- **Tool Sidebar** (tablet/desktop): Grouped tool buttons — Drawing (Brush, Eraser, Fill), Selection (Rect Select, Lasso, Magic Wand, Crop, Move), Pixel Art (Pixel Pen, Line, Rect, Ellipse), Utility (Eyedropper, Pixelate) + foreground/background color swatches
- **Canvas Container**: Triple-canvas stack (main, grid overlay, UI overlay) inside a pannable viewport with CSS checkerboard transparency pattern
- **Right Panel** (desktop): Layers panel with blend mode dropdown + opacity slider, tool options panel, color section with hex input + swatches
- **Bottom Toolbar** (mobile): Scrollable horizontal strip of tool icons (44×44px touch targets) + layers toggle
- **Status Bar**: Zoom display with Fit/1:1/2:1 buttons, canvas dimensions, cursor coordinates, current color

### Mobile-Specific UI

- **Tool Options Drawer**: Bottom sheet that slides up, with drag handle and close button
- **Layers Drawer**: Full-height side drawer sliding from right, with layer actions at bottom
- **Hamburger Menu**: Side drawer sliding from left with File, View, and Canvas sections
- **Drawer Backdrop**: Semi-transparent overlay that closes drawers on tap

### Modals

- **New Canvas Dialog**: Also serves as splash screen on first launch. Preset sizes (800×600, 1920×1080, 1080×1080, sprite sizes 16–256px), custom W×H inputs, background options (White/Transparent/Black)
- **Export Dialog**: Format selection (PNG, JPG, WebP), quality slider for lossy formats
- **Color Picker Modal**: HSL canvas area, hue slider, alpha slider, hex/RGB/HSL value inputs, old/new color comparison

### Interactivity (Phase 1 — Shell Only)

- Tool selection with visual feedback (active state + ripple animation) synced between sidebar and bottom toolbar
- Mode toggle switches between Photo and Pixel Art (applies `pixel-art-mode` body class)
- Desktop dropdown menus with hover-to-switch behavior
- All modals open/close with overlay click to dismiss
- Slider live value display (brush size, opacity, hardness, quality)
- Color swatch quick selection with hex input
- Keyboard shortcuts: tool switching (B/E/F/M/L/C/V/P/I), Ctrl+Z/Y undo/redo, Ctrl+N new canvas, Ctrl+O open file, Ctrl+S export, G toggle grid, Tab cycle tools
- Basic cursor position tracking in status bar

### PWA

- Service worker registered on load with cache-first strategy
- Manifest with standalone display, file handlers for images and .pixoto files
- PWA install banner (deferred, dismissable, remembered)
- Session restore banner on reload if auto-save exists

### Responsive Breakpoints

| Breakpoint | Layout |
|---|---|
| < 768px (Mobile) | Full-screen canvas, bottom toolbar, drawer-based panels |
| 768–1199px (Tablet) | Tool sidebar visible, bottom toolbar hidden, right panel slides over canvas |
| ≥ 1200px (Desktop) | Full panel layout, desktop menu bar, resizable panels |

---

## Phase 2 — Canvas Engine & Core State ✅

### Canvas Engine (`canvas-engine.js`)

- **Layer System**: `Layer` class with OffscreenCanvas (falls back to regular canvas), per-layer opacity (0–1), blend mode (all Canvas composite operations), visibility toggle, lock toggle, dirty-rect tracking
- **Layer Management**: Add, delete, duplicate, reorder, merge down, merge visible, flatten all, rename — all operations notify via `onLayerChange` callback
- **Compositing**: `requestAnimationFrame`-based render loop — only composites when a layer is dirty or composite is explicitly requested. Draws all visible layers bottom-to-top onto display canvas with correct blend modes and opacity
- **Zoom & Pan**: CSS `transform: translate() scale()` on the canvas wrapper. Zoom range: 10%–2000%. Step zoom uses presets (10, 15, 20, 25, 33, 50, 66, 75, 100, 125, 150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1600, 2000). Continuous zoom via mouse wheel (8% per tick, centered on cursor). `fitToScreen()`, `setZoom100()`, `setZoom200()` convenience methods
- **Pan Controls**: Space + drag, middle-mouse drag, two-finger pan (touch). Cursor changes to grab/grabbing during navigation
- **Pinch-to-Zoom**: Two-finger gesture with simultaneous pan. Zoom centers on midpoint between fingers. Calculates canvas point under old midpoint and adjusts pan so that point stays under new midpoint
- **Three-Finger Tap**: Detected on mobile — fires `onThreeFingerTap` callback (wired to undo)
- **Coordinate Transform**: `screenToCanvas(clientX, clientY)` converts screen coordinates to document-space canvas coordinates accounting for viewport offset, pan, and zoom. `canvasToScreen(canvasX, canvasY)` does the reverse
- **Navigation State**: `isNavigating` getter returns true during pan/zoom gestures (space-drag, middle-mouse drag, pinch, or after multi-touch until all pointers released). Tools should check this before processing pointer events
- **Image Rendering**: In pixel art mode: `image-rendering: pixelated` on all canvases. In photo mode: pixelated when zoom ≥ 200%, smooth otherwise. `imageSmoothingEnabled = false` on display canvas context in pixel art mode during compositing
- **Resize**: `onResize()` method re-fits canvas to screen on window resize (debounced in app.js)
- **Export**: `getFlattenedCanvas()` returns an HTMLCanvasElement with all visible layers composited

### App Integration (`app.js` updates)

- Engine created once on init, stored as `Pixoto.engine`
- Callbacks wired: `onZoomChange` → updates `#zoom-level` display, `onCursorMove` → updates `#cursor-pos` with floor'd canvas coordinates, `onThreeFingerTap` → logs undo (Phase 7), `onLayerChange` and `onActiveLayerChange` → stubs for Phase 6
- Zoom buttons (`#btn-fit`, `#btn-zoom-100`, `#btn-zoom-200`) wired to engine methods
- Menu actions `fit-screen`, `zoom-100`, `zoom-200` wired to engine methods
- Mode toggle calls `engine.setPixelArtMode()` when switching between Photo/Pixel Art
- Space key tracked: keydown → `engine.setSpaceHeld(true)`, keyup → `engine.setSpaceHeld(false)`
- Window resize calls `engine.onResize()` (debounced 100ms)
- `initCanvas()` now calls `engine.init(width, height, bgColor)` — reads bg option from New Canvas dialog UI

### Style Changes (`style.css` updates)

- Added `will-change: transform` to `#canvas-wrapper` for GPU-accelerated CSS transforms
- Removed `body.pixel-art-mode #canvas-wrapper` image-rendering rule — now managed per-canvas by CanvasEngine
## Phase 3 — Pixel Engine & Grid ✅

### Pixel Engine (`pixel-engine.js`)

- **Bresenham Algorithms**: Line, rectangle (outline + filled), ellipse (outline + filled), circle — all pure integer, zero anti-aliasing, no sub-pixel blending
- **Pixel Drawing Primitives**: `setPixel()`, `erasePixel()`, `getPixel()` (active layer or composited), `drawLine()`, `eraseLine()`, `drawRect()`, `drawRectFilled()`, `drawEllipse()`, `drawEllipseFilled()`, `drawCircle()`, `drawCircleFilled()` — all with bounds checking and dirty-rect marking
- **Selection-Aware Drawing** (PixiEditor behavior): All pixel-level primitives (`setPixel`, `erasePixel`, `drawLine`, `eraseLine`, `floodFill`) check `selectionManager.isSelected(x, y)` before writing. When a selection is active, drawing is clipped to selected pixels. Contiguous flood fill cannot cross selection boundaries. Wired via `setSelectionManager(sm)` in `app.js`
- **Flood Fill**: Scanline flood fill with tolerance (0–255), contiguous or global all-matching-pixels mode
- **Pen Size Support**: Pixel pen size 1/2/4/8/16 — stamps square blocks along Bresenham path, each pixel individually selection-checked
- **Symmetry Drawing**: None, horizontal, vertical, or quad (4-way mirror) — `getSymmetryPoints()` returns mirrored coordinates

### Grid Overlay

- **Grid Canvas**: Moved from inside `#canvas-wrapper` to `#canvas-viewport` directly — grid is drawn in screen/viewport space so lines are always exactly 1 CSS pixel wide regardless of zoom
- **HiDPI**: Grid canvas sized at `devicePixelRatio` for crisp lines on retina displays
- **Pixel Grid**: Draws one line per document pixel column/row — only visible when zoom ≥ 200%
- **Sub-Grid**: Optional chunked grid (8×8, 16×16, etc.) for sprite tile boundaries, drawn in accent color behind the pixel grid
- **Auto-Show**: Grid automatically appears when zoom ≥ 400% (configurable threshold), auto-hides when zooming back out
- **Manual Toggle**: `G` key or View → Pixel Grid menu item toggles grid on/off — manual toggle overrides auto-show
- **Performance**: Grid only redraws when pan/zoom actually changes (cached last-drawn transform values)
- **Colors**: Default grid `rgba(255,255,255,0.12)`, sub-grid `rgba(0,212,255,0.18)` — both configurable

### Palette System

- **Preloaded Palettes**: PICO-8 (16 colors), Game Boy (4 colors), NES (54 colors), CGA (16 colors), Endesga 32 (32 colors)
- **Custom Colors**: Add/remove user swatches
- **Extract from Image**: Sample N most-used colors from any ImageData
- **Export**: Export palette as `.hex` text file (one color per line)
- **Palette API**: `getPaletteNames()`, `getPalette(key)`, `getActivePaletteColors()`, `setActivePalette(key)`

### Integration

- `canvas-engine.js`: Added `pixelEngine` reference, `_updateTransform()` now notifies pixel engine for grid redraws and zoom-based auto-show. Grid canvas excluded from `_sizeCanvases()` (pixel engine manages it)
- `app.js`: Imports `PixelEngine`, creates instance linked to `CanvasEngine`. Toggle-grid action now calls `pixelEngine.setGridVisible()`. Grid indicator dot synced.
- `index.html`: Grid canvas moved from inside `#canvas-wrapper` to `#canvas-viewport` (viewport-level overlay)
- `style.css`: Grid canvas styled as viewport-level absolute overlay with `z-index: 10`
- `sw.js`: Cache version bumped to v1.2.0

## Phase 4 — Drawing Tools ✅

### Tool Manager (`tool-manager.js`)

- **Tool Base Class**: `Tool` class with lifecycle methods: `activate()`, `deactivate()`, `onPointerDown(cx, cy, e)`, `onPointerMove(cx, cy, e)`, `onPointerUp(cx, cy, e)`, `getCursor()`
- **ToolManager Class**: Registers tools by name, routes pointer events from `#canvas-viewport` to the active tool. Handles tool switching with activate/deactivate lifecycle
- **Navigation Guard**: Checks `engine.isNavigating` and `engine.spaceHeld` before routing events — tools never fire during pan/zoom gestures
- **Multi-Touch Safety**: Only routes single-pointer primary-button events. If a second finger is added mid-stroke (triggering navigation), the stroke is cancelled cleanly via `_cancelStroke()`
- **Common State**: `foregroundColor`, `backgroundColor`, `brushSize` (1–500), `brushOpacity` (1–100), `brushHardness` (0–100), `brushMode` ('soft'/'pixel'), `fillTolerance` (0–255), `fillContiguous` (bool), `pixelPerfectMode` (bool)
- **Brush Size Adjust**: `adjustBrushSize(delta)` with non-linear stepping — small brushes change by 1, medium by 5, large by 10, very large by 25

### Brush Tool (`tools/brush.js`)

- **Soft Brush Mode**: Radial gradient stamp with configurable hardness (gradient inner stop). Spacing at 15% of diameter. Stamps placed along path with distance accumulation. Pressure-sensitive: pen stylus uses actual pressure, mouse simulates from movement speed (slow → high pressure, fast → low). Size and opacity scale with pressure (30–100% range)
- **Pixel Pen Mode**: Integer-snapped drawing using `PixelEngine.drawLine()` with Bresenham algorithm. Zero anti-aliasing. Pen sizes snap to 1/2/4/8/16. Skip-if-same-pixel deduplication
- **Pixel-Perfect Pen** (PixiEditor behavior): When `pixelPerfectMode` is enabled (size=1 only), the tool tracks the last 3 stroke waypoints and removes L-shape corner pixels in real time. An L-shape is detected when 3 consecutive positions differ diagonally and the middle point is taxicab-adjacent to both neighbors — the middle pixel is erased, producing clean diagonal strokes without 90° jaggies. Ported from `PixelPerfectPen_UpdateableChange.cs`
- **Stamp Cache**: Brush stamp canvas is cached and reused when size/hardness/opacity/color match. Rebuilt only when parameters change
- **Pressure Fallback**: Stylus → actual `e.pressure`. Mouse → speed-based simulation. Touch → `e.pressure` or 0.5 default

### Eraser Tool (`tools/eraser.js`)

- **Soft Eraser Mode**: Uses `globalCompositeOperation = 'destination-out'` with a white-alpha radial gradient stamp. Same spacing and path interpolation as soft brush. Saves and restores composite mode around each stamp
- **Pixel Eraser Mode**: Integer-snapped using `PixelEngine.eraseLine()` with clearRect. Same pen size snapping as pixel pen

### Fill Tool (`tools/fill.js`)

- **Flood Fill**: Single-click tool — calls `PixelEngine.floodFill()` at clicked canvas position with current foreground color
- **Tolerance**: Configurable 0–255 via `#fill-tolerance` slider
- **Contiguous Mode**: Toggle between contiguous (scanline flood) and global (all matching pixels) via `#fill-contiguous` checkbox
- **Selection-Aware**: Fill is clipped to the active selection — contiguous fill cannot cross selection boundaries; global fill only affects selected pixels

### Eyedropper Tool (`tools/eyedropper.js`)

- **Color Sampling**: Samples from composited display canvas (what the user sees, not just active layer)
- **Live Preview**: Continuously samples while dragging, not just on click
- **Color Update**: Updates `Pixoto.foregroundColor`, syncs all UI (hex input, preview swatch, status bar) via `onColorPicked` callback

### Tool Options UI (`index.html` additions)

- **Brush Options** (`data-for="brush"`): Mode toggle (Soft Brush / Pixel Pen), **Pixel Perfect checkbox** (visible only in Pixel Pen mode), Size slider (1–500px), Opacity slider (1–100%), Hardness slider (0–100%)
- **Eraser Options** (`data-for="eraser"`): Mode toggle (Soft / Pixel), Size slider (1–500px), Opacity slider (1–100%)
- **Fill Options** (`data-for="fill"`): Tolerance slider (0–255), Contiguous checkbox
- **Eyedropper Options** (`data-for="eyedropper"`): Hint text
- **Tool Option Visibility**: Panels show/hide automatically based on active tool. `showToolOptions()` maps tool names to option group `data-for` attributes

### App Integration (`app.js` updates)

- Imports `ToolManager`, `BrushTool`, `EraserTool`, `FillTool`, `EyedropperTool`
- Tool manager created in `init()` after engines, all 4 tools registered
- `setActiveTool()` now calls `toolManager.switchTool()` and `showToolOptions()`. Pixel-pen tool maps to brush in pixel mode
- Brush mode buttons (`[data-brush-mode]`, `[data-eraser-mode]`) wired to `toolManager.setBrushMode()`
- Sliders (`#brush-size`, `#brush-opacity`, `#brush-hardness`, `#eraser-size`, `#eraser-opacity`, `#fill-tolerance`) sync to tool manager on input
- `#fill-contiguous` checkbox wired to `toolManager.setFillContiguous()`
- `[`/`]` bracket shortcuts now call `toolManager.adjustBrushSize()` and sync slider UI
- Color changes (swatch click, hex input) sync to `toolManager.setForegroundColor()`
- Eyedropper `onColorPicked` callback updates `Pixoto.foregroundColor` + all UI
- `sw.js`: Cache version bumped to v1.4.0, added `tool-manager.js` to cache list

## Phase 5a — Selection System Core ✅

### Selection Manager (`tools/selection.js` — `SelectionManager`)

- **Per-Pixel Mask**: `Uint8Array` sized to document dimensions — 0 = unselected, 255 = selected. Auto-created/resized when needed
- **Rectangle Selection**: `setRect(x, y, w, h, mode)` — mode can be `'replace'` (default), `'add'` (shift), or `'subtract'` (alt). Clamps to document bounds
- **Select All**: `selectAll()` — fills entire mask with 255, sets bounds to full document
- **Deselect**: `deselect()` — clears mask, stops marching ants, clears UI canvas
- **Bounds Tracking**: Auto-computed bounding rect after every mask change for fast hit testing and rendering optimization
- **Pixel Query**: `isSelected(x, y)` returns boolean — future tools/operations can check if a pixel is in the selection

### Marching Ants

- **Animated**: `requestAnimationFrame` loop advances dash offset at ~0.3px/frame, creating the classic marching effect
- **Dual Stroke**: Black stroke (70% opacity) + white stroke (90% opacity) with offset dashes — visible on any background
- **Simple Rect Optimization**: If mask is a filled rectangle, draws a single `strokeRect` instead of tracing edges
- **Complex Mask Support**: Edge detection walks the bounded area, finds all pixel edges between selected and unselected, draws line segments for each edge
- **Drawn on UI Canvas**: The uiCanvas lives inside `#canvas-wrapper` sharing document coordinate space — ants scale with zoom automatically

### Rectangle Select Tool (`RectSelectTool`)

- **Drag to Select**: pointerDown records start, pointerMove updates live preview, pointerUp commits to SelectionManager
- **Modifier Keys**: Shift+drag → add to selection, Alt+drag → subtract from selection, plain drag → replace
- **Click to Deselect**: If drag area < 1px, selection is cleared
- **Live Preview**: Semi-transparent cyan fill + dashed black/white outline while dragging
- **Bounds Clamped**: Selection rect clamped to document edges

### Integration

- `app.js`: Imports SelectionManager + RectSelectTool, creates in init(), registers with ToolManager. Ctrl+A, Ctrl+D, Escape wired. Menu actions `select-all` and `deselect` wired. Button handlers for `#btn-select-all`, `#btn-deselect` (and lasso variants)
- `index.html`: Tool option panels for select-rect and lasso with hint text and Select All / Deselect buttons
- `sw.js`: Strategy changed to **network-first** — always serves fresh code when dev server is running, falls back to cache offline. No more stale-cache issues

## Phase 5 — Selection, Crop & Pixelate 🔲

## Phase 5b — Lasso + Magic Wand Tools ✅

### Lasso Tool (`tools/selection.js` — `LassoTool`)

- **Freehand Polygon**: pointerDown starts collecting points, pointerMove adds integer-snapped points with 2px downsample filter, pointerUp closes the polygon and commits
- **Scanline Rasterization**: Polygon vertices → per-pixel mask via scanline fill algorithm. For each Y row, computes edge intersections, sorts, fills between pairs
- **Modifier Keys**: Shift+drag → add to selection, Alt+drag → subtract from selection, plain drag → replace
- **Click to Deselect**: If fewer than 3 points collected, selection is cleared
- **Live Preview**: Black/white dashed polygon outline while dragging + cyan closing line hint back to start point + semi-transparent area fill

### Magic Wand Tool (`tools/selection.js` — `MagicWandTool`)

- **Color-Based Selection**: Click a pixel → samples target color from composited display → selects all matching pixels within tolerance
- **Tolerance**: 0–255 slider (default 32). Matches if all RGBA channels are within tolerance of seed color
- **Contiguous Mode**: When checked, stack-based flood fill from seed point. When unchecked, global selection of all matching pixels in document
- **Composited Sampling**: Reads from `displayCtx` after a forced synchronous `compositeNow()` — selects what you see across all visible layers
- **Modifier Keys**: Shift+click → add, Alt+click → subtract, plain click → replace
- **Keyboard Shortcut**: W

### SelectionManager Extensions

- `setFromPolygon(points, mode)` — scanline polygon-to-mask rasterizer. Handles arbitrary polygons, clamps to document bounds
- `setFromFlood(startX, startY, tolerance, contiguous, mode, imageData)` — flood-fill selection engine. Same algorithm as PixelEngine.floodFill but writes to selection mask instead of pixels

### Integration

- `canvas-engine.js`: Added `compositeNow()` public method for synchronous compositing
- `tool-manager.js`: Added `wandTolerance` (default 32) and `wandContiguous` (default true) state + setters
- `app.js`: Imports + creates + registers LassoTool and MagicWandTool. W keyboard shortcut. Wand tolerance slider + contiguous checkbox wired. showToolOptions maps `magic-wand`. Drawer names updated
- `index.html`: Magic wand SVG icon, sidebar button after lasso, bottom toolbar button after select-rect, tool option panel with tolerance slider + contiguous checkbox + Select All/Deselect buttons

## Phase 6 — UI Panels ✅

### Layers Panel (`ui/layers-panel.js`)

- **Dynamic Layer List**: Renders from `engine.layers`, top layer first, with active highlight
- **Thumbnails**: 40×40 canvas per layer with checkerboard background, debounced at 250ms
- **Visibility Toggle**: Eye icon toggles layer visibility, triggers recomposite
- **Lock Toggle**: Lock/unlock icon, prevents drawing on locked layers
- **Name Editing**: Double-click layer name → inline contentEditable, blur to commit
- **Drag Reorder**: HTML5 drag and drop between layer items → `engine.reorderLayer()`
- **Blend Mode**: Dropdown synced to active layer's blendMode (12 modes)
- **Opacity**: Slider synced to active layer's opacity (0–100%)
- **Desktop + Mobile**: Renders to both `#layers-list` and `#mobile-layers-list`

### Color Utilities (`ui/color-utils.js`)

- **Single Source of Truth**: Shared color conversion module eliminating DUP-001 (four-file duplication). All files import from here instead of defining local helpers
- **`hexToRgb(color)`**: Parses #RGB, #RRGGBB, #RRGGBBAA → `{ r, g, b, a }` (0–255). Returns null for invalid input
- **`rgbToHex(r, g, b, a?)`**: Converts to `#rrggbb` or `#rrggbbaa` (alpha omitted when 255)
- **`rgbToHsl(r, g, b)`**: → `{ h: 0–360, s: 0–100, l: 0–100 }`
- **`hslToRgb(h, s, l)`**: → `{ r, g, b }` (0–255 each)
- **`hslToHex(h, s, l)`**: Convenience wrapper for `hslToRgb` + `rgbToHex`

### Color Picker (`ui/color-picker.js`)

- **HSV/HSL Picker**: Saturation/value canvas with white→hue horizontal gradient and transparent→black vertical gradient
- **Hue Strip**: Full rainbow 0–360° horizontal slider
- **Alpha Strip**: Checkerboard + transparent→opaque gradient
- **Hex/RGB/HSL Inputs**: All synchronized bidirectionally
- **Old/New Preview**: Side-by-side comparison of current and new color
- **Pointer Events**: All canvas interactions use pointer events for touch compatibility
- **setColor(hex)**: API to set the starting color when opening the picker

### Integration

- `app.js`: LayersPanel created in init() with DOM elements. ColorPicker created with all canvas/input/preview elements. Color picker OK applies selected color, Cancel discards. Layer buttons (add/duplicate/merge/delete) wired for desktop and mobile

## Phase 5c — Selection Actions ✅

### Cut / Copy / Paste / Delete

- **Copy** (Ctrl+C): Reads selected pixels from active layer (masked by selection), stores as `Pixoto.clipboard`
- **Cut** (Ctrl+X): Copy + delete selected pixels
- **Paste** (Ctrl+V): Creates a new layer "Pasted" with clipboard contents
- **Delete** (Delete/Backspace): Clears selected pixels on active layer to transparent
- **Crop to Selection**: Resizes all layers to selection bounding box, updates engine dimensions, fits to screen

## Phase 5d — Crop Tool ✅

### Crop Tool (`tools/crop.js`)

- **Visual Overlay**: Semi-transparent black on excluded areas, white border + rule-of-thirds grid
- **8 Handles**: Corner + edge handles (NW, NE, SW, SE, N, S, W, E) with 5px visual size, 8px hit target
- **Center Drag**: Click inside crop rect to move it
- **Aspect Ratio Presets**: Free, 1:1, 4:3, 3:2, 16:9 — enforced during handle drag
- **Confirm/Cancel**: Enter/Apply button commits crop, Escape/Cancel resets
- **Drawn on UI Canvas**: Shares document coordinate space, scales with zoom
- **Tool Options Panel**: Aspect ratio buttons + confirm/cancel action buttons

## Phase 5e — Pixelation Tools ✅

### Pixelate Brush (`tools/pixelate.js` — `PixelateBrushTool`)

- **Brush-Based**: Drag to pixelate circular regions under the cursor
- **Block Size**: Configurable 2–200px (averages color within each block)
- **Brush Size**: Configurable 4–300px radius
- **Circular Masking**: Only pixelates blocks whose center falls within brush radius

### Rectangle Pixelate (`RectPixelateTool`)

- **Drag Region**: Pointer down → drag → pointer up applies pixelation to rectangular area
- **Live Preview**: Dashed cyan outline while dragging
- **Block Size**: Shared slider with brush mode

### Pixel Sort (`PixelSortTool`)

- **Glitch Art Effect**: Sorts pixel rows/columns by brightness within threshold segments
- **Threshold**: Configurable brightness threshold — only sorts segments above threshold
- **Direction**: Horizontal or vertical sorting
- **Drag Region**: Select area to apply effect, dashed orange preview

### Tool Options Panel

- Block size slider (2–100)
- Mode toggle: Brush / Rectangle / Pixel Sort

## Phase 7 — History & File Management ✅

### History System (`history.js`)

- **HistoryManager**: Captures full layer snapshots (ImageData + properties) as HistorySteps
- **Undo Stack**: Up to 50 steps, oldest dropped when limit exceeded
- **Redo Stack**: Cleared on new action, preserved on undo
- **saveSnapshot(name)**: Call before any destructive operation
- **Batch Operations**: `beginBatch()`/`endBatch()` for grouping multiple ops
- **Jump to Step**: `jumpTo(targetIndex)` for history panel navigation
- **Auto-Snapshot**: Drawing tools (brush, eraser, fill, pixelate) auto-save before strokes via pointer event capture

### File Manager (`file-manager.js`)

- **Open Image**: Loads image files onto canvas or as new layer. Handles .pixoto project files
- **Export**: Flatten → toBlob → download link. Supports PNG, JPG, WebP with quality setting
- **Save Project**: Serializes all layers as base64 PNG data URLs in JSON .pixoto format
- **Load Project**: Deserializes .pixoto JSON, rebuilds layer stack
- **Auto-Save**: 60-second interval to localStorage (with 4MB size guard)
- **Session Restore**: Reads auto-save from localStorage on startup

### Integration

- Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y → undo/redo
- Three-finger tap → undo (mobile gesture)
- Ctrl+Shift+S → save project (.pixoto)
- Ctrl+S → export dialog
- Ctrl+O → open file (images + .pixoto)
- Restore banner → FileManager.restoreSession()
- Export dialog → FileManager.exportImage() with format + quality

## Phase 8 — Service Worker & PWA Polish ✅

### Service Worker Updates

- Cache version bumped to v2.0.0
- All new modules added to ASSETS_TO_CACHE (history.js, file-manager.js, tools/crop.js, tools/pixelate.js, ui/layers-panel.js, ui/color-picker.js)
- Network-first strategy maintained for development ease

## Phase A — Free Transform Tool ✅

### TransformTool (`tools/transform.js`)

- **Move**: Drag inside the bounding box to translate the layer content
- **Scale (8 handles)**: Corner handles (TL, TR, BL, BR) scale both dimensions; edge handles (T, B, L, R) stretch one dimension; opposite corner/edge stays fixed
- **Shift+corner**: Proportional scale — constrained to the original diagonal direction
- **Ctrl+handle**: Scale from center — center stays fixed, both sides move symmetrically
- **Rotate**: Drag outside the bounding box (within ~30px) rotates around the box center; angle indicator via overlay
- **Shift+rotate**: Snaps to 15° increments
- **Flip Horizontal / Flip Vertical**: Applied at rasterization time via canvas scale(-1, 1) / scale(1, -1) in local transform space
- **Confirm (Enter / Apply button)**: Rasterizes transform into the active layer using a 6-parameter affine matrix derived from 3 corner positions — `ctx.setTransform(a,b,c,d,e,f)` + `drawImage`. Saves history snapshot before commit
- **Cancel (Escape / Cancel button)**: Restores original `ImageData` snapshot taken at activation
- **Numeric Inputs**: W, H, X (center), Y (center), Angle (degrees) — live-editing updates transform immediately
- **Touch targets**: Hit-test radius is 22px (44px diameter touch target); visual handle size is 8px screen pixels
- **Overlay**: PixiEditor-style double-dash bounding box (black + white offset dashes) drawn on `uiCanvas` in document coordinate space. Scales correctly with zoom via `lineWidth = 1/zoom`
- **Flip indicator badges**: ↔ / ↕ drawn at center when flips are pending

### Integration

- **Tool button**: Sidebar + mobile bottom toolbar; shortcut key `T`
- **Tool options panel**: W/H/X/Y/Angle numeric inputs, Flip H/V buttons, Apply/Cancel buttons
- **Floating bar**: `#transform-floating-bar` — fixed position, appears above canvas on both mobile and desktop while transform is active
- **Keyboard**: `T` to activate; `Enter` to confirm; `Escape` to cancel (checked before crop/deselect)
- **Cursor**: Dynamically updates via `pointermove` listener — `move` inside box, `nwse-resize` / `nesw-resize` / `ns-resize` / `ew-resize` on handles, `crosshair` in rotate zone
- **Photo mode**: `imageSmoothingEnabled = true` during rasterization
- **Pixel mode**: `imageSmoothingEnabled = false` during rasterization

## Phase B — Layer Masking & Alpha Lock ✅

### Layer Masks (`canvas-engine.js`, `ui/mask-utils.js`)

- **Add Mask — Reveal All**: Creates a white mask (fully transparent = fully visible) on the active layer
- **Add Mask — Hide All**: Creates a black mask (fully hidden) on the active layer
- **Mask Compositing**: `_grayscaleToAlpha()` converts mask luminance to the display canvas alpha channel using the formula `lum = 0.299R + 0.587G + 0.114B`; applied via `destination-in` to a temporary canvas per masked layer
- **Apply Mask**: Bakes the mask into the layer's alpha channel pixel-by-pixel, then discards the mask
- **Invert Mask**: Inverts all RGB values in the mask canvas (white↔black)
- **Delete Mask**: Removes the mask; layer content is unchanged
- **Disable/Enable Mask**: Toggles `maskEnabled`; disabled masks are ignored in compositing; shown with a strikethrough overlay on the thumbnail
- **Mask View Mode**: Alt+click the mask thumbnail shows the mask as grayscale on the display canvas instead of the composite; border highlights orange
- **Clipping Mask (Clip to Below)**: Clips the layer's drawn pixels to the alpha channel of the layer directly below via `destination-in` compositing
- **Mask Undo/Redo**: All mask operations are covered by the history system — mask `ImageData` is captured in every history snapshot
- **Mask Serialization**: Masks are serialized as base64 PNG data URLs in `.pixoto` files and deserialized on load

### Drawing to the Mask (`canvas-engine.js`)

- **`_MaskLayerProxy` class**: When `engine.activeTarget === 'mask'`, `getActiveLayer()` returns a proxy that routes all drawing tool calls (`ctx`, `canvas`, `markDirty()`) to the layer's mask canvas rather than the layer canvas
- **Exit mask mode**: Switching to a different layer without a mask, or clicking "Exit" in the editing banner, returns `activeTarget` to `'layer'`
- **Mask editing banner**: Fixed bar at top of canvas area with orange/cyan indicator, visible when editing a mask; "Exit" button returns to layer mode

### Layers Panel (`ui/layers-panel.js`)

- **Mask thumbnail**: 40×40px canvas displayed alongside the layer thumbnail; shows grayscale mask content, checkerboard for transparent areas
- **Click layer thumb**: Switches draw target to layer (when in mask mode)
- **Click mask thumb**: Switches draw target to the mask
- **Shift+click mask thumb**: Toggles mask enabled/disabled
- **Alt+click mask thumb**: Toggles grayscale mask view mode
- **Right-click / long-press mask thumb**: Context menu with Apply, Invert, Disable/Enable, Delete (and Add Mask when no mask exists)

### Alpha Lock (`tool-manager.js`)

- **Flag**: `layer.alphaLocked` on Layer
- **Behavior**: Before any stroke begins, the layer's full `ImageData` alpha channel is snapshotted; after stroke end, the original alpha is restored pixel-by-pixel — new paint cannot create opaque pixels in previously-transparent areas
- **Badge**: `α` in cyan displayed in the layer item
- **Toggle**: Via Layer menu > Alpha Lock, or right-click context menu

### Integration

- **Layer menu items**: Add Mask (Reveal All / Hide All), Apply Mask, Delete Mask, Invert Mask, Toggle Alpha Lock, Toggle Clip to Below
- **Layer panel button**: Mask icon button in panel header for quick Add Mask (Reveal All)
- **Export**: `getFlattenedCanvas()` applies all masks when flattening for PNG/JPG/WebP export
- **File format**: `.pixoto` version unchanged; new fields `maskData`, `maskEnabled`, `alphaLocked`, `clippedToBelow` are backward-compatible (old files default to no mask, not alpha-locked)

## Phase C — Layer Groups / Folders ✅

### LayerGroup Class (`canvas-engine.js`)

- **`LayerGroup`** exported class: `id`, `name`, `visible`, `locked`, `opacity`, `blendMode`, `children: (Layer|LayerGroup)[]`, `parent`, `collapsed`
- `dirty` getter checks if any child is dirty; `clearDirty()` and `markAllDirty()` propagate to children
- Max nesting depth: 4 levels (enforced in `createGroup()`)

### Dual Storage Architecture

- **`engine.members`**: top-level hierarchical array (Layer | LayerGroup) — used for compositing and panel rendering
- **`engine.layers`**: flat list of all leaf Layer objects — maintained by `_syncLayers()` after every structural change; used by drawing tools, resize ops, and history pixel data
- **`engine.activeMember`**: the active Layer or LayerGroup (for opacity/blend controls)

### Group Operations

| Operation | Method | Keyboard |
|---|---|---|
| Create group from active layer | `createGroup(name, layerIndices?)` | Ctrl+G |
| Ungroup (children to parent level) | `ungroup(group)` | Context menu |
| Merge group to single layer | `mergeGroup(group)` | Context menu |
| Delete group (keep children) | `deleteGroup(group, true)` | Context menu |
| Delete group + all contents | `deleteGroup(group, false)` | Context menu |
| Duplicate group (deep copy) | `duplicateGroup(group)` | Context menu |
| Collapse / expand | `toggleGroupCollapsed(group)` | Click chevron |
| Move member cross-group | `moveMember(member, targetSiblings, pos)` | Drag in panel |
| Group opacity | `setGroupOpacity(group, v)` | Opacity slider |
| Group blend mode | `setGroupBlendMode(group, mode)` | Blend dropdown |

### Compositing (`canvas-engine.js`)

- **`_compositeMembers(list, ctx, w, h)`**: recursive compositing — for groups, composites children to a temp canvas then draws with group opacity/blend; handles masks and clipping within groups
- `_composite()` delegates to `_compositeMembers(this.members, ...)` — single entry point for all compositing
- `getFlattenedCanvas()` also uses `_compositeMembers` — groups, masks, and clipping all respected during export

### Layers Panel (`ui/layers-panel.js`)

- **Tree rendering**: `_renderList()` recursively calls `renderMembers(list, depth)` — groups first, then their children with 16px per-level indentation
- **Group header** (`_createGroupItem`): chevron collapse/expand, group icon (orange), visibility, name (dblclick to rename), lock; click to select group (shows opacity/blend of the group)
- **Opacity & blend controls**: `activeMember` (Layer or LayerGroup) drives the controls; setting opacity on a group changes group compositing
- **Group context menu**: right-click on group header — Ungroup, Merge Group, Duplicate Group, Delete Group (keep/delete)
- **`_onActiveChanged`**: handles both layer activation (by index) and group activation (by id)

### History & Serialization

- **History (`history.js`)**: `HistoryStep` stores `treeSnapshot` — a JSON-serializable tree of `{type, id, ...props, children}` nodes; on restore, `_restoreTree()` rebuilds `engine.members` from the snapshot mapping layer IDs to existing Layer objects
- **File format (`file-manager.js`)**: `.pixoto` v1.1.0 adds `tree` field (group hierarchy); v1.0.0 files load with all layers at top-level for backward compatibility; layer objects now include `id` for tree reconstruction

### Integration

- **Ctrl+G**: creates a group from the currently active layer
- **Panel button**: group icon button in the layers panel header
- **Layer menu**: "Group Layer" (Ctrl+G) in Layer dropdown

---

## Phase 0 (hot-fix) — Grid Fix ✅

- **Grid color**: always white (`rgba(255,255,255,0.8)`) on the grid canvas, with `mix-blend-mode: difference` on `#grid-canvas` — grid lines invert whatever is beneath, making them visible on any background including white canvases
- **Grid Color picker**: added to View dropdown (desktop) and View section of hamburger menu (mobile) — `<input type="color">` with live update via `PixelEngine.setGridColor()`
- **Sub-grid**: secondary grid uses `rgba(255,255,255,0.4)`

---

## Phase E — Text Tool ✅

### Text Overlay (`tools/text.js`)

- Click-to-place floating textarea overlay on the canvas viewport
- Drag handle to reposition text box while editing
- Textarea style synced to tool settings (font, size, bold, italic, underline, align, color)
- **Confirm**: `Ctrl+Enter` or ✓ button — rasterizes text onto the active layer
- **Cancel**: `Escape` or ✗ button — discards text
- Clicking outside the overlay on canvas confirms current text and starts a new text box
- Multi-line support (newlines preserved), underline drawn as canvas line
- Mobile: virtual keyboard compatible (focus delayed to next animation frame)

### Tool Options Panel

| Option | Control |
|---|---|
| Font family | Select (Arial, Times, Courier, Georgia, Verdana, Impact, Comic Sans) |
| Font size | Slider 8–500px |
| Bold / Italic / Underline | Toggle buttons |
| Alignment | Left / Center / Right |

### Rasterization

- `_rasterize(layer, text)` draws each line using `ctx.fillText` with the configured font string
- Underline painted as a `ctx.strokePath` below the text baseline
- Line height: `fontSize × 1.25`
- Keyboard shortcut: **X**

---

## Phase F — Filters & Adjustment Layers ✅

### Destructive Filters (`filters/filters.js`, `filters/filter-worker.js`)

All destructive filters apply to the active layer's pixel data in-place.
Heavy filters (gaussian blur, sharpen, unsharp mask, outline) run in a Web Worker for off-main-thread execution.

| Filter | Parameters |
|---|---|
| Gaussian Blur | Radius 1–100px |
| Sharpen | Amount 0.1–5 |
| Unsharp Mask | Amount 0.1–3 |
| Invert | — |
| Grayscale | — |
| Sepia | — |
| Posterize | Levels 2–32 |
| Noise | Amount 1–100%, Monochrome toggle |
| Outline / Glow | Color, Thickness 1–20px |

### Adjustment Layers (`filters/filters.js` — `AdjustmentLayer` class)

Non-destructive. When applied, a new `AdjustmentLayer` is inserted above the current layer. The canvas engine composites it inline.

| Adjustment | Parameters |
|---|---|
| Brightness / Contrast | -100…+100 each |
| Hue / Saturation / Lightness | Hue ±180°, Sat/Light ±100 |
| Levels | In Black/White, Gamma, Out Black/White |
| Curves | Shadows/Darks/Lights/Highlights per channel |
| Color Balance | R/G/B per Shadows/Midtones/Highlights |
| Vibrance | Amount ±100 |
| Gradient Map | Shadow/Highlight color pickers |
| Threshold | 0–255 |

### Filter Dialog (`ui/filter-dialog.js`)

- Live preview canvas (max 240px, synchronized to current parameters)
- All parameter controls built dynamically per filter type
- Apply: destructive filters call `applyAdjustment()` (sync or Worker); adjustment types insert `AdjustmentLayer`
- Cancel: closes without changes
- Menu: Image → Filters / Image → Adjustments
- **Bug fix (v1.6.1):** All destructive filter types now registered in `applyAdjustment()` dispatcher (was missing gaussian-blur, grayscale, sepia, sharpen, unsharp-mask, noise, outline). Worker path uses `import.meta.url` for reliable resolution; onerror + sync fallback added.

---

## Phase G — Advanced Brushes ✅

### Smudge Tool (`tools/smudge.js`)

- Samples pixels under the brush at stroke start into a pickup buffer
- Each dab composites the pickup (circular clip, feathered alpha) at the new position
- Re-samples after each dab to propagate the smear continuously
- **Size** 2–200px, **Strength** 1–100%

### Dodge Tool (`tools/dodge-burn.js`)

- Lightens pixels by pushing RGB channels toward 255 proportionally
- Circular soft falloff brush
- **Range**: Shadows / Midtones (default) / Highlights — applies tonal weight mask
- **Size** 2–300px, **Exposure** 1–100%

### Burn Tool (`tools/dodge-burn.js`)

- Darkens pixels by multiplying RGB channels toward 0 proportionally
- Same range / exposure / size controls as Dodge

### Clone Stamp Tool (`tools/clone-stamp.js`)

- **Alt+click** (desktop) or **long-press 600ms** (mobile) sets the source point
- Subsequent paint strokes copy pixels from source + displacement to destination
- Circular soft-edge stamp with alpha compositing
- **Source crosshair overlay**: white crosshair with circle rendered on a floating canvas above the viewport
- Status label in tool options panel shows current source coordinates
- **Size** 2–300px, **Opacity** 1–100%
- Keyboard shortcut: **S**
