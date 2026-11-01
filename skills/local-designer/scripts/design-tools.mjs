// Art-direction helpers for the local-designer skill: measure an image, match it to the style library,
// draft a style from an image, and scan a project to infer a suitable look.
// Everything is local: nothing is sent anywhere. Pixel access: ImageMagick (`magick`) or macOS `sips`.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve } from 'node:path';
import { recommendStyles, thumbFile, tokenize } from './styles-lib.mjs';

const SIZE = 64;

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

function parseBmp(buf) {
  const offset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const heightRaw = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  if (bpp !== 24 && bpp !== 32) throw new Error(`Unsupported BMP depth ${bpp}`);
  const height = Math.abs(heightRaw);
  const rowSize = Math.ceil((width * bpp) / 32) * 4;
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const srcRow = offset + (heightRaw > 0 ? height - 1 - y : y) * rowSize;
    for (let x = 0; x < width; x += 1) {
      const s = srcRow + x * (bpp / 8);
      const d = (y * width + x) * 3;
      out[d] = buf[s + 2];
      out[d + 1] = buf[s + 1];
      out[d + 2] = buf[s];
    }
  }
  return { width, height, data: out };
}

// Returns { width, height, data: RGB bytes } for a SIZE x SIZE thumbnail of any image format.
export function readPixels(file) {
  const path = resolve(file);
  if (!existsSync(path)) throw new Error(`Image not found: ${file}`);
  const mg = spawnSync('magick', [`${path}[0]`, '-background', 'white', '-alpha', 'remove', '-resize', `${SIZE}x${SIZE}!`, '-depth', '8', 'rgb:-'],
    { maxBuffer: 1 << 24 });
  if (mg.status === 0 && mg.stdout.length === SIZE * SIZE * 3) return { width: SIZE, height: SIZE, data: mg.stdout };

  const dir = mkdtempSync(join(tmpdir(), 'local-designer-'));
  try {
    const tmp = join(dir, 'p.bmp');
    const sp = spawnSync('sips', ['-s', 'format', 'bmp', '--resampleHeightWidth', String(SIZE), String(SIZE), path, '--out', tmp], { encoding: 'utf8' });
    if (sp.status === 0 && existsSync(tmp)) return parseBmp(readFileSync(tmp));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  throw new Error('Cannot read this image: install ImageMagick (brew install imagemagick) or use macOS sips-supported formats (png, jpg).');
}

// ---------------------------------------------------------------------------
// Colour naming
// ---------------------------------------------------------------------------

const NAMED = [
  ['white', 255, 255, 255], ['off-white', 245, 240, 230], ['light grey', 200, 200, 200], ['grey', 128, 128, 128], ['charcoal', 55, 55, 60], ['black', 10, 10, 10],
  ['red', 200, 40, 40], ['coral', 245, 110, 95], ['orange', 240, 140, 30], ['amber', 245, 190, 60], ['yellow', 245, 225, 60], ['lime green', 150, 210, 60],
  ['green', 40, 160, 80], ['forest green', 30, 90, 55], ['teal', 20, 150, 150], ['cyan', 60, 210, 230], ['sky blue', 120, 180, 235], ['blue', 40, 100, 220],
  ['navy blue', 20, 40, 100], ['indigo', 70, 60, 170], ['purple', 130, 70, 190], ['magenta', 210, 50, 160], ['pink', 245, 150, 190], ['brown', 120, 75, 45], ['beige', 215, 190, 150],
];

export function colourName([r, g, b]) {
  let best = NAMED[0];
  let bestD = Infinity;
  for (const n of NAMED) {
    const d = (n[1] - r) ** 2 + (n[2] - g) ** 2 + (n[3] - b) ** 2;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best[0];
}

export const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
export function fromHex(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

export function dominantColours(data, count = 6) {
  const bins = new Map();
  const n = data.length / 3;
  for (let i = 0; i < n; i += 1) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n += 1; bin.r += r; bin.g += g; bin.b += b;
    bins.set(key, bin);
  }
  const groups = [];
  for (const bin of [...bins.values()].sort((a, b) => b.n - a.n)) {
    const c = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n];
    const near = groups.find((g) => (g.c[0] - c[0]) ** 2 + (g.c[1] - c[1]) ** 2 + (g.c[2] - c[2]) ** 2 < 48 ** 2);
    if (near) {
      const t = near.n + bin.n;
      near.c = near.c.map((v, i) => (v * near.n + [bin.r, bin.g, bin.b][i]) / t);
      near.n = t;
    } else groups.push({ c, n: bin.n });
  }
  return groups.sort((a, b) => b.n - a.n).slice(0, count).map((g) => {
    const rgb = g.c.map(Math.round);
    return { hex: toHex(rgb), name: colourName(rgb), share: Number((g.n / n).toFixed(3)) };
  });
}

export function measure(pixels) {
  const { width, height, data } = pixels;
  const n = width * height;
  const lum = new Float32Array(n);
  let sumL = 0, sumS = 0, white = 0, dark = 0, sumR = 0, sumB = 0;
  const rgs = [], ybs = [];
  const seen = new Map();
  for (let i = 0; i < n; i += 1) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const s = max === 0 ? 0 : (max - min) / max;
    lum[i] = l; sumL += l; sumS += s; sumR += r; sumB += b;
    if (l > 0.92 && s < 0.08) white += 1;
    if (l < 0.15) dark += 1;
    rgs.push(r - g); ybs.push(0.5 * (r + g) - b);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const meanL = sumL / n;
  let varL = 0;
  for (let i = 0; i < n; i += 1) varL += (lum[i] - meanL) ** 2;
  let edge = 0, flat = 0, cells = 0;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const i = y * width + x;
      const d = Math.abs(lum[i] - lum[i + 1]) + Math.abs(lum[i] - lum[i + width]);
      edge += d; cells += 1;
      if (d < 0.02) flat += 1;
    }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
  const colourfulness = Math.sqrt(std(rgs) ** 2 + std(ybs) ** 2) + 0.3 * Math.sqrt(mean(rgs) ** 2 + mean(ybs) ** 2);
  return {
    luminance: Number(meanL.toFixed(3)),
    contrast: Number(Math.sqrt(varL / n).toFixed(3)),
    saturation: Number((sumS / n).toFixed(3)),
    white_ratio: Number((white / n).toFixed(3)),
    dark_ratio: Number((dark / n).toFixed(3)),
    edge_density: Number((edge / cells).toFixed(3)),
    flat_ratio: Number((flat / cells).toFixed(3)),
    colour_count: [...seen.values()].filter((c) => c / n > 0.005).length,
    colourfulness: Number(colourfulness.toFixed(1)),
    warmth: Number(((sumR - sumB) / n / 255).toFixed(3)),
  };
}

