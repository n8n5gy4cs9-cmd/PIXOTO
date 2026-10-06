/* ═══════════════════════════════════════════════════════════════
   Pixoto — App Bootstrap
   UI interactivity, tool switching, engine integration.
   ═══════════════════════════════════════════════════════════════ */

import { CanvasEngine } from './canvas-engine.js';
import { PixelEngine } from './pixel-engine.js';
import { ToolManager } from './tool-manager.js';
import { BrushTool } from './tools/brush.js';
import { EraserTool } from './tools/eraser.js';
import { FillTool } from './tools/fill.js';
import { EyedropperTool } from './tools/eyedropper.js';
import { SelectionManager, RectSelectTool, LassoTool, MagicWandTool, EllipseSelectTool } from './tools/selection.js';
import { CropTool } from './tools/crop.js';
import { PixelateBrushTool, RectPixelateTool, PixelSortTool } from './tools/pixelate.js';
import { TransformTool } from './tools/transform.js';
import { TextTool } from './tools/text.js';
import { SmudgeTool } from './tools/smudge.js';
import { DodgeTool, BurnTool } from './tools/dodge-burn.js';
import { CloneStampTool } from './tools/clone-stamp.js';
import { ShapeTool } from './tools/shapes.js';
import { GradientTool } from './tools/gradient.js';
import { GradientEditor } from './ui/gradient-editor.js';
import { FilterDialog } from './ui/filter-dialog.js';
import { LayerStylesDialog } from './ui/layer-styles-dialog.js';
import { AnimationManager } from './animation.js';
import { Timeline } from './ui/timeline.js';
import { ExportAnimation } from './ui/export-animation.js';
import { RulerGuides } from './ui/guides.js';
import { HistoryManager } from './history.js';
import { FileManager } from './file-manager.js';
import { LayersPanel } from './ui/layers-panel.js';
import { ColorPicker } from './ui/color-picker.js';

// ─── Global App State ───
const Pixoto = {
    version: '1.0.0',
    mode: 'photo',       // 'photo' or 'pixel'
    activeTool: 'brush',
    foregroundColor: '#ffffff',
    backgroundColor: '#000000',
    zoom: 100,
    canvas: { width: 800, height: 600 },
    gridVisible: false,
    rulersVisible: false,
    engine: null,         // CanvasEngine instance (Phase 2)
    pixelEngine: null,    // PixelEngine instance (Phase 3)
    toolManager: null,    // ToolManager instance (Phase 4)
    selectionManager: null, // SelectionManager instance (Phase 5)
    historyManager: null,   // HistoryManager instance (Phase 7)
    fileManager: null,      // FileManager instance (Phase 7)
    layersPanel: null,      // LayersPanel instance (Phase 6)
    colorPicker: null,      // ColorPicker instance (Phase 6)
    clipboard: null,        // Internal clipboard for copy/paste { imageData, width, height }
    ui: {
        hamburgerOpen: false,
        layersDrawerOpen: false,
        toolDrawerOpen: false,
    }
};

// Make available globally for debugging
window.Pixoto = Pixoto;


// ═══════════════════════════════════════════════════════════════
// SERVICE WORKER REGISTRATION
// ═══════════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then((reg) => {
                console.log('[Pixoto] Service Worker registered:', reg.scope);
            })
            .catch((err) => {
                console.warn('[Pixoto] Service Worker registration failed:', err);
            });
    });
}


// ═══════════════════════════════════════════════════════════════
// PWA INSTALL PROMPT
// ═══════════════════════════════════════════════════════════════
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;

    // Show install banner if not previously dismissed
    if (!localStorage.getItem('pixoto-install-dismissed')) {
        const banner = document.getElementById('install-banner');
        if (banner) banner.hidden = false;
    }
});

document.getElementById('install-accept')?.addEventListener('click', () => {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(() => {
            deferredInstallPrompt = null;
            document.getElementById('install-banner').hidden = true;
        });
    }
});

document.getElementById('install-dismiss')?.addEventListener('click', () => {
    document.getElementById('install-banner').hidden = true;
    localStorage.setItem('pixoto-install-dismissed', 'true');
});


// ═══════════════════════════════════════════════════════════════
// DOM REFERENCES
// ═══════════════════════════════════════════════════════════════
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {
    topBar: $('#top-bar'),
    workspace: $('#workspace'),
    toolSidebar: $('#tool-sidebar'),
    canvasViewport: $('#canvas-viewport'),
    canvasWrapper: $('#canvas-wrapper'),
    mainCanvas: $('#main-canvas'),
    gridCanvas: $('#grid-canvas'),
    uiCanvas: $('#ui-canvas'),
    rightPanel: $('#right-panel'),
    bottomToolbar: $('#bottom-toolbar'),
    statusBar: $('#status-bar'),
    zoomDisplay: $('#zoom-level'),
    canvasSize: $('#canvas-size'),
    cursorPos: $('#cursor-pos'),
    statusSwatch: $('#status-swatch'),
    statusColorHex: $('#status-color-hex'),
    modeToggle: $('#mode-toggle'),
    modeLabel: $('.mode-label'),

    // Drawers & menus
    toolDrawer: $('#tool-drawer'),
    layersDrawer: $('#layers-drawer'),
    hamburgerMenu: $('#hamburger-menu'),
    drawerBackdrop: $('#drawer-backdrop'),
    menuBackdrop: $('#menu-backdrop'),

    // Modals
    colorPickerModal: $('#color-picker-modal'),
    newCanvasDialog: $('#new-canvas-dialog'),
    exportDialog: $('#export-dialog'),
};


// ═══════════════════════════════════════════════════════════════
// TOOL SELECTION
// ═══════════════════════════════════════════════════════════════
function setActiveTool(toolName) {
    Pixoto.activeTool = toolName;

    // Update sidebar buttons
    $$('#tool-sidebar .tool-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tool === toolName);
    });

    // Update bottom toolbar buttons
    $$('#bottom-toolbar .tool-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tool === toolName);
    });

    // Ripple effect
    const activeBtn = $(`[data-tool="${toolName}"]`);
    if (activeBtn) {
        activeBtn.classList.add('ripple');
        setTimeout(() => activeBtn.classList.remove('ripple'), 300);
    }

    // Update drawer tool name
    const drawerToolName = $('#drawer-tool-name');
    if (drawerToolName) {
        const names = {
            'brush': 'Brush', 'eraser': 'Eraser', 'fill': 'Fill Bucket',
            'select-rect': 'Rectangle Select', 'select-ellipse': 'Ellipse Select', 'lasso': 'Lasso', 'magic-wand': 'Magic Wand', 'crop': 'Crop',            'move': 'Move', 'transform': 'Free Transform', 'pixel-pen': 'Pixel Pen', 'pixel-line': 'Pixel Line',
            'pixel-rect': 'Pixel Rectangle', 'pixel-ellipse': 'Pixel Ellipse',
            'shape-rect': 'Rectangle', 'shape-rounded-rect': 'Rounded Rectangle', 'shape-ellipse': 'Ellipse',
            'shape-line': 'Line', 'shape-polygon': 'Polygon', 'gradient': 'Gradient',
            'eyedropper': 'Eyedropper', 'pixelate': 'Pixelate',
            'text': 'Text', 'smudge': 'Smudge', 'dodge': 'Dodge', 'burn': 'Burn', 'clone-stamp': 'Clone Stamp'
        };
        drawerToolName.textContent = names[toolName] || toolName;
    }

    // Switch tool in tool manager
    if (Pixoto.toolManager) {
        // Map pixel-pen to brush in pixel mode
        let tmName = toolName === 'pixel-pen' ? 'brush' : toolName;
        // Map generic 'pixelate' to the active pixelate sub-tool
        if (tmName === 'pixelate') tmName = Pixoto._pixelateMode || 'pixelate-brush';
        // P2 — the legacy pixel-shape buttons drive the shape tools in pixel-perfect mode
        const pixelShapeMap = { 'pixel-rect': 'shape-rect', 'pixel-line': 'shape-line', 'pixel-ellipse': 'shape-ellipse' };
        if (pixelShapeMap[toolName]) {
            tmName = pixelShapeMap[toolName];
            const st = Pixoto.toolManager.getTool(tmName);
            if (st) st.pixelPerfect = true;
        } else if (toolName.startsWith('shape-')) {
            const st = Pixoto.toolManager.getTool(toolName);
            if (st) st.pixelPerfect = $('#shape-pixel')?.checked ? true : null;
        }
        Pixoto.toolManager.switchTool(tmName);

        // If pixel-pen, force pixel brush mode
        if (toolName === 'pixel-pen') {
            Pixoto.toolManager.setBrushMode('pixel');
            updateBrushModeButtons('pixel');
        }
    }

    // Show/hide tool option groups
    showToolOptions(toolName);

    // If mobile drawer is open, re-populate with new tool options
    if (Pixoto.ui.toolDrawerOpen) {
        _populateMobileToolOptions();
    }

    console.log(`[Pixoto] Tool: ${toolName}`);
}

/**
 * Show/hide tool option panels based on active tool.
 * Maps tool names to their option group data-for value.
 */
function showToolOptions(toolName) {
    // Map tool names to option group names
    const optionMap = {
        'brush': 'brush',
        'pixel-pen': 'brush',    // Pixel pen reuses brush panel
        'eraser': 'eraser',
        'fill': 'fill',
        'eyedropper': 'eyedropper',
        'select-rect': 'select-rect',
        'lasso': 'lasso',
        'magic-wand': 'magic-wand',
        'crop': 'crop',
        'transform': 'transform',
        'pixelate': 'pixelate',
        'pixelate-brush': 'pixelate',
        'pixelate-rect': 'pixelate',
        'pixel-sort': 'pixelate',
        'text': 'text',
        'smudge': 'smudge',
        'dodge': 'dodge',
        'burn': 'burn',
        'clone-stamp': 'clone-stamp',
        'shape-rect': 'shape',
        'shape-rounded-rect': 'shape',
        'shape-ellipse': 'shape',
        'shape-line': 'shape',
        'shape-polygon': 'shape',
        'pixel-rect': 'shape',
        'pixel-line': 'shape',
        'pixel-ellipse': 'shape',
        'gradient': 'gradient',
    };

    const target = optionMap[toolName] || null;

    $$('.tool-option-group').forEach((group) => {
        const forTool = group.dataset.for;
        group.hidden = (forTool !== target);
    });
}

/**
 * Update brush mode button active states.
 */
function updateBrushModeButtons(mode) {
    $$('[data-brush-mode]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.brushMode === mode);
    });
    $$('[data-eraser-mode]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.eraserMode === mode);
    });
}

// Sidebar tool clicks
$$('#tool-sidebar .tool-btn').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        setActiveTool(btn.dataset.tool);
    });
});

// Bottom toolbar tool clicks
$$('#bottom-toolbar .tool-btn').forEach((btn) => {
    if (btn.dataset.tool) {
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            const isSameTool = btn.dataset.tool === Pixoto.activeTool;
            setActiveTool(btn.dataset.tool);
            // Toggle drawer: tap same tool again to close, new tool to open
            if (isSameTool && Pixoto.ui.toolDrawerOpen) {
                closeToolDrawer();
            } else {
                openToolDrawer();
            }
        });
    }
});


// ═══════════════════════════════════════════════════════════════
// MODE TOGGLE (Photo / Pixel Art)
// ═══════════════════════════════════════════════════════════════
DOM.modeToggle?.addEventListener('click', () => {
    toggleMode();
});

function toggleMode() {
    if (Pixoto.mode === 'photo') {
        Pixoto.mode = 'pixel';
        document.body.classList.add('pixel-art-mode');
        DOM.modeLabel.textContent = 'Pixel';
    } else {
        Pixoto.mode = 'photo';
        document.body.classList.remove('pixel-art-mode');
        DOM.modeLabel.textContent = 'Photo';
    }
    if (Pixoto.engine) Pixoto.engine.setPixelArtMode(Pixoto.mode === 'pixel');
    updatePixelModeIndicator();
    console.log(`[Pixoto] Mode: ${Pixoto.mode}`);
}


