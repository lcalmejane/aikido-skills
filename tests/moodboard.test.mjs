import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BUNDLED_STYLES_DIR, loadStyles } from '../skills/local-designer/scripts/styles-lib.mjs';
import { BRIEF_TEMPLATE, buildMoodboard, pickStyles, trackNegative, validateBrief } from '../skills/local-designer/scripts/moodboard-lib.mjs';
import { renderMoodboardHtml } from '../skills/local-designer/scripts/moodboard-html.mjs';
import { decide, loadBoard, saveBoard, summary, validatedTrack } from '../skills/local-designer/scripts/moodboard-state.mjs';
import { sizeFromRatio } from '../skills/local-designer/scripts/local-designer.mjs';

const CLI = new URL('../skills/local-designer/scripts/local-designer.mjs', import.meta.url).pathname;
const styles = loadStyles(BUNDLED_STYLES_DIR);
const tmp = () => mkdtempSync(join(tmpdir(), 'local-designer-mb-'));

const brief = {
  client: 'Acme Industrie', project: 'Proposition infogérance', language: 'fr',
  message: 'Une infrastructure cloud fiable', audience: 'Directeurs informatiques de PME',
  use_cases: ['proposition commerciale', 'présentation', 'schéma d’architecture'],
  subject: 'a cloud connected to servers and a factory', format: { ratio: '16:9' }, realism: 'illustrated',
  keywords: ['cloud', 'sérieux', 'entreprise'], brand: { palette: ['#0b3d91', '#f28c28'], forbidden: ['robots'] },
};

const cli = (...args) => {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status, json: JSON.parse(r.stdout || '{}') };
};

test('validateBrief accepts a full brief and lists every problem', () => {
  assert.deepEqual(validateBrief(brief), []);
  const errors = validateBrief({ language: 'de', realism: 'abstract', use_cases: [], format: { ratio: 'wide' }, brand: { palette: ['blue'] } });
  assert.equal(errors.length, 8);
  assert.ok(validateBrief(BRIEF_TEMPLATE).length > 0 || BRIEF_TEMPLATE.client === '');
});

test('buildMoodboard proposes varied directions with a brand-first palette', () => {
  const board = buildMoodboard(styles, brief, { count: 3 });
  assert.deepEqual(board.tracks.map((t) => t.id), ['A', 'B', 'C']);
  assert.equal(new Set(board.tracks.map((t) => t.category)).size, 3, 'one direction per category');
  for (const t of board.tracks) {
    assert.deepEqual(t.palette.slice(0, 2).map((c) => c.hex), ['#0b3d91', '#f28c28']);
    assert.ok(t.thumbnail && existsSync(t.thumbnail));
    assert.ok(t.sample_prompts[0].prompt.includes(brief.subject));
    assert.match(t.negative, /robots/);
  }
});

test('texts follow the brief language', () => {
  const fr = buildMoodboard(styles, brief, { only: ['cartoon-clean'] }).tracks[0];
  const en = buildMoodboard(styles, { ...brief, language: 'en' }, { only: ['cartoon-clean'] }).tracks[0];
  assert.match(fr.risks[0], /Visages/);
  assert.match(en.risks[0], /Faces/);
  assert.match(fr.donts[0], /^À éviter/);
});

test('--styles forces the directions and rejects unknown names', () => {
  const board = buildMoodboard(styles, brief, { only: ['watercolor', 'pixel-art'] });
  assert.deepEqual(board.tracks.map((t) => t.style), ['watercolor', 'pixel-art']);
  assert.throws(() => pickStyles(styles, brief, { only: ['nope'] }), /Unknown style/);
  assert.throws(() => buildMoodboard(styles, { ...brief, message: '' }), /Invalid brief/);
});

test('trackNegative merges the style negative and the client forbidden list without duplicates', () => {
  const out = trackNegative({ negative: 'text, logo' }, { brand: { forbidden: ['logo', 'robots'] } });
  assert.equal(out, 'text, logo, robots');
});

test('html page is self-contained, escapes the brief and shows the state', () => {
  const board = buildMoodboard(styles, { ...brief, project: '<script>alert(1)</script>' });
  const html = renderMoodboardHtml({ brief: { ...brief, project: '<script>alert(1)</script>' }, tracks: board.tracks }, { validated: 'B', tracks: { B: { state: 'validated', comments: [{ by: 'Client', at: '2026-11-01T10:00:00Z', text: 'OK <b>' }] } } });
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /data:image\/webp;base64,/);
  assert.match(html, /Piste validée : B/);
  assert.match(html, /OK &lt;b&gt;/);
  assert.match(html, /illustré/);
});

