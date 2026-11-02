import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findConfig, isInside, resolveDesignDir } from '../skills/local-designer/scripts/design-target.mjs';
import { charterFile } from '../skills/local-designer/scripts/charter-lib.mjs';
import { BUNDLED_STYLES_DIR, loadStyles, styleDirs } from '../skills/local-designer/scripts/styles-lib.mjs';
import { buildMoodboard, scenesOf, validateBrief } from '../skills/local-designer/scripts/moodboard-lib.mjs';
import { previewColours, renderMoodboardHtml } from '../skills/local-designer/scripts/moodboard-html.mjs';
import { loadBoard, saveBoard, summary, trialImage, trialPath } from '../skills/local-designer/scripts/moodboard-state.mjs';

const CLI = new URL('../skills/local-designer/scripts/local-designer.mjs', import.meta.url).pathname;
const styles = loadStyles(BUNDLED_STYLES_DIR);
// Real path: on macOS /var is a link to /private/var and a child process reports the real one.
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'local-designer-target-')));

// A project with a design target, as aikido-web uses it.
function project({ git = false } = {}) {
  const root = tmp();
  writeFileSync(join(root, '.local-designer.json'), JSON.stringify({ design_dir: 'design' }));
  mkdirSync(join(root, 'sub', 'deep'), { recursive: true });
  if (git) spawnSync('git', ['init', '-q'], { cwd: root });
  return root;
}
const run = (args, { cwd, env = {} } = {}) => {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8', cwd, env: { ...process.env, HOME: tmp(), LOCAL_DESIGNER_DESIGN_DIR: '', ...env } });
  return { code: r.status, json: JSON.parse(r.stdout || '{}') };
};

const brief = {
  client: 'Aikido', project: 'Site web', language: 'fr',
  message: 'Une méthode calme', audience: 'Pratiquants et curieux', positioning: 'Apprendre par le geste',
  use_cases: ['web banner'], subject: 'a sunlit wooden dojo', format: { ratio: '16:9' }, realism: 'photo',
  textures: ['bois clair'], brand: { palette: ['#1e3a5f', '#c8a24a', '#f4efe6'], fonts: ['Inter'], forbidden: ['text'] },
  scenes: [
    { id: 'hero', label: 'Hero', subject: 'wide dojo interior', ratio: '16:9' },
    { id: 'detail', label: 'Détail', subject: 'close detail of a wooden stand', ratio: '4:3' },
  ],
};

test('the design target comes from the nearest .local-designer.json, relative to that file', () => {
  const root = project();
  const cwd = join(root, 'sub', 'deep');
  assert.equal(findConfig(cwd), join(root, '.local-designer.json'));
  assert.equal(resolveDesignDir({ env: {}, cwd }), join(root, 'design'));
  assert.equal(resolveDesignDir({ env: {}, cwd: tmp() }), null, 'no config above: no target');
});

test('the environment variable beats the config file', () => {
  const root = project();
  const other = tmp();
  assert.equal(resolveDesignDir({ env: { LOCAL_DESIGNER_DESIGN_DIR: other }, cwd: root }), resolve(other));
});

test('a broken config is reported, not silently ignored', () => {
  const root = tmp();
  writeFileSync(join(root, '.local-designer.json'), '{ nope');
  assert.throws(() => resolveDesignDir({ env: {}, cwd: root }), /not valid JSON/);
});

test('isInside is exact about folder boundaries', () => {
  assert.ok(isInside('/a/design/moodboards/x', '/a/design'));
  assert.ok(isInside('/a/design', '/a/design'));
  assert.ok(!isInside('/a/design-old/x', '/a/design'));
  assert.ok(!isInside('/a/other', null));
});

test('the charter lives in the target; --root keeps the former layout; --dir wins', () => {
  const root = project();
  assert.equal(charterFile({ cwd: root, env: {} }), join(root, 'design', 'design-charter.md'));
  assert.equal(charterFile({ root, cwd: root, env: {} }), join(root, 'prompts', 'gen', 'concepts', 'design', 'design-charter.md'));
  assert.equal(charterFile({ dir: join(root, 'x'), cwd: root, env: {} }), join(root, 'x', 'design-charter.md'));
});

