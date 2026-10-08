import { Doc, Layer } from './core/model.js';
import { state, update, subscribe } from './core/state.js';
import { TOOLS, toolById } from './core/tools.js';
import { register, commands, execute, isEnabled, rebuild, findByEvent, labelOf, keysOf } from './core/commands.js';
import { LIMITS } from './core/limits.js';
import { renderer } from './core/render.js';
import { makeCanvas, ctxOf, fillCanvas } from './core/pixels.js';
import { ADJUSTMENT_TYPES, ADJUSTMENT_NAMES } from './core/filters/adjust.js';
import { FILTERS, FILTER_GROUPS } from './core/filters/filters.js';
import { EFFECT_KINDS, effectName, withEffect, withoutEffect, effectEnabled, hasEffect, DEFAULTS } from './core/effects.js';
import * as L from './core/ops/layers.js';
import * as S from './core/ops/selection.js';
import * as C from './core/ops/canvas.js';
import * as T from './core/ops/transform.js';
import * as G from './core/ops/guides.js';
import * as CB from './core/ops/clipboard.js';
import { fillTarget, clearSelection } from './core/ops/pixels.js';
import { contentAwareFill } from './core/ops/preview.js';
import { textSession, recolorText, rasterizeLayer } from './core/ops/live.js';
import { paintSession } from './core/ops/paint.js';
import { CanvasView } from './ui/canvas-view.js';
import { LayersPanel } from './ui/layers-panel.js';
import { MenuBar } from './ui/menu.js';
import { Toolbar } from './ui/toolbar.js';
import { OptionsBar } from './ui/options-bar.js';
import { Tabs } from './ui/tabs.js';
import { popup } from './ui/popup.js';
import { $, el, inTextField } from './ui/dom.js';
import { newCanvasDialog, alertBox, confirmBox, modal, confirmSave, canvasSizeDialog, imageSizeDialog, trimDialog, exportDialog, psdReportDialog, recoveryDialog } from './ui/dialogs.js';
import { showHelp } from './ui/help.js';
import { runFilterDialog, adjustPixels, autoLevelsNow, newAdjustmentLayer, editAdjustmentLayer, editEffectDialog } from './ui/tool-dialogs.js';
import { lastFilter } from './ui/last-filter.js';
import { showShortcuts } from './ui/shortcuts-dialog.js';
import { createBrushTools } from './ui/tools/brush.js';
import { createViewTools } from './ui/tools/view-tools.js';
import { MarqueeTool, LassoTool, MagicTool } from './ui/tools/selection.js';
import { MoveTool } from './ui/tools/move.js';
import { CropTool } from './ui/tools/crop.js';
import { GradientTool } from './ui/tools/gradient.js';
import { ShapeTool } from './ui/tools/shape.js';
import { TextTool } from './ui/tools/text.js';
import { installGuidesUi } from './ui/guides-ui.js';
import { loadImage, baseName, kindOf, pickOpen, saveProject, exportDoc, flatCanvas, encode, saveBlob, readProject, download } from './io/files.js';
import { importPsd, psdToDoc, isPsd, PsdError } from './io/psd.js';
import { addRecent, getRecents, saveRecovery, dropRecovery, listRecovery, clearRecents } from './io/store.js';
import { writeProject } from './io/project.js';

// Browsers cap canvas size; iOS is far stricter. Thin canvases test the side limit; the area limit follows the platform.
function probeLimits() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let side = 2048;
  for (const s of [16384, 8192, 4096]) {
    try { const c = document.createElement('canvas'); c.width = s; c.height = 1; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(s - 1, 0, 1, 1); if (x.getImageData(s - 1, 0, 1, 1).data[3] === 255) { side = s; break; } } catch {}
  }
  LIMITS.maxSide = ios ? Math.min(side, 4096) : side;
  LIMITS.maxPixels = ios ? 16_777_216 : 100_000_000;
}
probeLimits();
const limits = { get max() { return LIMITS.maxSide; } };

const app = { docs: [], doc: null, limits, selectedEffect: null };
const view = new CanvasView($('#view'), $('#viewport'));
app.view = view;
const layersPanel = new LayersPanel($('#side'), app);
const toolbar = new Toolbar($('#toolbar'), app);
const options = new OptionsBar($('#options'), app);
const tabs = new Tabs($('#tabs'), app);
const hint = $('#st-hint');
let problemTimer = 0, problemText = null;

app.problem = (msg) => { problemText = msg; clearTimeout(problemTimer); problemTimer = setTimeout(() => { problemText = null; updateStatus(); }, 6000); updateStatus(); };
app.layersPanel = layersPanel; app.options = options;

