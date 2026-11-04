import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSupported, generateOne } from '../skills/local-designer/scripts/local-designer.mjs';
import {
  DEFAULT_CONNECTOR, OPTIONAL_KEYS, getConnector, listConnectors, registerConnector, resolveConnector, unregisterConnector, validateConnector,
} from '../skills/local-designer/scripts/connectors/index.mjs';
import { connector as drawthing } from '../skills/local-designer/scripts/connectors/drawthing.mjs';
import { PNG_SIGNATURE, isPng, pngSize } from '../skills/local-designer/scripts/png.mjs';
import { applyMigration, planMigration, rewriteText } from '../skills/local-designer/scripts/migrate.mjs';
import { LEGACY_STYLES_DIR, USER_STYLES_DIR, styleDirs } from '../skills/local-designer/scripts/styles-lib.mjs';

// A 1x1 PNG with a valid signature and IHDR, enough for the tool (no engine involved).
const TINY_PNG = Buffer.concat([PNG_SIGNATURE, Buffer.from('0000000D49484452000000010000000108060000001F15C489', 'hex')]);

// An engine that is not Draw Things: it records what it was asked and returns a PNG.
function fakeConnector(id = 'fake', over = {}) {
  const calls = { plan: [], render: 0 };
  const c = {
    id,
    label: 'Fake engine',
    supports: ['model', 'initImage'],
    async detect() { return over.reachable ?? false; },
    async connect() { return { where: 'local', app: {} }; },
    describe: () => ({ where: 'local', current: {} }),
    plan(_session, req) {
      calls.plan.push(req);
      return { mode: 'txt2img', summary: { seed: req.seed, width: req.width }, shown: { prompt: req.prompt }, negative: req.negative ?? '', sidecar: {}, native: req };
    },
    async render() { calls.render += 1; return TINY_PNG; },
    readMetadata: () => null,
    ...over.members,
  };
  return { c, calls };
}

test('the Draw Things connector satisfies the contract', () => {
  assert.deepEqual(validateConnector(drawthing), []);
  assert.equal(getConnector(DEFAULT_CONNECTOR).id, 'drawthing');
  for (const key of drawthing.supports) assert.ok(OPTIONAL_KEYS.includes(key), key);
});

test('validateConnector lists every missing member', () => {
  const errors = validateConnector({ id: 'Bad Id', supports: ['nope'] });
  for (const part of ['id must match', 'label is required', 'unknown key "nope"', 'connect() is required', 'plan() is required', 'render() is required', 'readMetadata() is required']) {
    assert.ok(errors.some((e) => e.includes(part)), part);
  }
  assert.deepEqual(validateConnector(null), ['connector must be an object']);
});

test('registerConnector refuses an invalid connector and getConnector names the available ones', () => {
  assert.throws(() => registerConnector({ id: 'x' }), /Invalid connector x/);
  assert.throws(() => getConnector('comfyui'), /Unknown connector "comfyui"\. Available: drawthing/);
});

test('resolveConnector: explicit choice, environment, then auto', async () => {
  const { c } = fakeConnector('probe-yes', { reachable: true });
  registerConnector(c);
  try {
    assert.equal((await resolveConnector({ connector: 'probe-yes' }, {})).id, 'probe-yes');
    assert.equal((await resolveConnector({}, { LOCAL_DESIGNER_CONNECTOR: 'drawthing' })).id, 'drawthing');
    // auto: the first registered connector that answers wins. The real engines are silenced so the test does not
    // depend on what runs on this machine.
    const silenced = ['drawthing', 'drawthing-grpc'].map((id) => getConnector(id));
    const originals = silenced.map((c) => c.detect);
    silenced.forEach((c) => { c.detect = async () => false; });
    try {
      assert.equal((await resolveConnector({ connector: 'auto' }, {})).id, 'probe-yes');
    } finally {
      silenced.forEach((c, i) => { c.detect = originals[i]; });
    }
  } finally {
    unregisterConnector('probe-yes');
  }
});

