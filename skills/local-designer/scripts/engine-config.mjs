import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONFIG_FILE, findConfig } from './design-target.mjs';
import { parseTarget } from './connectors/drawthing-grpc/transport.mjs';

export function loadEngineConfig({ cwd = process.cwd() } = {}) {
  const found = findConfig(cwd);
  const file = found ?? join(resolve(cwd), CONFIG_FILE);
  let config = {};
  if (found) {
    try { config = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) { throw new Error(`${file} is not valid JSON: ${error.message}`); }
  }
  if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error(`${file}: configuration must be an object`);
  const engine = config.engine;
  if (engine !== undefined) {
    if (!engine || Array.isArray(engine) || typeof engine !== 'object') throw new Error(`${file}: engine must be an object`);
    if (!['drawthing', 'drawthing-grpc'].includes(engine.connector)) throw new Error(`${file}: engine.connector must be drawthing or drawthing-grpc`);
    for (const key of ['url', 'grpc', 'model']) {
      if (engine[key] !== undefined && (typeof engine[key] !== 'string' || !engine[key].trim())) throw new Error(`${file}: engine.${key} must be a non-empty string`);
    }
    if (!engine[engine.connector === 'drawthing' ? 'url' : 'grpc']) throw new Error(`${file}: engine endpoint is required`);
    if (engine.grpc) parseTarget(engine.grpc);
    if (engine.url) {
      const url = new URL(engine.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error(`${file}: engine.url must be an HTTP(S) endpoint without credentials, query or fragment`);
      }
    }
  }
  return { file, config, engine };
}

export function engineOptions(opts = {}, { cwd = process.cwd(), env = process.env } = {}) {
  const { engine } = loadEngineConfig({ cwd });
  const explicit = (key) => opts[key] !== undefined && opts[key] !== true ? opts[key] : undefined;
  const connector = explicit('connector') ?? (env.LOCAL_DESIGNER_CONNECTOR || undefined)
    ?? (explicit('grpc') ? 'drawthing-grpc' : explicit('url') ? 'drawthing'
      : env.DRAWTHING_GRPC ? 'drawthing-grpc' : env.DRAWTHING_URL ? 'drawthing' : undefined)
    ?? engine?.connector;
  const same = engine !== undefined && connector === engine.connector;
  const endpointOverride = explicit('grpc') || explicit('url') || env.DRAWTHING_GRPC || env.DRAWTHING_URL;
  return {
    ...opts,
    ...(connector ? { connector } : {}),
    ...(connector === 'drawthing-grpc' ? { grpc: explicit('grpc') ?? (env.DRAWTHING_GRPC || undefined) ?? (same ? engine.grpc : undefined) } : {}),
    ...(connector === 'drawthing' ? { url: explicit('url') ?? (env.DRAWTHING_URL || undefined) ?? (same ? engine.url : undefined) } : {}),
    model: explicit('model') ?? (env.DRAWTHING_MODEL || undefined) ?? (same && !endpointOverride ? engine.model : undefined),
  };
}

export function saveEngineConfig(engine, { cwd = process.cwd() } = {}) {
  const { file, config } = loadEngineConfig({ cwd });
  writeFileSync(file, `${JSON.stringify({ ...config, engine }, null, 2)}\n`);
  return file;
}
