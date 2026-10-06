---
mode: 'agent'
tools: ['codebase']
---

// Trigger this with:
// Use #audit-pixoto
// Use #audit-codebase.prompt.md

# Pixoto — Code Audit

You are auditing the Pixoto codebase. Work through it methodically and report
everything you find. Do NOT fix anything. Do NOT suggest refactors. Report only.

---

## Before You Start

Read `BUGS.md` before doing anything else. It is the single source of truth
for all known Pixoto bugs. It has two sections:

**Part 1 — Fixed Bugs (✅):** Do NOT re-report these. If you find a regression
(a fixed bug that is broken again), move it back to Part 2 with a note:
"REGRESSION — was fixed, now broken again because [reason]".

**Part 2 — Unfixed Bugs (⬜):** Do NOT re-report these either.

---

## What to Look For

### 1. Bugs & Logic Errors
- Canvas state that is set but never restored (missing `save()`/`restore()` pairs)
- `imageSmoothingEnabled` being left in the wrong state after a tool operation
- Dirty-rect bounds that are off-by-one or fail to cover the full changed region
- Pointer event handlers that call `preventDefault()` in the wrong place, causing
  touch scroll to break or draw to fail
- Layer compositing order that produces incorrect blend results
- Undo/redo delta that captures too little or too much — leaves canvas in wrong state
- History steps that are not recorded for a destructive action
- Color picker that returns a wrong or out-of-range value
- Flood fill that can overflow the call stack on large canvases (recursion vs queue)
- Export that produces a blurred result for pixel art (wrong `imageSmoothingEnabled`
  state during flatten)
- Eyedropper that samples a composited/scaled pixel instead of the raw layer pixel
- Pixel pen that introduces sub-pixel blending (antialiasing not fully disabled)
- Grid overlay that bleeds into image data (drawn on wrong canvas)
- Pinch-to-zoom that accumulates floating-point drift over many gestures
- Two-finger pan conflicting with single-finger draw (wrong touch count check)
- Auto-save that serializes an incomplete or mid-stroke state
- `.pixoto` project load that leaves ghost state from the previous session
- Service worker that serves a stale cached file after an app update
- Palette color index that goes out of bounds when swatches are deleted

### 2. Zombie Code
- Event listeners that are registered but never removed (memory leaks on panel
  open/close cycles)
- Tool classes that are instantiated but never activated by any toolbar button
- CSS classes that are defined but never applied to any element
- localStorage keys that are written but never read back
- Canvas layers (OffscreenCanvas objects) that are created but never composited
- Tool option UI controls that update a variable that no tool reads
- Keyboard shortcut handlers registered for shortcuts not listed in the docs
- Shortcuts listed in docs that have no corresponding handler in code

### 3. Duplicate Code
- The same canvas transform/scale logic copy-pasted across multiple tool files
- Color conversion (hex↔rgb↔hsl) implemented more than once
- Pointer event normalisation (offsetX/Y correction for device pixel ratio)
  duplicated across tools instead of going through a shared utility
- Mobile bottom drawer open/close logic duplicated in multiple UI files
- The same dirty-rect expansion logic written independently in multiple places

### 4. Touch & Mobile Risks
- Any interactive element with a touch target below 44×44px
- Any feature that relies on `:hover` to be discoverable or functional
- Any `mousedown`/`mousemove`/`mouseup` listener used instead of Pointer Events API
- Canvas element missing `touch-action: none`
- Pinch gesture that does not call `preventDefault()`, allowing the browser to
  zoom the page instead of the canvas
- Bottom drawer that cannot be reached on a 375px-wide screen
- Any slider or input that is too small to drag accurately with a thumb
- Color picker that does not open as a full-screen modal on mobile

### 5. PWA & Offline Risks
- Service worker that does not cache a file that the app needs offline
- `manifest.json` missing required fields (`start_url`, `display`, `icons`)
- Install prompt that fires on every load instead of once (localStorage flag missing)
- Auto-save that silently fails when localStorage is full, with no error shown
- `.pixoto` file export that fails on iOS Safari (Blob download fallback missing)
- Animated GIF export that blocks the main thread instead of using a Web Worker
- Any `fetch()` call that has no offline fallback

### 6. Render Mode Consistency
- Any tool that behaves differently between photo mode and pixel art mode in a
  way that is not intentional
- `imageSmoothingEnabled` not being toggled correctly when switching modes
- Zoom level that produces blurry pixel art (nearest-neighbor not enforced)
- Grid overlay that remains visible after pixel art mode is turned off
- Sub-grid that renders at the wrong size or wrong color after a canvas resize

### 7. State & Memory
- OffscreenCanvas objects that are never released when a layer is deleted
- Web Worker that is spawned for every brush stroke instead of being kept alive
- Image data arrays allocated inside `requestAnimationFrame` loop (GC pressure)
- Event listeners on `window` or `document` that are never cleaned up
- History stack that grows without bound — no cap and no memory pressure handling

---

## How to Report

For each issue found, report it like this:

**[TYPE]** `filename.js:line` — short description of the problem
Why it is a problem: one sentence
Severity: HIGH / MEDIUM / LOW

Types: BUG · ZOMBIE · DUPLICATE · TOUCH-RISK · PWA-RISK · RENDER · MEMORY

---

## What NOT to Do
- Do not fix anything
- Do not suggest refactors
- Do not rewrite anything
- Do not make any file changes whatsoever
- If uncertain whether something is a bug, report it as LOW severity with a note
  saying "needs verification"

---

## When Done

Produce a summary table:

| Severity | Count |
|----------|-------|
| HIGH     | X     |
| MEDIUM   | X     |
| LOW      | X     |
| **Total**| X     |

Write all new bugs to `BUGS.md`. Keep all existing bugs. Add new bugs to the
top of the file. Do not delete any existing entry. If a bug is already fixed,
mark it ✅ but keep it for historical reference.

If you find a previously fixed bug that is broken again, move it back to the
unfixed section and mark it:
"REGRESSION — was fixed, now broken again because [reason]"

When a bug is fixed (in a future session), move it out of `BUGS.md` into
`FIXED_BUGS.md` with a clear entry covering:
- What was wrong
- What was changed to fix it
- How to verify the fix on both mobile and desktop

---

Then ask: "Which issues would you like to address first, Crowelian?"