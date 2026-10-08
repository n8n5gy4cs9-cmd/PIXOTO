// Camera Raw Filter panel (port of Composa's CameraRawDialog): a histogram of the graded layer, a thumbnail that doubles as the
// white-balance eyedropper, then collapsible groups that each have an eye to switch them off without clearing their sliders.
// `cur` is replaced (never mutated) on every change; the canvas previews the rendered grade, where a hidden group counts as default.
import { el, icon } from './dom.js';
import { fieldRow } from './live-dialog.js';
import { curvesEditor } from './adjust-dialogs.js';
import { PreviewSession } from '../core/ops/preview.js';
import { getData } from '../core/pixels.js';
import { histogramOf } from '../core/filters/adjust.js';
import { FILTER_BY_ID } from '../core/filters/filters.js';
import { lastFilter } from './last-filter.js';
import {
  GROUPS, MIXER_NAMES, WHEEL_NAMES, CALIBRATION_SUMMARY, defaultSettings, normalizeSettings, isIdentitySettings, adjustsGroup, withoutGroup, put,
  linearCurve, neutralizeSrgb, autoBalance, straightColor,
} from '../core/filters/cameraraw.js';

const TITLES = { light: 'Light', color: 'Color', grading: 'Color Grading', effects: 'Effects', curve: 'Curve', mixer: 'Color Mixer', detail: 'Detail', optics: 'Optics', calibration: 'Calibration' };
const OPEN = new Set(['light', 'color']);
const debounce = (fn, ms) => { let t = 0; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

function drawHistogram(canvas, hist) {
  const ctx = canvas.getContext('2d'), { width: w, height: h } = canvas;
  ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, w, h);
  let max = 1;
  for (const bins of hist.slice(0, 3)) for (let i = 1; i < 255; i++) max = Math.max(max, bins[i]);
  ctx.globalCompositeOperation = 'lighter';
  ['#a22', '#2a2', '#24b'].forEach((color, c) => {
    ctx.fillStyle = color;
    for (let i = 0; i < 256; i++) { const bar = Math.min(1, hist[c][i] / max) * h; ctx.fillRect(i * w / 256, h - bar, Math.max(1, w / 256), bar); }
  });
  ctx.globalCompositeOperation = 'source-over';
}

