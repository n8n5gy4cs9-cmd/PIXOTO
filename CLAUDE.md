# CLAUDE.md

## Pixoto

Professional PWA photo editor + pixel art studio.

### Goal

Pixoto must become a web equivalent of PixiEditor.

Reference implementation:

```text
TEMP_TO_BE_REMOVED/PixiEditor-master
```

Before designing a new feature, system, workflow, UI, shortcut, tool, behavior, or architecture:

1. Search PixiEditor source first.
2. Reuse PixiEditor behavior when applicable.
3. Match PixiEditor UX when reasonable.
4. Do not invent new systems if PixiEditor already solves the problem.
5. If PixiEditor contains the feature, treat PixiEditor as the source of truth.
6. Only design from scratch when PixiEditor has no equivalent implementation.

If PIXIEDITOR_AI_HELPER.md exists:

1. Read it first.
2. Use it as PixiEditor reference.
3. Only inspect PixiEditor source when information is missing.
4. Prefer helper document over repository-wide searches.

Only inspect PixiEditor source when information is missing:

* Study all related files first.
* Identify full execution flow.
* Port behavior to web architecture.
* Preserve user-facing behavior whenever practical.

---

## Stack

* HTML5
* CSS3
* JavaScript (ES2020+)
* Canvas 2D API
* Pointer Events API
* Web Workers
* OffscreenCanvas
* Service Worker

Additional libraries allowed when necessary.

Rules:

* Prefer existing project code.
* Prefer browser-native APIs.
* Prefer PixiEditor implementation.
* Vendor all third-party code locally.
* No CDN.
* No runtime downloads.
* No remote dependencies.
* No dependency requiring a build pipeline.
* Every dependency must exist inside the repository.

Allowed example categories:

* image processing
* color management
* PSD import/export
* file formats
* compression
* performance
* canvas utilities
* pixel-art utilities

Before adding a dependency:

1. Verify feature cannot reasonably be implemented with existing code.
2. Verify dependency solves a real problem.
3. Vendor dependency locally.
4. Document why it was added.

---

## Build

None.

Run:

```bash
python3 -m http.server 8080

# or

npx serve .
```

Open:

```text
index.html
```

Rules:

* No npm install requirements.
* No bundlers.
* No compile step.
* Native ES modules.

Never run servers for user.

User performs all testing.

---

## Read First

Before creating:

* function
* class
* manager
* UI component
* tool
* utility

Search project first.

Search PixiEditor second.

Do not duplicate existing functionality.

---

## Architecture Rules

### Coordinates

Always use:

```js
engine.screenToCanvas(clientX, clientY)
```

Never perform manual coordinate conversion.

### Pointer Events

Always use:

* pointerdown
* pointermove
* pointerup

Never use:

* mousedown
* mousemove
* mouseup

Canvas requires:

```css
touch-action: none;
```

### Render Modes

Every rendering change must work in:

#### Photo Mode

```js
imageSmoothingEnabled = true
```

#### Pixel Mode

```js
imageSmoothingEnabled = false
```

Verify:

* smoothing
* transforms
* zoom
* grid
* brush rendering
* selection rendering

---

## Workflow Rules

### Plan First

Before editing:

State:

* what changes
* files touched
* why
* risks

Ask:

```text
Does this plan look correct before I proceed?
```

Do not edit before approval.

### Large Changes

If task:

* touches >2 files
* adds new system
* exceeds ~30 lines

Split into phases.

Require approval between phases.

### Ask First

Ask before:

* deleting >20 lines
* removing systems
* removing functions
* renaming shared symbols
* architecture changes
* dependency additions
* touching >3 files

### Read Before Write

Always read target files before editing.

Never assume architecture.

---

## Quality Rules

### Platform Support

Must work on:

* mobile
* tablet
* desktop
* installed PWA

Mobile first.

### Bug Fix Standard

Trace:

```text
Input
→ Event
→ Tool
→ State
→ Render
→ Output
```

Bug not fixed until full path verified.

---

## After Every Change

Update:

1. progress.md
2. docs/FEATURES.md

progress.md must contain:

* date
* files changed
* what changed
* why changed
* remaining work

End response with:

```text
Files changed:
- file: summary
```

---

## User Preferences

* Greet user as "Crowelian"
* Never run servers
* User tests manually
* Search existing code before creating new code
* Search PixiEditor before designing new systems
* Prefer PixiEditor behavior over invention
