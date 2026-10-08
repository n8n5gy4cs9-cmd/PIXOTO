# GLSL spec: shader conventions and per-adjustment contracts

Authority for maths = `app/core/filters/adjust.js` (and `lut.js`, `blur.js`, `cameraraw.js`, `filters.js`). Open them and copy the arithmetic. This file only fixes the GPU conventions.

## Common
- `#version 300 es`, `precision highp float; precision highp int; precision highp sampler2D;`
- Vertex shader: one fullscreen triangle, no vertex buffer (`gl_VertexID`):
```glsl
#version 300 es
out vec2 v_uv;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); v_uv = vec2(p.x, 1.0 - p.y); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }
```
(`v_uv.y` flipped so texture row 0 = canvas top when uploaded with FLIP_Y false. Re-verify with an asymmetric test.)
- Fragment inputs: `uniform sampler2D u_src;` `uniform sampler2D u_sel;` (R8 coverage, optional) `uniform bool u_useSel;` `out vec4 o;`.
- Common prologue/epilogue (include as string helper `wrap(body)` in `shaders.js`):
```glsl
vec4 s = texture(u_src, v_uv);           // straight RGBA, 0..1
vec3 c = floor(s.rgb*255.0+0.5);         // 0..255 domain, matches Uint8 maths
/* body modifies c (0..255 floats), may use s.a */
vec3 r = clamp(floor(c+0.5), 0.0, 255.0)/255.0;
if(u_useSel){ float k = texture(u_sel, v_uv).r; r = mix(s.rgb, r, k); }
o = vec4(r, s.a);                        // alpha untouched
```
- Alpha is never modified by adjustments (as in `applyAdjustment`). Blur-type ops handle alpha explicitly.
- Fully transparent pixels: CPU code may skip or process them; copy that rule.

## Per type (uniform names; formulas come from adjust.js)
| type | uniforms | notes |
|---|---|---|
| brightnessContrast | `u_b`, `u_c` (floats as in createAdjustment) | copy factor formula |
| exposure | `u_exp`, `u_off`, `u_gamma` | pow in float; CPU may use a LUT: if it does, build the same LUT |
| invert | none | `c = 255.0 - c` |
| threshold | `u_level` | luma weights as in CPU |
| posterize | `u_levels` | |
| desaturate, sepia | `u_amount` (0..1) | mix with luma / sepia matrix |
| solarize | `u_threshold` | |
| levels | `u_lut` 256x1 RGBA8 texture (per-channel + master composed) | build the table on the CPU with the same function adjust.js uses; texture row 0, `texelFetch(u_lut, ivec2(int(c.r),0),0).r` etc. Master+channel composition identical to CPU |
| curves | same LUT texture from `curveValue` | 4 channels (RGB master first as CPU does) |
| hueSaturation | `u_shifts[7]` (vec3: hue, sat, light), `u_colorize`, colorize params | port RGB->HSL, range weights verbatim |
| vibrance | `u_amount`, `u_sat` | |
| blackAndWhite | `u_w[6]`, `u_tint` params | |
| colorBalance | `u_sh`, `u_mid`, `u_hi` (vec3), `u_preserve` | |
| gradientMap | `u_lutG` 256x1 texture built on CPU from shadows->highlights (+reversed) | luma index same as CPU |
| lut | `u_lut3d` (2D atlas: size N, N slices tiled horizontally -> width N*N, height N), `u_n`, `u_amount` | manual trilinear: fetch 8 texels with `texelFetch`, `mix`; then `mix(c, lutC, amount)`; copy index/axis order from `lut.js` |
| grain, addNoise | `u_seed`, `u_amount`, ... | preview only; `hash(uvec2(gl_FragCoord.xy)^seed)`; commit runs CPU |
| gaussianBlur | `u_dir` (vec2 texel step), `u_radius`, kernel in loop up to 64 taps, beyond that downsample (halve) chain then blur then upsample | alpha-aware: premultiply inside shader, blur, un-premultiply, to match CPU (check blur.js) |
| motionBlur | `u_dir`, `u_dist` | line integral with N samples = min(dist,128), sample step = dist/N |

## Edge handling
Use `CLAMP_TO_EDGE` when `env.clampEdges` is true (CPU filters clamp), else sample transparent beyond the layer (return `vec4(0)` when uv outside 0..1 via a manual check). Copy from `filters.js` `env`.

## Parity measure
`window.__gpuParity(adjustment)` (dev helper in `adjust-gpu.js`): draw a 512x512 test image (gradient + noise + varied alpha), run CPU `applyAdjustment` and the GPU path, log `max`, `mean` abs diff per channel. Targets: max <= 1, mean < 0.1 for deterministic ops; blur max <= 2.

## Performance notes
- One draw call per adjustment; chain by ping-pong only when an adjustment needs multiple passes (blur).
- Use `texelFetch` for LUTs (no filtering state dependency).
- Upload LUT changes with `texSubImage2D` into a persistent texture; never recreate.
- Avoid dynamic loops over uniform arrays larger than 16; unroll with constants.
