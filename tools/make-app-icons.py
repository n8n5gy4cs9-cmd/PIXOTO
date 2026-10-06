#!/usr/bin/env python3
"""Renders the Pixoto app icon (three stacked layers) to the PNG sizes the PWA needs. Run once locally; the PNGs are committed.
Needs Pillow (pip install pillow). Output: app/assets/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png, favicon-32.png."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'app', 'assets')
S = 4  # supersampling

def gradient(size, c0, c1):
    w, h = size
    img = Image.new('RGBA', size)
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / max(1, w - 1) + y / max(1, h - 1)) / 2
            px[x, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3)) + (255,)
    return img

def layer(canvas, pts, c0, c1, opacity=1.0):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    box = (int(min(xs)), int(min(ys)), int(max(xs)) + 1, int(max(ys)) + 1)
    g = gradient((box[2] - box[0], box[3] - box[1]), c0, c1)
    mask = Image.new('L', canvas.size, 0)
    ImageDraw.Draw(mask).polygon(pts, fill=int(255 * opacity))
    canvas.paste(g, box[:2], mask.crop(box))

def render(px, padding, rounded=True):
    n = px * S
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    inset = int(n * padding)
    bg = gradient((n - 2 * inset, n - 2 * inset), (0x2d, 0x31, 0x40), (0x15, 0x17, 0x1d))
    mask = Image.new('L', bg.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, bg.size[0] - 1, bg.size[1] - 1), radius=int(bg.size[0] * 0.22) if rounded else 0, fill=255)
    img.paste(bg, (inset, inset), mask)
    k = (n - 2 * inset) / 232.0           # the SVG is drawn on a 232-unit tile centred at (128, 128)
    cx, cy = n / 2, n / 2 + 8 * k
    def P(*pts): return [(cx + x * k, cy + y * k) for x, y in pts]
    layer(img, P((0, -14), (92, 28), (0, 70), (-92, 28)), (0x5f, 0xe0, 0xa8), (0x2f, 0xa7, 0xc9), .95)
    layer(img, P((0, -50), (92, -8), (0, 34), (-92, -8)), (0x3d, 0x9b, 0xff), (0x6a, 0x4f, 0xf0), .95)
    layer(img, P((0, -86), (92, -44), (0, -2), (-92, -44)), (0xff, 0xb3, 0x47), (0xf0, 0x50, 0x7a), 1.0)
    layer(img, P((0, -70), (24, -58), (0, -46), (-24, -58)), (255, 255, 255), (255, 255, 255), .35)
    return img.resize((px, px), Image.LANCZOS)

for name, px, pad, rounded in [('icon-192.png', 192, 0.04, True), ('icon-512.png', 512, 0.04, True), ('icon-maskable-512.png', 512, 0.0, False), ('apple-touch-icon.png', 180, 0.0, False), ('favicon-32.png', 32, 0.02, True)]:
    render(px, pad, rounded).save(os.path.join(OUT, name))
    print('wrote', name)
