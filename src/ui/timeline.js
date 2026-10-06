/* ═══════════════════════════════════════════════════════════════
   Pixoto — Timeline panel (P7)
   Frame strip + playback controls for the AnimationManager. Self-
   contained: builds its own toolbar + frame cells into #timeline-panel.
   Pointer-event drag reorder, per-frame duration, onion toggle.
   Works docked (desktop) and as a bottom sheet (mobile).
   ═══════════════════════════════════════════════════════════════ */

export class Timeline {
    /**
     * @param {object} opts
     * @param {HTMLElement} opts.panel - #timeline-panel container
     * @param {import('../animation.js').AnimationManager} opts.anim
     * @param {() => void} [opts.onExport] - open the export-animation dialog
     */
    constructor(opts) {
        this.panel = opts.panel;
        this.anim = opts.anim;
        this.onExport = opts.onExport || null;

        this._dragIndex = null;
        this._thumbTimer = null;

        this._buildChrome();
    }

    // ─── Static chrome (toolbar), built once ──────────────────────
    _buildChrome() {
        if (!this.panel) return;
        this.panel.innerHTML = '';

        const bar = document.createElement('div');
        bar.className = 'timeline-toolbar';

        this._playBtn = this._btn('Play', 'timeline-play', () => this.anim.togglePlay());
        bar.appendChild(this._playBtn);
        bar.appendChild(this._btn('+ Frame', '', () => this.anim.addFrame()));
        bar.appendChild(this._btn('Blank', '', () => this.anim.addFrame({ blank: true })));
        bar.appendChild(this._btn('Duplicate', '', () => this.anim.duplicateFrame()));
        bar.appendChild(this._btn('Delete', 'danger', () => this.anim.deleteFrame()));

        // FPS
        const fpsWrap = document.createElement('label');
        fpsWrap.className = 'timeline-field';
        fpsWrap.innerHTML = '<span>FPS</span>';
        this._fpsInput = document.createElement('input');
        this._fpsInput.type = 'number';
        this._fpsInput.min = '1'; this._fpsInput.max = '60';
        this._fpsInput.value = this.anim.fps;
        this._fpsInput.addEventListener('change', () => this.anim.setFps(parseInt(this._fpsInput.value) || 12));
        fpsWrap.appendChild(this._fpsInput);
        bar.appendChild(fpsWrap);

        // Loop
        const loopWrap = document.createElement('label');
        loopWrap.className = 'timeline-field';
        this._loopInput = document.createElement('input');
        this._loopInput.type = 'checkbox';
        this._loopInput.checked = this.anim.loop;
        this._loopInput.addEventListener('change', () => this.anim.setLoop(this._loopInput.checked));
        loopWrap.appendChild(this._loopInput);
        loopWrap.appendChild(Object.assign(document.createElement('span'), { textContent: 'Loop' }));
        bar.appendChild(loopWrap);

        // Onion
        const onionWrap = document.createElement('label');
        onionWrap.className = 'timeline-field';
        this._onionInput = document.createElement('input');
        this._onionInput.type = 'checkbox';
        this._onionInput.checked = this.anim.onion.enabled;
        this._onionInput.addEventListener('change', () => this.anim.setOnionEnabled(this._onionInput.checked));
        onionWrap.appendChild(this._onionInput);
        onionWrap.appendChild(Object.assign(document.createElement('span'), { textContent: 'Onion' }));
        bar.appendChild(onionWrap);

        bar.appendChild(this._btn('Export…', '', () => { if (this.onExport) this.onExport(); }));

        this._count = document.createElement('span');
        this._count.className = 'timeline-count';
        bar.appendChild(this._count);

        const close = this._btn('✕', 'timeline-close', () => this.hide());
        bar.appendChild(close);

        this.panel.appendChild(bar);

        this._framesEl = document.createElement('div');
        this._framesEl.className = 'timeline-frames';
        this.panel.appendChild(this._framesEl);
    }

