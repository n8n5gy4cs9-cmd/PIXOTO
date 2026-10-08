# Pixoto 2 — Features (what exists now)

Reference: Composa (`TEMP_TO_BE_REMOVED/Composa-main/docs`). Everything runs in the browser; nothing is uploaded.

## Window and documents
Menu bar, options bar, tool rail with FG/BG swatches, tabs (unsaved dot, close, middle-click), canvas, Layers panel, status bar. Dark Composa palette; phone/tablet layout with a bottom tool bar, slide-over Layers panel, pinch/two-finger gestures and on-screen Shift/Alt/Ctrl toggles. New Canvas presets, Open (images, `.cmps`, `.psd`/`.psb`), Place as Layers, drag and drop, Recent files, 100-step undo/redo named in the menu, autosave every 2 minutes with "Recover Unsaved Work".

## Tools (all 15)
- **Brush / Eraser**: size, hardness, stroke-level opacity, smoothing, pen pressure, Shift-click lines, Alt-click picks a colour, works on masks, limited to the selection. `[ ]` size, `{ }` hardness, 1–0 opacity. E selects Erase mode.
- **Spot Healing** (content-aware inpaint), **Clone Stamp** (Alt source, aligned, sample all layers, crosshair), **Smear**: Liquify, Blur, Smudge, Dodge, Burn.
- **Gradient**: linear/radial, foreground→background or →transparent, adjustable ends, Enter applies, works on masks.
- **Marquee** (rect/ellipse), **Lasso** (free/polygonal), **Magic** (Wand with tolerance/contiguous/sample all; Object with edge), Shift add, Alt subtract, both intersect; move outline, Ctrl-drag moves pixels (Alt copies); Expand, Contract, Feather, All, Deselect, Inverse, Subject, layer pixels/mask as selection; marching ants.
- **Move / Transform**: Auto Select, handles to scale, rotate, flip, Ctrl-corner distort, multi-layer, numeric X/Y/W/H/angle, arrow nudge, snapping with magenta guides, Ctrl-drag temporary Move with any tool, drag inside a selection moves its pixels.
- **Crop**: ratios, Shift proportions, Alt symmetric, thirds, Trim transparent edges, Enter/Escape.
- **Type**: point and paragraph text, live editing with caret and selection, per-letter colour, font, size, Bold, Italic, align, tracking, leading, box handles; text stays sharp when scaled.
- **Shape**: rectangle, rounded, ellipse, line as live layers; Rasterize Layer.
- **Eyedropper**, **Hand**, **Zoom** (generated SVG cursors).

## Layers
Folders, 24 blend modes (8 composited per pixel), opacity, layer masks (paint, invert, apply, disable, load as selection), clipping masks, six layer effects (Stroke, Drop Shadow, Color Overlay, Inner Shadow, Outer/Inner Glow), adjustment layers (all adjustments, editable, take the selection as mask), merge down/layers/group, flatten, duplicate, Layer via Copy, drag reorder/nest, Alt-click clip, eye swipe, Alt-click solo, inline rename, right-click menu, multi-select.

## Adjustments and filters (live preview, selection-limited, in a worker)
- Live previews run on a downscaled proxy through **WebGL2** (GPU), so sliders stay instant on 24 MP photos; the full-resolution pass happens once when you press OK, as a single undo step. View ▸ GPU Acceleration toggles it; without it the same previews run on the CPU worker. Commit always uses the CPU for random ops (grain, noise) and blurs so saved pixels are identical.
- Adjustments (Image menu or adjustment layer): Levels (histogram, Auto), Curves, Hue/Saturation (ranges, colorize), Brightness/Contrast, Exposure, Black & White (tint), Color Balance, Gradient Map, LUT (Leiku Vivid / Natural / Standard, Cinematic, or a loaded .cube file, with Amount; layer opacity and mask work as usual), Grain, Invert, Vibrance, Threshold, Posterize, Desaturate, Sepia, Solarize; Gaussian Blur, Motion Blur, Add Noise as layers too.
- Filters (Filter menu, Ctrl+F repeats): Blur (Gaussian, Motion, Box, Radial, Surface, Tilt-Shift), Sharpen (Sharpen, Unsharp Mask, High Pass), Noise (Add Noise, Median, Diffuse), Light (Vignette, Bloom/Glow, Tonal Contrast), Distort (Lens Correction, Wave, Ripple, Twirl, Spherize/Pinch, Chromatic Aberration, Glitch), Stylize (Pixelate, Emboss, Find Edges, Oil Paint, Halftone, Crystallize, Minimum, Maximum, Outline, Painterly), Other (Remove Background).
- Filter ▸ Camera Raw Filter… (Ctrl+Shift+A), cloned from Composa: histogram, a thumbnail that works as a white-balance eyedropper with an RGB readout, and collapsible groups with an eye to switch each off without clearing its sliders: Light, Color (Auto/Custom white balance, Temperature, Tint, Vibrance, Saturation), Color Grading (shadow/midtone/highlight/global wheels, blending, balance), Effects (Texture, Clarity, Dehaze, Glow, Vignette, Grain), Curve (parametric + per-channel point curves), Color Mixer, Detail (sharpening, noise reduction), Optics (chromatic aberration, lens profile, distortion, defringe, vignette) and Calibration. Works on any pixel layer; the last grade is remembered and Ctrl+F repeats it.

## Image and view
Canvas Size (anchor), Image Size, Trim, Crop, rotate/flip canvas and layers. Zoom 1–6400 %, fit, pixel grid, rulers, guides (drag out, move, drop on ruler to delete, lock, clear), layout grid, Snap To (guides, grid, layers, document), rotate view, remappable keyboard shortcuts (Ctrl+K; Alt variants for browser-reserved keys).

## Files
Save/Save As `.cmps` (zip with PNG layers; Composa-compatible JSON), Export PNG / JPEG / WebP with live preview and file size, Copy / Cut / Copy Merged / Paste (also from the system clipboard), paste layers across tabs, PSD import with a conversion report, File System Access API with download fallback.

## Platform
Static folder, relative paths, offline service worker, installable PWA (PNG icons), optional `.htaccess`. See `DEPLOY.md`.

## Help and updates
Help page (F1 or Help ▸ Pixoto Help): full-screen guide with every tool and its icon and modes, selections, painting, layers, adjustments, filters, view, files, touch and a live shortcut table. The service worker is network-first, so uploaded code loads on the next visit and open pages reload once when a new worker takes over; it works on https and localhost and falls back to the cache offline.

- Help (F1) has a search box that filters its sections live, and a section about LUTs.
