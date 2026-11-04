import { arch, platform, totalmem } from 'node:os';
import { spawnSync } from 'node:child_process';
import { engineOptions, saveEngineConfig } from './engine-config.mjs';
import { getConnector } from './connectors/index.mjs';
import { isLocalUrl } from './connectors/drawthing.mjs';
import { isLoopback, parseTarget } from './connectors/drawthing-grpc/transport.mjs';

function assertLocal(opts) {
  if (opts.url && !isLocalUrl(opts.url)) throw new Error('Discovery only probes loopback. Configure remote endpoints explicitly with setup --allow-remote.');
  if (opts.grpc && !isLoopback(parseTarget(opts.grpc).host)) throw new Error('Discovery only probes loopback. Configure remote endpoints explicitly with setup --allow-remote.');
}

export async function inspectEngine(opts, { connect = async (id, args) => getConnector(id).connect(args) } = {}) {
  const session = await connect(opts.connector, opts);
  return { connector: opts.connector, ...getConnector(opts.connector).describe(session, { full: true }) };
}

export async function discoverEngines(opts = {}, context = {}) {
  const resolved = engineOptions(opts, context);
  const candidates = [
    { connector: 'drawthing-grpc', grpc: '127.0.0.1:7860' },
    { connector: 'drawthing', url: 'http://127.0.0.1:7860' },
    { connector: 'drawthing-grpc', grpc: '127.0.0.1:7859' },
  ];
  if (resolved.connector === 'drawthing' || resolved.connector === 'drawthing-grpc') {
    assertLocal(resolved);
    candidates.unshift(resolved);
  }
  const seen = new Set();
  const probes = [];
  for (const candidate of candidates) {
    const key = `${candidate.connector}:${candidate.grpc ?? candidate.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      probes.push({ status: 'ok', ...await inspectEngine(candidate, context) });
    } catch (error) {
      probes.push({ status: 'unreachable', connector: candidate.connector, target: candidate.grpc ?? candidate.url, error: error.message });
    }
  }
  return {
    status: probes.some((probe) => probe.status === 'ok') ? 'ok' : 'unavailable',
    machine: { platform: platform(), architecture: arch(), memoryGiB: Math.round(totalmem() / 1024 ** 3) },
    tools: Object.fromEntries(['cwebp', 'magick', 'sips'].map((name) => [name, spawnSync('which', [name], { encoding: 'utf8' }).status === 0])),
    probes,
  };
}

export async function setupEngine(opts = {}, context = {}) {
  let resolved = engineOptions(opts, context);
  if (resolved.url) {
    const url = new URL(resolved.url);
    if (url.username || url.password || url.search || url.hash) throw new Error('Do not persist credentials or query parameters in an engine URL.');
  }
  let report;
  if (!resolved.connector || resolved.connector === 'auto') {
    const discovery = await discoverEngines(opts, context);
    const available = discovery.probes.filter((probe) => probe.status === 'ok');
    if (available.length !== 1) throw new Error(`Found ${available.length} local engines. Run discover, then setup --connector <id> with --grpc host:port or --url URL to select one explicitly.`);
    report = available[0];
    resolved = { ...resolved, connector: report.connector, grpc: report.target, url: report.url };
  } else {
    if (!['drawthing', 'drawthing-grpc'].includes(resolved.connector)) throw new Error('setup supports drawthing or drawthing-grpc');
    if (!opts['allow-remote']) assertLocal(resolved);
    report = await inspectEngine(resolved, context);
  }
  const engine = { connector: resolved.connector };
  if (engine.connector === 'drawthing-grpc') engine.grpc = report.target;
  else engine.url = report.url;
  if (resolved.model) {
    const models = report.models ?? [];
    if (models.length && !models.some((model) => model.file === resolved.model)) throw new Error(`Model "${resolved.model}" is not listed by the server; setup leaves the configuration unchanged.`);
    engine.model = resolved.model;
  }
  engine.verified_at = new Date().toISOString();
  const file = saveEngineConfig(engine, context);
  return {
    status: 'ok', file, engine,
    warnings: report.connector === 'drawthing-grpc' && !report.models?.length
      ? [resolved.model
        ? 'The server lists no models. The supplied model is saved, but its availability can only be confirmed by generation.'
        : 'The server lists no models. Supply a model filename confirmed in the app before generating; connection success does not prove a model is available.'] : [],
  };
}