test('project styles override the bundled ones and are reported as such', () => {
  const root = project();
  mkdirSync(join(root, 'design', 'styles'), { recursive: true });
  writeFileSync(join(root, 'design', 'styles', 'watercolor.json'), JSON.stringify({ ...styles.watercolor, description: 'project override' }));
  const dirs = styleDirs([], {}, root);
  const idx = (origin) => dirs.findIndex((d) => d.origin === origin);
  assert.ok(idx('project') > idx('bundled'), 'project styles come after the bundled ones, so they win');
  const loaded = loadStyles(dirs);
  assert.equal(loaded.watercolor.description, 'project override');
  assert.equal(loaded.watercolor.origin, 'project');
  assert.notEqual(styles.watercolor.description, 'project override', 'the bundled style is untouched');
  assert.equal(loaded['pixel-art'].origin, 'bundled', 'other styles keep coming from the bundle');
});

test('CLI: a mood board built in a git project lands in the target and is accepted', () => {
  const root = project({ git: true });
  writeFileSync(join(root, 'brief.json'), JSON.stringify(brief));
  const out = run(['moodboard', 'build', '--brief', join(root, 'brief.json'), '--styles', 'watercolor,pixel-art'], { cwd: join(root, 'sub') });
  assert.equal(out.json.status, 'ok', JSON.stringify(out.json));
  assert.ok(out.json.dir.startsWith(join(root, 'design', 'moodboards')), out.json.dir);
  assert.ok(existsSync(join(out.json.dir, 'moodboard.html')));
});

test('CLI: inside git but outside the target is still refused', () => {
  const root = project({ git: true });
  writeFileSync(join(root, 'brief.json'), JSON.stringify(brief));
  const out = run(['moodboard', 'build', '--brief', join(root, 'brief.json'), '--out-dir', join(root, 'elsewhere')], { cwd: root });
  assert.equal(out.json.status, 'error');
  assert.match(out.json.error, /outside the design target/);
});

test('CLI: --design-dir targets a folder without any config file', () => {
  const root = tmp();
  const out = run(['charter', 'check', '--design-dir', join(root, 'design')], { cwd: root });
  assert.equal(out.json.status, 'error');
  assert.ok(out.json.error.includes(join(root, 'design', 'design-charter.md')), out.json.error);
});

test('validateBrief checks the scenes', () => {
  assert.deepEqual(validateBrief(brief), []);
  const errors = validateBrief({ ...brief, scenes: [{ id: 'A b', subject: 'x' }, { id: 'hero' }, { id: 'hero', subject: 'y', ratio: 'wide' }] });
  assert.equal(errors.length, 4, errors.join(' | '));
});

test('scenesOf uses the brief scenes, else three framings of the subject', () => {
  assert.deepEqual(scenesOf(brief).map((s) => s.id), ['hero', 'detail']);
  const fallback = scenesOf({ subject: 'a dojo', language: 'en', format: { ratio: '16:9' } });
  assert.deepEqual(fallback.map((s) => s.id), ['wide', 'detail', 'mood']);
  assert.ok(fallback.every((s) => s.subject.includes('a dojo')));
  assert.deepEqual(scenesOf({}), []);
});

test('each direction carries roles, typography, textures, what it says and what it rules out', () => {
  const board = buildMoodboard(styles, brief, { only: ['watercolor', 'pixel-art', 'cartoon-clean'] });
  assert.deepEqual(board.scenes.map((s) => s.id), ['hero', 'detail']);
  for (const t of board.tracks) {
    assert.ok(t.palette.slice(0, 3).every((c) => c.brand && c.role), 'brand colours first, each with a role');
    assert.equal(t.typography.title.name, 'Inter', 'brand font wins');
    assert.ok(t.textures.includes('bois clair'), 'textures of the brief are kept');
    assert.ok(t.says.length >= 1);
    assert.ok(t.rejects.some((r) => /^Écarte/.test(r)), 'rules out the looks of the other directions');
    assert.ok(t.rejects.some((r) => /Interdit par la marque/.test(r) && r.includes('text')));
  }
  const fonts = buildMoodboard(styles, { ...brief, brand: { ...brief.brand, fonts: [] } }, { only: ['watercolor'] }).tracks[0].typography;
  assert.ok(fonts.title.name && fonts.text.name, 'a proposal is made when the brand has no font');
});

