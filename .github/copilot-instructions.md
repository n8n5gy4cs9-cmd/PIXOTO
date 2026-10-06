
# Pixoto — Agent Instructions

> This file is read automatically by Claude Code at the start of every session.
> These rules apply to every task, every file, every change. No exceptions.

---

## Project Identity

**Project:** Pixoto v1.0.0 (this will change as the project evolves)
**Type:** Progressive Web App — Professional Photo & Pixel Art Editor
**Stack:** Vanilla HTML5 · CSS3 · JavaScript (ES2020+) · HTML5 Canvas 2D API · Pointer Events API · Web Workers · OffscreenCanvas · Service Worker (PWA)
**Build system:** None — static files, deployable to any web host
**Key source files:**
- `index.html` — app shell, all panels, inline SVG icons
- `style.css` — all styles, CSS variables, responsive breakpoints
- `app.js` — bootstrap, global state, event bus
- `canvas-engine.js` — layer compositing, HiDPI scaling, dirty-rect rendering
- `pixel-engine.js` — pixel pen, grid overlay, Bresenham algorithms, palette system
- `tools/brush.js` — soft brush + pixel pen unified tool
- `tools/selection.js` — rect, lasso, magic wand, pixel select
- `tools/pixelate.js` — brush pixelate, rect pixelate, pixel sort
- `ui/layers-panel.js` — layer management UI
- `ui/mobile-drawer.js` — bottom sheet drawer system
- `history.js` — undo/redo with delta storage
- `file-manager.js` — open, save, export, .pixoto format
- `sw.js` — service worker
- `manifest.json` — PWA manifest

---

## Rules — Follow These on Every Single Task

### 0. Always greet me as "Crowelian".
- Every time Greet me as Crowelian.

### 0b. Check it doesn't already exist
- Search the relevant source file for the function or feature before writing anything
- Search `index.html` for any existing UI element that covers the same purpose
- Search `style.css` for existing classes before adding new ones
- If anything similar exists — stop and report it before proceeding

Do not add a function, class, or UI element that already exists or duplicates existing functionality. If you find something similar but not identical, ask: "Found X which does Y — is that sufficient or do you need something different?"

---

### 1. Always Plan First, Act Second

Before making any change, write out:
- What you are going to change and in which files
- Why this change fixes the problem or implements the feature
- Any risks or side effects
- Whether any other part of the app depends on what you are changing

Then ask: **"Does this plan look correct before I proceed?"**

Do not start editing files until the plan is confirmed.

---

### 1b. Big Tasks Must Be Done in Phases

If a task touches more than 2 files, adds a new system, or would take more than ~30 lines of changes — **break it into phases** and present the full phase plan to the user before starting.

Format your phase plan like this:

```
Phase 1 — [Name]: What this phase does and what files it touches
Phase 2 — [Name]: What this phase does and what files it touches
Phase 3 — [Name]: What this phase does and what files it touches
...

Shall I begin with Phase 1?
```

Do not start any phase until the user confirms. After completing each phase, summarize what was done and ask for confirmation before moving to the next phase. Never silently roll multiple phases into one.

---

### 2. Always Ask Before These Actions

**Stop and ask before you:**

- Delete or remove more than ~20 lines of code
- Remove an entire function, component, or system
- Add any new third-party library or external dependency
- Remove any existing library or dependency
- Rename a function, class, or file that other code depends on
- Change the structure of a core file at an architectural level
- Make a change that affects more than 3 files at once
- Do anything you are not confident about

When asking, always include:
- What you want to do
- Why it is necessary
- What the alternative options are
- What happens if we do NOT do this

---

### 3. Never Assume — Always Verify

If something is unclear, **ask**. Do not guess and proceed.

If the intended behaviour cannot be determined from reading the code, describe what you see and ask what the correct behaviour should be.

---

### 4. Read Before Writing

Always read the relevant source files before editing them. Never edit a file you have not read in this session. Files are interconnected — a CSS change can break mobile layout, a canvas state change can break undo, a pointer event change can break touch.

---

### 5. One System at a Time

Fix one thing completely before moving to the next. Do not batch unrelated fixes into a single edit. Each fix should be its own focused change with its own explanation.

---

### 6. The "Works Everywhere" Standard

Every feature must work correctly in all four contexts:

1. **Mobile phone (touch)** — single-finger draw, pinch zoom, two-finger pan, bottom drawer, FAB buttons, no hover required
2. **Tablet (touch + mouse)** — panels visible, touch and mouse both functional simultaneously
3. **Desktop (mouse + keyboard)** — full panel layout, all keyboard shortcuts, right-click menus, mouse wheel zoom
4. **Installed PWA (home screen)** — works fully offline, no browser chrome, correct status bar, auto-save restores session

A feature that works on desktop but breaks on mobile touch is not done. A feature that works in the browser but breaks when installed as a PWA is not done.