// ---- tools -----------------------------------------------------------------------------------------
app.tools = { ...createBrushTools(app), ...createViewTools(), marquee: new MarqueeTool(app), lasso: new LassoTool(app), wand: new MagicTool(app), move: new MoveTool(app), crop: new CropTool(app), gradient: new GradientTool(app), shape: new ShapeTool(app), text: new TextTool(app) };
view.tools = app.tools;
app.onToolState = () => { options.refresh(); view.invalidate(); };
app.onTextChange = () => options.refresh();
app.onTransformChange = () => options.refresh();
app.setGradientOpacity = (v) => update({ gradientOpacity: v });
app.editTextAt = (ev) => app.tools.text.editAt(ev);
app.selectTool = (id) => {
  if (state.tool !== id) { view.cancelDrag(); app.tools[state.tool]?.deactivate?.(); }
  update({ tool: id });
  app.tools[id]?.activate?.();
  view.updateCursor(); refreshTool();
};
app.setMode = (id, mode) => { update({ modes: { ...state.modes, [id]: mode } }); app.tools[id]?.modeChanged?.(); refreshTool(); view.invalidate(); };
const cycleMode = (id) => { const t = toolById[id]; if (t.modes) app.setMode(id, ((state.modes[id] ?? 0) + 1) % t.modes.length); };
function refreshTool() { toolbar.refresh(); options.refresh(true); updateStatus(); }
app.swapColors = () => update({ fg: state.bg, bg: state.fg });
app.editText = (layer) => { const ed = textSession.edit(app.doc, layer); if (ed) { ed.moveToDocumentEdge(true, false); app.selectTool('text'); app.tools.text.sync(); } };
app.editAdjustment = (layer) => editAdjustmentLayer(app, layer);
app.editEffect = (layer, kind) => editEffectDialog(app, layer, kind);
app.setEffectEnabled = (layer, kind, on) => { const key = { dropShadow: 'shadow' }[kind] || kind; const cur = layer.effects?.[key]; if (!cur) return; app.doc.apply(on ? 'Show Effect' : 'Hide Effect', () => { layer.effects = { ...layer.effects, [key]: { ...cur, enabled: on } }; }); app.doc.invalidate(app.doc.affectedArea(layer)); app.doc.layersChanged(); };
app.deleteEffect = (layer, kind) => { app.doc.apply('Delete Effect', () => { layer.effects = withoutEffect(layer.effects, kind); }); app.doc.invalidate(app.doc.affectedArea(layer)); app.doc.layersChanged(); };
app.adjustmentMenu = (x, y) => popup(ADJUSTMENT_TYPES.filter((t) => t !== 'invert' || true).map((t) => ({ label: ADJUSTMENT_NAMES[t] + (['invert'].includes(t) ? '' : '…'), run: () => execute('newadj.' + t) })), x, Math.max(10, y - 260));

// ---- documents -----------------------------------------------------------------------------------------
function attach(doc) {
  if (app.doc && app.doc !== doc) { app.doc.finishInteraction?.(); }
  app.doc = doc;
  view.setDoc(doc);
  layersPanel.setDoc(doc);
  $('#welcome').hidden = !!doc;
  if (!doc) renderRecents();
  tabs.refresh(); updateStatus(); options.refresh(true);
}
app.switchDoc = (doc) => { if (doc !== app.doc) { app.tools[state.tool]?.deactivate?.(); attach(doc); app.tools[state.tool]?.activate?.(); } };
app.addDoc = (doc) => {
  let shown = doc.modified;
  doc.on((kind) => {
    if (kind === 'canvas' || kind === 'selection') view.invalidate();
    if (kind === 'size') { view.fit(); updateStatus(); }
    if (kind === 'history' || kind === 'layers' || kind === 'canvas') { if (doc.modified !== shown) { shown = doc.modified; tabs.refresh(); } }
    if (kind === 'layers' || kind === 'history' || kind === 'selection') options.refresh();
    if (kind === 'history') updateStatus();
    if (kind === 'guides') view.invalidate();
  });
  doc.history.onChange = () => updateStatus();
  app.docs.push(doc);
  attach(doc);
};
app.closeDoc = async (doc) => {
  if (doc.modified) {
    const r = await confirmSave(doc.name);
    if (!r) return;
    if (r === 'save' && !(await saveDoc(doc))) return;
  }
  dropRecovery(doc.id);
  const i = app.docs.indexOf(doc);
  app.docs.splice(i, 1);
  if (doc === app.doc) attach(app.docs[Math.min(i, app.docs.length - 1)] || null); else tabs.refresh();
};

app.newCanvas = async () => {
  const r = await newCanvasDialog(limits, state);
  if (!r) return;
  const doc = new Doc({ width: r.width, height: r.height, resolution: r.resolution, name: `Untitled ${app.docs.length + 1}` });
  const layer = Layer.raster(r.background ? 'Background' : 'Layer 1', makeCanvas(r.width, r.height));
  if (r.background) fillCanvas(layer.canvas, r.background);
  doc.layers.push(layer); doc.setActive(layer.id, false); doc.modified = false;
  app.addDoc(doc);
};

