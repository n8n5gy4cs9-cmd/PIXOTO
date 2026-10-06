import { el, icon, iconBtn } from './dom.js';

// Document tabs (name, unsaved dot, close) plus the fit / 100% / zoom controls on the right.
export class Tabs {
  constructor(root, app) {
    this.app = app;
    this.list = el('div', { id: 'tablist', role: 'tablist' });
    this.zoomText = el('span', { class: 'txt' }, '');
    root.append(
      el('button', { id: 'layers-toggle', class: 'iconbtn', title: 'Layers', 'aria-label': 'Layers', onClick: () => document.body.classList.toggle('layers-open') }, icon('layers')),
      this.list, iconBtn('plus', 'New canvas (Ctrl+N)', () => app.newCanvas()), el('div', { class: 'grow' }),
      el('div', { class: 'zoomctl' },
        iconBtn('fit', 'Fit canvas (Ctrl+0)', () => app.view.fit()),
        el('button', { class: 'iconbtn', title: 'Actual pixels (Ctrl+1)', onClick: () => app.view.zoomTo(1) }, '100%'),
        iconBtn('zoom-out', 'Zoom out (Ctrl+−)', () => app.view.zoomOut()), this.zoomText, iconBtn('zoom-in', 'Zoom in (Ctrl++)', () => app.view.zoomIn())));
  }
  refresh() {
    const app = this.app;
    this.list.replaceChildren(...app.docs.map((d) => {
      const tab = el('div', { class: 'tab' + (d === app.doc ? ' on' : ''), role: 'tab', title: d.name, onPointerdown: (e) => { if (e.button === 1) { e.preventDefault(); app.closeDoc(d); } else if (!e.target.closest('.x')) app.switchDoc(d); } },
        d.modified ? el('span', { class: 'dot', title: 'Unsaved changes' }) : null, el('span', { class: 'name' }, d.name),
        el('button', { class: 'x', title: 'Close', 'aria-label': 'Close ' + d.name, onClick: (e) => { e.stopPropagation(); app.closeDoc(d); } }, icon('close')));
      return tab;
    }));
    this.list.querySelector('.tab.on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  setZoom(z) { this.zoomText.textContent = z == null ? '' : (z >= 0.1 ? +(z * 100).toFixed(1) : +(z * 100).toFixed(2)) + '%'; }
}