---

### 6b. The "Both Render Modes Must Work" Standard

Pixoto has two canvas rendering contexts. Both must work after every change:

1. **Photo mode** — anti-aliased, smooth brush, bilinear zoom, `imageSmoothingEnabled = true`
2. **Pixel art mode** — no anti-aliasing anywhere, nearest-neighbor zoom, `imageSmoothingEnabled = false`, grid overlay, pixel-snapped tools

Before proposing any change, ask:
- Does this change affect `imageSmoothingEnabled` state?
- Does this change the zoom or transform pipeline in a way that could blur pixel art?
- Does this affect the grid overlay canvas in a way that could bleed into image data?
- Does this change brush rendering in a way that introduces sub-pixel blending in pixel pen mode?

If the answer to any of these is "yes" or "I'm not sure" — stop and say so.

---

### 6c. The "Touch Is Not Optional" Standard

Touch support is the highest-priority platform constraint. Never:
- Add a feature that only works with hover
- Forget `touch-action: none` on the canvas element
- Use `mousedown/mousemove/mouseup` instead of Pointer Events API
- Add a slider, button, or interactive element below 44×44px touch target size
- Assume `pointer.pressure` is always available — always provide a graceful fallback

Every new interactive element must be explicitly verified to work on a 375px-wide mobile screen before it is considered done.

---

### 7. The "Prove It" Standard for Bug Fixes

Do not mark a bug as fixed because the code looks correct. Mark it fixed only when you have traced the full execution path from user input to final canvas output and every step is reachable, non-null, and produces the correct result.

"The handler exists at line X" is not proof. The handler could be attached to the wrong element, fire in the wrong order, be overridden by a later event listener, or fail silently on touch due to missing `preventDefault()`. Trace it all the way through.

Do not run the code unless asked. Explain what you did and how it should work — the user will verify.

---

## After Every Change — Required Steps

After completing any fix or feature, always do these things:

### Update the Changelog

Append to `CHANGELOG.md` in the project root (create it if it does not exist):

```
## [Unreleased]

### Fixed
- BUG-XXX: Short description of what was wrong and what file was changed (filename.js:line)

### Changed
- Short description of any non-bug behavioural change

### Added
- Short description of anything new
```

### Update the Docs

If the fix changes how a tool behaves, what settings it exposes, what events it emits, or what order things must happen — update `docs/FEATURES.md` immediately. Do not leave docs out of sync with the code. If a feature was previously broken and is now fixed, remove any `[BROKEN]` or `[NOT YET IMPLEMENTED]` marker.

### Update WHATWHYFIXED.md

Write or update `WHATWHYFIXED.md` with the current date and time, and clearly explain:
- What you changed
- What it achieved
- Why it was necessary

### State What You Changed

At the end of every response where you made code changes, include a short summary:

```
Files changed:
- canvas-engine.js (line 212): Fixed dirty-rect bounds — was clipping 1px short on right edge
- tools/brush.js (line 88): Pixel pen now skips sub-pixel interpolation entirely
Docs updated: FEATURES.md §4 Pixel Pen — updated behaviour description
Changelog: updated
```

---

## Known Active Bug List

These bugs are confirmed present. Do not close them without full proof:

| ID | Description | Files |
|----|-------------|-------|

---

## Source of Truth — Do Not Invent

Before referencing any function, class, or variable it must either:
- Exist in a file you have READ this session, OR
- Appear in `docs/FEATURES.md`, OR
- You must say "I have not verified this exists — please confirm"

### Things that do NOT exist — never invent these
- Nothing yet...

---

## What NOT to Do

- Do not mark a bug as fixed based on reading code alone
- Do not add new external dependencies without asking
- Do not edit a file you have not read this session
- Do not make multiple unrelated changes in one edit
- Do not leave `docs/FEATURES.md` out of sync after a fix
- Do not leave `CHANGELOG.md` un-updated after a fix
- Do not guess at intended behaviour — ask
- Do not use `mousedown/mousemove/mouseup` — always use Pointer Events API
- Do not add any interactive element without verifying it works on mobile touch
- Do not add any feature that requires hover to discover or activate
- Do not add a canvas rendering change without verifying it works in both photo mode and pixel art mode
- Do not add any online/CDN dependency — all dependencies must be bundled locally
- Do not silently combine multiple phases of a big task into one — always phase it and ask
- Do not hide terminal output when running commands
- Do not run any python servers, I will test the phases just give me a list what to check.

---

## How to Handle Uncertainty

If you are unsure about anything — the intended behaviour, the correct fix, the impact on touch, whether a canvas change could blur pixel art, whether a layout change breaks mobile — **stop and say so clearly**. Describe exactly what you are uncertain about and what information would resolve it. This is always better than proceeding with a wrong assumption.

---