// Open: every image, project or Photoshop file becomes its own document tab (Composa File > Open).
app.openFiles = async (files) => {
  for (const file of files) {
    try {
      const dup = app.docs.find((d) => d.filePath && d.filePath === file.name && d.fileHandle && file.handle && d.fileHandle === file.handle);
      if (dup) { app.switchDoc(dup); continue; }
      const kind = kindOf(file);
      let doc;
      if (kind === 'project') { doc = await readProject(await file.arrayBuffer(), baseName(file.name)); doc.fileHandle = file.handle || null; doc.filePath = file.name; }
      else if (kind === 'psd') {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!isPsd(bytes)) throw new Error('This is not a Photoshop file.');
        const imp = await importPsd(bytes.buffer);
        if (imp.conversions.length && !(await psdReportDialog(file.name, imp.conversions))) continue;
        doc = psdToDoc(imp, baseName(file.name));
      } else {
        const canvas = await loadImage(file);
        if (Math.max(canvas.width, canvas.height) > LIMITS.maxSide) throw new Error(`${file.name} is larger than this browser can handle (${LIMITS.maxSide} px).`);
        doc = new Doc({ width: canvas.width, height: canvas.height, name: baseName(file.name) });
        const layer = Layer.raster(baseName(file.name), canvas);
        doc.layers.push(layer); doc.setActive(layer.id, false);
      }
      app.addDoc(doc);
      addRecent(file.name, file.handle || null);
    } catch (err) { await alertBox('Cannot open ' + file.name, err instanceof PsdError || err instanceof Error ? err.message : String(err)); }
  }
};
// Place: images become layers in the current document, scaled down to fit and centred.
app.placeImages = async (files, at = null) => {
  const doc = app.doc;
  if (!doc || files.some((f) => kindOf(f) !== 'image')) return app.openFiles(files);
  for (const file of files) {
    try {
      const canvas = await loadImage(file);
      const inside = at && at.x >= 0 && at.y >= 0 && at.x <= doc.width && at.y <= doc.height;
      L.addImageLayer(doc, baseName(file.name), canvas, { center: inside ? at : null, undoName: 'Place Image' });
    } catch (err) { await alertBox('Cannot place image', err.message); }
  }
  app.selectTool('move');
};
const pickFiles = async (place) => { const files = await pickOpen(true); if (files.length) place ? app.placeImages(files) : app.openFiles(files); };

// ---- saving ---------------------------------------------------------------------------------------------
async function saveDoc(doc, saveAs = false) {
  doc.finishInteraction();
  try {
    const ok = await saveProject(doc, { saveAs });
    if (ok) { dropRecovery(doc.id); addRecent(doc.name + '.cmps', doc.fileHandle); tabs.refresh(); updateStatus(); }
    return ok;
  } catch (err) { await alertBox('Save failed', err.message); return false; }
}
async function exportAs(format) {
  const doc = app.doc; doc.finishInteraction();
  try {
    const q = await exportDialog(doc, format, { flat: () => flatCanvas(doc, format), encode, quality: state.exportQuality ?? 0.9 });
    if (q == null) return;
    if (format !== 'png') update({ exportQuality: q });
    await exportDoc(doc, format, q);
  } catch (err) { await alertBox('Export failed', err.message); }
}
// Autosave every two minutes; the next start offers to recover what was open.
setInterval(async () => {
  for (const d of app.docs) if (d.modified && d.revision !== d.recoveredRevision && !d.hasPendingEdit) { try { d.recoveredRevision = d.revision; saveRecovery(d.id, d.name, await writeProject(d)); } catch {} }
}, 120000);

// ---- recents on the welcome screen --------------------------------------------------------------------------
async function renderRecents() {
  const box = $('#recents'); if (!box) return;
  const list = await getRecents();
  box.replaceChildren(...(list.length ? [el('h3', {}, 'Recent'), ...list.slice(0, 8).map((r) => el('button', { class: 'btn recent', onClick: () => openRecent(r) }, r.name))] : []));
}
async function openRecent(r) {
  try {
    if (r.handle) { const p = (await r.handle.queryPermission?.({ mode: 'read' })) ?? 'granted'; if (p !== 'granted' && (await r.handle.requestPermission?.({ mode: 'read' })) !== 'granted') throw new Error('Permission to read the file was denied.'); const f = await r.handle.getFile(); app.openFiles([Object.assign(f, { handle: r.handle })]); return; }
  } catch (e) { app.problem(e.message); return; }
  app.problem('Pick the file again: this browser did not keep a link to it.'); pickFiles(false);
}

// ---- status bar -----------------------------------------------------------------------------------------------
function updateStatus() {
  const d = app.doc, t = toolById[state.tool];
  $('#st-zoom').textContent = d ? Math.round(d.view.zoom * 1000) / 10 + '%' : '';
  $('#st-size').textContent = d ? `${d.width} × ${d.height} px · ${d.resolution} ppi · sRGB` : '';
  tabs.setZoom(d ? d.view.zoom : null);
  if (!d) $('#st-pos').textContent = '';
  hint.classList.toggle('problem', !!problemText);
  hint.textContent = problemText || (d ? (t.modes?.[state.modes[t.id] ?? 0]?.hint || t.hint) : 'Ready when you are');
}
view.onChange = updateStatus;
view.onPointer = (p) => { $('#st-pos').textContent = p ? `${Math.floor(p.x)}, ${Math.floor(p.y)}` : ''; };
subscribe(() => { toolbar.refresh(); options.refresh(); view.invalidate(); });

