// Tiny deterministic software rasteriser for the UI kit's image assets (button skins, zone backgrounds, patterns).
// Why not SVG: the SVG renderers commonly available (ImageMagick's built-in one) drop gradients and blurs, so the
// output would silently be wrong. Here every pixel is computed, the result is byte-for-byte reproducible, and the only
// external tool is `cwebp` for the final encoding (a PNG is written instead when it is missing).
// Canvas = premultiplied RGBA floats in [0, 1]; colours passed around are straight (non-premultiplied) [r, g, b, a].
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { encodePng } from './png.mjs';
import { parseHex } from './uikit-color.mjs';

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const unit = (hex) => parseHex(hex).map((v) => v / 255);

export function createCanvas(width, height) {
  return { width, height, data: new Float32Array(width * height * 4) };
}

// Source-over of a straight colour onto the premultiplied canvas.
export function over(canvas, x, y, r, g, b, a) {
  if (a <= 0) return;
  const i = (y * canvas.width + x) * 4;
  const d = canvas.data;
  const k = 1 - a;
  d[i] = r * a + d[i] * k;
  d[i + 1] = g * a + d[i + 1] * k;
  d[i + 2] = b * a + d[i + 2] * k;
  d[i + 3] = a + d[i + 3] * k;
}

// fn(x, y) returns [r, g, b, a] (straight, 0..1) or null. Pixel centres are sampled at (x + .5, y + .5).
export function paint(canvas, fn, box = null) {
  const x0 = box ? Math.max(0, Math.floor(box.x0)) : 0;
  const y0 = box ? Math.max(0, Math.floor(box.y0)) : 0;
  const x1 = box ? Math.min(canvas.width, Math.ceil(box.x1)) : canvas.width;
  const y1 = box ? Math.min(canvas.height, Math.ceil(box.y1)) : canvas.height;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const c = fn(x + 0.5, y + 0.5, x, y);
      if (c) over(canvas, x, y, c[0], c[1], c[2], c[3]);
    }
  }
}

export function fill(canvas, rgb, a = 1) { paint(canvas, () => [rgb[0], rgb[1], rgb[2], a]); }

// Signed distance to a rounded rectangle (negative inside), in pixels.
export function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const rr = Math.min(r, hw, hh);
  const qx = Math.abs(px - cx) - (hw - rr);
  const qy = Math.abs(py - cy) - (hh - rr);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
}
// 1 px anti-aliasing: coverage of a pixel for a signed distance.
export const coverage = (d) => clamp01(0.5 - d);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer-lattice hash in [0, 1): the same (x, y, seed) always gives the same value. `period` makes it tile.
export function hash2(x, y, seed = 0, period = 0) {
  const xi = period ? ((x % period) + period) % period : x;
  const yi = period ? ((y % period) + period) % period : y;
  let h = (Math.imul(xi, 374761393) + Math.imul(yi, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Premultiplied floats -> straight RGBA8.
export function toRgba8(canvas) {
  const out = Buffer.alloc(canvas.width * canvas.height * 4);
  const d = canvas.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a > 0.0005) {
      out[i] = Math.round(clamp01(d[i] / a) * 255);
      out[i + 1] = Math.round(clamp01(d[i + 1] / a) * 255);
      out[i + 2] = Math.round(clamp01(d[i + 2] / a) * 255);
    }
    out[i + 3] = Math.round(clamp01(a) * 255);
  }
  return out;
}

export function toPng(canvas) {
  return encodePng({ width: canvas.width, height: canvas.height, channels: 4, pixels: toRgba8(canvas) });
}

export function cwebpAvailable() {
  const r = spawnSync('cwebp', ['-version'], { encoding: 'utf8' });
  return r.status === 0;
}

// Writes `file` (.webp). Falls back to a PNG next to it when cwebp is not installed, and says so.
export function writeImage(canvas, file, { quality = 86, alphaQuality = 100, lossless = false } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const png = toPng(canvas);
  const base = { width: canvas.width, height: canvas.height };
  if (!cwebpAvailable()) {
    const pngFile = file.replace(/\.webp$/i, '.png');
    writeFileSync(pngFile, png);
    return { ...base, file: pngFile, format: 'png', bytes: png.length, warning: 'cwebp not found (brew install webp): wrote a PNG instead of webp' };
  }
  const tmp = mkdtempSync(join(tmpdir(), 'uikit-'));
  try {
    const src = join(tmp, 'in.png');
    writeFileSync(src, png);
    // -sharp_yuv matters on small images with crisp edges (button skins) but costs seconds on a large soft background (measured: 6.4 s vs 0.14 s, same size).
    const small = canvas.width * canvas.height <= 40000;
    const lossy = ['-q', String(quality), '-alpha_q', String(alphaQuality), ...(small ? ['-m', '6', '-sharp_yuv'] : ['-m', '4'])];
    const args = ['-quiet', ...(lossless ? ['-m', '6', '-lossless', '-z', '9'] : lossy), src, '-o', file];
    const run = spawnSync('cwebp', args, { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`cwebp failed: ${(run.stderr || run.error?.message || '').trim().slice(0, 300)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { ...base, file, format: 'webp', bytes: statBytes(file) };
}

import { statSync } from 'node:fs';
const statBytes = (f) => statSync(f).size;

// Smallest contrast between `against` (a hex colour such as the text colour) and the opaque result of the canvas over `under`.
// `inset` leaves out a band along the edges: the border of a 9-slice skin is never under the label.
export function minContrast(canvas, against, under, contrastFn, step = 12, inset = 0) {
  const a = against;
  let min = Infinity;
  const u = under ?? [1, 1, 1];
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      if (x < inset || y < inset || x >= canvas.width - inset || y >= canvas.height - inset) continue;
      const i = (y * canvas.width + x) * 4;
      const al = canvas.data[i + 3];
      if (!under && al < 0.98) continue; // anti-aliased corners and transparent margins carry no label
      const rgb = [0, 1, 2].map((k) => Math.round(clamp01(canvas.data[i + k] + u[k] * (1 - al)) * 255));
      const c = contrastFn(a, rgb);
      if (c < min) min = c;
    }
  }
  return Number(min.toFixed(2));
}
