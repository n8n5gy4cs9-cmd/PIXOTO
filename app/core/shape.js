// Live shapes (port of Composa ShapeStyle + EditorSession.RenderShape). A shape is { kind, fill '#rrggbb', cornerRadius,
// lineWidth, startX/Y, endX/Y } where the line ends are fractions of the layer's box.
import { makeCanvas, ctxOf } from './pixels.js';

export const SHAPE_KINDS = ['rect', 'rounded', 'ellipse', 'line'];
export const shapeName = (k) => ({ rect: 'Rectangle', rounded: 'Rounded Rectangle', ellipse: 'Ellipse', line: 'Line' })[k];

export function renderShape(style, width, height) {
  const c = makeCanvas(width, height), ctx = ctxOf(c);
  ctx.fillStyle = ctx.strokeStyle = style.fill; ctx.imageSmoothingEnabled = true;
  switch (style.kind) {
    case 'line': {
      const t = Math.max(1, style.lineWidth), inset = { x: Math.min(t, width) / 2, y: Math.min(t, height) / 2 };
      const from = style.startX != null ? { x: style.startX * width, y: style.startY * height } : inset;
      const to = style.endX != null ? { x: style.endX * width, y: style.endY * height } : { x: width - inset.x, y: height - inset.y };
      ctx.lineWidth = t; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      break;
    }
    case 'ellipse': ctx.beginPath(); ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2); ctx.fill(); break;
    case 'rounded': { const r = Math.min(style.cornerRadius, Math.min(width, height) / 2); ctx.beginPath(); ctx.roundRect(0, 0, width, height, r); ctx.fill(); break; }
    default: ctx.fillRect(0, 0, width, height);
  }
  return c;
}
