import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BUNDLED_STYLES_DIR, loadStyles } from '../skills/local-designer/scripts/styles-lib.mjs';
import { buildMoodboard } from '../skills/local-designer/scripts/moodboard-lib.mjs';
import { decide, saveBoard } from '../skills/local-designer/scripts/moodboard-state.mjs';
import {
  auditColours, buildCharter, charterFile, deltaE, findProjectRoot, loadCharter, outOfSync, parseCharter, registerInIndexes, renderCharter,
  saveCharter, touch, validateCharter, withStyle,
} from '../skills/local-designer/scripts/charter-lib.mjs';
import { generateFromCharter } from '../skills/local-designer/scripts/local-designer.mjs';
import { PNG_SIGNATURE } from '../skills/local-designer/scripts/png.mjs';
import { registerConnector, unregisterConnector } from '../skills/local-designer/scripts/connectors/index.mjs';

const CLI = new URL('../skills/local-designer/scripts/local-designer.mjs', import.meta.url).pathname;
const styles = loadStyles(BUNDLED_STYLES_DIR);
const tmp = (name = 'charter') => mkdtempSync(join(tmpdir(), `local-designer-${name}-`));
const cli = (args, cwd) => {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8', cwd });
  return { code: r.status, json: JSON.parse(r.stdout || '{}') };
};

const brief = {
  client: 'Acme Industrie', project: 'Proposition infogérance', language: 'fr',
  message: 'Une infrastructure cloud fiable', audience: 'Directeurs informatiques de PME',
  use_cases: ['proposition commerciale', 'schéma d’architecture'], subject: 'a cloud connected to servers', format: { ratio: '16:9' },
  realism: 'illustrated', keywords: ['cloud', 'sérieux'], brand: { palette: ['#0b3d91', '#f28c28', '#ffffff'], fonts: ['Inter'], forbidden: ['robots'] },
};
const track = { id: 'A', style: 'isometric-line', category: 'technical', description: 'Isometric line art', negative: 'photo, text' };

function project() {
  const root = tmp('proj');
  mkdirSync(join(root, 'prompts', 'gen', 'concepts'), { recursive: true });
  writeFileSync(join(root, 'prompts', 'gen', 'concepts', 'index.md'), '# Concepts\n\n## Available Files\n\n- [`a.md`](a.md): A\n');
  return root;
}

test('colour distance sees what the eye sees', () => {
  assert.ok(deltaE([11, 61, 145], [12, 62, 146]) < 2, 'nearly identical blues');
  assert.ok(deltaE([11, 61, 145], [242, 140, 40]) > 60, 'blue vs orange');
});

test('a charter without a style is a draft; with a validated direction it is active', () => {
  const draft = buildCharter({ brief });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.style, null);
  assert.equal(draft.validated_by, null);
  const active = buildCharter({ brief, track, by: 'Mme Martin' });
  assert.equal(active.status, 'active');
  assert.equal(active.validated_by, 'Mme Martin');
  assert.equal(active.style.name, 'isometric-line');
  assert.deepEqual(validateCharter(active, styles).errors, []);
});

test('palette roles: neutrals are recognised, then primary and accent', () => {
  const c = buildCharter({ brief });
  assert.deepEqual(c.brand.palette.map((p) => p.role), ['primary', 'accent', 'neutral']);
  assert.deepEqual(c.brand.forbidden, ['robots']);
});

test('the scan fills in what the brief does not give', () => {
  const scan = { name: 'acme-portal', brand_palette: [{ hex: '#0b3d91' }], fonts: ['Inter'], keywords: ['cloud'], recommended: [{ name: 'flat-vector', category: 'vector', score: 3 }] };
  const c = buildCharter({ scan });
  assert.equal(c.project, 'acme-portal');
  assert.equal(c.brand.palette[0].hex, '#0b3d91');
  assert.deepEqual(c.brand.fonts, ['Inter']);
  assert.equal(c.style_candidates[0].name, 'flat-vector');
  assert.equal(c.sources.scan, true);
});

