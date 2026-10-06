# Pixoto — Phase 2 Master Plan
# Elevating Pixoto to a Professional-Grade Browser Editor

> Inspired by PixiEditor's feature depth. Targeting the browser — desktop, iPad, and mobile.
> No framework. No CDN. Vanilla JS + Canvas 2D. Every feature must work with touch.

---

## Vision

Pixoto already has a solid engine (layers, dirty-rect compositing, zoom/pan, pixel art mode, 
selection, crop, fill, brush, eraser). Phase 2 makes it a real app — the kind of thing someone
would actually use instead of Photoshop or Procreate for light to medium editing work.

The benchmark is PixiEditor (a C# desktop app). Every feature added here must be re-designed
for the browser and for touch. Desktop power — mobile-friendly execution.

---

## Hard Constraints (Non-Negotiable)

1. **Works everywhere** — Chrome/Safari desktop, iPad Safari/Chrome, Android Chrome, iOS Safari.
2. **Touch is not optional** — Every tool, handle, slider, and panel must work with a finger.
3. **No CDN / no external deps** — All code is local static files.
4. **No build step** — Native ES modules, `import/export`, directly in the browser.
5. **All touch targets ≥ 44×44px** — Buttons, handles, sliders, swatches.
6. **Never use mousedown/mousemove/mouseup** — Always Pointer Events API.
7. **Both render modes must work** — Photo (smooth) and Pixel Art (nearest-neighbor, no blur).
8. **Read before writing** — Always read a source file before editing it.
9. **Plan first, ask, then code** — Phase each feature. Confirm before starting.

---

## What Already Exists (Do Not Duplicate)

- Canvas engine: layers, compositing, zoom (10%–2000%), pan, HiDPI, dirty rects
- Pixel engine: Bresenham algorithms, pixel pen, flood fill, grid overlay, palette system
- Tool manager: routing, navigation guard, multi-touch safety
- Tools: Brush (soft + pixel pen), Eraser (soft + pixel), Fill, Eyedropper
- Selection: Rect select, Lasso, Magic wand — marching ants, add/subtract modes
- Crop tool with 8-handle overlay (touch-compatible)
- Pixelate tools: brush pixelate, rect pixelate, pixel sort
- History: undo/redo with delta storage
- File manager: open, save, export PNG/JPG/WebP, .pixoto project format
- PWA: service worker, manifest, offline, auto-save to localStorage
- UI: layers panel, color picker modal, mobile bottom drawer, hamburger menu

---

## What Is NOT Being Added

The following PixiEditor features are out of scope for browser delivery:

- Node graph / procedural rendering system (too complex, GPU-first)
- Extension/plugin SDK
- MP4 video export
- Multi-monitor / dockable panel system  
- Discord Rich Presence
- Protobuf / binary serialization
- Wasmruntime
- Cloud sync / user accounts

---

## Phase Overview

| Phase | Name                         | Priority | Complexity |
|-------|------------------------------|----------|------------|
| A     | Free Transform Tool          | CRITICAL | High       |
| B     | Layer Masking & Alpha Lock   | CRITICAL | High       |
| C     | Layer Groups / Folders       | HIGH     | Medium     |
| D     | Shape Tools & Gradient Tool  | HIGH     | Medium     |
| E     | Text Tool                    | HIGH     | Medium     |
| F     | Filters & Adjustment Layers  | HIGH     | Medium     |
| G     | Advanced Brushes             | MEDIUM   | Medium     |
| H     | Animation & Sprite Sheet     | MEDIUM   | High       |
| I     | Reference Layer & View Aids  | MEDIUM   | Low-Medium |
| J     | Color System Upgrade         | MEDIUM   | Low        |
| K     | Multi-Document Tabs          | LOW      | High       |
| L     | Node Graph (Stretch)         | STRETCH  | Very High  |

---

## Phase A — Free Transform Tool

**Goal:** Select content on any layer and move, scale, rotate, or flip it with an interactive
overlay. This is the single most-used professional operation that Pixoto currently lacks.

### Features
- Move layer contents (no crop — moves pixels, transparent fill behind)
- Scale from any of 8 handles (corners + midpoints)
- Rotate: handle appears above top-center; drag to rotate
- Flip horizontal / flip vertical (buttons in tool options)
- Constrain aspect ratio during scale: Shift held or button toggle
- Respects active selection: if a selection exists, transform only the selected pixels
- Confirm: Enter key / green ✓ button; Cancel: Escape / red ✗ button (reverts to pre-transform state)
- Numeric inputs: W, H, X, Y, Rotation shown in tool options panel (editable)

### Files to Create
- `tools/transform.js` — `TransformTool` class

### Files to Modify
- `canvas-engine.js` — add `getLayerImageData(layerIdx)`, `putLayerImageData(layerIdx, data, x, y)`
- `index.html` — transform tool option panel with W/H/X/Y/Angle inputs + Flip buttons
- `app.js` — register transform tool, wire keyboard confirm/cancel, wire flip buttons
- `tool-manager.js` — expose selection bounds for transform tool to read
- `docs/FEATURES.md`, `progress.md`, `CHANGELOG.md`

### Technical Approach
- On activate: snapshot the active layer's ImageData (for cancel), compute bounding rect of 
  non-transparent pixels (or use selection bounds if a selection is active)
- Overlay drawn on `uiCanvas`: dashed rect with 8 handle circles and a rotation handle
- Transform applied live to a scratch OffscreenCanvas; displayed as overlay — does NOT write 
  to layer until confirmed
- On confirm: write transformed pixels back to layer, clear scratch, mark dirty
- On cancel: no changes written
- Handle hit detection: 16px radius for touch (larger than visible), 8px for mouse
- Rotation: compute angle from center to pointer; offset by initial angle at drag start
- Scale: opposite handle is the fixed anchor; compute scale factor from pointer delta

### Mobile Notes
- All handles must be ≥ 44×44px touch target (draw 8px circle, 22px invisible touch zone)
- Tool options panel shows W/H/Angle on mobile; flip buttons in bottom drawer
- Confirm/Cancel also shown as floating buttons on canvas (not just keyboard)

---

## Phase B — Layer Masking & Alpha Lock

**Goal:** Non-destructive hide/reveal via layer masks. Lock painting to existing pixels via alpha lock.

### Features

#### Layer Mask
- Add mask to any layer (white = reveal all, black = hide all)
- Mask thumbnail appears next to layer thumbnail in layers panel
- Click mask thumbnail to edit mask (paint black/white; all painting goes to mask, not layer)
- Click layer thumbnail to return to editing the layer
- Active target (layer vs mask) indicated by highlight border
- Shift+click mask thumbnail: disable/enable mask (shows red X overlay)
- Alt+click mask thumbnail: view mask in grayscale on canvas (toggle)
- Apply mask: burns mask into layer alpha permanently
- Delete mask: removes mask, no change to layer pixels
- Invert mask

#### Clipping Mask
- Toggle per layer: "clip to layer below" 
- When clipped, layer's pixels are masked by the alpha of the layer immediately below it
- Visual indicator in layers panel: small clip icon, layer indented slightly
- Chaining: multiple clipped layers all clip to the first non-clipped layer below them

#### Alpha Lock
- Toggle per layer: "lock transparent pixels" (padlock with checkerboard icon)
- When active, painting only affects existing non-transparent pixels
- Works with all paint tools (brush, eraser, fill, shapes)
- Visual indicator in layers panel

### Files to Create
- `ui/mask-utils.js` — `applyMask()`, `invertMask()`, `deleteMask()`, mask rendering helpers

### Files to Modify
- `canvas-engine.js` — `Layer` class: add `mask` property (OffscreenCanvas or null),
  `maskEnabled`, `alphaPinned`, `clippingMask` properties; update `compositeFrame()` to 
  apply masks during compositing
- `ui/layers-panel.js` — mask thumbnail, clip indicator, alpha lock icon
- `index.html` — layer context menu items (Add Mask, Delete Mask, Apply Mask, Invert Mask)
- `tool-manager.js` — route paint events to mask canvas when mask is active target
- `history.js` — snapshot mask state alongside layer state
- `file-manager.js` — serialize/deserialize mask data in .pixoto format
- `docs/FEATURES.md`, `progress.md`, `CHANGELOG.md`

### Technical Approach
- Mask stored as a second OffscreenCanvas same size as the layer
- During compositing: apply mask using `destination-in` composite on an off-screen buffer before
  blending the layer into the display
- Clipping mask: after compositing a clipped layer, use `destination-in` with the layer below's alpha
- Alpha lock: when `alphaPinned`, wrap paint operations in a clip region built from the layer's
  current alpha channel (`getImageData` → create clipping path for all non-zero alpha pixels)

### Mobile Notes
- Long-press layer thumbnail → context menu with mask operations
- Mask target indicator must be clearly visible at 375px wide
- Mask editing mode banner at top: "Editing Mask — tap layer thumbnail to exit"

---

## Phase C — Layer Groups / Folders

**Goal:** Organize layers into collapsible groups. Apply shared opacity/blend to the group.

### Features
- Create group (wraps selected layers or creates empty group)
- Drag layers into/out of groups (Pointer Events drag, touch-compatible)
- Collapse/expand group in layers panel (arrow toggle)
- Group has its own opacity and blend mode
- Group composited as: flatten all group layers to temp canvas → apply group opacity/blend to scene
- Merge group: flatten group contents to a single raster layer
- Nested groups supported (up to 4 levels deep — more than enough)
- Delete group: option to keep layers (move out) or delete all contents
- Duplicate group
- Lock group (prevents editing any layer inside)

### Files to Create
- `canvas-engine.js` — `LayerGroup` class extending or alongside `Layer`

### Files to Modify
- `canvas-engine.js` — `CanvasEngine`: layer array becomes tree; compositing traverses tree;
  add/remove/move layer with parent group parameter; flatten group; get/set active layer
- `ui/layers-panel.js` — tree rendering, collapse/expand, indent children, drag-into-group
- `file-manager.js` — serialize tree structure in .pixoto
- `history.js` — snapshot tree state
- `app.js` — new group button, keyboard shortcut (Ctrl+G)
- `index.html` — new group button in layers panel header
- `docs/FEATURES.md`, `progress.md`, `CHANGELOG.md`

### Technical Approach
- Layer array in `CanvasEngine` becomes a flat array with a `parentId` reference (not a nested
  tree, which is harder to serialize) — `parentId: null` means root level
- Render order computed by topological sort at composite time
- Group composite: render all children to a temp OffscreenCanvas, then draw that to display with 
  group's globalAlpha and composite operation

### Mobile Notes
- Indent in layers panel: 12px per level (space is tight on mobile — keep shallow)
- Collapse arrow: 32×32px minimum hit area
- Drag into group: long-press layer → visual "insert here" indicator appears

---

## Phase D — Shape Tools & Gradient Tool

**Goal:** Draw anti-aliased geometric shapes and fill areas with linear/radial gradients.

### Anti-Aliased Shape Tools

#### Tools
- Rectangle (filled, outlined, or both)
- Ellipse (filled, outlined, or both)
- Line tool (single straight line, with arrowhead option)
- Polygon tool (click to place vertices, double-click to close)

Each shape tool has:
- Fill color (foreground), stroke color (background or custom), stroke width (1–50px)
- Anti-aliased (photo mode) or pixel-perfect Bresenham (pixel art mode)
- Respect active selection as clip region
- Shift key: constrain to square/circle/45° line
- Live preview while dragging (on uiCanvas)
- Written to active layer on mouseup/pointerup

#### Files to Create
- `tools/shapes.js` — `RectTool`, `EllipseTool`, `LineTool`, `PolygonTool`

#### Files to Modify
- `index.html` — tool buttons, tool option panels (fill/stroke/width toggles)
- `tool-manager.js` — register shape tools
- `app.js` — keyboard shortcuts (R rect, O ellipse)
- `docs/FEATURES.md`, `progress.md`, `CHANGELOG.md`

---

### Gradient Tool

#### Features
- Drag to define gradient start and end points
- Gradient type: Linear or Radial (toggle in tool options)
- Applies to active layer (or selection if one exists)
- Multi-stop gradient editor: add/remove/move stops, each with color + position
- Blend mode: Normal (default) or any blend mode
- Live preview: gradient shown on uiCanvas while dragging, committed on pointerup
- Foreground-to-background preset; foreground-to-transparent preset

#### Files to Create
- `tools/gradient.js` — `GradientTool`
- `ui/gradient-editor.js` — gradient stop editor panel

#### Files to Modify
- `index.html` — gradient tool button, gradient options panel/drawer
- `tool-manager.js` — register gradient tool
- `app.js` — keyboard shortcut (G is taken by grid; use Shift+G or toolbar only)
- `docs/FEATURES.md`, `progress.md`, `CHANGELOG.md`

#### Technical Approach
- Use Canvas 2D `createLinearGradient` / `createRadialGradient` — native and performant
- Gradient stops stored as `[{pos: 0–1, color: '#rrggbb', alpha: 0–1}]`
- Respect selection: after drawing gradient to temp canvas, apply selection mask before merging

### Mobile Notes
- Shape tool drag: Shift-constrain replaced by a toggle button in tool options (no keyboard on mobile)
- Gradient: single drag gesture; gradient editor in bottom drawer
- Preview line shown with start/end handles (44px touch targets)

---

## Phase E — Text Tool

**Goal:** Place editable text on a layer. Rendered to raster on commit.

### Features
- Click canvas to place a text box
- Type text (native `<textarea>` overlay positioned over canvas, rendered transparently)
- Font family: system font picker (limited to web-safe + loaded fonts)
- Font size: 8–500px
- Bold, Italic, Underline toggles
- Color: uses current foreground color
- Alignment: left / center / right
- Text committed to raster layer when user confirms (Enter or ✓ button) or switches tool
- Text box is moveable while editing (drag the box)
- Multi-line support (\n)
- On mobile: virtual keyboard opens; text box stays visible above keyboard

### Files to Create
- `tools/text.js` — `TextTool`

### Files to Modify
- `index.html` — text tool button (T), text options panel (font, size, bold/italic/align)
- `tool-manager.js` — register text tool
- `app.js` — keyboard shortcut (T)
- `style.css` — text overlay textarea styling
- `docs/FEATURES.md`, `progress.md`, `CHANGELOG.md`

### Technical Approach
- An absolutely-positioned `<textarea>` overlay on top of the canvas, hidden by default
- On pointerdown in text tool: compute canvas position, show textarea at screen-space equivalent
- Textarea styled: transparent background, colored text, font matching selection, auto-resize
- On commit: `ctx.fillText()` onto active layer with proper font/size/color; remove textarea
- Line breaks handled by splitting on `\n` and calling `fillText` per line
- `measureText()` used for bounding box calculation

### Mobile Notes
- Font size input: number input with +/- stepper (no small slider for a number this important)
- Confirm button floats near the text box when on mobile
- When virtual keyboard opens on iOS/Android, the viewport adjusts — text box must scroll into view

---

## Phase F — Filters & Adjustment Layers

**Goal:** Apply image corrections destructively or as non-destructive adjustment layers.

### Destructive Filters (Image menu)
Applied to active layer (clipped to selection if active):

| Filter         | Controls                            |
|----------------|-------------------------------------|
| Gaussian Blur  | Radius 0–100px                      |
| Sharpen        | Strength 0–100%                     |
| Unsharp Mask   | Radius, amount, threshold           |
| Invert         | No controls                         |
| Grayscale      | No controls                         |
| Sepia          | Intensity 0–100%                    |
| Posterize      | Levels 2–32                         |
| Pixelate       | Block size (already exists as tool) |
| Outline/Glow   | Color, radius, inside/outside       |
| Noise          | Amount, type (uniform/gaussian)     |

All filters show a live preview in a modal before applying.
Implemented as `ImageData` manipulation in a Web Worker (never blocks UI).

### Non-Destructive Adjustment Layers
A special layer type that stores parameters only and renders in compositing:

| Adjustment Layer   | Controls                                    |
|--------------------|---------------------------------------------|
| Brightness/Contrast| Brightness −100 to +100, Contrast −100 to +100 |
| Hue/Saturation     | Hue −180 to +180, Sat −100 to +100, Lightness −100 to +100 |
| Levels             | Black point, White point, Gamma (input + output) |
| Curves             | 4-point bezier curve per channel (R/G/B/Master) |
| Color Balance      | Shadows/Midtones/Highlights RGB sliders      |
| Vibrance           | Vibrance + Saturation sliders               |
| Gradient Map       | Map luminance to a gradient                 |
| Threshold          | Convert to 1-bit black/white                |

Adjustment layers are represented in the layer panel with a special icon.
Double-click to re-open the adjustment settings.
Affect all layers below them (within their group).

### Files to Create
- `filters/filters.js` — all destructive filter functions operating on `ImageData`
- `filters/filter-worker.js` — Web Worker wrapper for heavy filters
- `ui/filter-dialog.js` — modal preview + apply dialog
- `ui/adjustment-layer.js` — adjustment layer settings panel

### Files to Modify
- `canvas-engine.js` — `Layer` class: add `type` ('raster'|'adjustment'), `adjustmentType`, 
  `adjustmentParams`; `compositeFrame()` applies adjustment layer effects during traversal
- `ui/layers-panel.js` — adjustment layer icon, double-click to edit
- `index.html` — Image menu filter items, new adjustment layer submenu in Layer menu
- `app.js` — wire filter menu actions, create adjustment layer actions
- `history.js` — snapshot adjustment params alongside pixel data
- `file-manager.js` — serialize adjustment layer type and params
- `docs/FEATURES.md`, `progress.md`, `CHANGELOG.md`

### Technical Approach
- Destructive filters: `getImageData` → Web Worker post → `putImageData` — non-blocking
- Filter preview modal: shows a 300×300 preview tile of the center of the canvas, updates in
  real-time as sliders move (debounced 150ms)
- Adjustment layers during compositing: before compositing a layer, check if any adjustment
  layers above it in the same group need to be applied — composite to temp canvas, apply
  the adjustment in-place via pixel manipulation, then merge into display
- Curves: store 4 control points per channel, evaluate via cubic bezier at composite time

### Mobile Notes
- Filter sliders: full-width in bottom drawer, 48px height
- Filter preview: 200×200px preview on mobile (constrained by screen width)
- Adjustment layer double-tap to edit (replaces double-click)

---

## Phase G — Advanced Brushes

**Goal:** Add professional painting tools missing from the current brush set.

### Smudge Tool
- Samples pixels ahead of stroke, blends them into the stroke direction
- Strength: 0–100% (how much blending occurs)
- Size: matches brush size
- Works in both photo and pixel art mode
- File: `tools/smudge.js`

### Dodge Tool
- Lighten pixels by drawing over them
- Exposure: 0–100%, Range: Shadows / Midtones / Highlights
- Implemented via `getImageData` → adjust lightness → `putImageData` along stroke path
- File: `tools/dodge-burn.js` — `DodgeTool`

### Burn Tool
- Darken pixels by drawing over them
- Same controls as Dodge
- File: `tools/dodge-burn.js` — `BurnTool`

### Clone Stamp Tool
- Alt+click (or long-press on touch) to set source point
- Draw to stamp sampled pixels from source offset to destination
- Opacity and size controls
- Source point shown as crosshair on canvas while painting
- File: `tools/clone-stamp.js`

### Files to Modify
- `index.html` — tool buttons for smudge, dodge, burn, clone stamp + options panels
- `tool-manager.js` — register new tools
- `app.js` — keyboard shortcuts (S smudge, D dodge, B burn, C clone — check conflicts)
- `docs/FEATURES.md`, `progress.md`, `CHANGELOG.md`

### Mobile Notes
- Clone stamp source: long-press to set source point (replaces Alt+click)
- Clear visual indicator (pulsing crosshair) showing active source point

---

## Phase H — Animation & Sprite Sheet

**Goal:** Frame-by-frame animation with timeline, onion skinning, and GIF export.

### Frame System
- Each "frame" is a complete snapshot of the layer stack (array of layer data)
- Timeline panel slides up from the bottom (mobile: drawer; desktop: docked below canvas)
- Frames shown as thumbnails with frame numbers
- Add frame (duplicate current or blank), delete frame, duplicate frame
- Reorder frames: drag on desktop / long-press drag on mobile
- Frame duration: per-frame, default 100ms (configurable)
- Playback: Play/Pause button, FPS control (1–60), loop toggle
- Playback preview draws frames to display canvas in sequence

### Onion Skinning
- Previous frame: 40% opacity tint, shown behind current frame (configurable color: blue)
- Next frame: 40% opacity tint, shown ahead of current frame (configurable color: red)
- Toggle on/off per frame direction (prev/next independently)
- Onion frames rendered on a separate overlay canvas, never mixed into layer data

### Export
- Animated GIF: use a pure-JS GIF encoder (bundled locally, no CDN)
  — recommend `gif.js` bundled as a local file in `lib/gif.worker.js`
- PNG Sprite Sheet: configurable rows × columns, padding between frames, output as single PNG
- PNG sequence: download as zip (using a local `jszip` equivalent or manual Blob download loop)
- Export dialog: choose format, preview, configure

### Sprite Sheet Import
- Open image → "Slice as sprite sheet" option
- Input: columns, rows (or frame width/height)
- Slices into frames, each slice becomes a frame

### Files to Create
- `animation.js` — `AnimationManager`: frames array, playback loop, onion skinning
- `ui/timeline.js` — timeline panel UI
- `lib/gif-encoder.js` — bundled pure-JS GIF encoder
- `ui/export-animation.js` — animation export dialog

### Files to Modify
- `canvas-engine.js` — add frame concept: `frames` array, `currentFrameIndex`, 
  `switchFrame(idx)`, serialize/restore layer stack per frame
- `file-manager.js` — serialize frames in .pixoto format
- `history.js` — undo/redo must be frame-aware
- `index.html` — timeline panel HTML, playback controls, onion skinning toggles
- `app.js` — wire timeline, frame controls
- `style.css` — timeline panel styles (collapsible, touch-scrollable)
- `docs/FEATURES.md`, `progress.md`, `CHANGELOG.md`

### Mobile Notes
- Timeline scrolls horizontally (touch scroll, no custom scrollbar needed)
- Frame thumbnails: 48×48px minimum on mobile
- Playback button: FAB-style large touch target
- Timeline hidden by default on mobile (tap animation icon to show)

---

## Phase I — Reference Layer & View Aids

### Reference Layer
- Import any image as a reference layer
- Reference layers are non-destructive: never affect export output
- Locked by default (cannot paint on them)
- Adjustable opacity (useful for tracing)
- Move/scale reference layer independently (Transform tool in reference mode)
- Visual indicator in layers panel: "REF" badge
- File changes: `canvas-engine.js` Layer type 'reference', excluded from export flatten

### Viewport Rotation
- Rotate the entire view without rotating the document
- Dedicated rotate-view button in toolbar OR hold R key on desktop
- Rotation indicator in status bar; click to reset to 0°
- Two-finger rotation gesture on touch (if 3rd finger doesn't conflict with undo)
- Implemented as CSS `rotate()` transform on `#canvas-wrapper` (same as current scale/translate)
- Files: `canvas-engine.js` — add `viewRotation` state, update `_updateTransform()`,
  update `screenToCanvas()` to account for rotation

### Rulers & Guides
- Rulers on top and left edges (already in the plan from Phase 1 — implement here if not done)
- Drag from ruler to place guide line
- Mobile: tap ruler → input dialog for guide position
- Guide lines shown on grid canvas (separate render pass)
- Snap to guide when within 5px
- Double-click guide to delete; drag off canvas to delete
- File: `pixel-engine.js` — add guides array, render guides in grid canvas draw pass

### Files to Create
- Nothing new — all extends existing systems

### Files to Modify
- `canvas-engine.js` — view rotation, reference layer type, export exclusion
- `pixel-engine.js` — guide rendering
- `index.html` — rotate-view button, guide-related UI
- `app.js` — wire rotate button, guide interactions
- `style.css` — ruler styles
- `docs/FEATURES.md`, `progress.md`, `CHANGELOG.md`

---

## Phase J — Color System Upgrade

**Goal:** Make the color system as powerful as PixiEditor's without adding a library.

### Features
- Color dock (always-visible on desktop; drawer on mobile) shows:
  - HSL wheel / rectangle picker (already exists in modal — expose as dockable)
  - RGB sliders (R/G/B each 0–255)
  - HSB sliders (H 0–360, S 0–100, B 0–100)
  - CMYK preview (display only — no CMYK output)
  - Hex input (already exists)
  - Alpha slider
- Color history: last 10 used colors shown as swatches below the picker
- Palette enhancements:
  - Import palette formats: GPL (GIMP), HEX (one per line), PNG (extract most-used colors)
  - Sort palette by hue, lightness, or custom order
  - Rename palette swatches
- Gradient Map: adjustment layer (covered in Phase F)

### Files to Modify
- `ui/color-picker.js` — add RGB/HSB slider modes, color history, alpha
- `index.html` — RGB/HSB slider inputs, color history swatches, palette import button
- `pixel-engine.js` — palette import from GPL/HEX/PNG
- `style.css` — dockable color panel styles
- `docs/FEATURES.md`, `progress.md`, `CHANGELOG.md`

### Mobile Notes
- Color dock: bottom sheet with tabs (Wheel | RGB | HSB | Palette)
- Color history: horizontal scrollable row above the active palette

---

## Phase K — Multi-Document Tabs

**Goal:** Have multiple images open at the same time in separate tabs.

### Features
- Tab bar below the menu bar (desktop) or accessible via hamburger menu (mobile)
- Each tab holds its own independent `CanvasEngine`, `HistoryManager`, `FileManager` state
- Switch tabs instantly (active state swapped)
- Close tab (with unsaved-changes warning)
- New tab: opens new canvas dialog
- Open file: opens in new tab
- Maximum 8 tabs open at once (memory constraint)
- Drag image from one tab to another as a new layer (stretch goal)

### Files to Create
- `document-manager.js` — manages array of open documents, tab switching

### Files to Modify
- `app.js` — Pixoto state now references active document instead of direct engine refs;
  boot-up creates Document 1
- `index.html` — tab bar HTML
- `style.css` — tab bar styles
- `canvas-engine.js` — no changes needed (already self-contained)
- `docs/FEATURES.md`, `progress.md`, `CHANGELOG.md`

### Technical Notes
This is the highest-complexity change architecturally because `app.js` currently holds direct
references to `engine`, `pixelEngine`, `toolManager`, etc. These must be wrapped in a 
document object. Plan this phase very carefully and phase it into sub-steps.

### Mobile Notes
- On mobile: tabs shown as a scrollable horizontal strip at very top (small, 28px height)
- Or accessible via hamburger → "Open documents" list

---

## Phase L — Node Graph (Stretch Goal)

**Goal:** A visual node-based filter pipeline, non-destructive, applied to a layer group.

### Scope (minimal viable)
- Open node editor in a floating panel (desktop) or full-screen (mobile)
- Available nodes: Image Input, Blur, Brightness, Contrast, Hue-Rotate, Invert, Output
- Nodes placed by clicking; connected by drag from output port to input port
- Evaluated top-down; output written to a special "node output" layer
- Save node graph per group in .pixoto format

### Files to Create
- `nodes/node-engine.js` — node types, evaluation
- `ui/node-editor.js` — canvas-based visual editor
- `nodes/nodes-core.js` — node definitions

### Mobile Notes
This is extremely challenging on mobile. On small screens, show a simplified view only.
Full node editing is desktop-only for this phase.

---

## Universal Rules for All Phases

### After every phase, do this:
1. Update `progress.md` — mark completed items
2. Update `docs/FEATURES.md` — add the new section
3. Update `CHANGELOG.md`
4. Update `WHATWHYFIXED.md`
5. Update `sw.js` cache list with any new files
6. End response with `Files changed:` summary

### Before every phase, do this:
1. Read every file you are about to touch
2. Search for any existing implementation of the feature
3. Present the plan and ask for confirmation
4. Break into sub-phases if > 30 lines of change

### Code style
- No external libraries unless bundled locally as a static file
- Use OffscreenCanvas for heavy off-thread work where available
- Web Workers for any operation taking > 50ms (filters, GIF export)
- Pointer Events API everywhere — no mouse events
- Touch targets always ≥ 44×44px
- Debounce thumbnail updates: 250ms after last stroke (already established)
- No `console.log` left in shipped code (use `console.warn` for genuine warnings only)
