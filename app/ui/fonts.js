// Font families offered in the Type bar: a web-safe set, plus installed fonts when the browser can list them
// (Chromium's Local Font Access, asked for once on request).
const BASE = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Times New Roman', 'Georgia', 'Garamond', 'Courier New', 'Consolas', 'Impact', 'Comic Sans MS', 'Palatino', 'Lucida Sans', 'Segoe UI', 'Roboto', 'Inter', 'system-ui', 'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'];
let extra = [];
export const FONT_FAMILIES = () => [...BASE, ...extra];
export const canListFonts = () => typeof window.queryLocalFonts === 'function';
export async function loadInstalledFonts() {
  try { const list = await window.queryLocalFonts(); extra = [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b)); return extra.length; } catch { return 0; }
}
