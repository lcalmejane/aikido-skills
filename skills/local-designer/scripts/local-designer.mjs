#!/usr/bin/env node
// local-designer: art direction tools plus a connector-based image generation CLI.
// Zero dependency, Node >= 18.
// The image engine is a connector (scripts/connectors/): Draw Things today, others can be registered.
// Commands: status | generate | inspect | styles | sweep | recommend | analyze | match | project-scan | brief | moodboard | charter | uikit | character | vision | connectors | migrate
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BUNDLED_STYLES_DIR, CATEGORIES, USER_STYLES_DIR, applyStyle, composeStyles, loadStyles, recommendStyles, renderGallery,
  saveStyle, thumbFile, validateStyle,
} from './styles-lib.mjs';

import { analyzeImage, draftStyleFromImage, matchImage, scanProject } from './design-tools.mjs';
import { BRIEF_TEMPLATE, buildMoodboard, scenesOf, validateBrief } from './moodboard-lib.mjs';
import { renderMoodboardHtml } from './moodboard-html.mjs';
import { boardPath, decide, loadBoard, saveBoard, summary, trialImage, trialPath, validatedTrack } from './moodboard-state.mjs';
import { DEFAULT_CONNECTOR, listConnectors, resolveConnector } from './connectors/index.mjs';
import {
  DEFAULT_URL, assertSize, buildPayload, decodeEntities, extractPngMetadata, httpJson, isLocalUrl, parseLora, parseSetting,
} from './connectors/drawthing.mjs';
import { pngSize, decodePng } from './png.mjs';
import { auditImage, auditZones, gridOverlay, measureLandmarks, planToPng, renderPlan, validateSpec } from './character-lib.mjs';
import { designMoodboardsDir, isInside, resolveDesignDir } from './design-target.mjs';
import {
  DEFAULT_CHECKS, askVision, checksFromBrief, listVisionModels, loadVisionConfig, pinVision, reviewPrompt, summariseReview, visionStatus,
} from './vision-lib.mjs';
import { applyMigration, planMigration } from './migrate.mjs';
import { cmdUikit } from './uikit-cli.mjs';
import {
  auditColours, buildCharter, charterFile, findProjectRoot, loadCharter, outOfSync, registerInIndexes, saveCharter, touch, validateCharter, withStyle,
} from './charter-lib.mjs';

// Re-exported so existing callers and tests keep working after the split into connectors/.
export {
  applyStyle, loadStyles, DEFAULT_URL, assertSize, buildPayload, decodeEntities, extractPngMetadata, httpJson, isLocalUrl, parseLora,
  parseSetting, pngSize,
};
export const STYLES_DIR = BUNDLED_STYLES_DIR;
export const DEFAULT_LAB_DIR = join(homedir(), 'local-designer-lab');
const REPEATABLE = new Set(['lora', 'set', 'vary']);

// ---------------------------------------------------------------------------
// Arguments and small helpers
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      opts._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = rest[i + 1];
    const hasValue = next !== undefined && !next.startsWith('--');
    if (REPEATABLE.has(key)) {
      if (!hasValue) throw new Error(`--${key} needs a value`);
      (opts[key] ??= []).push(next);
      i += 1;
    } else if (!hasValue) opts[key] = true;
    else {
      opts[key] = next;
      i += 1;
    }
  }
  return { command, opts };
}


export function slug(text) {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
}

// True when `path` (existing or not) lives inside a git working tree.
export function insideGitRepo(path) {
  let dir = resolve(path);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}


// Styles (render presets) live in styles-lib.mjs.

// ---------------------------------------------------------------------------
// Sweep planning
// ---------------------------------------------------------------------------

// ['steps=8,16', 'guidance=3,5'] -> [{steps:'8',guidance:'3'}, {steps:'8',guidance:'5'}, ...]
export function expandVary(specs = []) {
  let combos = [{}];
  for (const spec of specs) {
    const i = spec.indexOf('=');
    if (i < 1) throw new Error(`--vary expects key=v1,v2 (got ${spec})`);
    const key = spec.slice(0, i);
    const values = spec.slice(i + 1).split(',').map((v) => v.trim()).filter(Boolean);
    if (!values.length) throw new Error(`--vary ${key} has no value`);
    combos = combos.flatMap((c) => values.map((v) => ({ ...c, [key]: v })));
  }
  return combos;
}