test('validateCharter reports every problem and warns about drafts', () => {
  const bad = { project: '', status: 'maybe', format: { ratio: 'wide' }, brand: { palette: [{ hex: 'blue', role: 'boss' }] } };
  const { errors } = validateCharter(bad, styles);
  for (const part of ['project is required', 'status must be one of', 'format.ratio', 'must be a hex', 'role "boss"']) assert.ok(errors.some((e) => e.includes(part)), part);
  const noValidator = { ...buildCharter({ brief, track }), validated_by: null };
  assert.ok(validateCharter(noValidator, styles).errors.some((e) => e.includes('validated_by')));
  assert.ok(validateCharter(buildCharter({ brief }), styles).warnings.some((w) => w.includes('draft')));
  assert.ok(validateCharter({ ...buildCharter({ brief, track }), style: { name: 'nope' } }, styles).warnings.some((w) => w.includes('not in the style library')));
});

test('withStyle merges the style negative with what the brand forbids, without duplicates', () => {
  const c = withStyle(buildCharter({ brief }), { name: 'x', negative: 'photo, robots, text', category: 'technical' });
  assert.equal(c.style.negative, 'photo, robots, text');
  assert.equal(withStyle(buildCharter({ brief }), { name: 'x', negative: 'photo' }).style.negative, 'photo, robots');
});

