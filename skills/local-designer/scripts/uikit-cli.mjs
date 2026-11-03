// `local-designer uikit ...`: the UI kit of a project, from brief to files.
//   init      seed (colours, fonts) from options, a stylesheet, the charter -> uikit.json + variants.html (5 personalities to compare)
//   variants  rebuild variants.html (--dark for the dark mode)
//   decide    <A-E> --by who : keep one personality, then build the kit
//   set       key=value ... : brand colours, fonts or a variant parameter (radius=6, button=gradient, icon_stroke=2, ...)
//   build     tokens.json, tokens.css, components.css, tokens.vscode.css, icons.svg, showcase.html
//   check     contrast of every colour pair, both modes
//   icons     list the icons or print one as SVG
//   assets    webp drawn by the kit: button skins (9-slice) and zone backgrounds (hero, panel, ...) + assets.css
//   status    where the kit stands, what is written
//   note      add a remark to the decision log
// The state is `uikit.json` (seed + chosen variant + overrides): it is the only file to edit, through `set`. Everything else is generated.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { buildAssets, SCALE, ZONE_NAMES, ZONES } from './uikit-assets.mjs';
import { charterFile, loadCharter } from './charter-lib.mjs';
import { resolveDesignDir } from './design-target.mjs';
import { componentsCss, tokensCss, vscodeBridgeCss } from './uikit-css.mjs';
import { showcaseHtml, variantsHtml } from './uikit-html.mjs';
import { ICON_NAMES, ICONS, iconStyleOf, iconSvg, spriteSvg } from './uikit-icons.mjs';
import { applySet, buildTokens, checkTokens, extractCssSeed, SCHEMA, seedFrom, validateSeed, validateTokens, VARIANTS, variantIds } from './uikit-lib.mjs';
import { cwebpAvailable } from './uikit-raster.mjs';

const STATE = 'uikit.json';
const str = (opts, key) => (opts[key] && opts[key] !== true ? String(opts[key]) : undefined);
const now = () => new Date().toISOString();

export function kitDir(opts, cwd = process.cwd()) {
  const dir = str(opts, 'dir');
  if (dir) return resolve(cwd, dir);
  const target = resolveDesignDir({ cwd });
  if (!target) throw new Error('No design folder: pass --dir <folder> or set "design_dir" in .local-designer.json (see /aikido-init-design). The kit lives in <design dir>/uikit/.');
  return join(target, 'uikit');
}

function write(file, text, written) {
  mkdirSync(dirname(file), { recursive: true });
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (before !== text) writeFileSync(file, text);
  written.push({ file, changed: before !== text });
}

