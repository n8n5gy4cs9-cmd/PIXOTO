/* ═══════════════════════════════════════════════════════════════
   Pixoto — Layers Panel (Phase 6 + Phase B)
   Dynamic layer list, thumbnails, visibility/lock toggles,
   name editing, drag reorder, blend mode & opacity controls.
   Phase B: mask thumbnails, alpha lock, clip-to-below badges.
   ═══════════════════════════════════════════════════════════════ */

import { showMaskContextMenu } from './mask-utils.js';
import { AdjustmentLayer } from '../filters/filters.js';
import { hasEnabledEffect } from '../layer-styles.js';

export class LayersPanel {
    /**
     * @param {import('../canvas-engine.js').CanvasEngine} engine
     * @param {object} opts
     * @param {HTMLElement} opts.listEl       - #layers-list container
     * @param {HTMLElement} opts.mobileListEl - #mobile-layers-list container
     * @param {HTMLSelectElement} opts.blendSelect   - #blend-mode <select>
     * @param {HTMLInputElement} opts.opacitySlider  - #layer-opacity <input>
     * @param {HTMLElement} opts.opacityVal          - #layer-opacity-val <span>
     */
    constructor(engine, opts) {
        this.engine = engine;
        this.listEl = opts.listEl;
        this.mobileListEl = opts.mobileListEl;
        this.blendSelect = opts.blendSelect;
        this.opacitySlider = opts.opacitySlider;
        this.opacityVal = opts.opacityVal;

        /** Optional HistoryManager reference for mask operations. */
        this.history = opts.history || null;

        // Thumbnail debounce timer
        this._thumbTimer = null;
        this._thumbDelay = 250;

        // Drag state
        this._dragIndex = null;

        // Long-press for mask context (mobile)
        this._longPressTimer = null;

        // Bind engine callbacks — chain with any existing callbacks instead of overwriting
        const prevLayerChange = this.engine.onLayerChange;
        this.engine.onLayerChange = () => {
            if (prevLayerChange) prevLayerChange();
            this.render();
        };
        const prevActiveChange = this.engine.onActiveLayerChange;
        this.engine.onActiveLayerChange = (idx) => {
            if (prevActiveChange) prevActiveChange(idx);
            this._onActiveChanged(idx);
        };
        this.engine.onActiveMemberChange = () => {
            this._syncControls();
        };

        // Wire blend mode & opacity
        this._wireControls();

        // Wire mask editing banner
        this._wireMaskBanner();

        // Initial render
        this.render();
    }

    /** @private Wire the mask editing banner and its exit button. */
    _wireMaskBanner() {
        const banner = document.getElementById('mask-editing-banner');
        const exitBtn = document.getElementById('btn-exit-mask-edit');
        if (exitBtn) {
            exitBtn.addEventListener('click', () => this.engine.setActiveTarget('layer'));
        }
        this.engine.onActiveTargetChange = (target) => {
            if (banner) banner.hidden = (target !== 'mask');
            this.render();
        };
    }

    /** Full re-render of the layer list. */
    render() {
        this._renderList(this.listEl);
        if (this.mobileListEl) this._renderList(this.mobileListEl);
        this._syncControls();
        this._scheduleThumbnails();
    }

    /**
     * Render member items into a container, in top-first order (tree-aware).
     * @private
     */
    _renderList(container) {
        if (!container) return;
        container.innerHTML = '';
        const activeMember = this.engine.activeMember;
        const activeIdx = this.engine.activeLayerIndex;

        const renderMembers = (members, depth) => {
            for (let i = members.length - 1; i >= 0; i--) {
                const member = members[i];
                if (member instanceof Object && member.children !== undefined && !member.canvas) {
                    // LayerGroup
                    const isActiveGroup = (activeMember === member);
                    const groupItem = this._createGroupItem(member, depth, isActiveGroup);
                    container.appendChild(groupItem);
                    if (!member.collapsed) {
                        renderMembers(member.children, depth + 1);
                    }
                } else {
                    // Layer
                    const layerIndex = this.engine.layers.indexOf(member);
                    const isActive = (activeMember === member || layerIndex === activeIdx);
                    const item = this._createLayerItem(member, layerIndex, isActive, depth);
                    container.appendChild(item);
                }
            }
        };

        renderMembers(this.engine.members || this.engine.layers, 0);
    }

