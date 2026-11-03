// UI kit icons: a stroke icon set on a 24 px grid, drawn with currentColor so it follows the text colour and both modes.
// Stroke width, caps and joins come from the kit (a sharp kit gets square joins, a soft one round). Output is an SVG sprite
// (<symbol> per icon) plus helpers to inline one icon. No dependency, no external artwork.

const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const R = (x, y, w, h, rx = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
const P = (d) => `<path d="${d}"/>`;

export const ICONS = {
  check: P('M5 12.5l4.5 4.5L19 7.5'),
  x: P('M6 6l12 12M18 6L6 18'),
  plus: P('M12 5v14M5 12h14'),
  minus: P('M5 12h14'),
  'chevron-down': P('M6 9l6 6 6-6'),
  'chevron-up': P('M6 15l6-6 6 6'),
  'chevron-left': P('M15 6l-6 6 6 6'),
  'chevron-right': P('M9 6l6 6-6 6'),
  'arrow-right': P('M5 12h14M13 6l6 6-6 6'),
  'arrow-left': P('M19 12H5M11 6l-6 6 6 6'),
  search: C(11, 11, 6.5) + P('M16 16l4.5 4.5'),
  menu: P('M4 7h16M4 12h16M4 17h16'),
  more: C(6, 12, 1) + C(12, 12, 1) + C(18, 12, 1),
  settings: P('M4 7h9M17 7h3M4 17h3M11 17h9') + C(15, 7, 2) + C(9, 17, 2),
  user: C(12, 8, 3.5) + P('M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5'),
  users: C(9, 8, 3) + P('M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5') + C(17, 9, 2.5) + P('M17 14c2.6 0 4.5 1.7 4.5 4.5'),
  home: P('M4 11.5L12 4l8 7.5M6.5 10v10h11V10M10 20v-5h4v5'),
  folder: P('M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z'),
  file: P('M7 3.5h7l4.5 4.5v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1zM14 3.5V8h4.5'),
  edit: P('M4 20l1-4L16.5 4.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8 19zM14.5 6.5l3 3'),
  trash: P('M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6'),
  copy: R(8.5, 8.5, 11, 11, 1.5) + P('M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5'),
  download: P('M12 4v11M7 11l5 5 5-5M5 20h14'),
  upload: P('M12 16V5M7 9l5-5 5 5M5 20h14'),
  link: P('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'),
  external: P('M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'),
  eye: P('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z') + C(12, 12, 3),
  'eye-off': P('M3 3l18 18M10.6 5.7A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.6 7.3C4 9 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.5 0 2.9-.4 4.1-1M9.9 9.9a3 3 0 0 0 4.2 4.2'),
  lock: R(5, 11, 14, 9, 2) + P('M8 11V8a4 4 0 0 1 8 0v3'),
  unlock: R(5, 11, 14, 9, 2) + P('M8 11V8a4 4 0 0 1 7.5-2'),
  bell: P('M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0'),
  mail: R(3.5, 5.5, 17, 13, 2) + P('M4 7.5l8 6 8-6'),
  calendar: R(4, 5.5, 16, 14.5, 2) + P('M4 10h16M8.5 3.5v4M15.5 3.5v4'),
  clock: C(12, 12, 8.5) + P('M12 7.5V12l3 2'),
  star: P('M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.8l-5.1 2.7 1-5.7-4.1-4 5.7-.8z'),
  heart: P('M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.2 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z'),
  info: C(12, 12, 8.5) + P('M12 11v5.5M12 7.8v.2'),
  'alert-triangle': P('M12 4L3 19.5h18zM12 10v4.5M12 17v.2'),
  'alert-circle': C(12, 12, 8.5) + P('M12 7.5v5.5M12 16.2v.2'),
  'check-circle': C(12, 12, 8.5) + P('M8 12.5l3 3 5-6'),
  'x-circle': C(12, 12, 8.5) + P('M9 9l6 6M15 9l-6 6'),
  help: C(12, 12, 8.5) + P('M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 16.5v.2'),
  filter: P('M4 5h16l-6 7.5V19l-4 1.5v-8z'),
  refresh: P('M20 11a8 8 0 0 0-14-4.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4.5L20 15M20 20v-5h-5'),
  sun: C(12, 12, 3.5) + P('M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4'),
  moon: P('M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'),
  globe: C(12, 12, 8.5) + P('M3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5S14.5 18.2 12 20.5c-2.5-2.3-3.8-5.2-3.8-8.5S9.5 5.8 12 3.5z'),
  code: P('M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12'),
  terminal: R(3.5, 5, 17, 14, 2) + P('M7.5 10l3 2.5-3 2.5M13 15h4'),
  image: R(3.5, 5, 17, 14, 2) + C(9, 10, 1.5) + P('M4 17l5-4.5 4 3.5 3-2.5 4 3.5'),
  play: P('M8 5.5v13l11-6.5z'),
  pause: P('M8 5.5v13M16 5.5v13'),
  send: P('M20.5 3.5L10 14M20.5 3.5L14 20.5l-4-6.5-6.5-4z'),
  save: P('M5 4.5h11l3.5 3.5v10.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM8 4.5v5h7v-5M8 20v-6h8v6'),
  logout: P('M10 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h4M15 8l4 4-4 4M19 12H9.5'),
  login: P('M14 4.5h4A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-4M9.5 8l4 4-4 4M13.5 12H4'),
  grid: R(4, 4, 6, 6, 1) + R(14, 4, 6, 6, 1) + R(4, 14, 6, 6, 1) + R(14, 14, 6, 6, 1),
  list: P('M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.2M4.5 12h.2M4.5 17.5h.2'),
  bookmark: P('M7 4.5h10a1 1 0 0 1 1 1V20l-6-4-6 4V5.5a1 1 0 0 1 1-1z'),
  tag: P('M3.5 12.5V5A1.5 1.5 0 0 1 5 3.5h7.5l8 8a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z') + C(8, 8, 1.2),
  layers: P('M12 4l9 4.5-9 4.5-9-4.5zM3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5'),
};

export const ICON_NAMES = Object.keys(ICONS);

// Stroke character per design personality (variant key). Overridable with `uikit set icon_stroke=2`.
export const ICON_STYLES = {
  soft: { stroke: 1.75, cap: 'round', join: 'round' },
  sharp: { stroke: 1.5, cap: 'square', join: 'miter' },
  relief: { stroke: 2, cap: 'round', join: 'round' },
  dense: { stroke: 1.5, cap: 'round', join: 'round' },
  editorial: { stroke: 1.25, cap: 'butt', join: 'miter' },
};

export function iconStyleOf(tokens) {
  const base = ICON_STYLES[tokens?.variant?.key] ?? ICON_STYLES.soft;
  const stroke = tokens?.overrides?.icon_stroke;
  return { ...base, ...(Number.isFinite(stroke) ? { stroke } : {}) };
}

const attrs = ({ stroke, cap, join }) => `fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="${cap}" stroke-linejoin="${join}"`;

export function iconSvg(name, style = ICON_STYLES.soft, { size = 24, label } = {}) {
  if (!ICONS[name]) throw new Error(`Unknown icon "${name}". Available: ${ICON_NAMES.join(', ')}`);
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ${attrs(style)} ${a11y}>${ICONS[name]}</svg>`;
}

// One file with a <symbol> per icon: <svg><use href="icons.svg#check"/></svg>
export function spriteSvg(tokens) {
  const style = iconStyleOf(tokens);
  const symbols = ICON_NAMES.map((n) => `<symbol id="${n}" viewBox="0 0 24 24" ${attrs(style)}>${ICONS[n]}</symbol>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols}\n</svg>\n`;
}

// Same set, as a hidden block to inline at the top of a page (so <use href="#check"> works without a second file).
export const inlineSprite = (tokens) => spriteSvg(tokens).replace('<svg ', '<svg aria-hidden="true" ');

export const useIcon = (name, { size = 20, cls = 'ui-icon' } = {}) =>
  `<svg class="${cls}" width="${size}" height="${size}" aria-hidden="true"><use href="#${name}"/></svg>`;
