// Largest canvas side and area this browser can really make; app.js replaces the defaults with a probe result.
export const LIMITS = { maxSide: 16384, maxPixels: 100_000_000 };
export const fitsSurface = (w, h) => w > 0 && h > 0 && w <= LIMITS.maxSide && h <= LIMITS.maxSide && w * h <= LIMITS.maxPixels;
