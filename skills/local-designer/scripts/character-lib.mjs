// Character model sheet: measure a reference in head units, draw a flat plan from a spec, audit a render against it.
// Pure JavaScript, no dependency. Coordinates are in HEAD UNITS: x to the right of the centre axis, y down from the
// top of the head, 1 = the height of the head. The spec is the single source of truth for the silhouette.
import { decodePng, encodePng, toRgb } from './png.mjs';

const SHAPES = new Set(['ellipse', 'rrect', 'capsule']);
const VIEWS = new Set(['front', 'back', 'side']);
const HEX = /^#[0-9a-f]{6}$/i;
export const DEFAULT_OUTLINE = '#1a1a1a';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------- spec ----------

// { errors: [], warnings: [] } for a character spec. A spec with errors must not be drawn.
export function validateSpec(spec) {
  const errors = [];
  const warnings = [];
  if (!spec || typeof spec !== 'object') return { errors: ['spec must be an object'], warnings };
  if (typeof spec.name !== 'string' || !spec.name) errors.push('name is required');
  if (!isNum(spec.height) || spec.height <= 0) errors.push('height (total height in heads) must be a positive number');
  if (!Array.isArray(spec.parts) || spec.parts.length === 0) {
    errors.push('parts must be a non-empty array');
    return { errors, warnings };
  }
  for (const k of ['background', 'outline']) {
    if (spec[k] !== undefined && !HEX.test(spec[k])) errors.push(`${k} must be a #rrggbb colour`);
  }
  const ids = new Set();
  spec.parts.forEach((p, i) => {
    const at = `parts[${i}]${p?.id ? ` (${p.id})` : ''}`;
    if (!p || typeof p !== 'object') { errors.push(`${at}: must be an object`); return; }
    if (typeof p.id !== 'string' || !p.id) errors.push(`${at}: id is required`);
    else if (ids.has(p.id)) errors.push(`${at}: duplicate id`);
    else ids.add(p.id);
    if (!SHAPES.has(p.shape)) { errors.push(`${at}: shape must be one of ${[...SHAPES].join(', ')}`); return; }
    const need = p.shape === 'capsule' ? ['x1', 'y1', 'x2', 'y2', 'r'] : ['cx', 'cy', 'w', 'h'];
    for (const k of need) if (!isNum(p[k])) errors.push(`${at}: ${k} must be a number`);
    if (p.shape === 'rrect' && p.r !== undefined && !isNum(p.r)) errors.push(`${at}: r must be a number`);
    if (p.rot !== undefined && !isNum(p.rot)) errors.push(`${at}: rot must be a number`);
    if (p.fill !== undefined && !HEX.test(p.fill)) errors.push(`${at}: fill must be a #rrggbb colour`);
    if (p.view !== undefined && p.view !== 'both' && p.view !== 'all' && !VIEWS.has(p.view)) errors.push(`${at}: view must be front, back, side, both (front and back) or all`);
  });
  if (errors.length === 0) {
    const bottom = Math.max(...expandParts(spec, 'front').map(extentBottom));
    if (Math.abs(bottom - spec.height) > 0.06) {
      warnings.push(`height says ${spec.height} heads but the lowest part ends at ${bottom.toFixed(2)}`);
    }
  }
  return { errors, warnings };
}

function extentBottom(p) {
  if (p.shape === 'capsule') return Math.max(p.y1, p.y2) + p.r;
  const rot = Math.abs(p.rot ?? 0) % 180;
  const k = rot === 0 ? 1 : 1.2; // a rotated box can reach a little further: cheap bound, only used for a warning
  return p.cy + (p.h / 2) * k;
}

// Parts drawn for a view, mirrors expanded, in painting order (array order, then `z`).
export function expandParts(spec, view = 'front') {
  const out = [];
  spec.parts.forEach((p, order) => {
    // No `view` (or `both`) = front and back; `side` = profile only; `all` = every view.
    const v = p.view ?? 'both';
    if (v === 'both' ? view === 'side' : v !== 'all' && v !== view) return;
    out.push({ ...p, order });
    if (p.mirror) {
      const m = { ...p, order, id: `${p.id}:mirror` };
      if (p.shape === 'capsule') { m.x1 = -p.x1; m.x2 = -p.x2; } else { m.cx = -p.cx; if (p.rot) m.rot = -p.rot; }
      out.push(m);
    }
  });
  return out.sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || a.order - b.order);
}

