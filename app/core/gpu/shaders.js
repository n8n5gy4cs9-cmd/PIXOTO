// GLSL ES 3.00 fragment bodies for the GPU adjustment passes. Each body runs with the source texel already read into
// `s` (straight RGBA 0..1) and `c` (a vec3 in 0..255 matching the Uint8 maths); the body modifies `c` in place. The
// wrapper leaves alpha alone and only touches fully transparent pixels when the CPU code does (it never does here).
const wrap = (body, decls = '') => `uniform sampler2D u_src;
uniform sampler2D u_sel;
uniform bool u_useSel;
${decls}
float lum3(float r, float g, float b) { return floor((r * 54.0 + g * 183.0 + b * 19.0) / 256.0); }
float s2l(float e) { return e <= 0.04045 ? e / 12.92 : pow((e + 0.055) / 1.055, 2.4); }
float l2s(float l) { return l <= 0.0031308 ? l * 12.92 : 1.055 * pow(l, 1.0 / 2.4) - 0.055; }
void main() {
vec4 s = texture(u_src, v_uv);
vec3 c = floor(s.rgb * 255.0 + 0.5);
if (s.a > 0.0) {
${body}
}
vec3 r = clamp(floor(c + 0.5), 0.0, 255.0) / 255.0;
if (u_useSel) { float k = texture(u_sel, v_uv).r; r = mix(s.rgb, r, k); }
o = vec4(r, s.a);
}`;

// Shared RGB<->HSL helpers, ported verbatim from adjust.js rgbToHsl/hueCh/hslToRgb/applySat/applyLight (c in 0..1,
// hue in degrees).
const HSL = `
vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) / 2.0;
  float d = mx - mn;
  if (d < 1e-9) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h * 60.0, s, l);
}
float hueCh(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x, s = hsl.y, l = hsl.z;
  if (s <= 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(hueCh(p, q, h / 360.0 + 1.0 / 3.0), hueCh(p, q, h / 360.0), hueCh(p, q, h / 360.0 - 1.0 / 3.0));
}
float applySat(float s, float amt) { return clamp(amt >= 0.0 ? s * (1.0 + amt / 100.0 * 2.0) : s * (1.0 + amt / 100.0), 0.0, 1.0); }
float applyLight(float l, float amt) { return amt >= 0.0 ? l + (1.0 - l) * amt / 100.0 : l * (1.0 + amt / 100.0); }
`;

// Hashed noise, ported from adjust.js hash/smoothNoise/noise. Seeds are uints (JS `>>> 0`), so they stay exact.
const NOISE = `
float hash2(float x, float y, uint sd) {
  uint h = (uint(x) * 0x85EBCA6Bu) ^ (uint(y) * 0xC2B2AE35u) ^ (sd * 0x27D4EB2Fu);
  h ^= h >> 15u; h = h * 0x2C1B3C6Du; h ^= h >> 12u; h = h * 0x297A2D39u; h ^= h >> 15u;
  return (float(h & 0xFFFFFFu) / 16777215.0) * 2.0 - 1.0;
}
float smoothNoise(float x, float y, uint sd) {
  float x0 = floor(x), y0 = floor(y);
  float fx = x - x0, fy = y - y0;
  fx = fx * fx * (3.0 - 2.0 * fx); fy = fy * fy * (3.0 - 2.0 * fy);
  float a = hash2(x0, y0, sd), b = hash2(x0 + 1.0, y0, sd), c = hash2(x0, y0 + 1.0, sd), d = hash2(x0 + 1.0, y0 + 1.0, sd);
  float top = a + (b - a) * fx, bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}
float noise1(float x, float y, uint sd, float channel, float gaussian) {
  uint key = sd + uint(channel) * 0x9E3779B9u;
  float n = hash2(x, y, key);
  if (gaussian < 0.5) return n;
  float sum = n + hash2(x, y, key + 0x7F4A7C15u) + hash2(x, y, key + 0x3C6EF372u);
  return clamp(sum / 3.0 * 1.7, -1.0, 1.0);
}
`;

const LUT256 = `vec3 lutv = vec3(texelFetch(u_lut, ivec2(int(c.x), 0), 0).r, texelFetch(u_lut, ivec2(int(c.y), 0), 0).g, texelFetch(u_lut, ivec2(int(c.z), 0), 0).b);
c = lutv;`;

