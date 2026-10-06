import { el } from './dom.js';
import { toolById } from '../core/tools.js';
import { state, update } from '../core/state.js';

const slider = (label, get, set, min, max, step = 1, unit = '') => () => {
  const val = el('span', { class: 'val' }, get() + unit);
  const input = el('input', { type: 'range', min, max, step, value: get() });
  input.addEventListener('input', () => { set(+input.value); val.textContent = input.value + unit; });
  input.addEventListener('dblclick', () => { const v = prompt(label, get()); if (v != null && !isNaN(+v)) { set(Math.min(max, Math.max(min, +v))); input.value = get(); val.textContent = get() + unit; } });
  return el('div', { class: 'opt' }, el('label', {}, label), input, val);
};
const check = (label, get, set) => () => {
  const c = el('input', { type: 'checkbox', checked: get() });
  c.addEventListener('change', () => set(c.checked));
  return el('label', { class: 'opt', style: 'cursor:pointer;color:var(--fg)' }, c, label);
};
const brush = (k, scale = 1) => ({ get: () => Math.round(state.brush[k] * scale), set: (v) => update({ brush: { ...state.brush, [k]: v / scale } }) });
const B = (label, k, min, max, scale = 1, unit = '') => slider(label, brush(k, scale).get, brush(k, scale).set, min, max, 1, unit);
const SL = (label, key, min, max, scale = 1) => slider(label, () => Math.round(state[key] * scale), (v) => update({ [key]: v / scale }), min, max);
const CK = (label, key) => check(label, () => state[key], (v) => update({ [key]: v }));

// Per-tool settings (Composa MainWindow.Options). Controls bind to shared state, so they survive tab switches.
const OPTIONS = {
  move: [CK('Auto Select', 'autoSelect'), CK('Transform controls', 'transformControls')],
  marquee: [SL('Feather', 'feather', 0, 100)],
  lasso: [SL('Feather', 'feather', 0, 100)],
  wand: [SL('Tolerance', 'wandTolerance', 0, 255), CK('Contiguous', 'wandContiguous'), CK('Sample all layers', 'wandAllLayers')],
  brush: [B('Size', 'size', 1, 500), B('Hardness', 'hardness', 0, 100, 100, '%'), B('Opacity', 'opacity', 1, 100, 100, '%'), B('Smoothing', 'smoothing', 0, 100)],
  heal: [B('Size', 'size', 1, 500), B('Hardness', 'hardness', 0, 100, 100, '%')],
  clone: [B('Size', 'size', 1, 500), B('Hardness', 'hardness', 0, 100, 100, '%'), B('Opacity', 'opacity', 1, 100, 100, '%'), CK('Aligned', 'cloneAligned'), CK('Sample all layers', 'cloneAllLayers')],
  smear: [B('Size', 'size', 1, 500), B('Hardness', 'hardness', 0, 100, 100, '%'), B('Strength', 'opacity', 1, 100, 100, '%')],
  gradient: [CK('Foreground to transparent', 'gradientToTransparent'), CK('Radial', 'gradientRadial'), SL('Opacity', 'gradientOpacity', 1, 100, 100)],
  shape: [slider('Corner radius', () => state.shapeCornerRadius, (v) => update({ shapeCornerRadius: v }), 0, 400), slider('Line width', () => state.shapeLineWidth, (v) => update({ shapeLineWidth: v }), 1, 100)],
};

export class OptionsBar {
  constructor(root, app) { this.root = root; this.app = app; }
  refresh() {
    const t = toolById[state.tool], root = this.root, mode = state.modes[t.id] ?? 0;
    root.replaceChildren(el('span', { class: 'tname' }, t.modes ? t.modes[mode].name : t.name));
    if (t.modes && t.modes.length > 1)
      root.append(el('select', { 'aria-label': 'Mode', onChange: (e) => { const v = +e.target.value; e.target.blur(); this.app.setMode(t.id, v); } }, t.modes.map((m, i) => el('option', { value: i, selected: i === mode }, m.name))));
    for (const make of OPTIONS[t.id] || []) root.append(make());
    if (t.id === 'hand' || t.id === 'zoom') root.append(
      el('button', { class: 'btn', onClick: () => this.app.view.fit() }, 'Fit'),
      el('button', { class: 'btn', onClick: () => this.app.view.zoomTo(1) }, '100%'),
      el('button', { class: 'btn', onClick: () => this.app.view.zoomTo(2) }, '200%'));
    if (!this.app.implemented.has(t.id)) root.append(el('span', { style: 'color:var(--warn)' }, `Not available yet (phase ${t.phase})`));
  }
}
