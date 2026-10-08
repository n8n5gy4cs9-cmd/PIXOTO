# Pixoto 2 — Product Requirements

## Product

A browser-based, layer-based image editor for compositing and retouching with Photoshop-style tools and shortcuts. A web clone of Composa. Static files only; runs on any web host, installable as a PWA, works offline.

## Users

Someone who wants Photoshop-style compositing without installing anything, on desktop, tablet or phone, and who hosts the app themselves on a basic shared server.

## Goals

1. Same window layout, tools, options, menus and shortcuts as Composa.
2. Deploy = upload a folder. No server software, no terminal, no build.
3. Non-destructive: layers, masks, effects, adjustment layers, live text/shapes, non-destructive transform.
4. Fast enough to paint on a 4K document on a mid-range laptop.

## Non-goals (v1)

RAW / HEIC / TIFF file import (the Camera Raw filter itself is in), CMYK, 16-bit, PSD export, MCP/AI agent control, auto-update, pixel-art studio, animation, server-side anything.

## Functional requirements

Reference for every row: the matching `TEMP_TO_BE_REMOVED/Composa-main/docs/*.md` page. Behaviour follows those pages.

### F1 Window & documents
- Menu bar, options bar, toolbar, tabs, canvas, layers panel, status bar (Composa layout).
- New Canvas dialog: presets (HD, 4K, 2048², Instagram portrait, A4@300, 6000×4000), custom size, background transparent/white/BG colour.
- Tabs with unsaved dot, close, middle-click close, `+`. Tool settings and colours persist across tabs.
- Undo/redo, 100 steps, menu shows step name.
- Welcome screen with New / Open and recent files; drop files anywhere.
- Autosave to IndexedDB every 2 min + "Recover Unsaved Work".

### F2 Tools (15)
Move, Marquee (rect/ellipse), Lasso (free/polygonal), Magic (Wand/Object), Crop, Brush (+Erase mode), Eraser, Spot Healing, Clone Stamp, Smear (Liquify/Blur/Smudge/Dodge/Burn), Gradient, Shape (rect/rounded/ellipse/line), Type, Eyedropper, Hand, Zoom. Per-tool modifiers and options exactly as in `docs/tools.md`.

### F3 Layers
Layers + folders, 24 blend modes (Photoshop grouping), opacity, clipping masks, layer masks (paint/fill/gradient/invert/blur/apply/disable), adjustment layers, layer effects (Stroke, Drop Shadow, Outer Glow, Inner Glow, Color Overlay, Inner Shadow), merge down/layers/group, flatten, duplicate, drag-reorder/nest, copy-paste layers across tabs, eye swipe, Alt-click solo, right-click menu, rename inline, rasterize.

### F4 Transform
Non-destructive move/scale/rotate/flip, free distort, multi-layer, auto-select, snapping (guides, grid, layers, canvas), numeric X/Y/W/H/angle, arrow nudging, Flip Layer/Canvas.

### F5 Selections
All marquee/lasso/magic modes, add/sub/intersect, move outline, move/copy pixels, Select All/Deselect/Inverse/Subject, Expand/Contract/Feather, load layer or mask as selection, Content-Aware Fill.

### F6 Adjustments & filters
Levels (auto + histogram), Curves, Hue/Saturation, Exposure, Gradient Map, Grain, Brightness/Contrast, Black & White, Color Balance, Invert, Gaussian/Motion Blur, Add Noise, Sharpen, Vignette, Bloom, Tonal Contrast, Painterly set from `Painterly.cs`. As adjustment layers (live) or applied to pixels; live preview; limited to selection.

### F7 View
Zoom 1–6400 %, fit, actual pixels, pan (space/middle/hand), pixel grid when zoomed in, rulers, guides, layout grid, snap to, lock guides, canvas rotation.

### F8 Files
Open PNG/JPEG/WebP/GIF/BMP/AVIF/SVG; open/save `.cmps`; export PNG/JPEG(live preview)/WebP; Copy Merged; clipboard paste images; PSD import (8-bit RGB, conversion report) ; File System Access API with download fallback.

### F9 Shortcuts
Full table below, remappable in a dialog (F1), conflicts reported, saved in `localStorage`, Restore Defaults.

