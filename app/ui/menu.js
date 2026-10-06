import { el } from './dom.js';
import { commands, isEnabled, keysOf, prettyKey, execute, labelOf } from '../core/commands.js';

// Menu bar. Items are command ids, '-' separators, or { label, items } submenus.
export class MenuBar {
  constructor(root, structure) {
    this.root = root; this.structure = structure; this.stack = []; this.openTop = null;
    for (const top of structure) {
      const b = el('button', { class: 'top', onPointerdown: (e) => { e.preventDefault(); e.stopPropagation(); this.openTop === b ? this.closeAll() : this.open(b, top); }, onPointerenter: () => { if (this.openTop && this.openTop !== b) this.open(b, top); } }, top.label);
      root.append(b);
    }
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu') && !e.target.closest('.top')) this.closeAll(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.stack.length) this.closeAll(); }, true);
    window.addEventListener('blur', () => this.closeAll());
  }
  closeAll() { this.stack.forEach((m) => m.remove()); this.stack = []; this.openTop?.classList.remove('open'); this.openTop = null; }
  closeFrom(depth) { while (this.stack.length > depth) this.stack.pop().remove(); }
  open(button, top) {
    this.closeAll();
    this.openTop = button; button.classList.add('open');
    const r = button.getBoundingClientRect();
    this.show(top.items, r.left, r.bottom, 0);
  }
  show(items, x, y, depth) {
    this.closeFrom(depth);
    const menu = el('div', { class: 'menu', role: 'menu' });
    for (const it of items) {
      if (it === '-') { menu.append(el('hr')); continue; }
      if (typeof it === 'object' && it.run) {
        const row = el('div', { class: 'item' + (it.disabled ? ' disabled' : '') }, el('span', { class: 'tick' }), it.label, el('span', { class: 'key' }, ''));
        row.addEventListener('pointerenter', () => this.closeFrom(depth + 1));
        row.addEventListener('pointerup', (e) => { e.preventDefault(); if (it.disabled) return; this.closeAll(); it.run(); });
        menu.append(row); continue;
      }
      if (typeof it === 'object') {
        const row = el('div', { class: 'item' }, el('span', { class: 'tick' }), it.label, el('span', { class: 'key' }, '▸'));
        const openSub = () => { const rr = row.getBoundingClientRect(); this.show(typeof it.items === 'function' ? it.items() : it.items, rr.right - 4, rr.top, depth + 1); };
        row.addEventListener('pointerenter', openSub); row.addEventListener('pointerup', openSub);
        menu.append(row); continue;
      }
      const c = commands.get(it); if (!c) continue;
      const on = isEnabled(c), checked = c.checked?.();
      const keys = keysOf(c);
      const row = el('div', { class: 'item' + (on ? '' : ' disabled'), role: 'menuitem' },
        el('span', { class: 'tick' }, checked ? '✓' : ''), labelOf(c), el('span', { class: 'key' }, keys[0] ? prettyKey(keys[0]) : ''));
      row.addEventListener('pointerenter', () => this.closeFrom(depth + 1));
      row.addEventListener('pointerup', (e) => { e.preventDefault(); if (!on) return; this.closeAll(); execute(it); });
      menu.append(row);
    }
    document.body.append(menu);
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x, innerWidth - w - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, innerHeight - h - 4)) + 'px';
    this.stack.push(menu);
  }
}
