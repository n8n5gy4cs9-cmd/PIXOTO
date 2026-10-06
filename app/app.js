import { Doc, Layer } from './core/model.js';
import { state, update, subscribe } from './core/state.js';
import { TOOLS, toolById } from './core/tools.js';
import { register, commands, execute, isEnabled, rebuild, findByEvent, labelOf, keysOf, prettyKey } from './core/commands.js';
import { CanvasView } from './ui/canvas-view.js';
import { LayersPanel } from './ui/layers-panel.js';
import { MenuBar } from './ui/menu.js';
import { Toolbar } from './ui/toolbar.js';
import { OptionsBar } from './ui/options-bar.js';
import { Tabs } from './ui/tabs.js';
import { $, el, inTextField } from './ui/dom.js';
import { newCanvasDialog, alertBox, confirmBox, modal } from './ui/dialogs.js';
import { loadImage, baseName, exportDoc } from './io/files.js';

// Browsers cap canvas size; iOS is far stricter. Phase 9 replaces this with a real probe.
const limits = { max: /iPhone|iPad|iPod/.test(navigator.userAgent) ? 4096 : 16384 };

const app = {
  docs: [], doc: null,
  // Tools with working behaviour in this build; the options bar flags the rest as not available yet.
  implemented: new Set(['hand', 'zoom', 'eyedropper']),
  limits,
};

const view = new CanvasView($('#view'), $('#viewport'));
app.view = view;
const layersPanel = new LayersPanel($('#side'), () => app.doc);
const toolbar = new Toolbar($('#toolbar'), app);
const options = new OptionsBar($('#options'), app);
const tabs = new Tabs($('#tabs'), app);
const hint = $('#st-hint');
let problem = null;

// ---- documents -----------------------------------------------------------
function attach(doc) {
  app.doc = doc;
  view.setDoc(doc);
  layersPanel.setDoc(doc);
  $('#welcome').hidden = !!doc;
  tabs.refresh(); updateStatus();
}
app.switchDoc = (doc) => attach(doc);
app.addDoc = (doc) => {
  let shown = doc.modified;
  doc.on(() => { view.invalidate(); if (doc.modified !== shown) { shown = doc.modified; tabs.refresh(); } });
  doc.history.onChange = () => updateStatus();
  app.docs.push(doc);
  attach(doc);
};
app.closeDoc = async (doc) => {
  if (doc.modified && !(await confirmBox('Close ' + doc.name, 'This document has changes that are not saved (saving arrives in a later phase). Close it anyway?', 'Close'))) return;
  const i = app.docs.indexOf(doc);
  app.docs.splice(i, 1);
  if (doc === app.doc) attach(app.docs[Math.min(i, app.docs.length - 1)] || null); else tabs.refresh();
};

app.newCanvas = async () => {
  const r = await newCanvasDialog(limits, state);
  if (!r) return;
  const doc = new Doc({ width: r.width, height: r.height, resolution: r.resolution, name: `Untitled ${app.docs.length + 1}` });
  const layer = new Layer({ name: r.background ? 'Background' : 'Layer 1', width: r.width, height: r.height });
  if (r.background) { const c = layer.canvas.getContext('2d'); c.fillStyle = r.background; c.fillRect(0, 0, r.width, r.height); }
  doc.layers.push(layer); doc.activeId = layer.id; doc.modified = false;
  app.addDoc(doc);
};

// Open: every image becomes its own document tab (Composa File > Open).
app.openImages = async (files) => {
  for (const file of files) {
    try {
      const canvas = await loadImage(file);
      if (Math.max(canvas.width, canvas.height) > limits.max) throw new Error(`${file.name} is larger than this browser can handle (${limits.max} px).`);
      const doc = new Doc({ width: canvas.width, height: canvas.height, name: baseName(file.name) });
      const layer = new Layer({ name: baseName(file.name), canvas });
      doc.layers.push(layer); doc.activeId = layer.id;
      app.addDoc(doc);
    } catch (err) { await alertBox('Cannot open image', err.message); }
  }
};
// Place: images become layers in the current document, scaled down to fit and centred (non-destructive scale).
app.placeImages = async (files) => {
  const doc = app.doc; if (!doc) return app.openImages(files);
  for (const file of files) {
    try {
      const canvas = await loadImage(file);
      const layer = new Layer({ name: baseName(file.name), canvas });
      const k = Math.min(1, doc.width / canvas.width, doc.height / canvas.height);
      Object.assign(layer, { sx: k, sy: k, x: doc.width / 2, y: doc.height / 2 });
      doc.addLayer(layer, 'Place Image');
    } catch (err) { await alertBox('Cannot place image', err.message); }
  }
};
const pickFiles = (place) => {
  const input = $('#file');
  input.onchange = () => { const f = [...input.files]; input.value = ''; if (f.length) place ? app.placeImages(f) : app.openImages(f); };
  input.click();
};