    /**
     * Create a group header item in the layers list.
     * @private
     */
    _createGroupItem(group, depth, isActive) {
        const item = document.createElement('div');
        item.className = `layer-item group-item${isActive ? ' active' : ''}`;
        item.dataset.groupId = group.id;
        item.style.paddingLeft = `${6 + depth * 16}px`;

        // Collapse toggle
        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'layer-visibility group-collapse';
        collapseBtn.title = group.collapsed ? 'Expand group' : 'Collapse group';
        collapseBtn.innerHTML = `<svg class="icon icon-sm"><use href="#icon-${group.collapsed ? 'chevron-right' : 'chevron-down'}"/></svg>`;
        collapseBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            this.engine.toggleGroupCollapsed(group);
        });

        // Group icon
        const groupIcon = document.createElement('span');
        groupIcon.className = 'group-icon';
        groupIcon.innerHTML = `<svg class="icon"><use href="#icon-group"/></svg>`;

        // Name
        const nameSpan = document.createElement('span');
        nameSpan.className = 'layer-name';
        nameSpan.textContent = group.name;
        nameSpan.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            nameSpan.contentEditable = 'true';
            nameSpan.focus();
            const range = document.createRange();
            range.selectNodeContents(nameSpan);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
        });
        nameSpan.addEventListener('blur', () => {
            nameSpan.contentEditable = 'false';
            group.name = nameSpan.textContent.trim() || group.name;
        });
        nameSpan.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); nameSpan.blur(); }
        });

        // Visibility
        const visBtn = document.createElement('button');
        visBtn.className = 'layer-visibility';
        visBtn.title = 'Toggle group visibility';
        visBtn.innerHTML = `<svg class="icon"><use href="#icon-${group.visible ? 'eye' : 'eye-off'}"/></svg>`;
        visBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            group.visible = !group.visible;
            this.engine.requestComposite();
            this.render();
        });

        // Lock
        const lockBtn = document.createElement('button');
        lockBtn.className = `layer-lock${group.locked ? ' locked' : ''}`;
        lockBtn.title = group.locked ? 'Unlock group' : 'Lock group';
        lockBtn.innerHTML = `<svg class="icon"><use href="#icon-${group.locked ? 'lock' : 'unlock'}"/></svg>`;
        lockBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            group.locked = !group.locked;
            this.render();
        });

        // Click to select group (for opacity/blend controls)
        item.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button') || e.target.contentEditable === 'true') return;
            this.engine.setActiveGroup(group);
            this.render();
        });

        // Right-click: group context menu
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this._showGroupContextMenu(group, e.clientX, e.clientY);
        });

        item.appendChild(collapseBtn);
        item.appendChild(visBtn);
        item.appendChild(groupIcon);
        item.appendChild(nameSpan);
        item.appendChild(lockBtn);
        return item;
    }

    /** @private Show context menu for group operations. */
    _showGroupContextMenu(group, x, y) {
        document.getElementById('group-context-menu')?.remove();
        const menu = document.createElement('div');
        menu.id = 'group-context-menu';
        menu.className = 'context-menu';
        const items = [
            { label: 'Ungroup',       action: () => { if (this.history) this.history.saveSnapshot('Ungroup'); this.engine.ungroup(group); } },
            { label: 'Merge Group',   action: () => { if (this.history) this.history.saveSnapshot('Merge Group'); this.engine.mergeGroup(group); } },
            { label: 'Duplicate Group', action: () => { if (this.history) this.history.saveSnapshot('Duplicate Group'); this.engine.duplicateGroup(group); } },
            { divider: true },
            { label: 'Delete Group (keep children)', action: () => { if (this.history) this.history.saveSnapshot('Delete Group'); this.engine.deleteGroup(group, true); } },
            { label: 'Delete Group + Contents', action: () => { if (this.history) this.history.saveSnapshot('Delete Group'); this.engine.deleteGroup(group, false); }, danger: true },
        ];
        for (const item of items) {
            if (item.divider) { const d = document.createElement('div'); d.className = 'context-menu-divider'; menu.appendChild(d); continue; }
            const btn = document.createElement('button');
            btn.className = `context-menu-item${item.danger ? ' danger' : ''}`;
            btn.textContent = item.label;
            btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); menu.remove(); item.action(); });
            menu.appendChild(btn);
        }
        document.body.appendChild(menu);
        const vw = window.innerWidth, vh = window.innerHeight;
        menu.style.left = `${Math.min(x, vw - menu.offsetWidth - 8)}px`;
        menu.style.top  = `${Math.min(y, vh - menu.offsetHeight - 8)}px`;
        const dismiss = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', dismiss, true); } };
        setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
    }

    /**
     * Create a single layer item DOM element.
     * @param {Layer} layer
     * @param {number} index - Index in engine.layers
     * @param {boolean} isActive
     * @param {number} [depth=0] - Nesting depth for indentation
     * @private
     */
    _createLayerItem(layer, index, isActive, depth = 0) {
        const item = document.createElement('div');
        item.className = `layer-item${isActive ? ' active' : ''}`;
        item.dataset.layerIndex = index;
        if (depth > 0) item.style.paddingLeft = `${6 + depth * 16}px`;

        const isAdj = layer instanceof AdjustmentLayer;
        if (isAdj) item.classList.add('layer-item-adjustment');

        // Visibility toggle
        const visBtn = document.createElement('button');
        visBtn.className = 'layer-visibility';
        visBtn.title = 'Toggle visibility';
        visBtn.setAttribute('aria-label', 'Toggle visibility');
        visBtn.innerHTML = `<svg class="icon"><use href="#icon-${layer.visible ? 'eye' : 'eye-off'}"/></svg>`;
        visBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            layer.visible = !layer.visible;
            layer.markAllDirty();
            this.engine.requestComposite();
            this.render();
        });

        // Thumbnail canvas
        const thumb = document.createElement('canvas');
        thumb.className = 'layer-thumb';
        thumb.width = 40;
        thumb.height = 40;

        // Layer name (editable on double-click)
        const nameSpan = document.createElement('span');
        nameSpan.className = 'layer-name';
        nameSpan.textContent = layer.name;
        nameSpan.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            nameSpan.contentEditable = 'true';
            nameSpan.focus();
            // Select all text
            const range = document.createRange();
            range.selectNodeContents(nameSpan);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });
        nameSpan.addEventListener('blur', () => {
            nameSpan.contentEditable = 'false';
            layer.name = nameSpan.textContent.trim() || layer.name;
        });
        nameSpan.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                nameSpan.blur();
            }
        });

        // Lock toggle
        const lockBtn = document.createElement('button');
        lockBtn.className = `layer-lock${layer.locked ? ' locked' : ''}`;
        lockBtn.title = layer.locked ? 'Unlock layer' : 'Lock layer';
        lockBtn.setAttribute('aria-label', layer.locked ? 'Unlock layer' : 'Lock layer');
        lockBtn.innerHTML = `<svg class="icon"><use href="#icon-${layer.locked ? 'lock' : 'unlock'}"/></svg>`;
        lockBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            layer.locked = !layer.locked;
            this.render();
        });

        // Click to select + touch-friendly drag reorder using pointer events
        let startY = 0;
        let isDragging = false;
        let dragThreshold = 8;

        item.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button') || e.target.contentEditable === 'true') return;
            startY = e.clientY;
            isDragging = false;
            this._dragIndex = index;
            // Select this layer immediately on tap
            this.engine.setActiveLayer(index);

            const onMove = (me) => {
                if (!isDragging && Math.abs(me.clientY - startY) > dragThreshold) {
                    isDragging = true;
                    item.classList.add('dragging');
                    item.setPointerCapture(me.pointerId);
                }
                if (!isDragging) return;

                // Find which item we're hovering over
                const items = [...listEl.querySelectorAll('.layer-item')];
                for (let i = 0; i < items.length; i++) {
                    const rect = items[i].getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    items[i].classList.toggle('drag-over', i !== this._dragIndex && me.clientY > rect.top && me.clientY < rect.bottom);
                }
            };

            const onUp = (ue) => {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                item.classList.remove('dragging');

                if (isDragging && this._dragIndex !== null) {
                    // Find drop target
                    const items = [...listEl.querySelectorAll('.layer-item')];
                    for (let i = 0; i < items.length; i++) {
                        items[i].classList.remove('drag-over');
                        if (i !== this._dragIndex) {
                            const rect = items[i].getBoundingClientRect();
                            if (ue.clientY > rect.top && ue.clientY < rect.bottom) {
                                this.engine.reorderLayer(this._dragIndex, i);
                                break;
                            }
                        }
                    }
                }
                this._dragIndex = null;
                isDragging = false;
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        });

        // ── Mask thumbnail ──────────────────────────────────────
        const maskThumb = document.createElement('canvas');
        maskThumb.className = 'layer-mask-thumb';
        maskThumb.width = 40;
        maskThumb.height = 40;
        maskThumb.title = layer.mask
            ? 'Mask — click to edit, Shift+click to toggle, Alt+click to view, right-click for options'
            : 'Right-click to add mask';

        if (layer.mask) {
            // Highlight active target
            const isEditingMask = (this.engine.activeTarget === 'mask' &&
                this.engine.activeLayerIndex === index);
            if (isEditingMask) maskThumb.classList.add('mask-thumb-active');
            if (!layer.maskEnabled) maskThumb.classList.add('mask-disabled');
            if (layer === this.engine.maskViewLayer) maskThumb.classList.add('mask-view-active');
        } else {
            maskThumb.classList.add('mask-thumb-empty');
        }

        // Click: switch draw target to mask / layer
        maskThumb.addEventListener('click', (e) => {
            if (!layer.mask) return;
            if (e.shiftKey) {
                this.engine.toggleMaskEnabled(index);
                return;
            }
            if (e.altKey) {
                const isViewActive = (layer === this.engine.maskViewLayer);
                this.engine.setMaskViewMode(layer, !isViewActive);
                this.render();
                return;
            }
            this.engine.setActiveLayer(index);
            this.engine.setActiveTarget('mask');
        });

        // Right-click / long-press: mask context menu
        maskThumb.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showMaskContextMenu(this.engine, layer, e.clientX, e.clientY, this.history);
        });

        // Long-press for mobile
        maskThumb.addEventListener('pointerdown', (e) => {
            clearTimeout(this._longPressTimer);
            this._longPressTimer = setTimeout(() => {
                showMaskContextMenu(this.engine, layer, e.clientX, e.clientY, this.history);
            }, 500);
        });
        maskThumb.addEventListener('pointerup', () => clearTimeout(this._longPressTimer));
        maskThumb.addEventListener('pointercancel', () => clearTimeout(this._longPressTimer));

        // Click layer thumb: switch back to layer target
        thumb.addEventListener('click', (e) => {
            if (this.engine.activeTarget === 'mask' && this.engine.activeLayerIndex === index) {
                this.engine.setActiveTarget('layer');
            }
        });

        // Double-click an adjustment layer thumb → re-open its editor
        if (isAdj) {
            thumb.title = 'Double-click to edit adjustment';
            thumb.style.cursor = 'pointer';
            thumb.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                window.Pixoto?.filterDialog?.openForEdit(layer);
            });
        }

        // Highlight layer thumb when active and in layer mode
        const isEditingLayer = (this.engine.activeTarget === 'layer' && isActive);
        if (isEditingLayer) thumb.classList.add('layer-thumb-active');

        // ── Badges (alpha lock, clip) ──
        const badges = document.createElement('div');
        badges.className = 'layer-badges';
        if (isAdj) {
            const fx = document.createElement('span');
            fx.className = 'layer-badge badge-adjustment';
            fx.title = `Adjustment: ${layer.name}`;
            fx.textContent = 'fx';
            badges.appendChild(fx);
        }
        if (layer.alphaLocked) {
            const al = document.createElement('span');
            al.className = 'layer-badge badge-alpha-lock';
            al.title = 'Alpha Locked';
            al.textContent = 'α';
            badges.appendChild(al);
        }
        if (layer.clippedToBelow) {
            const cl = document.createElement('span');
            cl.className = 'layer-badge badge-clip';
            cl.title = 'Clipped to Layer Below';
            cl.textContent = '↓';
            badges.appendChild(cl);
        }
        if (!isAdj) {
            const fx = document.createElement('span');
            const on = hasEnabledEffect(layer.effects);
            fx.className = `layer-badge badge-fx${on ? ' badge-fx-active' : ''}`;
            fx.title = on ? 'Layer Styles (on) — tap to edit' : 'Layer Styles — tap to add';
            fx.textContent = 'fx';
            fx.style.cursor = 'pointer';
            fx.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                window.Pixoto?.layerStylesDialog?.open(layer);
            });
            badges.appendChild(fx);
        }

        item.appendChild(visBtn);
        item.appendChild(thumb);
        item.appendChild(maskThumb);
        item.appendChild(nameSpan);
        if (badges.children.length > 0) item.appendChild(badges);
        item.appendChild(lockBtn);

        return item;
    }

    /**
     * Schedule thumbnail rendering with debounce.
     * @private
     */
    _scheduleThumbnails() {
        clearTimeout(this._thumbTimer);
        this._thumbTimer = setTimeout(() => this._renderThumbnails(), this._thumbDelay);
    }

    /**
     * Render layer and mask thumbnails for all layer items.
     * @private
     */
    _renderThumbnails() {
        const containers = [this.listEl, this.mobileListEl].filter(Boolean);
        for (const container of containers) {
            const items = container.querySelectorAll('.layer-item');
            items.forEach((item) => {
                const idx = parseInt(item.dataset.layerIndex);
                const layer = this.engine.getLayer(idx);
                if (!layer) return;

                // ── Layer thumbnail ──
                const thumb = item.querySelector('.layer-thumb');
                if (thumb) {
                    const ctx = thumb.getContext('2d');
                    ctx.clearRect(0, 0, 40, 40);
                    if (layer instanceof AdjustmentLayer && layer.getThumbnail) {
                        // Adjustment layers render a distinct "fx" swatch
                        ctx.drawImage(layer.getThumbnail(40), 0, 0);
                    } else {
                        const checkSize = 5;
                        for (let y = 0; y < 40; y += checkSize) {
                            for (let x = 0; x < 40; x += checkSize) {
                                ctx.fillStyle = ((x / checkSize + y / checkSize) % 2 === 0) ? '#ccc' : '#999';
                                ctx.fillRect(x, y, checkSize, checkSize);
                            }
                        }
                        const lw = layer.canvas.width;
                        const lh = layer.canvas.height;
                        const scale = Math.min(40 / lw, 40 / lh);
                        const dw = lw * scale;
                        const dh = lh * scale;
                        ctx.drawImage(layer.canvas, (40 - dw) / 2, (40 - dh) / 2, dw, dh);
                    }
                }

                // ── Mask thumbnail ──
                const maskThumb = item.querySelector('.layer-mask-thumb');
                if (maskThumb) {
                    const mCtx = maskThumb.getContext('2d');
                    mCtx.clearRect(0, 0, 40, 40);
                    if (layer.mask) {
                        // Checkerboard for transparent areas
                        const checkSize = 5;
                        for (let y = 0; y < 40; y += checkSize) {
                            for (let x = 0; x < 40; x += checkSize) {
                                mCtx.fillStyle = ((x / checkSize + y / checkSize) % 2 === 0) ? '#ccc' : '#999';
                                mCtx.fillRect(x, y, checkSize, checkSize);
                            }
                        }
                        const mw = layer.mask.width;
                        const mh = layer.mask.height;
                        const scale = Math.min(40 / mw, 40 / mh);
                        mCtx.drawImage(layer.mask, (40 - mw * scale) / 2, (40 - mh * scale) / 2, mw * scale, mh * scale);
                        // Disabled overlay
                        if (!layer.maskEnabled) {
                            mCtx.fillStyle = 'rgba(0,0,0,0.5)';
                            mCtx.fillRect(0, 0, 40, 40);
                            mCtx.strokeStyle = '#ff3860';
                            mCtx.lineWidth = 2;
                            mCtx.beginPath();
                            mCtx.moveTo(4, 4); mCtx.lineTo(36, 36);
                            mCtx.moveTo(36, 4); mCtx.lineTo(4, 36);
                            mCtx.stroke();
                        }
                    } else {
                        // Empty placeholder
                        mCtx.fillStyle = '#2a2a36';
                        mCtx.fillRect(0, 0, 40, 40);
                        mCtx.strokeStyle = '#44445a';
                        mCtx.lineWidth = 1;
                        mCtx.strokeRect(1, 1, 38, 38);
                    }
                }
            });
        }
    }

    /**
     * Handle active layer or group change.
     * @private
     */
    _onActiveChanged(activeIdx) {
        const activeMember = this.engine.activeMember;
        [this.listEl, this.mobileListEl].filter(Boolean).forEach((container) => {
            container.querySelectorAll('.layer-item').forEach((item) => {
                if (item.dataset.groupId) {
                    // Group header: active if it matches activeMember
                    const isActive = activeMember && activeMember.id === parseInt(item.dataset.groupId);
                    item.classList.toggle('active', !!isActive);
                } else {
                    const idx = parseInt(item.dataset.layerIndex);
                    item.classList.toggle('active', idx === activeIdx);
                }
            });
        });
        this._syncControls();
    }

    /**
     * Sync blend mode and opacity controls to the active member (layer or group).
     * @private
     */
    /**
     * Resolve the member the blend/opacity controls should target.
     * Groups are tracked by `activeMember`; a normal/adjustment layer is the
     * one the panel highlights — i.e. `layers[activeLayerIndex]` — because some
     * engine mutations (addLayer, duplicate, merge…) leave `activeMember` stale.
     * @private
     */
    _controlMember() {
        const m = this.engine.activeMember;
        if (m && m.children !== undefined && !m.canvas) return m; // LayerGroup
        return this.engine.layers[this.engine.activeLayerIndex] || m || this.engine.getActiveLayer();
    }

    _syncControls() {
        const member = this._controlMember();
        if (!member) return;

        if (this.blendSelect) {
            this.blendSelect.value = member.blendMode;
        }
        if (this.opacitySlider) {
            this.opacitySlider.value = Math.round(member.opacity * 100);
        }
        if (this.opacityVal) {
            this.opacityVal.textContent = `${Math.round(member.opacity * 100)}%`;
        }
    }

    /**
     * Wire blend mode select and opacity slider to active member (layer or group).
     * @private
     */
    _wireControls() {
        if (this.blendSelect) {
            this.blendSelect.addEventListener('change', () => {
                const member = this._controlMember();
                if (!member) return;
                member.blendMode = this.blendSelect.value;
                if (member.markAllDirty) member.markAllDirty();
                this.engine.requestComposite();
            });
        }

        if (this.opacitySlider) {
            this.opacitySlider.addEventListener('input', () => {
                const member = this._controlMember();
                if (!member) return;
                member.opacity = parseInt(this.opacitySlider.value) / 100;
                if (this.opacityVal) {
                    this.opacityVal.textContent = `${this.opacitySlider.value}%`;
                }
                if (member.markAllDirty) member.markAllDirty();
                this.engine.requestComposite();
            });
        }
    }
}
