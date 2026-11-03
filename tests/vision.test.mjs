import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  DEFAULT_CHECKS, assertAllowed, askVision, checksFromBrief, listVisionModels, loadVisionConfig, parseJsonReply, pinVision,
  reviewPrompt, stripThinking, summariseReview, visionStatus,
} from '../skills/local-designer/scripts/vision-lib.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../skills/local-designer/scripts/local-designer.mjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// Stand-in for an OpenAI-compatible server (LM Studio, Ollama /v1...). Records every chat request.
async function fakeServer({ models, reply = 'a white robot', status = 200 } = {}) {
  const chats = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: models.map(({ id }) => ({ id })) }));
      if (req.url === '/api/v0/models') return res.end(JSON.stringify({ data: models }));
      if (req.url === '/v1/chat/completions') {
        chats.push(JSON.parse(body));
        res.statusCode = status;
        return res.end(JSON.stringify(status === 200
          ? { model: chats.at(-1).model, choices: [{ message: { content: reply } }], usage: { total_tokens: 42 } }
          : { error: 'boom' }));
      }
      res.statusCode = 404;
      return res.end('{}');
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { chats, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise((ok) => server.close(ok)) };
}

const MODELS = [
  { id: 'vl-model', type: 'vlm', state: 'loaded' },
  { id: 'text-model', type: 'llm', state: 'not-loaded' },
];

function project(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'local-designer-vision-test-'));
  writeFileSync(join(dir, 'img.png'), PNG);
  const done = () => rmSync(dir, { recursive: true, force: true });
  return Promise.resolve(fn(dir)).finally(done);
}

test('the pinned model is read from .local-designer.json, and the environment overrides it', () => project((dir) => {
  writeFileSync(join(dir, '.local-designer.json'), JSON.stringify({ design_dir: 'design', vision: { url: 'http://127.0.0.1:9/v1/', model: 'vl-model' } }));
  const cfg = loadVisionConfig({ env: {}, cwd: dir });
  assert.equal(cfg.model, 'vl-model');
  assert.equal(cfg.url, 'http://127.0.0.1:9/v1');
  assert.equal(loadVisionConfig({ env: { LOCAL_DESIGNER_VISION_MODEL: 'other' }, cwd: dir }).model, 'other');
  // an exported but empty variable must not hide the pinned model
  assert.equal(loadVisionConfig({ env: { LOCAL_DESIGNER_VISION_MODEL: '', LOCAL_DESIGNER_VISION_URL: '' }, cwd: dir }).model, 'vl-model');
  assert.equal(loadVisionConfig({ env: {}, cwd: mkdtempSync(join(tmpdir(), 'ld-empty-')) }).model, undefined);
}));

test('pin keeps the other keys of the config and never writes an absolute path', () => project((dir) => {
  writeFileSync(join(dir, '.local-designer.json'), JSON.stringify({ design_dir: 'design' }));
  const { vision } = pinVision({ model: 'vl-model', url: 'http://127.0.0.1:1234/v1', cwd: dir });
  assert.deepEqual(vision, { url: 'http://127.0.0.1:1234/v1', model: 'vl-model' });
  const saved = JSON.parse(readFileSync(join(dir, '.local-designer.json'), 'utf8'));
  assert.equal(saved.design_dir, 'design');
  assert.ok(!JSON.stringify(saved).includes(dir));
  assert.throws(() => pinVision({ cwd: dir }), /--model/);
}));

test('an image never goes to a server outside this machine without --allow-remote', async () => {
  const remote = { url: 'http://192.168.1.20:1234/v1', model: 'vl-model' };
  assert.throws(() => assertAllowed(remote), /leave it|allow-remote/);
  assert.doesNotThrow(() => assertAllowed(remote, { allowRemote: true }));
  assert.doesNotThrow(() => assertAllowed({ url: 'http://localhost:1234/v1' }));
  await assert.rejects(askVision(remote, { images: ['x.png'], prompt: 'q' }), /allow-remote/);
});

test('vision models tells which ones read images', async () => {
  const srv = await fakeServer({ models: MODELS });
  try {
    const list = await listVisionModels({ url: srv.url });
    assert.deepEqual(list.map((m) => [m.id, m.type]), [['vl-model', 'vlm'], ['text-model', 'llm']]);
  } finally { await srv.close(); }
});

