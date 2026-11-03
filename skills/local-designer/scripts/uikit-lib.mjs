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
const DEFAULT_SEED = { primary: '#3b5bdb', accent: '#0ca678', neutral: null, prefers: 'light', fonts: [] };

// ---------------------------------------------------------------------------
// Seed: where the colours come from
// ---------------------------------------------------------------------------

function rolesOf(palette = []) {
  const items = palette.map((c) => (typeof c === 'string' ? { hex: c } : c)).filter((c) => hexOk(c.hex));
  const by = (role) => items.find((c) => c.role === role)?.hex;
  const free = items.filter((c) => !['neutral'].includes(c.role));
  return { primary: by('primary') ?? free[0]?.hex, accent: by('accent') ?? free.find((c) => c.hex !== (by('primary') ?? free[0]?.hex))?.hex, neutral: by('neutral') };
}

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
  seed.fonts = [charter?.brand?.fonts, brief?.brand?.fonts, css?.fonts, scan?.fonts].find((f) => f?.length)?.slice(0, 3) ?? [];
  seed.prefers = prefers ?? css?.prefers ?? 'light';
  return { seed, sources, hints: { radius: css?.radius } };
}

export function validateSeed(seed) {
  const e = [];
  for (const k of ['primary', 'accent']) if (!hexOk(seed?.[k])) e.push(`seed.${k} must be a hex colour (got ${seed?.[k]})`);
  if (seed?.neutral && !hexOk(seed.neutral)) e.push(`seed.neutral must be a hex colour (got ${seed.neutral})`);
  if (!['light', 'dark'].includes(seed?.prefers)) e.push('seed.prefers must be light or dark');
  return e;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const px = (n) => `${Number(n.toFixed(2))}px`;
const half = (n) => Math.round(n * 2) / 2;

function buildMode(mode, seed, p) {
  const dark = mode === 'dark';
  const hue = rgbToHsl(seed.neutral ?? seed.primary)[0];
  const n = (l, s = p.tint) => hsl(hue, s, l);
  const bg = dark ? n(0.085) : n(0.972, p.tint * 1.3);
  const surface = dark ? n(0.12) : n(0.998, p.tint * 0.5);
  const raised = dark ? n(0.165) : '#ffffff';
  const sunken = dark ? n(0.06) : n(0.945, p.tint * 1.2);
  const worst = dark ? raised : sunken; // the surface with the least contrast against the text
  const text = dark ? n(0.94, 0.12) : n(0.12, 0.25);
  // 5.6:1 instead of the 4.5:1 minimum: headroom, so a decorative background image or a tinted zone does not push muted text under AA.
  const muted = ensureContrast(ensureContrast(n(dark ? 0.72 : 0.38, p.tint * 1.4), worst, 5.6), bg, 5.6);
  const border = n(dark ? 0.22 : 0.88, p.tint * 1.2);
  const strong = ensureContrast(ensureContrast(n(dark ? 0.45 : 0.6, p.tint * 1.2), worst, 3), bg, 3);

  const brand = (base) => {
    const lifted = dark ? ensureContrast(base, bg, 3.2) : base;
    const { fill, on } = fillFor(lifted);
    // Hover and pressed move the fill AWAY from the label colour, so the label contrast can only go up.
    const toward = luminance(on) > 0.5 ? '#000000' : '#ffffff';
    const hover = mix(fill, toward, 0.12);
    const active = mix(fill, toward, 0.22);
    const soft = mix(bg, fill, dark ? 0.22 : 0.12);
    const textOn = ensureContrast(ensureContrast(fill, soft, 4.5), worst, 4.5);
    return { fill, on, hover, active, soft, text: textOn };
  };
  const primary = brand(seed.primary);
  const accent = brand(seed.accent);

  const out = {
    bg, surface, 'surface-raised': raised, 'surface-sunken': sunken, text, 'text-muted': muted, border, 'border-strong': strong,
    primary: primary.fill, 'on-primary': primary.on, 'primary-hover': primary.hover, 'primary-active': primary.active, 'primary-soft': primary.soft, 'primary-text': primary.text,
    accent: accent.fill, 'on-accent': accent.on, 'accent-hover': accent.hover, 'accent-active': accent.active, 'accent-soft': accent.soft, 'accent-text': accent.text,
  };
  for (const [name, h] of Object.entries(STATUS_HUES)) {
    const s = brand(hsl(h, p.saturation + 0.1, dark ? 0.58 : 0.42));
    Object.assign(out, { [name]: s.fill, [`on-${name}`]: s.on, [`${name}-hover`]: s.hover, [`${name}-active`]: s.active, [`${name}-soft`]: s.soft, [`${name}-text`]: s.text });
  }
  out.focus = ensureContrast(primary.text, bg, 3);
  out.overlay = rgba('#000000', dark ? 0.62 : 0.4);
  return out;
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
  const r = p.radius;
  const radius = { none: 0, sm: Math.max(1, Math.round(r * 0.5)), md: r, lg: Math.round(r * 1.5), xl: Math.round(r * 2.4), pill: 999 };
  return {
    schema: SCHEMA, name, prefix,
    variant: { id: variant, key: v.id, label: v.label, description: v.description },
    seed, params: p, overrides,
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
    modes: Object.fromEntries(MODES.map((m) => [m, buildMode(m, seed, p)])),
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
    if (['primary', 'accent', 'neutral'].includes(key)) seed[key] = raw === 'none' ? null : raw.toLowerCase();
    else if (key === 'prefers') seed.prefers = raw;
    else if (key === 'fonts') seed.fonts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    else if (key === 'icon_stroke') { const num = Number(raw); if (!Number.isFinite(num) || num <= 0 || num > 4) throw new Error(`icon_stroke must be a number between 0 and 4 (got "${raw}")`); overrides.icon_stroke = num; }
    else if (PARAM_KEYS.includes(key)) {
      const numeric = ['radius', 'border', 'elevation', 'control', 'ratio', 'gloss', 'grain', 'tint', 'saturation', 'tracking'];
      if (numeric.includes(key)) { const num = Number(raw); if (!Number.isFinite(num)) throw new Error(`${key} must be a number (got "${raw}")`); overrides[key] = num; }
      else if (key === 'uppercase') overrides[key] = raw === 'true';
      else overrides[key] = raw;
    } else throw new Error(`Unknown setting "${key}". Seed: primary, accent, neutral, prefers, fonts. Icons: icon_stroke. Variant: ${PARAM_KEYS.join(', ')}`);
  }
  return { seed, overrides };
}

export { parseHex, px };
