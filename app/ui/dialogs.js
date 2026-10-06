import { el } from './dom.js';

export function modal(title, body, buttons) {
  return new Promise((resolve) => {
    const close = (v) => { scrim.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const foot = el('div', { class: 'foot' }, buttons.map((b) => el('button', { class: 'btn' + (b.accent ? ' accent' : ''), onClick: () => close(b.value) }, b.label)));
    const scrim = el('div', { class: 'scrim', onPointerdown: (e) => { if (e.target === scrim) close(undefined); } },
      el('div', { class: 'dlg', role: 'dialog', 'aria-label': title }, el('h2', {}, title), el('div', { class: 'body' }, body), foot));
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { const a = buttons.find((b) => b.accent); if (a) { e.stopPropagation(); close(a.value); } }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(scrim);
    (scrim.querySelector('input,select') || scrim.querySelector('.accent'))?.focus();
  });
}
export const alertBox = (title, text) => modal(title, el('div', {}, text), [{ label: 'OK', value: true, accent: true }]);
export const confirmBox = async (title, text, ok = 'OK') => (await modal(title, el('div', {}, text), [{ label: 'Cancel', value: false }, { label: ok, value: true, accent: true }])) === true;

export const PRESETS = [
  { name: 'HD 1920 × 1080', w: 1920, h: 1080 }, { name: '4K 3840 × 2160', w: 3840, h: 2160 }, { name: '2048 × 2048', w: 2048, h: 2048 },
  { name: 'Instagram 1080 × 1350', w: 1080, h: 1350 }, { name: 'A4 @ 300 ppi', w: 2480, h: 3508, ppi: 300 }, { name: 'Photo 6000 × 4000', w: 6000, h: 4000 },
];

export async function newCanvasDialog(limits, colors) {
  let w = 1920, h = 1080, ppi = 72, bg = 'transparent';
  const wi = el('input', { type: 'number', min: 1, max: limits.max, value: w }), hi = el('input', { type: 'number', min: 1, max: limits.max, value: h });
  const presetBtns = PRESETS.map((p) => el('button', { class: 'btn', onClick: () => { wi.value = p.w; hi.value = p.h; ppi = p.ppi || 72; presetBtns.forEach((b) => b.classList.remove('on')); presetBtns[PRESETS.indexOf(p)].classList.add('on'); } }, p.name));
  const sel = el('select', { onChange: (e) => { bg = e.target.value; } },
    el('option', { value: 'transparent' }, 'Transparent'), el('option', { value: 'white' }, 'White'), el('option', { value: 'bg' }, 'Background color'));
  const body = [el('div', { class: 'presets' }, presetBtns),
    el('div', { class: 'row' }, el('label', {}, 'Width'), wi, 'px'), el('div', { class: 'row' }, el('label', {}, 'Height'), hi, 'px'),
    el('div', { class: 'row' }, el('label', {}, 'Background'), sel),
    el('div', { class: 'row', style: 'color:var(--secondary)' }, `Maximum ${limits.max} px per side in this browser`)];
  const r = await modal('New Canvas', body, [{ label: 'Cancel', value: false }, { label: 'Create', value: true, accent: true }]);
  if (!r) return null;
  const clamp = (v) => Math.max(1, Math.min(limits.max, Math.round(+v) || 1));
  return { width: clamp(wi.value), height: clamp(hi.value), resolution: ppi, background: bg === 'bg' ? colors.bg : bg === 'white' ? '#ffffff' : null };
}
