/* ═══════════════════════════════════════════════════════════════
   Pixoto — Animation Manager (P7, Phase H)
   Frame-based animation using the "full layer-stack snapshot" model
   (Option A): each frame owns its own members tree. The ACTIVE frame's
   members array is always the same object as engine.members, so the
   existing compositing / drawing / export pipeline is untouched —
   switching frames just swaps engine.members and re-syncs.

   PixiEditor reference: AnimationData.cs, CreateCel_Change.cs,
   SetKeyFrameData_Change.cs, SetOnionSettings_Change.cs
   ═══════════════════════════════════════════════════════════════ */

import { Layer, LayerGroup } from './canvas-engine.js';

function makeCanvas(w, h) {
    let c;
    try { c = new OffscreenCanvas(w, h); }
    catch { c = document.createElement('canvas'); c.width = w; c.height = h; }
    return c;
}

export class AnimationManager {
    /** @param {import('./canvas-engine.js').CanvasEngine} engine */
    constructor(engine) {
        this.engine = engine;

        /** @type {{members:Array, duration:number}[]} */
        this.frames = [];
        this.activeIndex = 0;

        this.fps = 12;
        this.loop = true;
        this.onion = { enabled: false, prev: 1, next: 1, opacity: 0.4 };

        this._playing = false;
        this._playTimer = null;

        // Callbacks (wired by app)
        this.onChange = null;        // structural / active-frame change → full UI resync
        this.onFrameStep = null;     // lightweight per-tick during playback (highlight only)
        this.onPlayStateChange = null;

        this.reset();
    }

    // ─── Helpers ──────────────────────────────────────────────────

    _frameMs() { return Math.max(10, Math.round(1000 / this.fps)); }

    get activeFrame() { return this.frames[this.activeIndex] || null; }
    get count() { return this.frames.length; }

    /** Reset to a single frame wrapping the engine's current members. */
    reset() {
        this.pause();
        this.frames = [{ members: this.engine.members, duration: this._frameMs() }];
        this.activeIndex = 0;
        this.engine.onionFrames = [];
        this._updateOnion();
        if (this.onChange) this.onChange();
    }

    /** Deep-copy a members list into detached Layer/LayerGroup objects. */
    _copyMembers(list, parent = null) {
        return list.map((m) => {
            if (m instanceof LayerGroup) {
                const g = new LayerGroup(m.name);
                g.visible = m.visible;
                g.locked = m.locked;
                g.opacity = m.opacity;
                g.blendMode = m.blendMode;
                g.collapsed = m.collapsed;
                g.parent = parent;
                g.children = this._copyMembers(m.children, g);
                return g;
            }
            const l = this.engine.duplicateLayerObject(m); // full copy (pixels, mask, effects)
            l.name = m.name;          // keep identical name across frames
            l.visible = m.visible;
            l.parent = parent;
            return l;
        });
    }

    // ─── Frame swap ───────────────────────────────────────────────

    /** Point the engine at the active frame's members and resync. */
    _syncActiveToEngine() {
        const f = this.activeFrame;
        if (!f) return;
        this.engine.members = f.members;
        this.engine._syncLayers();
        if (this.engine.activeLayerIndex >= this.engine.layers.length) {
            this.engine.activeLayerIndex = Math.max(0, this.engine.layers.length - 1);
        }
        this.engine.activeMember = this.engine.layers[this.engine.activeLayerIndex] || null;
        this._updateOnion();
        this.engine.requestComposite();
    }

    setActiveFrame(i) {
        i = Math.max(0, Math.min(i, this.frames.length - 1));
        this.activeIndex = i;
        this._syncActiveToEngine();
        if (this.onChange) this.onChange();
    }

    addFrame({ blank = false } = {}) {
        let members;
        if (blank) {
            members = [new Layer(this.engine.docWidth, this.engine.docHeight, 'Layer 1')];
        } else {
            members = this._copyMembers(this.activeFrame.members);
        }
        this.frames.splice(this.activeIndex + 1, 0, { members, duration: this._frameMs() });
        this.setActiveFrame(this.activeIndex + 1);
    }

    duplicateFrame() { this.addFrame({ blank: false }); }

    deleteFrame(i = this.activeIndex) {
        if (this.frames.length <= 1) return;
        this.frames.splice(i, 1);
        if (this.activeIndex >= this.frames.length) this.activeIndex = this.frames.length - 1;
        this._syncActiveToEngine();
        if (this.onChange) this.onChange();
    }

    reorderFrame(from, to) {
        if (from === to || from < 0 || to < 0 || from >= this.frames.length || to >= this.frames.length) return;
        const active = this.frames[this.activeIndex];
        const [moved] = this.frames.splice(from, 1);
        this.frames.splice(to, 0, moved);
        this.activeIndex = this.frames.indexOf(active);
        if (this.onChange) this.onChange();
    }

    setDuration(i, ms) {
        if (!this.frames[i]) return;
        this.frames[i].duration = Math.max(10, Math.round(ms));
    }

    setFps(fps) {
        this.fps = Math.max(1, Math.min(60, Math.round(fps)));
        if (this.onChange) this.onChange();
    }

    setLoop(b) { this.loop = !!b; }

    // ─── Onion skin ───────────────────────────────────────────────

