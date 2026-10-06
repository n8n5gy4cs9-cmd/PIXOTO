// Command registry + keymap. Menus, shortcuts and buttons all run commands from here.
import { state, update } from './state.js';

export const commands = new Map();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modLabel = isMac ? '⌘' : 'Ctrl';

export function register(id, { label, group = 'Menus', keys = [], run, enabled, checked, todo = false }) {
  commands.set(id, { id, label, group, defaultKeys: keys, run, enabled, checked, todo });
}
export const labelOf = (c) => (typeof c.label === "function" ? c.label() : c.label);
export const keysOf = (cmd) => state.shortcuts[cmd.id] ?? cmd.defaultKeys;
export const isEnabled = (cmd) => !cmd.todo && (!cmd.enabled || cmd.enabled());
export function execute(id) {
  const c = commands.get(id);
  if (!c || !isEnabled(c)) return false;
  c.run();
  return true;
}
export function setShortcut(id, keys) { update({ shortcuts: { ...state.shortcuts, [id]: keys } }); rebuild(); }
export function resetShortcuts() { update({ shortcuts: {} }); rebuild(); }

export const prettyKey = (k) => k.replace(/Ctrl/g, modLabel).replace(/Alt/g, isMac ? '⌥' : 'Alt').replace(/Shift/g, isMac ? '⇧' : 'Shift').replace(/\+/g, isMac ? '' : '+');

// "Ctrl+Shift+Z" form: Ctrl means Ctrl or Cmd. Punctuation uses the physical key so Shift does not change it.
const CODE_CHARS = { Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backslash: '\\', Comma: ',', Period: '.', Slash: '/' };
export function eventCombo(e) {
  let key = CODE_CHARS[e.code] ?? (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (e.altKey && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);   // macOS Alt makes e.key a symbol
  if (key === ' ') key = 'Space';
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
  const mods = [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
  if (key.length === 1) key = key.toUpperCase();
  return [...mods, key].join('+');
}

let table = new Map();
export function rebuild() {
  table = new Map();
  for (const c of commands.values()) for (const k of keysOf(c)) {
    table.set(k, c);
    if (/^[A-Z]$/.test(k)) table.set('Shift+' + k, c);        // tool letters also work with Shift held
    if (k === 'Ctrl+=') table.set('Ctrl+Shift+=', c);          // Ctrl and plus
  }
}
export function findByEvent(e) { const combo = eventCombo(e); return combo ? table.get(combo) : undefined; }
export function conflicts() {
  const seen = new Map(), out = [];
  for (const c of commands.values()) for (const k of keysOf(c)) { if (seen.has(k) && seen.get(k) !== c) out.push([k, seen.get(k), c]); else seen.set(k, c); }
  return out;
}