    _btn(label, cls, onClick) {
        const b = document.createElement('button');
        b.className = `timeline-btn${cls ? ' ' + cls : ''}`;
        b.textContent = label;
        b.addEventListener('click', onClick);
        return b;
    }

    // ─── Frame strip ──────────────────────────────────────────────
    render() {
        if (!this._framesEl) return;
        this._framesEl.innerHTML = '';

        for (let i = 0; i < this.anim.count; i++) {
            const cell = document.createElement('div');
            cell.className = `timeline-frame${i === this.anim.activeIndex ? ' active' : ''}`;
            cell.dataset.frameIndex = i;

            const thumb = this.anim.getFrameThumbnail(i, 48);
            thumb.className = 'timeline-thumb';
            cell.appendChild(thumb);

            const idx = document.createElement('span');
            idx.className = 'timeline-frame-index';
            idx.textContent = i + 1;
            cell.appendChild(idx);

            const dur = document.createElement('input');
            dur.type = 'number';
            dur.className = 'timeline-frame-dur';
            dur.min = '10'; dur.step = '10';
            dur.value = Math.round(this.anim.frames[i].duration);
            dur.title = 'Frame duration (ms)';
            dur.addEventListener('pointerdown', (e) => e.stopPropagation());
            dur.addEventListener('change', () => this.anim.setDuration(i, parseInt(dur.value) || 100));
            cell.appendChild(dur);

            this._attachDrag(cell, i);
            this._framesEl.appendChild(cell);
        }
        this._updateCount();
    }

    _attachDrag(cell, index) {
        let startX = 0, dragging = false;
        cell.addEventListener('pointerdown', (e) => {
            if (e.target.closest('input')) return;
            startX = e.clientX;
            dragging = false;
            this._dragIndex = index;

            const onMove = (me) => {
                if (!dragging && Math.abs(me.clientX - startX) > 8) {
                    dragging = true;
                    cell.classList.add('dragging');
                }
            };
            const onUp = (ue) => {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                cell.classList.remove('dragging');
                if (!dragging) {
                    if (this.anim.playing) this.anim.pause();
                    this.anim.setActiveFrame(index);
                } else {
                    const cells = [...this._framesEl.querySelectorAll('.timeline-frame')];
                    let target = index;
                    for (let i = 0; i < cells.length; i++) {
                        const r = cells[i].getBoundingClientRect();
                        if (ue.clientX < r.left + r.width / 2) { target = i; break; }
                        target = i;
                    }
                    this.anim.reorderFrame(this._dragIndex, target);
                }
                this._dragIndex = null;
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        });
    }

    /** Lightweight active-cell highlight (used during playback). */
    updateActive(i) {
        if (!this._framesEl) return;
        this._framesEl.querySelectorAll('.timeline-frame').forEach((c) => {
            c.classList.toggle('active', parseInt(c.dataset.frameIndex) === i);
        });
        const active = this._framesEl.querySelector('.timeline-frame.active');
        if (active) active.scrollIntoView({ inline: 'nearest', block: 'nearest' });
        this._updateCount();
    }

    _updateCount() {
        if (this._count) this._count.textContent = `${this.anim.activeIndex + 1} / ${this.anim.count}`;
    }

    setPlayingUI(playing) {
        if (this._playBtn) this._playBtn.textContent = playing ? 'Pause' : 'Play';
    }

    // ─── Visibility ───────────────────────────────────────────────
    get visible() { return this.panel && !this.panel.hidden; }
    show() {
        if (!this.panel) return;
        this.panel.hidden = false;
        this.render();
        this._refit();
    }
    hide() {
        if (!this.panel) return;
        this.anim.pause();
        this.panel.hidden = true;
        this._refit();
    }
    toggle() { this.visible ? this.hide() : this.show(); }

    /** The docked panel changes the canvas area height — refit after layout settles. */
    _refit() {
        const engine = this.anim?.engine;
        if (engine && engine.onResize) requestAnimationFrame(() => engine.onResize());
    }
}
