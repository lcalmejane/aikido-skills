// UI kit image assets, drawn by the deterministic rasteriser (uikit-raster.mjs) and saved as webp:
//   buttons/<kind>-<state>.<mode>.webp   9-slice skins for buttons (border-image), 3 states x 4 kinds x 2 modes
//   zones/<zone>.<mode>.webp             backgrounds for page zones: soft "mesh" hero, rings banner, tiling grain / diagonal / grid / dots
//   assets.css                           the rules that use them (light, dark and automatic, like tokens.css)
//   manifest.json                        what was written, sizes, and the measured text contrast over each image
// Every image is checked after drawing: text and muted text must keep 4.5:1 over it, otherwise its strength is lowered until they do.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { contrast, mix } from './uikit-color.mjs';
import { MODES } from './uikit-lib.mjs';
import {
  coverage, createCanvas, hash2, lerp, mulberry32, minContrast, paint, sdRoundRect, smoothstep, unit, writeImage,
} from './uikit-raster.mjs';

export const SCALE = 2;
export const BUTTON_KINDS = ['primary', 'accent', 'danger', 'neutral'];
export const BUTTON_STATES = ['default', 'hover', 'active'];

export const ZONES = {
  hero: { kind: 'mesh', width: 1600, height: 720, doc: 'Large header / landing: two or three soft colour halos from the brand' },
  banner: { kind: 'rings', width: 1600, height: 360, doc: 'Thin band behind a title: fine concentric rings fading out' },
  panel: { kind: 'grain', tile: 160, scale: 1, doc: 'Paper-like grain over cards and panels' },
  sidebar: { kind: 'diagonal', tile: 32, doc: 'Very light diagonal hatching for side columns' },
  footer: { kind: 'grid', tile: 32, doc: 'Fine grid for footers and technical areas' },
  empty: { kind: 'dots', tile: 24, doc: 'Dot pattern for empty states and drop zones' },
};
export const ZONE_NAMES = Object.keys(ZONES);

