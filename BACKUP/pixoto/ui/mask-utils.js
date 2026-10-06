/* ═══════════════════════════════════════════════════════════════
   Pixoto — Mask Utilities (Phase B)
   Context menu and helper functions for layer mask operations.
   ═══════════════════════════════════════════════════════════════ */

/**
 * Show a context menu for mask operations on the given layer.
 * @param {import('../canvas-engine.js').CanvasEngine} engine
 * @param {import('../canvas-engine.js').Layer} layer
 * @param {number} x - Screen X to anchor menu
 * @param {number} y - Screen Y to anchor menu
 * @param {import('../history.js').HistoryManager} [history]
 */
export function showMaskContextMenu(engine, layer, x, y, history = null) {
    // Remove any existing context menu
    dismissMaskContextMenu();

    const menu = document.createElement('div');
    menu.id = 'mask-context-menu';
    menu.className = 'context-menu';

    const items = layer.mask
        ? [
            { label: layer.maskEnabled ? 'Disable Mask' : 'Enable Mask', action: 'toggle-enabled' },
            { label: 'Apply Mask',  action: 'apply' },
            { label: 'Invert Mask', action: 'invert' },
            { divider: true },
            { label: 'Delete Mask', action: 'delete', danger: true },
          ]
        : [
            { label: 'Add Mask — Reveal All', action: 'add-white' },
            { label: 'Add Mask — Hide All',   action: 'add-black' },
          ];

    for (const item of items) {
        if (item.divider) {
            const div = document.createElement('div');
            div.className = 'context-menu-divider';
            menu.appendChild(div);
            continue;
        }
        const btn = document.createElement('button');
        btn.className = `context-menu-item${item.danger ? ' danger' : ''}`;
        btn.textContent = item.label;
        btn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            dismissMaskContextMenu();
            _handleMaskAction(engine, layer, item.action, history);
        });
        menu.appendChild(btn);
    }

    // Position menu, flip if it would go off-screen
    document.body.appendChild(menu);
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    menu.style.left = `${Math.min(x, vw - mw - 8)}px`;
    menu.style.top  = `${Math.min(y, vh - mh - 8)}px`;

    // Dismiss on outside click
    const dismiss = (e) => {
        if (!menu.contains(e.target)) {
            dismissMaskContextMenu();
            document.removeEventListener('pointerdown', dismiss, true);
        }
    };
    setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
}

export function dismissMaskContextMenu() {
    document.getElementById('mask-context-menu')?.remove();
}

function _handleMaskAction(engine, layer, action, history) {
    const idx = engine.layers.indexOf(layer);
    if (idx < 0) return;

    switch (action) {
        case 'add-white':
            if (history) history.saveSnapshot('Add Mask');
            engine.addMaskToLayer(idx, true);
            break;
        case 'add-black':
            if (history) history.saveSnapshot('Add Mask');
            engine.addMaskToLayer(idx, false);
            break;
        case 'apply':
            if (history) history.saveSnapshot('Apply Mask');
            engine.applyMaskToLayer(idx);
            break;
        case 'invert':
            if (history) history.saveSnapshot('Invert Mask');
            engine.invertMaskOnLayer(idx);
            break;
        case 'toggle-enabled':
            engine.toggleMaskEnabled(idx);
            break;
        case 'delete':
            if (history) history.saveSnapshot('Delete Mask');
            engine.removeMaskFromLayer(idx);
            break;
    }
}
