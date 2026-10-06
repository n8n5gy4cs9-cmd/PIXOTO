// The state of text being typed on the canvas (port of Composa.Text.TextEditor): style with content, caret, selection
// anchor and a local undo history for typing. It knows nothing about layers.
import { TextLayout } from './layout.js';
import { clampStyle, withColor, withReplacedCharacters, colorAt, sameStyle, TEXT_MAX_LENGTH } from './style.js';

export class TextEditor {
  constructor(style) {
    this.style = clampStyle(style); this.caret = this.anchor = this.style.text.length;
    this.undoStack = []; this.redoStack = []; this._layout = null; this.lastWasTyping = false; this.onChange = () => {};
  }
  get text() { return this.style.text; }
  get hasSelection() { return this.caret !== this.anchor; }
  get selectionStart() { return Math.min(this.caret, this.anchor); }
  get selectionEnd() { return Math.max(this.caret, this.anchor); }
  get selectedText() { return this.text.slice(this.selectionStart, this.selectionEnd); }
  get layout() { return (this._layout ||= new TextLayout(this.style)); }

  // Types text over the selection. Consecutive typing undoes as one step.
  insert(t) {
    t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, '    ');
    if (!t.length && !this.hasSelection) return;
    this.record(t.length <= 2 && !t.includes('\n'));
    const s = this.selectionStart, e = this.selectionEnd, content = this.text.slice(0, s) + t + this.text.slice(e);
    if (content.length > TEXT_MAX_LENGTH) return;
    this.apply({ ...withReplacedCharacters(this.style, s, e, t.length), text: content }, s + t.length);
  }
  step(i, dir) {
    const t = this.text;
    if (dir < 0) return i >= 2 && /[\uDC00-\uDFFF]/.test(t[i - 1]) && /[\uD800-\uDBFF]/.test(t[i - 2]) ? 2 : 1;
    return i + 1 < t.length && /[\uD800-\uDBFF]/.test(t[i]) && /[\uDC00-\uDFFF]/.test(t[i + 1]) ? 2 : 1;
  }
  backspace(word = false) {
    if (this.hasSelection) return this.deleteSelection();
    if (this.caret === 0) return;
    const to = word ? this.layout.wordStart(this.caret) : this.caret - this.step(this.caret, -1);
    this.record(!word);
    this.apply({ ...withReplacedCharacters(this.style, to, this.caret, 0), text: this.text.slice(0, to) + this.text.slice(this.caret) }, to);
  }
  delete(word = false) {
    if (this.hasSelection) return this.deleteSelection();
    if (this.caret >= this.text.length) return;
    const to = word ? this.layout.wordEnd(this.caret) : this.caret + this.step(this.caret, 1);
    this.record(false);
    this.apply({ ...withReplacedCharacters(this.style, this.caret, to, 0), text: this.text.slice(0, this.caret) + this.text.slice(to) }, this.caret);
  }
  deleteSelection() {
    this.record(false);
    const s = this.selectionStart, e = this.selectionEnd;
    this.apply({ ...withReplacedCharacters(this.style, s, e, 0), text: this.text.slice(0, s) + this.text.slice(e) }, s);
  }
  // Changes anything but the content (font, size, colour, spacing, box). Undoable within the editor.
  changeStyle(fn) {
    const next = clampStyle({ ...fn(this.style), text: this.text });
    if (sameStyle(next, this.style)) return;
    this.record(false);
    this.apply(next, this.caret, this.anchor);
  }
  setColor(color) {
    const next = withColor(this.style, color, this.selectionStart, this.selectionEnd);
    if (sameStyle(next, this.style)) return;
    this.record(false);
    this.apply(next, this.caret, this.anchor);
  }
  get colorAtCaret() { return colorAt(this.style, this.hasSelection ? this.selectionStart : Math.max(0, this.caret - 1)); }

  moveTo(index, select) {
    this.caret = Math.max(0, Math.min(this.text.length, index));
    if (!select) this.anchor = this.caret;
    this.lastWasTyping = false; this.onChange();
  }
  moveHorizontal(dir, select, word = false) {
    if (!select && this.hasSelection && !word) return this.moveTo(dir < 0 ? this.selectionStart : this.selectionEnd, false);
    this.moveTo(word ? (dir < 0 ? this.layout.wordStart(this.caret) : this.layout.wordEnd(this.caret)) : this.caret + dir * this.step(this.caret, dir), select);
  }
  moveVertical(dir, select) { this.moveTo(this.layout.indexOnAdjacentLine(this.caret, dir), select); }
  moveToLineEdge(end, select) { const l = this.layout.lines[this.layout.lineOf(this.caret)]; this.moveTo(end ? l.end : l.start, select); }
  moveToDocumentEdge(end, select) { this.moveTo(end ? this.text.length : 0, select); }
  selectAll() { this.anchor = 0; this.caret = this.text.length; this.lastWasTyping = false; this.onChange(); }
  selectWordAt(i) { this.anchor = this.layout.wordStart(Math.min(i + 1, this.text.length)); this.caret = this.layout.wordEnd(this.anchor); this.lastWasTyping = false; this.onChange(); }
  clickAt(p, select) { this.moveTo(this.layout.indexAt(p), select); }

  record(typing) {
    if (typing && this.lastWasTyping && this.undoStack.length) return;
    this.undoStack.push({ style: this.style, caret: this.caret, anchor: this.anchor });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0; this.lastWasTyping = typing;
  }
  apply(style, caret, anchor) {
    this.style = style; this._layout = null;
    this.caret = Math.max(0, Math.min(this.text.length, caret)); this.anchor = Math.max(0, Math.min(this.text.length, anchor ?? this.caret));
    this.onChange();
  }
  undo() { const u = this.undoStack.pop(); if (!u) return false; this.redoStack.push({ style: this.style, caret: this.caret, anchor: this.anchor }); this.lastWasTyping = false; this.apply(u.style, u.caret, u.anchor); return true; }
  redo() { const r = this.redoStack.pop(); if (!r) return false; this.undoStack.push({ style: this.style, caret: this.caret, anchor: this.anchor }); this.lastWasTyping = false; this.apply(r.style, r.caret, r.anchor); return true; }
}
