// Lays a text style out in layer pixels (port of Composa.Text.TextLayout): which characters make each line, where every
// character boundary sits, and how big the bitmap is. The same layout draws the pixels and places the caret.
import { makeCanvas, ctxOf } from '../pixels.js';
import { clampStyle, lineHeightOf, isBox, colorAt, MIN_BOX } from './style.js';
import { LIMITS } from '../limits.js';

export const PADDING = 12;
const measureCtx = () => (measureCtx.c ||= ctxOf(makeCanvas(8, 8)));
const fontOf = (s) => `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${Math.max(1, Math.min(4000, s.size))}px ${/[\s,"']/.test(s.fontFamily) && !/^"/.test(s.fontFamily) ? `"${s.fontFamily}"` : s.fontFamily}, sans-serif`;
export const fontString = fontOf;

// The advance of each character, kerning-aware (pair corrections are cached), plus tracking.
function advances(ctx, text, tracking) {
  const out = new Float32Array(text.length), w1 = new Map(), w2 = new Map();
  const single = (c) => { let v = w1.get(c); if (v === undefined) { v = ctx.measureText(c).width; w1.set(c, v); } return v; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') continue;
    let a = single(c);
    const n = text[i + 1];
    if (n && n !== '\n' && c !== ' ' && n !== ' ') { const key = c + n; let k = w2.get(key); if (k === undefined) { k = ctx.measureText(key).width - single(c) - single(n); w2.set(key, k); } a += k; }
    out[i] = a + tracking;
  }
  return out;
}

export class TextLayout {
  constructor(style) {
    const s = (this.style = clampStyle(style)), text = (this.text = s.text.replace(/\r/g, '')), ctx = measureCtx();
    ctx.font = fontOf(s);
    const m = ctx.measureText('Hgjpq|É');
    this.ascent = m.fontBoundingBoxAscent ?? s.size * 0.9; this.descent = m.fontBoundingBoxDescent ?? s.size * 0.25;
    this.lineHeight = lineHeightOf(s);
    const adv = advances(ctx, text, s.tracking), box = isBox(s), available = box ? Math.max(1, s.boxWidth - 2 * PADDING) : Infinity;
    const ranges = []; let ps = 0;
    for (let i = 0; i <= text.length; i++) { if (i < text.length && text[i] !== '\n') continue; this.wrap(ps, i, adv, available, ranges); ps = i + 1; }
    let contentWidth = 0;
    const visible = ranges.map(([st, en]) => { let last = en; while (last > st && text[last - 1] === ' ') last--; let w = 0; for (let i = st; i < last; i++) w += adv[i]; contentWidth = Math.max(contentWidth, w); return w; });
    if (box) { this.width = Math.round(s.boxWidth); this.height = Math.round(s.boxHeight); contentWidth = available; }
    else {
      this.width = Math.max(MIN_BOX, Math.ceil(contentWidth + PADDING * 2 + s.size * 0.1));
      this.height = Math.max(MIN_BOX, Math.ceil(Math.max(ranges.length * this.lineHeight, this.ascent + this.descent) + PADDING * 2));
    }
    this.width = Math.min(this.width, LIMITS.maxSide); this.height = Math.min(this.height, LIMITS.maxSide);
    this.lines = ranges.map(([start, end], i) => {
      const positions = new Float32Array(end - start + 1);
      for (let k = 1; k <= end - start; k++) positions[k] = positions[k - 1] + adv[start + k - 1];
      const x = PADDING + (s.alignment === 'center' ? (contentWidth - visible[i]) / 2 : s.alignment === 'right' ? contentWidth - visible[i] : 0);
      return { start, end, x, baseline: PADDING + this.ascent + i * this.lineHeight, positions, visibleWidth: visible[i] };
    });
    const last = this.lines.at(-1);
    this.overflows = box && !!last && last.baseline + this.descent > this.height - PADDING + 0.5;
  }
  // Greedy word wrap of one paragraph; a word wider than the box breaks between characters.
  wrap(start, end, adv, available, lines) {
    const text = this.text;
    if (start === end) { lines.push([start, end]); return; }
    let pos = start;
    while (pos < end) {
      let width = 0, k = pos, lastSpace = -1;
      for (; k < end; k++) { if (width + adv[k] > available && k > pos) break; width += adv[k]; if (text[k] === ' ') lastSpace = k; }
      let lineEnd = k;
      if (k < end) { if (text[k] === ' ') { while (lineEnd < end && text[lineEnd] === ' ') lineEnd++; } else if (lastSpace >= pos) lineEnd = lastSpace + 1; }
      lines.push([pos, lineEnd]); pos = lineEnd;
    }
  }

