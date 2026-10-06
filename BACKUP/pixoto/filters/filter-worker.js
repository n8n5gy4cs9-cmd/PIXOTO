/* ═══════════════════════════════════════════════════════════════
   Pixoto — Filter Web Worker (Phase F)
   Runs destructive pixel filters off the main thread.
   Receives: { type, params, imageData, width, height }
   Sends:    { imageData }          (mutated in-place, then transferred)
   ═══════════════════════════════════════════════════════════════ */

// ─── Helpers ─────────────────────────────────────────────────────
function clamp(v, lo = 0, hi = 255) { return v < lo ? lo : v > hi ? hi : v; }

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
}

function hue2rgb(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
}

function hslToRgb(h, s, l) {
    h /= 360;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
        Math.round(hue2rgb(p, q, h + 1/3) * 255),
        Math.round(hue2rgb(p, q, h)       * 255),
        Math.round(hue2rgb(p, q, h - 1/3) * 255)
    ];
}

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}


// ─── Filter Implementations ───────────────────────────────────────

function invertFilter(d) {
    for (let i = 0; i < d.length; i += 4) {
        d[i] = 255 - d[i]; d[i+1] = 255 - d[i+1]; d[i+2] = 255 - d[i+2];
    }
}

function grayscaleFilter(d) {
    for (let i = 0; i < d.length; i += 4) {
        const v = Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]);
        d[i] = d[i+1] = d[i+2] = v;
    }
}

function sepiaFilter(d) {
    for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i+1], b = d[i+2];
        d[i]   = clamp(r * 0.393 + g * 0.769 + b * 0.189);
        d[i+1] = clamp(r * 0.349 + g * 0.686 + b * 0.168);
        d[i+2] = clamp(r * 0.272 + g * 0.534 + b * 0.131);
    }
}

function brightnessContrastFilter(d, brightness, contrast) {
    const b = brightness * 2.55;
    const factor = contrast === 0 ? 1 : (259 * (contrast + 255)) / (255 * (259 - contrast));
    for (let i = 0; i < d.length; i += 4) {
        d[i]   = clamp(Math.round(factor * (d[i]   + b - 128) + 128));
        d[i+1] = clamp(Math.round(factor * (d[i+1] + b - 128) + 128));
        d[i+2] = clamp(Math.round(factor * (d[i+2] + b - 128) + 128));
    }
}

function hueSaturationFilter(d, hue, saturation, lightness) {
    const sShift = saturation / 100, lShift = lightness / 100;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i+3] === 0) continue;
        let [h, s, l] = rgbToHsl(d[i], d[i+1], d[i+2]);
        h = (h + hue + 360) % 360;
        s = clamp(s + sShift, 0, 1); l = clamp(l + lShift, 0, 1);
        const [r, g, b] = hslToRgb(h, s, l);
        d[i] = r; d[i+1] = g; d[i+2] = b;
    }
}

function levelsFilter(d, inBlack, inWhite, gamma, outBlack, outWhite) {
    const inv = 1 / (inWhite - inBlack), outRange = outWhite - outBlack;
    const gammaInv = gamma > 0 ? 1 / gamma : 1;
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        let v = clamp((i - inBlack) * inv, 0, 1);
        v = Math.pow(v, gammaInv);
        lut[i] = Math.round(v * outRange + outBlack);
    }
    for (let i = 0; i < d.length; i += 4) {
        d[i] = lut[d[i]]; d[i+1] = lut[d[i+1]]; d[i+2] = lut[d[i+2]];
    }
}

function curvesFilter(d, params) {
    function buildLut(shadows = 0, darks = 0, lights = 0, highlights = 0) {
        const lut = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            const sW = Math.max(0, 1 - t * 4);
            const dW = Math.max(0, 1 - Math.abs(t - 0.25) * 4);
            const lW = Math.max(0, 1 - Math.abs(t - 0.75) * 4);
            const hW = Math.max(0, (t - 0.75) * 4);
            const shift = shadows * sW + darks * dW + lights * lW + highlights * hW;
            lut[i] = clamp(Math.round(i + shift * 1.28));
        }
        return lut;
    }
    const rp = params.r || {}, gp = params.g || {}, bp = params.b || {}, rgb = params.rgb || {};
    const rgbLut = buildLut(rgb.shadows, rgb.darks, rgb.lights, rgb.highlights);
    const rLut = buildLut(rp.shadows, rp.darks, rp.lights, rp.highlights);
    const gLut = buildLut(gp.shadows, gp.darks, gp.lights, gp.highlights);
    const bLut = buildLut(bp.shadows, bp.darks, bp.lights, bp.highlights);
    for (let i = 0; i < d.length; i += 4) {
        d[i] = rLut[rgbLut[d[i]]]; d[i+1] = gLut[rgbLut[d[i+1]]]; d[i+2] = bLut[rgbLut[d[i+2]]];
    }
}

