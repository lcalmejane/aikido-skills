import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { contrast, ensureContrast, fillFor, hexOk, mix, onColor } from '../skills/local-designer/scripts/uikit-color.mjs';
import {
  applySet, buildTokens, checkTokens, extractCssSeed, resolveParams, seedFrom, validateSeed, validateTokens, VARIANTS, variantIds,
} from '../skills/local-designer/scripts/uikit-lib.mjs';
import { componentsCss, tokensCss, vscodeBridgeCss } from '../skills/local-designer/scripts/uikit-css.mjs';
import { ICON_NAMES, iconSvg, iconStyleOf, spriteSvg } from '../skills/local-designer/scripts/uikit-icons.mjs';
import { showcaseHtml, variantsHtml } from '../skills/local-designer/scripts/uikit-html.mjs';
import { ZONE_NAMES } from '../skills/local-designer/scripts/uikit-assets.mjs';

const CLI = new URL('../skills/local-designer/scripts/local-designer.mjs', import.meta.url).pathname;
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'local-designer-uikit-')));
const run = (args, { cwd, env = {} } = {}) => {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8', cwd, env: { ...process.env, HOME: tmp(), LOCAL_DESIGNER_DESIGN_DIR: '', ...env } });
  return { code: r.status, json: JSON.parse(r.stdout || '{}') };
};
const seed = { primary: '#0e386e', accent: '#b85c38', neutral: '#f6efe0', prefers: 'light', fonts: [] };

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

test('contrast follows WCAG: black on white is 21, identical colours are 1', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#336699', '#336699'), 1);
  assert.ok(hexOk('#abc') && hexOk('#a1b2c3') && !hexOk('abc') && !hexOk('#abcd') && !hexOk(null));
});

test('ensureContrast moves a colour until the minimum is reached, in both directions', () => {
  const onLight = ensureContrast('#9aa0b5', '#ffffff', 4.5);
  assert.ok(contrast(onLight, '#ffffff') >= 4.5);
  const onDark = ensureContrast('#3a4060', '#101218', 4.5);
  assert.ok(contrast(onDark, '#101218') >= 4.5);
  assert.equal(ensureContrast('#000000', '#ffffff', 4.5), '#000000', 'already enough: unchanged');
});

test('fillFor returns a fill whose readable label reaches 4.5:1, even for yellow', () => {
  for (const base of ['#ffd400', '#0e386e', '#b85c38', '#777777', '#ffffff', '#000000']) {
    const { fill, on } = fillFor(base);
    assert.ok(contrast(on, fill) >= 4.5, `${base} -> ${fill} / ${on}`);
  }
  assert.ok(['#ffffff', '#0b0d14'].includes(onColor('#222222')) || hexOk(onColor('#222222')));
  assert.ok(hexOk(mix('#000000', '#ffffff', 0.5)));
});

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

test('seedFrom: explicit colours win over a stylesheet, the charter, the brief, then defaults; sources say which', () => {
  const css = extractCssSeed(':root { --primary: #112233; --accent-2: #445566; --bg: #101010; --radius: 6px; } h1 { font-family: "Lora", serif; }');
  assert.equal(css.primary, '#112233');
  assert.equal(css.prefers, 'dark');
  assert.equal(css.radius, 6);
  assert.deepEqual(css.fonts, ['Lora']);

  const charter = { brand: { palette: [{ hex: '#aa0000', role: 'primary' }, { hex: '#00aa00', role: 'accent' }], fonts: ['Inter'] } };
  const brief = { brand: { palette: ['#0000aa', '#aaaa00'] } };
  assert.equal(seedFrom({ colors: { primary: '#ABCDEF' }, css, charter, brief }).seed.primary, '#abcdef');
  assert.equal(seedFrom({ css, charter, brief }).seed.primary, '#112233');
  const fromCharter = seedFrom({ charter, brief });
  assert.equal(fromCharter.seed.primary, '#aa0000');
  assert.equal(fromCharter.seed.accent, '#00aa00');
  assert.deepEqual(fromCharter.seed.fonts, ['Inter']);
  assert.ok(fromCharter.sources.includes('primary:charter'));
  assert.equal(seedFrom({ brief }).seed.primary, '#0000aa');
  const empty = seedFrom({});
  assert.ok(empty.sources.includes('primary:default') && hexOk(empty.seed.primary));
});

