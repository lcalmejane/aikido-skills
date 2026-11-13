import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadTemplate, planJobs, primaryEngine, savePool, validatePool, verifyPool,
} from '../skills/local-designer/scripts/engine-pool.mjs';
import { engineOptions } from '../skills/local-designer/scripts/engine-config.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const server = (over) => ({ ...clone(loadTemplate().servers[0]), ...over });
function pool(servers, scheduling = {}) {
  const base = loadTemplate();
  return { ...base, servers, scheduling: { ...base.scheduling, ...scheduling } };
}

test('the shipped template is valid and keeps the planned ComfyUI server disabled', () => {
  const template = loadTemplate();
  assert.deepEqual(validatePool(template), { errors: [], warnings: [] });
  assert.equal(template.servers.find((s) => s.type === 'comfyui').enabled, false);
});

test('validation enforces protocol model policies, remote consent, planned types and secrets', () => {
  const errors = (p) => validatePool(p).errors.join('\n');
  assert.match(errors(pool([server({ model_policy: 'server' })])), /model_policy must be auto or pinned with grpc/);
  assert.match(errors(pool([server({ protocol: 'http', model_policy: 'auto' })])), /server or pinned with http/);
  assert.match(errors(pool([server({ model_policy: 'pinned', model: null })])), /model is required/);
  assert.match(errors(pool([server({ host: '192.168.1.20' })])), /set remote: true/);
  assert.equal(errors(pool([server({ host: '192.168.1.20', remote: true })])), '');
  assert.match(errors(pool([server(), server({ id: 'c', type: 'comfyui', protocol: 'http', model_policy: 'pinned', model: 'x', enabled: true })])), /planned/);
  assert.match(errors(pool([server({ api_token: 'x' })])), /never store secrets/);
  assert.match(errors(pool([server(), server()])), /duplicated/);
  assert.match(errors(pool([server({ host: 'http://x' })])), /without scheme/);
  const clear = server({ host: 'gpu.lan', remote: true, protocol: 'http', model_policy: 'server', tls: false });
  assert.match(errors(pool([clear])), /allow_clear_text/);
  assert.match(validatePool(pool([{ ...clear, allow_clear_text: true }])).warnings.join(), /clear text/);
  assert.match(validatePool(pool([server()], { max_parallel_total: 4 })).warnings.join(), /exceeds/);
});

test('priority strategy fills the first server, then overflows within the total limit', () => {
  const p = pool([
    server({ id: 'mac', max_concurrent: 2 }),
    server({ id: 'gpu', host: '10.0.0.5', remote: true, priority: 2, max_concurrent: 2 }),
  ], { max_parallel_total: 3, batch_size: 10 });
  const plan = planJobs(p, 7);
  assert.equal(plan.capacity, 3);
  const [first] = plan.batches[0].waves;
  assert.deepEqual(first.map((a) => a.server), ['mac', 'mac', 'gpu']);
  assert.equal(plan.batches[0].waves.flat().length, 7);
});

test('weighted strategy follows weights; batches carry the pause; roles route jobs', () => {
  const p = pool([
    server({ id: 'a', weight: 3, max_concurrent: 4 }),
    server({ id: 'b', weight: 1, max_concurrent: 4, roles: ['draft'] }),
  ], { strategy: 'weighted', max_parallel_total: 8, batch_size: 4, pause_between_batches_s: 30 });
  const drafts = planJobs(p, 8, { role: 'draft' }).batches.flatMap((b) => b.waves.flat());
  const share = drafts.filter((x) => x.server === 'a').length;
  assert.ok(share >= 5 && share <= 7, `weighted share ${share}`);
  const finals = planJobs(p, 8);
  assert.ok(finals.batches.flatMap((b) => b.waves.flat()).every((x) => x.server === 'a'));
  assert.deepEqual(finals.batches.map((b) => b.pause_before_s), [0, 30]);
});

test('priority queue order puts finals before sweeps; jobs without a server are reported', () => {
  const p = pool([server({ roles: ['final', 'sweep'] })]);
  const plan = planJobs(p, [{ id: 's', role: 'sweep' }, { id: 'f', role: 'final' }, { id: 'm', role: 'moodboard' }]);
  assert.deepEqual(plan.batches[0].waves.flat().map((x) => x.job), ['f', 's']);
  assert.deepEqual(plan.unassigned.map((x) => x.id), ['m']);
});

test('saving keeps other keys and syncs the legacy engine read by every command', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'local-designer-pool-'));
  try {
    writeFileSync(join(cwd, '.local-designer.json'), JSON.stringify({ design_dir: 'design', vision: { model: 'v' } }));
    const p = pool([
      server({ id: 'backup', priority: 5, protocol: 'http', model_policy: 'server' }),
      server({ id: 'main', priority: 1, model_policy: 'pinned', model: 'flux.ckpt' }),
    ]);
    assert.deepEqual(primaryEngine(p), { connector: 'drawthing-grpc', grpc: '127.0.0.1:7860', model: 'flux.ckpt', server: 'main' });
    const saved = savePool(p, { cwd, verifiedAt: '2026-11-13T00:00:00.000Z' });
    assert.equal(saved.primary, 'main');
    const file = JSON.parse(readFileSync(join(cwd, '.local-designer.json'), 'utf8'));
    assert.equal(file.design_dir, 'design');
    assert.equal(file.vision.model, 'v');
    assert.equal(file.engines.servers.length, 2);
    assert.equal(file.engine.verified_at, '2026-11-13T00:00:00.000Z');
    const resolved = engineOptions({}, { cwd, env: {} });
    assert.equal(resolved.grpc, '127.0.0.1:7860');
    assert.equal(resolved.model, 'flux.ckpt');
    assert.throws(() => savePool(pool([server({ host: '8.8.8.8' })]), { cwd }), /remote: true/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('verification checks pinned and auto models against the server list', async () => {
  const p = pool([
    server({ id: 'pin', model_policy: 'pinned', model: 'missing.ckpt' }),
    server({ id: 'auto', port: 7861 }),
    server({ id: 'down', port: 7862 }),
  ]);
  const inspect = async (o) => {
    if (o.grpc.endsWith('7862')) throw new Error('connection refused');
    return { models: o.grpc.endsWith('7861') ? [] : [{ file: 'qwen.ckpt' }] };
  };
  const results = Object.fromEntries((await verifyPool(p, { inspect })).map((r) => [r.id, r.status]));
  assert.deepEqual(results, { pin: 'error', auto: 'error', down: 'unreachable' });
});
