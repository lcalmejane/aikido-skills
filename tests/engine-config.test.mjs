import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { engineOptions, loadEngineConfig } from '../skills/local-designer/scripts/engine-config.mjs';
import { discoverEngines, setupEngine } from '../skills/local-designer/scripts/engine-setup.mjs';
import { encodePng } from '../skills/local-designer/scripts/png.mjs';

async function project(fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'local-designer-engine-'));
  try { await fn(cwd); } finally { rmSync(cwd, { recursive: true, force: true }); }
}

const engine = { connector: 'drawthing-grpc', grpc: '127.0.0.1:8123', model: 'qwen.ckpt' };
const write = (cwd, config) => writeFileSync(join(cwd, '.local-designer.json'), JSON.stringify(config));
const fakeConnect = async (id, opts) => id === 'drawthing-grpc'
  ? { target: opts.grpc, where: 'local', models: [{ file: 'qwen.ckpt' }], loras: [], controlNets: [] }
  : { url: opts.url, where: 'local', app: { model: 'qwen.ckpt' } };

test('engine configuration is found from children and preserves design and vision keys', () => project(async (cwd) => {
  write(cwd, { design_dir: 'design', vision: { model: 'reader' }, engine });
  mkdirSync(join(cwd, 'child'));
  const resolved = engineOptions({}, { cwd: join(cwd, 'child'), env: {} });
  assert.equal(resolved.connector, 'drawthing-grpc');
  assert.equal(resolved.grpc, '127.0.0.1:8123');
  assert.equal(resolved.model, 'qwen.ckpt');
  await setupEngine({}, { cwd, env: {}, connect: fakeConnect });
  const saved = JSON.parse(readFileSync(join(cwd, '.local-designer.json')));
  assert.equal(saved.design_dir, 'design');
  assert.deepEqual(saved.vision, { model: 'reader' });
  assert.equal(saved.engine.grpc, engine.grpc);
  assert.ok(saved.engine.verified_at);
}));

test('CLI overrides environment, which overrides project settings; changing engines does not leak model defaults', () => project((cwd) => {
  write(cwd, { engine });
  const env = { LOCAL_DESIGNER_CONNECTOR: 'drawthing-grpc', DRAWTHING_GRPC: 'localhost:9000', DRAWTHING_MODEL: 'env.ckpt' };
  assert.equal(engineOptions({}, { cwd, env }).grpc, 'localhost:9000');
  assert.equal(engineOptions({}, { cwd, env }).model, 'env.ckpt');
  const explicit = engineOptions({ grpc: 'localhost:7000', model: 'cli.ckpt' }, { cwd, env });
  assert.equal(explicit.grpc, 'localhost:7000');
  assert.equal(explicit.model, 'cli.ckpt');
  const changed = engineOptions({ url: 'http://localhost:8000' }, { cwd, env: {} });
  assert.equal(changed.connector, 'drawthing');
  assert.equal(changed.model, undefined);
  assert.equal(engineOptions({ grpc: 'localhost:9999' }, { cwd, env: {} }).model, undefined);
}));

test('malformed local configuration fails explicitly instead of using defaults', () => project((cwd) => {
  writeFileSync(join(cwd, '.local-designer.json'), '{');
  assert.throws(() => loadEngineConfig({ cwd }), /not valid JSON/);
  for (const bad of [null, [], { engine: null }, { engine: { connector: 'other' } }, { engine: { connector: 'drawthing-grpc' } }, { engine: { ...engine, model: 4 } }]) {
    write(cwd, bad);
    assert.throws(() => loadEngineConfig({ cwd }), /configuration|engine/);
  }
}));

test('setup verifies before writing, rejects unknown listed models, and never resets an unreachable engine', () => project(async (cwd) => {
  write(cwd, { engine });
  const original = readFileSync(join(cwd, '.local-designer.json'), 'utf8');
  await assert.rejects(setupEngine({ model: 'missing.ckpt' }, { cwd, env: {}, connect: fakeConnect }), /not listed/);
  await assert.rejects(setupEngine({}, { cwd, env: {}, connect: async () => { throw new Error('server offline'); } }), /server offline/);
  assert.equal(readFileSync(join(cwd, '.local-designer.json'), 'utf8'), original);
}));