test('validateSeed rejects non-hex colours and an unknown preferred mode', () => {
  assert.deepEqual(validateSeed(seed), []);
  assert.equal(validateSeed({ ...seed, primary: 'blue' }).length, 1);
  assert.equal(validateSeed({ ...seed, neutral: 'x' }).length, 1);
  assert.equal(validateSeed({ ...seed, prefers: 'auto' }).length, 1);
});

// ---------------------------------------------------------------------------
// Tokens and accessibility
// ---------------------------------------------------------------------------

test('every personality produces valid tokens that pass WCAG in light and dark', () => {
  const seeds = [seed, { primary: '#ffd400', accent: '#00b3ff', neutral: null, prefers: 'light', fonts: [] }, { primary: '#7a5cff', accent: '#ff5c8a', neutral: null, prefers: 'dark', fonts: ['Inter'] }];
  for (const s of seeds) for (const id of variantIds()) {
    const tokens = buildTokens({ seed: s, variant: id });
    assert.deepEqual(validateTokens(tokens), [], `${id} ${s.primary}`);
    const check = checkTokens(tokens);
    assert.ok(check.ok, `${id} ${s.primary}: ${JSON.stringify(check.failures)}`);
    assert.ok(check.total >= 60, 'both modes are checked');
  }
});

test('buildTokens is deterministic and derives the type scale from the ratio', () => {
  const a = buildTokens({ seed, variant: 'B' });
  const b = buildTokens({ seed, variant: 'B' });
  assert.deepEqual(a, b);
  const sizes = Object.values(a.font.scale).map((s) => s.size);
  assert.deepEqual(sizes, [...sizes].sort((x, y) => x - y), 'the scale grows');
  assert.equal(a.font.scale.base.size, 16);
  assert.equal(a.radius.pill, 999);
  assert.throws(() => buildTokens({ seed, variant: 'Z' }), /Unknown variant/);
  assert.throws(() => buildTokens({ seed: { ...seed, primary: 'red' }, variant: 'A' }), /hex colour/);
});

test('the five personalities really differ, and an override replaces the variant value', () => {
  assert.deepEqual(variantIds(), ['A', 'B', 'C', 'D', 'E']);
  const radii = new Set(variantIds().map((id) => resolveParams(id).radius));
  assert.ok(radii.size >= 3, 'radius is a real difference between personalities');
  assert.equal(resolveParams('A', { radius: 3 }).radius, 3);
  assert.equal(resolveParams('A', {}).radius, VARIANTS.A.radius);
  assert.equal(buildTokens({ seed, variant: 'A', overrides: { radius: 3 } }).radius.md, 3);
});

test('a font from the seed leads the stack, with system fonts as fallback', () => {
  const tokens = buildTokens({ seed: { ...seed, fonts: ['Lora'] }, variant: 'A' });
  assert.match(tokens.font.sans, /^"Lora", system-ui/);
  assert.ok(!buildTokens({ seed, variant: 'A' }).font.sans.includes('"Lora"'));
});

test('applySet updates the seed or the overrides and refuses what it does not know', () => {
  const base = buildTokens({ seed, variant: 'A' });
  const r = applySet(base, ['primary=#112233', 'radius=6', 'uppercase=true', 'fonts=Lora, Inter', 'neutral=none', 'icon_stroke=2']);
  assert.equal(r.seed.primary, '#112233');
  assert.equal(r.seed.neutral, null);
  assert.deepEqual(r.seed.fonts, ['Lora', 'Inter']);
  assert.deepEqual(r.overrides, { radius: 6, uppercase: true, icon_stroke: 2 });
  assert.throws(() => applySet(base, ['radius=big']), /must be a number/);
  assert.throws(() => applySet(base, ['icon_stroke=9']), /between 0 and 4/);
  assert.throws(() => applySet(base, ['colour=red']), /Unknown setting/);
  assert.throws(() => applySet(base, ['radius']), /key=value/);
});

// ---------------------------------------------------------------------------
// Generated files
// ---------------------------------------------------------------------------

