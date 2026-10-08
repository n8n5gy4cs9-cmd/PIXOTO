// GLSL ES 3.00 fragment bodies for the GPU adjustment passes. Each body runs with the source texel already read into
// `s` (straight RGBA 0..1) and `c` (a vec3 in 0..255 matching the Uint8 maths); the body modifies `c` in place. The
// wrapper leaves alpha alone and only touches fully transparent pixels when the CPU code does (it never does here).
const wrap = (body) => `uniform sampler2D u_src;
uniform sampler2D u_sel;
uniform bool u_useSel;
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

// Bodies copied line-by-line from core/filters/adjust.js. Uniforms are floats (u_b/u_c = raw brightness/contrast, etc.).
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
};
