// Hand, Zoom and Eyedropper. Panning with Space or the middle button lives in the canvas view itself.
import { renderer } from '../../core/render.js';
import { getData, rgbToHex } from '../../core/pixels.js';
import { update } from '../../core/state.js';

export function pickColor(ev, background = false) {
  const { doc, p } = ev, x = Math.floor(p.x), y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
  const d = getData(renderer.render(doc), x, y, 1, 1).data;
  if (d[3] === 0) return;
  update(background ? { bg: rgbToHex(d[0], d[1], d[2]) } : { fg: rgbToHex(d[0], d[1], d[2]) });
}

// Generated SVG cursors (hotspot in the 32px tile).
const svg = (body, x, y, fallback) => `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>${body}</svg>`)}") ${x} ${y}, ${fallback}`;
const CURSOR = {
  eyedropper: svg("<path d='M4 28l3-1 12-12-3-3L4 24z' fill='#fff' stroke='#000' stroke-width='1.5'/><path d='M17 9l6 6' stroke='#000' stroke-width='3'/><circle cx='4' cy='28' r='1.5' fill='#000'/>", 4, 28, 'crosshair'),
  zoomIn: svg("<circle cx='13' cy='13' r='8' fill='none' stroke='#000' stroke-width='3'/><circle cx='13' cy='13' r='8' fill='none' stroke='#fff' stroke-width='1'/><path d='M9 13h8M13 9v8M19 19l9 9' stroke='#000' stroke-width='2.5'/>", 13, 13, 'zoom-in'),
  zoomOut: svg("<circle cx='13' cy='13' r='8' fill='none' stroke='#000' stroke-width='3'/><circle cx='13' cy='13' r='8' fill='none' stroke='#fff' stroke-width='1'/><path d='M9 13h8M19 19l9 9' stroke='#000' stroke-width='2.5'/>", 13, 13, 'zoom-out'),
};
export const createViewTools = () => ({
  hand: { cursor: () => 'grab' },
  zoom: {
    cursor: (v) => (v.altDown ? CURSOR.zoomOut : CURSOR.zoomIn),
    down(ev) { this.d = { sx: ev.screen.x, sy: ev.screen.y, z0: ev.view.zoom, moved: false, alt: ev.alt }; },
    move(ev) {
      const d = this.d, dx = ev.screen.x - d.sx;
      if (Math.abs(dx) > 4) { d.moved = true; ev.view.zoomAt(d.z0 * Math.exp(dx / 200), d.sx, d.sy); }
    },
    up(ev) { const d = this.d; if (d && !d.moved) ev.view.stepZoom(d.alt || ev.alt ? -1 : 1, ev.screen); this.d = null; },
    cancel() { this.d = null; },
  },
  eyedropper: {
    cursor: () => CURSOR.eyedropper,
    down(ev) { pickColor(ev, ev.alt); },
    move(ev) { pickColor(ev, ev.alt); },
  },
});
