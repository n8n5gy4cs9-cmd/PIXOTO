// Port of Composa.Model.BlendMode. Photoshop order and grouping.
export const BLEND_GROUPS = [
  ['normal'],
  ['darken', 'multiply', 'colorBurn', 'linearBurn'],
  ['lighten', 'screen', 'colorDodge', 'linearDodge'],
  ['overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix'],
  ['difference', 'exclusion', 'subtract', 'divide'],
  ['hue', 'saturation', 'color', 'luminosity'],
];

const NAMES = {
  colorDodge: 'Color Dodge', colorBurn: 'Color Burn', softLight: 'Soft Light', hardLight: 'Hard Light',
  linearBurn: 'Linear Burn', linearDodge: 'Linear Dodge (Add)', vividLight: 'Vivid Light', linearLight: 'Linear Light',
  pinLight: 'Pin Light', hardMix: 'Hard Mix',
};
export const blendName = (m) => NAMES[m] || m[0].toUpperCase() + m.slice(1);

// Canvas 2D composite operations. Linear Dodge is 'lighter' (additive). Modes missing here are
// composited per pixel (Phase 6); until then they draw as normal.
const CANVAS_OP = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  difference: 'difference', colorDodge: 'color-dodge', colorBurn: 'color-burn', softLight: 'soft-light',
  hardLight: 'hard-light', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color',
  luminosity: 'luminosity', linearDodge: 'lighter',
};
export const canvasOp = (m) => CANVAS_OP[m] || 'source-over';
export const isCustomBlend = (m) => !(m in CANVAS_OP);