export function buildJobs({ styles = [null], seeds = [undefined], vary = [] }) {
  const combos = expandVary(vary);
  const jobs = [];
  for (const style of styles) {
    for (const combo of combos) {
      for (const seed of seeds) {
        const varyLabel = Object.entries(combo).map(([k, v]) => `${slug(k)}${slug(v)}`).join('-');
        const name = [String(jobs.length + 1).padStart(2, '0'), style ?? 'raw', varyLabel, seed === undefined ? '' : `s${seed}`]
          .filter(Boolean)
          .join('-');
        jobs.push({ name, style, vary: combo, seed });
      }
    }
  }
  return jobs;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderIndexHtml(title, entries) {
  const cards = entries
    .map((e) => {
      const img = e.error ? `<div class="err">${esc(e.error)}</div>` : `<a href="${esc(e.file)}"><img src="${esc(e.file)}" loading="lazy"></a>`;
      return `<figure>${img}<figcaption><b>${esc(e.name)}</b><br>${esc(e.label ?? '')}<details><summary>prompt</summary>${esc(e.prompt ?? '')}</details></figcaption></figure>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{background:#111;color:#ddd;font:14px system-ui;margin:16px}h1{font-size:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
figure{margin:0;background:#1b1b1b;padding:8px;border-radius:6px}img{width:100%;display:block;border-radius:4px}
figcaption{margin-top:6px;font-size:12px}details{margin-top:4px;color:#999}.err{color:#f66}</style>
<h1>${esc(title)}</h1><div class="grid">
${cards}
</div>
`;
}

// ---------------------------------------------------------------------------
// Connector selection
// ---------------------------------------------------------------------------

// Resolves the connector (--connector, $LOCAL_DESIGNER_CONNECTOR, else auto) and connects to its engine.
async function openSession(opts) {
  const connector = await resolveConnector(opts);
  return { connector, session: await connector.connect(opts) };
}

// Reads the generation metadata stored in an image by any registered engine, without connecting to it.
function readAnyMetadata(buf) {
  for (const c of listConnectors()) {
    const meta = c.readMetadata(buf);
    if (meta) return { connector: c.id, meta };
  }
  return null;
}

// Request keys that only some engines understand: asking for one the connector lacks is an error, not a silent drop.
const FLAG_KEY = { model: 'model', sampler: 'sampler', shift: 'shift', 'seed-mode': 'seedMode', 'clip-skip': 'clipSkip', plain: 'plain', lora: 'lora', set: 'set', init: 'initImage', strength: 'strength' };

export function assertSupported(connector, opts) {
  for (const [flag, key] of Object.entries(FLAG_KEY)) {
    if (opts[flag] !== undefined && !connector.supports.includes(key)) {
      throw new Error(`--${flag} is not supported by the "${connector.id}" connector (${connector.label}).`);
    }
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdStatus(opts) {
  const { connector, session } = await openSession(opts);
  const result = { status: 'ok', connector: connector.id, ...connector.describe(session, { full: Boolean(opts.full) }) };
  const legacy = planMigration(homedir());
  if (legacy.length) result.notice = `Data kept under the former name (drawthing) found: run "migrate" to move it (${legacy.map((s) => s.from).join(', ')}).`;
  return result;
}

// Generates one image. `ctx` ({ connector, session }) can be passed to avoid reconnecting in a sweep.
export async function generateOne(ctx, opts) {
  if (!opts.out || opts.out === true) throw new Error('--out <file.png> is required');
  const out = resolve(String(opts.out));
  if (!out.toLowerCase().endsWith('.png')) throw new Error('--out must end with .png');

  const found = opts.from ? readAnyMetadata(readFileSync(resolve(String(opts.from)))) : null;
  const from = found?.meta ?? null;
  if (opts.from && !from) throw new Error(`No generation metadata found in ${opts.from}`);
  let text = opts.prompt;
  if (opts['prompt-file']) text = readFileSync(resolve(String(opts['prompt-file'])), 'utf8').trim();
  text = text && text !== true ? text : from?.prompt;
  if (!text) throw new Error('Provide --prompt, --prompt-file or --from <png>');

  let style = null;
  let prompt = text;
  if (opts.style && opts.style !== true) {
    style = loadStyles()[opts.style];
    if (!style) throw new Error(`Unknown style "${opts.style}". Run: local-designer.mjs styles`);
    prompt = applyStyle(style, text);
  }

  let initImage;
  let initSize = null;
  if (opts.init) {
    const buf = readFileSync(resolve(String(opts.init)));
    initImage = buf.toString('base64');
    initSize = pngSize(buf);
  }

  const seed = opts.seed !== undefined ? Number(opts.seed) : from?.seed ?? Math.floor(Math.random() * 2 ** 31);
  const fromSize = /^(\d+)x(\d+)$/.exec(from?.size ?? '');
  // Engine independent request: each connector turns it into its own call and ignores what it does not know.
  const req = {
    prompt,
    negative: opts.negative === undefined ? from?.negative_prompt ?? style?.negative : opts.negative,
    width: opts.width ?? fromSize?.[1] ?? (initSize && initSize.width % 64 === 0 ? initSize.width : undefined),
    height: opts.height ?? fromSize?.[2] ?? (initSize && initSize.height % 64 === 0 ? initSize.height : undefined),
    sampler: opts.sampler ?? from?.sampler ?? style?.params?.sampler,
    shift: opts.shift ?? from?.shift ?? style?.params?.shift,
    seed,
    steps: opts.steps ?? from?.steps ?? style?.params?.steps,
    guidance: opts.guidance ?? from?.guidance_scale ?? style?.params?.guidance,
    strength: opts.strength ?? (initImage ? 0.7 : undefined),
    seedMode: opts['seed-mode'],
    clipSkip: opts['clip-skip'],
    model: opts.model ?? from?.model,
    plain: Boolean(opts.plain),
    lora: opts.lora ?? [],
    set: opts.set ?? [],
    initImage,
  };
  const { connector, session } = ctx ?? (await openSession(opts));
  assertSupported(connector, opts);
  const plan = connector.plan(session, req);
  const { summary } = plan;
  if (opts['dry-run']) return { status: 'dry-run', mode: plan.mode, summary, prompt, request: plan.shown, connector: connector.id };

  const started = Date.now();
  const png = await connector.render(session, plan, { timeoutMs: Number(opts.timeout ?? 900) * 1000 });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);

  const result = { status: 'ok', output: out, bytes: png.length, seconds: Math.round((Date.now() - started) / 1000), summary, connector: connector.id };
  if (opts.webp) {
    const webp = out.replace(/\.png$/i, '.webp');
    const quality = String(opts.quality ?? 82);
    const run = spawnSync('cwebp', ['-q', quality, '-m', '6', out, '-o', webp], { encoding: 'utf8' });
    if (run.status !== 0) result.webp_error = (run.stderr || run.error?.message || 'cwebp failed').trim().slice(0, 300);
    else result.webp = webp;
  }
  if (opts.sidecar) {
    const side = out.replace(/\.png$/i, '.json');
    const record = {
      prompt,
      subject: style ? text : undefined,
      style: style?.name,
      negative_prompt: plan.negative,
      ...summary,
      ...plan.sidecar,
      connector: connector.id,
    };
    writeFileSync(side, `${JSON.stringify(record, null, 2)}\n`);
    result.sidecar = side;
  }
  return result;
}

// Width/height (multiples of 64, long side ~`long`) for a ratio such as "16:9".
export function sizeFromRatio(ratio, long = 512) {
  const m = /^(\d+):(\d+)$/.exec(String(ratio));
  if (!m || !Number(m[1]) || !Number(m[2])) throw new Error(`Invalid ratio "${ratio}" (expected like 16:9)`);
  const [w, h] = [Number(m[1]), Number(m[2])];
  const snap = (v) => Math.min(4096, Math.max(256, Math.round(v / 64) * 64));
  return w >= h ? { width: snap(long), height: snap((long * h) / w) } : { width: snap((long * w) / h), height: snap(long) };
}

// Lock: with --charter, generation only runs once the project's design charter is active (a style validated by someone).
// The charter's style and negative prompt are used; --prompt is the subject, --width / --height still override.
export async function generateFromCharter(opts) {
  const file = charterFile({ dir: optStr(opts, 'charter'), root: optStr(opts, 'root') });
  const { charter } = loadCharter(file);
  const { errors } = validateCharter(charter, loadStyles());
  if (charter.status !== 'active' || errors.length) {
    throw new Error(`The design charter ${file} is not active${errors.length ? ` (${errors.join('; ')})` : ''}. Validate a mood board direction (/aikido-design-moodboard) then run: charter init --moodboard <dir>, or: charter activate --style NAME --by "<who>".`);
  }
  const subject = optStr(opts, 'prompt');
  if (!subject && !opts['prompt-file'] && !opts.from) throw new Error('--prompt "<subject>" is required with --charter (the charter holds the look, not the subject).');
  const size = charter.format?.ratio ? sizeFromRatio(charter.format.ratio, 1024) : {};
  const merged = { ...opts, style: charter.style.name, negative: opts.negative ?? (charter.style.negative || undefined), width: opts.width ?? size.width, height: opts.height ?? size.height };
  delete merged.charter;
  delete merged.root;
  const result = await generateOne(null, merged);
  return { ...result, charter: { project: charter.project, revision: charter.revision, style: charter.style.name, validated_by: charter.validated_by, validated_at: charter.validated_at } };
}

// Lock: with --moodboard <dir>, generation only runs for a direction the client validated.
// The validated style and the brief subject are used; --prompt / --width / --height still override.
async function cmdGenerate(opts) {
  if (opts.charter && opts.moodboard) throw new Error('Choose one lock: --charter (project identity) or --moodboard (client direction), not both.');
  if (opts.charter) return generateFromCharter(opts);
  if (!opts.moodboard || opts.moodboard === true) return generateOne(null, opts);
  const { brief, track, validated_by: by, validated_at: at } = validatedTrack(opts.moodboard);
  const subject = optStr(opts, 'prompt') ?? brief.subject;
  if (!subject) throw new Error('The brief has no "subject" and no --prompt was given.');
  const size = brief.format?.ratio ? sizeFromRatio(brief.format.ratio, 1024) : {};
  const merged = { ...opts, style: track.style, prompt: subject, negative: opts.negative ?? (track.negative || undefined), width: opts.width ?? size.width, height: opts.height ?? size.height };
  delete merged.moodboard;
  const result = await generateOne(null, merged);
  return { ...result, moodboard: { direction: track.id, style: track.style, validated_by: by, validated_at: at } };
}

function cmdInspect(opts) {
  const file = opts._[0];
  if (!file) throw new Error('Usage: inspect <image.png>');
  const found = readAnyMetadata(readFileSync(resolve(file)));
  if (!found) throw new Error('No generation metadata found in this PNG (WebP/JPEG copies lose it)');
  return { status: 'ok', file: resolve(file), connector: found.connector, metadata: found.meta };
}

// Which engines are registered and which one answers right now.
async function cmdConnectors(opts) {
  const chosen = await resolveConnector(opts).catch(() => null);
  const list = [];
  for (const c of listConnectors()) {
    list.push({ id: c.id, label: c.label, supports: c.supports, reachable: typeof c.detect === 'function' ? await c.detect(opts) : null, selected: chosen?.id === c.id });
  }
  return { status: 'ok', default: DEFAULT_CONNECTOR, selection: 'auto: --connector, then $LOCAL_DESIGNER_CONNECTOR, then the first reachable', connectors: list };
}

// Moves data kept under the former name (drawthing) to the local-designer names; --dry-run only lists.
function cmdMigrate(opts) {
  const plan = planMigration(homedir());
  if (opts['dry-run'] || !plan.length) return { status: plan.length ? 'dry-run' : 'ok', steps: plan, note: plan.length ? undefined : 'Nothing to migrate.' };
  return { status: 'ok', steps: applyMigration(homedir()) };
}

const STYLE_SUBCOMMANDS = new Set(['list', 'show', 'save', 'compose', 'draft', 'thumb', 'index', 'validate']);

function styleCard(s) {
  const t = thumbFile(s);
  return { name: s.name, category: s.category, description: s.description, origin: s.origin, thumbnail: t && existsSync(t) ? t : null };
}

// Renders each style's own `thumb_subject` (seed 42, 768x512, 16 steps) outside git, then stores a
// 384x256 WebP next to the style so the choice can be illustrated and compared without regenerating.
async function makeThumbs(opts, styles, names) {
  const selected = names.length ? names : Object.keys(styles).filter((n) => opts.all || !existsSync(thumbFile(styles[n])));
  for (const n of selected) if (!styles[n]) throw new Error(`Unknown style "${n}". Available: ${Object.keys(styles).join(', ')}`);
  const lab = resolve(String(opts['out-dir'] && opts['out-dir'] !== true ? opts['out-dir'] : join(DEFAULT_LAB_DIR, `${new Date().toISOString().slice(0, 10)}-thumbs`)));
  if (insideGitRepo(lab) && !opts['allow-in-repo']) throw new Error(`--out-dir ${lab} is inside a git repository: renders stay outside git (default ${DEFAULT_LAB_DIR}).`);
  const plan = selected.map((n) => ({ style: n, subject: opts.subject && opts.subject !== true ? opts.subject : styles[n].thumb_subject ?? null, thumbnail: thumbFile(styles[n]) }));
  if (opts['dry-run']) return { status: 'dry-run', out_dir: lab, count: plan.length, plan };

  const ctx = await openSession(opts);
  mkdirSync(lab, { recursive: true });
  const results = [];
  const started = Date.now();
  for (const [i, item] of plan.entries()) {
    const entry = { style: item.style };
    if (!item.subject) {
      entry.error = 'no thumb_subject in the style and no --subject given';
      results.push(entry);
      continue;
    }
    const png = join(lab, `${item.style}-s${opts.seed ?? 42}.png`);
    process.stderr.write(`[${i + 1}/${plan.length}] ${item.style}\n`);
    try {
      if (!(opts.resume && existsSync(png))) {
        await generateOne(ctx, { ...opts, out: png, prompt: item.subject, style: item.style, seed: opts.seed ?? 42, width: opts.width ?? 768, height: opts.height ?? 512, steps: opts.steps ?? 16, sidecar: true });
      }
      mkdirSync(dirname(item.thumbnail), { recursive: true });
      const run = spawnSync('cwebp', ['-quiet', '-q', '78', '-m', '6', '-resize', '384', '256', png, '-o', item.thumbnail], { encoding: 'utf8' });
      if (run.status !== 0) throw new Error((run.stderr || run.error?.message || 'cwebp failed').trim().slice(0, 200));
      entry.thumbnail = item.thumbnail;
      entry.render = png;
    } catch (error) {
      entry.error = error.message;
      process.stderr.write(`  failed: ${error.message}\n`);
    }
    results.push(entry);
  }
  return { status: 'ok', out_dir: lab, done: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length, seconds: Math.round((Date.now() - started) / 1000), results };
}

async function cmdStyles(opts) {
  const styles = loadStyles();
  const first = opts._[0];
  const isSub = STYLE_SUBCOMMANDS.has(first);
  const sub = isSub ? first : first ? 'show' : 'list'; // `styles watercolor` stays a shortcut for `styles show watercolor`
  const args = isSub ? opts._.slice(1) : opts._;
  const need = (n) => {
    if (!n) throw new Error('A style name is required');
    if (!styles[n]) throw new Error(`Unknown style "${n}". Available: ${Object.keys(styles).join(', ')}`);
    return styles[n];
  };
  const targetDir = () => resolve(String(opts.dir && opts.dir !== true ? opts.dir : USER_STYLES_DIR));

  if (sub === 'list') {
    let list = Object.values(styles);
    if (opts.category && opts.category !== true) list = list.filter((s) => s.category === opts.category);
    if (opts.tag && opts.tag !== true) list = list.filter((s) => (s.tags ?? []).includes(String(opts.tag).toLowerCase()));
    return { status: 'ok', categories: CATEGORIES, count: list.length, styles: list.map(styleCard) };
  }
  if (sub === 'show') {
    const style = need(args[0]);
    return { status: 'ok', style, origin: style.origin, thumbnail: styleCard(style).thumbnail };
  }
  if (sub === 'save') {
    if (!opts.file || opts.file === true) throw new Error('Usage: styles save --file style.json [--dir DIR] (default dir: ~/.local-designer/styles)');
    const style = JSON.parse(readFileSync(resolve(String(opts.file)), 'utf8'));
    return { status: 'ok', name: style.name, saved: saveStyle(style, targetDir()) };
  }
  if (sub === 'compose') {
    const style = composeStyles(styles, args, { name: opts.name, description: opts.description, note: opts.note, category: opts['as-category'] });
    if (opts.save) return { status: 'ok', saved: saveStyle(style, targetDir()), style };
    return { status: 'ok', style, hint: 'Add --save to keep it, then: styles thumb <name>' };
  }
  if (sub === 'draft') {
    if (!args[0]) throw new Error('Usage: styles draft <image> [--name my-style] [--save [--dir DIR]]');
    const style = draftStyleFromImage(args[0], styles, { name: opts.name && opts.name !== true ? opts.name : undefined });
    if (opts.save) return { status: 'ok', saved: saveStyle(style, targetDir()), style };
    return { status: 'ok', style, hint: 'A draft: edit the template, then --save and "styles thumb <name>"' };
  }
  if (sub === 'thumb') return makeThumbs(opts, styles, args);
  if (sub === 'index') {
    const file = join(BUNDLED_STYLES_DIR, 'README.md');
    writeFileSync(file, renderGallery(loadStyles(BUNDLED_STYLES_DIR)));
    return { status: 'ok', written: file };
  }
  // validate
  const problems = Object.values(styles).map((s) => ({ name: s.name, errors: validateStyle(s) })).filter((p) => p.errors.length);
  const withoutThumb = Object.values(styles).filter((s) => !existsSync(thumbFile(s))).map((s) => s.name);
  return { status: problems.length ? 'error' : 'ok', count: Object.keys(styles).length, problems, without_thumbnail: withoutThumb };
}

// Design charter stored in the Memory Bank (prompts/gen/concepts/design/design-charter.md). See /aikido-init-design.
function cmdCharter(opts) {
  const [sub, arg] = opts._;
  const root = optStr(opts, 'root');
  const by = optStr(opts, 'by') ?? 'unknown';
  const file = charterFile({ dir: optStr(opts, 'dir'), root });
  const needFile = () => {
    if (!file) throw new Error('No prompts/gen folder found above the current directory: run from the project, or pass --root <project> or --dir <folder>.');
    return file;
  };
  const styles = loadStyles();
  const report = (charter, extra = {}) => ({ status: 'ok', file, project: charter.project, state: charter.status, revision: charter.revision, style: charter.style?.name ?? null, ...extra });

  if (sub === 'init') {
    needFile();
    if (existsSync(file) && !opts.force) throw new Error(`A design charter already exists: ${file}. Use "charter show", edit it, or pass --force to rebuild it (the decision log is kept).`);
    const previous = existsSync(file) && opts.force ? loadCharter(file).charter : null;
    const briefFile = optStr(opts, 'brief');
    let brief = briefFile ? readJsonFile(briefFile, 'brief') : {};
    let track = null;
    let moodboardBy;
    let moodboardAt = null;
    if (opts.moodboard && opts.moodboard !== true) {
      const v = validatedTrack(opts.moodboard);
      brief = { ...v.brief, ...brief };
      track = v.track;
      moodboardBy = v.validated_by;
      moodboardAt = v.validated_at;
    }
    if (briefFile) { const errors = validateBrief(brief); if (errors.length) throw new Error(`Invalid brief: ${errors.join('; ')}`); }
    const scanDir = opts.scan ? (opts.scan === true ? (root ?? findProjectRoot() ?? '.') : String(opts.scan)) : null;
    const scan = scanDir ? scanProject(scanDir, styles, { limit: 5 }) : null;
    if (!briefFile && !track && !scan) throw new Error('Nothing to build the charter from: pass --moodboard <validated dir>, --brief <brief.json> and/or --scan [dir].');
    // Design target (<project>/design/design-charter.md): the project is the parent of the design folder.
    // Legacy layout (<root>/prompts/gen/concepts/design/design-charter.md): five levels up.
    const target = resolveDesignDir();
    const fallbackName = !file || optStr(opts, 'dir') ? 'project'
      : target && resolve(dirname(file)) === target ? basename(dirname(target))
        : basename(resolve(file, '..', '..', '..', '..', '..'));
    const charter = buildCharter({ brief, track, scan, fallbackName, by: moodboardBy ?? by, validatedAt: moodboardAt, moodboard: opts.moodboard && opts.moodboard !== true ? opts.moodboard : null, briefFile: Boolean(briefFile) });
    if (previous) { charter.revision = previous.revision + 1; charter.decisions = [...previous.decisions, ...charter.decisions]; }
    const { errors, warnings } = validateCharter(charter, styles);
    if (errors.length) throw new Error(`Invalid charter: ${errors.join('; ')}`);
    if (opts['dry-run']) return { status: 'dry-run', file, charter, warnings };
    saveCharter(file, charter);
    const indexes = opts['no-index'] ? [] : registerInIndexes(file);
    return report(charter, { warnings, indexes_updated: indexes, next: charter.status === 'draft' ? 'Draft: validate a direction with the client, then rerun with --moodboard <dir> --force, or: charter activate --style NAME --by "<who>".' : 'Active: generate with --charter. Generation now follows this identity.' });
  }

  needFile();
  const loaded = loadCharter(file);
  const { charter } = loaded;

  if (sub === 'show') return report(charter, { charter, out_of_sync: outOfSync(loaded) });
  if (sub === 'check') {
    const { errors, warnings } = validateCharter(charter, styles);
    if (outOfSync(loaded)) warnings.push('the text and the JSON block differ: edit the JSON then run "charter render"');
    return { status: errors.length ? 'error' : 'ok', file, state: charter.status, errors, warnings };
  }
  if (sub === 'render') {
    saveCharter(file, charter, loaded.tail);
    return report(charter, { rendered: true });
  }
  if (sub === 'activate') {
    const name = optStr(opts, 'style');
    if (!name) throw new Error('Usage: charter activate --style NAME --by "<who>" [--note "..."]');
    if (!styles[name]) throw new Error(`Unknown style "${name}". Available: ${Object.keys(styles).join(', ')}`);
    if (!optStr(opts, 'by')) throw new Error('--by "<who validated this>" is required: an active charter always names its validator.');
    withStyle(charter, styles[name]);
    Object.assign(charter, { status: 'active', validated_by: by, validated_at: new Date().toISOString() });
    touch(charter, { by, note: optStr(opts, 'note') ?? `Style ${name} validated.` });
    const { errors } = validateCharter(charter, styles);
    if (errors.length) throw new Error(`Invalid charter: ${errors.join('; ')}`);
    saveCharter(file, charter, loaded.tail);
    return report(charter);
  }
  if (sub === 'note') {
    const text = optStr(opts, 'text') ?? opts._.slice(1).join(' ');
    if (!text) throw new Error('Usage: charter note "<decision or remark>" --by "<who>"');
    touch(charter, { by, note: text });
    saveCharter(file, charter, loaded.tail);
    return report(charter);
  }
  if (sub === 'audit') {
    const targets = opts._.slice(1).flatMap((p) => {
      const path = resolve(p);
      if (existsSync(path) && statSync(path).isDirectory()) return readdirSync(path).filter((f) => /\.(png|webp|jpe?g)$/i.test(f)).sort().map((f) => join(path, f));
      return [path];
    });
    if (!targets.length) throw new Error('Usage: charter audit <image|folder>... [--root P]');
    const images = targets.map((t) => {
      try { const a = analyzeImage(t); return { image: a.file, ...auditColours(a.palette, charter), measured: a.palette }; } catch (error) { return { image: basename(t), verdict: 'unreadable', error: error.message }; }
    });
    const count = (v) => images.filter((i) => i.verdict === v).length;
    return { status: 'ok', charter: { file, state: charter.status, project: charter.project }, summary: { images: images.length, on_brand: count('on-brand'), partial: count('partial'), off_brand: count('off-brand'), unreadable: count('unreadable') }, images };
  }
  throw new Error('Usage: charter init|show|check|render|activate|note|audit ...');
}

// Character model sheet: a spec in head units drives a flat plan (img2img start) and the off-model audit.
function cmdCharacter(opts) {
  const [sub, a, b] = opts._;
  const readJson = (file, what) => {
    if (!file) throw new Error(`Usage: character ${sub} <${what}>`);
    return JSON.parse(readFileSync(resolve(file), 'utf8'));
  };
  const writeOut = (file, buf) => { mkdirSync(dirname(resolve(file)), { recursive: true }); writeFileSync(resolve(file), buf); return resolve(file); };
  const view = optStr(opts, 'view') ?? 'front';
  if (sub === 'check') {
    const spec = readJson(a, 'spec.json');
    const verdict = validateSpec(spec);
    return { status: verdict.errors.length ? 'invalid' : 'ok', ...verdict, parts: spec.parts?.length ?? 0, height: spec.height };
  }
  if (sub === 'grid') {
    if (!a) throw new Error('Usage: character grid <image.png> [--step 32] [--out grid.png]');
    const out = optStr(opts, 'out') ?? a.replace(/\.png$/i, '') + '-grid.png';
    return { status: 'ok', out: writeOut(out, gridOverlay(readFileSync(resolve(a)), { step: Number(opts.step ?? 32) })) };
  }
  if (sub === 'measure') {
    return { status: 'ok', ...measureLandmarks(readJson(a, 'landmarks.json')) };
  }
  if (sub === 'plan') {
    const spec = readJson(a, 'spec.json');
    const out = optStr(opts, 'out');
    if (!out) throw new Error('Usage: character plan <spec.json> --out plan.png [--view front|back] [--lines] [--guides] [--size 512]');
    const size = opts.size ? { width: Number(opts.size), height: Number(opts.size) } : undefined;
    const img = renderPlan(spec, { view, size, lines: opts.lines === true, guides: opts.guides === true });
    return { status: 'ok', ...validateSpec(spec), out: writeOut(out, planToPng(img, { Description: `plan ${spec.name} ${view}` })), width: img.width, height: img.height };
  }
  if (sub === 'audit') {
    if (!a || !b) throw new Error('Usage: character audit <spec.json> <image.png> [--view front] [--tolerance 0.15] [--threshold 38] [--rows]');
    const spec = readJson(a, 'spec.json');
    const img = decodePng(readFileSync(resolve(b)));
    const o = { view, tolerance: opts.tolerance ? Number(opts.tolerance) : undefined, threshold: opts.threshold ? Number(opts.threshold) : undefined };
    const clean = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    const zones = auditZones(img, spec, clean);
    const result = { status: 'ok', image: b, view, ...zones };
    if (opts.rows === true) result.rows = auditImage(img, spec, clean).rows;
    return result;
  }
  throw new Error('Usage: character check|grid|measure|plan|audit ...');
}

// Vision: an optional local vision-language model, otherwise the agent's current model reads (see references/vision.md).
async function cmdVision(opts) {
  const [sub, ...rest] = opts._;
  const allowRemote = opts['allow-remote'] === true;
  const cfg = loadVisionConfig();
  if (optStr(opts, 'url')) cfg.url = optStr(opts, 'url').replace(/\/+$/, '');
  if (sub === 'status') return { status: 'ok', ...(await visionStatus(cfg, { allowRemote })) };
  if (sub === 'checks') {
    // The checklist any reader answers (local model or current model): brief checks first, then the standard ones.
    let checks = DEFAULT_CHECKS;
    let context;
    if (optStr(opts, 'brief')) {
      const brief = JSON.parse(readFileSync(resolve(optStr(opts, 'brief')), 'utf8'));
      checks = [...checksFromBrief(brief), ...DEFAULT_CHECKS];
      context = brief.project ? `images for the project ${brief.project}` : undefined;
    }
    if (optStr(opts, 'checks')) checks = optStr(opts, 'checks').split(';').map((s) => s.trim()).filter(Boolean);
    return { status: 'ok', context: context ?? null, checks, prompt: reviewPrompt(checks, { context }),
      note: 'Answer each check pass | fail | unclear while looking at the image; never turn unclear into pass.' };
  }
  if (sub === 'models') {
    const models = await listVisionModels(cfg, { allowRemote });
    return { status: 'ok', url: cfg.url, pinned: cfg.model ?? null, models,
      note: 'Optional. To use a local model for every image, pick one that reads images (type "vlm" on LM Studio; on other servers, check the model card), then: vision pin --model <id>' };
  }
  if (sub === 'pin') {
    const model = optStr(opts, 'model');
    const models = await listVisionModels(cfg, { allowRemote });
    const found = models.find((m) => m.id === model);
    if (model && !found) throw new Error(`"${model}" is not on ${cfg.url}. Available: ${models.map((m) => m.id).join(', ')}`);
    if (found?.type === 'llm' && opts.force !== true) throw new Error(`"${model}" is a text-only model on this server. Pick a vlm, or pass --force if you know it reads images.`);
    return { status: 'ok', ...pinVision({ model, url: cfg.url }), note: 'Commit .local-designer.json so the whole project uses the same model.' };
  }
  const images = rest;
  if (sub === 'ask') {
    const prompt = optStr(opts, 'prompt') ?? (optStr(opts, 'prompt-file') ? readFileSync(resolve(optStr(opts, 'prompt-file')), 'utf8') : undefined);
    return askVision(cfg, { images, prompt, allowRemote, maxTokens: opts['max-tokens'] ? Number(opts['max-tokens']) : undefined,
      timeout: opts.timeout ? Number(opts.timeout) : undefined, seed: opts.seed ? Number(opts.seed) : undefined, maxSide: opts['max-side'] ? Number(opts['max-side']) : undefined });
  }
  if (sub === 'review') {
    let checks = DEFAULT_CHECKS;
    let context = optStr(opts, 'context');
    if (optStr(opts, 'brief')) {
      const brief = JSON.parse(readFileSync(resolve(optStr(opts, 'brief')), 'utf8'));
      checks = [...checksFromBrief(brief), ...DEFAULT_CHECKS];
      context ??= brief.project ? `images for the project ${brief.project}` : undefined;
    }
    if (optStr(opts, 'checks')) checks = optStr(opts, 'checks').split(';').map((s) => s.trim()).filter(Boolean);
    if (!checks.length) throw new Error('vision review: no check to answer');
    const results = [];
    for (const image of images) {
      const asked = await askVision(cfg, { images: [image], prompt: reviewPrompt(checks, { context }), allowRemote,
        maxTokens: opts['max-tokens'] ? Number(opts['max-tokens']) : undefined, timeout: opts.timeout ? Number(opts.timeout) : undefined, maxSide: opts['max-side'] ? Number(opts['max-side']) : undefined });
      results.push({ image, seconds: asked.seconds, ...summariseReview(checks, asked.answer) });
    }
    const count = (v) => results.filter((r) => r.verdict === v).length;
    return { status: 'ok', model: cfg.model, source: cfg.source, url: cfg.url, summary: { images: results.length, ok: count('ok'), to_check: count('to-check'), fail: count('fail'), unparsed: count('unparsed') }, results,
      note: 'A pass is the model\'s reading, not a proof: look at every image that is not "ok", and at the hands and text of the others.' };
  }
  throw new Error('Usage: vision status|models|pin|checks|ask|review ...');
}

function cmdAnalyze(opts) {
  if (!opts._[0]) throw new Error('Usage: analyze <image>');
  return { status: 'ok', ...analyzeImage(opts._[0]) };
}

function cmdMatch(opts) {
  if (!opts._[0]) throw new Error('Usage: match <image> [--limit 5]');
  return { status: 'ok', ...matchImage(opts._[0], loadStyles(), Number(opts.limit ?? 5)) };
}

function cmdProjectScan(opts) {
  return { status: 'ok', ...scanProject(opts._[0] ?? '.', loadStyles(), { limit: Number(opts.limit ?? 5) }) };
}

function cmdRecommend(opts) {
  const brief = [opts.brief, ...opts._].filter((x) => x && x !== true).join(' ');
  if (!brief) throw new Error('Usage: recommend --brief "what the image is for" [--category photo] [--limit 5]');
  const styles = loadStyles();
  const r = recommendStyles(styles, brief, { limit: Number(opts.limit ?? 5), category: opts.category && opts.category !== true ? opts.category : undefined });
  return { status: 'ok', ...r, results: r.results.map((x) => ({ ...x, thumbnail: styleCard(styles[x.name]).thumbnail })) };
}

async function cmdSweep(opts) {
  if (!opts.subject || opts.subject === true) throw new Error('--subject "<what to draw>" is required');
  const all = loadStyles();
  let styles = [null];
  if (opts.styles && opts.styles !== true) {
    styles = opts.styles === 'all' ? Object.keys(all) : String(opts.styles).split(',').map((s) => s.trim()).filter(Boolean);
    for (const s of styles) if (!all[s]) throw new Error(`Unknown style "${s}". Available: ${Object.keys(all).join(', ')}`);
  }
  const seeds = opts.seeds && opts.seeds !== true ? String(opts.seeds).split(',').map((s) => s.trim()) : [undefined];
  const jobs = buildJobs({ styles, seeds, vary: opts.vary });

  const dir = resolve(String(opts['out-dir'] && opts['out-dir'] !== true ? opts['out-dir'] : join(DEFAULT_LAB_DIR, `${new Date().toISOString().slice(0, 10)}-${slug(opts.subject)}`)));
  if (insideGitRepo(dir) && !opts['allow-in-repo']) {
    throw new Error(`--out-dir ${dir} is inside a git repository. Use a folder outside git (default: ${DEFAULT_LAB_DIR}) or pass --allow-in-repo.`);
  }
  const common = { ...opts };
  for (const k of ['subject', 'styles', 'seeds', 'vary', 'out-dir', 'allow-in-repo', 'resume']) delete common[k];

  const plan = jobs.map((j) => ({ name: j.name, style: j.style, vary: j.vary, seed: j.seed }));
  if (opts['dry-run']) return { status: 'dry-run', out_dir: dir, count: jobs.length, jobs: plan };

  const ctx = await openSession(opts);
  mkdirSync(dir, { recursive: true });
  const entries = [];
  const started = Date.now();
  for (const [n, job] of jobs.entries()) {
    const file = `${job.name}.png`;
    const label = [job.style ?? 'raw', ...Object.entries(job.vary).map(([k, v]) => `${k}=${v}`), job.seed === undefined ? '' : `seed ${job.seed}`].filter(Boolean).join(' | ');
    const entry = { name: job.name, file, label, prompt: job.style ? applyStyle(all[job.style], opts.subject) : opts.subject };
    if (opts.resume && existsSync(join(dir, file))) {
      entries.push(entry);
      continue;
    }
    process.stderr.write(`[${n + 1}/${jobs.length}] ${label}\n`);
    try {
      const jobOpts = { ...common, ...job.vary, prompt: opts.subject, style: job.style ?? undefined, seed: job.seed ?? common.seed, out: join(dir, file), sidecar: true };
      if (jobOpts.style === undefined) delete jobOpts.style;
      const r = await generateOne(ctx, jobOpts);
      entry.seconds = r.seconds;
    } catch (error) {
      entry.error = error.message;
      process.stderr.write(`  failed: ${error.message}\n`);
    }
    entries.push(entry);
    writeFileSync(join(dir, 'index.html'), renderIndexHtml(`local-designer sweep - ${opts.subject}`, entries));
    writeFileSync(join(dir, 'index.json'), `${JSON.stringify({ subject: opts.subject, settings: common, entries }, null, 2)}\n`);
  }
  writeFileSync(join(dir, 'index.html'), renderIndexHtml(`local-designer sweep - ${opts.subject}`, entries));
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify({ subject: opts.subject, settings: common, entries }, null, 2)}\n`);
  return {
    status: 'ok',
    out_dir: dir,
    index: join(dir, 'index.html'),
    images: entries.filter((e) => !e.error).length,
    failed: entries.filter((e) => e.error).length,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

// ---------------------------------------------------------------------------
// Brief and mood board
// ---------------------------------------------------------------------------

const optStr = (opts, key) => (opts[key] && opts[key] !== true ? String(opts[key]) : undefined);

function readJsonFile(file, what) {
  const path = resolve(file);
  if (!existsSync(path)) throw new Error(`${what} not found: ${path}`);
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { throw new Error(`${what} is not valid JSON: ${error.message}`); }
}

function cmdBrief(opts) {
  const [sub, file] = opts._;
  if (sub === 'template') return { status: 'ok', brief: BRIEF_TEMPLATE, hint: 'Fill it with the client, save as brief.json, then: brief check brief.json' };
  if (sub === 'check') {
    if (!file) throw new Error('Usage: brief check <brief.json>');
    const errors = validateBrief(readJsonFile(file, 'brief'));
    return { status: errors.length ? 'error' : 'ok', errors };
  }
  throw new Error('Usage: brief template | brief check <brief.json>');
}

// Rebuilds moodboard.html from the files on disk (trial renders found in trials/ are embedded).
function rebuildMoodboardHtml(dir) {
  const { brief, board, decision } = loadBoard(dir);
  const scenes = board.scenes ?? [];
  const images = {};
  for (const t of board.tracks) {
    const perScene = Object.fromEntries(scenes.map((s) => [s.id, trialImage(dir, t.id, s.id)]).filter(([, f]) => f));
    if (Object.keys(perScene).length) images[t.id] = perScene;
    else if (trialImage(dir, t.id)) images[t.id] = trialImage(dir, t.id); // former mood board: one trial per direction
  }
  // The thumbnail is found again from the style name (board.json keeps no absolute path).
  const styles = loadStyles();
  const tracks = board.tracks.map((t) => ({ ...t, thumbnail: t.thumbnail ?? (styles[t.style] ? thumbFile(styles[t.style]) : null) }));
  const file = boardPath(dir, 'html');
  writeFileSync(file, renderMoodboardHtml({ brief, scenes, tracks }, decision, images));
  return file;
}

// One small render per direction AND per scene (the situations), converted to webp so the folder stays light enough to be versioned.
async function runTrials(dir, opts) {
  const { brief, board } = loadBoard(dir);
  const scenes = board.scenes?.length ? board.scenes : scenesOf(brief);
  if (!scenes.length) throw new Error('The brief has no "subject" and no "scenes": trials need one.');
  const upper = (key) => optStr(opts, key)?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const onlyTracks = upper('track');
  const onlyScenes = optStr(opts, 'scene')?.split(',').map((s) => s.trim()).filter(Boolean);
  const ctx = await openSession(opts);
  const long = Number(opts.size ?? 640);
  const trials = [];
  for (const t of board.tracks) {
    if (onlyTracks && !onlyTracks.includes(t.id)) continue;
    for (const scene of scenes) {
      if (onlyScenes && !onlyScenes.includes(scene.id)) continue;
      const out = trialPath(dir, t.id, scene.id);
      const done = trialImage(dir, t.id, scene.id);
      if (opts.resume && done) { trials.push({ track: t.id, scene: scene.id, file: done, reused: true }); continue; }
      const size = sizeFromRatio(scene.ratio ?? brief.format?.ratio ?? '4:3', long);
      process.stderr.write(`[trial ${t.id}/${scene.id}] ${t.style}\n`);
      try {
        const r = await generateOne(ctx, { prompt: scene.subject, style: t.style, negative: t.negative || undefined, out, width: size.width, height: size.height, steps: opts.steps ?? 8, seed: opts.seed ?? 42,
          sidecar: true, webp: true, quality: opts.quality ?? 80, timeout: opts.timeout, model: opts.model });
        if (r.webp) rmSync(out, { force: true }); // keep the png only when the conversion failed
        trials.push({ track: t.id, scene: scene.id, file: r.webp ?? out });
      } catch (error) {
        trials.push({ track: t.id, scene: scene.id, error: error.message });
        process.stderr.write(`  failed: ${error.message}\n`);
      }
    }
  }
  return { trials, html: rebuildMoodboardHtml(dir) };
}

async function cmdMoodboard(opts) {
  const [sub, dirArg] = opts._;
  const needDir = () => {
    if (!dirArg) throw new Error(`Usage: moodboard ${sub} <mood board folder> ...`);
    return resolve(dirArg);
  };
  if (sub === 'build') {
    const briefFile = optStr(opts, 'brief');
    if (!briefFile) throw new Error('Usage: moodboard build --brief brief.json [--out-dir DIR] [--styles a,b,c] [--count 3] [--trial] [--force]');
    const brief = readJsonFile(briefFile, 'brief');
    const errors = validateBrief(brief);
    if (errors.length) throw new Error(`Invalid brief: ${errors.join('; ')}`);
    const target = resolveDesignDir();
    const name = target ? `${new Date().toISOString().slice(0, 10)}-${slug(brief.project ?? brief.client)}` : `${new Date().toISOString().slice(0, 10)}-moodboard-${slug(brief.project ?? brief.client)}`;
    const dir = resolve(optStr(opts, 'out-dir') ?? join(target ? designMoodboardsDir(target) : DEFAULT_LAB_DIR, name));
    // Inside the design target a mood board is project material (kept with the charter); anywhere else in git it stays refused.
    if (insideGitRepo(dir) && !isInside(dir, target) && !opts['allow-in-repo']) {
      throw new Error(`--out-dir ${dir} is inside a git repository but outside the design target${target ? ` (${target})` : ' (none configured: --design-dir, LOCAL_DESIGNER_DESIGN_DIR or .local-designer.json)'}. Use a folder inside the target, or ${DEFAULT_LAB_DIR}.`);
    }
    if (existsSync(boardPath(dir, 'decision')) && !opts.force) throw new Error(`${dir} already holds a mood board with decisions. Use another --out-dir, or --force to start over.`);
    const only = optStr(opts, 'styles')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    const board = buildMoodboard(loadStyles(), brief, { count: Number(opts.count ?? 3), only });
    if (opts.force) rmSync(boardPath(dir, 'decision'), { force: true });
    saveBoard(dir, { brief, board });
    const html = rebuildMoodboardHtml(dir);
    const result = { status: 'ok', dir, html, tracks: board.tracks.map((t) => ({ id: t.id, style: t.style, thumbnail: t.thumbnail })), warnings: board.warnings,
      next: 'Show moodboard.html to the client (preview order: agent CLI/LLM host, then IDE built-in browser, then external browser: references/preview.md), then record the answer with: moodboard decide <dir> --track A --state validated --by "<who>"' };
    if (opts.trial) Object.assign(result, await runTrials(dir, opts));
    return result;
  }
  if (sub === 'decide') {
    const dir = needDir();
    const track = optStr(opts, 'track')?.toUpperCase();
    if (!track) throw new Error('--track <letter> is required');
    const decision = decide(dir, { track, state: optStr(opts, 'state'), comment: optStr(opts, 'comment'), by: optStr(opts, 'by') });
    return { status: 'ok', validated: decision.validated, summary: summary(dir), html: rebuildMoodboardHtml(dir) };
  }
  if (sub === 'trial') return { status: 'ok', ...(await runTrials(needDir(), opts)) };
  if (sub === 'status') return { status: 'ok', ...summary(needDir()) };
  if (sub === 'html') return { status: 'ok', html: rebuildMoodboardHtml(needDir()) };
  throw new Error('Usage: moodboard build|decide|trial|status|html ...');
}

const USAGE = `Usage: local-designer.mjs <command> [options]
  status [--full]                Check the image engine (connector); --full dumps every setting it exposes
  connectors                     List the registered engines and which one answers
  migrate [--dry-run]            Move data kept under the former name (drawthing) to local-designer
  styles [list|show <n>|compose a b|draft <img>|save --file f|thumb [n]|index|validate]
                                 Browse and manage render styles (filters: --category, --tag)
  recommend --brief "..."        Rank styles for a brief (French or English)
  analyze <image>                Palette, light, contrast and traits measured on an image
  match <image>                  Library styles closest to an image
  project-scan [dir]             Infer subject, brand palette and suitable styles from a project folder
  generate --out f.png (--prompt "..." | --prompt-file f.txt | --from ref.png)
           [--style name]        --prompt is then the subject inserted in the style template
           [--init in.png --strength 0.6]   img2img from an existing image
           [--width 1024 --height 1024 --seed N --steps N --guidance N --sampler "Euler A Trailing" --shift N]
           [--model name.ckpt --negative "..." --seed-mode "Scale Alike" --clip-skip N]
           [--lora file.ckpt:0.6]... [--set key=value]... [--plain]
           [--webp [--quality 82]] [--sidecar] [--dry-run] [--timeout 900]
  sweep --subject "..." [--styles a,b|all] [--seeds 1,2] [--vary steps=8,16]... [--out-dir DIR]
           [any generate option as common setting] [--resume] [--dry-run]
           Writes PNG + JSON + index.html outside git (default ${DEFAULT_LAB_DIR}).
  brief template|check <file>    Structured client brief (JSON): print the template or validate a file
  moodboard build --brief f.json [--out-dir D] [--styles a,b,c] [--count 3] [--trial] [--force]
                                 Build the client mood board (moodboard.html, board.json, decision.json) outside git
  moodboard decide D --track A [--state selected|rejected|validated] [--comment "..."] [--by "who"]
  moodboard trial D [--track A,B] [--scene hero,detail] [--size 640] [--steps 8] [--resume]
                                   One small render per direction and per scene (situation), saved as webp
  moodboard status D | html D    Show the state of each direction | rebuild the HTML page
  generate --moodboard D ...     Lock: refuses to run until a direction is validated; uses its style and the brief subject
  charter init [--moodboard D] [--brief f.json] [--scan [dir]] [--by who] [--force] [--dry-run] [--root P]
                                 Create the design charter in prompts/gen/concepts/design/ (draft unless a direction is validated)
  charter show|check|render      Read it | validate it (palette, style, text/JSON in sync) | rewrite the text from the JSON block
  charter activate --style NAME --by who [--note "..."]   Validate the style: the charter becomes active
  charter note "text" --by who   Add a decision to the log
  charter audit <image|folder>...  Compare the dominant colours of images with the charter palette (verdict per image + summary)
  uikit init [--primary #hex --accent #hex --neutral #hex] [--css site.css] [--brief f.json] [--fonts "A,B"] [--name N] [--prefix ui] [--force]
                                   UI kit: seed from options, a stylesheet, the charter or a brief; writes uikit.json + variants.html (A-E compared)
  uikit variants [--dark]          Rebuild variants.html (the five personalities on the same screen)
  uikit decide <A-E> --by who      Keep a personality and build the kit (tokens.css, components.css, tokens.vscode.css, icons.svg, showcase.html)
  uikit set key=value ...          primary, accent, neutral, prefers, fonts, icon_stroke, radius, border, elevation, control, ratio, button, gloss, grain, tint, saturation, display, uppercase, tracking
  uikit build | check | status     Regenerate the files | contrast of every colour pair in both modes | where the kit stands
  uikit assets [--only hero,panel] [--no-buttons] [--no-zones] [--quality 90]   Draw webp button skins (9-slice) and zone backgrounds + assets.css (no image model)
  uikit icons [name] [--size 24]   List the icons, or print one as SVG in the kit's stroke
  uikit note "text" --by who       Add a remark to the decision log        (all uikit commands: --dir <kit folder>, default <design dir>/uikit)
  character check <spec.json>      Validate a character model sheet (shapes in head units: 1 = height of the head)
  character grid <image.png> [--step 32] [--out f.png]   Numbered grid over a reference, to read landmarks by eye
  character measure <landmarks.json>   Pixels read on a reference -> positions and widths in head units
  character plan <spec.json> --out plan.png [--view front|back] [--lines] [--guides] [--size 512]
                                   Flat plan drawn from the sheet: the start image for generate --init (strength ~0.75)
  character audit <spec.json> <image.png> [--view front] [--tolerance 0.15] [--rows]
                                   Width of the head, shoulders/arms and trousers vs the sheet: on-model | off-model
 vision status | models         The OPTIONAL local vision-language model of this project (.local-designer.json "vision") and the server's models
                                Without it the current model reads the images itself (not-pinned is a normal state)
 vision pin --model <id> [--url http://127.0.0.1:1234/v1] [--force]   Set it (committed with the project; never chosen by the tool)
 vision checks [--brief f.json] [--checks "a;b"]   Print the checklist (and its prompt) any reader answers, local model or not
 vision ask <image>... --prompt "..." [--max-tokens 4096] [--max-side 1024] [--timeout 300]   Ask the local model about 1-4 images
 vision review <image>... [--brief f.json] [--checks "a;b"] [--context "..."]   Checklist per image: ok | to-check | fail
          Local server only; --allow-remote after the user agreed.
  generate --charter [file] --prompt "subject" ...   Lock: refuses to run until the charter is active; uses its style and negative
  inspect <image.png>            Print the prompt and parameters stored in a PNG by any registered engine
Common: --connector <id> (or env LOCAL_DESIGNER_CONNECTOR, default: first engine that answers)
        --url http://host:7860 (Draw Things connector; or env DRAWTHING_URL, default ${DEFAULT_URL})`;

async function main() {
  try {
    const { command, opts } = parseArgs(process.argv.slice(2));
    // One design target for the charter, the styles and the mood boards (see design-target.mjs).
    if (optStr(opts, 'design-dir')) process.env.LOCAL_DESIGNER_DESIGN_DIR = resolve(optStr(opts, 'design-dir'));
    let result;
    if (command === 'status') result = await cmdStatus(opts);
    else if (command === 'generate') result = await cmdGenerate(opts);
    else if (command === 'inspect') result = cmdInspect(opts);
    else if (command === 'styles') result = await cmdStyles(opts);
    else if (command === 'recommend') result = cmdRecommend(opts);
    else if (command === 'analyze') result = cmdAnalyze(opts);
    else if (command === 'match') result = cmdMatch(opts);
    else if (command === 'project-scan') result = cmdProjectScan(opts);
    else if (command === 'sweep') result = await cmdSweep(opts);
    else if (command === 'brief') result = cmdBrief(opts);
    else if (command === 'moodboard') result = await cmdMoodboard(opts);
    else if (command === 'charter') result = cmdCharter(opts);
    else if (command === 'uikit') result = cmdUikit(opts);
    else if (command === 'character') result = cmdCharacter(opts);
    else if (command === 'vision') result = await cmdVision(opts);
    else if (command === 'connectors') result = await cmdConnectors(opts);
    else if (command === 'migrate') result = cmdMigrate(opts);
    else {
      process.stderr.write(`${USAGE}\n`);
      process.exit(command ? 2 : 0);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'error', error: error.message }, null, 2)}\n`);
    process.exit(1);
  }
}

// Compare real paths: an install behind a symlink (macOS /tmp, a linked workspace) must still run.
const realPath = (p) => { try { return realpathSync(p); } catch { return resolve(String(p)); } };
if (process.argv[1] && realPath(process.argv[1]) === realPath(fileURLToPath(import.meta.url))) await main();
