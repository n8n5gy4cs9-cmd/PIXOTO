// App-wide state shared by all documents (tool settings and colours carry across tabs, like Composa).
const KEY = 'pixoto.settings.v1';
const defaults = {
  tool: 'move',
  modes: { marquee: 0, lasso: 0, wand: 0, brush: 0, smear: 0, shape: 0 },
  fg: '#000000', bg: '#ffffff',
  brush: { size: 20, hardness: 0.8, opacity: 1, smoothing: 0, spacing: 0.08 },
  wandTolerance: 32, objectEdge: 0, cropRatio: 'Free', textDefaults: { fontFamily: 'Inter', size: 72, bold: false, italic: false, alignment: 'left', tracking: 0, leading: 0 }, wandContiguous: true, wandAllLayers: false, feather: 0,
  gradientToTransparent: false, gradientRadial: false, gradientOpacity: 1,
  shapeCornerRadius: 24, shapeLineWidth: 4,
  cloneAligned: true, cloneAllLayers: false, autoSelect: true, transformControls: true, gpu: true,
  view: { rulers: false, grid: false, guides: true, snap: true, snapGuides: true, snapGrid: false, snapLayers: true, snapBounds: true, lockGuides: false, pixelGrid: true },
  shortcuts: {},
};

const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}'), out = structuredClone(defaults);
    for (const [k, v] of Object.entries(saved)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && k in defaults && k !== 'shortcuts' ? { ...defaults[k], ...v } : v;
    return out;
  } catch { return structuredClone(defaults); }
};
export const state = load();
export const isGpuEnabled = () => state.gpu !== false;
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
let timer = 0;
export const update = (patch) => {
  if (patch) Object.assign(state, patch);
  for (const fn of listeners) fn(state);
  clearTimeout(timer);
  timer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }, 300);
};
