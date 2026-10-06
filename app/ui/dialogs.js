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

// ---- more dialogs (Composa Dialogs) ----------------------------------------------------------------------
export const confirmSave = (name) => modal('Save changes before closing?', el('div', {}, `“${name}” has changes that are not saved.`), [{ label: "Don't Save", value: 'discard' }, { label: 'Cancel', value: undefined }, { label: 'Save', value: 'save', accent: true }]);

// Canvas Size: new size or relative amount, and a 3x3 anchor saying which edges move.
export async function canvasSizeDialog(doc, limits) {
  let anchor = 4, relative = false;
  const wi = el('input', { type: 'number', min: 1, max: limits.max, value: doc.width }), hi = el('input', { type: 'number', min: 1, max: limits.max, value: doc.height });
  const rel = el('input', { type: 'checkbox' });
  rel.addEventListener('change', () => { relative = rel.checked; wi.value = relative ? 0 : doc.width; hi.value = relative ? 0 : doc.height; });
  const cells = Array.from({ length: 9 }, (_, i) => el('button', { class: 'anchor' + (i === 4 ? ' on' : ''), type: 'button', onClick: () => { anchor = i; cells.forEach((c, k) => c.classList.toggle('on', k === i)); } }));
  const body = [el('div', { class: 'row' }, el('label', {}, 'Current'), `${doc.width} × ${doc.height} px`), el('div', { class: 'row' }, el('label', {}, 'Width'), wi, 'px'), el('div', { class: 'row' }, el('label', {}, 'Height'), hi, 'px'),
    el('label', { class: 'chk' }, rel, 'Relative'), el('div', { class: 'row' }, el('label', {}, 'Anchor'), el('div', { class: 'anchors' }, cells))];
  const r = await modal('Canvas Size', body, [{ label: 'Cancel', value: false }, { label: 'OK', value: true, accent: true }]);
  if (!r) return null;
  const w = Math.max(1, Math.min(limits.max, Math.round(relative ? doc.width + +wi.value : +wi.value) || 1)), h = Math.max(1, Math.min(limits.max, Math.round(relative ? doc.height + +hi.value : +hi.value) || 1));
  return { width: w, height: h, anchor };
}
export async function imageSizeDialog(doc, limits) {
  const ratio = doc.width / doc.height;
  const wi = el('input', { type: 'number', min: 1, max: limits.max, value: doc.width }), hi = el('input', { type: 'number', min: 1, max: limits.max, value: doc.height }), ri = el('input', { type: 'number', min: 1, max: 9600, value: doc.resolution });
  const lock = el('input', { type: 'checkbox', checked: true });
  wi.addEventListener('input', () => { if (lock.checked) hi.value = Math.max(1, Math.round(wi.value / ratio)); });
  hi.addEventListener('input', () => { if (lock.checked) wi.value = Math.max(1, Math.round(hi.value * ratio)); });
  const body = [el('div', { class: 'row' }, el('label', {}, 'Width'), wi, 'px'), el('div', { class: 'row' }, el('label', {}, 'Height'), hi, 'px'), el('label', { class: 'chk' }, lock, 'Constrain proportions'), el('div', { class: 'row' }, el('label', {}, 'Resolution'), ri, 'ppi')];
  const r = await modal('Image Size', body, [{ label: 'Cancel', value: false }, { label: 'OK', value: true, accent: true }]);
  if (!r) return null;
  const c = (v) => Math.max(1, Math.min(limits.max, Math.round(+v) || 1));
  return { width: c(wi.value), height: c(hi.value), resolution: Math.max(1, Math.min(9600, +ri.value || 72)) };
}
export async function trimDialog() {
  const based = el('select', {}, [['transparent', 'Transparent Pixels'], ['topLeft', 'Top Left Pixel Color'], ['bottomRight', 'Bottom Right Pixel Color']].map(([v, l]) => el('option', { value: v }, l)));
  const sides = ['top', 'bottom', 'left', 'right'].map((s) => [s, el('input', { type: 'checkbox', checked: true })]);
  const tol = el('input', { type: 'number', min: 0, max: 255, value: 0 });
  const body = [el('div', { class: 'row' }, el('label', {}, 'Based on'), based), el('div', { class: 'row' }, el('label', {}, 'Trim away'), el('div', { class: 'sides' }, sides.map(([s, c]) => el('label', { class: 'chk' }, c, s[0].toUpperCase() + s.slice(1))))), el('div', { class: 'row' }, el('label', {}, 'Tolerance'), tol)];
  const r = await modal('Trim', body, [{ label: 'Cancel', value: false }, { label: 'OK', value: true, accent: true }]);
  if (!r) return null;
  return { basedOn: based.value, ...Object.fromEntries(sides.map(([s, c]) => [s, c.checked])), tolerance: +tol.value || 0 };
}

