import { el, icon } from './dom.js';
import { TOOLS } from '../core/tools.js';
import { FILTERS, FILTER_GROUPS } from '../core/filters/filters.js';
import { commands, keysOf, labelOf, prettyKey } from '../core/commands.js';

// Help (F1): a full-screen guide. Tool and shortcut tables are generated from the live tool and command registries, so
// they always match the app, including remapped keys.
const kbd = (k) => el('kbd', {}, prettyKey(k));
const p = (...c) => el('p', {}, ...c);
const list = (items) => el('ul', {}, items.map((t) => el('li', {}, t)));
const card = (title, ...body) => el('div', { class: 'hcard' }, el('h4', {}, title), ...body);
const grid = (cards) => el('div', { class: 'hgrid' }, cards);
const tip = (text) => el('div', { class: 'htip' }, el('b', {}, 'Tip '), text);

function toolCard(t) {
  const icons = t.modes ? t.modes.map((m) => el('span', { class: 'hmode', title: m.name }, icon(m.icon), el('i', {}, m.name))) : [];
  return el('div', { class: 'htool' },
    el('div', { class: 'hico' }, icon(t.modes ? t.modes[0].icon : t.icon)),
    el('div', { class: 'hbody' },
      el('h4', {}, t.name, ' ', kbd(t.key.toUpperCase()), t.altKey ? [' ', kbd(t.altKey.toUpperCase())] : null),
      p(t.hint.split(' · ').join(' — ')),
      icons.length ? el('div', { class: 'hmodes' }, icons) : null));
}