// ---- tools ---------------------------------------------------------------
app.selectTool = (id) => {
  update({ tool: id });
  view.updateCursor();
  refreshTool();
};
app.setMode = (id, mode) => { update({ modes: { ...state.modes, [id]: mode } }); refreshTool(); };
function cycleMode(id) { const t = toolById[id]; if (t.modes) app.setMode(id, ((state.modes[id] ?? 0) + 1) % t.modes.length); }
function refreshTool() { toolbar.refresh(); options.refresh(); updateStatus(); }
app.swapColors = () => update({ fg: state.bg, bg: state.fg });

// ---- status bar ----------------------------------------------------------
function updateStatus() {
  const d = app.doc, t = toolById[state.tool];
  $('#st-zoom').textContent = d ? Math.round(d.view.zoom * 1000) / 10 + '%' : '';
  $('#st-size').textContent = d ? `${d.width} × ${d.height} px · ${d.resolution} ppi · sRGB` : '';
  tabs.setZoom(d ? d.view.zoom : null);
  if (!d) $('#st-pos').textContent = '';
  hint.classList.toggle('problem', !!problem);
  hint.textContent = problem || (d ? (t.modes?.[state.modes[t.id] ?? 0]?.hint || t.hint) : 'Ready when you are');
}
view.onChange = updateStatus;
view.onPointer = (p) => { $('#st-pos').textContent = p ? `${Math.floor(p.x)}, ${Math.floor(p.y)}` : ''; };
view.onPick = (hex, alt) => update(alt ? { bg: hex } : { fg: hex });
subscribe(() => { toolbar.refresh(); view.invalidate(); });

// ---- commands ------------------------------------------------------------
const has = () => !!app.doc;
const act = () => !!app.doc?.active;
const C = (id, label, keys, run, opts = {}) => register(id, { label, keys, run, ...opts });
const T = (id, label, keys) => register(id, { label, keys, todo: true });

C('file.new', 'New Canvas…', ['Ctrl+N', 'Alt+N'], () => app.newCanvas());
C('file.open', 'Open…', ['Ctrl+O'], () => pickFiles(false));
C('file.place', 'Place Images as Layers…', [], () => pickFiles(true), { enabled: has });
T('file.save', 'Save', ['Ctrl+S']); T('file.saveas', 'Save As…', ['Ctrl+Shift+S']);
C('file.png', 'Export PNG', ['Ctrl+Shift+E'], () => exportDoc(app.doc, 'png').catch((e) => alertBox('Export failed', e.message)), { enabled: has });
C('file.jpeg', 'Export JPEG', ['Ctrl+Alt+Shift+S'], () => exportDoc(app.doc, 'jpeg').catch((e) => alertBox('Export failed', e.message)), { enabled: has });
C('file.webp', 'Export WebP', [], () => exportDoc(app.doc, 'webp').catch((e) => alertBox('Export failed', e.message)), { enabled: has });
C('file.close', 'Close Project', ['Ctrl+W', 'Alt+W'], () => app.closeDoc(app.doc), { enabled: has });

C('edit.undo', () => 'Undo' + (app.doc?.history.undoName ? ' ' + app.doc.history.undoName : ''), ['Ctrl+Z'], () => app.doc.history.undo(), { enabled: () => !!app.doc?.history.undoName });
C('edit.redo', () => 'Redo' + (app.doc?.history.redoName ? ' ' + app.doc.history.redoName : ''), ['Ctrl+Shift+Z', 'Ctrl+Y'], () => app.doc.history.redo(), { enabled: () => !!app.doc?.history.redoName });
T('edit.cut', 'Cut', ['Ctrl+X']); T('edit.copy', 'Copy', ['Ctrl+C']); T('edit.paste', 'Paste', ['Ctrl+V']); T('edit.copymerged', 'Copy Merged', ['Ctrl+Shift+C']);
T('edit.fillfg', 'Fill with Foreground Color', ['Alt+Backspace']); T('edit.fillbg', 'Fill with Background Color', ['Ctrl+Backspace']);
T('edit.clear', 'Clear', ['Delete']); T('edit.cafill', 'Content-Aware Fill', ['Shift+Backspace']);
C('edit.swap', 'Swap Colors', ['X'], () => app.swapColors(), { group: 'Tools and Canvas' });
C('edit.reset', 'Default Colors', ['D'], () => update({ fg: '#000000', bg: '#ffffff' }), { group: 'Tools and Canvas' });
C('edit.shortcuts', 'Keyboard Shortcuts', ['F1'], () => showShortcuts(), { needsDoc: false });

