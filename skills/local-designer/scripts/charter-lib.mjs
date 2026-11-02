// Design charter for the local-designer skill: the project's visual identity, stored in the AI-KIDO Memory Bank
// (prompts/gen/concepts/design/design-charter.md). Pure functions plus small file helpers.
// No network, no call to any image engine. The charter holds text and hex colours only: never an image,
// never an absolute path (a client mood board stays outside git, only its folder name is recorded).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { colourName, fromHex } from './design-tools.mjs';
import { resolveDesignDir } from './design-target.mjs';

export const CHARTER_FILE = 'design-charter.md';
export const CHARTER_DIR = join('prompts', 'gen', 'concepts', 'design');
export const STATUSES = ['draft', 'active'];
export const ROLES = ['primary', 'accent', 'secondary', 'neutral'];
const BEGIN = '<!-- design-charter:begin -->';
const END = '<!-- design-charter:end -->';
const DEFAULT_TAIL = '\n## Notes\n\nFree notes. The tools never rewrite anything below the end marker.\n';
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// ---------------------------------------------------------------------------
// Colour helpers (CIELAB distance: close to what the eye sees, unlike raw RGB)
// ---------------------------------------------------------------------------

export function toLab([r, g, b]) {
  const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export const deltaE = (a, b) => Math.hypot(...toLab(a).map((v, i) => v - toLab(b)[i]));
export const chroma = (rgb) => { const [, a, b] = toLab(rgb); return Math.hypot(a, b); };
const isNeutral = (rgb) => chroma(rgb) < 14;

export function withRoles(colours) {
  let order = 0;
  return colours.map((c) => {
    const rgb = fromHex(c.hex);
    const role = c.role ?? (isNeutral(rgb) ? 'neutral' : ['primary', 'accent'][order++] ?? 'secondary');
    return { hex: c.hex.toLowerCase(), name: c.name ?? colourName(rgb), role };
  });
}

// ---------------------------------------------------------------------------
// Build and validate
// ---------------------------------------------------------------------------

// A charter is "active" only when a style is chosen and someone validated it; otherwise it is a draft.
export function buildCharter({ brief = {}, track = null, scan = null, fallbackName = 'project', by = 'unknown', validatedAt = null, moodboard = null, briefFile = false, now = new Date() }) {
  const at = now.toISOString();
  const briefPalette = (brief.brand?.palette ?? []).map((hex) => ({ hex }));
  const scanPalette = (scan?.brand_palette ?? []).map((c) => ({ hex: c.hex }));
  const palette = withRoles(briefPalette.length ? briefPalette : scanPalette);
  const forbidden = [...(brief.brand?.forbidden ?? [])];
  const fonts = [...((brief.brand?.fonts?.length ? brief.brand.fonts : scan?.fonts) ?? [])];
  const style = track
    ? { name: track.style, category: track.category ?? '', description: track.description ?? '', negative: track.negative ?? '', params: track.params ?? {} }
    : null;
  return {
    schema: 1,
    project: brief.project || brief.client || scan?.name || fallbackName,
    client: brief.client ?? '',
    language: brief.language ?? 'en',
    status: track ? 'active' : 'draft',
    revision: 1,
    updated: at.slice(0, 10),
    message: brief.message ?? '',
    audience: brief.audience ?? '',
    use_cases: brief.use_cases ?? [],
    realism: brief.realism ?? '',
    format: { ratio: brief.format?.ratio ?? '' },
    keywords: [...new Set([...(brief.keywords ?? []), ...(brief.keywords?.length ? [] : scan?.keywords ?? [])])].slice(0, 12),
    brand: { palette, fonts, forbidden },
    style,
    style_candidates: track ? [] : (scan?.recommended ?? []).slice(0, 3).map((r) => ({ name: r.name, category: r.category, score: r.score })),
    constraints: brief.constraints ?? [],
    sources: { moodboard: moodboard ? basename(resolve(moodboard)) : null, brief: Boolean(briefFile || moodboard), scan: Boolean(scan) },
    validated_by: track ? by : null,
    validated_at: track ? (validatedAt ?? at) : null,
    decisions: [{ at, by, note: track ? `Charter created from the validated mood board direction ${track.id} (${track.style}).` : 'Draft charter created from the brief and/or the project scan: no style chosen yet.' }],
  };
}

export function validateCharter(c, styles = null) {
  const errors = [];
  const warnings = [];
  if (!c || typeof c !== 'object') return { errors: ['charter must be an object'], warnings };
  if (!c.project) errors.push('project is required');
  if (!STATUSES.includes(c.status)) errors.push(`status must be one of ${STATUSES.join(', ')}`);
  if (c.format?.ratio && !/^\d+:\d+$/.test(c.format.ratio)) errors.push('format.ratio must look like 16:9');
  for (const p of c.brand?.palette ?? []) {
    if (!HEX_RE.test(p.hex ?? '')) errors.push(`palette colour ${p.hex} must be a hex like #1a2b3c`);
    if (p.role && !ROLES.includes(p.role)) errors.push(`palette role "${p.role}" must be one of ${ROLES.join(', ')}`);
  }
  if (c.status === 'active') {
    if (!c.style?.name) errors.push('an active charter needs a style');
    if (!c.validated_by) errors.push('an active charter needs validated_by');
  }
  if (c.style?.name && styles && !styles[c.style.name]) warnings.push(`style "${c.style.name}" is not in the style library (custom style missing?)`);
  if (c.status === 'draft') warnings.push('draft: no style validated yet, generation with --charter is locked');
  if (!(c.brand?.palette ?? []).length) warnings.push('no brand palette: add it so audits can check colours');
  if (!c.message) warnings.push('no message: add what the visuals must convey');
  return { errors, warnings };
}

// Records a change in the log and bumps the revision. Mutates and returns the charter.
export function touch(c, { by = 'unknown', note, now = new Date() }) {
  c.revision = (c.revision ?? 0) + 1;
  c.updated = now.toISOString().slice(0, 10);
  c.decisions = [...(c.decisions ?? []), { at: now.toISOString(), by, note }];
  return c;
}

// Applies a library style to the charter (negative prompt = the style's own terms + what the brand forbids).
export function withStyle(c, style) {
  const terms = [...String(style.negative ?? '').split(','), ...(c.brand?.forbidden ?? [])].map((t) => t.trim()).filter(Boolean);
  c.style = { name: style.name, category: style.category ?? '', description: style.description ?? '', negative: [...new Set(terms)].join(', '), params: style.params ?? {} };
  return c;
}

// ---------------------------------------------------------------------------
// Markdown rendering (the JSON block is the source; the prose is generated from it)
// ---------------------------------------------------------------------------

const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const list = (a) => (a?.length ? a.join(', ') : '-');

export function renderRegion(c) {
  const lines = [BEGIN, '', '## Identity', ''];
  lines.push(`- Client: ${esc(c.client) || '-'}`, `- Message: ${esc(c.message) || '-'}`, `- Audience: ${esc(c.audience) || '-'}`,
    `- Uses: ${esc(list(c.use_cases))}`, `- Format: ${c.format?.ratio || '-'} | Realism: ${c.realism || '-'}`, `- Keywords: ${esc(list(c.keywords))}`, '');
  lines.push('## Palette', '');
  if (c.brand?.palette?.length) {
    lines.push('| Role | Colour | Hex |', '|---|---|---|', ...c.brand.palette.map((p) => `| ${p.role} | ${esc(p.name)} | \`${p.hex}\` |`));
  } else lines.push('No palette recorded.');
  lines.push('', '## Typography', '', `Fonts: ${esc(list(c.brand?.fonts))}`, '');
  lines.push('## Render style', '');
  if (c.style) {
    lines.push(`- Style: \`${c.style.name}\`${c.style.category ? ` (${c.style.category})` : ''}`);
    if (c.style.description) lines.push(`- Look: ${esc(c.style.description)}`);
    lines.push(`- Negative prompt: ${esc(c.style.negative) || '-'}`);
  } else {
    lines.push('No style chosen yet.');
    if (c.style_candidates?.length) lines.push('', 'Candidates from the project scan:', '', ...c.style_candidates.map((s) => `- \`${s.name}\` (${s.category})`));
    lines.push('', 'Validate a mood board direction (`/aikido-design-moodboard`) or run `charter activate --style NAME --by WHO`.');
  }
  lines.push('', '## Rules', '', `- Forbidden: ${esc(list(c.brand?.forbidden))}`, `- Constraints: ${esc(list(c.constraints))}`, '');
  lines.push('## Validation', '');
  if (c.status === 'active') {
    lines.push(`- Active, validated by ${esc(c.validated_by)} on ${String(c.validated_at).slice(0, 10)}${c.sources?.moodboard ? ` (mood board \`${c.sources.moodboard}\`)` : ''}.`);
  } else lines.push('- Draft: not validated, image generation with `--charter` is locked.');
  lines.push('', '## Decision log', '', '| Date | By | Decision |', '|---|---|---|', ...(c.decisions ?? []).map((d) => `| ${String(d.at).slice(0, 10)} | ${esc(d.by)} | ${esc(d.note)} |`), '');
  // Backticks are escaped so a note can never close the fence; the JSON stays valid.
  const json = JSON.stringify(c, null, 2).replace(/`/g, '\\u0060');
  lines.push('## Machine-readable', '', 'Source of truth for the tools. Edit it, then run `charter render` to refresh the text above.', '', '```json', json, '```', '', END);
  return lines.join('\n');
}

export function renderCharter(c, tail = DEFAULT_TAIL) {
  const header = `> **Version**: 1.${c.revision} | **Date**: ${c.updated} | **Statut**: ${c.status === 'active' ? 'Active' : 'Draft'}`;
  return `# Design charter: ${c.project}\n\n${header}\n\n${renderRegion(c)}\n${tail.startsWith('\n') ? tail : `\n${tail}`}`;
}

export function parseCharter(text) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < start) throw new Error('Not a design charter: markers <!-- design-charter:begin/end --> not found');
  const region = text.slice(start, end + END.length);
  const m = /```json\n([\s\S]*?)\n```/.exec(region);
  if (!m) throw new Error('Design charter has no ```json block between its markers');
  let charter;
  try { charter = JSON.parse(m[1]); } catch (error) { throw new Error(`Design charter JSON is invalid: ${error.message}`); }
  return { charter, region, tail: text.slice(end + END.length) };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

// The project root is the nearest parent that holds prompts/gen (the AI-KIDO Memory Bank).
export function findProjectRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'prompts', 'gen'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Priority: explicit folder/file > --root (legacy layout under that project) > design target (see design-target.mjs) > legacy layout above cwd.
export function charterFile({ dir, root, cwd = process.cwd(), env = process.env } = {}) {
  if (dir) { const p = resolve(dir); return p.endsWith('.md') ? p : join(p, CHARTER_FILE); }
  if (root) return join(resolve(root), CHARTER_DIR, CHARTER_FILE);
  const target = resolveDesignDir({ env, cwd });
  if (target) return join(target, CHARTER_FILE);
  const r = findProjectRoot(cwd);
  return r ? join(r, CHARTER_DIR, CHARTER_FILE) : null;
}

export function loadCharter(file) {
  if (!file || !existsSync(file)) throw new Error(`No design charter at ${file ?? 'prompts/gen/concepts/design/design-charter.md'}. Create it with: charter init (command /aikido-init-design).`);
  const text = readFileSync(file, 'utf8');
  return { file, text, ...parseCharter(text) };
}

export function saveCharter(file, c, tail) {
  let keep = tail;
  if (keep === undefined && existsSync(file)) { try { keep = parseCharter(readFileSync(file, 'utf8')).tail; } catch { keep = undefined; } }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderCharter(c, keep ?? DEFAULT_TAIL));
  return file;
}

