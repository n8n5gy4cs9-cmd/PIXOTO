// Dialogs for adjustments (Image menu commands and adjustment layers): field specs per adjustment type, plus the Levels
// histogram and the Curves editor. `holder.adj` is replaced (never mutated) on every change, then `onInput` previews it.
import { el } from './dom.js';
import { liveDialog } from './live-dialog.js';
import { createAdjustment, adjustmentName, curveValue, autoLevels, histogramOf, isIdentity } from '../core/filters/adjust.js';
import { state } from '../core/state.js';
import { LUT_PRESETS, parseCube } from '../core/filters/lut.js';

const rep = (arr, i, v) => arr.map((x, k) => (k === i ? v : x));
const R = (label, get, set, min, max, step = 1, def = 0, unit = '') => ({ type: 'range', label, get, set, min, max, step, def, unit });
const HUE_RANGES = ['Master', 'Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas'];

function histogramCanvas(hist, channel, w = 256, h = 80) {
  const c = el('canvas', { width: w, height: h, class: 'histo' }), ctx = c.getContext('2d');
  ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, w, h);
  const bins = hist[channel === 0 ? 3 : channel - 1];
  let max = 1; for (let i = 1; i < 255; i++) max = Math.max(max, bins[i]);
  ctx.fillStyle = ['#bbb', '#e55', '#5c5', '#58f'][channel];
  for (let i = 0; i < 256; i++) ctx.fillRect(i * w / 256, h - Math.min(1, bins[i] / max) * h, Math.max(1, w / 256), Math.min(1, bins[i] / max) * h);
  return c;
}

export function curvesEditor(holder, onInput, hist, channelRef) {
  const size = 256, c = el('canvas', { width: size, height: size, class: 'curve' }), ctx = c.getContext('2d');
  let drag = -1;
  const pts = () => holder.adj.channels[channelRef.value];
  const setPts = (p) => { const sorted = [...p].sort((a, b) => a.x - b.x).filter((q, i, a) => !i || q.x - a[i - 1].x >= 1); holder.adj = { ...holder.adj, channels: rep(holder.adj.channels, channelRef.value, sorted.length >= 2 ? sorted : [{ x: 0, y: 0 }, { x: 255, y: 255 }]) }; };
  const draw = () => {
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, size, size);
    if (hist) { const bins = hist[channelRef.value === 0 ? 3 : channelRef.value - 1]; let max = 1; for (let i = 1; i < 255; i++) max = Math.max(max, bins[i]); ctx.fillStyle = '#ffffff22'; for (let i = 0; i < 256; i++) ctx.fillRect(i, size - Math.min(1, bins[i] / max) * size, 1, size); }
    ctx.strokeStyle = '#444'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 1; i < 4; i++) { ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, size); ctx.moveTo(0, i * 64); ctx.lineTo(size, i * 64); } ctx.stroke();
    ctx.strokeStyle = ['#fff', '#f55', '#5f5', '#59f'][channelRef.value]; ctx.lineWidth = 1.5; ctx.beginPath();
    const p = pts(); for (let x = 0; x < 256; x++) { const y = size - curveValue(p, x); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; for (const q of p) { ctx.beginPath(); ctx.arc(q.x, size - q.y, 4, 0, 7); ctx.fill(); ctx.stroke(); }
  };
  const at = (e) => { const r = c.getBoundingClientRect(); return { x: Math.max(0, Math.min(255, (e.clientX - r.left) / r.width * 256)), y: Math.max(0, Math.min(255, 255 - (e.clientY - r.top) / r.height * 256)), outside: e.clientX < r.left - 6 || e.clientX > r.right + 6 || e.clientY < r.top - 6 || e.clientY > r.bottom + 6 }; };
  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    const p = at(e), list = pts(); let hit = list.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 9);
    if (hit < 0) { if (list.length >= 16) return; setPts([...list, { x: p.x, y: curveValue(list, p.x) }]); hit = pts().findIndex((q) => Math.abs(q.x - p.x) < 1.5); }
    drag = hit; draw(); onInput();
  });
  c.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    const p = at(e), list = pts();
    if (p.outside && drag > 0 && drag < list.length - 1) { setPts(list.filter((_, i) => i !== drag)); drag = -1; draw(); onInput(); return; }
    const lo = drag > 0 ? list[drag - 1].x + 1 : 0, hi = drag < list.length - 1 ? list[drag + 1].x - 1 : 255;
    setPts(rep(list, drag, { x: drag === 0 || drag === list.length - 1 ? list[drag].x : Math.max(lo, Math.min(hi, p.x)), y: p.y })); draw(); onInput();
  });
  c.addEventListener('pointerup', () => { drag = -1; });
  draw(); c.redraw = draw;
  return c;
}

