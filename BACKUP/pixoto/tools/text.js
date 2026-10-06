/* ═══════════════════════════════════════════════════════════════
   Pixoto — Text Tool (Phase E)
   Click-to-place text overlay. Rasterizes to active layer on confirm.
   PixiEditor reference: TextToolViewModel.cs + TextOverlay.cs
   ═══════════════════════════════════════════════════════════════ */

import { Tool } from '../tool-manager.js';

export class TextTool extends Tool {
    constructor(manager) {
        super('text', manager);

        this._overlay = null;
        this._textarea = null;
        this._handle = null;

        this._isEditing = false;
        this._canvasX = 0;
        this._canvasY = 0;

        // For drag-to-move the text box
        this._dragging = false;
        this._dragStartScreenX = 0;
        this._dragStartScreenY = 0;
        this._dragStartLeft = 0;
        this._dragStartTop = 0;

        this._onTextareaKey = this._onTextareaKey.bind(this);
        this._onHandleDown = this._onHandleDown.bind(this);
        this._onHandleMove = this._onHandleMove.bind(this);
        this._onHandleUp = this._onHandleUp.bind(this);
    }

    activate() {
        this._overlay  = document.getElementById('text-overlay');
        this._textarea = document.getElementById('text-textarea');
        this._handle   = document.getElementById('text-drag-handle');

        this._textarea?.addEventListener('keydown', this._onTextareaKey);
        this._handle?.addEventListener('pointerdown', this._onHandleDown);
        document.getElementById('btn-text-confirm')?.addEventListener('click', () => this.confirmText());
        document.getElementById('btn-text-cancel')?.addEventListener('click',  () => this.cancelText());
    }

    deactivate() {
        this.cancelText();
        this._textarea?.removeEventListener('keydown', this._onTextareaKey);
        this._handle?.removeEventListener('pointerdown', this._onHandleDown);
    }

    getCursor() { return 'text'; }


    // ─── Pointer Events ────────────────────────────────────────

    onPointerDown(cx, cy, e) {
        if (this._isEditing) {
            // Clicks outside the overlay confirm and start a new text box
            const box = this._overlay?.getBoundingClientRect();
            if (!box || e.clientX < box.left - 4 || e.clientX > box.right + 4 ||
                e.clientY < box.top - 4 || e.clientY > box.bottom + 4) {
                this.confirmText();
                this._startEditing(cx, cy, e);
            }
            return;
        }
        this._startEditing(cx, cy, e);
    }


    // ─── Editing Lifecycle ─────────────────────────────────────

    _startEditing(cx, cy, e) {
        this._canvasX = Math.round(cx);
        this._canvasY = Math.round(cy);

        const eng = this.manager.engine;
        // canvasToScreen returns client-space coords; text overlay is position:fixed
        const sp  = eng.canvasToScreen(cx, cy);

        if (this._overlay) {
            this._overlay.style.left = `${sp.x}px`;
            this._overlay.style.top  = `${sp.y}px`;
            this._overlay.hidden = false;
            this._syncTextareaStyle();
        }

        this._isEditing = true;

        if (this._textarea) {
            this._textarea.value = '';
            this._textarea.style.height = 'auto';
            // Slight delay so the overlay renders before focus (mobile keyboards)
            requestAnimationFrame(() => this._textarea?.focus());
        }
    }

    confirmText() {
        if (!this._isEditing) return;
        const text = this._textarea?.value ?? '';

        if (text.trim()) {
            const eng   = this.manager.engine;
            const layer = eng.getActiveLayer();
            if (layer && !layer.locked) {
                if (typeof window !== 'undefined' && window.Pixoto?.historyManager) {
                    window.Pixoto.historyManager.saveSnapshot('Text');
                }
                this._rasterize(layer, text);
                eng.requestComposite();
            }
        }

        this._hideOverlay();
    }

    cancelText() {
        this._hideOverlay();
    }

    _hideOverlay() {
        this._isEditing = false;
        if (this._overlay) this._overlay.hidden = true;
        if (this._textarea) this._textarea.value = '';
    }


