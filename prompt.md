Here is your **fully updated, 10/10 Pixoto prompt**:

---

# Pixoto — Professional PWA Photo & Pixel Art Editor

**Build a complete, production-ready Progressive Web App named "Pixoto" — a professional-grade photo editor and pixel art studio that works flawlessly on both mobile phones (touch-first) and desktop. Zero CDN dependencies after load. Deployable to any static web host.**

---

## 🏷 Identity & Branding
- App name: **Pixoto**
- Logo: a stylized pixel "P" mark, rendered in SVG inline
- Dark pro theme throughout — feels like native software, not a website
- Favicon and PWA icons use the Pixoto mark

---

## 📱 Mobile-First, Desktop-Polished (NON-NEGOTIABLE)

This app MUST work on real mobile phones. Every feature must be reachable via touch. This is the highest-priority constraint.

### Mobile Layout (< 768px)
- **Full-screen canvas** — no chrome eating screen space
- **Bottom toolbar**: scrollable horizontal strip of tool icons (44×44px minimum tap targets)
- **Tool options**: bottom sheet drawer that slides up when a tool is selected; swipe down to dismiss
- **Layers panel**: slides in from the right as a full-height drawer; toggle via FAB or toolbar icon
- **Color picker**: full-screen modal on mobile
- **Zoom**: pinch-to-zoom and two-finger pan (no keyboard shortcuts needed on mobile)
- **Draw**: single finger draws; two fingers pan; three fingers = undo
- **No hover states required on mobile** — all interactions must work via tap/touch alone
- **Top bar**: minimal — just "Pixoto" logo, undo/redo buttons, hamburger for file menu
- Orientation support: portrait and landscape both fully usable