const seedOf = (text) => { let h = 2166136261; for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const ink = (v) => v; // readability: colours are already unit RGB triples

// ---------------------------------------------------------------------------
// Button skins
// ---------------------------------------------------------------------------

function kindColors(kind, c) {
  if (kind === 'neutral') return { default: c['surface-raised'], hover: c['surface-sunken'], active: c.border, on: c.text, edge: c['border-strong'] };
  if (kind === 'danger') return { default: c.danger, hover: c['danger-hover'], active: c['danger-active'], on: c['on-danger'], edge: c['danger-active'] };
  return { default: c[kind], hover: c[`${kind}-hover`], active: c[`${kind}-active`], on: c[`on-${kind}`], edge: c[`${kind}-active`] };
}

export const sliceOf = (tokens) => Math.min(14, Math.max(4, Math.ceil(tokens.radius.md) + 2));

function drawSkin(tokens, mode, kind, state, glossScale) {
  const col = kindColors(kind, tokens.modes[mode]);
  const gradient = tokens.button.style === 'gradient';
  const gloss = gradient ? tokens.button.gloss * glossScale : 0;
  const S = sliceOf(tokens);
  const W = (2 * S + 16) * SCALE;
  const H = tokens.control.md * SCALE;
  const r = Math.min(tokens.radius.md * SCALE, H / 2);
  const bw = Math.max(1, tokens.border.width) * SCALE;
  const fillHex = col[state];
  const top = unit(mix(fillHex, '#ffffff', gloss * 0.7));
  const bottom = unit(mix(fillHex, '#000000', gradient ? 0.1 * glossScale : 0));
  const edge = unit(col.edge);
  const canvas = createCanvas(W, H);
  paint(canvas, (x, y) => {
    const d = sdRoundRect(x, y, W / 2, H / 2, W / 2, H / 2, r);
    const outer = coverage(d);
    if (outer <= 0) return null;
    const inner = coverage(d + bw);
    const t = y / H;
    let rgb = [0, 1, 2].map((i) => lerp(top[i], bottom[i], t) * inner + edge[i] * (1 - inner));
    if (gradient && state !== 'active') {
      const h = (1 - smoothstep(0, 1.5 * SCALE, y - bw)) * 0.4 * inner * glossScale;
      rgb = rgb.map((v) => v * (1 - h) + h);
    }
    if (state === 'active') {
      const sh = (1 - smoothstep(0, 5 * SCALE, y - bw)) * 0.22 * inner;
      rgb = rgb.map((v) => v * (1 - sh));
    }
    return [rgb[0], rgb[1], rgb[2], outer];
  });
  return { canvas, on: col.on, S };
}

// The skin may lighten the top of the button (relief variant): lower the gloss until the label keeps 4.5:1 everywhere on it.
// Only the inside is measured: the S-pixel border band of the 9-slice is outside the label (see the padding in assets.css).
export function renderSkin(tokens, mode, kind, state) {
  let last;
  for (const glossScale of [1, 0.7, 0.45, 0.25, 0]) {
    const { canvas, on, S } = drawSkin(tokens, mode, kind, state, glossScale);
    const min = minContrast(canvas, on, null, contrast, 3, S * SCALE);
    last = { canvas, S, contrast: min, gloss_scale: glossScale };
    if (min >= 4.5) break;
  }
  return last;
}

// ---------------------------------------------------------------------------
// Zone backgrounds (semi-transparent overlays: the colour behind comes from the tokens)
// ---------------------------------------------------------------------------

function drawZone(zone, name, tokens, mode, amp) {
  const c = tokens.modes[mode];
  const scale = zone.scale ?? SCALE;
  const w = zone.tile ? zone.tile * scale : zone.width;
  const h = zone.tile ? zone.tile * scale : zone.height;
  const seed = seedOf(`${name}:${mode}`);
  const canvas = createCanvas(w, h);
  const primary = unit(c.primary);
  const accent = unit(c.accent);
  const strong = unit(c['border-strong']);
  const dither = (x, y) => (hash2(x, y, seed) - 0.5) * (1.5 / 255);

  if (zone.kind === 'mesh') {
    const rng = mulberry32(seed);
    // Halos are the brand colours pulled toward the page colour: a saturated navy at full strength would darken the page and break text contrast.
    const haloP = unit(mix(c.primary, c.bg, 0.4));
    const haloA = unit(mix(c.accent, c.bg, 0.4));
    const blobs = [0, 1, 2, 3].map((i) => ({ x: (0.12 + 0.76 * rng()) * w, y: (0.1 + 0.8 * rng()) * h, s: (0.22 + 0.16 * rng()) * Math.max(w, h), color: i % 2 ? haloA : haloP, peak: 0.8 - i * 0.1 }));
    paint(canvas, (x, y, xi, yi) => {
      let r = 0, g = 0, b = 0, a = 0;
      for (const bl of blobs) {
        const k = bl.peak * Math.exp(-((x - bl.x) ** 2 + (y - bl.y) ** 2) / (2 * bl.s * bl.s));
        r = r * (1 - k) + bl.color[0] * k; g = g * (1 - k) + bl.color[1] * k; b = b * (1 - k) + bl.color[2] * k; a = a + k * (1 - a);
      }
      const e = dither(xi, yi);
      return a > 0.002 ? [r / a + e, g / a + e, b / a + e, a] : null;
    });
  } else if (zone.kind === 'rings') {
    const cx = w * 0.88;
    const cy = h * 1.15;
    const gap = w / 46;
    paint(canvas, (x, y) => {
      const d = Math.hypot(x - cx, y - cy);
      const wave = 0.5 + 0.5 * Math.cos((d / gap) * Math.PI * 2);
      const a = amp * 0.16 * wave ** 8 * Math.exp(-d / (w * 0.75));
      return a > 0.002 ? [primary[0], primary[1], primary[2], a] : null;
    });
  } else if (zone.kind === 'dots') {
    const T = w;
    paint(canvas, (x, y) => {
      const a = amp * 0.3 * coverage((Math.hypot(x - T / 2, y - T / 2) - 1.4 * scale) );
      return a > 0.002 ? [strong[0], strong[1], strong[2], a] : null;
    });
  } else if (zone.kind === 'grid') {
    const T = w;
    paint(canvas, (x, y) => {
      const m = Math.min(Math.min(x, T - x), Math.min(y, T - y));
      const a = amp * 0.24 * coverage(m - 0.6 * scale);
      return a > 0.002 ? [strong[0], strong[1], strong[2], a] : null;
    });
  } else if (zone.kind === 'diagonal') {
    const T = w;
    paint(canvas, (x, y) => {
      const m = (x + y) % T;
      const dist = Math.min(m, T - m) / Math.SQRT2;
      const a = amp * 0.2 * coverage(dist - 0.5 * scale);
      return a > 0.002 ? [strong[0], strong[1], strong[2], a] : null;
    });
  } else if (zone.kind === 'grain') {
    paint(canvas, (x, y, xi, yi) => {
      const hv = hash2(xi, yi, seed, w);
      const a = amp * 0.1 * Math.abs(hv - 0.5) * 2;
      const v = hv > 0.5 ? 1 : 0;
      return a > 0.002 ? [v, v, v, a] : null;
    });
  } else throw new Error(`Unknown zone kind "${zone.kind}"`);
  return canvas;
}

// Drawn once at full strength; the strength is then a plain alpha factor (premultiplied colour and alpha scale together), found by
// descending in 5 % steps until text and muted text keep 4.5:1 over the image. The strongest passing value wins.
export function renderZone(name, tokens, mode) {
  const zone = ZONES[name];
  const c = tokens.modes[mode];
  const under = unit(c.bg);
  const canvas = drawZone(zone, name, tokens, mode, 1);
  const step = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / 160));
  const measure = (k) => Math.min(minContrastOver(canvas, c.text, under, step, k), minContrastOver(canvas, c['text-muted'], under, step, k));
  let amp = 1;
  let min = measure(amp);
  while (min < 4.5 && amp > 0.05) { amp = Number((amp - 0.05).toFixed(2)); min = measure(amp); }
  for (let i = 0; i < canvas.data.length; i += 1) canvas.data[i] *= amp;
  return { canvas, amplitude: amp, contrast: min, ...(min < 4.5 ? { warning: 'text contrast below 4.5 even at the lowest strength' } : {}) };
}