test('the page shows scenes, roles, typography, rejections and a page preview, with no script and no link', () => {
  const board = buildMoodboard(styles, brief, { only: ['watercolor', 'pixel-art'] });
  const dir = tmp();
  const tiny = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
  const images = {};
  for (const t of board.tracks) {
    const file = join(dir, `${t.id}-hero.webp`);
    writeFileSync(file, tiny);
    images[t.id] = { hero: file, detail: null };
  }
  const html = renderMoodboardHtml(board, {}, images);
  for (const s of ['Mises en situation', 'Principale', 'Typographie', 'Ce que cette piste écarte', 'Aperçu de page', 'Pour arbitrer', 'Hero', 'Détail', 'Rendu non généré']) {
    assert.ok(html.includes(s), `missing: ${s}`);
  }
  assert.ok(html.includes('data:image/webp;base64,'), 'images are embedded');
  assert.ok(!/<script/i.test(html) && !/https?:\/\//i.test(html), 'self-contained');
  assert.ok(!html.includes(dir), 'no local path leaks into the page');
});

test('the page preview picks readable colours from the palette', () => {
  const c = previewColours([{ hex: '#1e3a5f', role: 'primary' }, { hex: '#c8a24a', role: 'accent' }, { hex: '#f4efe6', role: 'neutral' }]);
  assert.equal(c.main, '#1e3a5f');
  assert.equal(c.accent, '#c8a24a');
  assert.equal(c.light, '#f4efe6');
  assert.equal(c.onMain, '#f4efe6', 'light text on a dark main colour');
  assert.ok(previewColours([]).light, 'an empty palette still gives colours');
});

test('a saved board never contains an absolute path or a thumbnail', () => {
  const dir = join(tmp(), 'board');
  const board = buildMoodboard(styles, brief, { only: ['watercolor', 'pixel-art'] });
  assert.ok(board.tracks.every((t) => t.thumbnail), 'built with thumbnails');
  saveBoard(dir, { brief, board, html: '<html></html>' });
  const stored = readFileSync(join(dir, 'board.json'), 'utf8');
  assert.ok(!stored.includes('thumbnail'));
  assert.ok(!/"\/(Users|home|tmp|var)\//.test(stored), 'no absolute path');
  assert.deepEqual(loadBoard(dir).board.scenes.map((s) => s.id), ['hero', 'detail']);
});

test('trial files: one per direction and scene, the webp is preferred, the legacy png still read', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'trials'));
  assert.ok(trialPath(dir, 'A', 'hero').endsWith(join('trials', 'A-hero.png')));
  assert.ok(trialPath(dir, 'A').endsWith(join('trials', 'A.png')));
  assert.equal(trialImage(dir, 'A', 'hero'), null);
  writeFileSync(trialPath(dir, 'A', 'hero'), 'png');
  assert.ok(trialImage(dir, 'A', 'hero').endsWith('.png'));
  writeFileSync(trialPath(dir, 'A', 'hero').replace('.png', '.webp'), 'webp');
  assert.ok(trialImage(dir, 'A', 'hero').endsWith('.webp'));
  writeFileSync(trialPath(dir, 'B'), 'legacy');
  assert.ok(trialImage(dir, 'B').endsWith('B.png'));
});

test('summary counts the renders per direction', () => {
  const dir = join(tmp(), 'board');
  const board = buildMoodboard(styles, brief, { only: ['watercolor', 'pixel-art'] });
  saveBoard(dir, { brief, board, html: '' });
  mkdirSync(join(dir, 'trials'), { recursive: true });
  writeFileSync(join(dir, 'trials', 'A-hero.webp'), 'x');
  const s = summary(dir);
  assert.deepEqual(s.scenes, ['hero', 'detail']);
  assert.deepEqual(s.tracks.map((t) => [t.id, t.renders, t.expected]), [['A', 1, 2], ['B', 0, 2]]);
});
