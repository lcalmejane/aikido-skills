// UI kit tokens: a small "seed" (brand colours, fonts, a few preferences) plus a variant (a design personality)
// is expanded into the full, reproducible token set: semantic colours for light AND dark, type scale, spacing,
// radii, shadows, motion. Contrast is enforced while the colours are built, then verified by checkTokens().
// Zero dependency. The result is plain JSON (tokens.json), versioned with the project.
import { contrast, ensureContrast, fillFor, hexOk, hsl, mix, parseHex, rgba, rgbToHsl, luminance } from './uikit-color.mjs';

export const SCHEMA = 1;
export const MODES = ['light', 'dark'];

export const SYSTEM_FONTS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

// Five personalities to compare on the same screens. Numbers are deliberately few: everything else derives from them.
export const VARIANTS = {
  A: { id: 'soft', label: 'Doux', description: 'Angles généreux, ombres diffuses, boutons à plat. Accueillant, grand public.',
    radius: 10, border: 1, elevation: 0.6, control: 40, ratio: 1.2, button: 'flat', gloss: 0, grain: 0, tint: 0.1, saturation: 0.62, display: 'sans', uppercase: false, tracking: 0 },
  B: { id: 'sharp', label: 'Net', description: 'Angles francs, filets fins, ombres discrètes. Sérieux, outil professionnel.',
    radius: 3, border: 1, elevation: 0.3, control: 36, ratio: 1.125, button: 'flat', gloss: 0, grain: 0, tint: 0.07, saturation: 0.58, display: 'sans', uppercase: false, tracking: 0 },
  C: { id: 'relief', label: 'Relief', description: 'Boutons en dégradé avec reflet, ombres marquées. Tactile, ludique, très lisible.',
    radius: 8, border: 1, elevation: 1, control: 40, ratio: 1.2, button: 'gradient', gloss: 0.22, grain: 0, tint: 0.09, saturation: 0.7, display: 'sans', uppercase: false, tracking: 0 },
  D: { id: 'dense', label: 'Dense', description: 'Compact, quasi sans ombre, tableaux serrés. Données et administration.',
    radius: 4, border: 1, elevation: 0.15, control: 32, ratio: 1.125, button: 'flat', gloss: 0, grain: 0, tint: 0.05, saturation: 0.5, display: 'sans', uppercase: false, tracking: 0 },
  E: { id: 'editorial', label: 'Éditorial', description: 'Titres en empattement, grands espaces, capitales espacées sur les actions. Contenu et marque.',
    radius: 2, border: 1, elevation: 0.2, control: 44, ratio: 1.25, button: 'flat', gloss: 0, grain: 0.04, tint: 0.12, saturation: 0.55, display: 'serif', uppercase: true, tracking: 0.06 },
};

export const PARAM_KEYS = ['radius', 'border', 'elevation', 'control', 'ratio', 'button', 'gloss', 'grain', 'tint', 'saturation', 'display', 'uppercase', 'tracking'];
export const variantIds = () => Object.keys(VARIANTS);

const STATUS_HUES = { success: 145, warning: 38, danger: 3, info: 208 };
const DEFAULT_SEED = { primary: '#3b5bdb', accent: '#0ca678', neutral: null, ink: null, palette: [], prefers: 'light', fonts: [] };

// ---------------------------------------------------------------------------
// Seed: where the colours come from
// ---------------------------------------------------------------------------

function itemsOf(palette = []) {
  return (palette ?? []).map((c) => (typeof c === 'string' ? { hex: c } : c)).filter((c) => hexOk(c.hex));
}

// The whole palette is kept: `neutral` is the lightest neutral (page background in light mode), `ink` the darkest one
// (text in light mode, page background in dark mode). Both are used as given, never recomputed.
function rolesOf(palette = []) {
  const items = itemsOf(palette);
  const by = (role) => items.find((c) => c.role === role)?.hex;
  const free = items.filter((c) => !['neutral'].includes(c.role));
  const neutrals = [...new Set(items.filter((c) => c.role === 'neutral').map((c) => c.hex.toLowerCase()))].sort((a, b) => luminance(b) - luminance(a));
  return {
    primary: by('primary') ?? free[0]?.hex,
    accent: by('accent') ?? free.find((c) => c.hex !== (by('primary') ?? free[0]?.hex))?.hex,
    neutral: neutrals[0],
    ink: neutrals.length > 1 ? neutrals[neutrals.length - 1] : undefined,
  };
}