T('sel.all', 'All', ['Ctrl+A']); T('sel.none', 'Deselect', ['Ctrl+D']); T('sel.inverse', 'Inverse', ['Ctrl+Shift+I']);
T('sel.subject', 'Subject', ['Ctrl+Alt+A']); T('sel.feather', 'Feather…', ['Shift+F6']);

T('img.curves', 'Curves…', ['Ctrl+M']); T('img.levels', 'Levels…', ['Ctrl+L']); T('img.hue', 'Hue/Saturation…', ['Ctrl+U']);
T('img.invert', 'Invert', ['Ctrl+I']); T('img.autolevels', 'Auto Levels', ['Ctrl+Shift+L']);
T('img.canvas', 'Canvas Size…', ['Ctrl+Alt+C']); T('img.size', 'Image Size…', ['Ctrl+Alt+I']);

C('layer.new', 'New Layer', ['Ctrl+Shift+N', 'Alt+Shift+N'], () => app.doc.newLayer(), { enabled: has });
C('layer.dup', 'Duplicate Layer', ['Ctrl+J'], () => app.doc.duplicateLayer(), { enabled: act });
C('layer.delete', 'Delete Layer', ['Backspace'], () => app.doc.deleteLayer(), { enabled: act });
C('layer.rename', 'Rename Layer', ['F2'], () => layersPanel.rename(), { enabled: act });
T('layer.transform', 'Transform Layer', ['Ctrl+T', 'Alt+T']); T('layer.clip', 'Create / Release Clipping Mask', ['Ctrl+Alt+G']);
T('layer.group', 'Group Selected Layers', ['Ctrl+G']); T('layer.ungroup', 'Ungroup', ['Ctrl+Shift+G']);
C('layer.up', 'Move Layer Up', ['Ctrl+]'], () => { const d = app.doc; d.moveLayer(d.active, d.layers.indexOf(d.active) + 1); }, { enabled: () => act() && app.doc.layers.indexOf(app.doc.active) < app.doc.layers.length - 1 });
C('layer.down', 'Move Layer Down', ['Ctrl+['], () => { const d = app.doc; d.moveLayer(d.active, d.layers.indexOf(d.active) - 1); }, { enabled: () => act() && app.doc.layers.indexOf(app.doc.active) > 0 });
T('layer.merge', 'Merge Down', ['Ctrl+E']); T('layer.flatten', 'Flatten Image');

C('view.fit', 'Fit Canvas', ['Ctrl+0'], () => view.fit(), { enabled: has });
C('view.actual', 'Actual Pixels', ['Ctrl+1'], () => view.zoomTo(1), { enabled: has });
C('view.in', 'Zoom In', ['Ctrl+='], () => view.zoomIn(), { enabled: has });
C('view.out', 'Zoom Out', ['Ctrl+-'], () => view.zoomOut(), { enabled: has });
const toggle = (id, label, keys, key, store = 'view') => register(id, {
  label, keys, enabled: has,
  checked: () => (store === 'view' ? state.view[key] : state[key]),
  run: () => update(store === 'view' ? { view: { ...state.view, [key]: !state.view[key] } } : { [key]: !state[key] }),
});
toggle('view.controls', 'Show Transform Controls', ['Ctrl+H'], 'transformControls', 'root');
toggle('view.pixelgrid', 'Pixel Grid (when zoomed in)', [], 'pixelGrid');
for (const [id, label, keys] of [['view.rulers', 'Rulers', ['Ctrl+R']], ['view.grid', 'Show Grid', ["Ctrl+'"]], ['view.guides', 'Show Guides', ['Ctrl+;']], ['view.snap', 'Snap', ['Ctrl+Shift+;']], ['view.lock', 'Lock Guides', ['Ctrl+Alt+;']]])
  register(id, { label, keys, todo: true });