function colorBalanceFilter(d, shadows, midtones, highlights) {
    const s = { r:(shadows.r||0)*0.5, g:(shadows.g||0)*0.5, b:(shadows.b||0)*0.5 };
    const m = { r:(midtones.r||0)*0.5, g:(midtones.g||0)*0.5, b:(midtones.b||0)*0.5 };
    const h = { r:(highlights.r||0)*0.5, g:(highlights.g||0)*0.5, b:(highlights.b||0)*0.5 };
    for (let i = 0; i < d.length; i += 4) {
        const t = (d[i]+d[i+1]+d[i+2])/(3*255);
        const sW=Math.max(0,1-t*2), hW=Math.max(0,t*2-1), mW=1-sW-hW;
        d[i]   = clamp(d[i]  +s.r*sW+m.r*mW+h.r*hW);
        d[i+1] = clamp(d[i+1]+s.g*sW+m.g*mW+h.g*hW);
        d[i+2] = clamp(d[i+2]+s.b*sW+m.b*mW+h.b*hW);
    }
}

function vibranceFilter(d, amount) {
    const a = amount / 100;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i+3] === 0) continue;
        const [h, s, l] = rgbToHsl(d[i], d[i+1], d[i+2]);
        const ns = clamp(s + a * (1 - s), 0, 1);
        const [r, g, b] = hslToRgb(h, ns, l);
        d[i]=r; d[i+1]=g; d[i+2]=b;
    }
}

function thresholdFilter(d, threshold) {
    for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
        const v = lum >= threshold ? 255 : 0;
        d[i]=d[i+1]=d[i+2]=v;
    }
}

