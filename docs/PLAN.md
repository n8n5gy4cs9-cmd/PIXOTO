# Pixoto 2 — Plan

Rewrite Pixoto as a web clone of **Composa** (layer-based compositing / retouching editor, Photoshop-style tools and shortcuts).

- Source of truth: `TEMP_TO_BE_REMOVED/Composa-main` (C#, Avalonia + SkiaSharp)
- Secondary: `TEMP_TO_BE_REMOVED/Compositor-main` (Swift original; use it when Composa is unclear, and for the `.comp` project format and `docs/references`)
- PixiEditor is no longer the reference for this rewrite (CLAUDE.md to be updated after approval).

## 1. Hosting constraint (drives every decision)

Target host: plain shared hosting. **No Node, no PHP modules, no SSH, no terminal.** PHP 7.4 exists but the app does not need it.

| Rule | Consequence |
|---|---|
| Upload-only deploy | The finished app is a **static folder** (HTML/CSS/JS/wasm-free). Drag it to the server by FTP/file manager. |
| No build on the server | Nothing to compile there. |
| No build on your machine either | Native ES modules, no bundler, no npm. What is in the repo is what is deployed. |
| Any sub-folder | All paths relative (`./`). Works at `example.com/pixoto/` as well as at the root. |
| Any server | No server logic, no rewrite rules required. A small optional `.htaccess` only sets MIME types / caching. |
| Offline / install | Service worker + manifest (PWA). Needs HTTPS, which shared hosts normally give. |
| Saving | Everything happens in the browser: File System Access API where available, download fallback everywhere else. Autosave to IndexedDB. |

PHP is deliberately **not used**. (Option left open: a 20-line `ping.php` can be added later if you want a "server version" check; not planned.)

### Framework decision

"Whatever framework" → **none**. A framework would force a build step, which you cannot run on the host and which CLAUDE.md forbids. Plain ES modules + Canvas 2D + Web Workers. Third-party code is vendored in `app/vendor/` (see §5).

## 2. How the Composa architecture maps to the web

| Composa (C#) | Web port |
|---|---|
| `Composa.Core/Model` (Document, Layer, BlendMode, LayerEffects, LayerTransform, Guide, History) | `app/core/model/*.js` — plain classes, same names and fields |
| `Rendering/DocumentRenderer`, `SeparableBlend`, `LayerEffectsRenderer`, `Pixels` | `app/core/render/*.js` — per-layer `OffscreenCanvas`; 16 blend modes via native `globalCompositeOperation` (+ `lighter` for Linear Dodge); remaining 8 Photoshop modes ported from `SeparableBlend.cs` as a pixel pass in a worker |
| `Painting/BrushStroke`, `Inpaint`, `EdgeTracer` | `app/core/paint/*.js` — straight port (stamp spacing, hardness falloff, stroke-level opacity, smoothing string, pressure) |
| `Selections/SelectionMask`, `MagicWand`, `ObjectSelection` | `app/core/select/*.js` — `Uint8Array` mask + marching-ants outline (port) |
| `Filters/Adjustments`, `Filters`, `Painterly` | `app/core/filters/*.js` + `filters.worker.js` — port the pixel loops; blurs/noise/vignette/bloom in worker |
| `Text/TextLayout`, `TextEditor` | `app/core/text/*.js` — layout with `measureText`, inline editor via hidden `<textarea>` |
| `Editing/EditorSession.*` (all commands) | `app/core/session/*.js` — same split (Layers, Pixels, Painting, Selection, Transform, Text, Effects, Canvas, Guides) |
| `IO/ProjectFile`, `IO/Psd/*` | `app/io/project.js` (ZIP of PNG layers + manifest, via vendored `fflate`), `app/io/psd/*` (reader port; `ag-psd` vendored only if the port proves too big) |
| `Composa.App` MainWindow, menus, Commands, Options bar | `app/ui/*.js` — DOM + CSS, same layout (menu bar, options bar, toolbar, tabs, canvas, layers panel, status bar) |
| `Controls/CanvasView.*` (input, overlay, guides, text) | `app/ui/canvas-view.js` — Pointer Events + `engine.screenToCanvas()` |
| `Icons.cs` (24-grid path data) | `app/assets/icons.svg` sprite — the path data is copied 1:1 |
| `ShortcutsDialog`, `Settings.cs` | `app/ui/shortcuts-dialog.js`, `localStorage` settings |
| `Recovery.cs` | IndexedDB autosave every 2 min, "Recover Unsaved Work" dialog |
| ImageMagick (HEIC/TIFF/RAW) | **Dropped** in v1. Browser-native formats only (PNG/JPEG/WebP/GIF/BMP/AVIF/SVG). |
| MCP / AI control, update check, packaging | **Dropped** (desktop-only). |

## 3. Layout (exactly Composa)

```
┌ Menu bar: File Edit Select Image Layer Filter View Help ───────────────┐
├ Options bar (per-tool settings) ───────────────────────────────────────┤
├ Tool │ Document tabs  [+]                         [fit][100%][+][-]    │
│ bar  ├──────────────────────────────────────────┬───────────────────── │
│ 15   │ Canvas (rulers, guides, grid, overlays)  │ Layers panel          │
│ tools│                                          │ blend / opacity       │
│ FG/BG│                                          │ rows: eye, thumb,mask │
├──────┴──────────────────────────────────────────┴───────────────────── ┤
└ Status bar: zoom · size/ppi · pointer x,y · tool hint ─────────────────┘
```

- Desktop: as above. Tablet/mobile: toolbar becomes a bottom bar, Layers panel a slide-over sheet, menu a hamburger; touch gestures (pinch zoom, two-finger pan). Pointer Events only, `touch-action: none` on the canvas.
- Dark theme with Composa's palette (`Palette.cs`).

## 4. Icons and sprites (regenerate everything)

The current tool icons are replaced entirely.

1. **Tool/UI icons** — port every `Icons.cs` path (Move, Marquee, Ellipse, Lasso, Polygon Lasso, Wand, Object, Crop, Brush, Eraser, Heal, Stamp, Smear/Drop, Gradient, Shape, Text, Eyedropper, Hand, Zoom, Eye, Folder, Mask, Adjust, Effects, Trash, align, ruler, swap…) into one `icons.svg` `<symbol>` sprite. They use `currentColor`, so they theme for free. Add the few Composa draws elsewhere (Liquify/Blur/Smudge/Dodge/Burn modes, rounded-rect, line, undo/redo) in the same 24-grid line style.
2. **App icon** — redraw from `packaging/composa.svg` (stacked layers) in Pixoto colours → `icon.svg`, plus PNG 192/512, maskable 512, apple-touch 180, favicon 32/16 rendered once locally from the SVG (committed to the repo; nothing to build on the host).
3. **Cursors** — generated SVG cursors per tool (crosshair, brush circle sized live on canvas, move, rotate, zoom ±, hand, eyedropper, clone source).
4. **UI sprites** — transparency checkerboard, blend-mode icons, handle glyphs, welcome-screen artwork. Pure CSS/SVG where possible; no raster sprite sheets.

## 5. Vendored dependencies (documented when added)

| Lib | Why | Needed |
|---|---|---|
| ~~`fflate`~~ | Not used: `app/io/zip.js` reads and writes ZIP with the browser's native `CompressionStream` / `DecompressionStream` (also inflates PSD zip channels) | n/a |
| `ag-psd` (only if needed) | PSD read if a direct port of `Psd/*.cs` is too large | Phase 7 |
| (none else) | Everything else is browser-native | |

Old `src/lib/gif-encoder.js` is not carried over (animation is out of scope).

## 6. Repository layout

```
PIXOTO/
  app/                 ← THE DEPLOYABLE APP (upload this folder)
    index.html  manifest.webmanifest  sw.js  .htaccess(optional)
    css/  assets/(icons.svg, icon-*.png, cursors/)
    core/  io/  ui/  workers/  vendor/
  docs/   PLAN.md  PRD.md  FEATURES.md  DEPLOY.md
  tasks.md             ← done / undone only
  progress.md          ← dev log (per CLAUDE.md)
  BACKUP/              ← old Pixoto src moved here after approval (nothing deleted)
  TEMP_TO_BE_REMOVED/  ← references
```

## 7. Phases (approval between each, per CLAUDE.md)

| # | Phase | Result you can test |
|---|---|---|
| 0 | Docs + approval | this plan, PRD, tasks |
| 1 | **Shell**: new `app/`, layout, theme, icon sprite, tabs, menus, status bar, New/Open image, zoom/pan, undo/redo, Layers panel (add/delete/reorder/visibility/opacity/blend), renderer | empty editor that looks like Composa, images open as layers |
| 2 | **Painting**: Brush, Eraser, Eyedropper, colours swatch/picker, Gradient, Hand, Zoom, Clone, Heal, Smear | draw and retouch |
| 3 | **Selections**: Marquee, Lasso, Magic (Wand/Object), add/sub/intersect, expand/contract/feather, move pixels | select anything |
| 4 | **Transform**: Move + handles, rotate, distort, snapping, Crop, Canvas/Image Size, Trim | full layer transform |
| 5 | **Text + Shapes** (live, re-rasterised sharp) | type and shapes |
| 6 | **Layers advanced**: folders, masks, clipping, effects, adjustment layers, Levels/Curves/etc., filters | non-destructive edits |
| 7 | **Files**: `.cmps` save/open, PNG/JPEG/WebP export, clipboard, drag-drop, PSD import, autosave/recovery | real workflow |
| 8 | **Guides/rulers/grid/snap**, shortcut remapping dialog, welcome screen | polish to Composa parity |
| 9 | **PWA + mobile/tablet + icons PNG + DEPLOY.md** | installable on your server |

### Real-time GPU previews (see `docs/PERF_PLAN.md`)

Live adjustments and most filters preview through **WebGL2** on a downscaled proxy canvas (`core/gpu/*`, `core/ops/preview.js`): the compositor draws `layer.preview` instead of `layer.canvas`, and the full-resolution pass (one undo step) runs only on commit. Every GPU op has a CPU-worker fallback (the `gpu` setting in View ▸ GPU Acceleration disables it). Filters that preview on the GPU: Gaussian/Motion/Box blur and Emboss, plus the Camera Raw Light+Color stage; everything else previews on the CPU worker. Blur, grain and noise always commit on the CPU for byte-identical saved output.

## 8. Risks

- **Performance**: Composa composites on CPU in native code; browsers are slower. Mitigation: per-layer canvases + dirty rects, `willReadFrequently` only where pixels are read, workers for filters/blend modes, tile-free until proven needed.
- **Large documents**: Composa allows 30,000 px. Browsers cap canvas area (~16k × 16k desktop, far less on iOS). Limit documents by detected capacity and tell the user.
- **Blend-mode parity**: 8 modes need pixel code; verified against Composa's tests (`tests/`).
- **Colour accuracy**: Canvas is 8-bit sRGB; no 16-bit/CMYK/RAW (stated non-goals).
- **Hosting without HTTPS**: service worker/PWA install won't work; the editor itself still does.
- **Scope**: this is a big port. Phases keep each step reviewable.

## 9. Assumptions (tell me if wrong)

1. Pixel-art studio, animation timeline and GIF export from the old Pixoto are **out of scope** (Composa has none). Old code stays in `BACKUP/`.
2. The new app replaces the old one under `app/`; the old `src/` is moved, not deleted.
3. HEIC/TIFF/RAW import (the Camera Raw *filter* is ported as `core/filters/cameraraw.js`), MCP/AI control, and auto-update are dropped.
4. Project format: Composa's `.cmps` (read its `ProjectFile.cs` first) so files are interchangeable with the desktop app where practical.
5. CLAUDE.md will be updated: reference = Composa, PixiEditor rules removed, hosting rules added.