export function loadState(dir) {
  const file = join(dir, STATE);
  if (!existsSync(file)) throw new Error(`No UI kit in ${dir}. Create it with: uikit init [--primary #hex --accent #hex] [--css site.css]`);
  let state;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { throw new Error(`${file} is not valid JSON: ${error.message}`); }
  if (state.schema !== SCHEMA) throw new Error(`${file}: schema ${state.schema} is not supported (expected ${SCHEMA})`);
  const errors = validateSeed(state.seed);
  if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`);
  if (state.variant && !VARIANTS[state.variant]) throw new Error(`${file}: unknown variant "${state.variant}" (${variantIds().join(', ')})`);
  return state;
}

const saveState = (dir, state) => writeFileSync(join(dir, STATE), `${JSON.stringify(state, null, 2)}\n`);
const tokensOf = (state) => buildTokens({ seed: state.seed, variant: state.variant, overrides: state.overrides ?? {}, name: state.name, prefix: state.prefix });

function writeVariants(dir, state, { dark = false } = {}) {
  const written = [];
  write(join(dir, 'variants.html'), variantsHtml(state.seed, { name: state.name, prefix: state.prefix, overrides: state.overrides ?? {}, dark, decided: state.variant }), written);
  return written;
}

// The generated files. Never edited by hand: `set` then `build`.
export function buildKit(dir, state) {
  if (!state.variant) throw new Error('No personality chosen yet. Compare variants.html, then: uikit decide <A-E> --by "<who>".');
  const tokens = tokensOf(state);
  const errors = validateTokens(tokens);
  if (errors.length) throw new Error(`Invalid tokens: ${errors.join('; ')}`);
  const written = [];
  write(join(dir, 'tokens.json'), `${JSON.stringify(tokens, null, 2)}\n`, written);
  write(join(dir, 'tokens.css'), tokensCss(tokens), written);
  write(join(dir, 'components.css'), componentsCss(tokens), written);
  write(join(dir, 'tokens.vscode.css'), vscodeBridgeCss(tokens), written);
  write(join(dir, 'icons.svg'), spriteSvg(tokens), written);
  write(join(dir, 'showcase.html'), showcaseHtml(tokens), written);
  written.push(...writeVariants(dir, state));
  const check = checkTokens(tokens);
  return { tokens, written, check };
}

const summariseCheck = (check) => ({
  ok: check.ok, pairs: check.total, failures: check.failures.map(({ mode, fg, bg, ratio, min }) => ({ mode, fg, bg, ratio, min })),
  advisories: check.warnings.map(({ mode, fg, bg, ratio, min }) => ({ mode, fg, bg, ratio, min })),
});
const rel = (dir, written) => written.map((w) => ({ file: relative(process.cwd(), w.file) || w.file, changed: w.changed }));

function tryCharter(opts) {
  try { return loadCharter(charterFile({ dir: str(opts, 'charter'), root: str(opts, 'root') })).charter; } catch { return null; }
}

function cmdInit(opts, dir) {
  const file = join(dir, STATE);
  if (existsSync(file) && !opts.force) throw new Error(`A UI kit already exists in ${dir}. Use "uikit set" to adjust it, or pass --force to restart from a new seed (the decision log is kept).`);
  const previous = existsSync(file) ? loadState(dir) : null;
  const cssFile = str(opts, 'css');
  const css = cssFile ? extractCssSeed(readFileSync(resolve(cssFile), 'utf8')) : null;
  const briefFile = str(opts, 'brief');
  const brief = briefFile ? JSON.parse(readFileSync(resolve(briefFile), 'utf8')) : null;
  const charter = opts['no-charter'] ? null : tryCharter(opts);
  const { seed, sources, hints } = seedFrom({ colors: { primary: str(opts, 'primary'), accent: str(opts, 'accent'), neutral: str(opts, 'neutral'), ink: str(opts, 'ink') }, css, charter, brief, prefers: str(opts, 'prefers') });
  if (str(opts, 'fonts')) seed.fonts = str(opts, 'fonts').split(',').map((s) => s.trim()).filter(Boolean);
  const errors = validateSeed(seed);
  if (errors.length) throw new Error(errors.join('; '));
  const prefix = str(opts, 'prefix') ?? previous?.prefix ?? 'ui';
  if (!/^[a-z][a-z0-9]{0,11}$/.test(prefix)) throw new Error(`--prefix must be 1-12 lowercase letters or digits, starting with a letter (got "${prefix}")`);
  const overrides = {};
  if (hints.radius !== undefined) overrides.radius = hints.radius;
  const state = {
    schema: SCHEMA, name: str(opts, 'name') ?? charter?.project ?? previous?.name ?? 'kit', prefix, seed, sources, variant: null, overrides,
    decision: null, log: [...(previous?.log ?? []), { at: now(), by: str(opts, 'by') ?? 'unknown', note: `Kit ${previous ? 'restarted' : 'created'} from ${[...new Set(sources.map((s) => s.split(':')[1]))].join(', ')}.` }],
  };
  mkdirSync(dir, { recursive: true });
  saveState(dir, state);
  const written = writeVariants(dir, state);
  const index = join(dir, 'index.md');
  if (!existsSync(index)) writeFileSync(index, `# UI kit\n\nDesign tokens, standard components, icons and image assets of the project, generated by the \`local-designer\` skill (\`/aikido-design-uikit\`).\n\n## Available Files\n\n- [\`${STATE}\`](${STATE}): State of the kit (seed, chosen personality, adjustments, decision log). The only file to edit, through \`uikit set\`\n- \`variants.html\`: The five personalities compared on the same screen\n- \`showcase.html\`, \`tokens.css\`, \`components.css\`, \`tokens.vscode.css\`, \`icons.svg\`, \`tokens.json\`, \`assets/\`: Generated by \`uikit build\` and \`uikit assets\`, never edited by hand\n`);
  return { status: 'ok', dir, state: STATE, seed, sources, written: rel(dir, written), next: 'Open variants.html with the client, pick a personality: uikit decide <A-E> --by "<who>". Adjust colours or parameters first with: uikit set primary=#hex radius=6 ...' };
}