const paletteOf = (palette) => itemsOf(palette).slice(0, 16).map((c) => ({ hex: c.hex.toLowerCase(), role: c.role ?? 'free', ...(c.name ? { name: c.name } : {}) }));

// Reads the custom properties of a stylesheet (the first value of each name wins: :root comes first).
export function extractCssSeed(text) {
  const vars = {};
  for (const m of text.matchAll(/--([a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) if (!(m[1] in vars)) vars[m[1]] = m[2].trim();
  const hex = (...names) => names.map((n) => vars[n]).find((v) => hexOk(v));
  const primary = hex('primary', 'color-primary', 'brand', 'accent');
  const accent = hex('accent-2', 'secondary', 'color-accent', 'accent') !== primary ? hex('accent-2', 'secondary', 'color-accent', 'accent') : undefined;
  const bg = hex('bg', 'background', 'color-bg', 'surface');
  const radius = Number.parseFloat(vars.radius ?? vars['border-radius'] ?? '');
  const fonts = [...text.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map((m) => m[1].split(',')[0].trim().replace(/^["']|["']$/g, '')).filter((f) => f && !f.startsWith('var(') && !/^(system-ui|sans-serif|serif|monospace|inherit)$/i.test(f));
  return { primary, accent, neutral: bg, prefers: bg ? (luminance(bg) < 0.25 ? 'dark' : 'light') : undefined, radius: Number.isFinite(radius) ? radius : undefined, fonts: [...new Set(fonts)].slice(0, 3), variables: Object.keys(vars).length };
}

// Priority: explicit colours > stylesheet > charter > brief > project scan > defaults. `sources` says what was used.
export function seedFrom({ colors = {}, css = null, charter = null, brief = null, scan = null, prefers } = {}) {
  const sources = [];
  const pick = (key, candidates) => {
    for (const [source, value] of candidates) if (hexOk(value)) { sources.push(`${key}:${source}`); return value.toLowerCase(); }
    return null;
  };
  const cr = rolesOf(charter?.brand?.palette);
  const br = rolesOf(brief?.brand?.palette);
  const sr = rolesOf(scan?.brand_palette);
  const seed = { ...DEFAULT_SEED };
  seed.primary = pick('primary', [['option', colors.primary], ['css', css?.primary], ['charter', cr.primary], ['brief', br.primary], ['scan', sr.primary], ['default', DEFAULT_SEED.primary]]);
  seed.accent = pick('accent', [['option', colors.accent], ['css', css?.accent], ['charter', cr.accent], ['brief', br.accent], ['scan', sr.accent], ['default', DEFAULT_SEED.accent]]);
  seed.neutral = pick('neutral', [['option', colors.neutral], ['charter', cr.neutral], ['brief', br.neutral], ['css', css?.neutral]]);
  seed.ink = pick('ink', [['option', colors.ink], ['charter', cr.ink], ['brief', br.ink]]);
  seed.palette = paletteOf(charter?.brand?.palette?.length ? charter.brand.palette : brief?.brand?.palette?.length ? brief.brand.palette : scan?.brand_palette);
  seed.fonts = [charter?.brand?.fonts, brief?.brand?.fonts, css?.fonts, scan?.fonts].find((f) => f?.length)?.slice(0, 3) ?? [];
  seed.prefers = prefers ?? css?.prefers ?? 'light';
  return { seed, sources, hints: { radius: css?.radius } };
}

export function validateSeed(seed) {
  const e = [];
  for (const k of ['primary', 'accent']) if (!hexOk(seed?.[k])) e.push(`seed.${k} must be a hex colour (got ${seed?.[k]})`);
  if (seed?.neutral && !hexOk(seed.neutral)) e.push(`seed.neutral must be a hex colour (got ${seed.neutral})`);
  if (seed?.ink && !hexOk(seed.ink)) e.push(`seed.ink must be a hex colour (got ${seed.ink})`);
  if (!['light', 'dark'].includes(seed?.prefers)) e.push('seed.prefers must be light or dark');
  return e;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const px = (n) => `${Number(n.toFixed(2))}px`;
const half = (n) => Math.round(n * 2) / 2;

const rgbDist = (a, b) => { const x = parseHex(a); const y = parseHex(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const lc = (h) => String(h).toLowerCase();

// Palette colours that are neither a brand colour nor a neutral (sand, ochre, sage, grey...): the ones borders and muted text can take as they are.
function freeOf(seed) {
  return itemsOf(seed.palette).filter((c) => !['primary', 'accent', 'neutral'].includes(c.role)).map((c) => lc(c.hex));
}

// Returns { colors, trace }. `trace[token]` says where each colour comes from, so the pages can show the link between the palette
// that was given and the colour that is used: { to, how, from: [palette colours], why }.
//   palette    the token IS a palette colour, unchanged
//   adjusted   it starts from a palette colour that had to move (contrast, readable label, dark mode)
//   mixed      a blend of two palette colours
//   derived    computed from one palette colour (hover, pressed, soft tint)
//   generated  no palette colour behind it (status colours, white, overlay)
function buildMode(mode, seed, p) {
  const dark = mode === 'dark';
  const hue = rgbToHsl(seed.neutral ?? seed.primary)[0];
  const n = (l, s = p.tint) => hsl(hue, s, l);
  // The brand's own neutrals win over anything computed: the light neutral is the page background, the dark one the ink
  // (text on light, page background on dark). A neutral of the wrong lightness (a dark stylesheet background) only gives a hue.
  const paperSeed = seed.neutral && luminance(seed.neutral) > 0.6 ? lc(seed.neutral) : null;
  const inkSeed = seed.ink && luminance(seed.ink) < 0.12 ? lc(seed.ink) : null;
  const hasNeutrals = Boolean(paperSeed || inkSeed);
  const paper = paperSeed ?? n(0.94, 0.12);
  const ink = inkSeed ?? n(0.12, 0.25);
  const white = '#ffffff';
  const free = freeOf(seed);

  const trace = {};
  const rec = (token, to, how, from = [], why = '') => {
    trace[token] = { to: lc(to), how, from: [...new Set(from.filter(Boolean).map(lc))], ...(why ? { why } : {}) };
    return lc(to);
  };
  // Moves `base` until every contrast check passes, and says so when it had to.
  const settle = (token, base, how, from, checks, why) => {
    let c = base;
    for (const [against, min] of checks) c = ensureContrast(c, against, min);
    const moved = lc(c) !== lc(base);
    return rec(token, c, moved ? 'adjusted' : how, from, moved ? [why, 'ajustée pour le contraste'].filter(Boolean).join(' ; ') : why);
  };
  // The palette colour closest to `target` that passes the checks; if none passes, the closest one is moved until it does.
  const snap = (token, target, pool, checks, why, fallbackFrom = []) => {
    if (!pool.length || !hasNeutrals) return settle(token, target, 'generated', fallbackFrom, checks, 'aucune couleur de palette adaptée');
    const ok = pool.filter((h) => checks.every(([against, min]) => contrast(h, against) >= min));
    const [from] = (ok.length ? ok : pool).slice().sort((a, b) => rgbDist(a, target) - rgbDist(b, target));
    return settle(token, from, 'palette', [from], checks, why);
  };

  let bg; let surface; let raised; let sunken;
  if (dark) {
    bg = inkSeed ? rec('bg', inkSeed, 'palette', [inkSeed], 'encre de la palette') : rec('bg', n(0.085), 'generated', [], 'pas de neutre sombre dans la palette');
    surface = inkSeed ? rec('surface', mix(ink, paper, 0.06), 'mixed', [ink, paper], 'encre + 6 % de fond clair') : rec('surface', n(0.12), 'generated');
    raised = inkSeed ? rec('surface-raised', mix(ink, paper, 0.1), 'mixed', [ink, paper], 'encre + 10 % de fond clair') : rec('surface-raised', n(0.165), 'generated');
    sunken = inkSeed ? rec('surface-sunken', mix(ink, '#000000', 0.35), 'derived', [ink], 'encre assombrie') : rec('surface-sunken', n(0.06), 'generated');
  } else {
    bg = paperSeed ? rec('bg', paperSeed, 'palette', [paperSeed], 'neutre clair de la palette') : rec('bg', n(0.972, p.tint * 1.3), 'generated', [], 'pas de neutre clair dans la palette');
    surface = paperSeed ? rec('surface', mix(paper, white, 0.6), 'mixed', [paper, white], 'fond + 60 % de blanc') : rec('surface', n(0.998, p.tint * 0.5), 'generated');
    raised = rec('surface-raised', white, 'generated', [], 'blanc pur, surface en relief');
    sunken = paperSeed ? rec('surface-sunken', mix(paper, ink, 0.05), 'mixed', [paper, ink], 'fond + 5 % d\'encre') : rec('surface-sunken', n(0.945, p.tint * 1.2), 'generated');
  }
  const worst = dark ? raised : sunken; // the surface with the least contrast against the text

  const text = settle('text', dark ? paper : ink, hasNeutrals ? 'palette' : 'generated', dark ? [paperSeed ?? null] : [inkSeed], [[worst, 7], [bg, 7]], dark ? 'neutre clair de la palette' : 'encre de la palette');
  // 5.6:1 instead of the 4.5:1 minimum: headroom, so a decorative background image or a tinted zone does not push muted text under AA.
  const mutedTarget = dark ? mix(paper, ink, 0.3) : (paperSeed ? mix(seed.primary, paper, 0.25) : n(0.38, p.tint * 1.4));
  const muted = snap('text-muted', mutedTarget, free, [[worst, 5.6], [bg, 5.6]], 'couleur de palette la plus proche, contraste 5,6:1 minimum');
  const edge = free.filter((h) => (dark ? luminance(h) < 0.2 : luminance(h) > 0.45));
  const border = snap('border', dark ? mix(ink, paper, 0.16) : mix(paper, ink, 0.1), edge, [], 'couleur de palette discrète la plus proche');
  const strong = snap('border-strong', dark ? mix(ink, paper, 0.5) : mix(paper, ink, 0.5), free, [[worst, 3], [bg, 3]], 'couleur de palette la plus proche, contraste 3:1 minimum');

  const lightLabel = paperSeed ?? white;
  const darkLabel = inkSeed ?? '#0b0d14';
  const brand = (base, key, how, from, why) => {
    const lifted = dark ? ensureContrast(base, bg, 3.2) : base;
    const { fill, on } = fillFor(lifted, 4.5, [lightLabel, darkLabel]);
    const moved = lc(fill) !== lc(base);
    const reasons = [why];
    if (dark && lc(lifted) !== lc(base)) reasons.push('éclaircie pour rester visible sur fond sombre');
    if (lc(fill) !== lc(lifted)) reasons.push('ajustée pour que le libellé reste lisible');
    rec(key, fill, moved ? 'adjusted' : how, from, reasons.filter(Boolean).join(' ; '));
    rec(`on-${key}`, on, lc(on) === lc(lightLabel) || lc(on) === lc(darkLabel) ? (hasNeutrals && lc(on) !== white && lc(on) !== '#0b0d14' ? 'palette' : 'generated') : 'generated', hasNeutrals && (lc(on) === lc(paperSeed ?? '') || lc(on) === lc(inkSeed ?? '')) ? [on] : [], 'libellé le plus lisible sur ce fond');
    // Hover and pressed move the fill AWAY from the label colour, so the label contrast can only go up.
    const toward = luminance(on) > 0.5 ? '#000000' : '#ffffff';
    const hover = rec(`${key}-hover`, mix(fill, toward, 0.12), 'derived', [fill], 'survol : 12 % vers le noir ou le blanc');
    const active = rec(`${key}-active`, mix(fill, toward, 0.22), 'derived', [fill], 'appui : 22 % vers le noir ou le blanc');
    const soft = mix(bg, fill, dark ? 0.22 : 0.12);
    rec(`${key}-soft`, soft, 'mixed', [bg, fill], dark ? 'fond + 22 % de la couleur' : 'fond + 12 % de la couleur');
    const textOn = ensureContrast(ensureContrast(fill, soft, 4.5), worst, 4.5);
    rec(`${key}-text`, textOn, lc(textOn) === lc(fill) ? 'derived' : 'adjusted', [fill], lc(textOn) === lc(fill) ? 'texte de la couleur' : 'assombrie ou éclaircie pour un texte lisible');
    return { fill, on, hover, active, soft, text: textOn };
  };
  const primary = brand(seed.primary, 'primary', 'palette', [seed.primary], 'couleur principale de la palette');
  const accent = brand(seed.accent, 'accent', 'palette', [seed.accent], 'couleur d\'accent de la palette');

  const out = {
    bg, surface, 'surface-raised': raised, 'surface-sunken': sunken, text, 'text-muted': muted, border, 'border-strong': strong,
    primary: primary.fill, 'on-primary': primary.on, 'primary-hover': primary.hover, 'primary-active': primary.active, 'primary-soft': primary.soft, 'primary-text': primary.text,
    accent: accent.fill, 'on-accent': accent.on, 'accent-hover': accent.hover, 'accent-active': accent.active, 'accent-soft': accent.soft, 'accent-text': accent.text,
  };
  // Status colours: the palette colour closest in hue when there is one (a gold for "warning", a sage for "success"...), generated otherwise.
  const taken = new Set();
  const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const statusPool = hasNeutrals ? itemsOf(seed.palette).filter((c) => !['primary', 'accent', 'neutral'].includes(c.role)).map((c) => ({ hex: lc(c.hex), hsl: rgbToHsl(c.hex) })).filter((c) => c.hsl[1] >= 0.15 && c.hsl[2] > 0.15 && c.hsl[2] < 0.9) : [];
  for (const [name, h] of Object.entries(STATUS_HUES)) {
    // Closest hue, but a mid-lightness colour reads as a status better than a very pale one.
    const score = (c) => hueGap(c.hsl[0], h) + 60 * Math.abs(c.hsl[2] - 0.62);
    const near = statusPool.filter((c) => !taken.has(c.hex) && hueGap(c.hsl[0], h) <= 60).sort((a, b) => score(a) - score(b))[0];
    if (near) taken.add(near.hex);
    const s = near
      ? brand(near.hex, name, 'palette', [near.hex], `couleur de palette la plus proche de la teinte « ${name} »`)
      : brand(hsl(h, p.saturation + 0.1, dark ? 0.58 : 0.42), name, 'generated', [], 'couleur d\'état absente de la palette');
    Object.assign(out, { [name]: s.fill, [`on-${name}`]: s.on, [`${name}-hover`]: s.hover, [`${name}-active`]: s.active, [`${name}-soft`]: s.soft, [`${name}-text`]: s.text });
  }
  out.focus = rec('focus', ensureContrast(primary.text, bg, 3), 'derived', [primary.fill], 'anneau de focus, contraste 3:1');
  out.overlay = rec('overlay', rgba('#000000', dark ? 0.62 : 0.4), 'generated', [], 'voile noir semi-transparent');
  return { colors: out, trace };
}

function buildShadows(mode, p) {
  const dark = mode === 'dark';
  const base = dark ? '#000000' : '#0b1020';
  const k = p.elevation;
  const a = (v) => Math.min(0.9, v * (dark ? 3.2 : 1) * k).toFixed(3);
  return {
    none: 'none',
    sm: `0 1px 2px ${rgba(base, a(0.1))}`,
    md: `0 4px 10px -2px ${rgba(base, a(0.12))}, 0 2px 4px -2px ${rgba(base, a(0.08))}`,
    lg: `0 12px 24px -6px ${rgba(base, a(0.16))}, 0 4px 8px -4px ${rgba(base, a(0.1))}`,
    xl: `0 24px 48px -12px ${rgba(base, a(0.24))}, 0 8px 16px -8px ${rgba(base, a(0.12))}`,
  };
}

export function resolveParams(variant, overrides = {}) {
  const base = VARIANTS[variant];
  if (!base) throw new Error(`Unknown variant "${variant}". Available: ${variantIds().join(', ')}`);
  const params = {};
  for (const k of PARAM_KEYS) params[k] = overrides[k] ?? base[k];
  return params;
}

export function buildTokens({ seed, variant = 'A', overrides = {}, name = 'kit', prefix = 'ui' }) {
  const errors = validateSeed(seed);
  if (errors.length) throw new Error(errors.join('; '));
  const v = VARIANTS[variant];
  if (!v) throw new Error(`Unknown variant "${variant}". Available: ${variantIds().join(', ')}`);
  const p = resolveParams(variant, overrides);
  const stack = (kind, first) => [first ? `"${first}"` : null, SYSTEM_FONTS[kind]].filter(Boolean).join(', ');
  const [brandFont] = seed.fonts;
  const display = p.display === 'serif' ? stack('serif', null) : stack('sans', brandFont);
  const steps = { xs: -2, sm: -1, base: 0, lg: 1, xl: 2, '2xl': 3, '3xl': 4, '4xl': 5 };
  const scale = Object.fromEntries(Object.entries(steps).map(([k, e]) => [k, { size: half(16 * p.ratio ** e), line: e >= 3 ? 1.2 : e >= 2 ? 1.3 : 1.5 }]));
  const space = Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20].map((k) => [String(k), k * 4]));
  const built = Object.fromEntries(MODES.map((m) => [m, buildMode(m, seed, p)]));
  const r = p.radius;
  const radius = { none: 0, sm: Math.max(1, Math.round(r * 0.5)), md: r, lg: Math.round(r * 1.5), xl: Math.round(r * 2.4), pill: 999 };
  return {
    schema: SCHEMA, name, prefix,
    variant: { id: variant, key: v.id, label: v.label, description: v.description },
    seed, params: p, overrides, palette: seed.palette ?? [],
    font: { sans: stack('sans', brandFont), display, mono: SYSTEM_FONTS.mono, base: 16, ratio: p.ratio, scale,
      weight: { regular: 400, medium: 500, bold: 700 }, tracking: { action: p.tracking } },
    space, radius, border: { width: p.border },
    control: { sm: p.control - 8, md: p.control, lg: p.control + 8 },
    shadow: { light: buildShadows('light', p), dark: buildShadows('dark', p) },
    motion: { fast: 120, base: 200, slow: 320, easing: 'cubic-bezier(.2, .8, .2, 1)' },
    z: { dropdown: 100, sticky: 200, overlay: 300, modal: 400, toast: 500, tooltip: 600 },
    breakpoint: { sm: 640, md: 768, lg: 1024, xl: 1280 },
    button: { style: p.button, gloss: p.gloss, uppercase: p.uppercase },
    texture: { grain: p.grain },
    modes: Object.fromEntries(MODES.map((m) => [m, built[m].colors])),
    trace: Object.fromEntries(MODES.map((m) => [m, built[m].trace])),
  };
}

// ---------------------------------------------------------------------------
// Accessibility check
// ---------------------------------------------------------------------------

const TEXT = 4.5;
const UI = 3;

export function contrastPairs(c) {
  const pairs = [
    ['text', 'bg', TEXT], ['text', 'surface', TEXT], ['text', 'surface-raised', TEXT], ['text', 'surface-sunken', TEXT],
    ['text-muted', 'bg', TEXT], ['text-muted', 'surface', TEXT], ['text-muted', 'surface-raised', TEXT], ['text-muted', 'surface-sunken', TEXT],
    ['border-strong', 'bg', UI], ['border-strong', 'surface', UI], ['focus', 'bg', UI], ['focus', 'surface', UI],
    ['on-primary', 'primary', TEXT], ['on-primary', 'primary-hover', TEXT], ['on-primary', 'primary-active', TEXT],
    ['on-accent', 'accent', TEXT], ['on-accent', 'accent-hover', TEXT], ['on-accent', 'accent-active', TEXT],
    ['primary-text', 'bg', TEXT], ['primary-text', 'surface', TEXT], ['primary-text', 'primary-soft', TEXT],
    ['accent-text', 'bg', TEXT], ['accent-text', 'surface', TEXT], ['accent-text', 'accent-soft', TEXT],
    ['primary', 'bg', UI, 'advisory'],
  ];
  for (const s of Object.keys(STATUS_HUES)) pairs.push([`on-${s}`, s, TEXT], [`on-${s}`, `${s}-hover`, TEXT], [`on-${s}`, `${s}-active`, TEXT], [`${s}-text`, 'bg', TEXT], [`${s}-text`, 'surface', TEXT], [`${s}-text`, `${s}-soft`, TEXT]);
  return pairs.filter(([fg, bg]) => c[fg] && c[bg]);
}

// `advisory` pairs (a filled button against the page, WCAG 1.4.11) are reported but never block: a labelled button is identified by its text,
// and a brand colour such as yellow cannot reach 3:1 on white without being changed. The button then gets a border (see uikit-css).
export function checkTokens(tokens) {
  const results = [];
  for (const mode of MODES) {
    const c = tokens.modes?.[mode];
    if (!c) { results.push({ mode, fg: '-', bg: '-', ratio: 0, min: 0, level: 'required', pass: false, note: 'mode missing' }); continue; }
    for (const [fg, bg, min, level = 'required'] of contrastPairs(c)) {
      const ratio = Number(contrast(c[fg], c[bg]).toFixed(2));
      results.push({ mode, fg, bg, fg_hex: c[fg], bg_hex: c[bg], ratio, min, level, pass: ratio >= min });
    }
  }
  const failures = results.filter((r) => !r.pass && r.level !== 'advisory');
  const warnings = results.filter((r) => !r.pass && r.level === 'advisory');
  return { ok: failures.length === 0, total: results.length, failures, warnings, results };
}

export function validateTokens(t) {
  const e = [];
  if (t?.schema !== SCHEMA) e.push(`schema must be ${SCHEMA}`);
  for (const k of ['seed', 'params', 'font', 'space', 'radius', 'shadow', 'modes', 'control']) if (!t?.[k]) e.push(`missing "${k}"`);
  for (const m of MODES) for (const [k, v] of Object.entries(t?.modes?.[m] ?? {})) if (!/^(#[0-9a-f]{6}|rgba?\()/i.test(v)) e.push(`modes.${m}.${k} is not a colour (${v})`);
  return e;
}

// `uikit set key=value`: a seed field or a variant parameter. Returns { seed, overrides } updated.
export function applySet(tokens, pairs) {
  const seed = { ...tokens.seed };
  const overrides = { ...tokens.overrides };
  for (const pair of pairs) {
    const i = pair.indexOf('=');
    if (i < 1) throw new Error(`--set expects key=value (got "${pair}")`);
    const key = pair.slice(0, i).trim();
    const raw = pair.slice(i + 1).trim();
    if (['primary', 'accent', 'neutral', 'ink'].includes(key)) seed[key] = raw === 'none' ? null : raw.toLowerCase();
    else if (key === 'prefers') seed.prefers = raw;
    else if (key === 'fonts') seed.fonts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    else if (key === 'icon_stroke') { const num = Number(raw); if (!Number.isFinite(num) || num <= 0 || num > 4) throw new Error(`icon_stroke must be a number between 0 and 4 (got "${raw}")`); overrides.icon_stroke = num; }
    else if (PARAM_KEYS.includes(key)) {
      const numeric = ['radius', 'border', 'elevation', 'control', 'ratio', 'gloss', 'grain', 'tint', 'saturation', 'tracking'];
      if (numeric.includes(key)) { const num = Number(raw); if (!Number.isFinite(num)) throw new Error(`${key} must be a number (got "${raw}")`); overrides[key] = num; }
      else if (key === 'uppercase') overrides[key] = raw === 'true';
      else overrides[key] = raw;
    } else throw new Error(`Unknown setting "${key}". Seed: primary, accent, neutral, ink, prefers, fonts. Icons: icon_stroke. Variant: ${PARAM_KEYS.join(', ')}`);
  }
  return { seed, overrides };
}

export { parseHex, px };
