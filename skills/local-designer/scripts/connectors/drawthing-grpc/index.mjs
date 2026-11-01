// Draw Things connector over gRPC: the transport the app uses for its own "server offload" and "Cloud Compute".
// It talks to the same server on the same Mac (port 7859 by default) or on another machine / a cloud box, with
// one extra capability compared with the HTTP API: the full list of models and LoRA the server really has.
// Everything engine specific lives under this folder; the rest of the tool only sees the connector contract
// described in ../../../references/connectors.md.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertSize, parseLora, parseSetting } from '../drawthing.mjs';
import { decodePng, encodePng, readPngText, resizePixels, toRgb } from '../../png.mjs';
import { CONFIG_FIELDS, CONTROL_FIELDS, ENUMS, LORA_FIELDS } from './config-schema.mjs';
import { encodeTable } from './flatbuffers.mjs';
import { collect, fields, message } from './protobuf.mjs';
import { imageToTensor, tensorToImage } from './tensor.mjs';
import { GrpcError, call, isLoopback, openChannel, parseTarget } from './transport.mjs';

export const DEFAULT_TARGET = '127.0.0.1:7859';
export const CLIENT_NAME = 'local-designer';
export const META_KEY = 'local-designer';
const TYPES = { LoRA: LORA_FIELDS, Control: CONTROL_FIELDS };
const LAPTOP = 2;

// ---------------------------------------------------------------------------
// Names <-> enum values
// ---------------------------------------------------------------------------

// "DPM++ 2M Karras" and "DPMPP2MKarras" must match: lower case, "++" -> "pp", everything else non alphanumeric dropped.
const norm = (s) => String(s).toLowerCase().replace(/\+\+/g, 'pp').replace(/[^a-z0-9]/g, '');

export function enumIndex(enumName, value) {
  const names = ENUMS[enumName];
  if (!names) throw new Error(`Unknown enum ${enumName}`);
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < names.length) return value;
  const i = names.findIndex((n) => norm(n) === norm(value));
  if (i < 0) throw new Error(`Unknown ${enumName} "${value}". Valid: ${names.join(', ')}`);
  return i;
}

const SAMPLER_LABEL = (i) => ENUMS.SamplerType[i] ?? String(i);

const RANGES = { u8: [0, 255], u16: [0, 65535], u32: [0, 4294967295], i8: [-128, 127], i16: [-32768, 32767], i32: [-2147483648, 2147483647] };