test('tokens.css defines both modes, the automatic one and data-theme overrides, with the configured prefix', () => {
  const tokens = buildTokens({ seed, variant: 'A', prefix: 'aw' });
  const css = tokensCss(tokens);
  assert.match(css, /--aw-primary:/);
  assert.match(css, /--aw-space-4:/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /\[data-theme="dark"\]/);
  assert.match(css, /\[data-theme="light"\]/);
  assert.ok(!/--ui-/.test(css));
  const dark = tokensCss(buildTokens({ seed: { ...seed, prefers: 'dark' }, variant: 'A' }));
  assert.match(dark, /:root \{\s*color-scheme: dark/);
});

test('components.css follows the prefix and has no leftover default prefix', () => {
  const css = componentsCss(buildTokens({ seed, variant: 'C', prefix: 'aw' }));
  assert.match(css, /\.aw-btn/);
  assert.match(css, /var\(--aw-primary\)/);
  assert.ok(!/\.ui-btn/.test(css) && !/--ui-/.test(css));
  assert.match(componentsCss(buildTokens({ seed, variant: 'C' })), /\.ui-btn/);
});

test('the VS Code bridge reads --vscode-* first and falls back on the kit value', () => {
  const css = vscodeBridgeCss(buildTokens({ seed, variant: 'A' }));
  assert.match(css, /--ui-bg: var\(--vscode-editor-background, #[0-9a-f]{6}\)/);
  assert.match(css, /--vscode-font-family/);
});

test('icons: every icon is a closed SVG, the stroke follows the personality and can be overridden', () => {
  assert.ok(ICON_NAMES.length >= 60);
  for (const name of ICON_NAMES) {
    const svg = iconSvg(name);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 24 24"/, name);
    assert.ok(svg.endsWith('</svg>'), name);
    assert.match(svg, /aria-hidden="true"/);
  }
  assert.match(iconSvg('check', undefined, { label: 'Valid' }), /role="img" aria-label="Valid"/);
  assert.throws(() => iconSvg('nope'), /Unknown icon/);
  const a = buildTokens({ seed, variant: 'A' });
  const e = buildTokens({ seed, variant: 'E' });
  assert.notEqual(iconStyleOf(a).cap, iconStyleOf(e).cap);
  assert.equal(iconStyleOf(buildTokens({ seed, variant: 'A', overrides: { icon_stroke: 3 } })).stroke, 3);
  assert.equal((spriteSvg(a).match(/<symbol /g) ?? []).length, ICON_NAMES.length);
});

test('showcase.html and variants.html are self-contained pages that show every personality and both modes', () => {
  const page = showcaseHtml(buildTokens({ seed, variant: 'B', name: 'demo' }));
  assert.match(page, /^<!doctype html>/i);
  assert.match(page, /data-theme="light"/);
  assert.match(page, /data-theme="dark"/);
  assert.match(page, /uikit build/);
  const variants = variantsHtml(seed, { name: 'demo', decided: 'C' });
  for (const id of variantIds()) assert.ok(variants.includes(`Variante ${id}`) || variants.includes(VARIANTS[id].label), id);
  assert.equal((variants.match(/<iframe/g) ?? []).length, 5, 'one isolated frame per personality');
  // The pages are embedded in srcdoc, so their markup is escaped.
  assert.match(variantsHtml(seed, { dark: true }), /data-theme=(&quot;|")dark/);
  assert.match(variantsHtml(seed), /data-theme=(&quot;|")light/);
});

// ---------------------------------------------------------------------------
// CLI, end to end
// ---------------------------------------------------------------------------

function project() {
  const root = tmp();
  writeFileSync(join(root, '.local-designer.json'), JSON.stringify({ design_dir: 'design' }));
  return root;
}

test('CLI: init -> decide -> set -> build -> check -> status, with the kit inside the design folder', () => {
  const root = project();
  const init = run(['uikit', 'init', '--primary', '#0e386e', '--accent', '#b85c38', '--name', 'demo', '--no-charter'], { cwd: root });
  assert.equal(init.json.status, 'ok', JSON.stringify(init.json));
  const kit = join(root, 'design', 'uikit');
  assert.ok(existsSync(join(kit, 'uikit.json')) && existsSync(join(kit, 'variants.html')) && existsSync(join(kit, 'index.md')));
  assert.ok(!existsSync(join(kit, 'tokens.css')), 'nothing is built before a personality is chosen');

  assert.equal(run(['uikit', 'build'], { cwd: root }).json.status, 'error', 'build needs a decision');
  assert.match(run(['uikit', 'decide', 'C'], { cwd: root }).json.error, /--by/);
  assert.match(run(['uikit', 'decide', 'Q', '--by', 'L'], { cwd: root }).json.error, /Usage/);

  const decide = run(['uikit', 'decide', 'c', '--by', 'Laurent'], { cwd: root });
  assert.equal(decide.json.status, 'ok', JSON.stringify(decide.json));
  assert.equal(decide.json.variant, 'C');
  assert.equal(decide.json.contrast.ok, true);
  for (const f of ['tokens.json', 'tokens.css', 'components.css', 'tokens.vscode.css', 'icons.svg', 'showcase.html']) assert.ok(existsSync(join(kit, f)), f);
  const state = JSON.parse(readFileSync(join(kit, 'uikit.json'), 'utf8'));
  assert.equal(state.decision.by, 'Laurent');
  assert.equal(state.variant, 'C');

  const set = run(['uikit', 'set', 'radius=6', 'icon_stroke=2', '--by', 'Laurent'], { cwd: root });
  assert.equal(set.json.status, 'ok', JSON.stringify(set.json));
  assert.equal(JSON.parse(readFileSync(join(kit, 'tokens.json'), 'utf8')).radius.md, 6, 'the build follows the change');
  assert.match(readFileSync(join(kit, 'icons.svg'), 'utf8'), /stroke-width="2"/);
  assert.equal(run(['uikit', 'set', 'colour=red'], { cwd: root }).json.status, 'error');

  assert.equal(run(['uikit', 'check'], { cwd: root }).json.ok, true);
  const status = run(['uikit', 'status'], { cwd: root }).json;
  assert.equal(status.variant, 'C');
  assert.equal(status.files['tokens.css'], true);
  assert.equal(status.assets, null);
  assert.match(status.next, /assets/);
  assert.ok(status.log.length >= 3);
});

test('CLI: building twice leaves the files unchanged (idempotent)', () => {
  const root = project();
  run(['uikit', 'init', '--primary', '#0e386e', '--accent', '#b85c38', '--no-charter'], { cwd: root });
  run(['uikit', 'decide', 'A', '--by', 'L'], { cwd: root });
  const again = run(['uikit', 'build'], { cwd: root }).json;
  assert.equal(again.status, 'ok');
  assert.ok(again.written.every((w) => w.changed === false), JSON.stringify(again.written.filter((w) => w.changed)));
});

test('CLI: init refuses to overwrite a kit unless --force, which keeps the decision log', () => {
  const root = project();
  run(['uikit', 'init', '--primary', '#0e386e', '--accent', '#b85c38', '--no-charter'], { cwd: root });
  run(['uikit', 'note', 'Palette validée avec le client', '--by', 'Laurent'], { cwd: root });
  assert.match(run(['uikit', 'init', '--primary', '#111111', '--accent', '#eeeeee', '--no-charter'], { cwd: root }).json.error, /--force/);
  const forced = run(['uikit', 'init', '--force', '--primary', '#111111', '--accent', '#eeeeee', '--no-charter'], { cwd: root });
  assert.equal(forced.json.status, 'ok');
  const state = JSON.parse(readFileSync(join(root, 'design', 'uikit', 'uikit.json'), 'utf8'));
  assert.equal(state.seed.primary, '#111111');
  assert.equal(state.variant, null, 'the personality has to be chosen again');
  assert.ok(state.log.some((l) => l.note.includes('Palette validée')), 'the log survives');
});

test('CLI: init takes its colours from the charter, then from a stylesheet', () => {
  const root = project();
  mkdirSync(join(root, 'design'), { recursive: true });
  const css = join(root, 'site.css');
  writeFileSync(css, ':root { --primary: #123456; --accent-2: #654321; --bg: #fafafa; }');
  const fromCss = run(['uikit', 'init', '--css', css, '--no-charter'], { cwd: root }).json;
  assert.equal(fromCss.seed.primary, '#123456');
  assert.ok(fromCss.sources.includes('primary:css'));
  const explicit = run(['uikit', 'init', '--force', '--css', css, '--primary', '#abcdef', '--no-charter'], { cwd: root }).json;
  assert.equal(explicit.seed.primary, '#abcdef', 'an explicit colour wins over the stylesheet');
});

test('CLI: no design folder means a clear error, except for the icon list which needs none', () => {
  const root = tmp();
  assert.match(run(['uikit', 'status'], { cwd: root }).json.error, /No design folder/);
  const icons = run(['uikit', 'icons'], { cwd: root }).json;
  assert.equal(icons.status, 'ok');
  assert.ok(icons.count >= 60);
  assert.match(run(['uikit', 'icons', 'check'], { cwd: root }).json.svg, /^<svg /);
  assert.equal(run(['uikit', 'icons', 'nope'], { cwd: root }).json.status, 'error');
  assert.match(run(['uikit', 'frobnicate', '--dir', join(root, 'k')], { cwd: root }).json.error, /Unknown uikit command|No UI kit/);
});

test('CLI: --dir and --design-dir place the kit where asked', () => {
  const root = tmp();
  const dir = join(root, 'elsewhere');
  assert.equal(run(['uikit', 'init', '--dir', dir, '--primary', '#0e386e', '--accent', '#b85c38', '--no-charter'], { cwd: root }).json.status, 'ok');
  assert.ok(existsSync(join(dir, 'uikit.json')));
  const viaTarget = run(['uikit', 'init', '--design-dir', join(root, 'dz'), '--primary', '#0e386e', '--accent', '#b85c38', '--no-charter'], { cwd: root });
  assert.equal(viaTarget.json.status, 'ok', JSON.stringify(viaTarget.json));
  assert.ok(existsSync(join(root, 'dz', 'uikit', 'uikit.json')));
});

test('CLI: assets draws webp (or png when cwebp is missing) and a stylesheet that references every file', () => {
  const root = project();
  run(['uikit', 'init', '--primary', '#0e386e', '--accent', '#b85c38', '--no-charter'], { cwd: root });
  assert.match(run(['uikit', 'assets'], { cwd: root }).json.error, /personality/);
  run(['uikit', 'decide', 'C', '--by', 'L'], { cwd: root });
  assert.match(run(['uikit', 'assets', '--only', 'nowhere'], { cwd: root }).json.error, /Unknown zone/);

  const result = run(['uikit', 'assets', '--only', 'hero'], { cwd: root });
  assert.ok(['ok', 'warning'].includes(result.json.status), JSON.stringify(result.json));
  assert.equal(result.json.files, 24 + 2, '4 kinds x 3 states x 2 modes + 1 zone x 2 modes');
  const assets = join(root, 'design', 'uikit', 'assets');
  const css = readFileSync(join(assets, 'assets.css'), 'utf8');
  const manifest = JSON.parse(readFileSync(join(assets, 'manifest.json'), 'utf8'));
  assert.equal(manifest.variant, 'C');
  for (const f of manifest.files) {
    assert.ok(existsSync(join(assets, f.file)), f.file);
    assert.ok(css.includes(f.file), `assets.css references ${f.file}`);
    if (f.type === 'button') assert.ok(f.contrast >= 4.5, `${f.file} label contrast ${f.contrast}`);
  }
  assert.match(css, /ui-btn--skin/);
  assert.match(css, /ui-zone-hero/);
  assert.ok(!css.includes('ui-zone-panel'), '--only keeps the other zones out');
  assert.ok(readdirSync(join(assets, 'buttons')).length === 24);

  const status = run(['uikit', 'status'], { cwd: root }).json;
  assert.equal(status.assets.stale, false);
  run(['uikit', 'decide', 'A', '--by', 'L'], { cwd: root });
  assert.equal(run(['uikit', 'status'], { cwd: root }).json.assets.stale, true, 'assets drawn for another personality are flagged');
});

test('every status colour exports hover and pressed fills that keep its label readable (dark mode included)', () => {
  for (const id of variantIds()) for (const s of [seed, { ...seed, prefers: 'dark' }]) {
    const t = buildTokens({ seed: s, variant: id });
    for (const mode of ['light', 'dark']) for (const status of ['danger', 'success', 'warning', 'info']) {
      const c = t.modes[mode];
      for (const state of ['', '-hover', '-active']) {
        assert.ok(c[`${status}${state}`], `${id} ${mode} ${status}${state} exists`);
        assert.ok(contrast(c[`on-${status}`], c[`${status}${state}`]) >= 4.5, `${id} ${mode} on-${status} on ${status}${state}`);
      }
    }
  }
  const css = componentsCss(buildTokens({ seed, variant: 'A' }));
  assert.match(css, /--_hover: var\(--ui-danger-hover\)/);
  assert.ok(!/danger\), #000/.test(css), 'no blind darkening of the danger button');
});

test('zones: a closed list, each one documented', () => {
  assert.ok(ZONE_NAMES.includes('hero') && ZONE_NAMES.includes('panel'));
  assert.ok(ZONE_NAMES.length >= 4);
});

// ---------------------------------------------------------------------------
// The palette that is given is the palette that is used, and the link stays visible
// ---------------------------------------------------------------------------

const PALETTE = [
  { hex: '#0e386e', role: 'primary', name: 'navy' }, { hex: '#b85c38', role: 'accent', name: 'terracotta' },
  { hex: '#c9a57b', role: 'secondary' }, { hex: '#f8dbb2', role: 'secondary' }, { hex: '#a8b89a', role: 'secondary' },
  { hex: '#e9b8b8', role: 'secondary' }, { hex: '#3d4e6b', role: 'secondary' }, { hex: '#727058', role: 'secondary' },
  { hex: '#f6efe0', role: 'neutral' }, { hex: '#111524', role: 'neutral' },
];

test('palette: neutrals and secondaries are used as given, and every token says where it comes from', () => {
  const { seed: s } = seedFrom({ charter: { brand: { palette: PALETTE, fonts: [] } } });
  assert.equal(s.neutral, '#f6efe0');
  assert.equal(s.ink, '#111524');
  assert.equal(s.palette.length, PALETTE.length);
  const t = buildTokens({ seed: s, variant: 'A' });
  assert.equal(t.modes.light.bg, '#f6efe0');
  assert.equal(t.modes.light.text, '#111524');
  assert.equal(t.modes.dark.bg, '#111524');
  assert.equal(t.modes.dark.text, '#f6efe0');
  assert.equal(t.modes.light.primary, '#0e386e');
  assert.equal(t.modes.light.accent, '#b85c38');
  const palette = new Set(PALETTE.map((c) => c.hex));
  for (const mode of ['light', 'dark']) {
    assert.deepEqual(Object.keys(t.trace[mode]).sort(), Object.keys(t.modes[mode]).filter((k) => !k.startsWith('shadow')).sort(), `${mode}: one trace per colour`);
    for (const [token, tr] of Object.entries(t.trace[mode])) {
      assert.equal(tr.to, t.modes[mode][token].toLowerCase(), `${mode}.${token} arrival matches the token`);
      assert.ok(['palette', 'adjusted', 'mixed', 'derived', 'generated'].includes(tr.how), `${mode}.${token}: ${tr.how}`);
      for (const from of tr.from) assert.ok(palette.has(from) || /^#[0-9a-f]{6}$/.test(from), `${mode}.${token} starts from ${from}`);
      if (tr.how === 'palette') assert.ok(palette.has(tr.to), `${mode}.${token} is "palette" so ${tr.to} must be in the palette`);
      if (tr.how === 'adjusted') assert.ok(tr.why, `${mode}.${token} was moved: it must say why`);
    }
  }
  // At least the borders and the muted text come from the palette itself, not from a computed grey.
  assert.ok(palette.has(t.modes.light.border) && palette.has(t.modes.light['text-muted']) && palette.has(t.modes.dark['text-muted']));
  assert.ok(checkTokens(t).ok);
});

test('palette: a colour moved for contrast is reported as adjusted, with the original as its starting point', () => {
  const { seed: s } = seedFrom({ charter: { brand: { palette: PALETTE, fonts: [] } } });
  const t = buildTokens({ seed: s, variant: 'A' });
  const dark = t.trace.dark.primary;
  assert.equal(dark.how, 'adjusted');
  assert.deepEqual(dark.from, ['#0e386e']);
  assert.notEqual(dark.to, '#0e386e');
  assert.match(dark.why, /sombre/);
});

test('palette: the review pages show the palette and the start -> arrival link', () => {
  const { seed: s } = seedFrom({ charter: { brand: { palette: PALETTE, fonts: [] } } });
  const html = showcaseHtml(buildTokens({ seed: s, variant: 'A', name: 'demo' }));
  assert.match(html, /Palette fournie et couleurs du kit/);
  for (const c of PALETTE) assert.ok(html.includes(c.hex), `${c.hex} is displayed`);
  assert.match(html, /départ \(palette\)/);
  assert.match(html, /ajustée/);
  assert.match(variantsHtml(s, { name: 'demo' }), /Palette fournie et couleurs du kit/);
});

test('palette: without a palette the kit still builds and says the colours are generated', () => {
  const t = buildTokens({ seed: { primary: '#3b5bdb', accent: '#0ca678', neutral: null, ink: null, palette: [], prefers: 'light', fonts: [] }, variant: 'A' });
  assert.ok(checkTokens(t).ok);
  assert.equal(t.trace.light.bg.how, 'generated');
});