// Signed distance (head units) from a point to a part: negative inside.
function sdf(p, x, y) {
  if (p.shape === 'capsule') {
    const dx = p.x2 - p.x1;
    const dy = p.y2 - p.y1;
    const l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - p.x1) * dx + (y - p.y1) * dy) / l2));
    return Math.hypot(x - (p.x1 + t * dx), y - (p.y1 + t * dy)) - p.r;
  }
  let px = x - p.cx;
  let py = y - p.cy;
  if (p.rot) {
    const a = (-p.rot * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    [px, py] = [px * c - py * s, px * s + py * c];
  }
  const hw = p.w / 2;
  const hh = p.h / 2;
  if (p.shape === 'ellipse') return (Math.sqrt((px / hw) ** 2 + (py / hh) ** 2) - 1) * Math.min(hw, hh);
  const r = Math.min(p.r ?? 0, hw, hh);
  const qx = Math.abs(px) - (hw - r);
  const qy = Math.abs(py) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ---------- plan drawing ----------

// Flat plan of the character: filled shapes with a dark outline on white. `lines` keeps outlines only.
// `guides` adds a light line at every head unit and the centre axis behind the drawing.
export function renderPlan(spec, { view = 'front', size, lines = false, guides = false, stroke = 3 } = {}) {
  const { errors } = validateSpec(spec);
  if (errors.length) throw new Error(`Invalid character spec: ${errors[0]}`);
  const width = size?.width ?? spec.canvas?.width ?? 512;
  const height = size?.height ?? spec.canvas?.height ?? 512;
  const margin = spec.canvas?.margin ?? 0.05;
  const scale = (height * (1 - 2 * margin)) / spec.height;
  const x0 = width / 2;
  const y0 = height * margin;
  const lw = stroke / scale; // outline thickness in head units
  const outline = hexRgb(spec.outline ?? DEFAULT_OUTLINE);
  // A mid-tone background keeps white and cream parts (head, shoes, keikogi) measurable by the audit.
  const bg = hexRgb(spec.background ?? '#ffffff');
  const parts = expandParts(spec, view).map((p) => ({
    p,
    fill: hexRgb(lines ? '#ffffff' : (p.fill ?? '#cccccc')),
    ring: p.stroke !== false,
  }));
  const pixels = Buffer.alloc(width * height * 3);
  const guideColor = [150, 205, 235];
  const half = 0.5 / scale;
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < 2; sy += 1) {
        for (let sx = 0; sx < 2; sx += 1) {
          const u = (i + (sx + 0.5) / 2 - x0) / scale;
          const v = (j + (sy + 0.5) / 2 - y0) / scale;
          let c = bg;
          if (guides && (Math.abs(u) < half || (v >= -half && Math.abs(v - Math.round(v)) < half))) c = guideColor;
          for (const { p, fill, ring } of parts) {
            const d = sdf(p, u, v);
            if (d > lw / 2) continue;
            c = ring && d > -lw / 2 ? outline : (d <= 0 ? fill : c);
          }
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const o = (j * width + i) * 3;
      pixels[o] = Math.round(r / 4); pixels[o + 1] = Math.round(g / 4); pixels[o + 2] = Math.round(b / 4);
    }
  }
  return { width, height, channels: 3, pixels };
}

export const planToPng = (img, text = {}) => encodePng(img, text);

// ---------- expected silhouette and audit ----------

// Width of the silhouette (sum of every crossing, in heads) at `rows` heights evenly spread over the body.
export function silhouetteProfile(spec, { view = 'front', rows = 24 } = {}) {
  const parts = expandParts(spec, view);
  let xmax = 0.5;
  for (const p of parts) xmax = Math.max(xmax, p.shape === 'capsule' ? Math.max(Math.abs(p.x1), Math.abs(p.x2)) + p.r : Math.abs(p.cx) + Math.max(p.w, p.h));
  xmax += 0.2;
  const dx = 0.004;
  const out = [];
  for (let k = 0; k < rows; k += 1) {
    const y = ((k + 0.5) / rows) * spec.height;
    let n = 0;
    for (let u = -xmax; u <= xmax; u += dx) if (parts.some((p) => sdf(p, u, y) <= 0)) n += 1;
    out.push({ y, width: n * dx });
  }
  return out;
}