export async function runCameraRawDialog(app) {
  const s = PreviewSession.begin(app.doc, FILTER_BY_ID.cameraRaw.name);
  if (!s) { app.problem('Select a pixel layer or a mask to filter.'); return false; }
  const original = s.image;
  let cur = lastFilter.id === 'cameraRaw' && lastFilter.params?.settings ? normalizeSettings(lastFilter.params.settings) : defaultSettings();
  const hidden = new Set();
  let on = true, rows = [], curveHolder = null, curveCanvas = null, curveChannel = 0;
  const rendered = () => [...hidden].reduce((settings, group) => withoutGroup(settings, group), cur);
  const eyes = new Map();
  const refreshEyes = () => { for (const [group, eye] of eyes) eye.style.display = adjustsGroup(cur, group) ? '' : 'none'; };

  const histBox = el('canvas', { width: 300, height: 80, class: 'histo' });
  const drawHist = () => { try { drawHistogram(histBox, histogramOf(s.mask ? s.image.data : getData(s.layer.canvas).data)); } catch { /* layer replaced while closing */ } };
  const run = debounce(() => {
    if (!on) return;
    s.filter('cameraRaw', { settings: rendered() }).then(drawHist).catch((e) => app.problem(e.message));
  }, 120);
  const changed = () => { refreshEyes(); run(); };

  const refreshAll = () => {
    rows = rows.filter((r) => r.isConnected);
    rows.forEach((r) => r.refresh?.());
    if (curveHolder) { curveHolder.adj = { channels: cur.curve.channels }; curveCanvas.redraw(); }
    changed();
  };
  const get = (path) => path.reduce((o, k) => o[k], cur);
  const row = (spec) => { const r = fieldRow(spec, changed, null); rows.push(r); return r; };
  const slider = (label, path, min, max, step = 1, extra = {}) => {
    const def = path.reduce((o, k) => o[k], defaultSettings());
    return row({ type: 'range', label, min, max, step, def, get: () => get(path), set: (v) => { cur = put(cur, path, v); extra.after?.(); } });
  };
  const select = (label, path, options, extra = {}) => row({ type: 'select', label, options, string: typeof get(path) === 'string', get: () => get(path), set: (v) => { cur = put(cur, path, v); extra.after?.(v); } });
  const check = (label, path) => row({ type: 'check', label, get: () => get(path), set: (v) => { cur = put(cur, path, v); } });
  const heading = (text) => el('div', { class: 'crhead' }, text);

  // Thumbnail: click a pixel that should be neutral and Temperature and Tint follow.
  const thumb = el('canvas', { class: 'crthumb', title: 'Click a pixel that should be neutral to set the white balance from it' });
  const readout = el('div', { class: 'crread' }, 'R —   G —   B —');
  {
    const k = Math.min(1, 300 / original.width, 180 / original.height), tw = Math.max(1, Math.round(original.width * k)), th = Math.max(1, Math.round(original.height * k));
    const full = document.createElement('canvas'); full.width = original.width; full.height = original.height; full.getContext('2d').putImageData(original, 0, 0);
    thumb.width = tw; thumb.height = th;
    const ctx = thumb.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(full, 0, 0, tw, th);
  }
  const colorAt = (e) => { const r = thumb.getBoundingClientRect(); return straightColor(original, Math.floor((e.clientX - r.left) / r.width * original.width), Math.floor((e.clientY - r.top) / r.height * original.height)); };
  thumb.addEventListener('pointermove', (e) => { const c = colorAt(e); readout.textContent = c ? `R ${Math.round(c[0] * 255)}   G ${Math.round(c[1] * 255)}   B ${Math.round(c[2] * 255)}` : 'R —   G —   B —'; });
  thumb.addEventListener('pointerdown', (e) => {
    const c = colorAt(e), solved = c && neutralizeSrgb(c[0], c[1], c[2]);
    if (!solved) return;
    cur = { ...cur, ...solved, whiteBalance: 'custom' };
    refreshAll();
  });

  const customWb = () => { if (cur.whiteBalance !== 'custom') { cur = { ...cur, whiteBalance: 'custom' }; rows.forEach((r) => r.refresh?.()); } };
  const groupBodies = {
    light: () => [slider('Exposure', ['exposure'], -5, 5, 0.05), slider('Contrast', ['contrast'], -100, 100), slider('Highlights', ['highlights'], -100, 100), slider('Shadows', ['shadows'], -100, 100), slider('Whites', ['whites'], -100, 100), slider('Blacks', ['blacks'], -100, 100)],
    color: () => [
      select('White Balance', ['whiteBalance'], [['custom', 'Custom'], ['auto', 'Auto']], { after: (value) => {
        if (value !== 'auto') return;
        const solved = autoBalance(original);
        cur = { ...cur, whiteBalance: 'auto', temperature: solved?.temperature ?? 0, tint: solved?.tint ?? 0 };
        refreshAll();
      } }),
      slider('Temperature', ['temperature'], -100, 100, 1, { after: customWb }), slider('Tint', ['tint'], -100, 100, 1, { after: customWb }),
      slider('Vibrance', ['vibrance'], -100, 100), slider('Saturation', ['saturation'], -100, 100)],
    grading: () => [
      ...WHEEL_NAMES.flatMap((name, i) => [heading(name), slider('Hue', ['grading', 'wheels', i, 'hue'], 0, 360), slider('Saturation', ['grading', 'wheels', i, 'saturation'], 0, 100), slider('Luminance', ['grading', 'wheels', i, 'luminance'], -100, 100)]),
      heading('Overlap'), slider('Blending', ['grading', 'blending'], 0, 100), slider('Balance', ['grading', 'balance'], -100, 100)],
    effects: () => [
      slider('Texture', ['texture'], -100, 100), slider('Clarity', ['clarity'], -100, 100), slider('Dehaze', ['dehaze'], -100, 100),
      heading('Glow'), slider('Glow', ['glow'], 0, 100), select('Style', ['glowStyle'], [['diffusion', 'Diffusion'], ['bloom', 'Bloom'], ['halation', 'Halation']]),
      slider('Range', ['glowRange'], -100, 100), slider('Spread', ['glowSpread'], -100, 100), slider('Warmth', ['glowWarmth'], -100, 100),
      heading('Vignette'), slider('Amount', ['vignetteAmount'], -100, 100), select('Style', ['vignetteStyle'], [['highlight', 'Highlight Priority'], ['color', 'Color Priority'], ['paint', 'Paint Overlay']]),
      slider('Midpoint', ['vignetteMidpoint'], 0, 100), slider('Roundness', ['vignetteRoundness'], -100, 100), slider('Feather', ['vignetteFeather'], 0, 100), slider('Highlights', ['vignetteHighlights'], 0, 100),
      heading('Grain'), slider('Amount', ['grainAmount'], 0, 100), slider('Size', ['grainSize'], 0, 100), slider('Roughness', ['grainRoughness'], 0, 100)],
    curve: () => {
      curveHolder = { adj: { channels: cur.curve.channels } };
      const ref = { get value() { return curveChannel; } };
      curveCanvas = curvesEditor(curveHolder, () => { cur = put(cur, ['curve', 'channels'], curveHolder.adj.channels); changed(); }, null, ref);
      return [heading('Parametric'), slider('Highlights', ['curve', 'highlights'], -100, 100), slider('Lights', ['curve', 'lights'], -100, 100), slider('Darks', ['curve', 'darks'], -100, 100), slider('Shadows', ['curve', 'shadows'], -100, 100),
        slider('Refine Saturation', ['curve', 'refineSaturation'], -100, 100), heading('Point'),
        row({ type: 'select', label: 'Channel', options: [[0, 'RGB'], [1, 'Red'], [2, 'Green'], [3, 'Blue']], get: () => curveChannel, set: (v) => { curveChannel = v; curveCanvas.redraw(); } }),
        row({ type: 'node', node: curveCanvas }),
        row({ type: 'button', label: 'Reset curve', run: () => { cur = put(cur, ['curve', 'channels'], [linearCurve(), linearCurve(), linearCurve(), linearCurve()]); curveHolder.adj = { channels: cur.curve.channels }; curveCanvas.redraw(); } })];
    },
    mixer: () => {
      let tab = 'hue';
      const box = el('div', { class: 'crbox' });
      const build = () => { box.replaceChildren(...MIXER_NAMES.map((name, i) => slider(name, ['mixer', tab, i], -100, 100))); };
      build();
      return [row({ type: 'select', label: 'Adjust', options: [['hue', 'Hue'], ['saturation', 'Saturation'], ['luminance', 'Luminance']], string: true, get: () => tab, set: (v) => { tab = v; build(); } }), box];
    },
    detail: () => [
      heading('Sharpening'), slider('Amount', ['detail', 'sharpenAmount'], 0, 150), slider('Radius', ['detail', 'sharpenRadius'], 0, 100), slider('Detail', ['detail', 'sharpenDetail'], 0, 100), slider('Masking', ['detail', 'sharpenMasking'], 0, 100),
      heading('Noise Reduction'), slider('Luminance', ['detail', 'noiseLuminance'], 0, 100), slider('Detail', ['detail', 'noiseLuminanceDetail'], 0, 100), slider('Contrast', ['detail', 'noiseLuminanceContrast'], 0, 100),
      slider('Color', ['detail', 'noiseColor'], 0, 100), slider('Detail', ['detail', 'noiseColorDetail'], 0, 100), slider('Smoothness', ['detail', 'noiseColorSmoothness'], 0, 100)],
    optics: () => [
      check('Remove Chromatic Aberration', ['optics', 'chromatic']), check('Enable Lens Profile Corrections', ['optics', 'lensProfile']),
      slider('Distortion', ['optics', 'profileDistortion'], 0, 100), slider('Vignetting', ['optics', 'profileVignetting'], 0, 100),
      heading('Manual'), slider('Distortion', ['optics', 'distortion'], -100, 100),
      heading('Defringe'), slider('Purple Amount', ['optics', 'purpleAmount'], 0, 100), slider('Purple Hue Low', ['optics', 'purpleHueLow'], 0, 360), slider('Purple Hue High', ['optics', 'purpleHueHigh'], 0, 360),
      slider('Green Amount', ['optics', 'greenAmount'], 0, 100), slider('Green Hue Low', ['optics', 'greenHueLow'], 0, 360), slider('Green Hue High', ['optics', 'greenHueHigh'], 0, 360),
      heading('Vignette'), slider('Amount', ['optics', 'vignetteAmount'], -100, 100), slider('Midpoint', ['optics', 'vignetteMidpoint'], 0, 100)],
    calibration: () => {
      const summary = el('div', { class: 'crnote' }, CALIBRATION_SUMMARY[cur.calibration.process - 1]);
      return [select('Process', ['calibration', 'process'], [1, 2, 3, 4, 5, 6].map((n) => [n, 'Version ' + n]), { after: (v) => { summary.textContent = CALIBRATION_SUMMARY[v - 1]; } }), summary,
        slider('Shadow Tint', ['calibration', 'shadowTint'], -100, 100),
        heading('Red Primary'), slider('Hue', ['calibration', 'redHue'], -100, 100), slider('Saturation', ['calibration', 'redSaturation'], -100, 100),
        heading('Green Primary'), slider('Hue', ['calibration', 'greenHue'], -100, 100), slider('Saturation', ['calibration', 'greenSaturation'], -100, 100),
        heading('Blue Primary'), slider('Hue', ['calibration', 'blueHue'], -100, 100), slider('Saturation', ['calibration', 'blueSaturation'], -100, 100)];
    },
  };

  const groups = el('div', { class: 'crgroups' });
  for (const group of GROUPS) {
    const eye = el('button', { class: 'iconbtn creye', title: 'Switch this group off or on without clearing its sliders', 'aria-label': 'Toggle ' + TITLES[group] }, icon('eye'));
    eye.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!hidden.delete(group)) hidden.add(group);
      eye.replaceChildren(icon(hidden.has(group) ? 'eye-off' : 'eye'));
      changed();
    });
    eyes.set(group, eye);
    groups.append(el('details', { class: 'crgroup', open: OPEN.has(group) }, el('summary', {}, el('span', { class: 'grow' }, TITLES[group]), eye), el('div', { class: 'crbody' }, groupBodies[group]())));
  }
  refreshEyes();

  const result = await new Promise((resolve) => {
    const prev = el('input', { type: 'checkbox', checked: true });
    prev.addEventListener('change', () => { on = prev.checked; if (on) run(); else s.showOriginal(); });
    const done = (ok) => { dlg.remove(); blocker.remove(); document.removeEventListener('keydown', onKey, true); resolve(ok); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
      else if (e.key === 'Enter' && !['BUTTON', 'SELECT', 'SUMMARY'].includes(e.target.tagName)) { e.stopPropagation(); done(true); }
    };
    const reset = () => { cur = defaultSettings(); hidden.clear(); eyes.forEach((eye) => eye.replaceChildren(icon('eye'))); refreshAll(); };
    const blocker = el('div', { class: 'blocker' });
    const dlg = el('div', { class: 'dlg floatdlg crdlg', role: 'dialog', 'aria-label': 'Camera Raw Filter' },
      el('h2', {}, 'Camera Raw Filter'),
      el('div', { class: 'body crtop' }, histBox, thumb, readout),
      el('div', { class: 'body fields' }, groups),
      el('div', { class: 'foot' }, el('label', { class: 'chk pv' }, prev, 'Preview'), el('span', { class: 'grow' }),
        el('button', { class: 'btn', onClick: reset }, 'Reset'), el('button', { class: 'btn', onClick: () => done(false) }, 'Cancel'), el('button', { class: 'btn accent', onClick: () => done(true) }, 'OK')));
    document.addEventListener('keydown', onKey, true);
    document.body.append(blocker, dlg);
    drawHistogram(histBox, histogramOf(original.data));
    run();
  });

  const final = rendered();
  if (!result) { s.cancel(); return false; }
  if (isIdentitySettings(final)) { s.cancel(); return true; }
  await s.filter('cameraRaw', { settings: final });
  await s.commit();
  lastFilter.id = 'cameraRaw'; lastFilter.params = { settings: final };
  return true;
}