// Bodies copied line-by-line from core/filters/adjust.js (and lut.js). Uniforms are floats (u_b/u_c = raw settings, etc.).
export const adjustFrag = {
  brightnessContrast: wrap(`float cc = clamp(u_c, -100.0, 100.0) / 100.0;
float sl = cc >= 0.0 ? 1.0 / max(0.004, 1.0 - cc) : 1.0 + cc;
float li = clamp(u_b, -100.0, 100.0) / 100.0 * 0.5;
c = (c - 127.5) * sl + 127.5 + li * 255.0;`),
  exposure: wrap(`float sc = pow(2.0, clamp(u_exp, -20.0, 20.0));
float ga = clamp(u_gamma, 0.01, 9.99);
vec3 e = c / 255.0;
e = vec3(s2l(e.x), s2l(e.y), s2l(e.z));
e = pow(max(vec3(0.0), e * sc + u_off), vec3(1.0 / ga));
c = vec3(l2s(e.x), l2s(e.y), l2s(e.z)) * 255.0;`),
  invert: wrap(`c = 255.0 - c;`),
  threshold: wrap(`c = lum3(c.x, c.y, c.z) >= u_level ? vec3(255.0) : vec3(0.0);`),
  posterize: wrap(`float n = clamp(round(u_levels), 2.0, 255.0);
c = round(round(c / 255.0 * (n - 1.0)) / (n - 1.0) * 255.0);`),
  desaturate: wrap(`float k = clamp(u_amount, 0.0, 100.0) / 100.0;
float l = lum3(c.x, c.y, c.z);
c = clamp(c + (l - c) * k, 0.0, 255.0);`),
  sepia: wrap(`float k = clamp(u_amount, 0.0, 100.0) / 100.0;
vec3 nr = vec3(c.x * 0.393 + c.y * 0.769 + c.z * 0.189, c.x * 0.349 + c.y * 0.686 + c.z * 0.168, c.x * 0.272 + c.y * 0.534 + c.z * 0.131);
c = clamp(c + (nr - c) * k, 0.0, 255.0);`),
  solarize: wrap(`c = c < u_threshold ? c : 255.0 - c;`),
  levels: wrap(LUT256, 'uniform sampler2D u_lut;\n'),
  curves: wrap(LUT256, 'uniform sampler2D u_lut;\n'),
  gradientMap: wrap(`float l = lum3(c.x, c.y, c.z);
c = texelFetch(u_lut, ivec2(int(l), 0), 0).rgb;`, 'uniform sampler2D u_lut;\n'),
  hueSaturation: wrap(`vec3 hsl = rgb2hsl(c / 255.0);
float h = hsl.x, st = hsl.y, li = hsl.z;
if (u_colorize > 0.5) {
  h = mod(u_shifts[0].x, 360.0);
  st = u_shifts[0].y >= 0.0 ? 0.25 + u_shifts[0].y / 100.0 * 0.75 : 0.25 * (1.0 + u_shifts[0].y / 100.0);
} else {
  if (st > 0.0) {
    for (int k = 1; k < 7; k++) {
      vec3 sh = u_shifts[k];
      if (sh.x == 0.0 && sh.y == 0.0 && sh.z == 0.0) continue;
      float center = float(k - 1) * 60.0;
      float dd = abs(mod(mod(h - center, 360.0) + 540.0, 360.0) - 180.0);
      float rw = dd <= 15.0 ? 1.0 : (dd >= 45.0 ? 0.0 : (45.0 - dd) / 30.0);
      float wgt = rw * min(1.0, st * 4.0);
      if (wgt <= 0.0) continue;
      h += sh.x * wgt;
      st = applySat(st, sh.y * wgt);
      li = applyLight(li, sh.z * wgt);
    }
  }
  h = mod(h + u_shifts[0].x, 360.0);
  st = applySat(st, u_shifts[0].y);
}
li = applyLight(li, u_shifts[0].z);
c = hsl2rgb(vec3(h, st, li)) * 255.0;`, HSL + 'uniform vec3 u_shifts[7];\nuniform float u_colorize;\n'),
  vibrance: wrap(`vec3 hsl = rgb2hsl(c / 255.0);
float v = u_amount / 100.0;
float sat = u_sat / 100.0;
float skin = hsl.x > 10.0 && hsl.x < 50.0 ? 0.55 : 1.0;
float ns = v >= 0.0 ? hsl.y + v * (1.0 - hsl.y) * skin : hsl.y * (1.0 + v);
ns = clamp(sat >= 0.0 ? ns + sat * (1.0 - ns) : ns * (1.0 + sat), 0.0, 1.0);
c = hsl2rgb(vec3(hsl.x, ns, hsl.z)) * 255.0;`, HSL),
  blackAndWhite: wrap(`vec3 f = c / 255.0;
float mx = max(max(f.x, f.y), f.z);
float mn = min(min(f.x, f.y), f.z);
float mid = f.x + f.y + f.z - mx - mn;
int p, ss;
if (mx == f.x) { p = 0; ss = f.y >= f.z ? 1 : 5; }
else if (mx == f.y) { p = 2; ss = f.x >= f.z ? 1 : 3; }
else { p = 4; ss = f.y >= f.x ? 3 : 5; }
float gr = clamp(mn + (mid - mn) * u_w[ss] + (mx - mid) * u_w[p], 0.0, 1.0);
if (u_tint > 0.5) { c = hsl2rgb(vec3(mod(u_tintHue, 360.0), u_tintSat, gr)) * 255.0; }
else { c = vec3(gr * 255.0); }`, HSL + 'uniform float u_w[6];\nuniform float u_tint;\nuniform float u_tintHue;\nuniform float u_tintSat;\n'),
  colorBalance: wrap(`vec3 f = c / 255.0;
float before = 0.299 * f.x + 0.587 * f.y + 0.114 * f.z;
vec3 t0 = tonalW(f.x), t1 = tonalW(f.y), t2 = tonalW(f.z);
f.x = clamp(f.x + u_sh.x * t0.x + u_mid.x * t0.y + u_hi.x * t0.z, 0.0, 1.0);
f.y = clamp(f.y + u_sh.y * t1.x + u_mid.y * t1.y + u_hi.y * t1.z, 0.0, 1.0);
f.z = clamp(f.z + u_sh.z * t2.x + u_mid.z * t2.y + u_hi.z * t2.z, 0.0, 1.0);
if (u_preserve > 0.5) {
  float after = 0.299 * f.x + 0.587 * f.y + 0.114 * f.z;
  if (after > 0.0001) { float ratio = before / after; f = clamp(f * ratio, 0.0, 1.0); }
}
c = f * 255.0;`, `vec3 tonalW(float v) {
  const float a = 0.25, b = 0.333, sc = 0.7;
  return vec3(
    clamp((v - b) / -a + 0.5, 0.0, 1.0) * sc,
    clamp((v - b) / a + 0.5, 0.0, 1.0) * clamp((v + b - 1.0) / -a + 0.5, 0.0, 1.0) * sc,
    clamp((v + b - 1.0) / a + 0.5, 0.0, 1.0) * sc);
}
uniform vec3 u_sh;\nuniform vec3 u_mid;\nuniform vec3 u_hi;\nuniform float u_preserve;\n`),
  lut: wrap(`vec3 lutc = lut3d(c.x, c.y, c.z);
vec3 outv = floor(clamp(lutc * 255.0, 0.0, 255.0) + 0.5);
c = c + (outv - c) * u_amount;`, `uniform sampler2D u_lut3d;
uniform float u_n;
uniform float u_m;
uniform float u_amount;
vec3 lut3d(float r, float g, float b) {
  float fr = r / 255.0 * u_m;
  float fg = g / 255.0 * u_m;
  float fb = b / 255.0 * u_m;
  float r0 = min(u_m - 1.0, floor(fr));
  float g0 = min(u_m - 1.0, floor(fg));
  float b0 = min(u_m - 1.0, floor(fb));
  float tr = fr - r0, tg = fg - g0, tb = fb - b0;
  float bx = r0 + b0 * u_n;
  vec3 c000 = texelFetch(u_lut3d, ivec2(int(bx), int(g0)), 0).rgb;
  vec3 c100 = texelFetch(u_lut3d, ivec2(int(bx) + 1, int(g0)), 0).rgb;
  vec3 c010 = texelFetch(u_lut3d, ivec2(int(bx), int(g0) + 1), 0).rgb;
  vec3 c110 = texelFetch(u_lut3d, ivec2(int(bx) + 1, int(g0) + 1), 0).rgb;
  vec3 c001 = texelFetch(u_lut3d, ivec2(int(bx + u_n), int(g0)), 0).rgb;
  vec3 c101 = texelFetch(u_lut3d, ivec2(int(bx + u_n) + 1, int(g0)), 0).rgb;
  vec3 c011 = texelFetch(u_lut3d, ivec2(int(bx + u_n), int(g0) + 1), 0).rgb;
  vec3 c111 = texelFetch(u_lut3d, ivec2(int(bx + u_n) + 1, int(g0) + 1), 0).rgb;
  vec3 c00 = mix(c000, c100, tr);
  vec3 c10 = mix(c010, c110, tr);
  vec3 c01 = mix(c001, c101, tr);
  vec3 c11 = mix(c011, c111, tr);
  return mix(mix(c00, c10, tg), mix(c01, c11, tg), tb);
}`),
  grain: wrap(`float px = floor(u_ox + gl_FragCoord.x * u_step);
float py = floor(u_oy + gl_FragCoord.y * u_step);
float sm = smoothNoise(px / u_size, py / u_size, u_s0) * 1.6;
float fn = smoothNoise(px / u_detail, py / u_detail, u_s1) * 1.6;
float nz = sm + (fn - sm) * u_rough;
float l = (c.x * 54.0 + c.y * 183.0 + c.z * 19.0) / 65280.0;
float wgt = 4.0 * l * (1.0 - l) * 0.75 + 0.25;
c += floor(nz * u_amount * wgt + 0.5);`, NOISE + 'uniform float u_amount;\nuniform float u_size;\nuniform float u_detail;\nuniform float u_rough;\nuniform uint u_s0;\nuniform uint u_s1;\nuniform float u_ox;\nuniform float u_oy;\nuniform float u_step;\n'),
  addNoise: wrap(`float px = floor(u_ox + gl_FragCoord.x * u_step);
float py = floor(u_oy + gl_FragCoord.y * u_step);
if (u_mono > 0.5) {
  float v = noise1(px, py, u_sd, 0.0, u_gaussian) * u_spread;
  c += v;
} else {
  c.x += noise1(px, py, u_sd, 0.0, u_gaussian) * u_spread;
  c.y += noise1(px, py, u_sd, 1.0, u_gaussian) * u_spread;
  c.z += noise1(px, py, u_sd, 2.0, u_gaussian) * u_spread;
}`, NOISE + 'uniform float u_spread;\nuniform uint u_sd;\nuniform float u_gaussian;\nuniform float u_mono;\nuniform float u_ox;\nuniform float u_oy;\nuniform float u_step;\n'),
};

