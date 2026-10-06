# Tasks

`[x]` done · `[ ]` not done. Nothing else in this file.

## Phase 0 — Planning
- [x] Study Composa + Compositor
- [x] Write docs/PLAN.md
- [x] Write docs/PRD.md
- [x] Write tasks.md
- [x] User approves plan

## Phase 1 — Shell
- [x] Move old `src/` to `BACKUP/`
- [x] Create `app/` skeleton (index.html, manifest, css)
- [x] Update CLAUDE.md (Composa reference, hosting rules)
- [x] Port Composa palette / dark theme
- [x] Icon sprite `icons.svg` (all Composa icons)
- [x] Menu bar + command registry
- [x] Options bar
- [x] Toolbar (15 tools, FG/BG swatches)
- [x] Status bar
- [x] Document model (Document, Layer, BlendMode, History)
- [x] Renderer (layer canvases, 16 native blend modes)
- [x] Canvas view: zoom, pan, fit, 100 %, pixel grid
- [x] Tabs
- [x] New Canvas dialog
- [x] Open image as layer, drag & drop
- [x] Undo / redo
- [x] Layers panel (add, delete, reorder, eye, opacity, blend)
- [x] Welcome screen

## Phase 2 — Painting
- [x] Brush + Erase mode
- [x] Eraser
- [x] Smoothing, pressure, Shift-line, Alt-pick
- [x] Color picker + swatches, X / D
- [x] Eyedropper
- [x] Gradient (adjustable, Enter applies)
- [x] Hand, Zoom
- [x] Clone Stamp
- [x] Spot Healing (inpaint port)
- [x] Smear: Liquify, Blur, Smudge, Dodge, Burn
- [x] Brush keys: `[ ]`, `{ }`, digits

## Phase 3 — Selections
- [x] Selection mask + marching ants
- [x] Marquee rect / ellipse
- [x] Lasso free / polygonal
- [x] Magic Wand
- [x] Object select + Select Subject
- [x] Add / subtract / intersect
- [x] Move outline, move / copy pixels
- [x] Expand, Contract, Feather
- [x] Select All, Deselect, Inverse
- [x] Content-Aware Fill

## Phase 4 — Transform
- [x] Move tool + auto select
- [x] Transform handles (scale, rotate, flip)
- [x] Free distort
- [x] Multi-layer transform
- [x] Numeric X Y W H angle
- [x] Arrow nudge, Ctrl-drag temp Move
- [x] Crop (ratios, symmetric, trim)
- [x] Canvas Size, Image Size, Flip Layer / Canvas

## Phase 5 — Text and shapes
- [x] Type tool (point + paragraph)
- [x] Text options (font, size, style, color, align, tracking, leading)
- [x] Live shape layers (rect, rounded, ellipse, line)
- [x] Rasterize layer

## Phase 6 — Layers advanced
- [x] Folders (group / ungroup)
- [x] 24 blend modes (8 via pixel pass)
- [x] Layer masks
- [x] Clipping masks
- [x] Layer effects (6 types) + dialog
- [x] Adjustment layers
- [x] Levels, Curves
- [x] Hue/Sat, Exposure, Gradient Map, Grain, Brightness/Contrast, B&W, Color Balance, Invert
- [x] Blur, Motion Blur, Noise, Sharpen, Vignette, Bloom, Tonal Contrast
- [x] Painterly, Lens Correction, Remove Background (Composa filters)
- [x] Keep the old Pixoto filters: Grayscale, Sepia, Posterize, Threshold, Vibrance, Unsharp Mask, Outline, Solarize
- [x] More filters Composa has no menu item for: Box Blur, Radial Blur, Surface Blur, Tilt-Shift, High Pass, Median, Diffuse, Wave, Ripple, Twirl, Spherize/Pinch, Chromatic Aberration, Glitch, Pixelate, Emboss, Find Edges, Oil Paint, Halftone, Crystallize, Minimum, Maximum
- [x] Repeat Last Filter (Ctrl+F)
- [x] Merge down / layers / group, Flatten
- [x] Layer right-click menu, inline rename, drag nest, Alt-solo

## Phase 7 — Files
- [x] Save / open `.cmps` (own zip on native streams, no fflate)
- [x] Export PNG, JPEG (live preview), WebP
- [x] Copy / paste, Copy Merged, paste layers across tabs
- [x] PSD import + conversion report
- [x] File System Access API + download fallback
- [x] Autosave + recovery
- [x] Recent files

## Phase 8 — View and shortcuts
- [x] Rulers, guides, grid
- [x] Snap To
- [x] Canvas rotation
- [x] Shortcut dialog + remapping
- [x] Browser-reserved key workarounds

## Phase 9 — PWA and deploy
- [x] New app icon (SVG + PNG 192/512/maskable/180/32)
- [x] Tool cursors
- [x] Service worker (offline)
- [x] Tablet / phone layout, touch gestures
- [x] Canvas size limit probe
- [x] `.htaccess` (MIME, cache)
- [x] docs/DEPLOY.md (upload steps, PHP 7.4 host)
- [x] docs/FEATURES.md rewritten
- [ ] Test on shared host
- [x] Help page (F1)
- [x] Network-first service worker, auto update
- [x] Filter worker fallback and visible preview errors
