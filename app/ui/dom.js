export const $ = (sel, root = document) => root.querySelector(sel);
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in n && k !== 'list') n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
}
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'ic ' + cls);
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', `assets/icons.svg#i-${name}`);
  s.append(u);
  return s;
}
export const iconBtn = (name, title, onClick, cls = 'iconbtn') => el('button', { class: cls, title, 'aria-label': title, onClick }, icon(name));
export const inTextField = (t) => t && (t.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
