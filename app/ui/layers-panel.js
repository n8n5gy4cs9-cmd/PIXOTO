import { el, icon, iconBtn } from './dom.js';
import { BLEND_GROUPS, blendName } from '../core/blend.js';

// Layers panel (Composa LayersPanel): blend + opacity on top, rows top layer first, action buttons below.
export class LayersPanel {
  constructor(root, getDoc) {
    this.root = root; this.getDoc = getDoc;
    this.blend = el('select', { 'aria-label': 'Blend mode', onChange: () => { this.blend.blur(); const l = this.layer(); if (l) this.doc.setPropStep(l, 'blend', this.blend.value, 'Change Blend Mode'); } },
      BLEND_GROUPS.flatMap((g, i) => [i ? el('hr') : null, ...g.map((m) => el('option', { value: m }, blendName(m)))]));
    this.opacity = el('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Opacity' });
    this.opVal = el('span', { class: 'val' }, '100%');
    this.opacity.addEventListener('input', () => {
      const l = this.layer(); if (!l) return;
      if (!this.doc._pending) this.doc.beginProps(l, 'Change Opacity');
      this.doc.setProp(l, 'opacity', this.opacity.value / 100); this.opVal.textContent = this.opacity.value + '%';
    });
    this.opacity.addEventListener('change', () => this.doc?.endProps());
    this.list = el('div', { id: 'layerlist' });
    this.buttons = {
      add: iconBtn('new-layer', 'New layer (Ctrl+Shift+N)', () => this.doc?.newLayer()),
      folder: iconBtn('new-folder', 'New folder (coming soon)', () => {}),
      mask: iconBtn('mask', 'Add layer mask (coming soon)', () => {}),
      adjust: iconBtn('adjust', 'New adjustment layer (coming soon)', () => {}),
      del: iconBtn('trash', 'Delete layer', () => this.doc?.deleteLayer()),
    };
    this.buttons.folder.disabled = this.buttons.mask.disabled = this.buttons.adjust.disabled = true;
    root.append(
      el('div', { class: 'head' }, 'Layers'),
      el('div', { class: 'lp-props' },
        el('div', { class: 'r' }, el('label', {}, 'Blend'), this.blend),
        el('div', { class: 'r' }, el('label', {}, 'Opacity'), this.opacity, this.opVal)),
      this.list,
      el('div', { class: 'lp-foot' }, this.buttons.add, this.buttons.folder, this.buttons.mask, this.buttons.adjust, el('span', { class: 'grow' }), this.buttons.del));
    this.unsub = null; this.doc = null;
  }
  layer() { return this.doc?.active || null; }

  setDoc(doc) {
    this.unsub?.();
    this.doc = doc;
    if (doc) this.unsub = doc.on((structure) => this.refresh(structure));
    this.refresh(true);
  }

  refresh(structure = true) {
    const d = this.doc, l = this.layer();
    const has = !!d;
    this.blend.disabled = this.opacity.disabled = !l;
    this.buttons.add.disabled = !has; this.buttons.del.disabled = !l;
    if (l && !d._pending) { this.blend.value = l.blend; this.opacity.value = Math.round(l.opacity * 100); this.opVal.textContent = Math.round(l.opacity * 100) + '%'; }
    if (!l) { this.opVal.textContent = ''; }
    if (structure || !this.rows) this.renderRows(); else this.updateThumbs();
  }

  renderRows() {
    const d = this.doc;
    this.list.replaceChildren();
    this.rows = new Map();
    if (!d) return;
    for (const l of [...d.layers].reverse()) {
      const eye = el('button', { class: 'eye' + (l.visible ? '' : ' off'), title: 'Show / hide (Alt-click solos, drag to swipe)', 'aria-label': 'Toggle visibility' }, icon(l.visible ? 'eye' : 'eye-off'));
      eye.addEventListener('pointerdown', (e) => this.eyeDown(e, l));
      const thumb = el('canvas', { class: 'thumb', width: 72, height: 72 });
      const name = el('span', { class: 'name' }, l.name);
      const row = el('div', { class: 'lrow' + (l.id === d.activeId ? ' on' : ''), 'data-id': l.id }, eye, thumb, name,
        l.blend !== 'normal' ? el('span', { class: 'blend' }, blendName(l.blend)) : null);
      row.addEventListener('pointerdown', (e) => { if (e.target.closest('.eye') || e.target.closest('input')) return; this.rowDown(e, l, row); });
      name.addEventListener('dblclick', () => this.rename(l));
      this.rows.set(l.id, { row, thumb, version: -1 });
      this.list.append(row);
    }
    this.updateThumbs();
  }
  updateThumbs() {
    for (const l of this.doc?.layers || []) {
      const r = this.rows.get(l.id); if (!r || r.version === l.version) continue;
      r.version = l.version;
      const c = r.thumb.getContext('2d'), k = Math.min(72 / l.width, 72 / l.height);
      c.clearRect(0, 0, 72, 72);
      c.imageSmoothingQuality = 'high';
      c.drawImage(l.canvas, (72 - l.width * k) / 2, (72 - l.height * k) / 2, l.width * k, l.height * k);
    }
  }

  // ---- visibility: toggle, swipe down the eye column, Alt-click solo --------
  eyeDown(e, layer) {
    e.preventDefault(); e.stopPropagation();
    const d = this.doc;
    if (e.altKey) {
      const solo = d.layers.every((x) => x === layer ? x.visible : !x.visible);
      d.edit('Solo Layer', () => d.layers.forEach((x) => { x.visible = solo ? true : x === layer; }));
      return;
    }
    const target = !layer.visible;
    d.beginProps(layer, 'Show / Hide Layer');
    const apply = (l) => { if (l.visible !== target) d.setProp(l, 'visible', target); };
    apply(layer);
    this.refresh(true);
    const move = (ev) => {
      const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.lrow');
      const l = row && d.layers.find((x) => x.id === +row.dataset.id);
      if (l && l.visible !== target) { apply(l); this.refresh(true); }
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); d.endProps(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  // ---- select + drag to reorder -------------------------------------------
  rowDown(e, layer, row) {
    const d = this.doc;
    if (d.activeId !== layer.id) d.setActive(layer.id);
    if (e.button !== 0) return;
    const startY = e.clientY, id = e.pointerId;
    let dragging = false, slot = 0;
    const line = el('div', { class: 'dropline' });
    const rowsEls = () => [...this.list.querySelectorAll('.lrow')];
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      if (!dragging && Math.abs(ev.clientY - startY) > 6) { dragging = true; this.list.append(line); this.list.querySelector(`.lrow[data-id="${layer.id}"]`)?.classList.add('dragging'); }
      if (!dragging) return;
      const els = rowsEls(), lr = this.list.getBoundingClientRect();
      slot = els.findIndex((r) => ev.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
      if (slot < 0) slot = els.length;
      const top = slot < els.length ? els[slot].offsetTop : (els.at(-1)?.offsetTop + els.at(-1)?.offsetHeight);
      line.style.top = (top - 1) + 'px';
      if (ev.clientY < lr.top + 20) this.list.scrollTop -= 8; else if (ev.clientY > lr.bottom - 20) this.list.scrollTop += 8;
    };
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      line.remove();
      if (!dragging) return;
      const n = d.layers.length, t = n - 1 - d.layers.indexOf(layer);
      const p = slot > t ? slot - 1 : slot;
      d.moveLayer(layer, n - 1 - p);
      this.refresh(true);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  rename(layer = this.layer()) {
    const r = layer && this.rows.get(layer.id); if (!r) return;
    const nameEl = r.row.querySelector('.name');
    const input = el('input', { class: 'rename', type: 'text', value: layer.name });
    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      const v = input.value.trim();
      if (commit && v && v !== layer.name) this.doc.setPropStep(layer, 'name', v, 'Rename Layer'); else this.refresh(true);
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    nameEl.replaceWith(input); input.focus(); input.select();
  }
}