  render() {
    const c = makeCanvas(this.width, this.height);
    this.draw(ctxOf(c));
    return c;
  }
  draw(ctx) {
    const s = this.style;
    ctx.save();
    if (isBox(s)) { ctx.beginPath(); ctx.rect(0, 0, this.width, this.height); ctx.clip(); }
    ctx.font = fontOf(s); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    for (const line of this.lines) {
      for (let i = line.start; i < line.end; i++) {
        const ch = this.text[i];
        if (ch === ' ' || ch === '\t') continue;
        ctx.fillStyle = colorAt(s, i);
        ctx.fillText(ch, line.x + line.positions[i - line.start], line.baseline);
      }
    }
    ctx.restore();
  }

  // ---- caret geometry ----
  // The line holding a character index. At a soft wrap the caret belongs to the start of the next line.
  lineOf(index) {
    index = Math.max(0, Math.min(this.text.length, index));
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i];
      if (index < l.start) return Math.max(0, i - 1);
      if (index > l.end) continue;
      if (index === l.end && i + 1 < this.lines.length && this.lines[i + 1].start === l.end) return i + 1;
      return i;
    }
    return this.lines.length - 1;
  }
  caretAt(index) {
    index = Math.max(0, Math.min(this.text.length, index));
    const l = this.lines[this.lineOf(index)], k = Math.max(0, Math.min(l.positions.length - 1, index - l.start));
    return { x: l.x + l.positions[k], top: l.baseline - this.ascent, bottom: l.baseline + this.descent };
  }
  indexAt(p) {
    if (!this.lines.length) return 0;
    const row = Math.floor((p.y - PADDING) / Math.max(1e-3, this.lineHeight)), l = this.lines[Math.max(0, Math.min(this.lines.length - 1, row))];
    return l.start + this.nearest(l, p.x);
  }
  indexOnAdjacentLine(index, dir) {
    const t = this.lineOf(index) + dir;
    if (t < 0) return 0;
    if (t >= this.lines.length) return this.text.length;
    const l = this.lines[t];
    return l.start + this.nearest(l, this.caretAt(index).x);
  }
  nearest(l, x) { let best = 0, bd = Infinity; for (let k = 0; k < l.positions.length; k++) { const d = Math.abs(l.x + l.positions[k] - x); if (d < bd) { bd = d; best = k; } } return best; }
  selectionRects(start, end) {
    const rects = [];
    if (end <= start) return rects;
    start = Math.max(0, Math.min(this.text.length, start)); end = Math.max(0, Math.min(this.text.length, end));
    for (const l of this.lines) {
      if (l.end < start || l.start >= end) { if (!(l.start === l.end && start <= l.start && l.start < end)) continue; }
      const from = Math.max(l.start, Math.min(l.end, start)), to = Math.max(l.start, Math.min(l.end, end));
      let right = l.x + l.positions[to - l.start];
      if (end > l.end && to === l.end) right += Math.max(4, this.ascent * 0.3);
      rects.push({ x: l.x + l.positions[from - l.start], y: l.baseline - this.ascent, w: right - (l.x + l.positions[from - l.start]), h: this.ascent + this.descent });
    }
    return rects;
  }
  wordStart(index) { const t = this.text, isW = (c) => /[\p{L}\p{N}]/u.test(c); index = Math.max(0, Math.min(t.length, index)); while (index > 0 && !isW(t[index - 1])) index--; while (index > 0 && isW(t[index - 1])) index--; return index; }
  wordEnd(index) { const t = this.text, isW = (c) => /[\p{L}\p{N}]/u.test(c); index = Math.max(0, Math.min(t.length, index)); while (index < t.length && !isW(t[index])) index++; while (index < t.length && isW(t[index])) index++; return index; }
}
export const renderText = (style) => new TextLayout(style).render();