// Plain-language traits, ready to be turned into prompt words by the art director.
export function describe(m) {
  const t = [];
  if (m.luminance > 0.7 && m.white_ratio > 0.35) t.push('high-key, mostly white or very light background');
  else if (m.luminance < 0.3) t.push('dark, low-key lighting');
  else t.push('mid-tone lighting');
  if (m.contrast > 0.3) t.push('strong contrast');
  else if (m.contrast < 0.15) t.push('soft low contrast');
  if (m.saturation < 0.15) t.push('desaturated or monochrome');
  else if (m.saturation > 0.5) t.push('vivid saturated colours');
  if (m.colour_count <= 8 && m.flat_ratio > 0.6) t.push('very limited palette in flat colour regions (vector-like)');
  else if (m.flat_ratio > 0.6) t.push('large smooth areas');
  else if (m.edge_density > 0.12) t.push('detailed, textured, busy');
  if (m.edge_density < 0.04 && m.white_ratio > 0.35) t.push('minimal, lots of empty space');
  if (m.warmth > 0.12) t.push('warm colour temperature');
  else if (m.warmth < -0.12) t.push('cool colour temperature');
  return t;
}

export function analyzeImage(file) {
  const pixels = readPixels(file);
  const metrics = measure(pixels);
  return { file: basename(file), metrics, palette: dominantColours(pixels.data), traits: describe(metrics),
    note: 'Measured on a 64x64 thumbnail: objective cues only. Look at the image yourself for subject, medium and mood.' };
}

// ---------------------------------------------------------------------------
// Matching against the style library (thumbnails)
// ---------------------------------------------------------------------------

const vector = (m) => [m.luminance, m.contrast * 2, m.saturation, m.white_ratio, m.dark_ratio, Math.min(m.edge_density * 4, 1), m.flat_ratio,
  Math.min(m.colour_count / 60, 1), Math.min(m.colourfulness / 100, 1), m.warmth + 0.5];
const W = [1.2, 1, 1.2, 1, 0.8, 1.2, 1.5, 1.5, 1, 0.5];

export function matchImage(file, styles, limit = 5) {
  const target = vector(measure(readPixels(file)));
  const ranked = [];
  let missing = 0;
  for (const style of Object.values(styles)) {
    const thumb = thumbFile(style);
    if (!thumb || !existsSync(thumb)) { missing += 1; continue; }
    const v = vector(measure(readPixels(thumb)));
    const d = Math.sqrt(v.reduce((acc, x, i) => acc + W[i] * (x - target[i]) ** 2, 0));
    ranked.push({ name: style.name, category: style.category, distance: Number(d.toFixed(3)), description: style.description });
  }
  ranked.sort((a, b) => a.distance - b.distance);
  return { results: ranked.slice(0, limit), styles_without_thumbnail: missing,
    note: 'Approximate: thumbnails use different subjects, so compare medium and palette rather than content.' };
}

