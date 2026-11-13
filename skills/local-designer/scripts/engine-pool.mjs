// Engine pool: several image servers, their protocol and model policy, and how batches of renders are
// prioritised and paced across them. Stored under the "engines" key of .local-designer.json.
// Zero dependency. Validation is offline; --verify probes servers through the existing connectors.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngineConfig } from './engine-config.mjs';
import { isLoopback } from './connectors/drawthing-grpc/transport.mjs';
import { validateSecretRef, validateSecretsSection } from './secrets.mjs';

export const POOL_VERSION = 1;
export const TEMPLATE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'engines.template.json');

// Server types and what each protocol allows. "planned" types may be declared but must stay disabled.
export const SERVER_TYPES = {
  drawthing: {
    protocols: {
      grpc: { connector: 'drawthing-grpc', defaultPort: 7860, modelPolicies: ['auto', 'pinned'] },
      http: { connector: 'drawthing', defaultPort: 7860, modelPolicies: ['server', 'pinned'] },
    },
  },
  comfyui: { planned: true, protocols: { http: { defaultPort: 8188, modelPolicies: ['pinned'] } } },
};
export const MODEL_POLICIES = {
  server: 'use the model currently loaded in the server application (HTTP only)',
  auto: 'the tool picks a listed model, preferring a fast one (gRPC lists the server models)',
  pinned: 'always use the model named in "model"',
};
export const STRATEGIES = ['priority', 'round-robin', 'weighted'];
export const ROLES = ['draft', 'sweep', 'moodboard', 'final'];
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function loadTemplate() {
  return JSON.parse(readFileSync(TEMPLATE_FILE, 'utf8'));
}

const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

