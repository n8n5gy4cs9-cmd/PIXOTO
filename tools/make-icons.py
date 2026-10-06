#!/usr/bin/env python3
"""One-off generator: Composa Icons.cs path data -> app/assets/icons.svg (symbols, 24 grid, currentColor).
Run only when icons change; the output is committed, nothing runs on the host."""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "TEMP_TO_BE_REMOVED/Composa-main/src/Composa.App/Icons.cs").read_text()
tok = re.compile(r'"([^"]*)"|\bnull\b|\btrue\b|\bfalse\b')
icons = []
for m in re.finditer(r'public static readonly Icon (\w+) = new\((.*?)\);', src):
    args = [(t.group(1) if t.group(1) is not None else t.group(0)) for t in tok.finditer(m.group(2))]
    raw = [t.group(0) for t in tok.finditer(m.group(2))]
    vals = [None if r == 'null' else (r == 'true' if r in ('true','false') else r[1:-1]) for r in raw]
    stroke = vals[0] if len(vals) > 0 else None
    fill = vals[1] if len(vals) > 1 else None
    dashed = vals[2] if len(vals) > 2 else False
    icons.append((m.group(1), stroke, fill, dashed))

def kebab(n): return re.sub(r'(?<!^)(?=[A-Z])', '-', n).lower()

# Extra icons in the same 24-grid line style (not in Composa's Icons.cs)
extra = {
 'undo': ('M9 14 L4 9 L9 4 M4 9 H15 A5 5 0 0 1 15 19 H11', None, False),
 'redo': ('M15 14 L20 9 L15 4 M20 9 H9 A5 5 0 0 0 9 19 H13', None, False),
 'menu': ('M4 6 H20 M4 12 H20 M4 18 H20', None, False),
 'layers': ('M12 3 L21 8 L12 13 L3 8 Z M3 12.5 L12 17.5 L21 12.5 M3 16.5 L12 21.5 L21 16.5', None, False),
 'rounded-rect': ('M7 3.5 H17 A3.5 3.5 0 0 1 20.5 7 V17 A3.5 3.5 0 0 1 17 20.5 H7 A3.5 3.5 0 0 1 3.5 17 V7 A3.5 3.5 0 0 1 7 3.5 Z', None, False),
 'rect': ('M4 4 H20 V20 H4 Z', None, False),
 'ellipse': ('M12 4 A8 8 0 1 1 12 20 A8 8 0 1 1 12 4 Z', None, False),
 'liquify': ('M3 9 C7 5 10 13 14 9 C17 6 19 8 21 7 M3 16 C7 12 10 20 14 16 C17 13 19 15 21 14', None, False),
 'blur': ('M12 3 C12 3 5.5 10.5 5.5 15 A6.5 6.5 0 0 0 18.5 15 C18.5 10.5 12 3 12 3 Z M9 15 A3 3 0 0 0 12 18', None, False),
 'smudge': ('M4 17 C8 17 9 9 14 9 C17 9 18 11 20 11 M4 21 H20', None, False),
 'dodge': ('M12 7 A5 5 0 1 1 12 17 A5 5 0 1 1 12 7 Z M12 2 V4 M12 20 V22 M2 12 H4 M20 12 H22 M5 5 L6.5 6.5 M17.5 17.5 L19 19 M19 5 L17.5 6.5 M6.5 17.5 L5 19', None, False),
 'burn': ('M12 3 C13 8 18 9 18 15 A6 6 0 0 1 6 15 C6 12 8 11 8.5 8.5 C10 10 11 9 12 3 Z', None, False),
 'new-layer': ('M5 3 H15 L19 7 V21 H5 Z M15 3 V7 H19 M12 11 V17 M9 14 H15', None, False),
 'new-folder': ('M3 6 H9.5 L11.5 8.5 H21 V19 H3 Z M12 11.5 V16.5 M9.5 14 H14.5', None, False),
 'fit': ('M4 9 V4 H9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15', None, False),
 'check': ('M5 12.5 L10 17.5 L19 7', None, False),
 'up': ('M6 15 L12 9 L18 15', None, False),
 'down': ('M6 9 L12 15 L18 9', None, False),
 'file-image': ('M5 3 H15 L19 7 V21 H5 Z M15 3 V7 H19 M8 17 L11 13 L13 15.5 L15 13 L17 17 Z', None, False),
}
out = ['<svg xmlns="http://www.w3.org/2000/svg" style="display:none">']
def sym(id_, stroke, fill, dashed):
    s = f'<symbol id="i-{id_}" viewBox="0 0 24 24">'
    if fill: s += f'<path d="{fill}" fill="currentColor" stroke="none"/>'
    if stroke:
        d = ' stroke-dasharray="2.2 2.2"' if dashed else ''
        s += f'<path d="{stroke}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"{d}/>'
    return s + '</symbol>'
for name, stroke, fill, dashed in icons:
    out.append(sym(kebab(name), stroke, fill, dashed))
for k, (stroke, fill, dashed) in extra.items():
    out.append(sym(k, stroke, fill, dashed))
out.append('</svg>')
(root / 'app/assets/icons.svg').write_text('\n'.join(out) + '\n')
print(len(icons), 'composa icons +', len(extra), 'extra')