// Export dialog with a live preview and the resulting file size (JPEG / WebP quality, PNG info).
export async function exportDialog(doc, format, { flat, encode, quality }) {
  const lossy = format !== 'png';
  const prev = el('canvas', { class: 'expprev' }), info = el('div', { class: 'row', style: 'color:var(--secondary)' }, '…');
  const q = el('input', { type: 'range', min: 1, max: 100, value: Math.round(quality * 100) }), qv = el('span', { class: 'val' }, Math.round(quality * 100));
  const src = flat(), k = Math.min(1, 420 / src.width, 260 / src.height);
  prev.width = Math.max(1, Math.round(src.width * k)); prev.height = Math.max(1, Math.round(src.height * k));
  let timer = 0, seq = 0;
  const refresh = () => {
    qv.textContent = q.value; clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const blob = await encode(src, format, +q.value / 100);
        if (mine !== seq) return;
        info.textContent = `${src.width} × ${src.height} px · ${(blob.size / 1024).toFixed(blob.size > 1e6 ? 0 : 1)} KB`;
        const bmp = await createImageBitmap(blob); if (mine !== seq) return;
        const c = prev.getContext('2d'); c.clearRect(0, 0, prev.width, prev.height); c.drawImage(bmp, 0, 0, prev.width, prev.height); bmp.close?.();
      } catch (e) { info.textContent = e.message; }
    }, 120);
  };
  q.addEventListener('input', refresh);
  const body = [el('div', { class: 'prevwrap' }, prev), lossy ? el('div', { class: 'row' }, el('label', {}, 'Quality'), q, qv) : null, info];
  refresh();
  const r = await modal('Export ' + (format === 'jpeg' ? 'JPEG' : format.toUpperCase()), body, [{ label: 'Cancel', value: false }, { label: 'Save…', value: true, accent: true }]);
  seq++;
  return r ? +q.value / 100 : null;
}
export function psdReportDialog(name, conversions) {
  const list = el('div', { class: 'report' }, conversions.map((c) => el('div', {}, el('b', {}, c.name), ': ', c.message)));
  return modal('Open ' + name, [el('div', {}, conversions.length ? 'Some things had to change on the way in:' : 'Nothing had to be converted.'), conversions.length ? list : null], [{ label: 'Cancel', value: false }, { label: 'Import', value: true, accent: true }]);
}
export function recoveryDialog(items) {
  const chosen = new Set(items.map((i) => i.id));
  const rows = items.map((i) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: true, onChange: (e) => (e.target.checked ? chosen.add(i.id) : chosen.delete(i.id)) }), `${i.name} — ${new Date(i.time).toLocaleString()}`));
  return modal('Recover Unsaved Work', [el('div', {}, 'Pixoto found documents that were open when it last closed:'), ...rows], [{ label: 'Discard', value: 'discard' }, { label: 'Recover', value: 'recover', accent: true }]).then((v) => ({ action: v, ids: [...chosen] }));
}