// Per-row silhouette of a render on a plain background: pixel count that differs from the row's own background.
export function imageProfile(img, { threshold = 38, edge = 6 } = {}) {
  const { width, height, pixels } = toRgb(img);
  const counts = new Array(height).fill(0);
  for (let j = 0; j < height; j += 1) {
    let br = 0; let bg = 0; let bb = 0;
    for (let k = 0; k < edge; k += 1) {
      const l = (j * width + k) * 3;
      const r = (j * width + width - 1 - k) * 3;
      br += pixels[l] + pixels[r]; bg += pixels[l + 1] + pixels[r + 1]; bb += pixels[l + 2] + pixels[r + 2];
    }
    br /= edge * 2; bg /= edge * 2; bb /= edge * 2;
    let n = 0;
    for (let i = 0; i < width; i += 1) {
      const o = (j * width + i) * 3;
      if (Math.hypot(pixels[o] - br, pixels[o + 1] - bg, pixels[o + 2] - bb) > threshold) n += 1;
    }
    counts[j] = n;
  }
  const filled = counts.map((n, j) => (n >= 3 ? j : -1)).filter((j) => j >= 0);
  if (filled.length < 20) throw new Error('No figure found: use a plain background and a figure that does not touch the edges');
  return { counts, top: filled[0], bottom: filled[filled.length - 1], width, height };
}

// Compare a render with the spec: same silhouette thickness at the same relative heights, in head units.
export function auditImage(img, spec, { view = 'front', rows = 24, tolerance = 0.12, threshold = 38 } = {}) {
  const expected = silhouetteProfile(spec, { view, rows });
  const prof = imageProfile(img, { threshold });
  const hpx = prof.bottom - prof.top + 1;
  const med = (a, b, c) => [a, b, c].sort((x, y) => x - y)[1];
  const result = expected.map((e) => {
    const j = Math.round(prof.top + (e.y / spec.height) * hpx - 0.5);
    const at = (k) => prof.counts[Math.max(0, Math.min(prof.height - 1, k))];
    const measured = (med(at(j - 1), at(j), at(j + 1)) / hpx) * spec.height;
    const delta = measured - e.width;
    return { y: +e.y.toFixed(3), expected: +e.width.toFixed(3), measured: +measured.toFixed(3), delta: +delta.toFixed(3), ok: Math.abs(delta) <= tolerance };
  });
  const okRows = result.filter((r) => r.ok).length;
  const mean = result.reduce((s, r) => s + Math.abs(r.delta), 0) / result.length;
  const heavier = result.filter((r) => r.delta > tolerance).length;
  const thinner = result.filter((r) => r.delta < -tolerance).length;
  return {
    verdict: okRows / result.length >= 0.85 ? 'on-model' : 'off-model',
    okRatio: +(okRows / result.length).toFixed(2),
    meanAbsDelta: +mean.toFixed(3),
    maxAbsDelta: +Math.max(...result.map((r) => Math.abs(r.delta))).toFixed(3),
    tolerance,
    heavierRows: heavier,
    thinnerRows: thinner,
    bodyHeightPx: hpx,
    rows: result,
  };
}

// ---------- audit by zones (the check that matters between images) ----------

// Zones of the body as [from, to] in head units. spec.zones = [{ name, y0, y1 }] overrides the default split.
export function zonesOf(spec) {
  if (Array.isArray(spec.zones) && spec.zones.length) return spec.zones.map((z) => ({ name: z.name, y0: z.y0, y1: z.y1, info: z.info === true }));
  const h = spec.height;
  // `info` zones are reported but never decide the verdict: white shoes on a light background are nearly invisible
  // to a colour-difference measure and the cast shadow widens them, so their width is not reliable.
  return [
    { name: 'head', y0: 0, y1: 0.28 * h },
    { name: 'shoulders-arms', y0: 0.3 * h, y1: 0.58 * h },
    { name: 'trousers', y0: 0.58 * h, y1: 0.82 * h },
    { name: 'feet', y0: 0.88 * h, y1: h, info: true },
  ];
}

// Widest point of each zone, in head units, expected from the spec and measured on a render.
// Comparing the widest point of a zone (not one pixel row) ignores a small vertical shift of the drawing.
export function auditZones(img, spec, { view = 'front', tolerance = 0.15, threshold = 38 } = {}) {
  const zones = zonesOf(spec);
  const expected = silhouetteProfile(spec, { view, rows: 96 });
  const prof = imageProfile(img, { threshold });
  const hpx = prof.bottom - prof.top + 1;
  const out = zones.map((z) => {
    const exp = Math.max(0, ...expected.filter((e) => e.y >= z.y0 && e.y <= z.y1).map((e) => e.width));
    const j0 = Math.max(0, Math.round(prof.top + (z.y0 / spec.height) * hpx));
    const j1 = Math.min(prof.height - 1, Math.round(prof.top + (z.y1 / spec.height) * hpx));
    let px = 0;
    for (let j = j0; j <= j1; j += 1) px = Math.max(px, prof.counts[j]);
    const measured = (px / hpx) * spec.height;
    const ratio = exp > 0 ? measured / exp : 1;
    return {
      zone: z.name, expected: +exp.toFixed(3), measured: +measured.toFixed(3), ratio: +ratio.toFixed(3),
      status: Math.abs(ratio - 1) <= tolerance ? 'ok' : (ratio > 1 ? 'too-wide' : 'too-narrow'),
      counts: !z.info,
    };
  });
  const bad = out.filter((r) => r.counts && r.status !== 'ok');
  // Overall width/height ignores the info zones (feet, shadow) so one shadow cannot change the body ratio.
  const lastCounted = Math.max(...zones.filter((z) => !z.info).map((z) => z.y1));
  const jLast = Math.min(prof.height - 1, Math.round(prof.top + (lastCounted / spec.height) * hpx));
  const wMax = Math.max(...prof.counts.slice(prof.top, jLast + 1));
  const eMax = Math.max(...expected.filter((e) => e.y <= lastCounted).map((e) => e.width));
  return {
    verdict: bad.length === 0 ? 'on-model' : 'off-model',
    tolerance,
    bodyHeightPx: hpx,
    widthToHeight: +(wMax / hpx).toFixed(3),
    expectedWidthToHeight: +(eMax / spec.height).toFixed(3),
    zones: out.map(({ counts, ...r }) => (counts ? r : { ...r, status: `${r.status} (info, not counted)` })),
  };
}