const SECTIONS = [
  ['start', 'Getting started', 'move', () => [
    p('Pixoto is a layer-based compositing and retouching editor that runs entirely in your browser. Nothing is uploaded: your images, projects and settings stay on this device.'),
    grid([
      card('Create or open', p('Use ', el('b', {}, 'File ▸ New'), ' for a blank canvas or ', el('b', {}, 'File ▸ Open'), ' for images and projects. You can also drop files on the window; dropping onto an open document places them as new layers.')),
      card('Work in layers', p('Every image, shape, text block and adjustment lives on its own layer in the Layers panel. Reorder, hide, group, mask and blend them without touching the pixels below.')),
      card('Undo anything', p('Every change is a named history step (100 steps). ', kbd('Ctrl+Z'), ' undoes, ', kbd('Ctrl+Shift+Z'), ' redoes.')),
      card('Save your work', p('Save as a project to keep layers, masks, text and effects editable. Export PNG, JPEG or WebP for a flat image. Unsaved work is recovered if the tab closes.')),
    ]),
    tip('Every command in the menus has a shortcut you can change in Edit ▸ Keyboard Shortcuts.'),
  ]],
  ['tools', 'Tools', 'brush', () => [
    p('The toolbar on the left holds the tools. Tools with several modes (Marquee, Lasso, Magic, Brush, Smear, Shape) switch mode by pressing their key again or with ', kbd('Tab'), '. The option bar above the canvas shows the settings of the current tool.'),
    el('div', { class: 'htools' }, TOOLS.map(toolCard)),
    tip('Hold Space to pan with any tool. Use [ and ] to change brush size and 1–0 to set opacity.'),
  ]],
  ['select', 'Selections', 'marquee', () => [
    p('A selection limits where an edit has an effect. Edges are soft-edged masks, so feathered selections work everywhere.'),
    grid([
      card('Make', list(['Marquee: rectangle or ellipse.', 'Lasso: freehand or polygonal.', 'Magic Wand: similar colours, contiguous or global.', 'Object: click an object to outline it.', 'Select ▸ Subject finds the main subject.'])),
      card('Combine', list(['Shift adds, Alt subtracts, Shift+Alt intersects.', 'Drag inside an existing selection to move it.', 'Select ▸ Inverse flips it.'])),
      card('Refine', list(['Expand, Contract and Feather in the Select menu.', 'Select ▸ Pixels loads a layer’s opacity; Mask loads a layer mask.', 'Ctrl-click a mask thumbnail to load it.'])),
      card('Use', list(['Delete clears the selected pixels.', 'Fill with the foreground or background colour.', 'Edit ▸ Content-Aware Fill removes what is selected.', 'Filters and adjustments only change the selected area.'])),
    ]),
  ]],
  ['paint', 'Painting and retouching', 'brush', () => [
    grid([
      card('Brush and Eraser', p('Pressure-sensitive on pens and touch. Size, hardness, opacity and flow are in the option bar; Shift-click draws a straight line from the last point; Alt-click picks a colour.')),
      card('Spot Healing', p('Paint over a blemish and Pixoto fills it from the surroundings.')),
      card('Clone Stamp', p('Alt-click to set a source, then paint to copy from it. The source follows your stroke.')),
      card('Smear', p('Liquify pushes pixels, Blur softens, Smudge drags colour, Dodge lightens and Burn darkens.')),
      card('Gradient', p('Drag to draw, drag the ends to adjust. Edit the colour stops in the option bar, then press Enter.')),
      card('Colours', p('The foreground and background swatches sit under the toolbar. ', kbd('X'), ' swaps them and ', kbd('D'), ' resets them to black and white.')),
    ]),
  ]],
  ['layers', 'Layers, masks and effects', 'layers', () => [
    grid([
      card('Layer panel', list(['Eye toggles visibility.', 'Drag to reorder or drop into folders.', 'Opacity and blend mode at the top of the panel.', 'Clip a layer to the one below with Layer ▸ Clip.'])),
      card('Masks', list(['Add a mask to hide parts of a layer without erasing.', 'Paint black to hide and white to show.', 'Shift-click the thumbnail to disable it.', 'Apply Mask bakes it into the pixels.'])),
      card('Layer effects', p('Stroke, Drop Shadow, Colour Overlay, Inner Shadow, Outer Glow and Inner Glow stay editable and never alter the pixels.')),
      card('Adjustment layers', p('Layer ▸ New Adjustment Layer applies a non-destructive correction (Levels, Curves, Hue/Saturation …) to everything below it. Double-click it to edit later.')),
      card('Text and shapes', p('Text and shapes are live layers: double-click text to edit it, or rasterize it with Layer ▸ Rasterize when you want to paint on it.')),
      card('Transform', p('The Move tool shows handles around the layer: resize, rotate outside a corner, distort with Ctrl-drag. Hold Shift to keep proportions.')),
    ]),
  ]],
  ['adjust', 'Adjustments', 'adjust', () => [
    p('Image ▸ Adjustments change the active layer permanently and show a live preview while you drag the sliders. The same dialogs create adjustment layers from Layer ▸ New Adjustment Layer.'),
    list(['Brightness/Contrast, Levels, Curves, Exposure', 'Hue/Saturation, Vibrance, Colour Balance, Black & White', 'Gradient Map, Threshold, Posterize, Sepia, Solarize, Invert', 'Auto Levels for a one-click correction']),
    tip('Double-click any slider to reset it to its default. Untick Preview to compare with the original.'),
  ]],
  ['filters', 'Filters', 'blur', () => [
    p('The Filter menu holds destructive effects. Each opens a small dialog with a live preview on the canvas; ', el('b', {}, 'Preview'), ' toggles it, ', el('b', {}, 'Reset'), ' restores the defaults and OK applies it as one undo step. ', kbd('Ctrl+F'), ' repeats the last filter with the same settings.'),
    el('div', { class: 'hgrid' }, FILTER_GROUPS.map((g) => card(g, list(FILTERS.filter((f) => f.group === g).map((f) => f.name))))),
    tip('Heavy filters run in a background worker, so the interface stays responsive. If a selection is active only the selected area changes.'),
  ]],
  ['view', 'View and navigation', 'zoom', () => [
    grid([
      card('Zoom', p('Ctrl + wheel, pinch, or the Zoom tool. Zoomed out the picture is smoothed; zoomed in it shows crisp pixels with an optional grid.')),
      card('Pan and rotate', p('Hold Space and drag, or use the Hand tool. View ▸ Rotate turns the canvas for easier drawing without changing the picture.')),
      card('Guides and rulers', p('Show rulers, drag guides out of them, and enable snapping to guides, the grid, layers or their bounds.')),
      card('Tabs', p('Every document has a tab. Unsaved changes are marked, and you are asked before closing.')),
    ]),
  ]],
  ['files', 'Files', 'file-image', () => [
    grid([
      card('Projects', p('Save keeps layers, masks, text, effects and guides in a Pixoto project file you can reopen later.')),
      card('Images', p('Open PNG, JPEG, WebP, GIF, AVIF and more. Export to PNG, JPEG or WebP with a preview of the file size.')),
      card('Photoshop files', p('PSD files open with their layers where possible; anything that cannot be converted is listed in a report.')),
      card('Install and offline', p('Install Pixoto from your browser menu to use it as an app. It works offline, and updates itself when new code is available.')),
    ]),
  ]],
  ['keys', 'Keyboard shortcuts', 'ruler', () => {
    const groups = {};
    for (const c of commands.values()) { const ks = keysOf(c); if (ks.length) (groups[c.group] ||= []).push([labelOf(c), ks]); }
    return [p('Generated from your current settings. Change any of them in Edit ▸ Keyboard Shortcuts.'),
      el('div', { class: 'hkeys' }, Object.entries(groups).map(([g, rows]) => el('div', { class: 'hcard' }, el('h4', {}, g),
        el('div', { class: 'hrows' }, rows.map(([n, ks]) => el('div', { class: 'hrow' }, el('span', {}, n), el('span', { class: 'hk' }, ks.map(kbd))))))))];
  }],
  ['touch', 'Touch and mobile', 'hand', () => [
    list(['Use two fingers to pan and pinch to zoom; one finger draws with the active tool.', 'Tool and panel targets grow on touch screens.', 'Pen pressure is used where the device reports it.', 'On a phone, panels open from the buttons on the edge.']),
  ]],
];

