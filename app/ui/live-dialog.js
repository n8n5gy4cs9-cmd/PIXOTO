import { el } from './dom.js';
import { pickColor } from './color-picker.js';

// Builds one control row from a field spec { type, label, min, max, step, unit, options, get(), set(v), show?() }.
// `onInput` is called after every change so the caller can refresh its live preview.
export function fieldRow(f, onInput, rebuild) {
  const row = el('div', { class: 'fld' });
  if (f.type === 'range' || f.type === 'angle') {
    const input = el('input', { type: 'range', min: f.min, max: f.max, step: f.step ?? 1, value: f.get() });
    const num = el('input', { type: 'number', min: f.min, max: f.max, step: f.step ?? 1, value: f.get(), class: 'num' });
    const sync = (v) => { f.set(v); input.value = v; num.value = +(+v).toFixed(3); onInput(); };
    input.addEventListener('input', () => sync(+input.value));
    num.addEventListener('input', () => { if (num.value !== '' && !isNaN(+num.value)) sync(Math.min(f.max, Math.max(f.min, +num.value))); });
    input.addEventListener('dblclick', () => { const d = f.reset ?? f.def; if (d != null) sync(d); });
    row.append(el('label', {}, f.label), input, num, f.unit ? el('span', { class: 'unit' }, f.unit.trim()) : null);
    row.reset = () => { const d = f.reset ?? f.def; if (d != null) { f.set(d); input.value = d; num.value = d; } };
    row.refresh = () => { input.value = f.get(); num.value = +(+f.get()).toFixed(3); };
  } else if (f.type === 'check') {
    const c = el('input', { type: 'checkbox', checked: !!f.get() });
    c.addEventListener('change', () => { f.set(c.checked); onInput(); rebuild?.(); });
    row.append(el('label', { class: 'chk' }, c, f.label));
    row.refresh = () => { c.checked = !!f.get(); };
  } else if (f.type === 'select') {
    const s = el('select', {}, f.options.map(([v, l]) => el('option', { value: v, selected: String(v) === String(f.get()) }, l)));
    s.addEventListener('change', () => { f.set(isNaN(+s.value) || f.string ? s.value : +s.value); onInput(); if (f.rebuild) rebuild?.(); });
    row.append(el('label', {}, f.label), s);
    row.refresh = () => { s.value = f.get(); };
  } else if (f.type === 'color') {
    const sw = el('button', { class: 'cswatch', style: `background:${f.get()}`, title: 'Choose color' });
    sw.addEventListener('click', async () => { const v = await pickColor(f.label, f.get(), (c) => { sw.style.background = c; f.set(c); onInput(); }); if (v) { f.set(v); sw.style.background = v; onInput(); } });
    row.append(el('label', {}, f.label), sw, ...(f.buttons || []).map(([t, fn]) => el('button', { class: 'btn small', onClick: () => { const v = fn(); f.set(v); sw.style.background = v; onInput(); } }, t)));
    row.refresh = () => { sw.style.background = f.get(); };
  } else if (f.type === 'button') {
    row.append(el('button', { class: 'btn', onClick: () => { f.run(); onInput(); } }, f.label));
  } else if (f.type === 'node') row.append(f.node);
  return row;
}

// A floating tool dialog that previews on the canvas (no scrim, so the picture stays visible). `fields()` returns the
// current field specs, called again whenever `rebuild` runs. Resolves true on OK, false on Cancel.
export function liveDialog({ title, fields, onInput, onPreviewToggle, extra, width = 340, okLabel = 'OK', resetFn }) {
  return new Promise((resolve) => {
    const body = el('div', { class: 'body fields' });
    const prev = el('input', { type: 'checkbox', checked: true });
    let rows = [];
    const rebuild = () => {
      body.replaceChildren();
      rows = fields().filter((f) => !f.show || f.show()).map((f) => { const r = fieldRow(f, onInput, rebuild); body.append(r); return r; });
      if (extra) body.append(extra());
    };
    rebuild();
    const done = (v) => { dlg.remove(); blocker.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } else if (e.key === 'Enter' && !['BUTTON', 'SELECT'].includes(e.target.tagName)) { e.stopPropagation(); done(true); } };
    prev.addEventListener('change', () => onPreviewToggle?.(prev.checked));
    const dlg = el('div', { class: 'dlg floatdlg', role: 'dialog', 'aria-label': title, style: `width:${width}px` },
      el('h2', {}, title), body,
      el('div', { class: 'foot' }, el('label', { class: 'chk pv' }, prev, 'Preview'), el('span', { class: 'grow' }),
        resetFn ? el('button', { class: 'btn', onClick: () => { resetFn(); rebuild(); onInput(); } }, 'Reset') : null,
        el('button', { class: 'btn', onClick: () => done(false) }, 'Cancel'), el('button', { class: 'btn accent', onClick: () => done(true) }, okLabel)));
    const blocker = el('div', { class: 'blocker' });
    document.addEventListener('keydown', onKey, true);
    document.body.append(blocker, dlg);
    dlg.querySelector('input,select')?.focus();
  });
}