test('discovery probes only known loopback endpoints, reports each failure and never writes', () => project(async (cwd) => {
  const calls = [];
  const report = await discoverEngines({}, { cwd, env: {}, connect: async (id, opts) => {
    calls.push(opts.grpc ?? opts.url);
    if (id !== 'drawthing-grpc' || !opts.grpc.endsWith(':7860')) throw new Error('offline');
    return fakeConnect(id, opts);
  } });
  assert.equal(report.status, 'ok');
  assert.equal(report.probes.filter((probe) => probe.status === 'ok').length, 1);
  assert.equal(report.probes.filter((probe) => probe.error === 'offline').length, 2);
  assert.deepEqual(calls, ['127.0.0.1:7860', 'http://127.0.0.1:7860', '127.0.0.1:7859']);
  assert.equal(loadEngineConfig({ cwd }).engine, undefined);
  write(cwd, { engine: { ...engine, grpc: 'remote.example.com:7860' } });
  await assert.rejects(discoverEngines({}, { cwd, env: {}, connect: fakeConnect }), /loopback/);
  await assert.rejects(setupEngine({}, { cwd, env: {}, connect: fakeConnect }), /loopback/);
}));

test('setup initializes from one detected engine and refuses ambiguous discovery', () => project(async (cwd) => {
  await assert.rejects(setupEngine({}, { cwd, env: {}, connect: fakeConnect }), /Found 3 local engines/);
  const result = await setupEngine({}, { cwd, env: {}, connect: async (id, opts) => {
    if (id !== 'drawthing-grpc' || opts.grpc !== '127.0.0.1:7860') throw new Error('offline');
    return fakeConnect(id, opts);
  } });
  assert.equal(result.engine.grpc, '127.0.0.1:7860');
  assert.equal(result.engine.connector, 'drawthing-grpc');
}));

test('HTTP setup saves its URL and empty model lists are explicitly disclosed', () => project(async (cwd) => {
  const http = await setupEngine({ connector: 'drawthing', url: 'http://127.0.0.1:7890' }, { cwd, env: {}, connect: fakeConnect });
  assert.equal(http.engine.url, 'http://127.0.0.1:7890');
  const grpc = await setupEngine({ connector: 'drawthing-grpc', grpc: '127.0.0.1:7860' }, { cwd, env: {}, connect: async () => ({ target: '127.0.0.1:7860', where: 'local', models: [], loras: [], controlNets: [] }) });
  assert.equal(grpc.warnings.length, 1);
  assert.equal(grpc.engine.model, undefined);
}));

test('persisted settings drive status and generation without connector, endpoint or model flags', () => project(async (cwd) => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ model: 'qwen.ckpt', width: 512, height: 512, steps: 8 }));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  const cli = fileURLToPath(new URL('../skills/local-designer/scripts/local-designer.mjs', import.meta.url));
  const run = (args) => new Promise((ok, reject) => {
    const env = { ...process.env, LOCAL_DESIGNER_CONNECTOR: '', DRAWTHING_URL: '', DRAWTHING_GRPC: '', DRAWTHING_MODEL: '' };
    const child = spawn(process.execPath, [cli, ...args], { cwd, env });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.on('error', reject);
    child.on('close', (code) => {
      try { assert.equal(code, 0, output); ok(JSON.parse(output)); } catch (error) { reject(error); }
    });
  });
  try {
    await run(['setup', '--connector', 'drawthing', '--url', url, '--model', 'qwen.ckpt']);
    const status = await run(['status']);
    assert.equal(status.connector, 'drawthing');
    assert.equal(status.url, url);
    const dry = await run(['generate', '--prompt', 'two distinct adults', '--out', join(cwd, 'draft.png'), '--dry-run']);
    assert.equal(dry.connector, 'drawthing');
    assert.equal(dry.request.model, 'qwen.ckpt');
    assert.equal(dry.status, 'dry-run');
    const reference = join(cwd, 'reference.png');
    writeFileSync(reference, encodePng({ width: 1, height: 1, channels: 3, pixels: Buffer.alloc(3) }, {
      'XML:com.adobe.xmp': '<rdf:li xml:lang="x-default">{"c":"reference subject","model":"reference.ckpt"}</rdf:li>',
    }));
    const from = await run(['generate', '--from', reference, '--out', join(cwd, 'from.png'), '--dry-run']);
    assert.equal(from.request.model, 'reference.ckpt', '--from metadata overrides project defaults');
    const override = await run(['generate', '--from', reference, '--model', 'override.ckpt', '--out', join(cwd, 'override.png'), '--dry-run']);
    assert.equal(override.request.model, 'override.ckpt', 'explicit model still wins');
  } finally { await new Promise((ok) => server.close(ok)); }
}));
