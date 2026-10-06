// The blend modes Canvas 2D cannot draw, composited per pixel (port of Composa SeparableBlend): Linear Burn, Linear
// Dodge, Vivid Light, Linear Light, Pin Light, Hard Mix, Subtract and Divide. Each is a separable function B(backdrop,
// source) on straight colour, combined as in the PDF compositing model: the blended colour where both layers cover the
// pixel, the plain source where only it does, the backdrop where only it does.
const vivid = (cb, cs) => {
  if (cs <= 0.5) { const burn = 2 * cs; return burn <= 0 ? (cb >= 1 ? 1 : 0) : 1 - Math.min(1, (1 - cb) / burn); }
  const dodge = 2 * cs - 1;
  return dodge >= 1 ? (cb <= 0 ? 0 : 1) : Math.min(1, cb / (1 - dodge));
};
export const SEPARABLE = {
  linearBurn: (cb, cs) => Math.max(0, cb + cs - 1),
  linearDodge: (cb, cs) => Math.min(1, cb + cs),
  vividLight: vivid,
  linearLight: (cb, cs) => Math.max(0, Math.min(1, cb + 2 * cs - 1)),
  pinLight: (cb, cs) => (cs < 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1)),
  hardMix: (cb, cs) => (cb + cs < 1 ? 0 : 1),
  subtract: (cb, cs) => Math.max(0, cb - cs),
  divide: (cb, cs) => (cb <= 0 ? 0 : cs <= 0 ? 1 : Math.min(1, cb / cs)),
};

// Composites `src` onto `dst` in place; both straight RGBA of the same size.
export function compositeSeparable(dst, src, mode, opacity) {
  const f = SEPARABLE[mode], k = Math.max(0, Math.min(1, opacity));
  for (let i = 0; i < dst.length; i += 4) {
    const sa = src[i + 3] / 255 * k;
    if (sa <= 0) continue;
    const da = dst[i + 3] / 255, both = sa * da, a = sa + da - both;
    for (let c = 0; c < 3; c++) {
      const cs = src[i + c] / 255, cb = dst[i + c] / 255;
      const pm = cs * sa * (1 - da) + cb * da * (1 - sa) + both * f(cb, cs);
      dst[i + c] = a > 0 ? Math.min(255, pm / a * 255) : 0;
    }
    dst[i + 3] = a * 255;
  }
}