// ═══════════════════════════════════════════════════════════════
// MOBILE DRAWERS
// ═══════════════════════════════════════════════════════════════

// ─── Tool Options Drawer (bottom sheet) ───
function openToolDrawer() {
    if (!DOM.toolDrawer) return;
    _populateMobileToolOptions();
    DOM.toolDrawer.hidden = false;
    requestAnimationFrame(() => {
        DOM.toolDrawer.classList.add('open');
    });
    Pixoto.ui.toolDrawerOpen = true;
}

function closeToolDrawer() {
    if (!DOM.toolDrawer) return;
    DOM.toolDrawer.classList.remove('open');
    setTimeout(() => {
        if (!Pixoto.ui.toolDrawerOpen) {
            DOM.toolDrawer.hidden = true;
            _returnMobileToolOptions();
        }
    }, 300);
    Pixoto.ui.toolDrawerOpen = false;
}

/**
 * Move the active tool's option group AND the color section into the mobile drawer.
 * We move the actual DOM nodes (not clone) so all event bindings stay intact.
 */
function _populateMobileToolOptions() {
    const container = $('#mobile-tool-options');
    if (!container) return;

    // Return any previously moved group first
    _returnMobileToolOptions();

    // Find the currently visible (not hidden) option group
    const activeGroup = $('#tool-options-content .tool-option-group:not([hidden])');
    if (activeGroup) {
        container.appendChild(activeGroup);
    }

    // Also move the color section so mobile users can pick colors
    const colorSection = $('#color-section');
    if (colorSection) {
        container.appendChild(colorSection);
    }
}

/**
 * Return any option group and color section in the mobile drawer back to the desktop panel.
 */
function _returnMobileToolOptions() {
    const container = $('#mobile-tool-options');
    const desktopContainer = $('#tool-options-content');
    if (!container || !desktopContainer) return;

    const movedGroup = container.querySelector('.tool-option-group');
    if (movedGroup) {
        desktopContainer.appendChild(movedGroup);
    }

    // Return color section to the right panel
    const colorSection = container.querySelector('#color-section');
    const rightPanel = $('#right-panel');
    if (colorSection && rightPanel) {
        rightPanel.appendChild(colorSection);
    }
}

$('#btn-close-drawer')?.addEventListener('click', closeToolDrawer);

// Undo / Redo button click handlers
$('#btn-undo')?.addEventListener('click', () => performUndo());
$('#btn-redo')?.addEventListener('click', () => performRedo());

// ─── Layers Drawer (slide from right) ───
function openLayersDrawer() {
    if (!DOM.layersDrawer) return;
    DOM.drawerBackdrop.hidden = false;
    DOM.layersDrawer.classList.add('open');
    DOM.drawerBackdrop.classList.add('visible');
    Pixoto.ui.layersDrawerOpen = true;
}

function closeLayersDrawer() {
    if (!DOM.layersDrawer) return;
    DOM.layersDrawer.classList.remove('open');
    if (!Pixoto.ui.hamburgerOpen) {
        DOM.drawerBackdrop.classList.remove('visible');
        setTimeout(() => {
            if (!Pixoto.ui.hamburgerOpen && !Pixoto.ui.layersDrawerOpen) {
                DOM.drawerBackdrop.hidden = true;
            }
        }, 300);
    }
    Pixoto.ui.layersDrawerOpen = false;
}

$('#btn-layers-toggle')?.addEventListener('click', openLayersDrawer);
$('#btn-close-layers-drawer')?.addEventListener('click', closeLayersDrawer);


// ─── Hamburger Menu (slide from left) ───
function openHamburger() {
    if (!DOM.hamburgerMenu) return;
    DOM.drawerBackdrop.hidden = false;
    DOM.hamburgerMenu.classList.add('open');
    DOM.drawerBackdrop.classList.add('visible');
    Pixoto.ui.hamburgerOpen = true;
}

function closeHamburger() {
    if (!DOM.hamburgerMenu) return;
    DOM.hamburgerMenu.classList.remove('open');
    if (!Pixoto.ui.layersDrawerOpen) {
        DOM.drawerBackdrop.classList.remove('visible');
        setTimeout(() => {
            if (!Pixoto.ui.hamburgerOpen && !Pixoto.ui.layersDrawerOpen) {
                DOM.drawerBackdrop.hidden = true;
            }
        }, 300);
    }
    Pixoto.ui.hamburgerOpen = false;
}

$('#btn-hamburger')?.addEventListener('click', openHamburger);
$('#btn-close-hamburger')?.addEventListener('click', closeHamburger);

// Backdrop closes any open drawer
DOM.drawerBackdrop?.addEventListener('click', () => {
    if (Pixoto.ui.hamburgerOpen) closeHamburger();
    if (Pixoto.ui.layersDrawerOpen) closeLayersDrawer();
});


// ═══════════════════════════════════════════════════════════════
// DESKTOP DROPDOWN MENUS
// ═══════════════════════════════════════════════════════════════
let openMenu = null;

$$('.menu-trigger').forEach((trigger) => {
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const menuName = trigger.dataset.menu;
        const dropdown = $(`#dropdown-${menuName}`);
        if (!dropdown) return;

        if (openMenu === dropdown) {
            closeDropdowns();
            return;
        }

        closeDropdowns();

        // Position dropdown below the trigger
        const rect = trigger.getBoundingClientRect();
        dropdown.style.left = `${rect.left}px`;
        dropdown.hidden = false;
        DOM.menuBackdrop.hidden = false;
        trigger.classList.add('open');
        openMenu = dropdown;
    });

    // Hover to switch between open menus
    trigger.addEventListener('pointerenter', () => {
        if (!openMenu) return;
        const menuName = trigger.dataset.menu;
        const dropdown = $(`#dropdown-${menuName}`);
        if (!dropdown || dropdown === openMenu) return;

        closeDropdowns();
        const rect = trigger.getBoundingClientRect();
        dropdown.style.left = `${rect.left}px`;
        dropdown.hidden = false;
        DOM.menuBackdrop.hidden = false;
        trigger.classList.add('open');
        openMenu = dropdown;
    });
});

DOM.menuBackdrop?.addEventListener('click', closeDropdowns);

function closeDropdowns() {
    $$('.dropdown-menu').forEach((d) => (d.hidden = true));
    $$('.menu-trigger').forEach((t) => t.classList.remove('open'));
    if (DOM.menuBackdrop) DOM.menuBackdrop.hidden = true;
    openMenu = null;
}


// ─── Dropdown menu item actions ───
$$('.dropdown-item').forEach((item) => {
    item.addEventListener('click', () => {
        const action = item.dataset.action;
        handleMenuAction(action);
        closeDropdowns();
    });
});

// ─── Mobile menu actions ───
$$('.menu-action').forEach((item) => {
    item.addEventListener('click', () => {
        const action = item.dataset.action;
        handleMenuAction(action);
        closeHamburger();
    });
});

function handleMenuAction(action) {
    switch (action) {
        case 'new':
            openModal(DOM.newCanvasDialog);
            break;
        case 'open':
            Pixoto._fileOpenMode = 'open';
            document.getElementById('file-input')?.click();
            break;
        case 'place-image':
            Pixoto._fileOpenMode = 'place';
            document.getElementById('file-input')?.click();
            break;
        case 'restore-session':
            if (Pixoto.fileManager) {
                Pixoto.fileManager.restoreSession().then((ok) => {
                    if (ok && DOM.canvasSize && Pixoto.engine) {
                        DOM.canvasSize.textContent = `${Pixoto.engine.docWidth} × ${Pixoto.engine.docHeight}`;
                    }
                });
            }
            break;
        case 'save-project':
            if (Pixoto.fileManager) Pixoto.fileManager.saveProject();
            break;
        case 'load-project':
            Pixoto._fileOpenMode = 'open';
            document.getElementById('file-input')?.click();
            break;
        case 'export-png':
        case 'export-jpg':
        case 'export-webp':
            openModal(DOM.exportDialog);
            break;
        case 'undo':
            performUndo();
            break;
        case 'redo':
            performRedo();
            break;
        case 'cut':
            performCut();
            break;
        case 'copy':
            performCopy();
            break;
        case 'paste':
            performPaste();
            break;
        case 'delete':
            performDelete();
            break;
        case 'select-all':
            if (Pixoto.selectionManager) Pixoto.selectionManager.selectAll();
            break;
        case 'deselect':
            if (Pixoto.selectionManager) Pixoto.selectionManager.deselect();
            break;
        case 'crop-to-selection':
            performCropToSelection();
            break;
        case 'select-inverse':
            if (Pixoto.selectionManager) Pixoto.selectionManager.invert();
            break;
        case 'sel-grow':
            openAmountModal('Grow Selection', 4, (n) => Pixoto.selectionManager?.grow(n));
            break;
        case 'sel-shrink':
            openAmountModal('Shrink Selection', 4, (n) => Pixoto.selectionManager?.shrink(n));
            break;
        case 'sel-feather':
            openAmountModal('Feather Selection', 4, (n) => Pixoto.selectionManager?.feather(n));
            break;
        case 'sel-border':
            openAmountModal('Border Selection', 4, (n) => Pixoto.selectionManager?.border(n));
            break;
        case 'sel-smooth':
            openAmountModal('Smooth Selection', 2, (n) => Pixoto.selectionManager?.smooth(n));
            break;
        case 'sel-save':
            if (Pixoto.selectionManager) Pixoto.selectionManager.saveSelection();
            break;
        case 'sel-load':
            if (Pixoto.selectionManager) Pixoto.selectionManager.loadSelection();
            break;
        case 'transform-selection':
            setActiveTool('transform');
            break;
        case 'add-layer':
            if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Add Layer');
            if (Pixoto.engine) Pixoto.engine.addLayer();
            break;
        case 'duplicate-layer':
            if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Duplicate Layer');
            if (Pixoto.engine) Pixoto.engine.duplicateLayer();
            break;
        case 'delete-layer':
            if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Delete Layer');
            if (Pixoto.engine) Pixoto.engine.deleteLayer();
            break;
        case 'add-mask-white':
            if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Add Mask');
            if (Pixoto.engine) Pixoto.engine.addMaskToLayer(null, true);
            break;
        case 'add-mask-black':
            if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Add Mask');
            if (Pixoto.engine) Pixoto.engine.addMaskToLayer(null, false);
            break;
        case 'apply-mask':
            if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Apply Mask');
            if (Pixoto.engine) Pixoto.engine.applyMaskToLayer();
            break;
        case 'delete-mask':
            if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Delete Mask');
            if (Pixoto.engine) Pixoto.engine.removeMaskFromLayer();
            break;
        case 'invert-mask':
            if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Invert Mask');
            if (Pixoto.engine) Pixoto.engine.invertMaskOnLayer();
            break;
        case 'toggle-alpha-lock':
            if (Pixoto.engine) Pixoto.engine.toggleAlphaLock();
            break;
        case 'toggle-clip-to-below':
            if (Pixoto.engine) Pixoto.engine.toggleClipToBelow();
            break;
        case 'layer-styles':
            if (Pixoto.layerStylesDialog && Pixoto.engine) {
                Pixoto.layerStylesDialog.open(Pixoto.engine.getActiveLayerReal());
            }
            break;
        case 'create-group':
            if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Create Group');
            if (Pixoto.engine) Pixoto.engine.createGroup();
            break;
        case 'merge-down':
            if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Merge Down');
            if (Pixoto.engine) Pixoto.engine.mergeDown();
            break;
        case 'merge-visible':
            if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Merge Visible');
            if (Pixoto.engine) Pixoto.engine.mergeVisible();
            break;
        case 'flatten':
            if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Flatten');
            if (Pixoto.engine) Pixoto.engine.flattenAll();
            break;
        case 'toggle-pixel-mode':
            toggleMode();
            break;
        case 'toggle-grid':
            if (Pixoto.pixelEngine) {
                Pixoto.pixelEngine.setGridVisible();
                Pixoto.gridVisible = Pixoto.pixelEngine.gridVisible;
            } else {
                Pixoto.gridVisible = !Pixoto.gridVisible;
            }
            updateGridIndicator();
            break;
        case 'toggle-rulers':
            Pixoto.rulersVisible = !Pixoto.rulersVisible;
            document.body.classList.toggle('rulers-visible', Pixoto.rulersVisible);
            updateRulerIndicator();
            requestAnimationFrame(() => {
                if (Pixoto.engine) Pixoto.engine.onResize();
                if (Pixoto.rulerGuides) Pixoto.rulerGuides.redraw();
            });
            break;
        case 'guides-clear':
            if (Pixoto.engine) Pixoto.engine.clearGuides();
            if (Pixoto.rulerGuides) Pixoto.rulerGuides.redraw();
            break;
        case 'reset-rotation':
            if (Pixoto.engine) Pixoto.engine.resetViewRotation();
            break;
        case 'reference-import':
            importReferenceImage();
            break;
        case 'reference-clear':
            if (Pixoto.engine) Pixoto.engine.clearReference();
            { const rp = $('#reference-panel'); if (rp) rp.hidden = true; }
            break;
        case 'fit-screen':
            if (Pixoto.engine) Pixoto.engine.fitToScreen();
            break;
        case 'zoom-100':
            if (Pixoto.engine) Pixoto.engine.setZoom100();
            break;
        case 'zoom-200':
            if (Pixoto.engine) Pixoto.engine.setZoom200();
            break;
        case 'resize-image':
            openResizeImageModal();
            break;
        case 'resize-canvas':
            openResizeCanvasModal();
            break;
        case 'rotate-cw':       _imageOp('Rotate 90° CW',  (en) => en.rotate90('cw')); break;
        case 'rotate-ccw':      _imageOp('Rotate 90° CCW', (en) => en.rotate90('ccw')); break;
        case 'rotate-180':      _imageOp('Rotate 180°',    (en) => en.rotate180()); break;
        case 'rotate-arbitrary': openRotateModal(); break;
        case 'flip-h':          _imageOp('Flip Horizontal', (en) => en.flipHorizontal()); break;
        case 'flip-v':          _imageOp('Flip Vertical',   (en) => en.flipVertical()); break;
        case 'trim':            _imageOp('Trim',            (en) => en.trim()); break;
        case 'crop-content':    _imageOp('Crop to Content', (en) => en.trim()); break;
        case 'toggle-guides':
            console.log('[Pixoto] Guides — not yet implemented');
            break;
        case 'toggle-animation':
            if (Pixoto.timeline) Pixoto.timeline.toggle();
            break;
        // ── Destructive filters ──
        case 'filter-gaussian-blur':
        case 'filter-sharpen':
        case 'filter-unsharp-mask':
        case 'filter-invert':
        case 'filter-grayscale':
        case 'filter-sepia':
        case 'filter-posterize':
        case 'filter-noise':
        case 'filter-outline':
        // ── Adjustment layers ──
        case 'adj-brightness-contrast':
        case 'adj-hue-saturation':
        case 'adj-levels':
        case 'adj-curves':
        case 'adj-color-balance':
        case 'adj-vibrance':
        case 'adj-gradient-map':
        case 'adj-threshold':
            if (Pixoto.filterDialog) Pixoto.filterDialog.open(action);
            break;
        case 'about':
            openModal($('#about-modal'));
            break;
        case 'clear-app-data':
            openModal($('#clear-data-modal'));
            break;
        default:
            console.log(`[Pixoto] Action: ${action}`);
    }
}