// ---- shared fullscreen passes (pipeline plumbing) -------------------------------------------------------
// Copies one texture to the target (v_uv spans the whole source), used to resample (down/up) and to present results.
export const passFrag = {
  copy: `uniform sampler2D u_src;
void main() { o = texture(u_src, v_uv); }`,
  // Premultiply straight RGBA (in place), so a blur operates on premultiplied colour like the CPU path.
  premul: `uniform sampler2D u_src;
void main() { vec4 s = texture(u_src, v_uv); o = vec4(s.rgb * s.a, s.a); }`,
  unpremul: `uniform sampler2D u_src;
void main() { vec4 s = texture(u_src, v_uv); o = vec4(s.a > 0.0 ? min(s.rgb / s.a, 1.0) : vec3(0.0), s.a); }`,
  // selection mix of original (u_src) over result (u_res) by coverage (u_sel.r), matching mixBySelection exactly.
  selMix: `uniform sampler2D u_src;
uniform sampler2D u_res;
uniform sampler2D u_sel;
void main() {
  vec4 s = texture(u_src, v_uv);
  vec4 m = texture(u_res, v_uv);
  float k = texture(u_sel, v_uv).r;
  if (k >= 1.0) { o = m; return; }
  if (k <= 0.0) { o = s; return; }
  float oa = s.a, ma = m.a;
  float a = oa + (ma - oa) * k;
  vec3 col = (s.rgb * oa + (m.rgb * ma - s.rgb * oa) * k) / max(a, 1e-5);
  o = vec4(col, a);
}`,
};

