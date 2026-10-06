import { el, icon, iconBtn } from './dom.js';
import { TOOLS, toolIcon } from '../core/tools.js';
import { state, update } from '../core/state.js';
import { keysOf, commands, prettyKey } from '../core/commands.js';
import { pickColor } from './color-picker.js';

// Left tool rail (Composa BuildToolRail): the tools, then foreground/background swatches and the swap button.
export class Toolbar {
  constructor(root, app) {
    this.app = app; this.buttons = new Map();
    for (const t of TOOLS) {
      const b = el('button', { class: 'toolbtn', 'aria-label': t.name, onClick: () => app.selectTool(t.id) });
      this.buttons.set(t.id, b); root.append(b);
    }
    const mk = (cls, which) => {
      const label = which === 'fg' ? 'Foreground color' : 'Background color';
      const b = el('button', { class: 'sw ' + cls, 'aria-label': label, title: label, onClick: async () => { const initial = state[which]; const v = await pickColor(label, initial, (c) => update({ [which]: c })); if (v) update({ [which]: v }); } });
      return { b };
    };
    this.fg = mk('fg', 'fg'); this.bg = mk('bg', 'bg');
    root.append(el('div', { class: 'swatches' }, this.bg.b, this.fg.b),
      el('button', { id: 'swap', title: 'Swap colors (X) · D resets to black and white', 'aria-label': 'Swap colors', onClick: () => app.swapColors() }, icon('swap')));
    this.refresh();
  }
  refresh() {
    for (const t of TOOLS) {
      const b = this.buttons.get(t.id);
      b.replaceChildren(icon(toolIcon(t, state.modes[t.id] ?? 0)));
      b.classList.toggle('on', state.tool === t.id);
      const cmd = commands.get('tool.' + t.id), key = cmd && keysOf(cmd)[0];
      b.title = `${t.name}${key ? ' (' + prettyKey(key) + ')' : ''}`;
    }
    this.fg.b.style.background = state.fg;
    this.bg.b.style.background = state.bg;
  }
}