// ---- commands -----------------------------------------------------------------------------------------------
const has = () => !!app.doc;
const act = () => !!app.doc?.active;
const editable = () => !!app.doc?.editableLayer;
const selecting = () => !!app.doc?.selection;
const C_ = (id, label, keys, run, opts = {}) => register(id, { label, keys, run, ...opts });
const guard = (fn) => (...a) => { try { const r = fn(...a); if (r?.catch) r.catch((e) => app.problem(e.message)); } catch (e) { app.problem(e.message); } };
const doc = () => app.doc;

C_('file.new', 'New Canvas…', ['Ctrl+N', 'Alt+N'], () => app.newCanvas());
C_('file.open', 'Open…', ['Ctrl+O'], () => pickFiles(false));
C_('file.place', 'Place Images as Layers…', [], () => pickFiles(true), { enabled: has });
C_('file.save', 'Save', ['Ctrl+S'], () => saveDoc(doc()), { enabled: has });
C_('file.saveas', 'Save As…', ['Ctrl+Shift+S'], () => saveDoc(doc(), true), { enabled: has });
C_('file.png', 'Export PNG…', ['Ctrl+Shift+E'], () => exportAs('png'), { enabled: has });
C_('file.jpeg', 'Export JPEG…', ['Ctrl+Alt+Shift+S'], () => exportAs('jpeg'), { enabled: has });
C_('file.webp', 'Export WebP…', [], () => exportAs('webp'), { enabled: has });
C_('file.close', 'Close Project', ['Ctrl+W', 'Alt+W'], () => app.closeDoc(doc()), { enabled: has });