// One value given with --set key=value, checked against the configuration table.
export function coerceField(name, value) {
  const field = CONFIG_FIELDS.find((f) => f[0] === name);
  if (!field) {
    const close = CONFIG_FIELDS.map((f) => f[0]).filter((n) => n.includes(name) || name.includes(n)).slice(0, 6);
    throw new Error(`Unknown configuration field "${name}"${close.length ? ` (did you mean: ${close.join(', ')}?)` : ''}`);
  }
  const type = field[1];
  if (type === 'str') return String(value);
  if (type === 'bool') {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === 0) return value === 1;
    throw new Error(`${name} must be true or false (got ${value})`);
  }
  if (type.startsWith('enum:')) return enumIndex(type.slice(5), value);
  if (type.startsWith('vec:')) {
    if (!Array.isArray(value)) throw new Error(`${name} must be a JSON array (got ${JSON.stringify(value)})`);
    return value;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got ${value})`);
  if (RANGES[type] && (!Number.isInteger(n) || n < RANGES[type][0] || n > RANGES[type][1])) {
    throw new Error(`${name} must be an integer between ${RANGES[type][0]} and ${RANGES[type][1]} (got ${value})`);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Starting points per model family (calibrate with the user; every value can be overridden)
// ---------------------------------------------------------------------------

export function modelDefaults(spec) {
  const version = String(spec?.version ?? '');
  const size = (Number(spec?.default_scale) || 16) * 64;
  if (spec?.is_consistency_model) return { size, steps: 4, guidance: 1, sampler: 'EulerATrailing' };
  if (version.startsWith('qwen')) return { size, steps: 30, guidance: 4, sampler: 'EulerATrailing' };
  if (version.startsWith('flux2')) return { size, steps: 4, guidance: 1, sampler: 'EulerATrailing' };
  if (version.startsWith('flux')) return { size, steps: 20, guidance: 1, sampler: 'EulerATrailing' };
  return { size, steps: 20, guidance: 7, sampler: 'DPMPP2MKarras' };
}

function resolveModel(session, wanted) {
  const usable = session.models;
  const ask = wanted && wanted !== true ? String(wanted) : process.env.DRAWTHING_MODEL;
  const list = () => usable.map((m) => `${m.file} (${m.name})`).join(', ');
  if (!ask) {
    // The gRPC server has no "current model" (the app's selection is not exposed): pick one, visibly, so that flows
    // that never name a model (mood board, charter) still run. A fast model is preferred for quick drafts.
    const pick = usable.find((m) => m.is_consistency_model) ?? usable[0];
    if (pick) return { ...pick, defaulted: true };
    throw new Error('The server lists no model: pass --model <file> (or env DRAWTHING_MODEL).');
  }
  const n = norm(ask);
  const exact = usable.find((m) => m.file === ask || norm(m.name) === n || norm(m.file) === n || norm(m.file.replace(/\.ckpt$/, '')) === n);
  if (exact) return exact;
  const partial = usable.filter((m) => norm(m.name).includes(n) || norm(m.file).includes(n));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`"${ask}" matches several models: ${partial.map((m) => m.file).join(', ')}`);
  if (!usable.length) return { file: ask, name: ask, version: '' }; // server does not list its models: trust the caller
  throw new Error(`Model "${ask}" not found on the server. Available: ${list()}`);
}

// ---------------------------------------------------------------------------
// Connection options
// ---------------------------------------------------------------------------

export function connectionOptions(opts = {}, env = process.env) {
  const raw = opts.grpc && opts.grpc !== true ? opts.grpc : env.DRAWTHING_GRPC;
  const { host, port } = parseTarget(raw, DEFAULT_TARGET);
  const fingerprint = opts.fingerprint && opts.fingerprint !== true ? opts.fingerprint : env.DRAWTHING_FINGERPRINT;
  const useTls = !opts['no-tls'];
  const insecure = Boolean(opts['insecure-tls']);
  if (!useTls && !isLoopback(host) && !insecure) {
    throw new Error('--no-tls on a non-local host sends prompts in clear text: add --insecure-tls to confirm you accept it.');
  }
  return { host, port, useTls, fingerprint, insecure };
}

// The shared secret never goes on the command line (it would end up in the shell history).
function readSecret(opts, env = process.env) {
  if (opts['secret-file'] && opts['secret-file'] !== true) return readFileSync(resolve(String(opts['secret-file'])), 'utf8').trim();
  return env.DRAWTHING_SECRET ?? '';
}

const SERVER_HINT =
  'Draw Things gRPC server not reachable. In Draw Things, open the advanced settings, enable "API Server" with protocol gRPC ' +
  '(default port 7859), keep the app open, then retry (or set DRAWTHING_GRPC / --grpc host:port).';

const explain = (e) => (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|Timeout/.test(`${e.message}${e.code}`) ? new Error(`${SERVER_HINT} (${e.message || e.code})`) : e);

// ---------------------------------------------------------------------------
// Service calls
// ---------------------------------------------------------------------------

export async function echo(channel, secret, timeoutMs = 10000) {
  const [reply] = await call(channel, 'Echo', message([[1, 'string', CLIENT_NAME], [2, 'string', secret]]), { timeoutMs });
  if (!reply) throw new Error('Empty answer to Echo');
  const f = collect(reply, [2]);
  if (f[4]) throw new Error(secret ? 'The server refused the shared secret (check DRAWTHING_SECRET / --secret-file).' : 'The server requires a shared secret: set DRAWTHING_SECRET (or --secret-file).');
  const ov = f[3] ? collect(f[3]) : {};
  const list = (k) => {
    try {
      const v = JSON.parse(ov[k].toString('utf8'));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  return {
    message: f[1]?.toString() ?? '',
    files: (f[2] ?? []).map((b) => b.toString()),
    models: list(1),
    loras: list(2),
    controlNets: list(3),
    textualInversions: list(4),
    upscalers: list(5),
    override: f[3] ? Buffer.from(f[3]) : Buffer.alloc(0),
    serverId: f[6] === undefined ? null : String(f[6]),
    limited: f[5] !== undefined,
  };
}

export async function filesExist(channel, secret, names) {
  const payload = message([...names.map((n) => [1, 'string', n]), [3, 'string', secret]]);
  const [reply] = await call(channel, 'FilesExist', payload, { timeoutMs: 15000 });
  const f = collect(reply ?? Buffer.alloc(0), [1, 2]);
  const files = (f[1] ?? []).map((b) => b.toString());
  const result = {};
  files.forEach((name, i) => { result[name] = Boolean(f[2]?.[i] !== undefined ? f[2][i][0] ?? Number(f[2][i]) : false); });
  return result;
}

async function channelOf(session) {
  const c = session.channel;
  if (c && !c.client.closed && !c.client.destroyed) return c;
  const fresh = await openChannel({ ...session.openArgs, timeoutMs: 5000 }).catch((e) => { throw explain(e); });
  session.channel = fresh;
  return fresh;
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

function decodeInit(base64, width, height) {
  let image;
  try {
    image = decodePng(Buffer.from(String(base64), 'base64'));
  } catch (e) {
    throw new Error(`Cannot read the init image (${e.message}). Use an 8-bit, non-interlaced PNG.`);
  }
  return resizePixels(toRgb(image), width, height);
}

export function buildConfiguration(session, req, spec, defaults) {
  const width = req.width === undefined ? defaults.size : assertSize('width', req.width);
  const height = req.height === undefined ? defaults.size : assertSize('height', req.height);
  const config = {
    start_width: width / 64,
    start_height: height / 64,
    seed: Number(req.seed ?? 0),
    steps: Number(req.steps ?? defaults.steps),
    guidance_scale: Number(req.guidance ?? defaults.guidance),
    strength: req.initImage ? Number(req.strength ?? 0.7) : 1,
    model: spec.file,
    sampler: enumIndex('SamplerType', req.sampler ?? defaults.sampler),
    batch_count: 1,
    batch_size: 1,
    original_image_width: width,
    original_image_height: height,
    target_image_width: width,
    target_image_height: height,
    negative_original_image_width: width,
    negative_original_image_height: height,
  };
  if (req.shift !== undefined) config.shift = Number(req.shift);
  if (req.seedMode !== undefined) config.seed_mode = enumIndex('SeedMode', req.seedMode);
  if (req.clipSkip !== undefined) config.clip_skip = Number(req.clipSkip);
  const loras = (req.lora ?? []).map(parseLora);
  for (const l of loras) {
    if (session.files.length && !session.files.includes(l.file)) {
      const known = session.files.filter((f) => /lora/i.test(f));
      throw new Error(`LoRA "${l.file}" is not on the server. Available: ${known.join(', ') || 'none'}`);
    }
  }
  if (loras.length) config.loras = loras.map((l) => ({ file: l.file, weight: l.weight }));
  for (const [key, value] of (req.set ?? []).map(parseSetting)) config[key] = coerceField(key, value);
  return config;
}

export function buildGenerateRequest(session, plan, secret = '') {
  const n = plan.native;
  const entries = [
    [2, 'varint', 1],
    [5, 'string', n.prompt],
    [6, 'string', n.negative],
    [7, 'bytes', encodeTable(CONFIG_FIELDS, n.config, TYPES), true],
    [10, 'string', CLIENT_NAME],
    [11, 'varint', LAPTOP],
    [13, 'string', secret],
    [14, 'varint', true],
  ];
  if (n.initTensor) {
    entries.push([1, 'bytes', createHash('sha256').update(n.initTensor).digest()]);
    entries.push([12, 'bytes', n.initTensor]);
  }
  if (session.override.length) entries.push([8, 'bytes', session.override]);
  return message(entries);
}

// ---------------------------------------------------------------------------
// Response reading
// ---------------------------------------------------------------------------

const STAGES = {
  1: 'text-encoded', 2: 'image-encoded', 3: 'sampling', 4: 'image-decoded', 5: 'second-pass-image-encoded',
  6: 'second-pass-sampling', 7: 'second-pass-image-decoded', 8: 'face-restored', 9: 'image-upscaled',
};

export function readResponse(buf, state, onProgress) {
  const f = collect(buf, [1, 3]);
  if (f[2]) {
    for (const s of fields(f[2])) {
      const step = s.field === 3 || s.field === 6 ? Number(collect(s.value)[1] ?? 0n) : undefined;
      onProgress?.({ stage: STAGES[s.field] ?? `stage-${s.field}`, step });
    }
  }
  if (f[7] !== undefined) state.expected = Number(f[7]);
  const more = Number(f[8] ?? 0n) === 1;
  for (const part of f[1] ?? []) {
    state.parts.push(Buffer.from(part));
    if (!more) {
      state.images.push(Buffer.concat(state.parts));
      state.parts = [];
    }
  }
}

const latin1Json = (o) => JSON.stringify(o).replace(/[^\x00-\xff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

export const connector = {
  id: 'drawthing-grpc',
  label: 'Draw Things (gRPC)',
  supports: ['model', 'sampler', 'shift', 'seedMode', 'clipSkip', 'plain', 'lora', 'set', 'initImage', 'strength'],

  async detect(opts = {}) {
    let channel;
    try {
      channel = await openChannel({ ...connectionOptions(opts), timeoutMs: 2000 });
      await echo(channel, readSecret(opts), 3000);
      return true;
    } catch {
      return false;
    } finally {
      channel?.close();
    }
  },

  async connect(opts = {}) {
    const openArgs = connectionOptions(opts);
    const secret = readSecret(opts);
    const channel = await openChannel({ ...openArgs, timeoutMs: 5000 }).catch((e) => { throw explain(e); });
    let info;
    try {
      info = await echo(channel, secret);
    } catch (e) {
      channel.close();
      throw explain(e);
    }
    const usable = info.files.length ? info.models.filter((m) => info.files.includes(m.file)) : info.models;
    const session = {
      target: `${openArgs.host}:${openArgs.port}`,
      where: isLoopback(openArgs.host) ? 'local' : 'remote',
      tls: openArgs.useTls,
      fingerprint: channel.fingerprint,
      server: info.serverId,
      files: info.files,
      models: usable,
      loras: info.loras,
      controlNets: info.controlNets,
      upscalers: info.upscalers,
      limited: info.limited,
    };
    // Kept out of enumeration so that a printed session can never leak the secret or the raw metadata.
    Object.defineProperties(session, {
      channel: { value: channel, writable: true },
      secret: { value: secret },
      override: { value: info.override },
      openArgs: { value: openArgs },
    });
    return session;
  },

  describe(session, { full = false } = {}) {
    const out = {
      target: session.target,
      where: session.where,
      tls: session.tls,
      fingerprint: session.fingerprint,
      server: session.server,
      current: { models: session.models.length, loras: session.loras.length, controlNets: session.controlNets.length },
      models: session.models.map((m) => ({ file: m.file, name: m.name, version: m.version, default_size: (m.default_scale || 16) * 64, fast: Boolean(m.is_consistency_model) })),
      loras: session.loras.map((l) => ({ file: l.file, name: l.name, version: l.version, prefix: l.prefix || undefined })),
    };
    if (session.limited) out.limited = 'The server applies compute-unit thresholds (cloud usage).';
    if (full) Object.assign(out, { controlNets: session.controlNets.map((c) => ({ file: c.file, name: c.name, type: c.type })), files: session.files });
    return out;
  },

  plan(session, req) {
    const spec = resolveModel(session, req.model);
    const defaults = modelDefaults(spec);
    const config = buildConfiguration(session, req, spec, defaults);
    const width = config.start_width * 64;
    const height = config.start_height * 64;
    let initTensor;
    if (req.initImage) initTensor = imageToTensor(decodeInit(req.initImage, width, height));
    const summary = { model: spec.file, width, height, steps: config.steps, guidance_scale: config.guidance_scale, seed: config.seed };
    if (req.initImage) summary.strength = config.strength;
    if (spec.defaulted) summary.model_choice = 'default (no --model given): pass --model to choose';
    const shown = {
      prompt: req.prompt,
      negative_prompt: req.negative ?? '',
      model: spec.file,
      sampler: SAMPLER_LABEL(config.sampler),
      ...Object.fromEntries(Object.entries(config).filter(([k]) => !['model', 'sampler', 'loras'].includes(k))),
      loras: config.loras,
    };
    return {
      mode: req.initImage ? 'img2img' : 'txt2img',
      summary,
      shown,
      negative: req.negative ?? '',
      sidecar: { sampler: SAMPLER_LABEL(config.sampler), shift: config.shift, seed_mode: config.seed_mode, loras: config.loras, overrides: Object.fromEntries((req.set ?? []).map(parseSetting)) },
      native: { prompt: req.prompt, negative: req.negative ?? '', config, initTensor, spec },
    };
  },

  // Sends the plan and returns the PNG bytes. `onProgress({stage, step})` and an AbortSignal are optional.
  async render(session, plan, { timeoutMs = 900000, onProgress, signal } = {}) {
    const channel = await channelOf(session);
    if (!session.files.length) {
      const wanted = [plan.native.config.model, ...(plan.native.config.loras ?? []).map((l) => l.file)];
      const found = await filesExist(channel, session.secret, wanted).catch(() => ({}));
      const missing = wanted.filter((n) => found[n] === false);
      if (missing.length) throw new Error(`Not on the server: ${missing.join(', ')}`);
    }
    const state = { parts: [], images: [], expected: 0 };
    const abort = new AbortController();
    const stop = () => abort.abort();
    signal?.addEventListener('abort', stop, { once: true });
    process.once('SIGINT', stop);
    try {
      await call(channel, 'GenerateImage', buildGenerateRequest(session, plan, session.secret), {
        timeoutMs,
        signal: abort.signal,
        onMessage: (m) => readResponse(m, state, onProgress),
      });
    } catch (e) {
      if (e instanceof GrpcError && e.code === 16) throw new Error('The server refused the shared secret (UNAUTHENTICATED).');
      throw e;
    } finally {
      process.removeListener('SIGINT', stop);
      signal?.removeEventListener('abort', stop);
    }
    if (!state.images.length) {
      throw new Error('The server returned no image. Check the Draw Things app (model download, memory, cancelled job) and retry with smaller --width/--height.');
    }
    const img = tensorToImage(state.images[0]);
    const n = plan.native.config;
    const record = {
      prompt: plan.native.prompt,
      negative_prompt: plan.native.negative,
      model: n.model,
      seed: n.seed,
      steps: n.steps,
      sampler: SAMPLER_LABEL(n.sampler),
      guidance_scale: n.guidance_scale,
      shift: n.shift,
      strength: plan.mode === 'img2img' ? n.strength : undefined,
      size: `${img.width}x${img.height}`,
      loras: n.loras,
      connector: 'drawthing-grpc',
    };
    return encodePng(img, { [META_KEY]: latin1Json(record) });
  },

  // Generation parameters stored by this connector in the PNG it wrote, in the generic shape, or null.
  readMetadata(buf) {
    const raw = readPngText(buf)[META_KEY];
    if (!raw) return null;
    try {
      const j = JSON.parse(raw);
      return { prompt: j.prompt, negative_prompt: j.negative_prompt ?? '', model: j.model, seed: j.seed, steps: j.steps, sampler: j.sampler, guidance_scale: j.guidance_scale, shift: j.shift, strength: j.strength, size: j.size };
    } catch {
      return null;
    }
  },
};
