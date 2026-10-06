import { el, icon } from './dom.js';
import { toolById } from '../core/tools.js';
import { state, update } from '../core/state.js';
import { pickColor } from './color-picker.js';
import * as S from '../core/ops/selection.js';
import { textSession } from '../core/ops/live.js';
import { setTransform } from '../core/ops/transform.js';
import { trim } from '../core/ops/canvas.js';
import { CROP_RATIOS } from './tools/crop.js';
import { FONT_FAMILIES } from './fonts.js';

const slider = (label, get, set, min, max, step = 1, unit = '') => () => {
  const val = el('input', { type: 'number', class: 'val', min, max, step, value: get() });
  const input = el('input', { type: 'range', min, max, step, value: get() });
  input.addEventListener('input', () => { set(+input.value); val.value = input.value; });
  val.addEventListener('input', () => { const v = +val.value; if (val.value !== '' && !isNaN(v)) { const c = Math.min(max, Math.max(min, v)); set(c); input.value = c; } });
  return el('div', { class: 'opt' }, el('label', {}, label), input, val, unit ? el('span', { class: 'unit' }, unit) : null);
};
const check = (label, get, set) => () => {
  const c = el('input', { type: 'checkbox', checked: get() });
  c.addEventListener('change', () => set(c.checked));
  return el('label', { class: 'opt chk', style: 'cursor:pointer;color:var(--fg)' }, c, label);
};
const brush = (k, scale = 1) => ({ get: () => Math.round(state.brush[k] * scale), set: (v) => update({ brush: { ...state.brush, [k]: v / scale } }) });
const B = (label, k, min, max, scale = 1, unit = '') => slider(label, brush(k, scale).get, brush(k, scale).set, min, max, 1, unit);
const SL = (label, key, min, max, scale = 1) => slider(label, () => Math.round(state[key] * scale), (v) => update({ [key]: v / scale }), min, max);
const CK = (label, key) => check(label, () => state[key], (v) => update({ [key]: v }));

// Per-tool settings (Composa MainWindow.Options). Controls bind to shared state, so they survive tab switches.
export class OptionsBar {
  constructor(root, app) {
    this.root = root; this.app = app; this.amounts = { expand: 1, contract: 1, feather: 2 };
    this.OPTIONS = {
      move: [CK('Auto Select', 'autoSelect'), CK('Transform controls', 'transformControls'), () => this.transformFields()],
      marquee: [SL('Feather', 'feather', 0, 100), () => this.selectionButtons()],
      lasso: [SL('Feather', 'feather', 0, 100), () => this.selectionButtons()],
      wand: [SL('Tolerance', 'wandTolerance', 0, 255), CK('Contiguous', 'wandContiguous'), CK('Sample all layers', 'wandAllLayers'), () => (state.modes.wand === 1 ? slider('Edge', () => state.objectEdge, (v) => update({ objectEdge: v }), -10, 10)() : null), () => this.selectionButtons()],
      crop: [() => this.cropBar()],
      brush: [B('Size', 'size', 1, 500), B('Hardness', 'hardness', 0, 100, 100, '%'), B('Opacity', 'opacity', 1, 100, 100, '%'), B('Smoothing', 'smoothing', 0, 100)],
      heal: [B('Size', 'size', 1, 500), B('Hardness', 'hardness', 0, 100, 100, '%')],
      clone: [B('Size', 'size', 1, 500), B('Hardness', 'hardness', 0, 100, 100, '%'), B('Opacity', 'opacity', 1, 100, 100, '%'), CK('Aligned', 'cloneAligned'), CK('Sample all layers', 'cloneAllLayers')],
      smear: [B('Size', 'size', 1, 500), B('Hardness', 'hardness', 0, 100, 100, '%'), B('Strength', 'opacity', 1, 100, 100, '%')],
      gradient: [CK('Foreground to transparent', 'gradientToTransparent'), CK('Radial', 'gradientRadial'), SL('Opacity', 'gradientOpacity', 1, 100, 100), () => this.gradientButtons()],
      shape: [slider('Corner radius', () => state.shapeCornerRadius, (v) => update({ shapeCornerRadius: v }), 0, 400), slider('Line width', () => state.shapeLineWidth, (v) => update({ shapeLineWidth: v }), 1, 100)],
      text: [() => this.textBar()],
    };
  }
  get busy() { const a = document.activeElement; return a && this.root.contains(a) && ['INPUT', 'SELECT'].includes(a.tagName) && !(a.type === 'checkbox'); }