test('status distinguishes not pinned, missing, text-only, unreachable and ok', async () => {
  const srv = await fakeServer({ models: MODELS });
  try {
    assert.equal((await visionStatus({ url: srv.url })).status, 'not-pinned');
    assert.equal((await visionStatus({ url: srv.url, model: 'gone' })).status, 'model-missing');
    assert.equal((await visionStatus({ url: srv.url, model: 'text-model' })).status, 'not-a-vision-model');
    const ok = await visionStatus({ url: srv.url, model: 'vl-model' });
    assert.equal(ok.status, 'ok');
    assert.equal(ok.local, true);
  } finally { await srv.close(); }
  assert.equal((await visionStatus({ url: 'http://127.0.0.1:1/v1', model: 'vl-model' })).status, 'unreachable');
});

test('ask sends the pinned model, the image as a data URL and a deterministic request', async () => project(async (dir) => {
  const srv = await fakeServer({ models: MODELS, reply: '<think>hmm</think>Un robot blanc.' });
  try {
    const out = await askVision({ url: srv.url, model: 'vl-model' }, { images: [join(dir, 'img.png')], prompt: 'Que vois-tu ?' });
    assert.equal(out.answer, 'Un robot blanc.');
    assert.equal(out.local, true);
    const sent = srv.chats[0];
    assert.equal(sent.model, 'vl-model');
    assert.equal(sent.temperature, 0);
    assert.equal(sent.seed, 42);
    const parts = sent.messages[1].content;
    assert.equal(parts[0].text, 'Que vois-tu ?');
    assert.match(parts[1].image_url.url, /^data:image\/(png|jpeg);base64,/);
  } finally { await srv.close(); }
}));

test('without a local model nothing is asked, no model is picked, and the message points to the current model', async () => project(async (dir) => {
  const srv = await fakeServer({ models: MODELS });
  try {
    await assert.rejects(askVision({ url: srv.url }, { images: [join(dir, 'img.png')], prompt: 'q' }), /No local vision model is set.*current model reads/s);
    assert.equal(srv.chats.length, 0);
    const status = await visionStatus({ url: srv.url });
    assert.equal(status.status, 'not-pinned');
    assert.match(status.next, /Normal state/);
  } finally { await srv.close(); }
}));

test('a refused request is an error: no other local model is tried, the current model reads instead', async () => project(async (dir) => {
  const srv = await fakeServer({ models: MODELS, status: 500 });
  try {
    await assert.rejects(askVision({ url: srv.url, model: 'vl-model' }, { images: [join(dir, 'img.png')], prompt: 'q' }), /current model reads the image instead/);
    assert.equal(srv.chats.length, 1);
    assert.deepEqual(srv.chats.map((c) => c.model), ['vl-model']);
  } finally { await srv.close(); }
}));

test('ask checks its input: image count, missing file, empty question', async () => project(async (dir) => {
  const cfg = { url: 'http://127.0.0.1:1/v1', model: 'vl-model' };
  const img = join(dir, 'img.png');
  await assert.rejects(askVision(cfg, { images: [], prompt: 'q' }), /at least one image/);
  await assert.rejects(askVision(cfg, { images: [img, img, img, img, img], prompt: 'q' }), /At most 4/);
  await assert.rejects(askVision(cfg, { images: [img], prompt: '' }), /question/);
  await assert.rejects(askVision(cfg, { images: [join(dir, 'nope.png')], prompt: 'q' }), /not found/);
}));

