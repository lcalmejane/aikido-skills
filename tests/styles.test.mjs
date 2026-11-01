import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BUNDLED_STYLES_DIR, CATEGORIES, composeStyles, loadStyles, recommendStyles, renderGallery, saveStyle, thumbFile, tokenize, validateStyle,
} from '../skills/local-designer/scripts/styles-lib.mjs';
import { colourName, dominantColours, describe, fromHex, measure, scanProject, toHex } from '../skills/local-designer/scripts/design-tools.mjs';

const styles = loadStyles(BUNDLED_STYLES_DIR);
const tmp = () => mkdtempSync(join(tmpdir(), 'local-designer-test-'));

test('every bundled style is valid, categorised and brand free', () => {
  assert.ok(Object.keys(styles).length >= 29);
  for (const s of Object.values(styles)) {
    assert.deepEqual(validateStyle(s), [], s.name);
    assert.ok(CATEGORIES.includes(s.category), `${s.name} category`);
    assert.ok(s.tags?.length && s.use_cases?.length && s.look && s.thumb_subject, `${s.name} metadata`);
    assert.doesNotMatch(JSON.stringify(s), /ai-?kido/i, s.name);
  }
});

test('validateStyle reports what is wrong', () => {
  const errors = validateStyle({ name: 'Bad Name', template: 'no placeholder', category: 'nope', tags: 'x' });
  assert.equal(errors.length, 5);
});