function cmdDecide(opts, dir) {
  const state = loadState(dir);
  const letter = String(opts._[1] ?? '').toUpperCase();
  if (!variantIds().includes(letter)) throw new Error(`Usage: uikit decide <${variantIds().join('|')}> --by "<who>" [--note "..."]`);
  const by = str(opts, 'by');
  if (!by) throw new Error('--by "<who validated this>" is required: the kit always names who chose its personality.');
  const previous = state.variant;
  state.variant = letter;
  state.decision = { variant: letter, by, at: now() };
  state.log.push({ at: now(), by, note: str(opts, 'note') ?? (previous && previous !== letter ? `Personality changed ${previous} -> ${letter} (${VARIANTS[letter].label}).` : `Personality ${letter} (${VARIANTS[letter].label}) chosen.`) });
  saveState(dir, state);
  const { written, check } = buildKit(dir, state);
  return { status: check.ok ? 'ok' : 'warning', dir, variant: letter, label: VARIANTS[letter].label, decided_by: by, contrast: summariseCheck(check), written: rel(dir, written), next: 'Review showcase.html. Adjust with: uikit set ... then uikit build. Then image assets: uikit assets.' };
}

function cmdSet(opts, dir) {
  const state = loadState(dir);
  const pairs = opts._.slice(1);
  if (!pairs.length) throw new Error('Usage: uikit set key=value ... (primary, accent, neutral, prefers, fonts, icon_stroke, radius, border, elevation, control, ratio, button, gloss, grain, tint, saturation, display, uppercase, tracking)');
  const { seed, overrides } = applySet(state, pairs);
  const errors = validateSeed(seed);
  if (errors.length) throw new Error(errors.join('; '));
  state.seed = seed;
  state.overrides = overrides;
  state.log.push({ at: now(), by: str(opts, 'by') ?? 'unknown', note: `set ${pairs.join(' ')}` });
  saveState(dir, state);
  if (!state.variant) return { status: 'ok', dir, seed, overrides, written: rel(dir, writeVariants(dir, state)), next: 'Compare again in variants.html, then: uikit decide <A-E> --by "<who>".' };
  const { written, check } = buildKit(dir, state);
  return { status: check.ok ? 'ok' : 'warning', dir, variant: state.variant, seed, overrides, contrast: summariseCheck(check), written: rel(dir, written), next: 'If image assets exist, rebuild them: uikit assets.' };
}

function cmdAssets(opts, dir) {
  const state = loadState(dir);
  if (!state.variant) throw new Error('Choose a personality first: uikit decide <A-E> --by "<who>".');
  const tokens = tokensOf(state);
  const only = str(opts, 'only') ? str(opts, 'only').split(',').map((s) => s.trim()).filter(Boolean) : null;
  const result = buildAssets(tokens, join(dir, 'assets'), { buttons: !opts['no-buttons'], zones: !opts['no-zones'], only, quality: opts.quality ? Number(opts.quality) : 90 });
  const warnings = result.files.filter((f) => f.warning).map((f) => `${f.file}: ${f.warning}`);
  if (!cwebpAvailable()) warnings.push('cwebp is not installed: images were written as PNG (brew install webp, or apt install webp), then rerun "uikit assets".');
  return { status: warnings.length ? 'warning' : 'ok', dir: result.dir, css: relative(process.cwd(), result.css), manifest: relative(process.cwd(), result.manifest), files: result.count, kilobytes: Math.round(result.bytes / 1024), zones: result.names, warnings, next: 'Link assets/assets.css after tokens.css and components.css. Buttons: add class "<prefix>-btn--skin". Zones: class "<prefix>-zone-<name>".' };
}

