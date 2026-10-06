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
- [ ] Brush + Erase mode
- [ ] Eraser
- [ ] Smoothing, pressure, Shift-line, Alt-pick
- [ ] Color picker + swatches, X / D
- [ ] Eyedropper
- [ ] Gradient (adjustable, Enter applies)
- [ ] Hand, Zoom
- [ ] Clone Stamp
- [ ] Spot Healing (inpaint port)
- [ ] Smear: Liquify, Blur, Smudge, Dodge, Burn
- [ ] Brush keys: `[ ]`, `{ }`, digits

## Phase 3 — Selections
- [ ] Selection mask + marching ants
- [ ] Marquee rect / ellipse
- [ ] Lasso free / polygonal
- [ ] Magic Wand
- [ ] Object select + Select Subject
- [ ] Add / subtract / intersect
- [ ] Move outline, move / copy pixels
- [ ] Expand, Contract, Feather
- [ ] Select All, Deselect, Inverse
- [ ] Content-Aware Fill

## Phase 4 — Transform
- [ ] Move tool + auto select
- [ ] Transform handles (scale, rotate, flip)
- [ ] Free distort
- [ ] Multi-layer transform
- [ ] Numeric X Y W H angle
- [ ] Arrow nudge, Ctrl-drag temp Move
- [ ] Crop (ratios, symmetric, trim)
- [ ] Canvas Size, Image Size, Flip Layer / Canvas

## Phase 5 — Text and shapes
- [ ] Type tool (point + paragraph)
- [ ] Text options (font, size, style, color, align, tracking, leading)
- [ ] Live shape layers (rect, rounded, ellipse, line)
- [ ] Rasterize layer

## Phase 6 — Layers advanced
- [ ] Folders (group / ungroup)
- [ ] 24 blend modes (8 via pixel pass)
- [ ] Layer masks
- [ ] Clipping masks
- [ ] Layer effects (6 types) + dialog
- [ ] Adjustment layers
- [ ] Levels, Curves
- [ ] Hue/Sat, Exposure, Gradient Map, Grain, Brightness/Contrast, B&W, Color Balance, Invert
- [ ] Blur, Motion Blur, Noise, Sharpen, Vignette, Bloom, Tonal Contrast
- [ ] Merge down / layers / group, Flatten
- [ ] Layer right-click menu, inline rename, drag nest, Alt-solo

## Phase 7 — Files
- [ ] Save / open `.cmps` (fflate vendored)
- [ ] Export PNG, JPEG (live preview), WebP
- [ ] Copy / paste, Copy Merged, paste layers across tabs
- [ ] PSD import + conversion report
- [ ] File System Access API + download fallback
- [ ] Autosave + recovery
- [ ] Recent files

## Phase 8 — View and shortcuts
- [ ] Rulers, guides, grid
- [ ] Snap To
- [ ] Canvas rotation
- [ ] Shortcut dialog + remapping
- [ ] Browser-reserved key workarounds

## Phase 9 — PWA and deploy
- [ ] New app icon (SVG + PNG 192/512/maskable/180/32)
- [ ] Tool cursors
- [ ] Service worker (offline)
- [ ] Tablet / phone layout, touch gestures
- [ ] Canvas size limit probe
- [ ] `.htaccess` (MIME, cache)
- [ ] docs/DEPLOY.md (upload steps, PHP 7.4 host)
- [ ] docs/FEATURES.md rewritten
- [ ] Test on shared host