// ---- Camera Raw: Light + Color stage (cameraraw.js `basic`) as one pass. Alpha is left alone. -------------
export const cameraRawBasicFrag = `uniform sampler2D u_src;
uniform sampler2D u_sel;
uniform bool u_useSel;
uniform float u_gr;
uniform float u_gg;
uniform float u_gb;
uniform float u_contrast;
uniform float u_hi;
uniform float u_sh;
uniform float u_wh;
uniform float u_bl;
uniform float u_vib;
uniform float u_sat;
float cl(float v) { return clamp(v, 0.0, 1.0); }
float rec(vec3 v) { return 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z; }
float s2l(float e) { return e <= 0.04045 ? e / 12.92 : pow((e + 0.055) / 1.055, 2.4); }
float l2s(float l) { return l <= 0.0 ? 0.0 : l >= 1.0 ? 1.0 : l <= 0.0031308 ? l * 12.92 : 1.055 * pow(l, 1.0 / 2.4) - 0.055; }
vec3 scaleLum(vec3 v, float target) {
  target = cl(target);
  float y = rec(v);
  if (abs(target - y) < 1e-8) return v;
  if (y < 1e-8) return target > y ? vec3(target) : v;
  float k = target / y;
  return cl(v * k);
}
vec3 saturate2(vec3 v, float factor) {
  float y = rec(v);
  return cl(y + (v - y) * factor);
}
float toneHi(float y, float a) { float t = cl((y - 0.5) / 0.5); float k = t * t; return a >= 0.0 ? cl(y + a * k * (1.0 - y)) : cl(y + a * k * (y - 0.5)); }
float toneSh(float y, float a) { float t = cl((0.5 - y) / 0.5); float k = t * t; return a >= 0.0 ? cl(y + a * k * (0.5 - y)) : cl(y + a * k * y); }
float toneWh(float y, float a) { return y <= 0.75 ? y : cl(0.75 + (y - 0.75) * (1.0 + a)); }
float toneBl(float y, float a) { return y >= 0.25 ? y : cl(0.25 + (y - 0.25) * (1.0 - a)); }
float hueDeg(vec3 v) {
  float mx = max(max(v.x, v.y), v.z), mn = min(min(v.x, v.y), v.z), c = mx - mn;
  if (c < 1e-6) return 0.0;
  float h = mx == v.x ? mod((v.y - v.z) / c, 6.0) : (mx == v.y ? (v.z - v.x) / c + 2.0 : (v.x - v.y) / c + 4.0);
  h *= 60.0;
  return h < 0.0 ? h + 360.0 : h;
}
vec3 vibSat(vec3 v, float vibrance, float saturation) {
  float mx = max(max(v.x, v.y), v.z), mn = min(min(v.x, v.y), v.z);
  float sat = mx <= 1e-8 ? 0.0 : (mx - mn) / mx;
  float hue = hueDeg(v);
  float skin = 0.0;
  if (hue >= 10.0 && hue <= 50.0) skin = (hue <= 30.0 ? (hue - 10.0) / 20.0 : (50.0 - hue) / 20.0) * cl((sat - 0.15) / 0.35);
  float amount = vibrance * (1.0 - sat);
  if (vibrance > 0.0) amount *= 1.0 - 0.7 * skin;
  v = saturate2(v, 1.0 + amount);
  v = saturate2(v, 1.0 + saturation);
  return v;
}
void main() {
  vec4 s = texture(u_src, v_uv);
  vec3 v = s.rgb;
  if (s.a > 0.0) {
    v.x = cl(s2l(v.x) * u_gr);
    v.y = cl(s2l(v.y) * u_gg);
    v.z = cl(s2l(v.z) * u_gb);
    v = cl(vec3(0.5) + (vec3(l2s(v.x), l2s(v.y), l2s(v.z)) - vec3(0.5)) * u_contrast);
    v = scaleLum(v, toneHi(rec(v), u_hi));
    v = scaleLum(v, toneSh(rec(v), u_sh));
    v = scaleLum(v, toneWh(rec(v), u_wh));
    v = scaleLum(v, toneBl(rec(v), u_bl));
    v = vibSat(v, u_vib, u_sat);
  }
  if (u_useSel) { float k = texture(u_sel, v_uv).r; v = mix(s.rgb, v, k); }
  o = vec4(v, s.a);
}`;
