import { el } from './dom.js';

// A context/popup menu at a screen position. items: { label, run, disabled, checked, key } | '-' | { label, items } (submenu).
let open = [];
export function closePopups() { open.forEach((m) => m.remove()); open = []; }
export function popup(items, x, y, depth = 0) {
  while (open.length > depth) open.pop().remove();
  const menu = el('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === '-') { menu.append(el('hr')); continue; }
    if (it.items) {
      const row = el('div', { class: 'item' }, el('span', { class: 'tick' }), it.label, el('span', { class: 'key' }, '▸'));
      const show = () => { const r = row.getBoundingClientRect(); popup(it.items, r.right - 4, r.top, depth + 1); };
      row.addEventListener('pointerenter', show); row.addEventListener('pointerup', show);
      menu.append(row); continue;
    }
    const row = el('div', { class: 'item' + (it.disabled ? ' disabled' : ''), role: 'menuitem' }, el('span', { class: 'tick' }, it.checked ? '✓' : ''), it.label, el('span', { class: 'key' }, it.key || ''));
    row.addEventListener('pointerenter', () => { while (open.length > depth + 1) open.pop().remove(); });
    row.addEventListener('pointerup', (e) => { e.preventDefault(); if (it.disabled) return; closePopups(); it.run(); });
    menu.append(row);
  }
  document.body.append(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(4, Math.min(x, innerWidth - w - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, innerHeight - h - 4)) + 'px';
  open.push(menu);
  if (depth === 0) {
    const off = (e) => { if (!e.target.closest('.menu')) { closePopups(); document.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }
  return menu;
}