function updateGridIndicator() {
    const ind = $('#grid-indicator');
    if (ind) ind.classList.toggle('on', Pixoto.gridVisible);
    const dind = $('#desktop-grid-indicator');
    if (dind) dind.classList.toggle('on', Pixoto.gridVisible);
}

function _gridColorFromHex(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},0.8)`;
}
['#desktop-grid-color-input', '#mobile-grid-color-input'].forEach(sel => {
    $(sel)?.addEventListener('input', (e) => {
        if (Pixoto.pixelEngine) Pixoto.pixelEngine.setGridColor(_gridColorFromHex(e.target.value));
        // Sync both inputs
        const other = sel === '#desktop-grid-color-input' ? '#mobile-grid-color-input' : '#desktop-grid-color-input';
        const otherEl = $(other);
        if (otherEl) otherEl.value = e.target.value;
    });
});

function updateRulerIndicator() {
    const ind = $('#ruler-indicator');
    if (ind) ind.classList.toggle('on', Pixoto.rulersVisible);
    const dind = $('#desktop-ruler-indicator');
    if (dind) dind.classList.toggle('on', Pixoto.rulersVisible);
}

// ── P9: Reference layer + view-aid wiring ──
function importReferenceImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => { Pixoto.engine.setReferenceImage(img); showReferencePanel(); URL.revokeObjectURL(url); };
        img.onerror = () => { console.warn('[Pixoto] reference image failed to load'); URL.revokeObjectURL(url); };
        img.src = url;
    };
    input.click();
}

function showReferencePanel() {
    const panel = $('#reference-panel');
    if (!panel) return;
    panel.hidden = false;
    const ref = Pixoto.engine.referenceLayer;
    if (!ref) return;
    const op = $('#reference-opacity'); if (op) op.value = Math.round(ref.opacity * 100);
    const vis = $('#reference-visible'); if (vis) vis.checked = ref.visible;
    const below = $('#reference-below'); if (below) below.checked = ref.below;
}

function setupViewAids() {
    const eng = Pixoto.engine;
    if (!eng) return;

    const rotInd = $('#view-rotation-indicator');
    if (rotInd) rotInd.addEventListener('click', () => eng.resetViewRotation());

    const op = $('#reference-opacity');
    if (op) op.addEventListener('input', () => eng.setReferenceOpacity(parseInt(op.value) / 100));
    const vis = $('#reference-visible');
    if (vis) vis.addEventListener('change', () => { if (eng.referenceLayer) { eng.referenceLayer.visible = vis.checked; eng.requestComposite(); } });
    const below = $('#reference-below');
    if (below) below.addEventListener('change', () => eng.setReferenceBelow(below.checked));
    const sUp = $('#reference-scale-up'); if (sUp) sUp.addEventListener('click', () => eng.scaleReference(1.1));
    const sDn = $('#reference-scale-down'); if (sDn) sDn.addEventListener('click', () => eng.scaleReference(1 / 1.1));
    const fit = $('#reference-fit'); if (fit) fit.addEventListener('click', () => eng.fitReference());
    const clr = $('#reference-clear-btn'); if (clr) clr.addEventListener('click', () => { eng.clearReference(); const p = $('#reference-panel'); if (p) p.hidden = true; });

    // Move the reference by dragging the canvas while "Move" is checked.
    const moveChk = $('#reference-move');
    const vp = document.getElementById('canvas-viewport');
    if (vp) {
        let dragging = false, lastX = 0, lastY = 0;
        vp.addEventListener('pointerdown', (e) => {
            if (!moveChk || !moveChk.checked || !eng.referenceLayer) return;
            if (e.button !== 0 || eng.isNavigating || eng.spaceHeld) return;
            dragging = true;
            const p = eng.screenToCanvas(e.clientX, e.clientY);
            lastX = p.x; lastY = p.y;
            vp.setPointerCapture && vp.setPointerCapture(e.pointerId);
            e.stopPropagation(); e.preventDefault();
        }, true);
        vp.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const p = eng.screenToCanvas(e.clientX, e.clientY);
            eng.moveReference(p.x - lastX, p.y - lastY);
            lastX = p.x; lastY = p.y;
            e.stopPropagation();
        }, true);
        const end = (e) => { if (dragging) { dragging = false; e.stopPropagation(); } };
        vp.addEventListener('pointerup', end, true);
        vp.addEventListener('pointercancel', end, true);
    }
}

function updatePixelModeIndicator() {
    const ind = $('#pixel-mode-indicator');
    if (ind) ind.classList.toggle('on', Pixoto.mode === 'pixel');
    const dind = $('#desktop-pixel-mode-indicator');
    if (dind) dind.classList.toggle('on', Pixoto.mode === 'pixel');
}


// ═══════════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════════
function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
}

function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
}

// Close buttons inside modals
$$('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => {
        const modal = btn.closest('.modal');
        if (modal) closeModal(modal);
    });
});

// Close on overlay click
$$('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', () => {
        const modal = overlay.closest('.modal');
        if (modal) closeModal(modal);
    });
});

// New Canvas dialog
$('#new-canvas-cancel')?.addEventListener('click', () => closeModal(DOM.newCanvasDialog));
$('#new-canvas-create')?.addEventListener('click', () => {
    const w = parseInt($('#canvas-width')?.value) || 800;
    const h = parseInt($('#canvas-height')?.value) || 600;
    Pixoto.canvas.width = Math.min(Math.max(w, 1), 8192);
    Pixoto.canvas.height = Math.min(Math.max(h, 1), 8192);
    initCanvas();
    closeModal(DOM.newCanvasDialog);
    console.log(`[Pixoto] New canvas: ${Pixoto.canvas.width}×${Pixoto.canvas.height}`);
});

// Preset buttons
$$('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        const w = btn.dataset.w;
        const h = btn.dataset.h;
        if ($('#canvas-width')) $('#canvas-width').value = w;
        if ($('#canvas-height')) $('#canvas-height').value = h;
    });
});

// Background option buttons
$$('[data-bg]').forEach((btn) => {
    btn.addEventListener('click', () => {
        $$('[data-bg]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// Export dialog
$('#export-cancel')?.addEventListener('click', () => closeModal(DOM.exportDialog));
$('#export-confirm')?.addEventListener('click', () => {
    const formatBtn = document.querySelector('.format-btn.active');
    const format = formatBtn?.dataset.format || 'png';
    const quality = parseInt($('#export-quality')?.value) || 92;
    const filename = ($('#export-filename')?.value || '').trim() || 'pixoto-export';
    if (Pixoto.fileManager) {
        Pixoto.fileManager.exportImage(format, quality / 100, filename);
    }
    closeModal(DOM.exportDialog);
});

// Export format buttons
$$('.format-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        $$('.format-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const format = btn.dataset.format;
        const qualityRow = $('#export-quality-row');
        if (qualityRow) {
            qualityRow.hidden = format === 'png';
        }
    });
});

// Color picker modal — cancel button (OK and open are wired in init())
$('#color-picker-cancel')?.addEventListener('click', () => closeModal(DOM.colorPickerModal));

// Clear App Data modal
$('#clear-data-cancel')?.addEventListener('click', () => closeModal($('#clear-data-modal')));
$('#clear-data-confirm')?.addEventListener('click', async () => {
    try {
        // 1. Clear all Pixoto-related localStorage keys
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('pixoto')) keysToRemove.push(key);
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));

        // 2. Unregister all service workers
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const reg of regs) await reg.unregister();
        }

        // 3. Delete all caches
        if ('caches' in window) {
            const keys = await caches.keys();
            for (const key of keys) await caches.delete(key);
        }
    } catch (err) {
        console.warn('[Pixoto] Error clearing app data:', err);
    }

    // 4. Reload
    window.location.reload();
});


// ═══════════════════════════════════════════════════════════════
// RESIZE IMAGE / RESIZE CANVAS MODALS
// ═══════════════════════════════════════════════════════════════

function openResizeImageModal() {
    const modal = $('#resize-image-modal');
    if (!modal || !Pixoto.engine) return;
    const w = Pixoto.engine.docWidth;
    const h = Pixoto.engine.docHeight;
    $('#resize-img-current').textContent = `${w} × ${h}`;
    $('#resize-img-width').value = w;
    $('#resize-img-height').value = h;
    // Store original dims for aspect ratio lock
    modal._origW = w;
    modal._origH = h;
    modal._aspectRatio = w / h;
    openModal(modal);
}

function openResizeCanvasModal() {
    const modal = $('#resize-canvas-modal');
    if (!modal || !Pixoto.engine) return;
    const w = Pixoto.engine.docWidth;
    const h = Pixoto.engine.docHeight;
    $('#resize-cvs-current').textContent = `${w} × ${h}`;
    $('#resize-cvs-width').value = w;
    $('#resize-cvs-height').value = h;
    // Reset anchor to center
    $$('#resize-anchor-grid .anchor-cell').forEach(c => c.classList.remove('active'));
    $('#resize-anchor-grid .anchor-cell[data-ax="0"][data-ay="0"]')?.classList.add('active');
    openModal(modal);
}

// ─── Resize Image handlers ───
$('#resize-img-cancel')?.addEventListener('click', () => closeModal($('#resize-image-modal')));
$('#resize-img-apply')?.addEventListener('click', () => {
    const w = Math.min(Math.max(parseInt($('#resize-img-width')?.value) || 1, 1), 8192);
    const h = Math.min(Math.max(parseInt($('#resize-img-height')?.value) || 1, 1), 8192);
    const smooth = document.querySelector('[data-resample].active')?.dataset.resample !== 'nearest';

    if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Resize Image');
    if (Pixoto.selectionManager) Pixoto.selectionManager.deselect();
    if (Pixoto.engine) {
        Pixoto.engine.resizeImage(w, h, smooth);
        Pixoto.canvas.width = w;
        Pixoto.canvas.height = h;
        if (DOM.canvasSize) DOM.canvasSize.textContent = `${w} × ${h}`;
    }
    closeModal($('#resize-image-modal'));
});

// Aspect ratio lock toggle
$('#resize-img-lock')?.addEventListener('click', function() {
    this.classList.toggle('active');
    const useEl = this.querySelector('use');
    if (useEl) {
        useEl.setAttribute('href', this.classList.contains('active') ? '#icon-lock' : '#icon-unlock');
    }
});

// Linked width/height inputs (when lock is active)
$('#resize-img-width')?.addEventListener('input', function() {
    const lock = $('#resize-img-lock');
    if (!lock?.classList.contains('active')) return;
    const modal = $('#resize-image-modal');
    if (!modal?._aspectRatio) return;
    const w = parseInt(this.value) || 1;
    $('#resize-img-height').value = Math.max(1, Math.round(w / modal._aspectRatio));
});

$('#resize-img-height')?.addEventListener('input', function() {
    const lock = $('#resize-img-lock');
    if (!lock?.classList.contains('active')) return;
    const modal = $('#resize-image-modal');
    if (!modal?._aspectRatio) return;
    const h = parseInt(this.value) || 1;
    $('#resize-img-width').value = Math.max(1, Math.round(h * modal._aspectRatio));
});

// Resample mode toggle
$$('[data-resample]').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('[data-resample]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// ─── Resize Canvas handlers ───
$('#resize-cvs-cancel')?.addEventListener('click', () => closeModal($('#resize-canvas-modal')));
$('#resize-cvs-apply')?.addEventListener('click', () => {
    const w = Math.min(Math.max(parseInt($('#resize-cvs-width')?.value) || 1, 1), 8192);
    const h = Math.min(Math.max(parseInt($('#resize-cvs-height')?.value) || 1, 1), 8192);
    const activeAnchor = document.querySelector('#resize-anchor-grid .anchor-cell.active');
    const ax = parseInt(activeAnchor?.dataset.ax) || 0;
    const ay = parseInt(activeAnchor?.dataset.ay) || 0;

    if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Resize Canvas');
    if (Pixoto.selectionManager) Pixoto.selectionManager.deselect();
    if (Pixoto.engine) {
        Pixoto.engine.resizeCanvas(w, h, ax, ay);
        Pixoto.canvas.width = w;
        Pixoto.canvas.height = h;
        if (DOM.canvasSize) DOM.canvasSize.textContent = `${w} × ${h}`;
    }
    closeModal($('#resize-canvas-modal'));
});

// Anchor grid selection
$$('#resize-anchor-grid .anchor-cell').forEach(cell => {
    cell.addEventListener('click', () => {
        $$('#resize-anchor-grid .anchor-cell').forEach(c => c.classList.remove('active'));
        cell.classList.add('active');
    });
});


// ═══════════════════════════════════════════════════════════════
// SLIDER LIVE VALUES + TOOL STATE SYNC
// ═══════════════════════════════════════════════════════════════
$$('.slider').forEach((slider) => {
    const val = slider.parentElement?.querySelector('.slider-val');
    if (!val) return;

    slider.addEventListener('input', () => {
        const id = slider.id || '';
        const isTolerance = id.includes('tolerance');
        const suffix = id.includes('opacity') || id.includes('hardness') || id.includes('quality')
            ? '%' : (isTolerance ? '' : 'px');
        val.textContent = `${slider.value}${suffix}`;

        // Sync to tool manager
        if (Pixoto.toolManager) {
            if (id === 'brush-size' || id === 'eraser-size') {
                Pixoto.toolManager.setBrushSize(parseInt(slider.value));
            } else if (id === 'brush-opacity' || id === 'eraser-opacity') {
                Pixoto.toolManager.setBrushOpacity(parseInt(slider.value));
            } else if (id === 'brush-hardness') {
                Pixoto.toolManager.setBrushHardness(parseInt(slider.value));
            } else if (id === 'fill-tolerance') {
                Pixoto.toolManager.setFillTolerance(parseInt(slider.value));
            } else if (id === 'wand-tolerance') {
                Pixoto.toolManager.setWandTolerance(parseInt(slider.value));
            }
        }
    });
});

// ── Brush mode buttons ──
$$('[data-brush-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.brushMode;
        $$('[data-brush-mode]').forEach((b) => b.classList.toggle('active', b.dataset.brushMode === mode));
        if (Pixoto.toolManager) Pixoto.toolManager.setBrushMode(mode);
        // Show pixel-perfect toggle only in pixel pen mode
        const ppRow = document.getElementById('pixel-perfect-row');
        if (ppRow) ppRow.hidden = (mode !== 'pixel');
    });
});

// ── Pixel-perfect toggle ──
$('#pixel-perfect-toggle')?.addEventListener('change', (e) => {
    if (Pixoto.toolManager) Pixoto.toolManager.setPixelPerfectMode(e.target.checked);
});

// ── Eraser mode buttons ──
$$('[data-eraser-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.eraserMode;
        $$('[data-eraser-mode]').forEach((b) => b.classList.toggle('active', b.dataset.eraserMode === mode));
        if (Pixoto.toolManager) Pixoto.toolManager.setBrushMode(mode);
    });
});

// ── Fill contiguous checkbox ──
$('#fill-contiguous')?.addEventListener('change', (e) => {
    if (Pixoto.toolManager) Pixoto.toolManager.setFillContiguous(e.target.checked);
});

// ── Selection tool buttons ──
$('#btn-select-all')?.addEventListener('click', () => {
    if (Pixoto.selectionManager) Pixoto.selectionManager.selectAll();
});
$('#btn-deselect')?.addEventListener('click', () => {
    if (Pixoto.selectionManager) Pixoto.selectionManager.deselect();
});
$('#btn-lasso-select-all')?.addEventListener('click', () => {
    if (Pixoto.selectionManager) Pixoto.selectionManager.selectAll();
});
$('#btn-lasso-deselect')?.addEventListener('click', () => {
    if (Pixoto.selectionManager) Pixoto.selectionManager.deselect();
});

// ── Magic Wand tool controls ──
$('#wand-contiguous')?.addEventListener('change', (e) => {
    if (Pixoto.toolManager) Pixoto.toolManager.setWandContiguous(e.target.checked);
});
$('#btn-wand-select-all')?.addEventListener('click', () => {
    if (Pixoto.selectionManager) Pixoto.selectionManager.selectAll();
});
$('#btn-wand-deselect')?.addEventListener('click', () => {
    if (Pixoto.selectionManager) Pixoto.selectionManager.deselect();
});

// Layer opacity slider — handled by LayersPanel in Phase 6
// (keeping this as a fallback for early init before LayersPanel is created)
$('#layer-opacity')?.addEventListener('input', (e) => {
    const val = $('#layer-opacity-val');
    if (val) val.textContent = `${e.target.value}%`;
    // LayersPanel handles the actual layer opacity change
});


// ═══════════════════════════════════════════════════════════════
// CANVAS INITIALIZATION (Engine-backed — Phase 2)
// ═══════════════════════════════════════════════════════════════
function initCanvas(bgColor = null) {
    const { width, height } = Pixoto.canvas;

    // Determine background color from UI if not provided
    if (!bgColor) {
        const bgOption = $('.btn-group [data-bg].active')?.dataset.bg || 'white';
        if (bgOption === 'white') bgColor = '#ffffff';
        else if (bgOption === 'black') bgColor = '#000000';
        else bgColor = null; // transparent
    }

    // Initialize engine with document dimensions
    Pixoto.engine.init(width, height, bgColor);

    // Reset the animation timeline to a single frame wrapping the new document
    if (Pixoto.animation) Pixoto.animation.reset();

    // P9 — reset view aids for the new document
    if (Pixoto.engine) {
        Pixoto.engine.viewRotation = 0;
        Pixoto.engine.guides = { v: [], h: [] };
        Pixoto.engine.referenceLayer = null;
    }
    { const rp = document.getElementById('reference-panel'); if (rp) rp.hidden = true; }
    if (Pixoto.rulerGuides) requestAnimationFrame(() => Pixoto.rulerGuides.redraw());

    // Update status bar
    if (DOM.canvasSize) {
        DOM.canvasSize.textContent = `${width} × ${height}`;
    }
}


// ═══════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
    // Don't fire if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
    }

    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const key = e.key.toLowerCase();

    // Ctrl shortcuts
    if (ctrl) {
        switch (key) {
            case 'z':
                e.preventDefault();
                if (shift) {
                    performRedo();
                } else {
                    performUndo();
                }
                break;
            case 'y':
                e.preventDefault();
                performRedo();
                break;
            case 'n':
                e.preventDefault();
                openModal(DOM.newCanvasDialog);
                break;
            case 'o':
                e.preventDefault();
                document.getElementById('file-input')?.click();
                break;
            case 's':
                e.preventDefault();
                if (shift) {
                    if (Pixoto.fileManager) Pixoto.fileManager.saveProject();
                } else {
                    openModal(DOM.exportDialog);
                }
                break;
            case 'x':
                e.preventDefault();
                performCut();
                break;
            case 'c':
                e.preventDefault();
                performCopy();
                break;
            case 'v':
                e.preventDefault();
                performPaste();
                break;
            case 'a':
                e.preventDefault();
                if (Pixoto.selectionManager) Pixoto.selectionManager.selectAll();
                break;
            case 'd':
                e.preventDefault();
                if (Pixoto.selectionManager) Pixoto.selectionManager.deselect();
                break;
            case 'r':
                e.preventDefault();
                handleMenuAction('toggle-rulers');
                break;
            case 'g':
                e.preventDefault();
                handleMenuAction('create-group');
                break;
            case 'p':
                if (shift) { e.preventDefault(); handleMenuAction('place-image'); }
                break;
            case 'i':
                if (shift) { e.preventDefault(); handleMenuAction('select-inverse'); }
                break;
        }
        return;
    }

    // Tool shortcuts (single key)
    switch (key) {
        case ' ':
            e.preventDefault();
            if (Pixoto.engine) Pixoto.engine.setSpaceHeld(true);
            break;
        case 'b': setActiveTool('brush'); break;
        case 'e': setActiveTool('eraser'); break;
        case 'f': setActiveTool('fill'); break;
        case 'm': setActiveTool('select-rect'); break;
        case 'l': setActiveTool('lasso'); break;
        case 'w': setActiveTool('magic-wand'); break;
        case 'c': setActiveTool('crop'); break;
        case 'v': setActiveTool('move'); break;
        case 't': setActiveTool('transform'); break;
        case 'p': setActiveTool('pixel-pen'); break;
        case 'i': setActiveTool('eyedropper'); break;
        case 'x': setActiveTool('text'); break;
        case 's': setActiveTool('clone-stamp'); break;
        case 'g':
            handleMenuAction('toggle-grid');
            break;
        case 'tab':
            e.preventDefault();
            cycleTool();
            break;
        case '[':
            if (Pixoto.toolManager) {
                const newSizeDown = Pixoto.toolManager.adjustBrushSize(-1);
                syncBrushSizeUI(newSizeDown);
            }
            break;
        case ']':
            if (Pixoto.toolManager) {
                const newSizeUp = Pixoto.toolManager.adjustBrushSize(1);
                syncBrushSizeUI(newSizeUp);
            }
            break;
        case 'escape':
            closeDropdowns();
            if (Pixoto.activeTool === 'transform' && Pixoto.toolManager) {
                const xfTool = Pixoto.toolManager.getTool('transform');
                if (xfTool) xfTool.cancelTransform();
            } else if (Pixoto.activeTool === 'crop' && Pixoto.toolManager) {
                const cropTool = Pixoto.toolManager.getTool('crop');
                if (cropTool) cropTool.cancelCrop();
            }
            if (Pixoto.selectionManager && Pixoto.selectionManager.hasSelection) {
                Pixoto.selectionManager.deselect();
            }
            break;
        case 'enter':
            if (Pixoto.activeTool === 'transform' && Pixoto.toolManager) {
                const xfTool = Pixoto.toolManager.getTool('transform');
                if (xfTool) xfTool.confirmTransform();
            } else if (Pixoto.activeTool === 'crop' && Pixoto.toolManager) {
                const cropTool = Pixoto.toolManager.getTool('crop');
                if (cropTool) {
                    if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Crop');
                    cropTool.confirmCrop();
                }
            }
            break;
        case 'delete':
        case 'backspace':
            e.preventDefault();
            performDelete();
            break;
    }
});

function cycleTool() {
    const tools = ['brush', 'eraser', 'fill', 'select-rect', 'lasso', 'crop',
                   'move', 'pixel-pen', 'eyedropper', 'pixelate'];
    const idx = tools.indexOf(Pixoto.activeTool);
    const next = tools[(idx + 1) % tools.length];
    setActiveTool(next);
}

// ─── Key Up (for space-to-pan release) ───
document.addEventListener('keyup', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.key === ' ') {
        if (Pixoto.engine) Pixoto.engine.setSpaceHeld(false);
    }
});

// Cursor tracking is handled by CanvasEngine via onCursorMove callback


// ═══════════════════════════════════════════════════════════════
// COLOR SWATCHES
// ═══════════════════════════════════════════════════════════════
$$('.swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
        const color = swatch.dataset.color;
        if (!color) return;
        Pixoto.foregroundColor = color;
        updateColorDisplay();
    });
});

function updateColorDisplay() {
    const color = Pixoto.foregroundColor;
    if ($('#color-preview-fg')) $('#color-preview-fg').style.background = color;
    if ($('#sidebar-fg-color')) $('#sidebar-fg-color').style.background = color;
    if ($('#color-hex-input')) $('#color-hex-input').value = color;
    if (DOM.statusSwatch) DOM.statusSwatch.style.background = color;
    if (DOM.statusColorHex) DOM.statusColorHex.textContent = color;

    // Sync to tool manager
    if (Pixoto.toolManager) {
        Pixoto.toolManager.setForegroundColor(color);
    }
}

function updateBgColorDisplay() {
    const color = Pixoto.backgroundColor;
    if ($('#color-preview-bg')) $('#color-preview-bg').style.background = color;
    if ($('#sidebar-bg-color')) $('#sidebar-bg-color').style.background = color;
    if (Pixoto.toolManager) Pixoto.toolManager.setBackgroundColor(color);
}

/**
 * Sync brush size slider UI when changed via keyboard shortcut.
 * @param {number} size - New brush size value
 */
function syncBrushSizeUI(size) {
    const brushSlider = $('#brush-size');
    const eraserSlider = $('#eraser-size');
    if (brushSlider) {
        brushSlider.value = size;
        const val = brushSlider.parentElement?.querySelector('.slider-val');
        if (val) val.textContent = `${size}px`;
    }
    if (eraserSlider) {
        eraserSlider.value = size;
        const val = eraserSlider.parentElement?.querySelector('.slider-val');
        if (val) val.textContent = `${size}px`;
    }
}

$('#color-hex-input')?.addEventListener('change', (e) => {
    const val = e.target.value.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(val)) {
        Pixoto.foregroundColor = '#' + val.toLowerCase();
        updateColorDisplay();
    }
});


// ═══════════════════════════════════════════════════════════════
// SESSION RESTORE CHECK
// ═══════════════════════════════════════════════════════════════
function checkSessionRestore() {
    const hasSavedSession = localStorage.getItem('pixoto-autosave');
    if (hasSavedSession) {
        const banner = $('#restore-banner');
        if (banner) banner.hidden = false;
    }
}

$('#restore-accept')?.addEventListener('click', () => {
    $('#restore-banner').hidden = true;
    if (Pixoto.fileManager) {
        Pixoto.fileManager.restoreSession();
        console.log('[Pixoto] Session restored');
    }
});

$('#restore-dismiss')?.addEventListener('click', () => {
    $('#restore-banner').hidden = true;
    localStorage.removeItem('pixoto-autosave');
});


// ═══════════════════════════════════════════════════════════════
// ZOOM BUTTONS (status bar)
// ═══════════════════════════════════════════════════════════════
$('#btn-fit')?.addEventListener('click', () => {
    if (Pixoto.engine) Pixoto.engine.fitToScreen();
});

$('#btn-zoom-100')?.addEventListener('click', () => {
    if (Pixoto.engine) Pixoto.engine.setZoom100();
});

$('#btn-zoom-200')?.addEventListener('click', () => {
    if (Pixoto.engine) Pixoto.engine.setZoom200();
});


// ═══════════════════════════════════════════════════════════════
// UNDO / REDO
// ═══════════════════════════════════════════════════════════════
function performUndo() {
    if (Pixoto.historyManager && Pixoto.historyManager.canUndo) {
        Pixoto.historyManager.undo();
        Pixoto.engine.requestComposite();
        console.log('[Pixoto] Undo');
    }
}

function performRedo() {
    if (Pixoto.historyManager && Pixoto.historyManager.canRedo) {
        Pixoto.historyManager.redo();
        Pixoto.engine.requestComposite();
        console.log('[Pixoto] Redo');
    }
}


// ═══════════════════════════════════════════════════════════════
// SELECTION ACTIONS (Cut / Copy / Paste / Delete)
// ═══════════════════════════════════════════════════════════════
function performCopy() {
    const sm = Pixoto.selectionManager;
    const engine = Pixoto.engine;
    if (!sm || !sm.hasSelection || !engine) return;

    const layer = engine.getActiveLayer();
    if (!layer) return;

    const bounds = sm.getBounds();
    if (!bounds) return;

    const { x, y, w, h } = bounds;
    const srcData = layer.ctx.getImageData(x, y, w, h);

    // Apply mask: zero out pixels outside selection
    const mask = sm.mask;
    const mw = sm.maskWidth;
    const out = new ImageData(w, h);
    for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
            const mi = (y + py) * mw + (x + px);
            const di = (py * w + px) * 4;
            if (mask[mi] > 0) {
                out.data[di]     = srcData.data[di];
                out.data[di + 1] = srcData.data[di + 1];
                out.data[di + 2] = srcData.data[di + 2];
                out.data[di + 3] = srcData.data[di + 3];
            }
        }
    }

    Pixoto.clipboard = { imageData: out, width: w, height: h, x, y };
    console.log(`[Pixoto] Copied ${w}×${h} region`);
}

function performCut() {
    performCopy();
    performDelete();
    console.log('[Pixoto] Cut selection');
}

function performPaste() {
    if (!Pixoto.clipboard || !Pixoto.engine) return;

    if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Paste');

    const { imageData, width, height } = Pixoto.clipboard;
    const layer = Pixoto.engine.addLayer('Pasted');
    layer.ctx.putImageData(imageData, 0, 0);
    layer.markAllDirty();
    Pixoto.engine.requestComposite();
    console.log('[Pixoto] Pasted as new layer');
}

function performDelete() {
    const sm = Pixoto.selectionManager;
    const engine = Pixoto.engine;
    if (!sm || !sm.hasSelection || !engine) return;

    const layer = engine.getActiveLayer();
    if (!layer || layer.locked) return;

    if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Delete Selection');

    const bounds = sm.getBounds();
    if (!bounds) return;

    const { x, y, w, h } = bounds;
    const imgData = layer.ctx.getImageData(x, y, w, h);
    const data = imgData.data;
    const mask = sm.mask;
    const mw = sm.maskWidth;

    for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
            const mi = (y + py) * mw + (x + px);
            if (mask[mi] > 0) {
                const di = (py * w + px) * 4;
                data[di] = data[di + 1] = data[di + 2] = data[di + 3] = 0;
            }
        }
    }

    layer.ctx.putImageData(imgData, x, y);
    layer.markDirty(x, y, w, h);
    engine.requestComposite();
    console.log('[Pixoto] Deleted selected pixels');
}

function performCropToSelection() {
    const sm = Pixoto.selectionManager;
    const engine = Pixoto.engine;
    if (!sm || !sm.hasSelection || !engine) return;

    const bounds = sm.getBounds();
    if (!bounds) return;

    if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Crop to Selection');

    const { x, y, w, h } = bounds;

    // Crop each layer to the selection bounds
    for (const layer of engine.layers) {
        const imgData = layer.ctx.getImageData(x, y, w, h);
        layer.canvas.width = w;
        layer.canvas.height = h;
        layer.ctx.putImageData(imgData, 0, 0);
        layer.markAllDirty();
    }

    engine.docWidth = w;
    engine.docHeight = h;
    engine._sizeCanvases(w, h);

    engine.requestComposite();
    engine.fitToScreen();
    sm.deselect();

    if (DOM.canvasSize) DOM.canvasSize.textContent = `${w} × ${h}`;
    console.log(`[Pixoto] Cropped to selection: ${w}×${h}`);
}


// ═══════════════════════════════════════════════════════════════
// P1 — PLACE / OPEN IMAGE  (place-as-layer, chooser, transform-on-place)
// ═══════════════════════════════════════════════════════════════
let _pendingOpenFile = null;

function _syncCanvasSizeLabel() {
    if (DOM.canvasSize && Pixoto.engine) {
        DOM.canvasSize.textContent = `${Pixoto.engine.docWidth} × ${Pixoto.engine.docHeight}`;
    }
}

/** Place an already-loaded image as a fitted layer, then enter Free Transform. */
function placeImageAndTransform(img, name = 'Image') {
    if (!Pixoto.fileManager || !Pixoto.engine) return;
    if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Place Image');
    const p = Pixoto.fileManager.placeImageAsLayer(img, name);
    _syncCanvasSizeLabel();
    if (!p) return;
    const t = Pixoto.toolManager?.getTool('transform');
    if (t) {
        t.setInitialRegion(p.x, p.y, p.w, p.h);
        setActiveTool('transform');
    }
}

/** Load an image File/Blob and place it as a layer. */
async function placeImageFileAsLayer(file) {
    try {
        const img = await Pixoto.fileManager.loadImageFromBlob(file);
        placeImageAndTransform(img, (file.name || 'Image').replace(/\.[^.]+$/, ''));
    } catch (err) {
        console.warn('[Pixoto] Place image failed:', err);
    }
}

/** Open an image as a brand-new project (replaces the current document). */
async function doOpenAsNewProject(file) {
    if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Open File');
    await Pixoto.fileManager.openImage(file, false);
    _syncCanvasSizeLabel();
}

/** Open an image, honouring the remembered choice or prompting New vs Place. */
async function openImageWithChoice(file) {
    let remembered = null;
    try { remembered = localStorage.getItem('pixoto-open-mode'); } catch { /* ignore */ }
    if (remembered === 'new')   return doOpenAsNewProject(file);
    if (remembered === 'place') return placeImageFileAsLayer(file);
    _pendingOpenFile = file;
    openModal($('#open-choice-modal'));
}

$('#open-choice-newproject')?.addEventListener('click', async () => {
    const f = _pendingOpenFile; _pendingOpenFile = null;
    if ($('#open-choice-remember')?.checked) { try { localStorage.setItem('pixoto-open-mode', 'new'); } catch {} }
    closeModal($('#open-choice-modal'));
    if (f) await doOpenAsNewProject(f);
});
$('#open-choice-place')?.addEventListener('click', async () => {
    const f = _pendingOpenFile; _pendingOpenFile = null;
    if ($('#open-choice-remember')?.checked) { try { localStorage.setItem('pixoto-open-mode', 'place'); } catch {} }
    closeModal($('#open-choice-modal'));
    if (f) await placeImageFileAsLayer(f);
});


// ═══════════════════════════════════════════════════════════════
// P3 — IMAGE MENU OPS (rotate / flip / trim)
// ═══════════════════════════════════════════════════════════════
function _imageOp(label, fn) {
    if (!Pixoto.engine) return;
    if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot(label);
    if (Pixoto.selectionManager) Pixoto.selectionManager.deselect();
    fn(Pixoto.engine);
    if (Pixoto.canvas) {
        Pixoto.canvas.width = Pixoto.engine.docWidth;
        Pixoto.canvas.height = Pixoto.engine.docHeight;
    }
    _syncCanvasSizeLabel();
}

function openRotateModal() {
    const m = $('#rotate-modal');
    if (!m) return;
    const inp = $('#rotate-angle');
    if (inp) inp.value = '0';
    openModal(m);
}

$('#rotate-cancel')?.addEventListener('click', () => closeModal($('#rotate-modal')));
$('#rotate-apply')?.addEventListener('click', () => {
    const deg = parseFloat($('#rotate-angle')?.value) || 0;
    closeModal($('#rotate-modal'));
    if (((deg % 360) + 360) % 360 === 0) return;
    _imageOp('Rotate', (en) => en.rotateArbitrary(deg));
});


// ═══════════════════════════════════════════════════════════════
// P4 — SELECTION MODIFY AMOUNT MODAL
// ═══════════════════════════════════════════════════════════════
let _amountCallback = null;

function openAmountModal(title, def, cb) {
    const m = $('#select-amount-modal');
    if (!m) return;
    const t = $('#select-amount-title'); if (t) t.textContent = title;
    const inp = $('#select-amount-value'); if (inp) inp.value = def;
    _amountCallback = cb;
    openModal(m);
}

$('#select-amount-cancel')?.addEventListener('click', () => {
    _amountCallback = null;
    closeModal($('#select-amount-modal'));
});
$('#select-amount-apply')?.addEventListener('click', () => {
    const n = Math.max(1, parseInt($('#select-amount-value')?.value) || 1);
    const cb = _amountCallback; _amountCallback = null;
    closeModal($('#select-amount-modal'));
    if (cb) cb(n);
});


// ═══════════════════════════════════════════════════════════════
// P2 — SHAPE + GRADIENT TOOL OPTIONS
// ═══════════════════════════════════════════════════════════════
$$('[data-shape]').forEach((btn) => {
    btn.addEventListener('click', () => {
        $$('[data-shape]').forEach((b) => b.classList.toggle('active', b === btn));
        setActiveTool('shape-' + btn.dataset.shape);
    });
});
$('#shape-fill')?.addEventListener('change', (e) => Pixoto._shapeTools?.forEach((t) => { t.fill = e.target.checked; }));
$('#shape-stroke')?.addEventListener('change', (e) => Pixoto._shapeTools?.forEach((t) => { t.strokeOn = e.target.checked; }));
$('#shape-pixel')?.addEventListener('change', (e) => Pixoto._shapeTools?.forEach((t) => { t.pixelPerfect = e.target.checked ? true : null; }));
$('#shape-star')?.addEventListener('change', (e) => Pixoto._shapeTools?.forEach((t) => { t.star = e.target.checked; }));
$('#shape-stroke-width')?.addEventListener('input', (e) => { const v = +e.target.value; Pixoto._shapeTools?.forEach((t) => { t.strokeWidth = v; }); });
$('#shape-corner-radius')?.addEventListener('input', (e) => { const v = +e.target.value; Pixoto._shapeTools?.forEach((t) => { t.cornerRadius = v; }); });
$('#shape-sides')?.addEventListener('input', (e) => { const v = +e.target.value; Pixoto._shapeTools?.forEach((t) => { t.sides = v; }); });

$$('[data-gradient-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
        $$('[data-gradient-type]').forEach((b) => b.classList.toggle('active', b === btn));
        if (Pixoto._gradientTool) Pixoto._gradientTool.gradientType = btn.dataset.gradientType;
    });
});
$('#gradient-opacity')?.addEventListener('input', (e) => { if (Pixoto._gradientTool) Pixoto._gradientTool.opacity = (+e.target.value) / 100; });
$('#btn-gradient-from-colors')?.addEventListener('click', () => Pixoto._gradientTool?.syncEndpointsFromColors());


// ═══════════════════════════════════════════════════════════════
// WINDOW RESIZE
// ═══════════════════════════════════════════════════════════════
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (Pixoto.engine) Pixoto.engine.onResize();
    }, 100);
});


// ═══════════════════════════════════════════════════════════════
// INITIALIZE
// ═══════════════════════════════════════════════════════════════
function init() {
    console.log(`[Pixoto] v${Pixoto.version} — Starting up`);

    // Create canvas engine
    Pixoto.engine = new CanvasEngine(
        DOM.mainCanvas, DOM.gridCanvas, DOM.uiCanvas,
        DOM.canvasViewport, DOM.canvasWrapper
    );

    // Create pixel engine and link to canvas engine
    Pixoto.pixelEngine = new PixelEngine(Pixoto.engine);
    Pixoto.engine.pixelEngine = Pixoto.pixelEngine;

    // ── Create Tool Manager and register tools (Phase 4) ──
    Pixoto.toolManager = new ToolManager(
        Pixoto.engine, Pixoto.pixelEngine, DOM.canvasViewport
    );

    const brushTool = new BrushTool(Pixoto.toolManager);
    const eraserTool = new EraserTool(Pixoto.toolManager);
    const fillTool = new FillTool(Pixoto.toolManager);
    const eyedropperTool = new EyedropperTool(Pixoto.toolManager);

    // Eyedropper callback — update UI when color is picked
    eyedropperTool.onColorPicked = (hex) => {
        Pixoto.foregroundColor = hex;
        updateColorDisplay();
    };

    // Create selection manager and selection tools (Phase 5)
    Pixoto.selectionManager = new SelectionManager(Pixoto.engine);
    // Wire selection manager into pixel engine so drawing is clipped to active selection
    Pixoto.pixelEngine.setSelectionManager(Pixoto.selectionManager);
    const rectSelectTool = new RectSelectTool(Pixoto.toolManager, Pixoto.selectionManager);
    const ellipseSelectTool = new EllipseSelectTool(Pixoto.toolManager, Pixoto.selectionManager);
    const lassoTool = new LassoTool(Pixoto.toolManager, Pixoto.selectionManager);
    const magicWandTool = new MagicWandTool(Pixoto.toolManager, Pixoto.selectionManager);

    // Create free transform tool (Phase A)
    const transformTool = new TransformTool(Pixoto.toolManager);
    transformTool.onBeforeConfirm = () => {
        if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Free Transform');
    };

    // Create crop tool (Phase 5d)
    const cropTool = new CropTool(Pixoto.toolManager);

    // Create pixelation tools (Phase 5e)
    const pixelateBrush = new PixelateBrushTool(Pixoto.toolManager);
    const pixelateRect = new RectPixelateTool(Pixoto.toolManager);
    const pixelSort = new PixelSortTool(Pixoto.toolManager);

    // Create Phase E — Text Tool
    const textTool = new TextTool(Pixoto.toolManager);

    // Create Phase G — Advanced Brushes
    const smudgeTool    = new SmudgeTool(Pixoto.toolManager);
    const dodgeTool     = new DodgeTool(Pixoto.toolManager);
    const burnTool      = new BurnTool(Pixoto.toolManager);
    const cloneStampTool = new CloneStampTool(Pixoto.toolManager);

    // Phase D / P2 — Shape tools + Gradient tool
    const shapeRect       = new ShapeTool(Pixoto.toolManager, 'rect', 'shape-rect');
    const shapeRoundRect  = new ShapeTool(Pixoto.toolManager, 'rounded-rect', 'shape-rounded-rect');
    const shapeEllipse    = new ShapeTool(Pixoto.toolManager, 'ellipse', 'shape-ellipse');
    const shapeLine       = new ShapeTool(Pixoto.toolManager, 'line', 'shape-line');
    const shapePolygon    = new ShapeTool(Pixoto.toolManager, 'polygon', 'shape-polygon');
    const gradientTool    = new GradientTool(Pixoto.toolManager);
    const _shapeTools = [shapeRect, shapeRoundRect, shapeEllipse, shapeLine, shapePolygon];
    for (const st of _shapeTools) {
        st.onBeforeStroke = () => { if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Shape'); };
    }
    gradientTool.onBeforeStroke = () => { if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Gradient'); };
    Pixoto._shapeTools = _shapeTools;
    Pixoto._gradientTool = gradientTool;

    Pixoto.toolManager.register(brushTool);
    Pixoto.toolManager.register(eraserTool);
    Pixoto.toolManager.register(fillTool);
    Pixoto.toolManager.register(eyedropperTool);
    Pixoto.toolManager.register(rectSelectTool);
    Pixoto.toolManager.register(ellipseSelectTool);
    Pixoto.toolManager.register(lassoTool);
    Pixoto.toolManager.register(magicWandTool);
    Pixoto.toolManager.register(transformTool);
    Pixoto.toolManager.register(cropTool);
    Pixoto.toolManager.register(pixelateBrush);
    Pixoto.toolManager.register(pixelateRect);
    Pixoto.toolManager.register(pixelSort);
    Pixoto.toolManager.register(textTool);
    Pixoto.toolManager.register(smudgeTool);
    Pixoto.toolManager.register(dodgeTool);
    Pixoto.toolManager.register(burnTool);
    Pixoto.toolManager.register(cloneStampTool);
    Pixoto.toolManager.register(shapeRect);
    Pixoto.toolManager.register(shapeRoundRect);
    Pixoto.toolManager.register(shapeEllipse);
    Pixoto.toolManager.register(shapeLine);
    Pixoto.toolManager.register(shapePolygon);
    Pixoto.toolManager.register(gradientTool);

    // P2 — bind the multi-stop gradient editor to its container
    Pixoto.gradientEditor = new GradientEditor(
        document.getElementById('gradient-editor-container'), gradientTool
    );

    // Set default active tool
    Pixoto.toolManager.switchTool('brush');
    Pixoto.toolManager.setForegroundColor(Pixoto.foregroundColor);

    // ── History Manager (Phase 7) ──
    Pixoto.historyManager = new HistoryManager(Pixoto.engine, 50);
    Pixoto.historyManager.onHistoryChange = () => {
        // Update undo/redo button states
        const undoBtn = $('#btn-undo');
        const redoBtn = $('#btn-redo');
        if (undoBtn) undoBtn.disabled = !Pixoto.historyManager.canUndo;
        if (redoBtn) redoBtn.disabled = !Pixoto.historyManager.canRedo;
    };
    // Wire history into filter dialog
    if (Pixoto.filterDialog) Pixoto.filterDialog.history = Pixoto.historyManager;
    if (Pixoto.layerStylesDialog) Pixoto.layerStylesDialog.history = Pixoto.historyManager;

    // ── File Manager (Phase 7) ──
    Pixoto.fileManager = new FileManager(Pixoto.engine);

    // Wire file input to file manager (P1: open / place routing)
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            fileInput.value = ''; // Reset so same file can be re-opened
            if (!file || !Pixoto.fileManager) return;

            // .pixoto projects always load directly
            if (file.name.toLowerCase().endsWith('.pixoto')) {
                await Pixoto.fileManager.loadProject(file);
                _syncCanvasSizeLabel();
                return;
            }

            if (Pixoto._fileOpenMode === 'place') {
                await placeImageFileAsLayer(file);
            } else {
                // "Open File": let the user choose New Project vs Place as Layer
                await openImageWithChoice(file);
            }
        });
    }

    // ── Wire selection manager onto the tool manager (used by selection-aware transform) ──
    Pixoto.toolManager.selectionManager = Pixoto.selectionManager;

    // ── P1: Drag-and-drop image files onto the canvas → place as layer ──
    const dropTarget = DOM.canvasViewport;
    if (dropTarget) {
        const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
        dropTarget.addEventListener('dragenter', stop);
        dropTarget.addEventListener('dragover', (e) => { stop(e); e.dataTransfer.dropEffect = 'copy'; });
        dropTarget.addEventListener('drop', async (e) => {
            stop(e);
            const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name));
            if (file && Pixoto.fileManager) await placeImageFileAsLayer(file);
        });
    }

    // ── P1: External clipboard image paste (paste event covers OS clipboard) ──
    document.addEventListener('paste', async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type && item.type.startsWith('image/')) {
                const blob = item.getAsFile();
                if (blob && Pixoto.fileManager) {
                    e.preventDefault();
                    const img = await Pixoto.fileManager.loadImageFromBlob(blob);
                    placeImageAndTransform(img, 'Pasted');
                }
                return;
            }
        }
    });

    // ── Layers Panel (Phase 6) ──
    Pixoto.layersPanel = new LayersPanel(Pixoto.engine, {
        listEl: document.getElementById('layers-list'),
        mobileListEl: document.getElementById('mobile-layers-list'),
        blendSelect: document.getElementById('blend-mode'),
        opacitySlider: document.getElementById('layer-opacity'),
        opacityVal: document.getElementById('layer-opacity-val'),
        history: Pixoto.historyManager,
    });

    // ── Color Picker (Phase J upgrade) ──
    Pixoto.colorPicker = new ColorPicker({
        pickerCanvas: document.getElementById('color-picker-canvas'),
        pickerCursor: document.getElementById('color-picker-cursor'),
        hueCanvas:    document.getElementById('hue-slider-canvas'),
        hueThumb:     document.getElementById('hue-slider-thumb'),
        alphaCanvas:  document.getElementById('alpha-slider-canvas'),
        alphaThumb:   document.getElementById('alpha-slider-thumb'),
        hexInput:     document.getElementById('picker-hex'),
        rInput:       document.getElementById('picker-r'),
        gInput:       document.getElementById('picker-g'),
        bInput:       document.getElementById('picker-b'),
        hInput:       document.getElementById('picker-h'),
        sInput:       document.getElementById('picker-s'),
        lInput:       document.getElementById('picker-l'),
        colorOld:     document.getElementById('color-old'),
        colorNew:     document.getElementById('color-new'),
        onChange: () => {},
    });

    // Track which color target is being picked: 'fg' | 'bg'
    let _colorPickerTarget = 'fg';

    // Wire OK button
    $('#color-picker-ok')?.addEventListener('click', () => {
        const hex = Pixoto.colorPicker.getHex();
        if (_colorPickerTarget === 'bg') {
            Pixoto.backgroundColor = hex;
            updateBgColorDisplay();
        } else {
            Pixoto.foregroundColor = hex;
            updateColorDisplay();
            _pushColorHistory(hex);
        }
        closeModal(DOM.colorPickerModal);
    });

    // Open color picker helpers
    const openColorPickerFg = () => {
        _colorPickerTarget = 'fg';
        Pixoto.colorPicker?.setColor(Pixoto.foregroundColor);
        openModal(DOM.colorPickerModal);
    };
    const openColorPickerBg = () => {
        _colorPickerTarget = 'bg';
        Pixoto.colorPicker?.setColor(Pixoto.backgroundColor);
        openModal(DOM.colorPickerModal);
    };

    $('#color-preview-fg')?.addEventListener('click', openColorPickerFg);
    $('#sidebar-fg-color')?.addEventListener('click', openColorPickerFg);
    $('#color-preview-bg')?.addEventListener('click', openColorPickerBg);
    $('#sidebar-bg-color')?.addEventListener('click', openColorPickerBg);

    // ── Color History (Phase J) ──
    // Persist up to 10 recent colors in localStorage
    let _colorHistory = [];
    try {
        const stored = localStorage.getItem('pixoto-color-history');
        if (stored) _colorHistory = JSON.parse(stored);
    } catch { /* ignore */ }

    function _pushColorHistory(hex) {
        _colorHistory = _colorHistory.filter(c => c !== hex);
        _colorHistory.unshift(hex);
        if (_colorHistory.length > 10) _colorHistory.length = 10;
        try { localStorage.setItem('pixoto-color-history', JSON.stringify(_colorHistory)); } catch {}
        _renderColorHistory();
    }

    function _renderColorHistory() {
        const el = $('#color-history');
        if (!el) return;
        el.innerHTML = '';
        _colorHistory.forEach(hex => {
            const sw = document.createElement('div');
            sw.className = 'swatch swatch-history';
            sw.style.background = hex;
            sw.title = hex;
            sw.dataset.color = hex;
            sw.addEventListener('click', () => {
                Pixoto.foregroundColor = hex;
                updateColorDisplay();
            });
            el.appendChild(sw);
        });
    }
    _renderColorHistory();

    // ── Add swatch to palette ──
    $('#btn-add-swatch')?.addEventListener('click', () => {
        const hex = Pixoto.foregroundColor;
        const swatches = $('#color-swatches');
        if (!swatches) return;
        // Avoid duplicate
        if (swatches.querySelector(`[data-color="${hex}"]`)) return;
        const sw = document.createElement('div');
        sw.className = 'swatch';
        sw.style.background = hex;
        sw.dataset.color = hex;
        sw.title = hex;
        sw.addEventListener('click', () => {
            Pixoto.foregroundColor = hex;
            updateColorDisplay();
        });
        sw.addEventListener('contextmenu', (e) => { e.preventDefault(); sw.remove(); });
        swatches.appendChild(sw);
    });

    // ── Palette Import (Phase J) ──
    const paletteImportInput = document.getElementById('palette-import-input');
    $('#btn-palette-import')?.addEventListener('click', () => paletteImportInput?.click());
    paletteImportInput?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const name = file.name.toLowerCase();
        try {
            if (name.endsWith('.gpl')) {
                await _importGPL(file);
            } else if (name.endsWith('.hex') || name.endsWith('.txt')) {
                await _importHexList(file);
            } else if (name.endsWith('.png') || file.type === 'image/png') {
                await _importPNG(file);
            }
        } catch (err) {
            console.warn('[Pixoto] Palette import error:', err);
        }
        paletteImportInput.value = '';
    });

    async function _importGPL(file) {
        const text = await file.text();
        const colors = [];
        for (const line of text.split('\n')) {
            const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)/);
            if (m) colors.push(_rgbToHex6(+m[1], +m[2], +m[3]));
        }
        _addSwatches(colors);
    }

    async function _importHexList(file) {
        const text = await file.text();
        const colors = text.split(/[\n,;\s]+/)
            .map(s => s.trim().replace(/^#/, ''))
            .filter(s => /^[0-9a-fA-F]{6}$/.test(s))
            .map(s => '#' + s);
        _addSwatches(colors);
    }

    async function _importPNG(file) {
        return new Promise((resolve) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxPx = 128;
                const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
                canvas.width  = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                // Collect unique colors (quantized to nearest 8)
                const seen = new Set();
                const colors = [];
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i+3] < 128) continue;
                    const r = data[i]   & 0xF8;
                    const g = data[i+1] & 0xF8;
                    const b = data[i+2] & 0xF8;
                    const key = (r << 16) | (g << 8) | b;
                    if (!seen.has(key)) { seen.add(key); colors.push(_rgbToHex6(r, g, b)); }
                }
                URL.revokeObjectURL(url);
                // Take up to 64 most-varied colors (simple random sample)
                const sampled = colors.length <= 64 ? colors
                    : colors.filter((_, i) => i % Math.ceil(colors.length / 64) === 0).slice(0, 64);
                _addSwatches(sampled);
                resolve();
            };
            img.src = url;
        });
    }

    function _addSwatches(colors) {
        const swatches = $('#color-swatches');
        if (!swatches) return;
        colors.forEach(hex => {
            if (swatches.querySelector(`[data-color="${hex}"]`)) return;
            const sw = document.createElement('div');
            sw.className = 'swatch';
            sw.style.background = hex;
            sw.dataset.color = hex;
            sw.title = hex;
            sw.addEventListener('click', () => {
                Pixoto.foregroundColor = hex;
                updateColorDisplay();
            });
            sw.addEventListener('contextmenu', (e) => { e.preventDefault(); sw.remove(); });
            swatches.appendChild(sw);
        });
    }

    function _rgbToHex6(r, g, b) {
        return '#' + [r, g, b].map(v => (v & 0xff).toString(16).padStart(2, '0')).join('');
    }

    // ── Palette Sort (Phase J) ──
    $('#btn-palette-sort-hue')?.addEventListener('click', () => {
        const swatches = $('#color-swatches');
        if (!swatches) return;
        const items = [...swatches.querySelectorAll('.swatch')];
        items.sort((a, b) => {
            const ca = a.dataset.color, cb = b.dataset.color;
            const ha = _hexHue(ca), hb = _hexHue(cb);
            return ha - hb;
        });
        items.forEach(sw => swatches.appendChild(sw));
    });

    function _hexHue(hex) {
        try {
            const { r, g, b } = _parseHex(hex);
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            if (max === min) return 360; // achromatic → sort to end
            const d = max - min;
            let h;
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            return h * 60;
        } catch { return 360; }
    }

    function _parseHex(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex);
        if (!m) return { r: 0, g: 0, b: 0 };
        const n = parseInt(m[1], 16);
        return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
    }

    // ── Wire layer buttons (desktop + mobile) ──
    $('#btn-add-layer')?.addEventListener('click', () => handleMenuAction('add-layer'));
    $('#btn-duplicate-layer')?.addEventListener('click', () => handleMenuAction('duplicate-layer'));
    $('#btn-add-mask')?.addEventListener('click', () => handleMenuAction('add-mask-white'));
    $('#btn-create-group')?.addEventListener('click', () => handleMenuAction('create-group'));
    $('#btn-merge-down')?.addEventListener('click', () => handleMenuAction('merge-down'));
    $('#btn-delete-layer')?.addEventListener('click', () => handleMenuAction('delete-layer'));
    $('#mobile-add-layer')?.addEventListener('click', () => handleMenuAction('add-layer'));
    $('#mobile-duplicate-layer')?.addEventListener('click', () => handleMenuAction('duplicate-layer'));
    $('#mobile-delete-layer')?.addEventListener('click', () => handleMenuAction('delete-layer'));

    // ── Wire transform tool numeric inputs ──
    transformTool.inputW     = document.getElementById('tf-w');
    transformTool.inputH     = document.getElementById('tf-h');
    transformTool.inputX     = document.getElementById('tf-x');
    transformTool.inputY     = document.getElementById('tf-y');
    transformTool.inputAngle = document.getElementById('tf-angle');

    const _applyTransformInputs = () => {
        if (Pixoto.activeTool !== 'transform') return;
        const w = parseFloat(transformTool.inputW?.value)     || transformTool._tw;
        const h = parseFloat(transformTool.inputH?.value)     || transformTool._th;
        const x = parseFloat(transformTool.inputX?.value)     ?? transformTool._cx;
        const y = parseFloat(transformTool.inputY?.value)     ?? transformTool._cy;
        const a = parseFloat(transformTool.inputAngle?.value) ?? 0;
        transformTool.applyFromInputs(w, h, x, y, a);
    };

    ['tf-w', 'tf-h', 'tf-x', 'tf-y', 'tf-angle'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', _applyTransformInputs);
    });

    // ── Wire transform confirm/cancel (panel + floating bar) ──
    const _confirmTransform = () => {
        if (Pixoto.activeTool === 'transform') transformTool.confirmTransform();
    };
    const _cancelTransform = () => {
        if (Pixoto.activeTool === 'transform') transformTool.cancelTransform();
    };

    $('#btn-transform-confirm')?.addEventListener('click', _confirmTransform);
    $('#btn-transform-cancel')?.addEventListener('click',  _cancelTransform);
    $('#btn-transform-confirm-float')?.addEventListener('click', _confirmTransform);
    $('#btn-transform-cancel-float')?.addEventListener('click',  _cancelTransform);

    // ── Wire flip buttons ──
    $('#btn-flip-h')?.addEventListener('click', () => {
        if (Pixoto.activeTool === 'transform') transformTool.flipHorizontal();
    });
    $('#btn-flip-v')?.addEventListener('click', () => {
        if (Pixoto.activeTool === 'transform') transformTool.flipVertical();
    });

    // ── Wire crop tool confirm/cancel buttons ──
    $('#btn-crop-confirm')?.addEventListener('click', () => {
        if (Pixoto.historyManager) Pixoto.historyManager.saveSnapshot('Crop');
        cropTool.confirmCrop();
    });
    $('#btn-crop-cancel')?.addEventListener('click', () => {
        cropTool.cancelCrop();
    });
    // Crop aspect ratio buttons
    $$('[data-crop-aspect]').forEach((btn) => {
        btn.addEventListener('click', () => {
            $$('[data-crop-aspect]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            const val = btn.dataset.cropAspect;
            if (val === 'free') {
                cropTool.setAspectRatio(null, null);
            } else {
                const [w, h] = val.split(':').map(Number);
                cropTool.setAspectRatio(w, h);
            }
        });
    });

    // ── Wire pixelate block size slider ──
    $('#pixelate-block-size')?.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        pixelateBrush.blockSize = v;
        pixelateRect.blockSize = v;
        pixelSort.threshold = v;
        const val = e.target.parentElement?.querySelector('.slider-val');
        if (val) val.textContent = `${v}px`;
    });

    // ── Wire pixelate mode buttons ──
    Pixoto._pixelateMode = 'pixelate-brush';
    $$('[data-pixelate-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
            $$('[data-pixelate-mode]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            const mode = btn.dataset.pixelateMode;
            const modeMap = { 'brush': 'pixelate-brush', 'rect': 'pixelate-rect', 'sort': 'pixel-sort' };
            Pixoto._pixelateMode = modeMap[mode] || 'pixelate-brush';
            if (Pixoto.activeTool === 'pixelate') {
                Pixoto.toolManager.switchTool(Pixoto._pixelateMode);
            }
        });
    });

    // ── Wire Text Tool options ──
    $('#text-font-family')?.addEventListener('change', (e) => {
        Pixoto.toolManager.textFontFamily = e.target.value;
        textTool._syncTextareaStyle?.();
    });
    $('#text-font-size')?.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        Pixoto.toolManager.textFontSize = v;
        const val = $('#text-font-size-val');
        if (val) val.textContent = `${v}px`;
        textTool._syncTextareaStyle?.();
    });
    $('#btn-text-bold')?.addEventListener('click', () => {
        Pixoto.toolManager.textBold = !Pixoto.toolManager.textBold;
        $('#btn-text-bold')?.classList.toggle('active', Pixoto.toolManager.textBold);
        textTool._syncTextareaStyle?.();
    });
    $('#btn-text-italic')?.addEventListener('click', () => {
        Pixoto.toolManager.textItalic = !Pixoto.toolManager.textItalic;
        $('#btn-text-italic')?.classList.toggle('active', Pixoto.toolManager.textItalic);
        textTool._syncTextareaStyle?.();
    });
    $('#btn-text-underline')?.addEventListener('click', () => {
        Pixoto.toolManager.textUnderline = !Pixoto.toolManager.textUnderline;
        $('#btn-text-underline')?.classList.toggle('active', Pixoto.toolManager.textUnderline);
        textTool._syncTextareaStyle?.();
    });
    $$('[data-text-align]').forEach((btn) => {
        btn.addEventListener('click', () => {
            $$('[data-text-align]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            Pixoto.toolManager.textAlign = btn.dataset.textAlign;
            textTool._syncTextareaStyle?.();
        });
    });
    // Init text tool defaults
    Pixoto.toolManager.textFontSize   = 24;
    Pixoto.toolManager.textFontFamily = 'Arial, sans-serif';
    Pixoto.toolManager.textBold       = false;
    Pixoto.toolManager.textItalic     = false;
    Pixoto.toolManager.textUnderline  = false;
    Pixoto.toolManager.textAlign      = 'left';

    // ── Wire Smudge options ──
    $('#smudge-size')?.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        smudgeTool.size = v;
        const val = $('#smudge-size-val');
        if (val) val.textContent = `${v}px`;
    });
    $('#smudge-strength')?.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        smudgeTool.strength = v / 100;
        const val = $('#smudge-strength-val');
        if (val) val.textContent = `${v}%`;
    });

    // ── Wire Dodge options ──
    $('#dodge-size')?.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        dodgeTool.size = v;
        const val = $('#dodge-size-val');
        if (val) val.textContent = `${v}px`;
    });
    $('#dodge-exposure')?.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        dodgeTool.exposure = v / 100;
        const val = $('#dodge-exposure-val');
        if (val) val.textContent = `${v}%`;
    });
    $$('[data-dodge-range]').forEach((btn) => {
        btn.addEventListener('click', () => {
            $$('[data-dodge-range]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            dodgeTool.range = btn.dataset.dodgeRange;
        });
    });

    // ── Wire Burn options ──
    $('#burn-size')?.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        burnTool.size = v;
        const val = $('#burn-size-val');
        if (val) val.textContent = `${v}px`;
    });
    $('#burn-exposure')?.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        burnTool.exposure = v / 100;
        const val = $('#burn-exposure-val');
        if (val) val.textContent = `${v}%`;
    });
    $$('[data-burn-range]').forEach((btn) => {
        btn.addEventListener('click', () => {
            $$('[data-burn-range]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            burnTool.range = btn.dataset.burnRange;
        });
    });

    // ── Wire Clone Stamp options ──
    $('#clone-size')?.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        cloneStampTool.size = v;
        const val = $('#clone-size-val');
        if (val) val.textContent = `${v}px`;
    });
    $('#clone-opacity')?.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        cloneStampTool.opacity = v / 100;
        const val = $('#clone-opacity-val');
        if (val) val.textContent = `${v}%`;
    });
    // Keep clone source status label updated
    cloneStampTool.onSourceSet = (x, y) => {
        const el = $('#clone-source-status');
        if (el) el.textContent = `Source: ${Math.round(x)}, ${Math.round(y)}`;
    };

    // ── Filter Dialog (Phase F) ──
    Pixoto.filterDialog = new FilterDialog({
        dialog:   document.getElementById('filter-dialog'),
        title:    document.getElementById('filter-dialog-title'),
        preview:  document.getElementById('filter-preview-canvas'),
        controls: document.getElementById('filter-controls'),
        btnApply: document.getElementById('filter-apply'),
        btnCancel: document.getElementById('filter-cancel'),
        engine:   Pixoto.engine,
        history:  null, // will be set after historyManager init below
    });

    // ── Layer Styles Dialog (P6) ──
    Pixoto.layerStylesDialog = new LayerStylesDialog({
        dialog:   document.getElementById('layer-styles-dialog'),
        title:    document.getElementById('layer-styles-title'),
        controls: document.getElementById('layer-styles-controls'),
        btnClose: document.getElementById('layer-styles-close'),
        engine:   Pixoto.engine,
        history:  null, // set after historyManager init below
    });

    // ── Animation Timeline (P7) ──
    Pixoto.animation = new AnimationManager(Pixoto.engine);
    Pixoto.timeline = new Timeline({
        panel: document.getElementById('timeline-panel'),
        anim: Pixoto.animation,
        onExport: () => Pixoto.exportAnim?.open(),
    });
    Pixoto.exportAnim = new ExportAnimation({
        dialog:    document.getElementById('export-anim-dialog'),
        title:     document.getElementById('export-anim-title'),
        controls:  document.getElementById('export-anim-controls'),
        btnGo:     document.getElementById('export-anim-go'),
        btnCancel: document.getElementById('export-anim-cancel'),
        anim:      Pixoto.animation,
        engine:    Pixoto.engine,
    });
    // Full resync on structural/active-frame change; lightweight highlight during playback
    Pixoto.animation.onChange = () => {
        if (Pixoto.timeline && Pixoto.timeline.visible) Pixoto.timeline.render();
        if (Pixoto.layersPanel) Pixoto.layersPanel.render();
    };
    Pixoto.animation.onFrameStep = (i) => {
        if (Pixoto.timeline && Pixoto.timeline.visible) Pixoto.timeline.updateActive(i);
    };
    Pixoto.animation.onPlayStateChange = (p) => { if (Pixoto.timeline) Pixoto.timeline.setPlayingUI(p); };
    if (Pixoto.historyManager) Pixoto.historyManager.animation = Pixoto.animation;

    // ── Rulers & Guides (P9) ──
    Pixoto.rulerGuides = new RulerGuides({
        engine: Pixoto.engine,
        rulerH: document.getElementById('ruler-h'),
        rulerV: document.getElementById('ruler-v'),
        guidesCanvas: document.getElementById('guides-canvas'),
        isVisible: () => Pixoto.rulersVisible,
    });
    // Redraw rulers/guides whenever the view transform changes
    Pixoto.engine.onViewTransform = () => Pixoto.rulerGuides.redraw();
    // Status-bar rotation indicator
    Pixoto.engine.onRotationChange = (deg) => {
        const ind = document.getElementById('view-rotation-indicator');
        const val = document.getElementById('view-rotation-value');
        if (!ind) return;
        const r = Math.round(deg);
        const on = Math.abs(r) > 0.5;
        ind.hidden = !on;
        if (val) val.textContent = `${r}°`;
    };
    setupViewAids();

    // ── Save history snapshot before drawing operations ──
    // Hook into tool manager pointer events for auto-snapshots
    if (Pixoto.toolManager.viewport) {
        Pixoto.toolManager.viewport.addEventListener('pointerdown', (e) => {
            // Save snapshot before any drawing tool stroke begins
            const tool = Pixoto.toolManager._activeTool;
            if (tool && Pixoto.historyManager) {
                const drawingTools = ['brush', 'eraser', 'fill', 'pixelate-brush', 'pixelate-rect', 'pixel-sort',
                                      'smudge', 'dodge', 'burn', 'clone-stamp'];
                if (drawingTools.includes(tool.name)) {
                    Pixoto.historyManager.saveSnapshot(tool.name.charAt(0).toUpperCase() + tool.name.slice(1));
                }
            }
        }, { capture: true }); // capture: fires BEFORE the tool handler
    }

    // Wire engine callbacks
    Pixoto.engine.onZoomChange = (zoomPercent) => {
        Pixoto.zoom = zoomPercent;
        if (DOM.zoomDisplay) DOM.zoomDisplay.textContent = `${zoomPercent}%`;
    };

    Pixoto.engine.onCursorMove = (x, y) => {
        if (DOM.cursorPos) {
            DOM.cursorPos.textContent = `x: ${x}  y: ${y}`;
        }
    };

    Pixoto.engine.onThreeFingerTap = () => {
        performUndo();
    };

    // Check for saved session
    checkSessionRestore();

    // Initialize default canvas (behind dialog if first launch)
    initCanvas();

    // Save initial state to history
    if (Pixoto.historyManager) {
        Pixoto.historyManager.saveSnapshot('New Canvas');
    }

    // Start auto-save
    if (Pixoto.fileManager) {
        Pixoto.fileManager.startAutoSave();
    }

    // Show new canvas dialog on first launch for customization
    const hasLaunched = localStorage.getItem('pixoto-launched');
    if (!hasLaunched) {
        openModal(DOM.newCanvasDialog);
        localStorage.setItem('pixoto-launched', 'true');
    }

    // Update initial color display
    updateColorDisplay();

    // Show brush tool options by default
    showToolOptions('brush');

    console.log('[Pixoto] Ready — All systems active (Phases 1-8)');
}

// Run when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