  refresh(force = false) {
    if (!force && this.busy) return;
    const t = toolById[state.tool], root = this.root, mode = state.modes[t.id] ?? 0;
    root.replaceChildren(el('span', { class: 'tname' }, t.modes ? t.modes[mode].name : t.name));
    if (t.modes && t.modes.length > 1)
      root.append(el('select', { 'aria-label': 'Mode', onChange: (e) => { const v = +e.target.value; e.target.blur(); this.app.setMode(t.id, v); } }, t.modes.map((m, i) => el('option', { value: i, selected: i === mode }, m.name))));
    for (const make of this.OPTIONS[t.id] || []) { const n = make(); if (n) root.append(n); }
    if (t.id === 'hand' || t.id === 'zoom') root.append(
      el('button', { class: 'btn', onClick: () => this.app.view.fit() }, 'Fit'), el('button', { class: 'btn', onClick: () => this.app.view.zoomTo(1) }, '100%'), el('button', { class: 'btn', onClick: () => this.app.view.zoomTo(2) }, '200%'));
    if (matchMedia('(pointer: coarse)').matches && this.app.doc) root.append(this.touchModifiers());
  }

  // Touch screens have no Shift, Alt or Ctrl: these latch the modifier for the next touches (Composa's modifiers are used everywhere).
  touchModifiers() {
    const v = this.app.view;
    return el('div', { class: 'opt group', style: 'margin-left:auto' }, ['shift', 'alt', 'ctrl'].map((k) => {
      const b = el('button', { class: 'btn small' + (v.sticky[k] ? ' on' : ''), title: `Hold ${k} for the next touches`, onClick: () => { v.sticky[k] = !v.sticky[k]; b.classList.toggle('on', v.sticky[k]); } }, k === 'shift' ? '⇧ Shift' : k === 'alt' ? 'Alt' : 'Ctrl');
      return b;
    }));
  }
  num(label, get, set, step = 1, min = -1e6, max = 1e6) {
    const input = el('input', { type: 'number', class: 'val wide', step, min, max, value: +(+get()).toFixed(2) });
    const apply = () => { const v = +input.value; if (input.value !== '' && !isNaN(v)) set(v); };
    input.addEventListener('input', apply);
    // Dragging a label scrubs its value; Alt makes the steps finer.
    const lab = el('label', { class: 'scrub' }, label);
    lab.addEventListener('pointerdown', (e) => {
      e.preventDefault(); lab.setPointerCapture(e.pointerId);
      const start = e.clientX, v0 = +input.value;
      const mv = (ev) => { const f = ev.altKey ? 0.1 : 1; input.value = +(v0 + (ev.clientX - start) * f * step).toFixed(2); apply(); };
      const up = () => { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', up); };
      lab.addEventListener('pointermove', mv); lab.addEventListener('pointerup', up);
    });
    return el('div', { class: 'opt' }, lab, input);
  }
  // X, Y, W, H and the angle of the single selected layer, as numbers.
  transformFields() {
    const d = this.app.doc, l = d?.active;
    if (!d || !l?.canvas || d.selectedIds.size > 1) return null;
    const set = (k) => (v) => setTransform(d, l, { ...l.transform, [k]: k === 'rotation' ? ((v + 180) % 360 + 360) % 360 - 180 : v });
    return el('div', { class: 'opt group' }, this.num('X', () => l.transform.x, set('x')), this.num('Y', () => l.transform.y, set('y')), this.num('W', () => l.transform.width, (v) => set('width')(Math.max(1, v))), this.num('H', () => l.transform.height, (v) => set('height')(Math.max(1, v))), this.num('∠', () => l.transform.rotation, set('rotation'), 1, -180, 180));
  }
  selectionButtons() {
    const d = () => this.app.doc, amt = (k) => el('input', { type: 'number', class: 'val', min: 1, max: 500, value: this.amounts[k], onInput: (e) => { this.amounts[k] = Math.max(1, +e.target.value || 1); } });
    const b = (label, fn, k) => el('div', { class: 'opt group' }, el('button', { class: 'btn small', onClick: () => d() && fn(d(), this.amounts[k]) }, label), amt(k));
    return el('div', { class: 'opt group' },
      b('Expand', S.expandSelection, 'expand'), b('Contract', S.contractSelection, 'contract'), b('Feather', S.featherSelection, 'feather'),
      el('button', { class: 'btn small', onClick: () => d() && S.selectAll(d()) }, 'All'), el('button', { class: 'btn small', onClick: () => d() && S.deselect(d()) }, 'Deselect'), el('button', { class: 'btn small', onClick: () => d() && S.invertSelection(d()) }, 'Inverse'));
  }
  cropBar() {
    const crop = this.app.tools.crop;
    const sel = el('select', { 'aria-label': 'Ratio', onChange: (e) => { update({ cropRatio: e.target.value }); crop.ratioChanged(); } }, CROP_RATIOS.map((r) => el('option', { value: r, selected: r === state.cropRatio }, r)));
    return el('div', { class: 'opt group' }, el('label', {}, 'Ratio'), sel,
      el('button', { class: 'btn small', disabled: !crop.has, onClick: () => crop.apply() }, 'Apply'), el('button', { class: 'btn small', disabled: !crop.has, onClick: () => crop.cancelCrop() }, 'Cancel'),
      el('button', { class: 'btn small', onClick: () => this.app.doc && (trim(this.app.doc) ? this.app.view.fit() : this.app.problem('Nothing to trim.')) }, 'Trim transparent edges'));
  }
  gradientButtons() {
    const g = this.app.tools.gradient;
    if (!g?.open) return null;
    return el('div', { class: 'opt group' }, el('button', { class: 'btn small accent', onClick: () => g.settle(true) }, 'Apply'), el('button', { class: 'btn small', onClick: () => g.settle(false) }, 'Cancel'));
  }
  textBar() {
    const d = this.app.doc, ts = textSession, st = ts.currentStyle, editing = ts.active, chg = (fn) => ts.changeStyle(d, fn);
    const fam = el('select', { 'aria-label': 'Font family', class: 'font', onChange: (e) => chg((s) => ({ ...s, fontFamily: e.target.value })) },
      [...new Set([st.fontFamily, ...FONT_FAMILIES()])].map((f) => el('option', { value: f, selected: f === st.fontFamily, style: `font-family:"${f}"` }, f)));
    const size = el('input', { type: 'number', class: 'val wide', min: 1, max: 2000, value: Math.round(st.size), 'aria-label': 'Font size' });
    size.addEventListener('input', () => { if (+size.value >= 1) chg((s) => ({ ...s, size: +size.value })); });
    const tog = (label, key, title) => el('button', { class: 'btn small' + (st[key] ? ' on' : ''), title, style: key === 'bold' ? 'font-weight:700' : 'font-style:italic', onClick: () => chg((s) => ({ ...s, [key]: !s[key] })) }, label);
    const al = (name, ic) => el('button', { class: 'iconbtn' + (st.alignment === name ? ' on' : ''), title: 'Align ' + name, onClick: () => chg((s) => ({ ...s, alignment: name })) }, icon(ic));
    const color = editing ? ts.editor.colorAtCaret : st.color;
    const sw = el('button', { class: 'cswatch', title: 'Text color', style: `background:${color}`, onClick: async () => { const orig = st; const v = await pickColor('Text color', color, (c) => ts.setColor(d, c)); if (!v) ts.changeStyle(d, (s) => ({ ...s, color: orig.color, colorRuns: orig.text === s.text ? orig.colorRuns : null })); } });
    const trk = this.num('Tracking', () => st.tracking, (v) => chg((s) => ({ ...s, tracking: v })), 1, -100, 1000), led = this.num('Leading', () => (st.leading > 0 ? st.leading : st.size * 1.2), (v) => chg((s) => ({ ...s, leading: Math.max(0, v) })), 1, 0, 5000);
    return el('div', { class: 'opt group' }, fam, size, el('span', { class: 'unit' }, 'px'), tog('B', 'bold', 'Bold'), tog('I', 'italic', 'Italic'), sw, al('left', 'align-left'), al('center', 'align-center'), al('right', 'align-right'), trk, led,
      editing ? el('button', { class: 'btn small accent', onClick: () => textSession.finish() }, 'Done') : null, editing ? el('button', { class: 'btn small', onClick: () => textSession.cancel() }, 'Cancel') : null);
  }
}