// True when the text written in the file no longer matches its JSON block (someone edited one of them by hand).
export const outOfSync = (loaded) => loaded.region.trim() !== renderRegion(loaded.charter).trim();

// Adds the design folder to the Memory Bank indexes once (idempotent). Returns what it touched.
export function registerInIndexes(file) {
  const dir = dirname(file);
  const touched = [];
  const own = join(dir, 'index.md');
  if (!existsSync(own)) {
    writeFileSync(own, `# Design\n\nVisual identity of the project, used by the \`local-designer\` skill (\`/aikido-init-design\`).\n\n## Available Files\n\n- [\`${CHARTER_FILE}\`](${CHARTER_FILE}): Design charter: palette, typography, render style, constraints and decision log\n`);
    touched.push(own);
  }
  const parentIndex = join(dir, '..', 'index.md');
  if (existsSync(parentIndex)) {
    const text = readFileSync(parentIndex, 'utf8');
    if (!text.includes('design/index.md')) {
      const lines = text.split('\n');
      const entry = '- [`design/index.md`](design/index.md): Design charter of the project (palette, typography, render style) used when generating images';
      let last = -1;
      lines.forEach((l, i) => { if (l.startsWith('- [')) last = i; });
      if (last >= 0) lines.splice(last + 1, 0, entry); else lines.push(entry);
      writeFileSync(parentIndex, lines.join('\n').replace(/\n*$/, '\n'));
      touched.push(parentIndex);
    }
  }
  return touched;
}