test('auto selection probes every engine and falls back to the default when none answers', async () => {
  const probed = [];
  const real = ['drawthing', 'drawthing-grpc'].map((id) => getConnector(id));
  const originals = real.map((c) => c.detect);
  real.forEach((c) => { c.detect = async () => { probed.push(c.id); return false; }; });
  const { c } = fakeConnector('probe-no');
  registerConnector(c);
  try {
    assert.equal((await resolveConnector({ connector: 'auto' }, {})).id, 'drawthing', 'nothing answers: the default gives its usual hint');
    assert.deepEqual(probed, ['drawthing', 'drawthing-grpc']);
  } finally {
    unregisterConnector('probe-no');
    real.forEach((x, i) => { x.detect = originals[i]; });
  }
});

test('the gRPC connector is registered, valid, and the HTTP one stays the default', () => {
  assert.deepEqual(validateConnector(getConnector('drawthing-grpc')), []);
  assert.equal(DEFAULT_CONNECTOR, 'drawthing');
  assert.ok(listConnectors().map((x) => x.id).includes('drawthing-grpc'));
});

test('the default connector cannot be unregistered', () => {
  unregisterConnector('drawthing');
  assert.equal(getConnector('drawthing').id, 'drawthing');
});

test('the Draw Things plan sends only the overrides and maps the generic request', () => {
  const session = { app: { model: 'm.ckpt', width: 512, height: 512, steps: 8, guidance_scale: 4, sampler: 'Euler A', shift: 1, seed_mode: 'Scale Alike' } };
  const plan = drawthing.plan(session, { prompt: 'p', negative: 'n', width: 768, height: 512, seed: 7, steps: 16, guidance: 5, lora: ['a.ckpt:0.5'], set: ['tiled_decoding=true'] });
  assert.equal(plan.mode, 'txt2img');
  assert.equal(plan.native.guidance_scale, 5);
  assert.equal(plan.native.original_width, 768);
  assert.deepEqual(plan.native.loras, [{ file: 'a.ckpt', weight: 0.5 }]);
  assert.equal(plan.native.tiled_decoding, true);
  assert.equal(plan.native.model, undefined, 'unspecified settings come from the app');
  assert.deepEqual(plan.summary, { model: 'm.ckpt', width: 768, height: 512, steps: 16, guidance_scale: 5, seed: 7 });
  assert.equal(plan.negative, 'n');
  assert.equal(plan.sidecar.sampler, 'Euler A');
  assert.equal(drawthing.plan(session, { prompt: 'p', initImage: 'AAA', strength: 0.5 }).mode, 'img2img');
  assert.throws(() => drawthing.plan(session, { prompt: 'p', width: 500 }), /multiple of 64/);
});

test('a request key the connector does not support is an error, not a silent drop', () => {
  const { c } = fakeConnector();
  assert.doesNotThrow(() => assertSupported(c, { model: 'x', out: 'a.png' }));
  assert.throws(() => assertSupported(c, { lora: ['a:1'] }), /--lora is not supported by the "fake" connector/);
  assert.throws(() => assertSupported(c, { 'clip-skip': '2' }), /--clip-skip is not supported/);
});