test('markdown round trip: the JSON block is the source, the free notes are kept', () => {
  const c = touch(buildCharter({ brief, track, by: 'Luc' }), { by: 'Luc', note: 'un `commentaire` avec | barre' });
  const text = renderCharter(c).replace('Free notes.', 'Mes notes perso.');
  const back = parseCharter(text);
  assert.deepEqual(back.charter, c);
  assert.match(back.tail, /Mes notes perso\./);
  assert.match(text, /^> \*\*Version\*\*: 1\.2 \| \*\*Date\*\*: \d{4}-\d{2}-\d{2} \| \*\*Statut\*\*: Active$/m);
  assert.equal(outOfSync({ region: back.region, charter: back.charter }), false);
  assert.throws(() => parseCharter('# nothing here'), /markers/);
  assert.throws(() => parseCharter('<!-- design-charter:begin -->\nx\n<!-- design-charter:end -->'), /no ```json block/);
});

test('a hand edit of the text is detected as out of sync', () => {
  const c = buildCharter({ brief, track, by: 'Luc' });
  const edited = renderCharter(c).replace('navy blue', 'NAVY');
  const parsed = parseCharter(edited);
  assert.equal(outOfSync({ region: parsed.region, charter: parsed.charter }), true);
});

test('the charter never contains an absolute path or an image', () => {
  const text = renderCharter(buildCharter({ brief, track, by: 'Luc', moodboard: '/Users/x/local-designer-lab/2026-moodboard-acme' }));
  assert.ok(!text.includes('/Users/') && !text.includes('local-designer-lab'));
  assert.match(text, /2026-moodboard-acme/);
  assert.ok(!/\.(png|webp|jpe?g)/i.test(text));
});

test('findProjectRoot and charterFile locate prompts/gen from a sub folder', () => {
  const root = project();
  try {
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    assert.equal(findProjectRoot(join(root, 'src', 'deep')), root);
    assert.equal(charterFile({ cwd: join(root, 'src') }), join(root, 'prompts', 'gen', 'concepts', 'design', 'design-charter.md'));
    assert.equal(charterFile({ dir: join(root, 'x') }), join(root, 'x', 'design-charter.md'));
    assert.equal(findProjectRoot(tmpdir()) === null || typeof findProjectRoot(tmpdir()) === 'string', true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('saveCharter keeps the free notes and registerInIndexes is idempotent', () => {
  const root = project();
  try {
    const file = charterFile({ root });
    saveCharter(file, buildCharter({ brief }));
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, `${text}Mes notes perso\n`);
    const loaded = loadCharter(file);
    saveCharter(file, touch(loaded.charter, { by: 'Luc', note: 'n' }));
    assert.match(readFileSync(file, 'utf8'), /Mes notes perso/);
    assert.equal(registerInIndexes(file).length, 2);
    assert.deepEqual(registerInIndexes(file), []);
    const parent = readFileSync(join(root, 'prompts', 'gen', 'concepts', 'index.md'), 'utf8');
    assert.equal(parent.split('\n').filter((l) => l.includes('design/index.md')).length, 1, 'one line, added once');
    assert.ok(existsSync(join(root, 'prompts', 'gen', 'concepts', 'design', 'index.md')));
    assert.throws(() => loadCharter(join(root, 'missing.md')), /No design charter/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('auditColours: on-brand, off-brand, partial and no palette', () => {
  const charter = buildCharter({ brief, track, by: 'Luc' });
  const onBrand = auditColours([{ hex: '#0c3e92', name: 'navy', share: 0.5 }, { hex: '#f08a28', name: 'orange', share: 0.2 }, { hex: '#fafafa', name: 'white', share: 0.3 }], charter);
  assert.equal(onBrand.verdict, 'on-brand');
  assert.equal(onBrand.score, 1);
  const off = auditColours([{ hex: '#2e8b57', name: 'green', share: 0.6 }, { hex: '#ffffff', name: 'white', share: 0.4 }], charter);
  assert.equal(off.verdict, 'off-brand');
  assert.equal(off.off_brand[0].hex, '#2e8b57');
  const partial = auditColours([{ hex: '#0b3d91', name: 'navy', share: 0.7 }, { hex: '#eeeeee', name: 'grey', share: 0.3 }], charter);
  assert.equal(partial.verdict, 'partial');
  assert.equal(auditColours([{ hex: '#000000', share: 1 }], { brand: { palette: [] } }).verdict, 'no-palette');
});

// --- CLI on a throw-away project --------------------------------------------

test('CLI: scan draft, activation needs a validator, then the charter is active', () => {
  const root = project();
  try {
    writeFileSync(join(root, 'package.json'), '{"name":"acme-portal","keywords":["cloud"]}');
    writeFileSync(join(root, 'style.css'), 'body{color:#0b3d91;font-family:"Inter",sans-serif} a{color:#f28c28}');
    const dry = cli(['charter', 'init', '--scan', '--dry-run', '--root', root]);
    assert.equal(dry.json.status, 'dry-run');
    assert.equal(existsSync(charterFile({ root })), false, 'dry run writes nothing');

    const init = cli(['charter', 'init', '--scan', '--root', root]);
    assert.equal(init.json.state, 'draft');
    assert.equal(init.json.indexes_updated.length, 2);
    assert.equal(cli(['charter', 'init', '--scan', '--root', root]).code, 1, 'refuses to overwrite');

    assert.match(cli(['charter', 'activate', '--style', 'flat-vector', '--root', root]).json.error, /--by/);
    assert.match(cli(['charter', 'activate', '--style', 'nope', '--by', 'Luc', '--root', root]).json.error, /Unknown style/);
    const act = cli(['charter', 'activate', '--style', 'flat-vector', '--by', 'Luc', '--root', root]);
    assert.equal(act.json.state, 'active');
    assert.equal(act.json.revision, 2);

    const note = cli(['charter', 'note', 'Plus', 'd’orange', '--by', 'Luc', '--root', root]);
    assert.equal(note.json.revision, 3);
    const show = cli(['charter', 'show', '--root', root]).json;
    assert.equal(show.charter.decisions.length, 3);
    assert.equal(show.out_of_sync, false);
    assert.equal(cli(['charter', 'check', '--root', root]).json.status, 'ok');

    const forced = cli(['charter', 'init', '--scan', '--force', '--root', root]).json;
    assert.equal(forced.revision, 4, 'rebuild bumps the revision');
    assert.equal(cli(['charter', 'show', '--root', root]).json.charter.decisions.length, 4, 'the decision log is kept');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI: init from a validated mood board, and refusal when nothing is validated', () => {
  const root = project();
  const board = tmp('board');
  try {
    saveBoard(board, { brief, board: buildMoodboard(styles, brief, { only: ['isometric-line', 'watercolor'] }) });
    assert.match(cli(['charter', 'init', '--moodboard', board, '--root', root]).json.error, /No validated direction/);
    decide(board, { track: 'A', state: 'validated', by: 'Mme Martin' });
    const init = cli(['charter', 'init', '--moodboard', board, '--root', root]).json;
    assert.equal(init.state, 'active');
    assert.equal(init.style, 'isometric-line');
    const charter = cli(['charter', 'show', '--root', root]).json.charter;
    assert.equal(charter.validated_by, 'Mme Martin');
    assert.equal(charter.project, 'Proposition infogérance');
    assert.ok(!readFileSync(charterFile({ root }), 'utf8').includes(board), 'the mood board path is not stored');
    assert.equal(cli(['charter', 'init', '--root', root, '--force']).code, 1, 'no source given');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(board, { recursive: true, force: true });
  }
});

test('CLI: outside a project the charter commands explain what to do', () => {
  const out = tmp('outside');
  try {
    const r = cli(['charter', 'show'], out);
    assert.equal(r.code, 1);
    assert.match(r.json.error, /No prompts\/gen folder/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('CLI: audit reads a folder, reports an unreadable file and summarises', () => {
  const root = project();
  const imgs = tmp('imgs');
  try {
    cli(['charter', 'init', '--brief', join(root, 'brief.json'), '--root', root]);
    writeFileSync(join(root, 'brief.json'), JSON.stringify(brief));
    assert.equal(cli(['charter', 'init', '--brief', join(root, 'brief.json'), '--root', root]).json.state, 'draft');
    writeFileSync(join(imgs, 'broken.png'), Buffer.concat([PNG_SIGNATURE, Buffer.from('garbage')]));
    const r = cli(['charter', 'audit', imgs, '--root', root]);
    assert.equal(r.json.status, 'ok');
    assert.equal(r.json.summary.images, 1);
    assert.equal(r.json.summary.unreadable, 1);
    assert.equal(r.json.images[0].verdict, 'unreadable');
    assert.match(cli(['charter', 'audit', '--root', root]).json.error, /Usage/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(imgs, { recursive: true, force: true });
  }
});

// --- the lock on generation ---------------------------------------------------

function fakeEngine() {
  const seen = [];
  return {
    seen,
    connector: {
      id: 'fake-charter', label: 'Fake', supports: [],
      detect: async () => false,
      connect: async () => ({ where: 'local', app: {} }),
      describe: () => ({ where: 'local', current: {} }),
      plan(_s, req) { seen.push(req); return { mode: 'txt2img', summary: { width: req.width, height: req.height }, shown: { prompt: req.prompt }, negative: req.negative ?? '', sidecar: {}, native: req }; },
      render: async () => Buffer.alloc(0),
      readMetadata: () => null,
    },
  };
}

test('generate --charter is locked on a draft and uses the style, negative and format of an active charter', async () => {
  const root = project();
  const { seen, connector } = fakeEngine();
  registerConnector(connector);
  try {
    const file = charterFile({ root });
    saveCharter(file, buildCharter({ brief }));
    const base = { root, connector: 'fake-charter', prompt: 'a cloud connected to servers', out: join(root, 'a.png'), 'dry-run': true };
    await assert.rejects(generateFromCharter({ ...base, charter: true }), /is not active/);
    assert.equal(seen.length, 0, 'nothing was planned while locked');

    saveCharter(file, buildCharter({ brief, track: { ...track }, by: 'Mme Martin' }));
    await assert.rejects(generateFromCharter({ ...base, charter: true, prompt: undefined }), /--prompt/);
    const r = await generateFromCharter({ ...base, charter: true });
    assert.equal(r.status, 'dry-run');
    assert.equal(r.charter.style, 'isometric-line');
    assert.equal(r.charter.validated_by, 'Mme Martin');
    assert.equal(seen[0].width, 1024);
    assert.equal(seen[0].height, 576);
    assert.equal(seen[0].negative, 'photo, text');
    assert.match(seen[0].prompt, /cloud connected to servers/);

    const own = await generateFromCharter({ ...base, charter: true, width: '768', height: '512', negative: 'custom' });
    assert.equal(own.charter.revision, 1);
    assert.equal(seen[1].width, '768');
    assert.equal(seen[1].negative, 'custom');
  } finally {
    unregisterConnector('fake-charter');
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: --charter and --moodboard cannot be combined', () => {
  const r = cli(['generate', '--charter', '--moodboard', '/tmp/x', '--prompt', 'x', '--out', '/tmp/x.png', '--dry-run']);
  assert.equal(r.code, 1);
  assert.match(r.json.error, /Choose one lock/);
});
