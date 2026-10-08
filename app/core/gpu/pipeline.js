// One GPU pipeline per live-preview session (P3.1). Owns the source texture (uploaded once from the downscaled proxy),
// an optional R8 selection-coverage texture, and a reusable 2D output canvas. `render` runs one op per tick without
// allocating; `commitFull` does the full-resolution pass exactly once (single-pass; the caller falls back to the CPU
// when the layer exceeds MAX_TEXTURE_SIZE or the op cannot commit on the GPU).
import { getGl, program, texture, release, upload, bindSampler, drawFullscreen, gpuCanvas, gpuCaps, isGpuAvailable } from './context.js';
import { drawAdjustment } from './adjust-gpu.js';
import { drawFilterGpu, drawBlurAdjustmentGpu, drawSelectionMix, FILTER_GPU } from './filter-gpu.js';
import { passFrag } from './shaders.js';
import { makeCanvas, ctxOf } from '../pixels.js';
import { isBlurAdjustment } from '../filters/adjust.js';

const copyPass = (tex, target, w, h) => {
  const p = program('copy', passFrag.copy);
  const gl = getGl();
  gl.useProgram(p.prog);
  bindSampler(p, 'u_src', tex, 0);
  drawFullscreen(p, target, w, h);
};

export class GpuLayerPipeline {
  // sourceCanvas: proxy-resolution copy of the layer. size: {w,h}. selection: {data:Uint8Array, w, h} or null.
  static create(sourceCanvas, size, selection) {
    if (!isGpuAvailable()) return null;
    try { return new GpuLayerPipeline(sourceCanvas, size, selection); } catch (e) { console.warn('GPU pipeline unavailable', e); return null; }
  }
  constructor(sourceCanvas, size, selection) {
    this.w = size.w; this.h = size.h;
    this.srcTex = texture(size.w, size.h, 'rgba8', 'linear');
    upload(this.srcTex, sourceCanvas, size.w, size.h);
    this.selTex = selection ? this.buildSelTex(selection, size.w, size.h) : null;
    this.output = makeCanvas(size.w, size.h);
    this.outCtx = this.output.getContext('2d');
  }
  get canvas() { return this.output; }

  buildSelTex(sel, w, h) {
    const sw = sel.w, sh = sel.h, d = sel.data, bytes = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { const sy = Math.min(sh - 1, (y * sh / h) | 0); for (let x = 0; x < w; x++) bytes[y * w + x] = d[sy * sw + Math.min(sw - 1, (x * sw / w) | 0)]; }
    const t = texture(w, h, 'r8', 'nearest');
    upload(t, bytes, w, h, 'r8');
    return t;
  }

  present() { this.outCtx.drawImage(gpuCanvas(), 0, 0); }

  // desc: { kind:'adjust', adjustment, step, ox, oy } | { kind:'filter', id, params, env, step }. Returns false when the
  // op cannot run on the GPU (the caller falls back to the CPU proxy path).
  render(desc) {
    if (!getGl()) return false;
    try {
      if (desc.kind === 'adjust' && isBlurAdjustment(desc.adjustment)) {
        const res = texture(this.w, this.h, 'rgba8', 'linear');
        const ok = drawBlurAdjustmentGpu(desc.adjustment, this.srcTex, res, this.w, this.h, desc.step);
        if (!ok) { release(res); return false; }
        this.finish(res); release(res);
      } else if (desc.kind === 'adjust') {
        drawAdjustment(desc.adjustment, this.srcTex, null, this.w, this.h, { selTex: this.selTex, step: desc.step, ox: desc.ox, oy: desc.oy });
        this.present();
      } else if (FILTER_GPU[desc.id]) {
        const res = texture(this.w, this.h, 'rgba8', 'linear');
        const ok = drawFilterGpu(desc.id, desc.params, desc.env, this.srcTex, res, this.w, this.h, desc.step);
        if (!ok) { release(res); return false; }
        this.finish(res); release(res);
      } else return false;
      return true;
    } catch (e) { console.warn('GPU pipeline render failed', e); return false; }
  }

  finish(res) {
    if (this.selTex) drawSelectionMix(this.srcTex, res, this.selTex, null, this.w, this.h);
    else copyPass(res, null, this.w, this.h);
    this.present();
  }

  showOriginal() { copyPass(this.srcTex, null, this.w, this.h); this.present(); }

  // Full-resolution pass for GPU-committable adjustments. Returns the resulting canvas, or null when the layer is too
  // large for one texture (caller falls back to the CPU worker). `selection` is the full-resolution coverage plane.
  commitFull(desc, fullSourceCanvas, selection) {
    const W = fullSourceCanvas.width, H = fullSourceCanvas.height, max = gpuCaps()?.maxTex || 0;
    if (!getGl() || W > max || H > max) return null;
    if (desc.kind !== 'adjust' || isBlurAdjustment(desc.adjustment)) return null;
    const src = texture(W, H, 'rgba8', 'linear');
    let selTex = null;
    try {
      upload(src, fullSourceCanvas, W, H);
      if (selection) selTex = this.buildSelTex(selection, W, H);
      const ok = drawAdjustment(desc.adjustment, src, null, W, H, { selTex, step: desc.step || 1, ox: desc.ox || 0, oy: desc.oy || 0 });
      const out = makeCanvas(W, H);
      if (ok) ctxOf(out).drawImage(gpuCanvas(), 0, 0);
      return ok ? out : null;
    } catch (e) { console.warn('GPU commit failed, falling back', e); return null; }
    finally { release(src); if (selTex) release(selTex); }
  }

  dispose() { if (this.srcTex) release(this.srcTex); if (this.selTex) release(this.selTex); this.srcTex = this.selTex = null; }
}
