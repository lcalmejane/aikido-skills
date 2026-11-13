import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTemplate, validatePool } from '../skills/local-designer/scripts/engine-pool.mjs';
import { activePool, runJobs } from '../skills/local-designer/scripts/pool-runner.mjs';
import { SECRET, overrideVar, resolveSecret } from '../skills/local-designer/scripts/secrets.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));
const server = (over) => ({ ...clone(loadTemplate().servers[0]), ...over });
const pool = (servers, scheduling = {}, extra = {}) => {
  const base = loadTemplate();
  return { ...base, servers, scheduling: { ...base.scheduling, backoff_s: 0, ...scheduling, retry: { max_attempts: 2, backoff_s: 0, ...scheduling.retry } }, ...extra };
};
const jobs = (n, role = 'sweep') => Array.from({ length: n }, (_, i) => ({ id: `j${i + 1}`, role }));
const noSleep = async () => {};
const tick = () => new Promise((done) => setTimeout(done, 5));

test('per-server and total concurrency limits hold while jobs run in parallel', async () => {
  const p = pool([server({ id: 'a', max_concurrent: 2 }), server({ id: 'b', port: 7861, priority: 2, max_concurrent: 2 })],
    { strategy: 'round-robin', max_parallel_total: 3, batch_size: 20 });
  const live = { a: 0, b: 0 };
  let peak = 0;
  const peaks = { a: 0, b: 0 };
  const out = await runJobs({
    pool: p, jobs: jobs(12), sleep: noSleep, env: {},
    connect: async (opts, s) => ({ id: s.id }),
    run: async (job, ctx) => {
      live[ctx.id] += 1;
      peaks[ctx.id] = Math.max(peaks[ctx.id], live[ctx.id]);
      peak = Math.max(peak, live.a + live.b);
      await tick();
      live[ctx.id] -= 1;
      return ctx.id;
    },
  });
  assert.equal(out.mode, 'pool');
  assert.ok(out.results.every((r) => !r.error));
  assert.ok(peak <= 3 && peaks.a <= 2 && peaks.b <= 2, JSON.stringify({ peak, peaks }));
  assert.ok(new Set(out.results.map((r) => r.server)).size === 2);
});

test('a failing server hands its jobs to the next one; connection errors mark it down', async () => {
  const p = pool([server({ id: 'main' }), server({ id: 'backup', port: 7861, priority: 2 })], { batch_size: 10 });
  const opened = [];
  const out = await runJobs({
    pool: p, jobs: jobs(3), sleep: noSleep, env: {},
    connect: async (opts, s) => {
      opened.push(s.id);
      if (s.id === 'main') throw new Error('connect ECONNREFUSED 127.0.0.1:7860');
      return { id: s.id };
    },
    run: async (job, ctx) => ctx.id,
  });
  assert.deepEqual(out.results.map((r) => [r.server, r.value, r.error]), [['backup', 'backup', undefined], ['backup', 'backup', undefined], ['backup', 'backup', undefined]]);
  assert.equal(opened.filter((x) => x === 'main').length, 1);
});

test('stop policy skips the remaining jobs after a final failure; timeouts count as failures', async () => {
  const p = pool([server({ id: 'only' })], { on_server_failure: 'stop', batch_size: 1, timeout_s: 10, retry: { max_attempts: 1, backoff_s: 0 } });
  const out = await runJobs({
    pool: p, jobs: jobs(3), sleep: noSleep, env: {},
    connect: async () => ({}),
    run: async (job) => { if (job.id === 'j2') throw new Error('render failed'); return 'ok'; },
  });
  assert.deepEqual(out.results.map((r) => Boolean(r.error)), [false, true, true]);
  assert.match(out.results[2].error, /not run/);
});

test('without a pool, or with an explicit engine, jobs run on the single engine', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'local-designer-runner-'));
  try {
    writeFileSync(join(cwd, '.local-designer.json'), JSON.stringify({ engines: pool([server()]) }));
    assert.ok(activePool({}, { cwd, env: {} }));
    assert.equal(activePool({ grpc: '127.0.0.1:9' }, { cwd, env: {} }), null);
    assert.equal(activePool({ 'no-pool': true }, { cwd, env: {} }), null);
    assert.equal(activePool({}, { cwd, env: { DRAWTHING_URL: 'http://127.0.0.1:7860' } }), null);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
  const out = await runJobs({ pool: null, jobs: jobs(2), single: async () => ({ id: 'one' }), run: async (j, ctx) => ctx.id });
  assert.deepEqual(out.results.map((r) => r.value), ['one', 'one']);
});

test('secrets: references only, resolved in memory from env, file, host injection or the vault hook', async () => {
  const errors = (p) => validatePool(p).errors.join('\n');
  assert.match(errors(pool([server({ secret: 'plain-value' })])), /reference object/);
  assert.match(errors(pool([server({ api_token: 'x' })])), /never store secrets/);
  assert.match(errors(pool([server({ protocol: 'http', model_policy: 'server', secret: { source: 'env', name: 'X' } })])), /only the gRPC/);
  assert.equal(errors(pool([server({ secret: { source: 'vault', path: 'secret/data/dt', field: 'shared' } })], {}, { secrets: { vault_hook: { command: ['node', 'hook.mjs'] } } })), '');

  const s = server({ id: 'gpu-lan', secret: { source: 'env', name: 'DT_SECRET' } });
  assert.equal(resolveSecret(s, {}, { env: { DT_SECRET: ' abc ' } }), 'abc');
  assert.equal(overrideVar('gpu-lan'), 'LOCAL_DESIGNER_SECRET_GPU_LAN');
  assert.equal(resolveSecret(s, {}, { env: { LOCAL_DESIGNER_SECRET_GPU_LAN: 'from-mcp', DT_SECRET: 'abc' } }), 'from-mcp');
  assert.throws(() => resolveSecret(s, {}, { env: {} }), /DT_SECRET/);

  const dir = mkdtempSync(join(tmpdir(), 'local-designer-secret-'));
  try {
    const file = join(dir, 'secret');
    writeFileSync(file, 'file-secret\n');
    chmodSync(file, 0o644);
    const f = server({ secret: { source: 'file', path: file } });
    assert.throws(() => resolveSecret(f, {}, { env: {} }), /chmod 600/);
    chmodSync(file, 0o600);
    assert.equal(resolveSecret(f, {}, { env: {} }), 'file-secret');
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const v = server({ secret: { source: 'vault', path: 'secret/data/dt' } });
  assert.throws(() => resolveSecret(v, {}, { env: {} }), /vault_hook|Vault MCP/);
  let input;
  const spawn = (program, args, o) => { input = JSON.parse(o.input); return { status: 0, stdout: 'vault-secret\n', stderr: '' }; };
  assert.equal(resolveSecret(v, { secrets: { vault_hook: { command: ['node', 'h.mjs'] } } }, { env: {}, spawn }), 'vault-secret');
  assert.deepEqual(input, { server: 'local', path: 'secret/data/dt', field: 'secret' });

  let seen;
  await runJobs({
    pool: pool([s]), jobs: jobs(1), sleep: noSleep, env: { DT_SECRET: 'abc' },
    connect: async (opts) => { seen = opts; return {}; }, run: async () => 'ok',
  });
  assert.equal(seen[SECRET], 'abc');
  assert.ok(!JSON.stringify(seen).includes('abc'), 'the secret never appears in serialisable options');
});