function gradientMapFilter(d, colorLow, colorHigh) {
    const lo = hexToRgb(colorLow)||[0,0,0], hi = hexToRgb(colorHigh)||[255,255,255];
    for (let i = 0; i < d.length; i += 4) {
        const t = (0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255;
        d[i]  =Math.round(lo[0]+(hi[0]-lo[0])*t);
        d[i+1]=Math.round(lo[1]+(hi[1]-lo[1])*t);
        d[i+2]=Math.round(lo[2]+(hi[2]-lo[2])*t);
    }
}

function posterizeFilter(d, levels) {
    const step = 255/(levels-1), lut = new Uint8Array(256);
    for (let i=0;i<256;i++) lut[i]=Math.round(Math.round(i/step)*step);
    for (let i=0;i<d.length;i+=4) { d[i]=lut[d[i]]; d[i+1]=lut[d[i+1]]; d[i+2]=lut[d[i+2]]; }
}

function noiseFilter(d, amount, monochrome) {
    const amp = amount * 2.55;
    for (let i = 0; i < d.length; i += 4) {
        if (monochrome) {
            const n = (Math.random()-0.5)*amp;
            d[i]=clamp(d[i]+n); d[i+1]=clamp(d[i+1]+n); d[i+2]=clamp(d[i+2]+n);
        } else {
            d[i]=clamp(d[i]+(Math.random()-0.5)*amp);
            d[i+1]=clamp(d[i+1]+(Math.random()-0.5)*amp);
            d[i+2]=clamp(d[i+2]+(Math.random()-0.5)*amp);
        }
    }
}

function boxBlurH(d, w, h, r) {
    const tmp = new Uint8ClampedArray(d.length), iarr = 1/(r+r+1);
    for (let y=0;y<h;y++) {
        const row=y*w;
        for (let c=0;c<3;c++) {
            let acc=0;
            for (let x=-r;x<=r;x++) acc+=d[(row+Math.max(0,Math.min(w-1,x)))*4+c];
            for (let x=0;x<w;x++) {
                tmp[(row+x)*4+c]=Math.round(acc*iarr);
                acc-=d[(row+Math.max(0,x-r))*4+c];
                acc+=d[(row+Math.min(w-1,x+r+1))*4+c];
            }
        }
        for (let x=0;x<w;x++) { const i=(row+x)*4; d[i]=tmp[i]; d[i+1]=tmp[i+1]; d[i+2]=tmp[i+2]; }
    }
}

function boxBlurV(d, w, h, r) {
    const tmp = new Uint8ClampedArray(d.length), iarr = 1/(r+r+1);
    for (let x=0;x<w;x++) {
        for (let c=0;c<3;c++) {
            let acc=0;
            for (let y=-r;y<=r;y++) acc+=d[(Math.max(0,Math.min(h-1,y))*w+x)*4+c];
            for (let y=0;y<h;y++) {
                tmp[(y*w+x)*4+c]=Math.round(acc*iarr);
                acc-=d[(Math.max(0,y-r)*w+x)*4+c];
                acc+=d[(Math.min(h-1,y+r+1)*w+x)*4+c];
            }
        }
        for (let y=0;y<h;y++) { const i=(y*w+x)*4; d[i]=tmp[i]; d[i+1]=tmp[i+1]; d[i+2]=tmp[i+2]; }
    }
}

function gaussianBlurFilter(d, w, h, radius) {
    radius = Math.max(1, Math.round(radius));
    for (let pass=0;pass<3;pass++) { boxBlurH(d,w,h,radius); boxBlurV(d,w,h,radius); }
}

function sharpenFilter(d, w, h, amount) {
    const src = new Uint8ClampedArray(d);
    const center = 1+4*amount, edge = -amount;
    const kernel = [0,edge,0, edge,center,edge, 0,edge,0];
    for (let y=1;y<h-1;y++) {
        for (let x=1;x<w-1;x++) {
            const pi=(y*w+x)*4;
            for (let c=0;c<3;c++) {
                let acc=0;
                for (let ky=-1;ky<=1;ky++) for (let kx=-1;kx<=1;kx++)
                    acc+=src[((y+ky)*w+(x+kx))*4+c]*kernel[(ky+1)*3+(kx+1)];
                d[pi+c]=clamp(Math.round(acc));
            }
        }
    }
}

function unsharpMaskFilter(d, w, h, amount) {
    const blurred = new Uint8ClampedArray(d);
    gaussianBlurFilter(blurred, w, h, 2);
    for (let i=0;i<d.length;i+=4) {
        d[i]  =clamp(d[i]  +(d[i]  -blurred[i])  *amount);
        d[i+1]=clamp(d[i+1]+(d[i+1]-blurred[i+1])*amount);
        d[i+2]=clamp(d[i+2]+(d[i+2]-blurred[i+2])*amount);
    }
}

function outlineFilter(d, w, h, color, thickness) {
    const orig = new Uint8ClampedArray(d);
    const [or,og,ob] = hexToRgb(color)||[0,0,0];
    const r = thickness;
    for (let y=0;y<h;y++) {
        for (let x=0;x<w;x++) {
            const i=(y*w+x)*4;
            if (orig[i+3]>10) continue;
            let found=false;
            outer: for (let dy=-r;dy<=r&&!found;dy++)
                for (let dx=-r;dx<=r&&!found;dx++) {
                    if (dx===0&&dy===0) continue;
                    const nx=x+dx,ny=y+dy;
                    if (nx<0||ny<0||nx>=w||ny>=h) continue;
                    if (orig[(ny*w+nx)*4+3]>10) found=true;
                }
            if (found) { d[i]=or; d[i+1]=og; d[i+2]=ob; d[i+3]=255; }
        }
    }
}


// ─── Message Handler ──────────────────────────────────────────────

self.onmessage = function(e) {
    const { type, params, buffer, width, height } = e.data;
    const d = new Uint8ClampedArray(buffer);

    switch (type) {
        case 'gaussian-blur':    gaussianBlurFilter(d, width, height, params.radius ?? 2); break;
        case 'sharpen':          sharpenFilter(d, width, height, params.amount ?? 1); break;
        case 'unsharp-mask':     unsharpMaskFilter(d, width, height, params.amount ?? 0.5); break;
        case 'invert':           invertFilter(d); break;
        case 'grayscale':        grayscaleFilter(d); break;
        case 'sepia':            sepiaFilter(d); break;
        case 'posterize':        posterizeFilter(d, params.levels ?? 4); break;
        case 'noise':            noiseFilter(d, params.amount ?? 25, params.monochrome !== false); break;
        case 'outline':          outlineFilter(d, width, height, params.color ?? '#000000', params.thickness ?? 1); break;
        case 'brightness-contrast':
            brightnessContrastFilter(d, params.brightness ?? 0, params.contrast ?? 0); break;
        case 'hue-saturation':
            hueSaturationFilter(d, params.hue ?? 0, params.saturation ?? 0, params.lightness ?? 0); break;
        case 'levels':
            levelsFilter(d, params.inBlack??0, params.inWhite??255, params.gamma??1, params.outBlack??0, params.outWhite??255); break;
        case 'curves':           curvesFilter(d, params); break;
        case 'color-balance':    colorBalanceFilter(d, params.shadows??{}, params.midtones??{}, params.highlights??{}); break;
        case 'vibrance':         vibranceFilter(d, params.amount ?? 0); break;
        case 'gradient-map':     gradientMapFilter(d, params.colorLow??'#000000', params.colorHigh??'#ffffff'); break;
        case 'threshold':        thresholdFilter(d, params.threshold ?? 128); break;
        default:
            self.postMessage({ error: `Unknown filter type: ${type}` });
            return;
    }

    // Transfer buffer back
    self.postMessage({ buffer: d.buffer }, [d.buffer]);
};
