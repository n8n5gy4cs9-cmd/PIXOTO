// Tool table: ids, keys and modes follow Composa's toolbar (EditorSession.Tool, docs/tools.md).
// `modes` cycle on key repeat / Tab; each mode has its own icon and hint.
export const TOOLS = [
  { id: 'move', name: 'Move / Transform', key: 'v', icon: 'move', hint: 'Drag to move · Handles resize (Shift free, Alt from center) · Outside a corner rotates · Ctrl-drag a corner distorts · Ctrl-click picks a layer · 1–0 opacity', phase: 4 },
  { id: 'marquee', name: 'Marquee', key: 'm', cycle: true, phase: 3,
    modes: [{ id: 'rect', icon: 'marquee', name: 'Rectangle' }, { id: 'ellipse', icon: 'marquee-ellipse', name: 'Ellipse' }],
    hint: 'Drag to select · Shift add · Alt subtract · Shift+Alt intersect · Drag inside to move · Delete clears · Ctrl+D deselect' },
  { id: 'lasso', name: 'Lasso', key: 'l', cycle: true, phase: 3,
    modes: [{ id: 'free', icon: 'lasso', name: 'Freehand' }, { id: 'poly', icon: 'polygon-lasso', name: 'Polygonal' }],
    hint: 'Drag to select · Shift add · Alt subtract · Polygonal: click corners, Enter closes, Backspace removes a corner' },
  { id: 'wand', name: 'Magic', key: 'w', tabCycle: true, phase: 3,
    modes: [{ id: 'wand', icon: 'wand', name: 'Wand' }, { id: 'object', icon: 'object-select', name: 'Object' }],
    hint: 'Click to select similar colors · Tab switches Wand and Object · Shift add · Alt subtract' },
  { id: 'crop', name: 'Crop', key: 'c', icon: 'crop', hint: 'Drag to crop · Shift keeps proportions · Alt symmetric · Enter applies · Escape cancels', phase: 4 },
  { id: 'brush', name: 'Brush', key: 'b', altKey: 'e', phase: 2,
    modes: [{ id: 'paint', icon: 'brush', name: 'Brush' }, { id: 'erase', icon: 'eraser', name: 'Eraser' }],
    hint: 'Drag to paint · Alt-click picks a color · Shift-click draws a line · [ ] size · { } hardness · 1–0 opacity' },
  { id: 'heal', name: 'Spot Healing Brush', key: 'j', icon: 'heal', hint: 'Drag over blemishes to heal · [ ] size', phase: 2 },
  { id: 'clone', name: 'Clone Stamp', key: 's', icon: 'stamp', hint: 'Alt-click sets the source · Drag to clone · [ ] size · 1–0 opacity', phase: 2 },
  { id: 'smear', name: 'Smear', key: 'r', cycle: true, phase: 2,
    modes: [{ id: 'liquify', icon: 'liquify', name: 'Liquify' }, { id: 'blur', icon: 'blur', name: 'Blur' }, { id: 'smudge', icon: 'smudge', name: 'Smudge' }, { id: 'dodge', icon: 'dodge', name: 'Dodge' }, { id: 'burn', icon: 'burn', name: 'Burn' }],
    toolIcon: 'drop', hint: 'Drag to push, blur, smudge, lighten or darken · R / Tab switch mode · [ ] size · 1–0 strength' },
  { id: 'gradient', name: 'Gradient', key: 'g', icon: 'gradient', hint: 'Drag to draw · Drag an end to adjust · Shift snaps to 45° · Enter applies · Escape cancels', phase: 2 },
  { id: 'shape', name: 'Shape', key: 'u', cycle: true, tabCycle: true, shiftKeyCycle: true, phase: 5,
    modes: [{ id: 'rect', icon: 'shape', name: 'Rectangle' }, { id: 'rounded', icon: 'rounded-rect', name: 'Rounded Rectangle' }, { id: 'ellipse', icon: 'ellipse', name: 'Ellipse' }, { id: 'line', icon: 'line', name: 'Line' }],
    hint: 'Drag to draw a shape on a new layer · Shift square/45° · Alt from center · Tab or Shift+U for the next shape' },
  { id: 'text', name: 'Type', key: 't', icon: 'text', hint: 'Click for point text · Drag a box for paragraph text · Click text to edit it', phase: 5 },
  { id: 'eyedropper', name: 'Eyedropper', key: 'i', icon: 'eyedropper', hint: 'Click to pick the foreground color · Alt-click for the background', phase: 1 },
  { id: 'hand', name: 'Hand', key: 'h', icon: 'hand', hint: 'Drag to pan · Ctrl+wheel zooms · Space pans with any tool', phase: 1 },
  { id: 'zoom', name: 'Zoom', key: 'z', icon: 'zoom', hint: 'Click to zoom in · Alt-click to zoom out · Drag right or left to zoom smoothly', phase: 1 },
];
export const toolById = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
export const toolIcon = (tool, mode) => (tool.modes ? tool.modes[mode]?.icon : tool.icon);
