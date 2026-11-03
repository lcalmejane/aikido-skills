// Colour maths for the UI kit: hex parsing, HSL, WCAG relative luminance and contrast, and helpers that nudge a colour
// until it reaches a contrast target. Zero dependency; everything is deterministic.

export const hexOk = (h) => typeof h === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h);

export function parseHex(hex) {
  if (!hexOk(hex)) throw new Error(`Not a hex colour: ${hex}`);
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
const rgbOf = (c) => (Array.isArray(c) ? c : parseHex(c));

// h in [0,360), s and l in [0,1]
export function rgbToHsl(c) {
  const [r, g, b] = rgbOf(c).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function hslToRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map((v) => Math.round(clamp(v, 0, 1) * 255));
}

export const hsl = (h, s, l) => toHex(hslToRgb([((h % 360) + 360) % 360, clamp(s, 0, 1), clamp(l, 0, 1)]));

export function luminance(c) {
  const [r, g, b] = rgbOf(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function mix(a, b, t) {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

export function withLightness(c, l) {
  const [h, s] = rgbToHsl(c);
  return hsl(h, s, l);
}

// Moves the lightness of `fg` away from `bg` (darker on a light background, lighter on a dark one) until `min` is reached.
export function ensureContrast(fg, bg, min = 4.5) {
  if (contrast(fg, bg) >= min) return typeof fg === 'string' ? fg.toLowerCase() : toHex(fg);
  const [h, s, l] = rgbToHsl(fg);
  const towardDark = luminance(bg) > 0.4;
  let best = hsl(h, s, l);
  for (let step = 1; step <= 100; step += 1) {
    const nl = towardDark ? l - step * 0.01 : l + step * 0.01;
    best = hsl(h, s, nl);
    if (contrast(best, bg) >= min) return best;
    if (nl <= 0 || nl >= 1) break;
  }
  // Last resort: the extreme that always passes.
  return contrast('#000000', bg) >= contrast('#ffffff', bg) ? '#000000' : '#ffffff';
}

// Text colour to put on `bg`: near-white or near-black, whichever reads better.
export function onColor(bg, light = '#ffffff', dark = '#0b0d14') {
  return contrast(light, bg) >= contrast(dark, bg) ? light : dark;
}

// Adjusts `fill` so that the readable `on` colour reaches `min` on it, moving the fill as little as possible.
export function fillFor(fill, min = 4.5) {
  let on = onColor(fill);
  if (contrast(on, fill) >= min) return { fill: toHex(rgbOf(fill)), on };
  const [h, s, l] = rgbToHsl(fill);
  for (let step = 1; step <= 100; step += 1) {
    for (const nl of [l - step * 0.01, l + step * 0.01]) {
      if (nl < 0.04 || nl > 0.96) continue;
      const candidate = hsl(h, s, nl);
      on = onColor(candidate);
      if (contrast(on, candidate) >= min) return { fill: candidate, on };
    }
  }
  return { fill: toHex(rgbOf(fill)), on };
}

export const rgba = (c, a) => `rgba(${rgbOf(c).join(', ')}, ${a})`;