function cmdIcons(opts, dir) {
  const name = opts._[1];
  let tokens = null;
  try { tokens = tokensOf(loadState(dir)); } catch { /* no kit yet: default style */ }
  if (!name) return { status: 'ok', count: ICON_NAMES.length, icons: ICON_NAMES, style: tokens ? iconStyleOf(tokens) : 'default (soft)' };
  if (!ICONS[name]) throw new Error(`Unknown icon "${name}". Available: ${ICON_NAMES.join(', ')}`);
  return { status: 'ok', icon: name, svg: iconSvg(name, tokens ? iconStyleOf(tokens) : undefined, { size: Number(str(opts, 'size') ?? 24) }) };
}

function cmdStatus(opts, dir) {
  const state = loadState(dir);
  const files = ['uikit.json', 'variants.html', 'tokens.json', 'tokens.css', 'components.css', 'tokens.vscode.css', 'icons.svg', 'showcase.html', 'assets/assets.css', 'assets/manifest.json'];
  const present = Object.fromEntries(files.map((f) => [f, existsSync(join(dir, f))]));
  let contrast = null;
  let assets = null;
  if (state.variant) contrast = summariseCheck(checkTokens(tokensOf(state)));
  if (present['assets/manifest.json']) { const m = JSON.parse(readFileSync(join(dir, 'assets/manifest.json'), 'utf8')); assets = { files: m.files.length, variant: m.variant, stale: m.variant !== state.variant }; }
  const next = !state.variant ? 'Pick a personality: uikit decide <A-E> --by "<who>".' : !present['tokens.css'] ? 'Build the kit: uikit build.' : !assets ? 'Optional image assets: uikit assets.' : assets.stale ? 'Assets were drawn for another personality: uikit assets.' : 'Up to date.';
  return { status: 'ok', dir, name: state.name, prefix: state.prefix, seed: state.seed, sources: state.sources, variant: state.variant, label: state.variant ? VARIANTS[state.variant].label : null, decision: state.decision, overrides: state.overrides, contrast, assets, files: present, log: state.log.slice(-5), next };
}

export function cmdUikit(opts, { cwd = process.cwd() } = {}) {
  const sub = opts._[0];
  const SUBS = 'init|variants|decide|set|build|check|icons|assets|status|note';
  if (!sub) throw new Error(`Usage: uikit ${SUBS} ...`);
  if (sub === 'icons' && !str(opts, 'dir') && !resolveDesignDir({ cwd })) return cmdIcons(opts, null);
  const dir = kitDir(opts, cwd);
  switch (sub) {
    case 'init': return cmdInit(opts, dir);
    case 'variants': { const state = loadState(dir); return { status: 'ok', dir, written: rel(dir, writeVariants(dir, state, { dark: Boolean(opts.dark) })) }; }
    case 'decide': return cmdDecide(opts, dir);
    case 'set': return cmdSet(opts, dir);
    case 'build': { const { written, check } = buildKit(dir, loadState(dir)); return { status: check.ok ? 'ok' : 'warning', dir, contrast: summariseCheck(check), written: rel(dir, written) }; }
    case 'check': { const state = loadState(dir); if (!state.variant) throw new Error('Choose a personality first: uikit decide <A-E> --by "<who>".'); const check = checkTokens(tokensOf(state)); return { status: check.ok ? 'ok' : 'error', dir, ...summariseCheck(check) }; }
    case 'icons': return cmdIcons(opts, dir);
    case 'assets': return cmdAssets(opts, dir);
    case 'status': return cmdStatus(opts, dir);
    case 'note': {
      const state = loadState(dir);
      const text = str(opts, 'text') ?? opts._.slice(1).join(' ');
      if (!text) throw new Error('Usage: uikit note "<decision or remark>" --by "<who>"');
      state.log.push({ at: now(), by: str(opts, 'by') ?? 'unknown', note: text });
      saveState(dir, state);
      return { status: 'ok', dir, entries: state.log.length };
    }
    default: throw new Error(`Unknown uikit command "${sub}". Use: ${SUBS}`);
  }
}

export { SCALE, ZONE_NAMES, ZONES };
