// Content-aware fill for the Spot Healing Brush and Edit > Content-Aware Fill (port of Composa.Painting.Inpaint). The hole
// is filled with the nearby patch whose surroundings match best, then the seam is removed by spreading the mismatch along
// the border smoothly through the hole (a membrane, as in Poisson cloning).
export const MAX_AREA = 16_000_000;

// Fills the unweighted samples of a grid smoothly from the weighted ones, using an image pyramid.
function pushPull(values, weight, width, height, channels) {
  if (width <= 1 && height <= 1) return;
  let complete = true;
  for (let i = 0; i < weight.length; i++) if (weight[i] <= 0) { complete = false; break; }
  if (complete) return;
  const hw = (width + 1) >> 1, hh = (height + 1) >> 1, coarse = new Float32Array(hw * hh * channels), cw = new Float32Array(hw * hh);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const wgt = weight[y * width + x]; if (wgt <= 0) continue;
    const j = (y >> 1) * hw + (x >> 1);
    cw[j] += wgt;
    for (let c = 0; c < channels; c++) coarse[j * channels + c] += values[(y * width + x) * channels + c] * wgt;
  }
  for (let j = 0; j < cw.length; j++) { if (cw[j] <= 0) continue; for (let c = 0; c < channels; c++) coarse[j * channels + c] /= cw[j]; cw[j] = 1; }
  pushPull(coarse, cw, hw, hh, channels);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (weight[y * width + x] > 0) continue;
    const fx = (x - 0.5) / 2, fy = (y - 0.5) / 2;
    const x0 = Math.max(0, Math.min(hw - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(hh - 1, Math.floor(fy))), x1 = Math.min(hw - 1, x0 + 1), y1 = Math.min(hh - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    for (let c = 0; c < channels; c++) {
      const top = coarse[(y0 * hw + x0) * channels + c] * (1 - tx) + coarse[(y0 * hw + x1) * channels + c] * tx;
      const bottom = coarse[(y1 * hw + x0) * channels + c] * (1 - tx) + coarse[(y1 * hw + x1) * channels + c] * tx;
      values[(y * width + x) * channels + c] = top * (1 - ty) + bottom * ty;
    }
    weight[y * width + x] = 1;
  }
}

function boundsOfMask(mask, w, h, threshold = 1) {
  let l = w, t = h, r = -1, b = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] >= threshold) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; b = y; }
  return r < 0 ? null : { x: l, y: t, w: r - l + 1, h: b - t + 1 };
}