    // ─── Rasterize text onto layer canvas ─────────────────────

    _rasterize(layer, text) {
        const m          = this.manager;
        const fontSize   = m.textFontSize   ?? 24;
        const fontFamily = m.textFontFamily ?? 'Arial, sans-serif';
        const bold       = m.textBold       ? 'bold'   : 'normal';
        const italic     = m.textItalic     ? 'italic' : 'normal';
        const underline  = m.textUnderline  ?? false;
        const align      = m.textAlign      ?? 'left';
        const color      = m.foregroundColor ?? '#000000';

        const ctx = layer.ctx;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle   = color;
        ctx.strokeStyle = color;
        ctx.font        = `${italic} ${bold} ${fontSize}px ${fontFamily}`;
        ctx.textAlign   = align;
        ctx.textBaseline = 'top';

        const lines      = text.split('\n');
        const lineHeight = fontSize * 1.25;
        let y = this._canvasY;

        for (const line of lines) {
            ctx.fillText(line, this._canvasX, y);
            if (underline && line) {
                const metrics = ctx.measureText(line);
                const uy = y + fontSize + Math.max(1, fontSize * 0.05);
                let lx = this._canvasX;
                if (align === 'center') lx -= metrics.width / 2;
                else if (align === 'right') lx -= metrics.width;
                ctx.lineWidth = Math.max(1, Math.round(fontSize / 15));
                ctx.beginPath();
                ctx.moveTo(lx, uy);
                ctx.lineTo(lx + metrics.width, uy);
                ctx.stroke();
            }
            y += lineHeight;
        }
        ctx.restore();
        layer.markAllDirty();
    }


    // ─── Textarea keyboard handler ─────────────────────────────

    _onTextareaKey(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.cancelText();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            this.confirmText();
        }
    }


    // ─── Drag handle: move the text overlay ───────────────────

    _onHandleDown(e) {
        e.preventDefault();
        e.stopPropagation();
        this._dragging = true;
        this._dragStartScreenX = e.clientX;
        this._dragStartScreenY = e.clientY;
        this._dragStartLeft = parseInt(this._overlay.style.left, 10) || 0;
        this._dragStartTop  = parseInt(this._overlay.style.top,  10) || 0;
        window.addEventListener('pointermove', this._onHandleMove);
        window.addEventListener('pointerup',   this._onHandleUp);
    }

    _onHandleMove(e) {
        if (!this._dragging) return;
        const dx = e.clientX - this._dragStartScreenX;
        const dy = e.clientY - this._dragStartScreenY;
        this._overlay.style.left = `${this._dragStartLeft + dx}px`;
        this._overlay.style.top  = `${this._dragStartTop  + dy}px`;

        // Update canvas anchor to follow drag
        // style.left/top are client coords (position:fixed)
        const eng    = this.manager.engine;
        const screenX = this._dragStartLeft + dx;
        const screenY = this._dragStartTop  + dy;
        const cp = eng.screenToCanvas(screenX, screenY);
        this._canvasX = Math.round(cp.x);
        this._canvasY = Math.round(cp.y);
    }

    _onHandleUp() {
        this._dragging = false;
        window.removeEventListener('pointermove', this._onHandleMove);
        window.removeEventListener('pointerup',   this._onHandleUp);
    }


    // ─── Update textarea visual style to match tool settings ──

    _syncTextareaStyle() {
        if (!this._textarea) return;
        const m    = this.manager;
        const zoom = m.engine.zoom;
        const fs   = (m.textFontSize ?? 24) * zoom;
        this._textarea.style.fontSize       = `${fs}px`;
        this._textarea.style.fontFamily     = m.textFontFamily ?? 'Arial, sans-serif';
        this._textarea.style.fontWeight     = m.textBold    ? 'bold'      : 'normal';
        this._textarea.style.fontStyle      = m.textItalic  ? 'italic'    : 'normal';
        this._textarea.style.textDecoration = m.textUnderline ? 'underline' : 'none';
        this._textarea.style.textAlign      = m.textAlign ?? 'left';
        this._textarea.style.color          = m.foregroundColor ?? '#000000';
    }
}