// ---------- measuring a reference ----------

// Landmarks read on a reference (pixels) -> positions and widths in head units.
// points: { top, chin, ...name: [x, y] }  widths: { name: [[x1, y1], [x2, y2]] }
export function measureLandmarks({ points = {}, widths = {} }) {
  const { top, chin } = points;
  if (!Array.isArray(top) || !Array.isArray(chin)) throw new Error('points.top and points.chin are required: they define the head unit');
  const head = chin[1] - top[1];
  if (!(head > 0)) throw new Error('chin must be below top');
  const r = (n) => +n.toFixed(3);
  const outPoints = {};
  for (const [name, [x, y]] of Object.entries(points)) outPoints[name] = { x: r((x - top[0]) / head), y: r((y - top[1]) / head) };
  const outWidths = {};
  for (const [name, [[x1, y1], [x2, y2]]] of Object.entries(widths)) {
    outWidths[name] = { y: r(((y1 + y2) / 2 - top[1]) / head), width: r(Math.abs(x2 - x1) / head), centre: r(((x1 + x2) / 2 - top[0]) / head) };
  }
  const sole = points.sole ?? points.feet ?? points.bottom;
  return { headPx: r(head), totalHeightInHeads: sole ? r((sole[1] - top[1]) / head) : null, points: outPoints, widths: outWidths };
}

// ---------- grid overlay to read coordinates ----------

const DIGITS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111',
};

function drawLabel(img, text, x, y, scale = 2) {
  const w = text.length * 4 * scale + scale;
  const h = 5 * scale + scale * 2;
  for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) put(img, x + i, y + j, [255, 255, 255]);
  [...text].forEach((ch, n) => {
    const bits = DIGITS[ch];
    if (!bits) return;
    for (let k = 0; k < 15; k += 1) {
      if (bits[k] !== '1') continue;
      const gx = x + scale + n * 4 * scale + (k % 3) * scale;
      const gy = y + scale + Math.floor(k / 3) * scale;
      for (let b = 0; b < scale; b += 1) for (let a = 0; a < scale; a += 1) put(img, gx + a, gy + b, [200, 0, 120]);
    }
  });
}

function put(img, x, y, c) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 3;
  img.pixels[o] = c[0]; img.pixels[o + 1] = c[1]; img.pixels[o + 2] = c[2];
}

// Image + a numbered grid (a line every `step` pixels, bolder every 4th) so coordinates can be read by eye.
export function gridOverlay(png, { step = 32 } = {}) {
  const src = toRgb(decodePng(png));
  const img = { width: src.width, height: src.height, channels: 3, pixels: Buffer.from(src.pixels) };
  const blend = (x, y, c, a) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const o = (y * img.width + x) * 3;
    for (let k = 0; k < 3; k += 1) img.pixels[o + k] = Math.round(img.pixels[o + k] * (1 - a) + c[k] * a);
  };
  for (let g = 0; g < Math.max(img.width, img.height); g += step) {
    const major = (g / step) % 4 === 0;
    const a = major ? 0.7 : 0.35;
    for (let t = 0; t < img.height; t += 1) blend(g, t, [0, 190, 230], a);
    for (let t = 0; t < img.width; t += 1) blend(t, g, [0, 190, 230], a);
  }
  for (let g = 0; g < img.width; g += step * 2) drawLabel(img, String(g), g + 1, 1);
  for (let g = step * 2; g < img.height; g += step * 2) drawLabel(img, String(g), 1, g + 1);
  return encodePng(img);
}