test('a second engine drives generateOne end to end, including dry-run, sidecar and unsupported flags', async () => {
  const { c, calls } = fakeConnector();
  registerConnector(c);
  const dir = mkdtempSync(join(tmpdir(), 'local-designer-conn-'));
  try {
    const out = join(dir, 'a.png');
    const dry = await generateOne(null, { connector: 'fake', prompt: 'a lighthouse', seed: 3, width: 768, out, 'dry-run': true });
    assert.equal(dry.status, 'dry-run');
    assert.equal(dry.connector, 'fake');
    assert.equal(calls.render, 0);
    assert.equal(existsSync(out), false);

    const res = await generateOne(null, { connector: 'fake', style: 'flat-vector', prompt: 'a lighthouse', seed: 3, out, sidecar: true });
    assert.equal(res.status, 'ok');
    assert.equal(res.connector, 'fake');
    assert.ok(isPng(readFileSync(out)));
    assert.match(calls.plan.at(-1).prompt, /lighthouse/);
    const side = JSON.parse(readFileSync(join(dir, 'a.json'), 'utf8'));
    assert.equal(side.connector, 'fake');
    assert.equal(side.style, 'flat-vector');

    await assert.rejects(generateOne(null, { connector: 'fake', prompt: 'x', out, lora: ['a:1'] }), /not supported by the "fake" connector/);
  } finally {
    unregisterConnector('fake');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('png helpers read the size and refuse non-PNG data', () => {
  assert.deepEqual(pngSize(TINY_PNG), { width: 1, height: 1 });
  assert.equal(pngSize(Buffer.from('not a png at all, really not')), null);
  assert.equal(isPng(Buffer.alloc(3)), false);
});

// --- migration of the data kept under the former name -----------------------

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'local-designer-home-'));
  mkdirSync(join(home, 'drawthing-lab', '01-board'), { recursive: true });
  writeFileSync(join(home, 'drawthing-lab', '01-board', 'board.json'),
    JSON.stringify({ thumb: '/Users/x/repo/aikido-skills/skills/drawthing/styles/thumbs/a.webp', lab: `${home}/drawthing-lab/01-board` }));
  writeFileSync(join(home, 'drawthing-lab', 'keep.png'), TINY_PNG);
  mkdirSync(join(home, '.drawthing', 'styles'), { recursive: true });
  writeFileSync(join(home, '.drawthing', 'styles', 'mine.json'), '{"name":"mine"}');
  return home;
}

test('rewriteText fixes the old absolute paths and nothing else', () => {
  const out = rewriteText('/a/skills/drawthing/x /home/u/drawthing-lab/y /home/u/.drawthing/styles draw things DRAWTHING_URL');
  assert.equal(out, '/a/skills/local-designer/x /home/u/local-designer-lab/y /home/u/.local-designer/styles draw things DRAWTHING_URL');
});

test('planMigration is read only and reports what would change', () => {
  const home = fakeHome();
  try {
    const plan = planMigration(home);
    assert.deepEqual(plan.map((s) => s.to.replace(home, '')), ['/local-designer-lab', '/.local-designer']);
    assert.equal(plan[0].rewrites, 1);
    assert.ok(existsSync(join(home, 'drawthing-lab')) && !existsSync(join(home, 'local-designer-lab')));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('applyMigration moves the folders, rewrites paths in text files and leaves images untouched', () => {
  const home = fakeHome();
  try {
    const done = applyMigration(home);
    assert.ok(done.every((s) => s.moved));
    assert.equal(existsSync(join(home, 'drawthing-lab')), false);
    const board = JSON.parse(readFileSync(join(home, 'local-designer-lab', '01-board', 'board.json'), 'utf8'));
    assert.match(board.thumb, /skills\/local-designer\/styles/);
    assert.equal(board.lab, `${home}/local-designer-lab/01-board`);
    assert.deepEqual(readFileSync(join(home, 'local-designer-lab', 'keep.png')), TINY_PNG);
    assert.ok(existsSync(join(home, '.local-designer', 'styles', 'mine.json')));
    assert.deepEqual(planMigration(home), [], 'nothing left to migrate');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('migration never overwrites an existing destination', () => {
  const home = fakeHome();
  mkdirSync(join(home, 'local-designer-lab'));
  try {
    const done = applyMigration(home);
    const lab = done.find((s) => s.to.endsWith('local-designer-lab'));
    assert.equal(lab.moved, false);
    assert.match(lab.blocked, /already exists/);
    assert.ok(existsSync(join(home, 'drawthing-lab', 'keep.png')), 'source untouched');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('former style folders and variable are still read, with lower priority', () => {
  const dirs = styleDirs([], { DRAWTHING_STYLES: '/old/styles', LOCAL_DESIGNER_STYLES: '/new/styles:/more' });
  const order = dirs.map((d) => d.dir);
  assert.ok(order.indexOf(LEGACY_STYLES_DIR) < order.indexOf(USER_STYLES_DIR), 'former user folder first');
  assert.ok(order.indexOf('/old/styles') < order.indexOf('/new/styles'), 'former variable first');
  assert.deepEqual(order.slice(-3), ['/old/styles', '/new/styles', '/more']);
});