### Tablet Layout (768px–1199px)
- Left tool sidebar visible (icons only, tooltips on long-press)
- Right panel slides over canvas (doesn't push it)
- Touch + mouse both work simultaneously

### Desktop Layout (≥ 1200px)
- Full panel layout: left tool sidebar, center canvas, right layers+options panel
- Resizable panels (drag dividers)
- Full keyboard shortcuts active
- Right-click context menus
- Mouse wheel zoom, middle-mouse pan

### Universal Touch/Pointer Requirements
- Use **Pointer Events API** everywhere (`pointerdown`, `pointermove`, `pointerup`) — handles mouse, touch, and stylus in one unified path
- `touch-action: none` on canvas to prevent browser scroll interference
- `pointer-events` pressure reading for stylus (optional enhancement, graceful fallback)
- No feature should require hover to discover or activate
- All sliders must be thumb-draggable on mobile (min height 36px touch target)

---

## 🗂 Layer System
- Add, delete, reorder (drag on desktop / long-press drag on mobile), show/hide, duplicate, merge down, merge all visible
- Per-layer: opacity slider (0–100%), blend mode dropdown
- **Blend modes**: Normal, Multiply, Screen, Overlay, Darken, Lighten, Color Dodge, Color Burn, Hard Light, Soft Light, Difference, Exclusion
- Layer thumbnails: live-updating 40×40px previews
- Double-tap/click layer name to rename inline
- Lock layer toggle (prevents accidental edits)
- Swipe-to-delete layer on mobile (with undo)

---

## 🔍 Zoom & Navigation
- Zoom range: **10%–2000%** (extended for pixel art work)
- Mouse wheel zoom on desktop; pinch-to-zoom on mobile
- Middle-mouse drag OR Space+drag to pan on desktop; two-finger drag on mobile
- Fit-to-screen button, 100% button, 200% button
- Zoom level shown in status bar (tappable — opens numeric input on mobile)
- **Checkerboard pattern** behind transparent areas (CSS, not canvas pixels)
- `imageSmoothingEnabled = false` when zoom ≥ 200% for pixel-crisp display

---

## ✏️ Drawing Tools

### Brush — Two Sub-Modes (toggle in tool options)

**① Soft/Round Brush (Photo Mode)**
- Adjustable: size (1–500px), opacity (1–100%), hardness (0–100%), color
- Anti-aliased smooth strokes with Bezier interpolation between pointer events
- Pressure simulation via pointer speed on mouse; real pressure via `pointerEvent.pressure` on stylus

**② Pixel Pen (Pixel Art Mode)**
- Hard pixel-accurate pen — zero anti-aliasing, zero sub-pixel blending
- Draws exact square pixels snapped to the pixel grid
- Size options: 1px, 2px, 4px, 8px, 16px (pixel multiples only)
- Always 100% opaque per stroke (layer opacity still applies)
- Essential for sprites, icons, retro pixel art

### Eraser Tool
- Matches active brush sub-mode: soft eraser or hard pixel eraser
- Adjustable size; pixel eraser snaps to grid

### Fill Bucket
- Flood fill with tolerance slider (0–255)
- Contiguous vs. all-pixels mode toggle

---

## 🟦 Pixel Art Mode

Activating **Pixel Art Mode** (toggle in top bar or View menu) transforms the workspace:

### Pixel Grid Overlay
- Toggleable grid (`G` key on desktop; grid button in toolbar on mobile)
- Auto-shows when zoom ≥ 400% (threshold configurable in settings)
- Grid color: customizable (default `rgba(255,255,255,0.12)`)
- Grid lines always 1 CSS pixel wide regardless of zoom level
- **Sub-grid**: optional chunked grid for 8×8 or 16×16 sprite boundaries, shown in a second accent color

### Pixel Art Tools
- **Pixel Pen**: as above — primary tool in this mode
- **Pixel Rectangle / Ellipse**: filled or outlined pixel-perfect shapes
- **Pixel Line**: Bresenham line algorithm, 1px clean
- **Eyedropper**: samples exact pixel color, no averaging (tap on mobile)
- **Symmetry Drawing**: horizontal, vertical, or 4-way mirror as you draw (toggle button)

### Palette System
- Custom palette panel: add/remove color swatches
- Quick-select palette colors via `1–9` keys on desktop; tap swatch on mobile
- **Preloaded palettes**: PICO-8, Game Boy, NES, CGA, Endesga-32
- Import palette from image (sample N most-used colors)
- Export palette as `.hex` text file

### Pixel Art Helpers
- **Tile Preview**: floating mini-window showing the art tiled 3×3 (live updating)
- **Onion Skinning**: previous/next frames shown at 40% opacity (for animation)
- **Nearest-neighbor zoom**: pixel art never blurs at any zoom level

### Animation (Frames)
- Frame timeline at bottom (hidden until activated — toggle in View menu)
- Add, duplicate, delete, reorder frames
- Playback with FPS control (1–60fps)
- Export as **animated GIF** or **PNG sprite sheet** (rows × columns configurable)

---

## 🔲 Selection Tools
- **Rectangle Select** — marching ants, shift to add, alt to subtract
- **Lasso** — freehand; on mobile, draw with finger
- **Magic Wand** — tolerance-based flood selection
- **Pixel Select** (pixel art mode) — exact color match selection
- Selection actions: Move contents, Copy, Cut, Paste as new layer, Delete fill, Crop to selection, Expand/Contract by N px
- On mobile: after making selection, a compact action bar appears above the selection with icon buttons

---

## ✂️ Crop Tool
- Visual overlay with 8 draggable handles + center drag (works with touch)
- Rule-of-thirds grid overlay option
- Aspect ratio presets: Free, 1:1, 4:3, 3:2, 16:9, custom W:H input
- Confirm: Enter key / green checkmark button; Cancel: Esc / red × button

---

## 🔳 Pixelation Tools

### Pixelation Brush
- Draw over areas to pixelate them in real-time
- Block size: 2–200px; brush size: 10–300px
- Cursor preview shows block grid while hovering/touching

### Rectangle Pixelate
- Drag to define region (works with touch)
- Live preview with grid overlay while dragging
- Block size slider updates preview in real-time
- Confirm / Cancel buttons

### Pixel Sort (Glitch Effect)
- Sort pixels by brightness along rows or columns within a selection or layer
- Threshold slider controls which pixels get sorted

---

## 🖼 Image Management
- **Open**: drag-drop on desktop; file picker button on mobile and desktop (`Ctrl+O`)
- **Add as new layer**: any image file, auto-named from filename
- **New canvas**: specify W×H, background color or transparent (shown as splash screen on first launch)
- **Resize canvas**: anchor point 9-way selector, add/remove from edges
- **Resize image**: bilinear (photo mode) or nearest-neighbor (pixel art mode, no blurring)
- **Export**:
  - PNG (with alpha)
  - JPG (quality slider 1–100)
  - WebP
  - Animated GIF (if frames exist)
  - PNG sprite sheet
  - On mobile: tap Export → bottom sheet with format options → saves to device via Web Share API or download link

---

## 📐 Guides & Rulers
- Pixel rulers on top and left edges (toggle `Ctrl+R` / ruler icon on mobile)
- Drag from rulers to place guide lines (on mobile: tap ruler area to add guide at center, then drag)
- Snap-to-guides toggle
- Clear all guides

---

## ⏪ History
- Unlimited undo/redo (`Ctrl+Z` / `Ctrl+Y`; three-finger tap on mobile)
- Named history steps ("Brush stroke", "Flood fill", "Delete layer"…)
- History panel (accessible via menu) — tap any step to jump to it
- Efficient delta storage — only changed pixel regions stored per step

---

## 💾 File & Project System
- **Save project**: exports `.pixoto` JSON file — full session state (all layers, frames, history, palette, settings)
- **Load project**: open `.pixoto` file to fully restore session
- **Auto-save draft** to localStorage every 60 seconds; on reload, prompt "Restore last session?"
- **Export image**: flatten all visible layers, download in chosen format

---

## 🎨 UI / UX Design

### Visual Identity
- **App name**: Pixoto — displayed in top bar with pixel-P SVG logo mark
- **Color palette**:
  - Background: `#141418`
  - Panel bg: `#1e1e26`
  - Panel border: `#2a2a36`
  - Active/selected: `#00d4ff` (electric cyan)
  - Accent 2: `#ff6b35` (pixel orange — used for pixel art mode indicator)
  - Danger: `#ff3860`
  - Text primary: `#e8e8f0`
  - Text muted: `#6b6b80`
- **Typography**: `DM Mono` for coordinates and code values; `Syne` for UI labels and the Pixoto wordmark (load as embedded base64 WOFF2 or system fallback `monospace` / `sans-serif`)
- **Icons**: inline SVG icon set — no icon font library needed
- **Micro-animations**: tool selection ripple, panel slide transitions (200ms ease), layer reorder snap

### Desktop Panel Layout
```
┌──────────────────────────────────────────────────────────────┐
│  ▪ Pixoto   File  Edit  Image  Layer  View      [Mode: Photo▾]│
├───────┬──────────────────────────────────────┬───────────────┤
│ Tools │                                      │  Layers       │
│  [B]  │   ░░░░░░░░░░ Canvas ░░░░░░░░░░       │  + ⊟ ⧉ ⬆ ⬇  │
│  [E]  │   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░       │  ┌─────────┐ │
│  [F]  │   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░       │  │ Layer 2 │ │
│  [M]  │   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░       │  │ Layer 1 │ │
│  [L]  │                                      │  └─────────┘ │
│  [C]  │                                      │  ─────────── │
│  [P]  │                                      │  Tool Props  │
│  [I]  │                                      │  Size: ████  │
│  [⊡]  │                                      │  Opac: ████  │
└───────┴──────────────────────────────────────┴───────────────┤
│  Zoom: 100% [Fit][1:1][2:1]   800×600px   x:42 y:17   #ff6b35│
└──────────────────────────────────────────────────────────────┘
```

### Mobile Layout
```
┌─────────────────────┐
│ ▪Pixoto  ↩ ↪  ≡    │  ← minimal top bar
├─────────────────────┤
│                     │
│   Full-screen       │
│   Canvas            │
│                     │
├─────────────────────┤
│ B  E  F  M  P  I ⊡ │  ← scrollable bottom toolbar
└─────────────────────┘
        ↕ swipe up = tool options drawer
```

---

## ⌨️ Keyboard Shortcuts (Desktop)
| Key | Action |
|---|---|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+O` | Open file |
| `Ctrl+S` | Export PNG |
| `Ctrl+Shift+S` | Save .pixoto project |
| `Ctrl+N` | New canvas |
| `B` | Brush |
| `E` | Eraser |
| `F` | Fill bucket |
| `M` | Rectangle select |
| `L` | Lasso |
| `C` | Crop |
| `P` | Pixel pen |
| `I` | Eyedropper |
| `G` | Toggle pixel grid |
| `[` / `]` | Brush size −/+ |
| `Space+drag` | Pan canvas |
| `Delete` | Delete selection / layer |
| `Ctrl+A` | Select all |
| `Ctrl+D` | Deselect |
| `Tab` | Cycle tools |
| `1–9` | Palette color (pixel art mode) |
| `Ctrl+R` | Toggle rulers |

---

## ⚙️ Technical Implementation

### Stack
- Vanilla HTML5 + CSS3 + JavaScript (ES2020+) — no framework
- Native HTML5 Canvas 2D API for all rendering
- Pointer Events API for all input (mouse + touch + stylus unified)
- Web Workers for heavy operations (export, pixelation on large canvas)
- OffscreenCanvas where supported

### Canvas Architecture
- Each layer = its own `OffscreenCanvas`
- Display canvas composites all layers via `requestAnimationFrame`
- Dirty-rect tracking: only re-composite changed regions
- `imageSmoothingEnabled = false` in pixel art mode and zoom ≥ 200%
- `devicePixelRatio` scaling for retina/HiDPI displays

### Pixel Art Engine
- All pixel operations bypass antialiasing entirely
- Grid drawn on a dedicated overlay canvas (never bleeds into image data)
- Bresenham algorithms for lines, circles, ellipses
- Palette stored as `Uint32Array` for O(1) color lookup

### Performance Targets
- 60fps drawing on mid-range Android phone (Chrome)
- Touch latency < 16ms (use `{passive: false}` pointer listeners on canvas only)
- Layer thumbnail debounce: 250ms after last stroke
- Auto-save debounce: 60 seconds

### PWA
- Service Worker: cache-first for all app assets, network-first for nothing (fully offline)
- `manifest.json`: `display: standalone`, correct `theme_color`, `background_color`
- Custom install prompt: "Add Pixoto to Home Screen" banner (dismissable, remembered in localStorage)
- App feels native when launched from home screen: no browser chrome, correct status bar color

---

## 📦 File Structure
```
pixoto/
├── index.html            ← App shell, all panels, SVG icons inline
├── style.css             ← All styles, CSS variables, responsive breakpoints
├── app.js                ← Bootstrap, state management, event bus
├── canvas-engine.js      ← Layer compositing, HiDPI, dirty rects
├── pixel-engine.js       ← Pixel pen, grid, Bresenham algos, palette
├── tools/
│   ├── brush.js          ← Soft brush + pixel pen unified
│   ├── eraser.js
│   ├── fill.js
│   ├── selection.js      ← Rect, lasso, magic wand, pixel select
│   ├── crop.js
│   ├── eyedropper.js
│   └── pixelate.js       ← Brush pixelate, rect pixelate, pixel sort
├── ui/
│   ├── layers-panel.js   ← Layer management UI
│   ├── tool-options.js   ← Context-sensitive options panel/drawer
│   ├── color-picker.js   ← Full HSL color picker, hex input
│   ├── palette.js        ← Pixel art palette panel
│   ├── history-panel.js
│   └── mobile-drawer.js  ← Bottom sheet drawer system
├── history.js            ← Undo/redo with delta storage
├── file-manager.js       ← Open, save, export, .pixoto format
├── animation.js          ← Frames timeline, GIF export
├── sw.js                 ← Service worker
├── manifest.json
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## ✅ Definition of Done
- [ ] Every tool works on both mobile (touch) and desktop (mouse)
- [ ] No feature requires hover to discover or use
- [ ] Pinch zoom and two-finger pan work correctly — no accidental page scroll
- [ ] Pixel pen draws pixel-perfect without any blur at all zoom levels
- [ ] Pixel grid is crisp at every zoom level (no scaling artifacts)
- [ ] Eyedropper in pixel art mode samples exact pixel (no interpolation)
- [ ] Export produces pixel-perfect PNG for pixel art (nearest-neighbor, no blur)
- [ ] App installs as PWA and works 100% offline after first load
- [ ] Auto-save restores session on reload
- [ ] Undo/redo covers every destructive action
- [ ] All panels reachable on a 375px-wide mobile screen
- [ ] 60fps drawing on mid-range Android (Chrome)
- [ ] Zero console errors or warnings
- [ ] No placeholder features, no TODO comments — every listed feature ships working

**Pixoto must feel like professional software. Ship it complete.**

---

That's your **10/10 Pixoto prompt** — branded, mobile-first by design, with every touch interaction explicitly specified so nothing gets skipped during implementation.