for (const t of TOOLS) {
  C('tool.' + t.id, t.name, [t.key.toUpperCase()], () => { if (state.tool === t.id && t.cycle) cycleMode(t.id); else app.selectTool(t.id); }, { group: 'Tools', needsDoc: false });
}
C('tool.erase', 'Eraser', ['E'], () => { app.setMode('brush', 1); app.selectTool('brush'); }, { group: 'Tools', needsDoc: false });
C('tool.nextmode', 'Next mode of the current tool', ['Tab'], () => cycleMode(state.tool), { group: 'Tools and Canvas', enabled: () => !!toolById[state.tool].modes });

// Move tool: digits set the active layer's opacity (1 = 10 % … 0 = 100 %), as in Composa.
for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0])
  register('canvas.opacity' + n, { label: `Opacity ${n === 0 ? 100 : n * 10}%`, group: 'Fixed', keys: [String(n)], enabled: () => act() && state.tool === 'move', run: () => app.doc.setPropStep(app.doc.active, 'opacity', n === 0 ? 1 : n / 10, 'Change Opacity'), todo: false });

// ---- menu bar ------------------------------------------------------------
new MenuBar($('#menubar'), [
  { label: 'File', items: ['file.new', 'file.open', 'file.place', '-', 'file.save', 'file.saveas', '-', 'file.png', 'file.jpeg', 'file.webp', '-', 'file.close'] },
  { label: 'Edit', items: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.copymerged', '-', 'edit.fillfg', 'edit.fillbg', 'edit.clear', 'edit.cafill', '-', 'edit.swap', 'edit.reset', '-', 'edit.shortcuts'] },
  { label: 'Select', items: ['sel.all', 'sel.none', 'sel.inverse', 'sel.subject', '-', 'sel.feather'] },
  { label: 'Image', items: ['img.curves', 'img.levels', 'img.hue', 'img.invert', 'img.autolevels', '-', 'img.canvas', 'img.size'] },
  { label: 'Layer', items: ['layer.new', 'layer.dup', 'layer.delete', 'layer.rename', '-', 'layer.transform', 'layer.clip', 'layer.group', 'layer.ungroup', '-', 'layer.up', 'layer.down', '-', 'layer.merge', 'layer.flatten'] },
  { label: 'View', items: ['view.fit', 'view.actual', 'view.in', 'view.out', '-', 'view.controls', 'view.pixelgrid', '-', 'view.rulers', 'view.grid', 'view.guides', 'view.snap', 'view.lock'] },
  { label: 'Help', items: ['edit.shortcuts'] },
]);
$('#menubar').insertAdjacentHTML('beforeend', '<div class="spacer"></div>');

// ---- shortcuts dialog (read-only here; remapping arrives in Phase 8) ------
function showShortcuts() {
  const groups = {};
  for (const c of commands.values()) { if (!keysOf(c).length) continue; (groups[c.group] ||= []).push(c); }
  const body = Object.entries(groups).map(([g, list]) => el('div', {}, el('b', {}, g === 'Menus' ? 'Menus' : g),
    el('div', { style: 'display:grid;grid-template-columns:1fr auto;gap:2px 20px;margin-top:4px' }, list.flatMap((c) => [el('span', {}, labelOf(c)), el('span', { style: 'color:var(--secondary)' }, keysOf(c).map(prettyKey).join('  /  '))]))));
  modal('Keyboard Shortcuts', el('div', { style: 'display:grid;gap:12px;max-height:60vh;overflow:auto;padding-right:6px' }, body), [{ label: 'Close', value: true, accent: true }]);
}

// ---- keyboard ------------------------------------------------------------
rebuild();
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || inTextField(e.target) || document.querySelector('.scrim')) return;
  const c = findByEvent(e);
  if (!c) return;
  const ok = isEnabled(c);
  if (ok || c.todo || e.ctrlKey || e.metaKey || e.altKey) e.preventDefault();   // keep the browser's own combo from firing
  if (ok && !e.repeat) execute(c.id);
});

// ---- welcome, drag and drop, misc ---------------------------------------
$('#w-new').onclick = () => app.newCanvas();
$('#w-open').onclick = () => pickFiles(false);
const vp = $('#viewport'), mask = $('#dropmask');
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); dragDepth++; mask.hidden = false; } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; mask.hidden = true; } });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; mask.hidden = true;
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(f.name));
  if (files.length) app.placeImages(files);
});
window.addEventListener('beforeunload', (e) => { if (app.docs.some((d) => d.modified)) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('error', (e) => { problem = e.message; updateStatus(); setTimeout(() => { problem = null; updateStatus(); }, 6000); });

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

refreshTool();
attach(null);
window.pixoto = app;
