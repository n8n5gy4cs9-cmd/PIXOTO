import { el } from './dom.js';
import { commands, keysOf, labelOf, prettyKey, setShortcut, resetShortcuts, eventCombo, conflicts } from '../core/commands.js';
import { modal } from './dialogs.js';
import { state } from '../core/state.js';

// Keyboard Shortcuts (F1): every command with its keys. Click a row's key box and press the new combination; a combination
// already in use is reported and moved. Browser-reserved combinations (Ctrl+N, Ctrl+W, Ctrl+T) cannot always be caught,
// so the Alt variants stay on those commands. Restore Defaults clears every change.
const RESERVED = new Set(['Ctrl+N', 'Ctrl+W', 'Ctrl+T', 'Ctrl+Shift+N', 'Ctrl+Shift+T', 'Ctrl+Shift+W', 'Ctrl+Tab', 'F5', 'F11', 'F12']);

export function showShortcuts() {
  const body = el('div', { class: 'shortcuts' });
  const note = el('div', { class: 'note' }, 'Click a shortcut, then press the new keys. Escape cancels, Backspace clears.');
  let capturing = null;
  const render = () => {
    body.replaceChildren(note);
    const groups = {};
    for (const c of commands.values()) (groups[c.group] ||= []).push(c);
    for (const [g, list] of Object.entries(groups)) {
      const rows = list.map((c) => {
        const keys = keysOf(c), changed = state.shortcuts[c.id] != null;
        const box = el('button', { class: 'keybox' + (changed ? ' changed' : ''), title: 'Click to change' }, keys.length ? keys.map(prettyKey).join('  /  ') : '—');
        box.addEventListener('click', () => capture(c, box));
        return [el('span', {}, labelOf(c)), box];
      });
      body.append(el('b', {}, g), el('div', { class: 'kgrid' }, rows.flat()));
    }
  };
  const capture = (c, box) => {
    capturing?.cancel();
    box.textContent = 'Press keys…'; box.classList.add('capturing');
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return stop();
      if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey) { setShortcut(c.id, []); return stop(); }
      const combo = eventCombo(e); if (!combo) return;
      const clash = [...commands.values()].find((o) => o !== c && keysOf(o).includes(combo));
      if (clash) setShortcut(clash.id, keysOf(clash).filter((k) => k !== combo));
      setShortcut(c.id, [combo]);
      if (RESERVED.has(combo)) note.textContent = `${prettyKey(combo)} is reserved by the browser and may not reach Pixoto; the installed app allows it.`;
      else if (clash) note.textContent = `${prettyKey(combo)} was taken by “${labelOf(clash)}”; that command no longer has it.`;
      stop();
    };
    const stop = () => { document.removeEventListener('keydown', onKey, true); capturing = null; render(); };
    capturing = { cancel: stop };
    document.addEventListener('keydown', onKey, true);
  };
  render();
  modal('Keyboard Shortcuts', body, [{ label: 'Restore Defaults', value: 'reset' }, { label: 'Close', value: true, accent: true }]).then((v) => { capturing?.cancel(); if (v === 'reset') resetShortcuts(); });
}