// `data` straight RGBA, `mask` Uint8 coverage of the same w x h. Returns a new straight RGBA array.
export function inpaint(data, mask, w, h) {
  const result = new Uint8ClampedArray(data), hole = boundsOfMask(mask, w, h);
  if (!hole) return result;
  const ring = 4, ax = Math.max(0, hole.x - ring), ay = Math.max(0, hole.y - ring), aw = Math.min(w, hole.x + hole.w + ring) - ax, ah = Math.min(h, hole.y + hole.h + ring) - ay;
  // Premultiplied copy of the source.
  const src = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { const a = data[i * 4 + 3]; src[i * 4] = data[i * 4] * a / 255; src[i * 4 + 1] = data[i * 4 + 1] * a / 255; src[i * 4 + 2] = data[i * 4 + 2] * a / 255; src[i * 4 + 3] = a; }
  const holeMask = new Float32Array(aw * ah);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) holeMask[y * aw + x] = mask[(y + ay) * w + x + ax] / 255;
  const known = (x, y) => holeMask[y * aw + x] <= 0 && src[((y + ay) * w + x + ax) * 4 + 3] > 0;

  const border = [], step = Math.max(1, Math.floor(Math.sqrt(aw * ah / 3000)));
  for (let y = 0; y < ah; y += step) for (let x = 0; x < aw; x += step) if (known(x, y)) border.push(x, y);
  const offset = border.length >= 16 ? bestOffset(src, mask, w, h, { x: ax, y: ay, w: aw, h: ah }, border) : null;

  const patch = new Float32Array(aw * ah * 4), weight = new Float32Array(aw * ah), diff = new Float32Array(aw * ah * 4);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const i = y * aw + x, t = ((y + ay) * w + x + ax) * 4;
    if (offset) { const f = ((y + ay + offset.y) * w + x + ax + offset.x) * 4; for (let c = 0; c < 4; c++) patch[i * 4 + c] = src[f + c]; }
    if (!known(x, y)) continue;
    weight[i] = 1;
    for (let c = 0; c < 4; c++) diff[i * 4 + c] = src[t + c] - patch[i * 4 + c];
  }
  pushPull(diff, weight, aw, ah, 4);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
    const i = y * aw + x, cover = holeMask[i];
    if (cover <= 0) continue;
    const p = ((y + ay) * w + x + ax) * 4, alpha = Math.max(0, Math.min(255, patch[i * 4 + 3] + diff[i * 4 + 3]));
    const out = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const filled = Math.max(0, Math.min(c === 3 ? 255 : alpha, patch[i * 4 + c] + diff[i * 4 + c]));
      out[c] = src[p + c] * (1 - cover) + filled * cover;
    }
    const a = out[3];
    result[p + 3] = a;
    if (a > 0) { result[p] = Math.min(255, out[0] * 255 / a); result[p + 1] = Math.min(255, out[1] * 255 / a); result[p + 2] = Math.min(255, out[2] * 255 / a); }
    else result[p] = result[p + 1] = result[p + 2] = 0;
  }
  return result;
}

function bestOffset(src, mask, w, h, area, border) {
  const reachX = Math.max(24, area.w * 3), reachY = Math.max(24, area.h * 3), coarse = Math.max(1, Math.floor(Math.max(area.w, area.h) / 12));
  const holeSamples = [], hs = Math.max(1, Math.floor(Math.sqrt(area.w * area.h / 2000)));
  for (let y = area.y; y < area.y + area.h; y += hs) for (let x = area.x; x < area.x + area.w; x += hs) if (mask[y * w + x] > 0) holeSamples.push(x, y);
  const nb = border.length / 2;
  const cost = (ox, oy) => {
    if (Math.abs(ox) < area.w / 2 && Math.abs(oy) < area.h / 2) return Infinity;
    if (area.x + ox < 0 || area.y + oy < 0 || area.x + area.w + ox > w || area.y + area.h + oy > h) return Infinity;
    for (let k = 0; k < holeSamples.length; k += 2) {
      const x = holeSamples[k], y = holeSamples[k + 1];
      if (mask[(y + oy) * w + x + ox] > 0) return Infinity;
      if (src[((y + oy) * w + x + ox) * 4 + 3] < 250 && src[(y * w + x) * 4 + 3] >= 250) return Infinity;
    }
    let sum = 0;
    for (let k = 0; k < border.length; k += 2) {
      const a = ((border[k + 1] + area.y) * w + border[k] + area.x) * 4, b = ((border[k + 1] + area.y + oy) * w + border[k] + area.x + ox) * 4;
      for (let c = 0; c < 4; c++) { const d = src[a + c] - src[b + c]; sum += d * d; }
    }
    return sum / nb + 0.002 * (ox * ox + oy * oy) / Math.max(1, area.w * area.h) * 255;
  };
  let best = Infinity, winner = null;
  for (let oy = -reachY; oy <= reachY; oy += coarse) for (let ox = -reachX; ox <= reachX; ox += coarse) { const c = cost(ox, oy); if (c < best) { best = c; winner = { x: ox, y: oy }; } }
  if (!winner || coarse === 1) return winner;
  const f = winner;
  for (let oy = f.y - coarse; oy <= f.y + coarse; oy++) for (let ox = f.x - coarse; ox <= f.x + coarse; ox++) { const c = cost(ox, oy); if (c < best) { best = c; winner = { x: ox, y: oy }; } }
  return winner;
}