// A starting point for a new style, built from the measurements and the nearest library styles.
export function draftStyleFromImage(file, styles, { name } = {}) {
  const analysis = analyzeImage(file);
  const near = matchImage(file, styles, 2).results.map((r) => styles[r.name]);
  const base = near[0];
  const colours = analysis.palette.slice(0, 4).map((c) => c.name);
  const traits = analysis.traits.join(', ');
  const look = [base?.look ?? 'illustration', traits].join(', ');
  return {
    name: name ?? `from-${basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    description: `Draft measured from ${basename(file)}: ${traits}`,
    category: base?.category ?? 'stylized',
    tags: [...new Set([...(base?.tags ?? []), ...(near[1]?.tags ?? [])])].slice(0, 12),
    use_cases: [],
    look,
    template: `${/^[aeiou]/i.test(base?.look ?? 'illustration') ? 'An' : 'A'} ${base?.look ?? 'illustration'} of {subject}. Rendering: ${traits}. Palette of ${colours.join(', ')}.`,
    negative: base?.negative ?? 'text, letters, watermark',
    params: { ...(base?.params ?? { steps: 24, guidance: 4 }) },
    composed_of: near.map((s) => s.name),
    notes: `Palette: ${analysis.palette.map((c) => `${c.hex} (${c.name})`).join(', ')}. DRAFT: look at the source image, rewrite the template in your own words (medium, light, composition), then test it with "styles thumb".`,
  };
}

// ---------------------------------------------------------------------------
// Project scan: infer subject, vocabulary and brand palette from a folder
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'vendor', '__pycache__', '.venv', 'venv', 'target', 'coverage', '.cache', '.idea', '.vscode']);
const SKIP_FILE = /(^\.env|\.pem$|\.key$|\.p12$|\.pfx$|secret|credential|id_rsa|\.sqlite$|\.db$|lock\.json$|\.lock$)/i;
const STYLE_FILE = /\.(css|scss|sass|less|styl)$|tailwind\.config\.|theme\.(js|ts|json)$|tokens?\.(json|js|ts)$|variables\.(css|scss)$/i;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif']);

function walk(root, { maxFiles = 600, maxDepth = 5 } = {}) {
  const files = [];
  const stack = [[root, 0]];
  while (stack.length && files.length < maxFiles) {
    const [dir, depth] = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (depth < maxDepth && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push([full, depth + 1]); }
      else if (e.isFile() && !SKIP_FILE.test(e.name)) files.push(full);
      if (files.length >= maxFiles) break;
    }
  }
  return files;
}

const readSmall = (file, max = 200_000) => { try { return statSync(file).size <= max ? readFileSync(file, 'utf8') : ''; } catch { return ''; } };

export function scanProject(dir, styles, { limit = 5 } = {}) {
  const root = resolve(dir ?? '.');
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Not a directory: ${dir}`);
  const files = walk(root);
  const info = { name: basename(root), description: '', keywords: [], stack: [] };
  const text = [];
  const hexCount = new Map();
  const fonts = new Map();
  const logos = [];
  let images = 0;

  for (const file of files) {
    const rel = relative(root, file);
    const base = basename(file).toLowerCase();
    const ext = extname(file).toLowerCase();
    if (IMAGE_EXT.has(ext)) {
      images += 1;
      if (/logo|brand|favicon|icon/.test(base) && logos.length < 8) logos.push(rel);
      continue;
    }
    if (base === 'package.json') {
      try {
        const p = JSON.parse(readSmall(file));
        if (rel === 'package.json') { info.name = p.name ?? info.name; info.description = p.description ?? ''; }
        info.keywords.push(...(p.keywords ?? []));
        info.stack.push(...Object.keys({ ...p.dependencies, ...p.devDependencies }).slice(0, 25));
      } catch { /* ignore malformed package.json */ }
    } else if (/^readme/i.test(base) && ext === '.md' && text.join(' ').length < 6000) text.push(readSmall(file, 60_000).slice(0, 3000));
    else if (STYLE_FILE.test(base)) {
      const css = readSmall(file);
      for (const m of css.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
        const hex = `#${m[1].toLowerCase()}`;
        hexCount.set(hex, (hexCount.get(hex) ?? 0) + 1);
      }
      for (const m of css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
        const first = m[1].split(',')[0].replace(/["']/g, '').trim();
        if (first && !first.startsWith('var(')) fonts.set(first, (fonts.get(first) ?? 0) + 1);
      }
    }
  }

  // Brand palette = most used non-neutral colours.
  const palette = [...hexCount.entries()].filter(([hex]) => {
    const [r, g, b] = fromHex(hex);
    return Math.max(r, g, b) - Math.min(r, g, b) > 24;
  }).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([hex, uses]) => ({ hex, name: colourName(fromHex(hex)), uses }));

  const vocabulary = [info.name, info.description, ...info.keywords, ...text, ...info.stack].join(' ');
  const brief = vocabulary.slice(0, 4000);
  const rec = recommendStyles(styles, brief, { limit });
  return {
    root, name: info.name, description: info.description, keywords: [...new Set(info.keywords)].slice(0, 12), stack: [...new Set(info.stack)].slice(0, 10),
    brand_palette: palette, fonts: [...fonts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => f),
    images: { count: images, logos }, files_scanned: files.length, top_terms: tokenize(brief).slice(0, 20),
    recommended: rec.results,
    note: 'Heuristic from names, README and style sheets only (no file outside the folder, no secrets, nothing sent). Confirm with the user before generating.',
  };
}