test('JSON is read from a fenced block, a sentence around it, or a reasoning prefix', () => {
  assert.deepEqual(parseJsonReply('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonReply('Voici : {"a":2} voilà'), { a: 2 });
  assert.deepEqual(parseJsonReply('<think>{"a":0}</think>{"a":3}'), { a: 3 });
  assert.equal(parseJsonReply('pas de json'), null);
  assert.equal(stripThinking('<think>x</think>\n ok '), 'ok');
});

test('a review is ok only when every check passes; an unclear one must be looked at', () => {
  const checks = ['no text', 'three fingers'];
  const reply = (a, b) => JSON.stringify({ summary: 's', checks: [{ n: 1, result: a, evidence: 'e1' }, { n: 2, result: b, evidence: 'e2' }], problems: [], text_in_image: 'none' });
  assert.equal(summariseReview(checks, reply('pass', 'pass')).verdict, 'ok');
  assert.equal(summariseReview(checks, reply('pass', 'unclear')).verdict, 'to-check');
  assert.equal(summariseReview(checks, reply('pass', 'fail')).verdict, 'fail');
  assert.equal(summariseReview(checks, reply('maybe', 'pass')).verdict, 'to-check');
  const bad = summariseReview(checks, 'je ne sais pas');
  assert.equal(bad.verdict, 'unparsed');
  assert.match(bad.raw, /je ne sais pas/);
});

test('checks come from the brief: subject, forbidden list, constraints, then the standard ones', () => {
  const checks = checksFromBrief({ subject: 'a robot', brand: { forbidden: ['text', 'logo'] }, constraints: ['one character only'] });
  assert.deepEqual(checks, ['The image shows: a robot', 'The image does not show: text', 'The image does not show: logo', 'one character only']);
  const prompt = reviewPrompt([...checks, ...DEFAULT_CHECKS], { context: 'test' });
  assert.match(prompt, /1\. The image shows: a robot/);
  assert.match(prompt, /JSON only/);
});

// The CLI runs in a child process: the stand-in server lives in this one, so the child must not block the event loop.
function runCli(args, { cwd, env }) {
  return new Promise((ok) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (code) => ok({ code, json: JSON.parse(out) }));
  });
}

test('CLI: pin refuses a text-only model, then pins a vision one; review reads the checklist', async () => project(async (dir) => {
  const reply = JSON.stringify({ summary: 'robot', checks: DEFAULT_CHECKS.map((_, i) => ({ n: i + 1, result: 'pass', evidence: 'ok' })), problems: [], text_in_image: 'none' });
  const srv = await fakeServer({ models: MODELS, reply });
  const env = { LOCAL_DESIGNER_VISION_URL: srv.url, LOCAL_DESIGNER_VISION_MODEL: '' };
  try {
    const text = await runCli(['vision', 'pin', '--model', 'text-model'], { cwd: dir, env });
    assert.equal(text.code, 1);
    assert.match(text.json.error, /text-only/);
    const pinned = await runCli(['vision', 'pin', '--model', 'vl-model'], { cwd: dir, env });
    assert.equal(pinned.json.status, 'ok');
    assert.equal(JSON.parse(readFileSync(join(dir, '.local-designer.json'), 'utf8')).vision.model, 'vl-model');
    const status = await runCli(['vision', 'status'], { cwd: dir, env });
    assert.equal(status.json.status, 'ok');
    const review = await runCli(['vision', 'review', join(dir, 'img.png')], { cwd: dir, env });
    assert.equal(review.json.summary.ok, 1);
    assert.equal(review.json.results[0].verdict, 'ok');
    assert.equal(srv.chats.at(-1).model, 'vl-model');
  } finally { await srv.close(); }
}));

test('CLI: checks prints the checklist of a brief for any reader, without a server or a local model', async () => project(async (dir) => {
  const brief = join(dir, 'brief.json');
  writeFileSync(brief, JSON.stringify({ project: 'demo', subject: 'a small robot', brand: { forbidden: ['text'] }, constraints: ['one character only'] }));
  const env = { LOCAL_DESIGNER_VISION_URL: 'http://127.0.0.1:9', LOCAL_DESIGNER_VISION_MODEL: '' };
  const out = await runCli(['vision', 'checks', '--brief', brief], { cwd: dir, env });
  assert.equal(out.code, 0);
  assert.equal(out.json.checks[0], 'The image shows: a small robot');
  assert.ok(out.json.checks.includes('The image does not show: text'));
  assert.ok(out.json.checks.includes('one character only'));
  assert.ok(DEFAULT_CHECKS.every((c) => out.json.checks.includes(c)));
  assert.match(out.json.prompt, /Reply with JSON only/);
}));