export function showHelp(onShortcuts) {
  if (document.querySelector('.helppage')) return;
  const nav = el('nav', { class: 'hnav' }), main = el('main', { class: 'hmain' });
  const sections = SECTIONS.map(([id, title, ic, build]) => {
    const sec = el('section', { id: 'h-' + id }, el('h2', {}, el('span', { class: 'hico sm' }, icon(ic)), title), ...build());
    const link = el('button', { class: 'hlink', onClick: () => { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, icon(ic), title);
    nav.append(link); main.append(sec);
    return { sec, link };
  });
  const hero = el('header', { class: 'hhero' }, el('img', { src: 'assets/icon.svg', alt: '' }), el('div', {}, el('h1', {}, 'Pixoto Help'), p('Everything you need to know about the editor, its tools and its shortcuts.')));
  const close = () => { page.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'F1') { e.preventDefault(); e.stopPropagation(); close(); } };
  const page = el('div', { class: 'helppage', role: 'dialog', 'aria-label': 'Help' },
    el('div', { class: 'hbar' }, el('b', {}, 'Help'), el('span', { class: 'grow' }), onShortcuts ? el('button', { class: 'btn', onClick: () => { close(); onShortcuts(); } }, 'Edit shortcuts…') : null, el('button', { class: 'btn accent', onClick: close }, 'Close')),
    el('div', { class: 'hwrap' }, nav, el('div', { class: 'hscroll' }, hero, main)));
  const scroller = page.querySelector('.hscroll');
  scroller.addEventListener('scroll', () => {
    let cur = sections[0];
    for (const s of sections) if (s.sec.offsetTop - scroller.scrollTop < 120) cur = s;
    for (const s of sections) s.link.classList.toggle('on', s === cur);
  });
  sections[0].link.classList.add('on');
  document.addEventListener('keydown', onKey, true);
  document.body.append(page);
  page.querySelector('.btn.accent').focus();
}
