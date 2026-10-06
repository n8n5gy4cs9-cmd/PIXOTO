// Hooks the text and shape modules fill in, so canvas and transform code can redraw live layers without importing them.
export const live = { renderText: null, scaleText: null, renderShape: null, rescale: null };
