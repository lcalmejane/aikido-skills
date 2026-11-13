// Runs render jobs over the engine pool: batches and pauses from `config plan`, per-server and total
// concurrency limits, timeout, retries and fallback to another server. Used by sweep, style thumbnails and
// mood board trials. Without a pool (or with an explicit engine on the command line) it runs the jobs one
// after another on the single engine, as before.
import { SERVER_TYPES, planJobs, readPool, serverOptions } from './engine-pool.mjs';
import { SECRET, resolveSecret } from './secrets.mjs';

// The pool applies unless the caller pinned one engine explicitly.
export function activePool(opts = {}, { env = process.env, cwd = process.cwd() } = {}) {
  if (opts['no-pool']) return null;
  const explicit = ['connector', 'url', 'grpc'].some((k) => opts[k] !== undefined && opts[k] !== true);
  if (explicit || env.LOCAL_DESIGNER_CONNECTOR || env.DRAWTHING_URL || env.DRAWTHING_GRPC) return null;
  return readPool({ cwd }).pool ?? null;
}

class Gate {
  constructor(limit) { this.limit = limit; this.used = 0; this.queue = []; }
  async take() {
    if (this.used < this.limit) { this.used += 1; return; }
    await new Promise((done) => this.queue.push(done));
  }
  give() {
    const next = this.queue.shift();
    if (next) next(); else this.used -= 1;
  }
}

const realSleep = (s) => new Promise((done) => setTimeout(done, s * 1000));

function withTimeout(promise, seconds, label) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: no image after ${seconds}s`)), seconds * 1000); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/**
 * jobs: [{ id, role }]; run(job, ctx, serverOpts) renders one job on an open session.
 * connect(serverOpts) opens a session ({ connector, session }); it is called once per server.
 * Returns { mode, results: [{ id, server, attempts, value | error }] } in the original job order.
 */
export async function runJobs({ pool, jobs, run, connect, log = () => {}, sleep = realSleep, env = process.env, single }) {
  if (!pool) {
    const ctx = await single();
    const results = [];
    for (const job of jobs) {
      try { results.push({ id: job.id, server: 'engine', attempts: 1, value: await run(job, ctx, {}) }); }
      catch (error) { results.push({ id: job.id, server: 'engine', attempts: 1, error: error.message }); }
    }
    return { mode: 'single', results };
  }
  const plan = planJobs(pool, jobs);
  const sc = pool.scheduling;
  const servers = Object.fromEntries(pool.servers.filter((s) => s.enabled && !SERVER_TYPES[s.type].planned).map((s) => [s.id, s]));
  const gates = Object.fromEntries(Object.values(servers).map((s) => [s.id, new Gate(s.max_concurrent)]));
  const total = new Gate(plan.capacity);
  const sessions = {};
  const down = new Set();
  let stopped = null;
  const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
  const results = Object.fromEntries(plan.unassigned.map((u) => [u.id, { id: u.id, attempts: 0, error: u.reason }]));

  const open = (s) => {
    sessions[s.id] ??= (async () => {
      const opts = { ...serverOptions(s) };
      const secret = resolveSecret(s, pool, { env });
      if (secret) opts[SECRET] = secret;
      return { ...(await connect(opts, s)), serverOpts: serverOptions(s) };
    })();
    return sessions[s.id];
  };

  const fallback = (job, tried) => Object.values(servers)
    .filter((s) => s.roles.includes(job.role) && !tried.has(s.id) && !down.has(s.id))
    .sort((a, b) => a.priority - b.priority)[0];

  async function execute(job, first) {
    const tried = new Set();
    let server = first;
    let lastError;
    for (let attempt = 1; attempt <= sc.retry.max_attempts; attempt += 1) {
      if (stopped) return { id: job.id, server: server.id, attempts: attempt - 1, error: `not run: ${stopped}` };
      if (down.has(server.id) && sc.on_server_failure === 'next-server') server = fallback(job, tried) ?? server;
      tried.add(server.id);
      await total.take();
      await gates[server.id].take();
      try {
        log(`[${job.id}] ${server.id}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
        const ctx = await open(server);
        const value = await withTimeout(run(job, ctx, ctx.serverOpts), sc.timeout_s, `${job.id} on ${server.id}`);
        return { id: job.id, server: server.id, attempts: attempt, value };
      } catch (error) {
        lastError = error;
        log(`  failed on ${server.id}: ${error.message}`);
        if (/ECONNREFUSED|unreachable|connect|secret|vault/i.test(error.message)) down.add(server.id); // the failed connection stays cached: no reconnect storm during this run
      } finally {
        gates[server.id].give();
        total.give();
      }
      if (attempt === sc.retry.max_attempts) break;
      if (sc.on_server_failure === 'next-server') server = fallback(job, tried) ?? (down.has(server.id) ? null : server);
      if (!server) break;
      await sleep(sc.retry.backoff_s);
    }
    if (sc.on_server_failure === 'stop') stopped ??= `stopped after ${job.id} failed`;
    return { id: job.id, server: [...tried].pop(), attempts: tried.size, error: lastError?.message ?? 'no server available' };
  }

  for (const batch of plan.batches) {
    if (stopped) break;
    if (batch.pause_before_s) { log(`pause ${batch.pause_before_s}s before batch ${batch.batch}`); await sleep(batch.pause_before_s); }
    const assigned = batch.waves.flat();
    const done = await Promise.all(assigned.map((a) => {
      const preferred = down.has(a.server) ? fallback(byId[a.job], new Set()) : servers[a.server];
      return preferred ? execute(byId[a.job], preferred) : { id: a.job, attempts: 0, error: 'no server available' };
    }));
    for (const r of done) results[r.id] = r;
  }
  for (const job of jobs) results[job.id] ??= { id: job.id, attempts: 0, error: `not run: ${stopped ?? 'unknown'}` };
  return { mode: 'pool', strategy: plan.strategy, capacity: plan.capacity, results: jobs.map((j) => results[j.id]) };
}
