import { el, icon, iconBtn } from './dom.js';
import { BLEND_GROUPS, blendName } from '../core/blend.js';
import { EFFECT_KINDS, effectName, effectKinds, effectEnabled, effectKey } from '../core/effects.js';
import { popup } from './popup.js';
import * as L from '../core/ops/layers.js';
import * as S from '../core/ops/selection.js';
import { rasterizeLayer } from '../core/ops/live.js';

const THUMB = 72;

// Layers panel (Composa LayersPanel): blend + opacity on top, rows top layer first with folders, masks, clipping arrows and
// effect rows, action buttons below. Click selects, Ctrl-click adds, Shift-click ranges, Alt-click clips, drag reorders or nests.
export class LayersPanel {
  constructor(root, app) {
    this.root = root; this.app = app; this.doc = null; this.unsub = null; this.rows = new Map(); this.selectedEffect = null;
    this.blend = el('select', { 'aria-label': 'Blend mode', onChange: () => { this.blend.blur(); this.applyBlend(this.blend.value); } },
      BLEND_GROUPS.flatMap((g, i) => [i ? el('hr') : null, ...g.map((m) => el('option', { value: m }, blendName(m)))]));
    this.opacity = el('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Opacity' });
    this.opVal = el('span', { class: 'val' }, '100%');
    this.opacity.addEventListener('input', () => {
      const l = this.layer(); if (!l) return;
      if (!this.doc.hasPendingEdit) this.doc.beginProps('Change Opacity');
      this.doc.setProp(l, 'opacity', this.opacity.value / 100); this.opVal.textContent = this.opacity.value + '%';
    });
    this.opacity.addEventListener('change', () => this.doc?.endProps());
    this.list = el('div', { id: 'layerlist' });
    this.buttons = {
      add: iconBtn('new-layer', 'New layer (Ctrl+Shift+N)', () => this.doc && L.addBlankLayer(this.doc)),
      folder: iconBtn('new-folder', 'Group selected layers (Ctrl+G)', () => this.doc && L.groupSelectedLayers(this.doc)),
      mask: iconBtn('mask', 'Add layer mask', () => this.maskButton()),
      effects: iconBtn('effects', 'Layer effects', (e) => this.effectsMenu(e)),
      adjust: iconBtn('adjust', 'New adjustment layer', (e) => app.adjustmentMenu(e.clientX, e.clientY)),
      del: iconBtn('trash', 'Delete layer, mask or effect', () => this.deleteSelected()),
    };
    root.append(
      el('div', { class: 'head' }, 'Layers'),
      el('div', { class: 'lp-props' }, el('div', { class: 'r' }, el('label', {}, 'Blend'), this.blend), el('div', { class: 'r' }, el('label', {}, 'Opacity'), this.opacity, this.opVal)),
      this.list,
      el('div', { class: 'lp-foot' }, this.buttons.add, this.buttons.folder, this.buttons.mask, this.buttons.effects, this.buttons.adjust, el('span', { class: 'grow' }), this.buttons.del));
    this.list.addEventListener('contextmenu', (e) => { e.preventDefault(); });
  }
  layer() { return this.doc?.active || null; }
  applyBlend(v) {
    const d = this.doc, roots = d.selectedRoots();
    if (roots.length > 1) d.apply('Blend Mode', () => roots.forEach((l) => { l.blend = v; })), d.invalidate(null), d.layersChanged();
    else if (this.layer()) L.setBlend(d, this.layer(), v);
  }

  setDoc(doc) {
    this.unsub?.();
    this.doc = doc; this.selectedEffect = null;
    if (doc) this.unsub = doc.on((kind) => { if (kind === 'layers' || kind === 'history' || kind === 'size') this.refresh(true); else if (kind === 'canvas') this.updateThumbs(); });
    this.refresh(true);
  }

  refresh(structure = true) {
    const d = this.doc, l = this.layer();
    this.blend.disabled = this.opacity.disabled = !l;
    this.buttons.add.disabled = !d; this.buttons.del.disabled = !l; this.buttons.folder.disabled = !l; this.buttons.mask.disabled = !l; this.buttons.effects.disabled = !l?.canvas; this.buttons.adjust.disabled = !d;
    if (this.buttons.mask) this.buttons.mask.title = l?.mask ? 'Delete layer mask' : 'Add layer mask';
    if (l && !d.hasPendingEdit) { this.blend.value = l.blend; this.opacity.value = Math.round(l.opacity * 100); this.opVal.textContent = Math.round(l.opacity * 100) + '%'; }
    if (!l) this.opVal.textContent = '';
    if (structure) this.renderRows(); else this.updateThumbs();
  }

  // ---- rendering ----------------------------------------------------------------------------------------------
  flatRows() {
    const out = [], walk = (list, depth, hiddenAbove) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const l = list[i];
        out.push({ layer: l, depth, hiddenAbove, clipped: l.clipped && i > 0 });
        if (l.isGroup && !l.collapsed) walk(l.children, depth + 1, hiddenAbove || !l.visible);
        if (l.effects) for (const kind of effectKinds(l.effects)) out.push({ effect: kind, layer: l, depth });
      }
    };
    walk(this.doc.layers, 0, false);
    return out;
  }
  renderRows() {
    const d = this.doc;
    this.list.replaceChildren(); this.rows = new Map();
    if (!d) return;
    for (const r of this.flatRows()) {
      if (r.effect) { this.list.append(this.effectRow(r)); continue; }
      const l = r.layer, sel = d.selectedIds.has(l.id);
      const eye = el('button', { class: 'eye' + (l.visible ? '' : ' off'), title: 'Show / hide (Alt-click solos, drag to swipe)', 'aria-label': 'Toggle visibility' }, icon(l.visible ? 'eye' : 'eye-off'));
      eye.addEventListener('pointerdown', (e) => this.eyeDown(e, l));
      const kids = [];
      if (l.isGroup) { const t = el('button', { class: 'twist', title: l.collapsed ? 'Expand' : 'Collapse', onClick: (e) => { e.stopPropagation(); d.apply(l.collapsed ? 'Expand Folder' : 'Collapse Folder', () => { l.collapsed = !l.collapsed; }); this.renderRows(); } }, icon(l.collapsed ? 'chevron-right' : 'chevron-down')); kids.push(t); }
      let thumb;
      if (l.canvas) { thumb = el('canvas', { class: 'thumb', width: THUMB, height: THUMB }); thumb.addEventListener('dblclick', (e) => { if (l.text) { e.stopPropagation(); this.app.editText(l); } }); }
      else thumb = el('span', { class: 'thumb sym' }, icon(l.isGroup ? 'folder' : 'adjust'));
      const maskThumb = l.mask ? el('canvas', { class: 'thumb mask' + (d.isEditingMask && l.id === d.activeId ? ' edit' : '') + (l.maskEnabled ? '' : ' off'), width: 48, height: 48, title: 'Layer mask (click to paint, Shift-click disables, Ctrl-click loads selection)' }) : null;
      if (maskThumb) maskThumb.addEventListener('pointerdown', (e) => this.maskDown(e, l));
      const name = el('span', { class: 'name' + (l.isLive ? ' live' : '') }, l.name);
      const row = el('div', { class: 'lrow' + (sel ? ' on' : '') + (l.id === d.activeId ? ' active' : '') + (r.hiddenAbove ? ' dim' : ''), 'data-id': l.id, style: `padding-left:${6 + r.depth * 16}px` },
        r.clipped ? el('span', { class: 'clip' }, icon('clip-arrow')) : null, eye, ...kids, thumb, maskThumb, name, l.blend !== 'normal' ? el('span', { class: 'blend' }, blendName(l.blend)) : null);
      row.addEventListener('pointerdown', (e) => { if (e.target.closest('.eye') || e.target.closest('input') || e.target.closest('.mask') || e.target.closest('.twist')) return; this.rowDown(e, l, row); });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!d.selectedIds.has(l.id)) L.selectLayer(d, l.id); this.contextMenu(e, l); });
      name.addEventListener('dblclick', () => this.rename(l));
      row.addEventListener('dblclick', (e) => { if (e.target.closest('.eye') || e.target.closest('.name') || e.target.closest('.thumb.mask')) return; if (l.isAdjustment) this.app.editAdjustment(l); });
      this.rows.set(l.id, { row, thumb: l.canvas ? thumb : null, maskThumb, version: -1, mver: -1, cv: null, mv: null });
      this.list.append(row);
    }
    this.updateThumbs();
  }
  effectRow(r) {
    const d = this.doc, { layer: l, effect: kind } = r, on = effectEnabled(l.effects, kind), sel = this.selectedEffect?.layerId === l.id && this.selectedEffect.kind === kind;
    const eye = el('button', { class: 'eye' + (on ? '' : ' off'), title: 'Show / hide effect' }, icon(on ? 'eye' : 'eye-off'));
    eye.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.app.setEffectEnabled(l, kind, !on); });
    const row = el('div', { class: 'lrow fxrow' + (sel ? ' on' : ''), style: `padding-left:${28 + r.depth * 16}px` }, eye, el('span', { class: 'name' }, effectName(kind)));
    row.addEventListener('pointerdown', (e) => { if (e.target.closest('.eye')) return; this.selectedEffect = { layerId: l.id, kind }; if (d.activeId !== l.id) L.selectLayer(d, l.id); this.renderRows(); });
    row.addEventListener('dblclick', () => this.app.editEffect(l, kind));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); popup([{ label: 'Edit…', run: () => this.app.editEffect(l, kind) }, { label: on ? 'Hide' : 'Show', run: () => this.app.setEffectEnabled(l, kind, !on) }, { label: 'Delete', run: () => this.app.deleteEffect(l, kind) }], e.clientX, e.clientY); });
    return row;
  }
  updateThumbs() {
    for (const l of this.doc ? [...this.doc.allLayers()] : []) {
      const r = this.rows.get(l.id); if (!r) continue;
      if (r.thumb && (r.cv !== l.canvas || r.version !== (l.canvas.rev || 0))) {
        r.cv = l.canvas; r.version = l.canvas.rev || 0;
        const c = r.thumb.getContext('2d'), k = Math.min(THUMB / l.canvas.width, THUMB / l.canvas.height);
        c.clearRect(0, 0, THUMB, THUMB); c.imageSmoothingQuality = 'high';
        c.drawImage(l.canvas, (THUMB - l.canvas.width * k) / 2, (THUMB - l.canvas.height * k) / 2, l.canvas.width * k, l.canvas.height * k);
      }
      if (r.maskThumb && l.mask && (r.mv !== l.mask || r.mver !== l.mask.version)) {
        r.mv = l.mask; r.mver = l.mask.version;
        const c = r.maskThumb.getContext('2d'), m = l.mask, k = Math.min(48 / m.width, 48 / m.height);
        c.fillStyle = '#000'; c.fillRect(0, 0, 48, 48); c.imageSmoothingQuality = 'high';
        c.drawImage(m.grayCanvas(), (48 - m.width * k) / 2, (48 - m.height * k) / 2, m.width * k, m.height * k);
      }
    }
  }

  // ---- mask thumbnail ------------------------------------------------------------------------------------------------
  maskDown(e, l) {
    e.preventDefault(); e.stopPropagation();
    const d = this.doc;
    if (d.activeId !== l.id) L.selectLayer(d, l.id);
    if (e.ctrlKey || e.metaKey) { S.selectLayerMask(d, l, e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace'); return; }
    if (e.shiftKey) { L.setMaskEnabled(d, l, !l.maskEnabled); return; }
    d.editingMask = true; d.layersChanged();
  }
  maskButton() {
    const l = this.layer(), d = this.doc; if (!l) return;
    if (l.mask) L.deleteMask(d, l); else L.addMask(d, l);
  }
  effectsMenu(e) {
    const l = this.layer(); if (!l?.canvas) return;
    const r = e.currentTarget.getBoundingClientRect();
    popup(EFFECT_KINDS.map((k) => ({ label: effectName(k) + '…', run: () => this.app.editEffect(l, k) })), r.left, r.top - 170);
  }
  deleteSelected() {
    const d = this.doc, l = this.layer(); if (!l) return;
    if (this.selectedEffect) { const { layerId, kind } = this.selectedEffect; this.selectedEffect = null; const t = d.find(layerId); if (t) this.app.deleteEffect(t, kind); return; }
    if (d.isEditingMask) { L.deleteMask(d, l); return; }
    L.deleteSelectedLayers(d);
  }

  // ---- visibility: toggle, swipe down the eye column, Alt-click solo -----------------------------------------------------
  eyeDown(e, layer) {
    e.preventDefault(); e.stopPropagation();
    const d = this.doc;
    if (e.altKey) {
      const all = [...d.allLayers()], keep = new Set([layer.id]);
      for (let p = d.parentOf(layer.id); p; p = d.parentOf(p.id)) keep.add(p.id);
      for (const c of d.allLayers(layer.children)) keep.add(c.id);
      const isSolo = layer.visible && all.every((x) => keep.has(x.id) || !x.visible);
      if (isSolo && this.soloBackup) { const b = this.soloBackup; this.soloBackup = null; d.apply('Show All Layers', () => all.forEach((x) => { x.visible = b.has(x.id) ? b.get(x.id) : true; })); }
      else { this.soloBackup = new Map(all.map((x) => [x.id, x.visible])); d.apply('Solo Layer', () => all.forEach((x) => { x.visible = keep.has(x.id); })); }
      d.invalidate(null); d.layersChanged();
      return;
    }
    const target = !layer.visible;
    d.beginProps('Show / Hide Layer');
    const apply = (l) => { if (l.visible !== target) { l.visible = target; d.invalidate(null); } };
    apply(layer); this.renderRows();
    const move = (ev) => { const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.lrow[data-id]'); const l = row && d.find(+row.dataset.id); if (l && l.visible !== target) { apply(l); this.renderRows(); } };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); d.endProps(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
  isAncestor(a, b) { return [...this.doc.allLayers(a.children)].includes(b); }

  // ---- select, drag to reorder / nest -----------------------------------------------------------------------------------
  rowDown(e, layer, row) {
    const d = this.doc;
    this.selectedEffect = null;
    if (e.button === 0 && e.altKey && !e.shiftKey && !e.ctrlKey) { L.toggleClippingMask(d, layer); return; }
    if (e.button === 0) {
      if (e.ctrlKey || e.metaKey) L.selectLayer(d, layer.id, { extend: true });
      else if (e.shiftKey) L.selectLayer(d, layer.id, { range: true });
      else if (!d.selectedIds.has(layer.id) || d.activeId !== layer.id) { L.selectLayer(d, layer.id); if (!e.target.closest('.thumb.mask')) d.editingMask = false; }
      else d.editingMask = false;
    } else if (e.button === 2) return;
    if (e.button !== 0) return;
    const startY = e.clientY, id = e.pointerId, dragged = d.selectedRoots();
    let dragging = false, drop = null;
    const line = el('div', { class: 'dropline' }), box = el('div', { class: 'dropbox' });
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      if (!dragging && Math.abs(ev.clientY - startY) > 6) { dragging = true; this.list.append(line, box); row.classList.add('dragging'); }
      if (!dragging) return;
      const els = [...this.list.querySelectorAll('.lrow[data-id]')], lr = this.list.getBoundingClientRect();
      drop = null; line.style.display = box.style.display = 'none';
      for (const r of els) {
        const b = r.getBoundingClientRect();
        if (ev.clientY < b.top || ev.clientY >= b.bottom) continue;
        const t = d.find(+r.dataset.id), f = (ev.clientY - b.top) / b.height;
        if (t.isGroup && f > 0.25 && f < 0.75) { drop = { target: t, mode: 'into' }; box.style.display = ''; Object.assign(box.style, { top: r.offsetTop + 'px', height: r.offsetHeight + 'px' }); }
        else { drop = { target: t, mode: f < 0.5 ? 'above' : 'below' }; line.style.display = ''; line.style.top = (r.offsetTop + (f < 0.5 ? 0 : r.offsetHeight) - 1) + 'px'; }
        break;
      }
      if (ev.clientY < lr.top + 20) this.list.scrollTop -= 8; else if (ev.clientY > lr.bottom - 20) this.list.scrollTop += 8;
    };
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      line.remove(); box.remove(); row.classList.remove('dragging');
      if (!dragging || !drop) return;
      // The list shows the top layer first, so a visual 'above' is stacked after the target, a visual 'below' before it.
      const t = drop.target;
      if (ev.altKey) { L.duplicateSelectedLayers(d); return; }
      if (drop.mode === 'into') L.moveLayers(d, dragged, t, 'into');
      else L.moveLayers(d, dragged, t, drop.mode === 'above' ? 'above' : 'below');
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  contextMenu(e, l) {
    const d = this.doc, multi = d.selectedRoots().length > 1;
    const items = [
      { label: 'Duplicate', run: () => L.duplicateSelectedLayers(d) }, { label: 'Rename', run: () => this.rename(l) }, { label: multi ? 'Delete Layers' : 'Delete', run: () => L.deleteSelectedLayers(d) }, '-',
      l.isAdjustment ? { label: 'Edit Adjustment…', run: () => this.app.editAdjustment(l) } : null,
      l.text ? { label: 'Edit Text', run: () => this.app.editText(l) } : null,
      l.isLive ? { label: 'Rasterize Layer', run: () => rasterizeLayer(d, l) } : null,
      L.canClip(d, l) ? { label: l.clipped ? 'Release Clipping Mask' : 'Create Clipping Mask', run: () => L.toggleClippingMask(d, l) } : null,
      { label: 'Group Layers', run: () => L.groupSelectedLayers(d) }, l.isGroup ? { label: 'Ungroup', run: () => L.ungroup(d, l) } : null,
      d.parentOf(l.id) ? { label: 'Move Out of Folder', run: () => L.moveOutOfFolder(d, l) } : null, '-',
      { label: L.mergeTitle(d), disabled: !L.canMerge(d), run: () => L.mergeLayers(d) }, '-',
      !l.mask ? { label: 'Add Layer Mask', run: () => L.addMask(d, l) } : null,
      !l.mask ? { label: 'Add Mask: Hide All (Black)', run: () => L.addMask(d, l, true) } : null,
      l.mask ? { label: 'Delete Mask', run: () => L.deleteMask(d, l) } : null,
      l.mask && l.canvas ? { label: 'Apply Mask', run: () => L.applyMask(d, l) } : null,
      l.mask ? { label: l.maskEnabled ? 'Disable Mask' : 'Enable Mask', run: () => L.setMaskEnabled(d, l, !l.maskEnabled) } : null,
      l.mask ? { label: 'Invert Mask', run: () => L.invertMaskOf(d, l) } : null,
      l.mask ? { label: 'Select Mask', run: () => S.selectLayerMask(d, l) } : null,
      l.canvas ? { label: 'Select Pixels', run: () => S.selectLayerPixels(d, l) } : null, '-',
      { label: l.visible ? 'Hide' : 'Show', run: () => L.setVisible(d, l, !l.visible) },
    ].filter(Boolean);
    popup(items, e.clientX, e.clientY);
  }

  rename(layer = this.layer()) {
    const r = layer && this.rows.get(layer.id); if (!r) return;
    const nameEl = r.row.querySelector('.name');
    const input = el('input', { class: 'rename', type: 'text', value: layer.name });
    let done = false;
    const finish = (commit) => { if (done) return; done = true; const v = input.value.trim(); if (commit && v && v !== layer.name) L.renameLayer(this.doc, layer, v); else this.renderRows(); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    nameEl.replaceWith(input); input.focus(); input.select();
  }
}