// ---------------------------------------------------------------------------
// Audit of an image against the charter palette
// ---------------------------------------------------------------------------

// colours: [{ hex, name, share }] as returned by dominantColours(). Heuristic: it supports a review, it does not replace it.
export function auditColours(colours, charter, { near = 18, close = 32, minShare = 0.06 } = {}) {
  const brand = charter.brand?.palette ?? [];
  const measured = colours.map((c) => ({ ...c, rgb: fromHex(c.hex) }));
  const checks = brand.filter((p) => p.role !== 'neutral').map((p) => {
    const target = fromHex(p.hex);
    let best = null;
    for (const c of measured) {
      const d = deltaE(target, c.rgb);
      if (!best || d < best.delta) best = { hex: c.hex, share: c.share, delta: d };
    }
    const status = !best ? 'missing' : best.delta <= near ? 'present' : best.delta <= close ? 'close' : 'missing';
    return { hex: p.hex, role: p.role, status, nearest: best ? { hex: best.hex, share: best.share, delta: Number(best.delta.toFixed(1)) } : null };
  });
  const weight = (r) => (r === 'primary' || r === 'accent' ? 2 : 1);
  const total = checks.reduce((s, c) => s + weight(c.role), 0);
  const got = checks.reduce((s, c) => s + weight(c.role) * (c.status === 'present' ? 1 : c.status === 'close' ? 0.5 : 0), 0);
  const score = total ? Number((got / total).toFixed(2)) : null;
  const offBrand = measured.filter((c) => c.share >= minShare && !isNeutral(c.rgb) && brand.every((p) => deltaE(fromHex(p.hex), c.rgb) > close))
    .map((c) => ({ hex: c.hex, name: c.name, share: c.share }));
  let verdict = 'no-palette';
  if (score !== null) verdict = score >= 0.75 && !offBrand.length ? 'on-brand' : score >= 0.5 ? 'partial' : 'off-brand';
  return { verdict, score, brand: checks, off_brand: offBrand,
    note: 'Heuristic on the dominant colours (64x64 sample): it flags a drift to look at, it does not judge the image.' };
}