const undoable = () => !!app.doc?.canUndo;
C_('edit.undo', () => 'Undo' + (app.doc?.history.undoName ? ' ' + app.doc.history.undoName : ''), ['Ctrl+Z'], () => { if (textSession.active) textSession.editor.undo(); else doc().undo(); }, { enabled: () => undoable() || textSession.active });
C_('edit.redo', () => 'Redo' + (app.doc?.history.redoName ? ' ' + app.doc.history.redoName : ''), ['Ctrl+Shift+Z', 'Ctrl+Y'], () => { if (textSession.active) textSession.editor.redo(); else doc().redo(); }, { enabled: () => !!app.doc?.canRedo || textSession.active });
const systemClip = async () => { const img = CB.clip.image; if (!img || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return; try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': CB.clipboardBlob(img) })]); } catch {} };
C_('edit.cut', 'Cut', ['Ctrl+X'], () => { CB.cut(doc()); systemClip(); }, { enabled: () => !!app.doc && CB.canCopy(app.doc) });
C_('edit.copy', 'Copy', ['Ctrl+C'], () => { CB.copy(doc()); systemClip(); }, { enabled: () => !!app.doc && CB.canCopy(app.doc) });
C_('edit.copymerged', 'Copy Merged', ['Ctrl+Shift+C'], () => { CB.copyMerged(doc()); systemClip(); }, { enabled: has });
C_('edit.paste', 'Paste', [], () => pasteFromSystem(), { enabled: has });
C_('edit.fillfg', 'Fill with Foreground Color', ['Alt+Backspace'], () => fill(state.fg), { enabled: () => !!app.doc && (editable() || !!app.doc.active?.text) });
C_('edit.fillbg', 'Fill with Background Color', ['Ctrl+Backspace'], () => fill(state.bg), { enabled: () => !!app.doc && (editable() || !!app.doc.active?.text) });
function fill(color) { const d = doc(), a = d.active; if (!d.isEditingMask && !d.selection && a?.text && recolorText(d, a, color)) return; fillTarget(d, color); }
C_('edit.clear', 'Clear', ['Delete'], () => (selecting() ? clearSelection(doc()) : deleteTarget()), { enabled: has });
C_('edit.backspace', 'Delete Selection / Layer', ['Backspace'], () => (selecting() ? clearSelection(doc()) : deleteTarget()), { enabled: has, group: 'Tools and Canvas' });
function deleteTarget() { const d = doc(); if (layersPanel.selectedEffect) { layersPanel.deleteSelected(); return; } if (d.isEditingMask) { L.deleteMask(d, d.active); return; } L.deleteSelectedLayers(d); }
C_('edit.cafill', 'Content-Aware Fill', ['Shift+Backspace'], () => contentAwareFill(doc()).catch((e) => app.problem(e.message)), { enabled: () => selecting() && editable() && !app.doc.isEditingMask });
C_('edit.swap', 'Swap Colors', ['X'], () => app.swapColors(), { group: 'Tools and Canvas' });
C_('edit.reset', 'Default Colors', ['D'], () => update({ fg: '#000000', bg: '#ffffff' }), { group: 'Tools and Canvas' });
C_('edit.shortcuts', 'Keyboard Shortcuts…', ['Ctrl+K'], () => showShortcuts(), { needsDoc: false });

C_('sel.all', 'All', ['Ctrl+A'], () => S.selectAll(doc()), { enabled: has });
C_('sel.none', 'Deselect', ['Ctrl+D'], () => S.deselect(doc()), { enabled: selecting });
C_('sel.inverse', 'Inverse', ['Ctrl+Shift+I'], () => S.invertSelection(doc()), { enabled: has });
C_('sel.subject', 'Subject', ['Ctrl+Alt+A'], () => { if (!S.selectSubject(doc())) app.problem('No subject found: this works from a plain backdrop around the picture.'); }, { enabled: has });
const askAmount = async (title, def) => { const i = el('input', { type: 'number', min: 1, max: 500, value: def }); const r = await modal(title, [el('div', { class: 'row' }, el('label', {}, 'Pixels'), i)], [{ label: 'Cancel', value: false }, { label: 'OK', value: true, accent: true }]); return r ? Math.max(1, Math.round(+i.value || 1)) : null; };
C_('sel.expand', 'Expand…', [], async () => { const n = await askAmount('Expand Selection', 1); if (n) S.expandSelection(doc(), n); }, { enabled: selecting });
C_('sel.contract', 'Contract…', [], async () => { const n = await askAmount('Contract Selection', 1); if (n) S.contractSelection(doc(), n); }, { enabled: selecting });
C_('sel.feather', 'Feather…', ['Shift+F6'], async () => { const n = await askAmount('Feather Selection', 2); if (n) S.featherSelection(doc(), n); }, { enabled: selecting });
C_('sel.pixels', "Layer's Pixels", [], () => S.selectLayerPixels(doc(), doc().active), { enabled: () => !!app.doc?.active?.canvas });
C_('sel.mask', "Layer's Mask", [], () => S.selectLayerMask(doc(), doc().active), { enabled: () => !!app.doc?.active?.mask });

for (const t of ADJUSTMENT_TYPES) {
  const key = { levels: ['Ctrl+L'], curves: ['Ctrl+M'], hueSaturation: ['Ctrl+U'], invert: ['Ctrl+I'] }[t] || [];
  if (!['gaussianBlur', 'motionBlur', 'addNoise'].includes(t)) C_('adj.' + t, ADJUSTMENT_NAMES[t] + (t === 'invert' ? '' : '…'), key, () => adjustPixels(app, t).catch((e) => app.problem(e.message)), { enabled: editable });
  C_('newadj.' + t, ADJUSTMENT_NAMES[t] + (t === 'invert' ? '' : '…'), [], () => newAdjustmentLayer(app, t).catch((e) => app.problem(e.message)), { enabled: has });
}
C_('img.autolevels', 'Auto Levels', ['Ctrl+Shift+L'], () => autoLevelsNow(app), { enabled: editable });
C_('img.canvas', 'Canvas Size…', ['Ctrl+Alt+C'], async () => { const r = await canvasSizeDialog(doc(), limits); if (r) C.resizeCanvas(doc(), r.width, r.height, r.anchor); }, { enabled: has });
C_('img.size', 'Image Size…', ['Ctrl+Alt+I'], async () => { const r = await imageSizeDialog(doc(), limits); if (r) C.resizeImage(doc(), r.width, r.height, r.resolution); }, { enabled: has });
C_('img.trim', 'Trim…', [], async () => { const o = await trimDialog(); if (o && !C.trim(doc(), o)) app.problem('Nothing to trim.'); }, { enabled: has });
C_('img.rotcw', 'Rotate Canvas 90° Clockwise', [], () => C.rotateCanvas(doc(), true), { enabled: has });
C_('img.rotccw', 'Rotate Canvas 90° Counterclockwise', [], () => C.rotateCanvas(doc(), false), { enabled: has });
C_('img.fliph', 'Flip Canvas Horizontal', [], () => C.flipCanvas(doc(), true), { enabled: has });
C_('img.flipv', 'Flip Canvas Vertical', [], () => C.flipCanvas(doc(), false), { enabled: has });

C_('layer.new', 'New Layer', ['Ctrl+Shift+N', 'Alt+Shift+N'], () => L.addBlankLayer(doc()), { enabled: has });
C_('layer.dup', 'Duplicate Layer', ['Ctrl+J'], () => CB.layerViaCopy(doc()), { enabled: act });
C_('layer.delete', 'Delete Layer', [], () => L.deleteSelectedLayers(doc()), { enabled: act });
C_('layer.rename', 'Rename Layer', ['F2'], () => layersPanel.rename(), { enabled: act });
C_('layer.edittext', 'Edit Text', [], () => app.editText(doc().active), { enabled: () => !!app.doc?.active?.text });
C_('layer.editadj', 'Edit Adjustment…', [], () => app.editAdjustment(doc().active), { enabled: () => !!app.doc?.active?.adjustment });
C_('layer.raster', 'Rasterize Layer', [], () => rasterizeLayer(doc(), doc().active), { enabled: () => !!app.doc?.active?.isLive });
C_('layer.transform', 'Transform Layer', ['Ctrl+T', 'Alt+T'], () => { update({ transformControls: true }); app.selectTool('move'); }, { enabled: has });
C_('layer.clip', 'Create / Release Clipping Mask', ['Ctrl+Alt+G'], () => L.toggleClippingMask(doc(), doc().active), { enabled: () => !!app.doc?.active && L.canClip(app.doc, app.doc.active) });
C_('layer.group', 'Group Selected Layers', ['Ctrl+G'], () => L.groupSelectedLayers(doc()), { enabled: act });
C_('layer.ungroup', 'Ungroup', ['Ctrl+Shift+G'], () => L.ungroup(doc(), doc().active), { enabled: () => !!app.doc?.active?.isGroup });
C_('layer.up', 'Move Layer Up', ['Ctrl+]'], () => L.moveActiveLayer(doc(), 1), { enabled: act });
C_('layer.down', 'Move Layer Down', ['Ctrl+['], () => L.moveActiveLayer(doc(), -1), { enabled: act });
C_('layer.merge', () => (app.doc ? L.mergeTitle(app.doc) : 'Merge Down'), ['Ctrl+E'], () => L.mergeLayers(doc()), { enabled: () => !!app.doc && L.canMerge(app.doc) });
C_('layer.flatten', 'Flatten Image', [], () => L.flattenImage(doc()), { enabled: has });
C_('layer.addmask', 'Add Layer Mask', [], () => L.addMask(doc(), doc().active), { enabled: () => !!app.doc?.active && !app.doc.active.mask });
C_('layer.addmaskblack', 'Add Layer Mask: Hide All', [], () => L.addMask(doc(), doc().active, true), { enabled: () => !!app.doc?.active && !app.doc.active.mask });
C_('layer.delmask', 'Delete Layer Mask', [], () => L.deleteMask(doc(), doc().active), { enabled: () => !!app.doc?.active?.mask });
C_('layer.applymask', 'Apply Layer Mask', [], () => L.applyMask(doc(), doc().active), { enabled: () => !!app.doc?.active?.mask && !!app.doc.active.canvas });
C_('layer.invmask', 'Invert Layer Mask', [], () => L.invertMaskOf(doc(), doc().active), { enabled: () => !!app.doc?.active?.mask });
C_('layer.togglemask', 'Disable / Enable Layer Mask', [], () => { const l = doc().active; L.setMaskEnabled(doc(), l, !l.maskEnabled); }, { enabled: () => !!app.doc?.active?.mask });
C_('canvas.togglemask', 'Edit Mask / Pixels', ['\\'], () => { const d = doc(); d.editingMask = !d.editingMask; d.layersChanged(); }, { enabled: () => !!app.doc?.active?.mask, group: 'Tools and Canvas' });
C_('layer.rotcw', 'Rotate Layer 90° Clockwise', [], () => C.rotateLayers(doc(), 90), { enabled: act });
C_('layer.rotccw', 'Rotate Layer 90° Counterclockwise', [], () => C.rotateLayers(doc(), -90), { enabled: act });
C_('layer.rot180', 'Rotate Layer 180°', [], () => C.rotateLayers(doc(), 180), { enabled: act });
C_('layer.fliph', 'Flip Layer Horizontal', [], () => C.flipLayers(doc(), true), { enabled: act });
C_('layer.flipv', 'Flip Layer Vertical', [], () => C.flipLayers(doc(), false), { enabled: act });
for (const k of EFFECT_KINDS) C_('fx.' + k, effectName(k) + '…', [], () => app.editEffect(doc().active, k), { enabled: () => !!app.doc?.active?.canvas });

for (const f of FILTERS) C_('filter.' + f.id, f.name + '…', f.shortcut ? [f.shortcut] : [], () => runFilterDialog(app, f.id).catch((e) => app.problem(e.message)), { enabled: has });
C_('filter.repeat', 'Repeat Last Filter', ['Ctrl+F'], () => runFilterDialog(app, lastFilter.id, { repeat: true }).catch((e) => app.problem(e.message)), { enabled: () => !!app.doc && !!lastFilter.id && editable() });

C_('view.fit', 'Fit Canvas', ['Ctrl+0'], () => view.fit(), { enabled: has });
C_('view.rotcw', 'Rotate View 15° Clockwise', [], () => view.rotateView(15), { enabled: has });
C_('view.rotccw', 'Rotate View 15° Counterclockwise', [], () => view.rotateView(-15), { enabled: has });
C_('view.rotreset', 'Reset View Rotation', [], () => view.rotateView(0), { enabled: has });
C_('view.actual', 'Actual Pixels', ['Ctrl+1'], () => view.zoomTo(1), { enabled: has });
C_('view.in', 'Zoom In', ['Ctrl+='], () => view.zoomIn(), { enabled: has });
C_('view.out', 'Zoom Out', ['Ctrl+-'], () => view.zoomOut(), { enabled: has });
const toggle = (id, label, keys, key, store = 'view') => register(id, { label, keys, enabled: has, checked: () => (store === 'view' ? state.view[key] : state[key]), run: () => update(store === 'view' ? { view: { ...state.view, [key]: !state.view[key] } } : { [key]: !state[key] }) });
toggle('view.controls', 'Show Transform Controls', ['Ctrl+H'], 'transformControls', 'root');
toggle('view.pixelgrid', 'Pixel Grid (when zoomed in)', [], 'pixelGrid');
toggle('view.rulers', 'Rulers', ['Ctrl+R'], 'rulers');
toggle('view.grid', 'Show Grid', ["Ctrl+'"], 'grid');
toggle('view.guides', 'Show Guides', ['Ctrl+;'], 'guides');
toggle('view.snap', 'Snap', ['Ctrl+Shift+;'], 'snap');
toggle('view.lock', 'Lock Guides', ['Ctrl+Alt+;'], 'lockGuides');
toggle('view.snapguides', 'Snap To Guides', [], 'snapGuides'); toggle('view.snapgrid', 'Snap To Grid', [], 'snapGrid'); toggle('view.snaplayers', 'Snap To Layers', [], 'snapLayers'); toggle('view.snapbounds', 'Snap To Document Bounds', [], 'snapBounds');
C_('view.clearguides', 'Clear Guides', [], () => G.clearGuides(doc()), { enabled: () => !!app.doc?.guides.length });
C_('help.guide', 'Pixoto Help', ['F1'], () => showHelp(() => showShortcuts()), { needsDoc: false, group: 'Help' });
C_('help.about', 'About Pixoto', [], () => alertBox('About Pixoto', el('div', {}, el('p', {}, 'Made by Crowelian 2026.'), el('p', {}, 'In the October update, more features from Composa were added.'))), { needsDoc: false });

for (const t of TOOLS) C_('tool.' + t.id, t.name, [t.key.toUpperCase()], () => { if (state.tool === t.id && t.cycle) cycleMode(t.id); else { if (t.id === 'brush') app.setMode('brush', 0); app.selectTool(t.id); } }, { group: 'Tools', needsDoc: false });
C_('tool.erase', 'Eraser', ['E'], () => { app.setMode('brush', 1); app.selectTool('brush'); }, { group: 'Tools', needsDoc: false });
C_('tool.nextmode', 'Next mode of the current tool', ['Tab'], () => cycleMode(state.tool), { group: 'Tools and Canvas', enabled: () => !!toolById[state.tool].modes });

// ---- menu bar ------------------------------------------------------------------------------------------------
const adjItems = ADJUSTMENT_TYPES.filter((t) => !['gaussianBlur', 'motionBlur', 'addNoise'].includes(t)).map((t) => 'adj.' + t);
const filterMenu = FILTER_GROUPS.map((g) => ({ label: g, items: FILTERS.filter((f) => f.group === g).map((f) => 'filter.' + f.id) })).filter((g) => g.items.length);
const recentItems = () => { const out = recentCache.map((r) => ({ label: r.name, run: () => openRecent(r) })); return out.length ? [...out, '-', { label: 'Clear Recent', run: () => { clearRecents(); recentCache = []; renderRecents(); } }] : [{ label: 'No recent files', disabled: true, run() {} }]; };
let recentCache = [];
getRecents().then((r) => { recentCache = r; });
new MenuBar($('#menubar'), [
  { label: 'File', items: ['file.new', 'file.open', { label: 'Open Recent', items: () => { getRecents().then((r) => { recentCache = r; }); return recentItems(); } }, 'file.place', '-', 'file.save', 'file.saveas', '-', 'file.png', 'file.jpeg', 'file.webp', '-', 'file.close'] },
  { label: 'Edit', items: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.copymerged', 'edit.paste', '-', 'edit.fillfg', 'edit.fillbg', 'edit.clear', 'edit.cafill', '-', 'edit.swap', 'edit.reset', '-', 'edit.shortcuts'] },
  { label: 'Select', items: ['sel.all', 'sel.none', 'sel.inverse', 'sel.subject', '-', 'sel.expand', 'sel.contract', 'sel.feather', '-', 'sel.pixels', 'sel.mask'] },
  { label: 'Image', items: [{ label: 'Adjustments', items: adjItems }, 'img.autolevels', '-', 'img.canvas', 'img.size', 'img.trim', '-', 'img.rotcw', 'img.rotccw', 'img.fliph', 'img.flipv'] },
  { label: 'Layer', items: ['layer.new', 'layer.dup', 'layer.delete', 'layer.rename', '-', { label: 'New Adjustment Layer', items: ADJUSTMENT_TYPES.map((t) => 'newadj.' + t) }, { label: 'Layer Effects', items: EFFECT_KINDS.map((k) => 'fx.' + k) }, 'layer.editadj', 'layer.edittext', 'layer.raster', '-',
    { label: 'Layer Mask', items: ['layer.addmask', 'layer.addmaskblack', 'layer.delmask', 'layer.applymask', 'layer.invmask', 'layer.togglemask'] }, 'layer.clip', 'layer.group', 'layer.ungroup', '-', 'layer.transform',
    { label: 'Rotate / Flip Layer', items: ['layer.rotcw', 'layer.rotccw', 'layer.rot180', 'layer.fliph', 'layer.flipv'] }, '-', 'layer.up', 'layer.down', '-', 'layer.merge', 'layer.flatten'] },
  { label: 'Filter', items: ['filter.repeat', '-', 'filter.cameraRaw', '-', ...filterMenu] },
  { label: 'View', items: ['view.fit', 'view.actual', 'view.in', 'view.out', 'view.rotcw', 'view.rotccw', 'view.rotreset', '-', 'view.controls', 'view.pixelgrid', '-', 'view.rulers', 'view.grid', 'view.guides', 'view.clearguides', 'view.lock', '-', 'view.snap', { label: 'Snap To', items: ['view.snapguides', 'view.snapgrid', 'view.snaplayers', 'view.snapbounds'] }] },
  { label: 'Help', items: ['help.guide', 'edit.shortcuts', 'help.about'] },
]);
$('#menubar').insertAdjacentHTML('beforeend', '<div class="spacer"></div>');

// ---- keyboard ---------------------------------------------------------------------------------------------------
rebuild();
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || inTextField(e.target) || document.querySelector('.scrim, .floatdlg')) return;
  const mod = e.ctrlKey || e.metaKey;
  // Ctrl+V is left to the browser so the paste event can read the system clipboard.
  if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyV') return;
  if (app.doc && !mod && !e.altKey && view.handleKey(e)) { e.preventDefault(); return; }
  if (app.doc && view.drag && e.key !== 'Escape' && !e.repeat) return;   // commands wait until a drag ends
  const c = findByEvent(e);
  if (!c) return;
  const ok = isEnabled(c);
  if (ok || c.todo || e.ctrlKey || e.metaKey || e.altKey) e.preventDefault();
  if (ok && !e.repeat) execute(c.id);
});
window.addEventListener('paste', async (e) => {
  if (inTextField(e.target) || !app.doc) return;
  e.preventDefault();
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { for (const f of files) { const canvas = await loadImage(f); CB.paste(app.doc, { canvas, origin: { x: 0, y: 0 } }, 'Pasted Layer'); } app.selectTool('move'); return; }
  CB.paste(app.doc);
});
async function pasteFromSystem() {
  try {
    if (navigator.clipboard?.read) {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) { const canvas = await loadImage(await item.getType(type)); CB.paste(doc(), { canvas, origin: { x: 0, y: 0 } }); return; }
      }
    }
  } catch {}
  if (!CB.paste(doc())) app.problem('Nothing to paste.');
}

