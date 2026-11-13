// Server secrets (Draw Things gRPC shared secret, future engine tokens). The pool stores only a reference;
// the value is resolved in memory at connection time and never written, logged or put on a command line.
//
// Resolution order for a server with a `secret` reference:
//   1. LOCAL_DESIGNER_SECRET_<ID> in the environment of this run. A host that exposes a Vault MCP
//      (e.g. a Tatami stack) reads the secret through that MCP and injects it here for one run only.
//   2. The reference itself: env (variable name), file (outside git, owner-only permissions) or
//      vault (resolved by the configured vault hook command).
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const SECRET = Symbol.for('local-designer.secret');
export const SECRET_SOURCES = ['env', 'file', 'vault'];
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;

export const overrideVar = (id) => `LOCAL_DESIGNER_SECRET_${String(id).toUpperCase().replace(/-/g, '_')}`;

export function validateSecretRef(ref, at) {
  const errors = [];
  if (ref === null || ref === undefined) return errors;
  if (typeof ref !== 'object' || Array.isArray(ref)) return [`${at}.secret must be a reference object ({ source, ... }), never the secret value`];
  if (!SECRET_SOURCES.includes(ref.source)) errors.push(`${at}.secret.source must be one of ${SECRET_SOURCES.join(', ')}`);
  if (ref.source === 'env' && !ENV_NAME.test(String(ref.name ?? ''))) errors.push(`${at}.secret.name must be an environment variable name`);
  if (ref.source === 'file' && (typeof ref.path !== 'string' || !ref.path.trim())) errors.push(`${at}.secret.path must be a file path`);
  if (ref.source === 'vault' && (typeof ref.path !== 'string' || !/^[\w./-]+$/.test(ref.path))) errors.push(`${at}.secret.path must be a Vault path (letters, digits, . / _ -)`);
  for (const key of Object.keys(ref)) if (!['source', 'name', 'path', 'field'].includes(key)) errors.push(`${at}.secret.${key} is not allowed`);
  return errors;
}

export function validateSecretsSection(secrets) {
  if (secrets === undefined || secrets === null) return [];
  const errors = [];
  if (typeof secrets !== 'object' || Array.isArray(secrets)) return ['engines.secrets must be an object'];
  const hook = secrets.vault_hook;
  if (hook !== undefined && hook !== null) {
    if (!Array.isArray(hook.command) || !hook.command.length || hook.command.some((p) => typeof p !== 'string' || !p)) errors.push('secrets.vault_hook.command must be a non-empty array of strings (program then arguments)');
    if (hook.timeout_s !== undefined && !(Number.isInteger(hook.timeout_s) && hook.timeout_s >= 1 && hook.timeout_s <= 60)) errors.push('secrets.vault_hook.timeout_s must be an integer between 1 and 60');
  }
  return errors;
}

const expand = (p) => resolve(p.startsWith('~/') ? `${homedir()}/${p.slice(2)}` : p);

export function resolveSecret(server, pool, { env = process.env, spawn = spawnSync } = {}) {
  const override = env[overrideVar(server.id)];
  if (override) return override.trim();
  const ref = server.secret;
  if (!ref) return undefined;
  if (ref.source === 'env') {
    const value = env[ref.name];
    if (!value) throw new Error(`server ${server.id}: environment variable ${ref.name} is empty or missing`);
    return value.trim();
  }
  if (ref.source === 'file') {
    const file = expand(ref.path);
    const mode = statSync(file).mode;
    if (process.platform !== 'win32' && (mode & 0o077)) throw new Error(`server ${server.id}: ${file} is readable by others; run chmod 600 on it`);
    return readFileSync(file, 'utf8').trim();
  }
  const hook = pool.secrets?.vault_hook;
  if (!hook) {
    throw new Error(`server ${server.id}: no secrets.vault_hook configured. Configure one, or have the host read ${ref.path} from its Vault MCP and set ${overrideVar(server.id)} for this run.`);
  }
  const [program, ...args] = hook.command;
  const run = spawn(program, args, {
    input: JSON.stringify({ server: server.id, path: ref.path, field: ref.field ?? 'secret' }),
    encoding: 'utf8', timeout: (hook.timeout_s ?? 15) * 1000, env,
  });
  if (run.error || run.status !== 0) {
    // stderr may come from the hook: keep it short and never echo stdout (it could hold the secret).
    throw new Error(`server ${server.id}: vault hook failed (${run.error?.message ?? `exit ${run.status}`}) ${String(run.stderr ?? '').trim().slice(0, 200)}`.trim());
  }
  const value = String(run.stdout ?? '').trim();
  if (!value) throw new Error(`server ${server.id}: vault hook returned an empty secret for ${ref.path}`);
  return value;
}