export function adjustmentFields(holder, onInput, ctx = {}) {
  const A = () => holder.adj, set = (patch) => { holder.adj = { ...holder.adj, ...patch }; };
  switch (A().type) {
    case 'brightnessContrast': return [R('Brightness', () => A().brightness, (v) => set({ brightness: v }), -100, 100), R('Contrast', () => A().contrast, (v) => set({ contrast: v }), -100, 100)];
    case 'hueSaturation': {
      const sh = () => A().shifts[ctx.range ?? 0], setSh = (k, v) => set({ shifts: rep(A().shifts, ctx.range ?? 0, { ...sh(), [k]: v }) });
      return [{ type: 'select', label: 'Edit', options: HUE_RANGES.map((n, i) => [i, n]), get: () => ctx.range ?? 0, set: (v) => { ctx.range = v; }, rebuild: true, show: () => !A().colorize },
        R(A().colorize ? 'Hue' : 'Hue', () => sh().hue, (v) => setSh('hue', v), A().colorize ? 0 : -180, A().colorize ? 360 : 180), R('Saturation', () => sh().saturation, (v) => setSh('saturation', v), -100, 100), R('Lightness', () => sh().lightness, (v) => setSh('lightness', v), -100, 100),
        { type: 'check', label: 'Colorize', get: () => A().colorize, set: (v) => { ctx.range = 0; set({ colorize: v }); } }];
    }
    case 'exposure': return [R('Exposure', () => A().exposure, (v) => set({ exposure: v }), -5, 5, 0.01), R('Offset', () => A().offset, (v) => set({ offset: v }), -0.5, 0.5, 0.001), R('Gamma', () => A().gamma, (v) => set({ gamma: v }), 0.1, 9.99, 0.01, 1)];
    case 'blackAndWhite': return [...['Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas'].map((n, i) => R(n, () => A().weights[i], (v) => set({ weights: rep(A().weights, i, v) }), -200, 300, 1, [40, 60, 40, 60, 20, 80][i])),
      { type: 'check', label: 'Tint', get: () => A().tint, set: (v) => set({ tint: v }), rebuild: true }, R('Hue', () => A().tintHue, (v) => set({ tintHue: v }), 0, 360), R('Saturation', () => A().tintSaturation, (v) => set({ tintSaturation: v }), 0, 100)].map((f) => (f.label === 'Hue' || f.label === 'Saturation') && f.type === 'range' ? { ...f, show: () => A().tint } : f);
    case 'colorBalance': {
      const tones = ['shadows', 'midtones', 'highlights'], tone = () => tones[ctx.tone ?? 1], vals = () => A()[tone()], setV = (i, v) => set({ [tone()]: rep(vals(), i, v) });
      return [{ type: 'select', label: 'Tone', options: [[0, 'Shadows'], [1, 'Midtones'], [2, 'Highlights']], get: () => ctx.tone ?? 1, set: (v) => { ctx.tone = v; }, rebuild: true },
        R('Cyan / Red', () => vals()[0], (v) => setV(0, v), -100, 100), R('Magenta / Green', () => vals()[1], (v) => setV(1, v), -100, 100), R('Yellow / Blue', () => vals()[2], (v) => setV(2, v), -100, 100),
        { type: 'check', label: 'Preserve luminosity', get: () => A().preserveLuminosity, set: (v) => set({ preserveLuminosity: v }) }];
    }
    case 'lut': return [{ type: 'select', label: 'Look', string: true, options: [...Object.entries(LUT_PRESETS).map(([k, v]) => [k, v.name]), ['custom', A().cubeName ? 'Custom: ' + A().cubeName : 'Custom (.cube)']], get: () => A().preset, set: (v) => set({ preset: v }) },
      R('Amount', () => A().amount, (v) => set({ amount: v }), 0, 100, 1, 100, '%'),
      { type: 'button', label: 'Load .cube file…', run: () => {
        const input = el('input', { type: 'file', accept: '.cube' });
        input.addEventListener('change', async () => {
          const file = input.files[0]; if (!file) return;
          try { const text = await file.text(); parseCube(text); set({ preset: 'custom', cube: text, cubeName: file.name }); onInput(); } catch (e) { alert(e.message); }
        });
        input.click();
      } }];
    case 'gradientMap': return [{ type: 'color', label: 'Shadows', get: () => A().shadows, set: (v) => set({ shadows: v }), buttons: [['FG', () => state.fg], ['BG', () => state.bg]] },
      { type: 'color', label: 'Highlights', get: () => A().highlights, set: (v) => set({ highlights: v }), buttons: [['FG', () => state.fg], ['BG', () => state.bg]] }, { type: 'check', label: 'Reverse', get: () => A().reversed, set: (v) => set({ reversed: v }) }];
    case 'grain': return [R('Amount', () => A().amount, (v) => set({ amount: v }), 0, 100, 1, 25), R('Size', () => A().size, (v) => set({ size: v }), 0.5, 20, 0.1, 1.5), R('Roughness', () => A().roughness, (v) => set({ roughness: v }), 0, 100, 1, 50), { type: 'button', label: 'New pattern', run: () => set({ seed: (Math.random() * 4294967296) >>> 0 }) }];
    case 'vibrance': return [R('Vibrance', () => A().amount, (v) => set({ amount: v }), -100, 100), R('Saturation', () => A().saturation, (v) => set({ saturation: v }), -100, 100)];
    case 'threshold': return [R('Level', () => A().level, (v) => set({ level: v }), 0, 255, 1, 128)];
    case 'posterize': return [R('Levels', () => A().levels, (v) => set({ levels: v }), 2, 32, 1, 4)];
    case 'desaturate': case 'sepia': return [R('Amount', () => A().amount, (v) => set({ amount: v }), 0, 100, 1, 100)];
    case 'solarize': return [R('Threshold', () => A().threshold, (v) => set({ threshold: v }), 0, 255, 1, 128)];
    case 'gaussianBlur': return [R('Radius', () => A().radius, (v) => set({ radius: v }), 0, 250, 0.1, 10, ' px')];
    case 'motionBlur': return [R('Angle', () => A().angle, (v) => set({ angle: v }), -90, 90, 1, 0, '°'), R('Distance', () => A().distance, (v) => set({ distance: v }), 1, 2000, 1, 10, ' px')];
    case 'addNoise': return [R('Amount', () => A().amount, (v) => set({ amount: v }), 0.1, 400, 0.1, 10, '%'), { type: 'check', label: 'Gaussian', get: () => A().gaussian, set: (v) => set({ gaussian: v }) }, { type: 'check', label: 'Monochromatic', get: () => A().monochromatic, set: (v) => set({ monochromatic: v }) }];
    case 'levels': {
      const ch = () => ctx.channel ?? 0, rg = () => A().ranges[ch()], setR = (k, v) => set({ ranges: rep(A().ranges, ch(), { ...rg(), [k]: v }) });
      return [{ type: 'select', label: 'Channel', options: [[0, 'RGB'], [1, 'Red'], [2, 'Green'], [3, 'Blue']], get: () => ch(), set: (v) => { ctx.channel = v; }, rebuild: true },
        { type: 'node', node: ctx.hist ? histogramCanvas(ctx.hist, ch()) : el('div') },
        R('Input black', () => rg().inputBlack, (v) => setR('inputBlack', Math.min(v, rg().inputWhite - 1)), 0, 254, 1, 0), R('Gamma', () => rg().gamma, (v) => setR('gamma', v), 0.1, 9.99, 0.01, 1), R('Input white', () => rg().inputWhite, (v) => setR('inputWhite', Math.max(v, rg().inputBlack + 1)), 1, 255, 1, 255),
        R('Output black', () => rg().outputBlack, (v) => setR('outputBlack', v), 0, 254, 1, 0), R('Output white', () => rg().outputWhite, (v) => setR('outputWhite', v), 1, 255, 1, 255),
        { type: 'button', label: 'Auto', run: () => { if (ctx.hist) { const a = autoLevels(ctx.hist); holder.adj = a; } } }];
    }
    case 'curves': {
      const ref = { get value() { return ctx.channel ?? 0; } };
      return [{ type: 'select', label: 'Channel', options: [[0, 'RGB'], [1, 'Red'], [2, 'Green'], [3, 'Blue']], get: () => ctx.channel ?? 0, set: (v) => { ctx.channel = v; }, rebuild: true },
        { type: 'node', node: curvesEditor(holder, onInput, ctx.hist, ref) },
        { type: 'button', label: 'Reset curve', run: () => { holder.adj = { ...holder.adj, channels: rep(holder.adj.channels, ctx.channel ?? 0, [{ x: 0, y: 0 }, { x: 255, y: 255 }]) }; } }];
    }
    default: return [{ type: 'node', node: el('div', { style: 'color:var(--secondary)' }, 'This adjustment has no settings.') }];
  }
}

// Opens the dialog for an adjustment. `preview(adj)` shows it live (returns a promise); `original()` shows the unchanged picture.
// Resolves the final adjustment, or null on Cancel.
export async function runAdjustmentDialog(adjustment, { preview, hist, title }) {
  const holder = { adj: adjustment }, ctx = { hist };
  const noSettings = adjustment.type === 'invert';
  if (noSettings) return adjustment;
  let on = true;
  const update = () => { if (on) preview(holder.adj); };
  const ok = await liveDialog({
    title: title || adjustmentName(adjustment), fields: () => adjustmentFields(holder, update, ctx), onInput: update,
    onPreviewToggle: (v) => { on = v; preview(on ? holder.adj : createAdjustment('invert') && null); },
    resetFn: () => { const keep = holder.adj.seed != null ? { seed: holder.adj.seed } : {}; holder.adj = { ...createAdjustment(adjustment.type), ...keep }; },
  });
  return ok ? holder.adj : null;
}
export const histogramFromImage = (img) => histogramOf(img.data);