// ---- welcome, drag and drop, misc ---------------------------------------------------------------------------------
$('#w-new').onclick = () => app.newCanvas();
$('#w-open').onclick = () => pickFiles(false);
const mask = $('#dropmask');
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); dragDepth++; mask.hidden = false; } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; mask.hidden = true; } });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; mask.hidden = true;
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|svg|ico|cmps|psd|psb)$/i.test(f.name));
  if (!files.length) return;
  const at = app.doc && e.target === $('#view') ? view.screenToCanvas(e.clientX, e.clientY) : null;
  app.placeImages(files, at);
});
window.addEventListener('beforeunload', (e) => { if (app.docs.some((d) => d.modified)) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('error', (e) => app.problem(e.message));
window.addEventListener('unhandledrejection', (e) => app.problem(String(e.reason?.message || e.reason)));
window.addEventListener('pagehide', () => { for (const d of app.docs) if (!d.modified) dropRecovery(d.id); });

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 60 * 60 * 1000);
  }).catch(() => {});
}
installGuidesUi(app);

// ---- start ---------------------------------------------------------------------------------------------------------
refreshTool();
attach(null);
(async () => {
  const lost = await listRecovery();
  if (!lost.length) return;
  const r = await recoveryDialog(lost);
  for (const item of lost) {
    if (r.action === 'recover' && r.ids.includes(item.id)) {
      try { const doc = await readProject(await item.blob.arrayBuffer(), item.name); doc.markModified(); app.addDoc(doc); } catch (e) { app.problem('Could not recover ' + item.name + ': ' + e.message); }
    }
    dropRecovery(item.id);
  }
})();
window.pixoto = app;
