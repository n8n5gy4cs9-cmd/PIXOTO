import { el } from './dom.js';
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from '../core/pixels.js';

const PALETTE = ['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff', '#ff0000', '#ff8000', '#ffff00', '#80ff00', '#00ff00', '#00ff80', '#00ffff', '#0080ff', '#0000ff', '#8000ff', '#ff00ff', '#ff0080',
  '#800000', '#804000', '#808000', '#408000', '#008000', '#008040', '#008080', '#004080', '#000080', '#400080', '#800080', '#800040', '#c68642', '#8d5524', '#f1c27d', '#ffdbac'];

// Colour picker popover: saturation/brightness square, hue strip, palette, RGB/HSB/hex fields and a before/after swatch.
// `onInput(hex)` fires live; the promise resolves with the chosen hex, or null on Cancel.
export function pickColor(title, initial, onInput = () => {}) {
  return new Promise((resolve) => {
    let [h, s, v] = rgbToHsv(...hexToRgb(initial)), hex = initial;
    const size = 200, sv = el('canvas', { width: size, height: size, class: 'cp-sv' }), hue = el('canvas', { width: 18, height: size, class: 'cp-hue' });
    const svCtx = sv.getContext('2d'), hueCtx = hue.getContext('2d');
    const before = el('div', { class: 'cp-old', style: `background:${initial}` }), after = el('div', { class: 'cp-new' });
    const hexIn = el('input', { type: 'text', value: hex, maxLength: 7, class: 'cp-hex' });
    const nums = {};
    const field = (k, label, max) => { const i = el('input', { type: 'number', min: 0, max, value: 0, class: 'cp-n' }); i.addEventListener('input', () => fromNums(k, +i.value)); nums[k] = i; return el('label', { class: 'cp-f' }, label, i); };
    const fields = el('div', { class: 'cp-fields' }, field('r', 'R', 255), field('g', 'G', 255), field('b', 'B', 255), field('h', 'H', 360), field('s', 'S', 100), field('v', 'B', 100));

    const drawHue = () => { const g = hueCtx.createLinearGradient(0, 0, 0, size); for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`); hueCtx.fillStyle = g; hueCtx.fillRect(0, 0, 18, size); };
    const drawSV = () => {
      svCtx.fillStyle = `hsl(${h},100%,50%)`; svCtx.fillRect(0, 0, size, size);
      let g = svCtx.createLinearGradient(0, 0, size, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); svCtx.fillStyle = g; svCtx.fillRect(0, 0, size, size);
      g = svCtx.createLinearGradient(0, 0, 0, size); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000'); svCtx.fillStyle = g; svCtx.fillRect(0, 0, size, size);
      const x = s * size, y = (1 - v) * size;
      svCtx.lineWidth = 2; svCtx.strokeStyle = '#fff'; svCtx.beginPath(); svCtx.arc(x, y, 6, 0, 7); svCtx.stroke(); svCtx.lineWidth = 1; svCtx.strokeStyle = '#000'; svCtx.beginPath(); svCtx.arc(x, y, 7.5, 0, 7); svCtx.stroke();
      hueCtx.clearRect(0, 0, 18, size); drawHue(); const hy = h / 360 * size; hueCtx.fillStyle = '#fff'; hueCtx.fillRect(0, hy - 2, 18, 4); hueCtx.strokeStyle = '#000'; hueCtx.strokeRect(0, hy - 2, 18, 4);
    };
    const refresh = (skipHex = false) => {
      const [r, g, b] = hsvToRgb(h, s, v).map(Math.round);
      hex = rgbToHex(r, g, b); after.style.background = hex;
      if (!skipHex) hexIn.value = hex;
      Object.assign(nums.r, { value: r }); nums.g.value = g; nums.b.value = b; nums.h.value = Math.round(h); nums.s.value = Math.round(s * 100); nums.v.value = Math.round(v * 100);
      drawSV(); onInput(hex);
    };
    const fromNums = (k, val) => {
      if (isNaN(val)) return;
      if (k === 'r' || k === 'g' || k === 'b') { const rgb = hexToRgb(hex); rgb['rgb'.indexOf(k)] = Math.max(0, Math.min(255, val)); [h, s, v] = rgbToHsv(...rgb); }
      else if (k === 'h') h = Math.max(0, Math.min(360, val)); else if (k === 's') s = Math.max(0, Math.min(1, val / 100)); else v = Math.max(0, Math.min(1, val / 100));
      const [r, g, b] = hsvToRgb(h, s, v).map(Math.round); hex = rgbToHex(r, g, b); after.style.background = hex; hexIn.value = hex; drawSV(); onInput(hex);
    };
    const drag = (canvas, fn) => {
      canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); fn(e); const mv = (ev) => fn(ev), up = () => { canvas.removeEventListener('pointermove', mv); canvas.removeEventListener('pointerup', up); }; canvas.addEventListener('pointermove', mv); canvas.addEventListener('pointerup', up); });
    };
    drag(sv, (e) => { const r = sv.getBoundingClientRect(); s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); v = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)); refresh(); });
    drag(hue, (e) => { const r = hue.getBoundingClientRect(); h = Math.max(0, Math.min(359.99, (e.clientY - r.top) / r.height * 360)); refresh(); });
    hexIn.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hexIn.value)) { [h, s, v] = rgbToHsv(...hexToRgb(hexIn.value)); refresh(true); } });
    const palette = el('div', { class: 'cp-palette' }, PALETTE.map((c) => el('button', { class: 'cp-chip', style: `background:${c}`, title: c, onClick: () => { [h, s, v] = rgbToHsv(...hexToRgb(c)); refresh(); } })));

    const done = (val) => { scrim.remove(); document.removeEventListener('keydown', onKey, true); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onInput(initial); done(null); } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.stopPropagation(); done(hex); } };
    const scrim = el('div', { class: 'scrim', onPointerdown: (e) => { if (e.target === scrim) { onInput(initial); done(null); } } },
      el('div', { class: 'dlg cp', role: 'dialog', 'aria-label': title }, el('h2', {}, title),
        el('div', { class: 'body cp-body' }, el('div', { class: 'cp-main' }, sv, hue, el('div', { class: 'cp-side' }, el('div', { class: 'cp-cmp' }, after, before), hexIn)), fields, palette),
        el('div', { class: 'foot' }, el('button', { class: 'btn', onClick: () => { onInput(initial); done(null); } }, 'Cancel'), el('button', { class: 'btn accent', onClick: () => done(hex) }, 'OK'))));
    document.addEventListener('keydown', onKey, true);
    document.body.append(scrim);
    refresh();
  });
}