export function validatePool(pool) {
  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);
  if (!pool || typeof pool !== 'object' || Array.isArray(pool)) return { errors: ['engines must be an object'], warnings };
  if (pool.version !== POOL_VERSION) err(`engines.version must be ${POOL_VERSION}`);
  if (!Array.isArray(pool.servers) || !pool.servers.length) err('engines.servers must list at least one server');
  const ids = new Set();
  for (const [i, s] of (Array.isArray(pool.servers) ? pool.servers : []).entries()) {
    const at = `servers[${i}]${s?.id ? ` (${s.id})` : ''}`;
    if (!s || typeof s !== 'object') { err(`${at} must be an object`); continue; }
    if (!ID.test(String(s.id ?? ''))) err(`${at}.id must be lowercase letters, digits or dashes`);
    else if (ids.has(s.id)) err(`${at}.id is duplicated`);
    ids.add(s.id);
    const type = SERVER_TYPES[s.type];
    if (!type) { err(`${at}.type must be one of ${Object.keys(SERVER_TYPES).join(', ')}`); continue; }
    if (type.planned && s.enabled !== false) err(`${at}: type ${s.type} is planned, not available yet; keep it with enabled: false`);
    const proto = type.protocols[s.protocol];
    if (!proto) { err(`${at}.protocol must be one of ${Object.keys(type.protocols).join(', ')} for ${s.type}`); continue; }
    if (typeof s.host !== 'string' || !s.host.trim() || /[/\s@?#]/.test(s.host)) err(`${at}.host must be a host name or IP, without scheme, path or credentials`);
    if (!int(s.port, 1, 65535)) err(`${at}.port must be an integer between 1 and 65535`);
    if (typeof s.tls !== 'boolean') err(`${at}.tls must be true or false`);
    const local = typeof s.host === 'string' && isLoopback(s.host);
    if (!local && s.remote !== true) err(`${at}: ${s.host} is not a loopback address; set remote: true once the user has agreed to render on that machine`);
    if (!local && !s.tls && s.allow_clear_text !== true) err(`${at}: a remote server without TLS sends prompts and images in clear text; enable tls or set allow_clear_text: true with the user's agreement`);
    if (!local && !s.tls && s.allow_clear_text === true) warnings.push(`${at}: remote server without TLS, prompts and images travel in clear text`);
    if (s.tls_fingerprint !== undefined && s.tls_fingerprint !== null && !/^[0-9a-fA-F:]{32,}$/.test(String(s.tls_fingerprint))) err(`${at}.tls_fingerprint must be a hex SHA-256 fingerprint`);
    if (s.secret && s.protocol !== 'grpc') err(`${at}.secret: only the gRPC protocol takes a shared secret today`);
    errors.push(...validateSecretRef(s.secret, at));
    if (!proto.modelPolicies.includes(s.model_policy)) err(`${at}.model_policy must be ${proto.modelPolicies.join(' or ')} with ${s.protocol}`);
    if (s.model_policy === 'pinned' && (typeof s.model !== 'string' || !s.model.trim())) err(`${at}.model is required when model_policy is pinned`);
    if (s.model_policy !== 'pinned' && s.model) warnings.push(`${at}.model is ignored unless model_policy is pinned`);
    if (!int(s.max_concurrent, 1, 16)) err(`${at}.max_concurrent must be an integer between 1 and 16`);
    if (!int(s.priority, 1, 100)) err(`${at}.priority must be an integer between 1 (first) and 100`);
    if (!int(s.weight, 1, 100)) err(`${at}.weight must be an integer between 1 and 100`);
    if (typeof s.enabled !== 'boolean') err(`${at}.enabled must be true or false`);
    if (!Array.isArray(s.roles) || !s.roles.length || s.roles.some((r) => !ROLES.includes(r))) err(`${at}.roles must list some of ${ROLES.join(', ')}`);
    for (const key of Object.keys(s)) if (key !== 'secret' && /token|secret|password|key$/i.test(key)) err(`${at}.${key}: never store secrets here; reference them with "secret" (env, file or vault)`);
  }
  const sc = pool.scheduling;
  if (!sc || typeof sc !== 'object') err('engines.scheduling must be an object');
  else {
    if (!STRATEGIES.includes(sc.strategy)) err(`scheduling.strategy must be one of ${STRATEGIES.join(', ')}`);
    if (!int(sc.max_parallel_total, 1, 64)) err('scheduling.max_parallel_total must be an integer between 1 and 64');
    if (!int(sc.batch_size, 1, 256)) err('scheduling.batch_size must be an integer between 1 and 256');
    if (!int(sc.pause_between_batches_s, 0, 3600)) err('scheduling.pause_between_batches_s must be an integer between 0 and 3600');
    if (!['fifo', 'priority'].includes(sc.queue_order)) err('scheduling.queue_order must be fifo or priority');
    if (!sc.job_priority || typeof sc.job_priority !== 'object' || ROLES.some((r) => !int(sc.job_priority[r], 1, 100))) {
      err(`scheduling.job_priority must give ${ROLES.join(', ')} an integer between 1 (first) and 100`);
    }
    if (!int(sc.timeout_s, 10, 7200)) err('scheduling.timeout_s must be an integer between 10 and 7200');
    if (!int(sc.retry?.max_attempts, 1, 5)) err('scheduling.retry.max_attempts must be an integer between 1 and 5');
    if (!int(sc.retry?.backoff_s, 0, 600)) err('scheduling.retry.backoff_s must be an integer between 0 and 600');
    if (!['next-server', 'stop'].includes(sc.on_server_failure)) err('scheduling.on_server_failure must be next-server or stop');
  }
  errors.push(...validateSecretsSection(pool.secrets));
  const enabled = (pool.servers ?? []).filter((s) => s?.enabled === true);
  if (Array.isArray(pool.servers) && !enabled.length) err('at least one server must be enabled');
  for (const role of ROLES) {
    if (enabled.length && !enabled.some((s) => s.roles?.includes(role))) warnings.push(`no enabled server accepts ${role} jobs`);
  }
  const capacity = enabled.reduce((sum, s) => sum + (s.max_concurrent || 0), 0);
  if (sc && int(sc.max_parallel_total, 1, 64) && capacity && sc.max_parallel_total > capacity) {
    warnings.push(`scheduling.max_parallel_total (${sc.max_parallel_total}) exceeds the enabled servers' capacity (${capacity}); ${capacity} will be used`);
  }
  return { errors, warnings };
}

export function assertPool(pool) {
  const { errors, warnings } = validatePool(pool);
  if (errors.length) throw new Error(`Invalid engines configuration:\n- ${errors.join('\n- ')}`);
  return warnings;
}

const endpoint = (s) => (s.protocol === 'grpc' ? `${s.host}:${s.port}` : `${s.tls ? 'https' : 'http'}://${s.host}:${s.port}`);
const byPriority = (a, b) => a.priority - b.priority || b.weight - a.weight || a.id.localeCompare(b.id);

// Connector options for one server, in the shape the existing connectors and engineOptions use.
export function serverOptions(s) {
  const proto = SERVER_TYPES[s.type].protocols[s.protocol];
  return {
    connector: proto.connector,
    ...(s.protocol === 'grpc' ? { grpc: endpoint(s), ...(s.tls ? {} : { 'no-tls': true }), ...(!s.tls && s.remote ? { 'insecure-tls': true } : {}), ...(s.tls_fingerprint ? { fingerprint: s.tls_fingerprint } : {}) } : { url: endpoint(s) }),
    ...(s.model_policy === 'pinned' ? { model: s.model } : {}),
  };
}

// The single "engine" entry every existing command reads: the first enabled server by priority.
export function primaryEngine(pool) {
  const s = pool.servers.filter((x) => x.enabled && !SERVER_TYPES[x.type].planned).sort(byPriority)[0];
  return s ? { ...serverOptions(s), server: s.id } : undefined;
}

// Distribute jobs over the enabled servers. Pure: no network, no clock.
// jobs: [{ id, role }] or a count. Returns waves of at most max_parallel_total renders.
export function planJobs(pool, jobs, { role = 'final' } = {}) {
  assertPool(pool);
  const sc = pool.scheduling;
  const list = (typeof jobs === 'number' ? Array.from({ length: jobs }, (_, i) => ({ id: `job-${i + 1}`, role })) : jobs)
    .map((job, index) => ({ ...job, index }));
  const rank = (job) => sc.job_priority[job.role] ?? 100;
  if (sc.queue_order === 'priority') list.sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  const servers = pool.servers.filter((s) => s.enabled && !SERVER_TYPES[s.type].planned).sort(byPriority);
  const capacity = Math.min(sc.max_parallel_total, servers.reduce((sum, s) => sum + s.max_concurrent, 0));
  const unassigned = [];
  const assignments = [];
  let cursor = 0;
  const credit = Object.fromEntries(servers.map((s) => [s.id, 0]));
  for (const batchStart of range(0, list.length, sc.batch_size)) {
    const batch = list.slice(batchStart, batchStart + sc.batch_size);
    const waves = [];
    let pending = [...batch];
    while (pending.length) {
      const load = Object.fromEntries(servers.map((s) => [s.id, 0]));
      const wave = [];
      const next = [];
      for (const job of pending) {
        const eligible = servers.filter((s) => s.roles.includes(job.role) && load[s.id] < s.max_concurrent);
        if (!servers.some((s) => s.roles.includes(job.role))) { unassigned.push({ id: job.id, role: job.role, reason: 'no enabled server accepts this role' }); continue; }
        if (wave.length >= capacity || !eligible.length) { next.push(job); continue; }
        let server;
        if (sc.strategy === 'priority') server = eligible[0];
        else if (sc.strategy === 'round-robin') { server = eligible[cursor % eligible.length]; cursor += 1; }
        else {
          for (const s of eligible) credit[s.id] += s.weight;
          server = eligible.reduce((best, s) => (credit[s.id] > credit[best.id] ? s : best));
          credit[server.id] -= eligible.reduce((sum, s) => sum + s.weight, 0);
        }
        load[server.id] += 1;
        wave.push({ job: job.id, role: job.role, server: server.id });
      }
      if (!wave.length) break;
      waves.push(wave);
      pending = next;
    }
    assignments.push({ batch: assignments.length + 1, pause_before_s: assignments.length ? sc.pause_between_batches_s : 0, waves });
  }
  return {
    strategy: sc.strategy,
    capacity,
    servers: servers.map((s) => ({ id: s.id, endpoint: endpoint(s), protocol: s.protocol, model_policy: s.model_policy, model: s.model_policy === 'pinned' ? s.model : undefined, max_concurrent: s.max_concurrent })),
    batches: assignments,
    unassigned,
    retry: sc.retry,
    timeout_s: sc.timeout_s,
    on_server_failure: sc.on_server_failure,
  };
}

function* range(start, end, step) { for (let i = start; i < end; i += step) yield i; }

// Probe enabled servers with the existing connectors. Planned types are skipped.
export async function verifyPool(pool, { inspect }) {
  const results = [];
  for (const s of pool.servers.filter((x) => x.enabled && !SERVER_TYPES[x.type].planned)) {
    try {
      const report = await inspect(serverOptions(s));
      const models = report.models ?? [];
      if (s.model_policy === 'pinned' && models.length && !models.some((m) => m.file === s.model)) {
        results.push({ id: s.id, status: 'error', error: `model "${s.model}" is not listed by the server` });
      } else if (s.model_policy === 'auto' && !models.length) {
        results.push({ id: s.id, status: 'error', error: 'the server lists no model: use model_policy pinned with a filename confirmed in the app' });
      } else results.push({ id: s.id, status: 'ok', models: models.length || undefined });
    } catch (error) {
      results.push({ id: s.id, status: 'unreachable', error: error.message });
    }
  }
  return results;
}

export function readPool({ cwd = process.cwd() } = {}) {
  const { file, config } = loadEngineConfig({ cwd });
  return { file, config, pool: config.engines };
}

// Save the pool and keep "engine" (read by every existing command) in sync with the primary server.
export function savePool(pool, { cwd = process.cwd(), verifiedAt } = {}) {
  const warnings = assertPool(pool);
  const { file, config } = loadEngineConfig({ cwd });
  const primary = primaryEngine(pool);
  const { server, ...engine } = primary;
  if (verifiedAt) engine.verified_at = verifiedAt;
  const next = { ...config, engines: { ...pool, updated_at: new Date().toISOString() }, engine };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return { file, primary: server, engine, warnings };
}
