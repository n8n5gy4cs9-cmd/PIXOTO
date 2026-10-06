// Live text settings (port of Composa.Model.TextStyle). A style is a plain immutable object; every change makes a new one.
// colors are '#rrggbb'. colorRuns are { start, length, color } over the characters, sorted and disjoint, or null.
import { clamp } from '../geom.js';
import { LIMITS } from '../limits.js';

export const TEXT_MAX_LENGTH = 100_000, MIN_BOX = 16;
export const defaultTextStyle = () => ({ text: '', fontFamily: 'Arial', size: 72, color: '#000000', bold: false, italic: false, alignment: 'left', tracking: 0, leading: 0, boxWidth: null, boxHeight: null, colorRuns: null });

export const lineHeightOf = (s) => (s.leading > 0 ? s.leading : s.size * 1.2);
export const isBox = (s) => s.boxWidth != null && s.boxHeight != null;
const fin = (v, lo, hi, d) => (Number.isFinite(v) ? clamp(v, lo, hi) : d);

export function clampStyle(s) {
  const text = s.text.length > TEXT_MAX_LENGTH ? s.text.slice(0, TEXT_MAX_LENGTH) : s.text;
  const box = s.boxWidth != null && s.boxHeight != null && Number.isFinite(s.boxWidth) && Number.isFinite(s.boxHeight);
  return { ...s, text, size: fin(s.size, 1, 2000, 72), tracking: fin(s.tracking, -100, 1000, 0), leading: fin(s.leading, 0, 5000, 0),
    boxWidth: box ? clamp(Math.round(s.boxWidth), MIN_BOX, LIMITS.maxSide) : null, boxHeight: box ? clamp(Math.round(s.boxHeight), MIN_BOX, LIMITS.maxSide) : null, colorRuns: validRuns(s.colorRuns, text.length) };
}
function validRuns(runs, length) {
  if (!runs || !runs.length) return null;
  let end = 0;
  for (const r of runs) { if (r.start < end || r.length <= 0 || r.start > length - r.length) return null; end = r.start + r.length; }
  return runs;
}
export const colorAt = (s, i) => { if (s.colorRuns) for (const r of s.colorRuns) if (r.start <= i && i < r.start + r.length) return r.color; return s.color; };
const unitColors = (s) => { const c = new Array(s.text.length).fill(s.color); for (const r of s.colorRuns || []) for (let i = Math.max(0, r.start); i < Math.min(c.length, r.start + r.length); i++) c[i] = r.color; return c; };
function toRuns(colors, base) {
  const runs = [];
  for (let i = 0; i < colors.length; i++) {
    if (colors[i] === base) continue;
    const last = runs.at(-1);
    if (last && last.start + last.length === i && last.color === colors[i]) last.length++; else runs.push({ start: i, length: 1, color: colors[i] });
  }
  return runs.length ? runs : null;
}
// Paints characters start..end in a colour. An empty range, or one covering all the text, recolours everything.
export function withColor(s, color, start, end) {
  const n = s.text.length;
  start = clamp(start, 0, n); end = clamp(end, start, n);
  if (start === end || (start === 0 && end === n)) return { ...s, color, colorRuns: null };
  const c = unitColors(s);
  for (let i = start; i < end; i++) c[i] = color;
  return { ...s, colorRuns: toRuns(c, s.color) };
}
// Keeps colours on their letters when characters start..end are replaced by `length` new ones (which take the colour before them).
export function withReplacedCharacters(s, start, end, length) {
  if (!s.colorRuns) return s;
  const c = unitColors(s);
  start = clamp(start, 0, c.length); end = clamp(end, start, c.length);
  const inherited = start > 0 ? c[start - 1] : end > start ? c[start] : c.length ? c[0] : s.color;
  c.splice(start, end - start, ...new Array(Math.max(0, length)).fill(inherited));
  return { ...s, colorRuns: toRuns(c, s.color) };
}
export const asDefaults = (s) => ({ ...s, text: '', boxWidth: null, boxHeight: null, colorRuns: null });
export const scaledStyle = (s, sx, sy = sx) => clampStyle({ ...s, size: s.size * sy, tracking: s.tracking * sx, leading: s.leading * sy, boxWidth: s.boxWidth == null ? null : s.boxWidth * sx, boxHeight: s.boxHeight == null ? null : s.boxHeight * sy });
export const layerNameOf = (s) => { const f = s.text.split(/\s+/).filter(Boolean).join(' '); return !f ? 'Text' : f.length > 40 ? f.slice(0, 40) : f; };
export const sameStyle = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
