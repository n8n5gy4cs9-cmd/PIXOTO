// Reusable ImageData and byte buffers keyed by size, so render cycles allocate nothing in steady state.
const MAX_FREE = 3;
const free = new Map();
const take = (k) => free.get(k)?.pop();
const give = (k, v) => { let l = free.get(k); if (!l) free.set(k, l = []); if (l.length < MAX_FREE) l.push(v); };

export const acquireImageData = (w, h) => take(`i:${w}x${h}`) || new ImageData(w, h);
export const releaseImageData = (img) => give(`i:${img.width}x${img.height}`, img);
export const acquireBytes = (n) => take(`b:${n}`) || new Uint8ClampedArray(n);
export const releaseBytes = (a) => give(`b:${a.length}`, a);
export const clearPool = () => free.clear();
