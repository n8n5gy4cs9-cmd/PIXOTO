# CLAUDE.md

## Pixoto

A browser clone of **Composa**: a layer-based compositing and retouching editor with Photoshop-style tools and shortcuts. It ships as a static folder (`app/`) that runs on any web host.

Read `docs/PLAN.md` (architecture), `docs/PRD.md` (requirements, shortcuts) and `tasks.md` (what is done / left) before starting work.

## Autonomy

Work without asking for approval. Plan briefly in your head, then implement, finish whole phases, and keep going to the next unchecked task in `tasks.md`. Ask the user only when a decision is truly theirs and cannot be settled by the docs, Composa, or a sensible default; in that case pick the default, note it in `progress.md`, and continue. Large changes, deleting code, renaming, touching many files and architecture changes are all allowed when the task needs them. Never delete user data: move old code to `BACKUP/` instead of deleting it.

## Reference sources

1. `TEMP_TO_BE_REMOVED/Composa-main` is the **source of truth** (C#, Avalonia + SkiaSharp). Its `docs/*.md` define behaviour; `src/Composa.Core` holds algorithms to port; `src/Composa.App` holds UI layout, icons (`Icons.cs`) and the palette (`Palette.cs`).
2. `TEMP_TO_BE_REMOVED/Compositor-main` (Swift original) when Composa is unclear.
3. `BACKUP/` holds the old Pixoto and PixiEditor-era code. Reuse snippets only when they fit; do not carry its architecture over.

Before writing any feature: search `app/` for existing code, then Composa for the behaviour. Port Composa's behaviour and defaults; do not invent new systems if Composa solves it. Design from scratch only when Composa has no equivalent (the web layer itself: input, storage, PWA).

## Hard constraints: hosting

The target host is plain shared hosting: PHP 7.4 at most, no Node, no SSH, no terminal, no build.

* Output is a **static folder**: `app/`. Upload it unchanged.
* **No build step**, no bundler, no npm, no transpiler. Native ES modules (`<script type="module">`), `.js` extensions only.
* **No PHP, no server logic.** Do not require rewrite rules; `.htaccess` may only add MIME types and caching.
* **All paths relative** (`./`). The app must work from any sub-folder.
* **No CDN, no runtime downloads, no remote dependencies.** Third-party code lives in `app/vendor/`, with a note on why in `docs/PLAN.md` §5.
* All data stays in the browser (IndexedDB, localStorage, File System Access API with download fallback).

## Stack

HTML5, CSS3, JavaScript (ES2020+), Canvas 2D, `OffscreenCanvas`, Pointer Events, Web Workers, Service Worker. No framework.

## Architecture rules

* **Layout:** `app/core` (model, rendering, painting, selection, filters; no DOM), `app/ui` (DOM, menus, panels, canvas view), `app/io` (files), `app/workers`, `app/assets`, `app/vendor`. Core must not import from `ui`.
* **Commands:** every menu item, shortcut and button runs a command from the registry in `app/core/commands.js`. Shortcuts are data, remappable, never hard-coded in handlers.
* **Coordinates:** convert with `view.screenToCanvas(clientX, clientY)` only. Never convert manually.
* **Input:** Pointer Events only (`pointerdown/move/up/cancel`); never mouse or touch events. Canvas has `touch-action: none`. Use `getCoalescedEvents()` and `pressure` for painting.
* **Rendering:** per-layer canvases composited into the document view. Smoothing on when zoomed out; nearest-neighbour and a pixel grid when zoomed in. Verify zoom, transforms, selection overlay and brush preview in both regimes.
* **Undo:** every change is a history step with a name (Composa: 100 steps).
* **Heavy work** (filters, blend passes, magic wand on big layers) runs in a worker or is chunked; never freeze the UI.
* **Mobile first:** must work on desktop, tablet, phone and the installed PWA. Touch targets at least 40 px on coarse pointers.
* **Icons:** use the SVG sprite `app/assets/icons.svg` (`<use href>`), `currentColor`. No emoji or text glyphs as icons.

## Code style

Match the surrounding code: concise, no comment noise (comment only non-obvious "why"), small modules, descriptive names, no dead code. Prefer browser-native APIs. Do not add a dependency until the feature cannot reasonably be done natively.

## Bug fixing

Trace the whole path: input, event, tool, state, render, output. A bug is fixed only when the full path is verified by reading the code.

## Testing

Never start servers. The user tests manually in a browser. You may run non-server tooling for verification, such as `node --check file.js` for syntax. Check your own work by reading and tracing carefully, because nothing is run for you.

## After every change

Update:

1. `tasks.md`: tick finished items (it holds only `[x]` / `[ ]` lines).
2. `progress.md`: date, files changed, what and why, remaining work.
3. `docs/FEATURES.md`: user-visible features that now exist.

End the final message with:

```text
Files changed:
- file: summary
```

## User preferences

* Greet the user as "Crowelian".
* Never run servers; the user tests manually.
* Search existing code, then Composa, before creating anything new.
* Keep it simple. Clone Composa rather than reinventing it.
