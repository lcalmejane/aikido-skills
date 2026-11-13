#!/usr/bin/env node
// Vault hook for local-designer: reads one secret from HashiCorp Vault (or OpenBao) KV v1/v2 over its HTTP API.
// Contract: stdin = {"server","path","field"}; stdout = the secret value only; exit != 0 on failure.
// Configure in .local-designer.json: "secrets": { "vault_hook": { "command": ["node", "<skill-dir>/scripts/hooks/vault-kv.mjs"] } }
// Environment: VAULT_ADDR (https://... or a loopback http URL), VAULT_TOKEN, optional VAULT_NAMESPACE.
// The token comes from the environment of the run; it is never read from or written to the pool.
import { readFileSync } from 'node:fs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const { VAULT_ADDR: addr, VAULT_TOKEN: token, VAULT_NAMESPACE: namespace } = process.env;
if (!addr || !token) fail('VAULT_ADDR and VAULT_TOKEN must be set in the environment');
if (!/^[\w./-]+$/.test(String(input.path ?? ''))) fail('invalid Vault path');
const base = new URL(addr);
const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(base.hostname);
if (base.protocol !== 'https:' && !loopback) fail('VAULT_ADDR must use https for a non-local Vault');

const response = await fetch(new URL(`/v1/${input.path}`, base), {
  headers: { 'X-Vault-Token': token, ...(namespace ? { 'X-Vault-Namespace': namespace } : {}) },
  signal: AbortSignal.timeout(10000),
}).catch((error) => fail(`Vault unreachable: ${error.message}`));
if (!response.ok) fail(`Vault answered ${response.status} for ${input.path}`);
const body = await response.json();
const data = body?.data?.data ?? body?.data ?? {};
const value = data[input.field ?? 'secret'];
if (typeof value !== 'string' || !value) fail(`field "${input.field ?? 'secret'}" not found at ${input.path}`);
process.stdout.write(value);