### F10 Platform
Desktop, tablet, phone, installed PWA. Pointer Events (pen pressure, touch). Offline after first load.

## Shortcut table (defaults; "Ctrl" = Cmd on macOS)

| Area | Keys |
|---|---|
| File | New Ctrl+N · Open Ctrl+O · Save Ctrl+S · Save As Ctrl+Shift+S · Export PNG Ctrl+Shift+E · Export JPEG Ctrl+Alt+Shift+S · Close Ctrl+W |
| Edit | Undo Ctrl+Z · Redo Ctrl+Shift+Z / Ctrl+Y · Cut/Copy/Paste Ctrl+X/C/V · Copy Merged Ctrl+Shift+C · Fill FG Alt+Backspace · Fill BG Ctrl+Backspace · Clear Delete · Content-Aware Fill Shift+Backspace |
| Select | All Ctrl+A · Deselect Ctrl+D · Inverse Ctrl+Shift+I · Subject Ctrl+Alt+A · Feather Shift+F6 |
| Image | Curves Ctrl+M · Levels Ctrl+L · Hue/Sat Ctrl+U · Invert Ctrl+I · Auto Levels Ctrl+Shift+L · Canvas Size Ctrl+Alt+C · Image Size Ctrl+Alt+I |
| Layer | New Ctrl+Shift+N · Transform Ctrl+T · Duplicate / Layer via Copy Ctrl+J · Rename F2 · Clipping Mask Ctrl+Alt+G · Group Ctrl+G · Ungroup Ctrl+Shift+G · Up/Down Ctrl+] / Ctrl+[ · Merge Ctrl+E |
| View | Fit Ctrl+0 · 100 % Ctrl+1 · Zoom In/Out Ctrl +/− · Transform Controls Ctrl+H · Rulers Ctrl+R · Grid Ctrl+' · Guides Ctrl+; · Snap Ctrl+Shift+; · Lock Guides Ctrl+Alt+; |
| Help | Shortcuts F1 |
| Tools | V Move · M Marquee · L Lasso · W Magic · C Crop · B Brush · E Eraser · J Heal · S Clone · R Smear · G Gradient · U Shape · T Type · I Eyedropper · H Hand · Z Zoom |
| Tool modes | repeat key or Tab = next mode (W: Tab) · Shift+U shape |
| Colours | X swap · D reset · `\` layer/mask · Backspace delete selection/layer/effect |
| Canvas (fixed) | Space+drag / middle = pan · wheel scroll · Shift+wheel sideways · Ctrl/Alt+wheel zoom · Ctrl+drag temp-Move · arrows nudge (Shift ×10) · 1–9,0 opacity · `[` `]` size · `{` `}` hardness · Esc cancel · Enter apply · Ctrl+Enter/Esc text |

(On the web, browser-reserved combos — Ctrl+N/W/T, Ctrl+Shift+N — are intercepted when the browser allows and otherwise offered through an alternate binding; the installed PWA allows most of them. Tracked in tasks.)

## Non-functional requirements

| | |
|---|---|
| Hosting | Static files, relative paths, any sub-folder, PHP 7.4 shared host OK, no modules needed |
| Build | None. Native ES modules, vendored libs, no CDN, no runtime downloads |
| Browsers | Current Chrome, Edge, Firefox, Safari (desktop + iOS/Android) |
| Performance | 60 fps pan/zoom on 4K doc; brush latency < 16 ms; filters in workers with progress |
| Limits | Document size capped to the browser's real canvas capacity (probed at start) |
| Privacy | No uploads, no analytics; all data stays in the browser |
| Quality | Pointer Events only; `screenToCanvas()` for all coordinates; photo smoothing on / pixel grid when zoomed in |

## Acceptance

Phase is accepted when the user can perform every behaviour in the matching `docs/*.md` Composa page for that phase in a browser, and the deployed folder works when uploaded unchanged to a PHP 7.4 shared host.

## Open questions

1. OK to drop old Pixoto pixel-art studio + animation? (assumed yes)
2. Project format: Composa `.cmps` or Compositor `.comp` (folder of PNGs)? (assumed `.cmps`, ZIP)
3. App name stays "Pixoto"? (assumed yes)