test('decision keeps a single validated direction and a history', () => {
  const dir = tmp();
  const board = buildMoodboard(styles, brief);
  saveBoard(dir, { brief, board });
  assert.throws(() => validatedTrack(dir), /No validated direction/);
  decide(dir, { track: 'B', state: 'validated', by: 'Client' });
  assert.equal(validatedTrack(dir).track.id, 'B');
  const d = decide(dir, { track: 'A', state: 'validated', by: 'Client', comment: 'Finalement celle-ci' });
  assert.equal(d.validated, 'A');
  assert.equal(d.tracks.B.state, 'selected');
  assert.equal(d.tracks.A.comments.length, 1);
  decide(dir, { track: 'A', state: 'rejected', by: 'Client' });
  assert.throws(() => validatedTrack(dir), /No validated direction/);
  assert.ok(loadBoard(dir).decision.history.length >= 4);
  assert.throws(() => decide(dir, { track: 'Z', state: 'selected' }), /Unknown direction/);
  assert.throws(() => decide(dir, { track: 'A', state: 'done' }), /state must be/);
  assert.throws(() => decide(dir, { track: 'A' }), /--state and\/or --comment/);
  assert.deepEqual(summary(dir).tracks.map((t) => t.state), ['rejected', 'selected', 'proposed']);
});

test('a rebuild does not erase the client decisions', () => {
  const dir = tmp();
  const board = buildMoodboard(styles, brief);
  saveBoard(dir, { brief, board });
  decide(dir, { track: 'C', state: 'rejected', comment: 'Trop enfantin' });
  saveBoard(dir, { brief, board });
  assert.equal(loadBoard(dir).decision.tracks.C.state, 'rejected');
});

test('sizeFromRatio gives multiples of 64 on the long side', () => {
  assert.deepEqual(sizeFromRatio('16:9', 1024), { width: 1024, height: 576 });
  assert.deepEqual(sizeFromRatio('9:16', 1024), { width: 576, height: 1024 });
  assert.deepEqual(sizeFromRatio('1:1', 512), { width: 512, height: 512 });
  assert.throws(() => sizeFromRatio('wide'), /Invalid ratio/);
});

test('CLI: build, lock, decide, locked dry-run, protection against overwrite and git', (t) => {
  const root = tmp();
  const briefFile = join(root, 'brief.json');
  writeFileSync(briefFile, JSON.stringify(brief));
  const dir = join(root, 'board');

  assert.equal(cli('brief', 'check', briefFile).json.status, 'ok');
  const built = cli('moodboard', 'build', '--brief', briefFile, '--out-dir', dir);
  assert.equal(built.json.status, 'ok');
  assert.ok(existsSync(join(dir, 'moodboard.html')));

  const locked = cli('generate', '--moodboard', dir, '--out', join(root, 'x.png'), '--dry-run');
  assert.equal(locked.code, 1);
  assert.match(locked.json.error, /No validated direction/);

  assert.equal(cli('moodboard', 'decide', dir, '--track', 'a', '--state', 'validated', '--by', 'Client').json.validated, 'A');
  const ok = cli('generate', '--moodboard', dir, '--out', join(root, 'x.png'), '--dry-run');
  if (/not reachable/.test(ok.json.error ?? '')) {
    // The lock passed (the error comes from the engine, not from the mood board): only the engine-dependent checks are skipped.
    t.diagnostic('Draw Things API not reachable: dry-run request checks skipped (covered in-process by charter.test.mjs with a fake engine)');
  } else {
    assert.equal(ok.json.status, 'dry-run');
    assert.equal(ok.json.moodboard.direction, 'A');
    assert.equal(ok.json.summary.width, 1024);
    assert.equal(ok.json.summary.height, 576);
    assert.match(ok.json.request.negative_prompt, /robots/);
    assert.ok(ok.json.prompt.includes(brief.subject));
  }
  assert.match(readFileSync(join(dir, 'moodboard.html'), 'utf8'), /Piste validée : A/);

  const again = cli('moodboard', 'build', '--brief', briefFile, '--out-dir', dir);
  assert.equal(again.code, 1);
  assert.match(again.json.error, /already holds a mood board/);
  assert.equal(cli('moodboard', 'build', '--brief', briefFile, '--out-dir', dir, '--force').json.status, 'ok');
  assert.equal(cli('moodboard', 'status', dir).json.validated, null);

  const inRepo = cli('moodboard', 'build', '--brief', briefFile, '--out-dir', join(new URL('..', import.meta.url).pathname, 'tmp-moodboard'));
  assert.equal(inRepo.code, 1);
  assert.match(inRepo.json.error, /inside a git repository/);
});