// Overlays are partly transparent: composite on the page colour before measuring. `k` scales the whole overlay (strength).
function minContrastOver(canvas, against, under, step, k = 1) {
  let min = Infinity;
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const i = (y * canvas.width + x) * 4;
      const a = canvas.data[i + 3] * k;
      const rgb = [0, 1, 2].map((m) => Math.round(Math.min(1, canvas.data[i + m] * k + under[m] * (1 - a)) * 255));
      const cr = contrast(against, rgb);
      if (cr < min) min = cr;
    }
  }
  return Number(min.toFixed(2));
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function scoped(tokens, selector, decls) {
  const base = tokens.seed.prefers === 'dark' ? 'dark' : 'light';
  const other = base === 'dark' ? 'light' : 'dark';
  return `${selector} { ${decls(base)} }\n@media (prefers-color-scheme: ${other}) { :root:not([data-theme]) ${selector} { ${decls(other)} } }\n[data-theme="${other}"] ${selector} { ${decls(other)} }\n[data-theme="${base}"] ${selector} { ${decls(base)} }\n`;
}

export function buildAssets(tokens, dir, { buttons = true, zones = true, only = null, quality = 90 } = {}) {
  const files = [];
  const p = tokens.prefix;
  const S = sliceOf(tokens);
  const url = new Map();
  const record = (key, res, extra) => { files.push({ file: relative(dir, res.file), width: res.width, height: res.height, bytes: res.bytes, format: res.format, ...extra, ...(res.warning ? { warning: res.warning } : {}) }); url.set(key, relative(dir, res.file)); };
  mkdirSync(dir, { recursive: true });

  if (buttons) {
    for (const mode of MODES) for (const kind of BUTTON_KINDS) for (const state of BUTTON_STATES) {
      const skin = renderSkin(tokens, mode, kind, state);
      const res = writeImage(skin.canvas, join(dir, 'buttons', `${kind}-${state}.${mode}.webp`), { quality, lossless: false });
      record(`b:${kind}:${state}:${mode}`, res, { type: 'button', kind, state, mode, contrast: skin.contrast, gloss_scale: skin.gloss_scale });
    }
  }
  const names = (only ?? ZONE_NAMES).filter((n) => { if (!ZONES[n]) throw new Error(`Unknown zone "${n}". Available: ${ZONE_NAMES.join(', ')}`); return true; });
  if (zones) {
    for (const name of names) for (const mode of MODES) {
      const z = renderZone(name, tokens, mode);
      const res = writeImage(z.canvas, join(dir, 'zones', `${name}.${mode}.webp`), { quality: 84 });
      record(`z:${name}:${mode}`, res, { type: 'zone', zone: name, mode, kind: ZONES[name].kind, amplitude: z.amplitude, contrast: z.contrast, ...(z.warning ? { warning: z.warning } : {}) });
    }
  }

  // CSS
  let css = `/* ${tokens.name} — image assets. Generated by local-designer "uikit assets" (webp drawn by the kit, not by an image model). Load after tokens.css and components.css.\n   Buttons: add class "${p}-btn--skin" next to "${p}-btn ${p}-btn--primary|accent|danger" (neutral: "${p}-btn--skin" alone). Zones: class "${p}-zone-<name>". */\n`;
  if (buttons) {
    css += `\n.${p}-btn.${p}-btn--skin, .${p}-btn.${p}-btn--skin:hover, .${p}-btn.${p}-btn--skin:active { background: none; border: ${S}px solid transparent; border-radius: var(--${p}-radius-md); padding-inline: calc(var(--${p}-space-4) - ${S}px); box-shadow: var(--${p}-shadow-sm); }\n`;
    css += `.${p}-btn.${p}-btn--skin:active { box-shadow: none; }\n`;
    for (const kind of BUTTON_KINDS) {
      const sel = kind === 'neutral' ? `.${p}-btn.${p}-btn--skin:not(.${p}-btn--primary):not(.${p}-btn--accent):not(.${p}-btn--danger)` : `.${p}-btn.${p}-btn--skin.${p}-btn--${kind}`;
      for (const [state, suffix] of [['default', ''], ['hover', ':hover:not([disabled])'], ['active', ':active:not([disabled])']]) {
        css += scoped(tokens, `${sel}${suffix}`, (mode) => `border-image: url("${url.get(`b:${kind}:${state}:${mode}`)}") ${S * SCALE} fill / ${S}px stretch;`);
      }
    }
  }
  if (zones) {
    for (const name of names) {
      const z = ZONES[name];
      const size = z.tile ? `background-size: ${z.tile}px ${z.tile}px; background-repeat: repeat;` : 'background-size: cover; background-position: center; background-repeat: no-repeat;';
      css += scoped(tokens, `.${p}-zone-${name}`, (mode) => `background-color: var(--${p}-bg); background-image: url("${url.get(`z:${name}:${mode}`)}"); ${size}`);
    }
  }
  writeFileSync(join(dir, 'assets.css'), css);
  const manifest = { generated_by: 'local-designer uikit assets', variant: tokens.variant.id, slice: S, scale: SCALE, files };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, css: join(dir, 'assets.css'), count: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), files, manifest: join(dir, 'manifest.json'), names };
}

export { basename, ink };
