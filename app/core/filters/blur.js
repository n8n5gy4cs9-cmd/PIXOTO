// Gaussian blur as three box passes over interleaved 8-bit planes. Pure typed-array code: runs in the main thread
// or in the filter worker. `edge` is 'clamp' (repeat the border) or 'zero' (nothing beyond the border).

// Box sizes whose three passes approximate a Gaussian of the given sigma.
export function boxSizes(sigma, n = 3) {
  const ideal = Math.sqrt((12 * sigma * sigma / n) + 1);
  let wl = Math.floor(ideal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

function boxH(src, dst, w, h, r, ch, clampEdge) {
  const div = 1 / (2 * r + 1), last = w - 1;
  for (let y = 0; y < h; y++) {
    const row = y * w * ch;
    for (let c = 0; c < ch; c++) {
      const at = (x) => (clampEdge ? src[row + (x < 0 ? 0 : x > last ? last : x) * ch + c] : x < 0 || x > last ? 0 : src[row + x * ch + c]);
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += at(x);
      for (let x = 0; x < w; x++) {
        dst[row + x * ch + c] = sum * div + 0.5;
        sum += at(x + r + 1) - at(x - r);
      }
    }
  }
}
function boxV(src, dst, w, h, r, ch, clampEdge) {
  const div = 1 / (2 * r + 1), last = h - 1, stride = w * ch;
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < ch; c++) {
      const col = x * ch + c;
      const at = (y) => (clampEdge ? src[(y < 0 ? 0 : y > last ? last : y) * stride + col] : y < 0 || y > last ? 0 : src[y * stride + col]);
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += at(y);
      for (let y = 0; y < h; y++) {
        dst[y * stride + col] = sum * div + 0.5;
        sum += at(y + r + 1) - at(y - r);
      }
    }
  }
}

// Blurs `data` (Uint8ClampedArray, `ch` interleaved channels) in place. Four-channel data must be premultiplied.
export function gaussianBlur(data, w, h, sigmaX, sigmaY = sigmaX, ch = 4, edge = 'clamp') {
  if (sigmaX <= 0.01 && sigmaY <= 0.01) return;
  const tmp = new Uint8ClampedArray(data.length), clampEdge = edge === 'clamp';
  const bx = sigmaX > 0.01 ? boxSizes(sigmaX) : [], by = sigmaY > 0.01 ? boxSizes(sigmaY) : [];
  for (let i = 0; i < 3; i++) {
    if (bx[i]) { boxH(data, tmp, w, h, (bx[i] - 1) >> 1, ch, clampEdge); data.set(tmp); }
    if (by[i]) { boxV(data, tmp, w, h, (by[i] - 1) >> 1, ch, clampEdge); data.set(tmp); }
  }
}

// A blur of straight-alpha RGBA: premultiply, blur, un-premultiply.
export function blurRGBA(data, w, h, sigmaX, sigmaY = sigmaX, edge = 'clamp') {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a !== 255) { data[i] = data[i] * a / 255; data[i + 1] = data[i + 1] * a / 255; data[i + 2] = data[i + 2] * a / 255; }
  }
  gaussianBlur(data, w, h, sigmaX, sigmaY, 4, edge);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a !== 255 && a !== 0) { data[i] = Math.min(255, data[i] * 255 / a); data[i + 1] = Math.min(255, data[i + 1] * 255 / a); data[i + 2] = Math.min(255, data[i + 2] * 255 / a); }
  }
}

// Sliding-window max (dilate) or min (erode) with a (2r+1) window along one axis, monotonic-deque, O(n).
function slideExtreme(src, dst, n, stride, offset, r, isMax) {
  const deque = new Int32Array(n);
  let head = 0, tail = 0;
  const val = (i) => src[offset + i * stride];
  for (let i = 0; i < n + r; i++) {
    if (i < n) {
      const v = val(i);
      while (tail > head && (isMax ? val(deque[tail - 1]) <= v : val(deque[tail - 1]) >= v)) tail--;
      deque[tail++] = i;
    }
    const out = i - r;
    if (out >= 0) {
      while (deque[head] < out - r) head++;
      // The window runs past both ends: beyond the border counts as 0 for erode (and for dilate it changes nothing).
      let best = val(deque[head]);
      if (!isMax && (out - r < 0 || out + r >= n)) best = 0;
      dst[offset + out * stride] = best;
    }
  }
}
// Square structuring element, as Skia's dilate/erode. `plane` is a one-channel Uint8Array of w*h.
export function morph(plane, w, h, r, isMax) {
  if (r <= 0) return plane.slice();
  const tmp = new Uint8Array(plane.length), out = new Uint8Array(plane.length);
  for (let y = 0; y < h; y++) slideExtreme(plane, tmp, w, 1, y * w, r, isMax);
  for (let x = 0; x < w; x++) slideExtreme(tmp, out, h, w, x, r, isMax);
  return out;
}