test('saveStyle writes ordered JSON and refuses invalid styles', () => {
  const dir = tmp();
  try {
    const file = saveStyle({ template: 'A thing of {subject}.', description: 'd', name: 'mine', category: 'vector' }, dir);
    const back = loadStyles(dir);
    assert.deepEqual(Object.keys(back.mine), ['name', 'description', 'category', 'template']);
    assert.equal(back.mine.dir, dir);
    assert.ok(file.endsWith('mine.json'));
    assert.throws(() => saveStyle({ name: 'x' }, dir), /Invalid style/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('later style folders override earlier ones', () => {
  const dir = tmp();
  try {
    saveStyle({ ...styles.watercolor, description: 'project override' }, dir);
    assert.equal(loadStyles([BUNDLED_STYLES_DIR, dir]).watercolor.description, 'project override');
    assert.equal(loadStyles([dir, BUNDLED_STYLES_DIR]).watercolor.description, styles.watercolor.description);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('composeStyles keeps the base structure and mixes the look', () => {
  const c = composeStyles(styles, ['flat-vector', 'watercolor'], { name: 'soft-vector' });
  assert.equal(c.name, 'soft-vector');
  assert.match(c.template, /^A flat vector illustration/);
  assert.match(c.template, /\{subject\}.*watercolour/);
  assert.deepEqual(c.composed_of, ['flat-vector', 'watercolor']);
  assert.equal(validateStyle(c).length, 0);
  assert.throws(() => composeStyles(styles, ['flat-vector']), /at least two/);
  assert.throws(() => composeStyles(styles, ['flat-vector', 'nope']), /Unknown style "nope"/);
});

test('tokenize understands French business words', () => {
  const t = tokenize('Proposition commerciale pour une équipe d’entreprise');
  for (const w of ['proposal', 'commercial', 'team', 'corporate']) assert.ok(t.includes(w), w);
});

test('recommendStyles ranks sensible styles for a brief', () => {
  const top = (brief, n = 3) => recommendStyles(styles, brief, { limit: n }).results.map((r) => r.name);
  assert.ok(top("schéma d'architecture cloud pour une proposition IT").includes('isometric-flat'));
  assert.ok(top('notice technique avec vue éclatée').includes('exploded-view'));
  assert.ok(top('photo de l’équipe au bureau, entreprise').includes('corporate-workplace'));
  assert.ok(top('portrait dirigeant', 2).includes('corporate-portrait'));
  const onlyPhoto = recommendStyles(styles, 'entreprise', { limit: 20, category: 'photo' }).results;
  assert.ok(onlyPhoto.every((r) => r.category === 'photo'));
});

test('renderGallery lists every category that has styles', () => {
  const md = renderGallery(styles);
  for (const c of ['photo', 'vector', 'cartoon', 'drawing', 'technical']) assert.match(md, new RegExp(`## ${c}`));
  assert.match(md, /corporate-memphis/);
});

test('colour helpers', () => {
  assert.equal(toHex([255, 0, 128]), '#ff0080');
  assert.deepEqual(fromHex('#fff'), [255, 255, 255]);
  assert.equal(colourName([250, 250, 250]), 'white');
  assert.equal(colourName([30, 45, 105]), 'navy blue');
});

function solid(w, h, rgb) {
  const data = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i += 1) data.set(rgb, i * 3);
  return { width: w, height: h, data };
}

test('measure and describe: a white page is high-key and minimal, a dark page is low-key', () => {
  const white = measure(solid(32, 32, [255, 255, 255]));
  assert.equal(white.white_ratio, 1);
  assert.ok(describe(white).includes('high-key, mostly white or very light background'));
  assert.ok(describe(white).includes('minimal, lots of empty space'));
  const dark = measure(solid(32, 32, [5, 5, 12]));
  assert.ok(describe(dark).includes('dark, low-key lighting'));
});

test('dominantColours merges close shades and reports shares', () => {
  const half = Buffer.alloc(32 * 32 * 3);
  for (let i = 0; i < 32 * 32; i += 1) half.set(i < 512 ? [200, 30, 30] : [20, 40, 120], i * 3);
  const palette = dominantColours(half, 3);
  assert.equal(palette.length, 2);
  assert.ok(Math.abs(palette[0].share - 0.5) < 0.01);
});

test('scanProject reads package, README and style sheets, skips secrets and node_modules', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'acme-shop', description: 'Online shop for outdoor products', keywords: ['ecommerce', 'product'] }));
    writeFileSync(join(dir, 'README.md'), '# Acme\nCatalogue of products for hikers.');
    writeFileSync(join(dir, '.env'), 'TOKEN=#aa11bb');
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'x', 'theme.css'), 'a{color:#123456}');
    writeFileSync(join(dir, 'main.css'), ':root{--brand:#e4572e;--brand2:#e4572e;--bg:#ffffff;} body{font-family:"Inter",sans-serif}');
    const r = scanProject(dir, styles);
    assert.equal(r.name, 'acme-shop');
    assert.deepEqual(r.brand_palette.map((c) => c.hex), ['#e4572e']);
    assert.deepEqual(r.fonts, ['Inter']);
    assert.ok(!JSON.stringify(r).includes('123456') && !JSON.stringify(r).includes('aa11bb'));
    assert.ok(r.recommended.some((s) => s.name === 'product-studio'));
    assert.throws(() => scanProject(join(dir, 'missing'), styles), /Not a directory/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: styles validate, recommend and compose run without the Draw Things server', () => {
  const cli = new URL('../skills/local-designer/scripts/local-designer.mjs', import.meta.url).pathname;
  const run = (...args) => JSON.parse(spawnSync('node', [cli, ...args], { encoding: 'utf8', env: { ...process.env, HOME: tmp() } }).stdout);
  assert.equal(run('styles', 'validate').problems.length, 0);
  assert.equal(run('recommend', '--brief', 'blueprint ingénierie').results[0].name, 'technical-blueprint');
  assert.equal(run('styles', 'compose', 'flat-vector', 'riso-duotone').style.name, 'flat-vector-x-riso-duotone');
  assert.match(run('styles', 'nope').error, /Unknown style/);
  assert.equal(run('styles', 'watercolor').style.name, 'watercolor');
});

test('thumbFile points next to the style', () => {
  assert.ok(thumbFile(styles['flat-vector']).endsWith('styles/thumbs/flat-vector.webp'));
});