    setOnionEnabled(b) { this.onion.enabled = !!b; this._updateOnion(); if (this.onChange) this.onChange(); }
    setOnionRange(prev, next) {
        this.onion.prev = Math.max(0, prev | 0);
        this.onion.next = Math.max(0, next | 0);
        this._updateOnion();
    }

    _updateOnion() {
        if (this._playing || !this.onion.enabled) {
            this.engine.onionFrames = [];
            this.engine.requestComposite();
            return;
        }
        const ghosts = [];
        for (let d = 1; d <= this.onion.prev; d++) {
            const idx = this.activeIndex - d;
            if (idx < 0) break;
            ghosts.push({ members: this.frames[idx].members, tint: '#ff4d4d', alpha: this.onion.opacity / d });
        }
        for (let d = 1; d <= this.onion.next; d++) {
            const idx = this.activeIndex + d;
            if (idx >= this.frames.length) break;
            ghosts.push({ members: this.frames[idx].members, tint: '#4d9bff', alpha: this.onion.opacity / d });
        }
        this.engine.onionFrames = ghosts;
        this.engine.requestComposite();
    }

    // ─── Playback ─────────────────────────────────────────────────

    get playing() { return this._playing; }

    play() {
        if (this._playing || this.frames.length < 2) return;
        this._playing = true;
        this.engine.animationPlaying = true;
        this.engine.onionFrames = [];   // hide onion while playing
        if (this.onPlayStateChange) this.onPlayStateChange(true);
        this._tick();
    }

    pause() {
        if (this._playTimer) { clearTimeout(this._playTimer); this._playTimer = null; }
        if (!this._playing) return;
        this._playing = false;
        this.engine.animationPlaying = false;
        this._updateOnion();
        if (this.onPlayStateChange) this.onPlayStateChange(false);
        if (this.onChange) this.onChange();
    }

    togglePlay() { this._playing ? this.pause() : this.play(); }

    _tick() {
        const dur = this.activeFrame?.duration || this._frameMs();
        this._playTimer = setTimeout(() => {
            if (!this._playing) return;
            let next = this.activeIndex + 1;
            if (next >= this.frames.length) {
                if (!this.loop) { this.pause(); return; }
                next = 0;
            }
            this.activeIndex = next;
            // Lightweight swap: no full panel rebuild during playback
            const f = this.activeFrame;
            this.engine.members = f.members;
            this.engine._syncLayers();
            this.engine.requestComposite();
            if (this.onFrameStep) this.onFrameStep(this.activeIndex);
            this._tick();
        }, dur);
    }

    // ─── Flatten / thumbnails / export support ────────────────────

    /** Composite a frame's members to a full-size canvas. */
    flattenFrame(i) {
        const w = this.engine.docWidth, h = this.engine.docHeight;
        const c = makeCanvas(w, h);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = !this.engine.pixelArtMode;
        this.engine._compositeMembers(this.frames[i].members, ctx, w, h);
        return c;
    }

    /** Small thumbnail canvas for a frame. */
    getFrameThumbnail(i, size = 48) {
        const w = this.engine.docWidth, h = this.engine.docHeight;
        const flat = this.flattenFrame(i);
        const thumb = document.createElement('canvas');
        thumb.width = size; thumb.height = size;
        const ctx = thumb.getContext('2d');
        // checkerboard
        const cs = 6;
        for (let y = 0; y < size; y += cs)
            for (let x = 0; x < size; x += cs) {
                ctx.fillStyle = ((x / cs + y / cs) % 2 === 0) ? '#bbb' : '#888';
                ctx.fillRect(x, y, cs, cs);
            }
        const scale = Math.min(size / w, size / h);
        const dw = w * scale, dh = h * scale;
        ctx.imageSmoothingEnabled = !this.engine.pixelArtMode;
        ctx.drawImage(flat, (size - dw) / 2, (size - dh) / 2, dw, dh);
        return thumb;
    }

    // ─── Serialization support (used by file-manager) ─────────────

    /** Append frames from an array of canvases/images (sprite-sheet slice import). */
    importFrames(images, { replace = false } = {}) {
        const w = this.engine.docWidth, h = this.engine.docHeight;
        const newFrames = images.map((img) => {
            const l = new Layer(w, h, 'Frame');
            l.ctx.imageSmoothingEnabled = !this.engine.pixelArtMode;
            l.ctx.drawImage(img, 0, 0);
            l.markAllDirty();
            return { members: [l], duration: this._frameMs() };
        });
        if (!newFrames.length) return;
        if (replace) this.frames = newFrames;
        else this.frames.push(...newFrames);
        this.setActiveFrame(this.frames.length - newFrames.length);
        if (this.onChange) this.onChange();
    }

    /** Replace all frames from deserialized member arrays + settings. */
    loadFrames(frameMembersArray, durations, { fps, loop, activeIndex } = {}) {
        this.pause();
        this.frames = frameMembersArray.map((members, i) => ({
            members,
            duration: (durations && durations[i]) || this._frameMs(),
        }));
        if (!this.frames.length) this.frames = [{ members: this.engine.members, duration: this._frameMs() }];
        if (fps) this.fps = fps;
        if (loop != null) this.loop = loop;
        this.activeIndex = Math.max(0, Math.min(activeIndex || 0, this.frames.length - 1));
        this._syncActiveToEngine();
        if (this.onChange) this.onChange();
    }
}
