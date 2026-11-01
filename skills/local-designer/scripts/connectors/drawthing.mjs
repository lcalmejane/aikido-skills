// Draw Things connector: the macOS app's A1111-compatible HTTP API (/sdapi/v1/*).
// Everything that is specific to this engine lives here; the rest of the tool only sees the
// connector contract described in ../../references/connectors.md.
import http from 'node:http';
import https from 'node:https';
import { inflateSync } from 'node:zlib';
import { isPng } from '../png.mjs';

export const DEFAULT_URL = 'http://127.0.0.1:7860';

// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------

export function assertSize(name, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 256 || n > 4096 || n % 64 !== 0) {
    throw new Error(`${name} must be an integer multiple of 64 between 256 and 4096 (got ${value})`);
  }
  return n;
}

function num(name, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got ${value})`);
  return n;
}

// "key=value" -> [key, parsed value]. The value is parsed as JSON when possible (true, 3, 0.5, [..]).
export function parseSetting(text) {
  const i = String(text).indexOf('=');
  if (i < 1) throw new Error(`--set expects key=value (got ${text})`);
  const key = text.slice(0, i).trim();
  const raw = text.slice(i + 1).trim();
  let value = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    // keep the raw string
  }
  return [key, value];
}

// "file.ckpt:0.6" -> { file, weight }. Weight defaults to 1.
export function parseLora(text) {
  const s = String(text);
  const i = s.lastIndexOf(':');
  if (i > 0 && /^-?\d*\.?\d+$/.test(s.slice(i + 1))) return { file: s.slice(0, i), weight: Number(s.slice(i + 1)) };
  return { file: s, weight: 1 };
}

export function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Request payload
// ---------------------------------------------------------------------------

export function buildPayload(base, o = {}) {
  const payload = { ...base };
  if (o.prompt !== undefined) payload.prompt = o.prompt;
  if (o.negative !== undefined) payload.negative_prompt = o.negative;
  if (o.width !== undefined) {
    const w = assertSize('width', o.width);
    Object.assign(payload, { width: w, original_width: w, target_width: w });
  }
  if (o.height !== undefined) {
    const h = assertSize('height', o.height);
    Object.assign(payload, { height: h, original_height: h, target_height: h });
  }
  if (o.sampler !== undefined) payload.sampler = o.sampler;
  if (o.shift !== undefined) payload.shift = num('shift', o.shift);
  if (o.seed !== undefined) payload.seed = num('seed', o.seed);
  if (o.steps !== undefined) payload.steps = num('steps', o.steps);
  if (o.guidance !== undefined) payload.guidance_scale = num('guidance', o.guidance);
  if (o.strength !== undefined) payload.strength = num('strength', o.strength);
  if (o.seedMode !== undefined) payload.seed_mode = o.seedMode;
  if (o.clipSkip !== undefined) payload.clip_skip = num('clip-skip', o.clipSkip);
  if (o.model !== undefined) payload.model = o.model;
  if (o.plain) Object.assign(payload, { loras: [], controls: [] });
  if (o.loras?.length) payload.loras = [...(o.plain ? [] : (payload.loras ?? [])), ...o.loras];
  if (o.initImage !== undefined) payload.init_images = [o.initImage];
  if (o.set) Object.assign(payload, o.set);
  payload.batch_count = 1;
  payload.batch_size = 1;
  return payload;
}

// ---------------------------------------------------------------------------
// Metadata stored by Draw Things in its PNG files (XMP block)
// ---------------------------------------------------------------------------

export function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function readTextChunk(type, data) {
  const k = data.indexOf(0);
  if (k < 0) return null;
  const keyword = data.toString('latin1', 0, k);
  if (type === 'tEXt') return { keyword, text: data.toString('latin1', k + 1) };
  const flag = data[k + 1];
  let p = data.indexOf(0, k + 3);
  if (p < 0) return null;
  p = data.indexOf(0, p + 1);
  if (p < 0) return null;
  let body = data.subarray(p + 1);
  if (flag === 1) body = inflateSync(body);
  return { keyword, text: body.toString('utf8') };
}

// Reads the generation parameters Draw Things stores in the PNG XMP block.
export function extractPngMetadata(buf) {
  if (!isPng(buf)) throw new Error('Not a PNG file');
  const texts = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (type === 'iTXt' || type === 'tEXt') {
      const chunk = readTextChunk(type, buf.subarray(off + 8, off + 8 + len));
      if (chunk) texts.push(chunk);
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const xmp = texts.find((t) => t.keyword === 'XML:com.adobe.xmp');
  if (!xmp) return null;
  const values = [...xmp.text.matchAll(/<rdf:li[^>]*xml:lang="x-default"[^>]*>([\s\S]*?)<\/rdf:li>/g)].map((m) => decodeEntities(m[1]));
  const jsonText = values.find((v) => v.trim().startsWith('{'));
  if (jsonText) {
    try {
      const j = JSON.parse(jsonText);
      return {
        prompt: j.c,
        negative_prompt: j.uc ?? '',
        model: j.model,
        seed: j.seed,
        steps: j.steps,
        sampler: j.sampler,
        guidance_scale: j.scale,
        shift: j.shift,
        strength: j.strength,
        size: j.size,
      };
    } catch {
      // fall back to the textual description below
    }
  }
  const desc = values[0];
  if (!desc) return null;
  const idx = desc.lastIndexOf('\nSteps:');
  if (idx < 0) return { prompt: desc };
  const meta = { prompt: desc.slice(0, idx) };
  for (const part of desc.slice(idx + 1).split(', ')) {
    const [key, ...val] = part.split(': ');
    const v = val.join(': ');
    if (key === 'Steps') meta.steps = Number(v);
    else if (key === 'Sampler') meta.sampler = v;
    else if (key === 'Guidance Scale') meta.guidance_scale = Number(v);
    else if (key === 'Seed') meta.seed = Number(v);
    else if (key === 'Size') meta.size = v;
    else if (key === 'Model') meta.model = v;
  }
  return meta;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export function httpJson(url, { method = 'GET', body, timeoutMs = 30000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      reject(new Error(`Unsupported protocol ${u.protocol}`));
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {};
    const req = lib.request(u, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} on ${u.pathname}: ${text.slice(0, 300)}`));
          return;
        }
        try {
          resolvePromise(JSON.parse(text));
        } catch {
          reject(new Error(`Invalid JSON from ${u.pathname}: ${text.slice(0, 200)}`));
        }
      });
    });
    // Idle-socket timeout: a generation sends nothing until it is finished.
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout after ${Math.round(timeoutMs / 1000)}s on ${u.pathname}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const SERVER_HINT =
  'Draw Things API server not reachable. In Draw Things, open the advanced settings, enable "API Server" ' +
  'with protocol HTTP on port 7860, keep the app open with a model loaded, then retry (or set DRAWTHING_URL / --url).';

async function fetchOptions(url) {
  try {
    return await httpJson(`${url}/sdapi/v1/options`, { timeoutMs: 10000 });
  } catch (error) {
    if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|Timeout/.test(String(error.message) + String(error.code))) {
      throw new Error(`${SERVER_HINT} (${error.message || error.code})`);
    }
    throw error;
  }
}

function summarizeOptions(o) {
  return {
    model: o.model,
    width: o.width,
    height: o.height,
    steps: o.steps,
    sampler: o.sampler,
    guidance_scale: o.guidance_scale,
    shift: o.shift,
    seed_mode: o.seed_mode,
    loras: (o.loras ?? []).length,
    controls: (o.controls ?? []).length,
  };
}

const serverUrl = (opts) => String(opts.url && opts.url !== true ? opts.url : process.env.DRAWTHING_URL ?? DEFAULT_URL).replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

export const connector = {
  id: 'drawthing',
  label: 'Draw Things',
  // Optional request keys this engine understands (the generic ones are always required to work).
  supports: ['model', 'sampler', 'shift', 'seedMode', 'clipSkip', 'plain', 'lora', 'set', 'initImage', 'strength'],

  // Cheap probe used by automatic selection: is this engine answering on this machine?
  async detect(opts = {}) {
    try {
      await httpJson(`${serverUrl(opts)}/sdapi/v1/options`, { timeoutMs: 2000 });
      return true;
    } catch {
      return false;
    }
  },

  // Reach the engine and read its current settings. Throws an actionable error when it is not running.
  async connect(opts = {}) {
    const url = serverUrl(opts);
    const app = await fetchOptions(url);
    return { url, where: isLocalUrl(url) ? 'local' : 'remote', app };
  },

  describe(session, { full = false } = {}) {
    const out = { url: session.url, where: session.where, current: summarizeOptions(session.app) };
    if (full) out.settings = session.app;
    return out;
  },

  // Turn a generic request into what will be sent, without sending it.
  plan(session, req) {
    // Only the overrides are sent: the GET /options snapshot contains values the server then rejects
    // on txt2img (hires_fix_width 0, tea_cache_end -1), so unspecified settings come from the app itself.
    const payload = buildPayload({}, {
      prompt: req.prompt,
      negative: req.negative,
      width: req.width,
      height: req.height,
      sampler: req.sampler,
      shift: req.shift,
      seed: req.seed,
      steps: req.steps,
      guidance: req.guidance,
      strength: req.strength,
      seedMode: req.seedMode,
      clipSkip: req.clipSkip,
      model: req.model,
      plain: Boolean(req.plain),
      loras: (req.lora ?? []).map(parseLora),
      set: Object.fromEntries((req.set ?? []).map(parseSetting)),
      initImage: req.initImage,
    });
    const pick = (key) => payload[key] ?? session.app[key];
    const summary = {
      model: pick('model'),
      width: pick('width'),
      height: pick('height'),
      steps: pick('steps'),
      guidance_scale: pick('guidance_scale'),
      seed: payload.seed,
    };
    if (req.initImage) summary.strength = payload.strength;
    const { init_images: _images, prompt: _p, negative_prompt: _n, ...rest } = payload;
    const { init_images: _ignored, ...shown } = payload;
    return {
      mode: req.initImage ? 'img2img' : 'txt2img',
      summary,
      shown,
      negative: payload.negative_prompt ?? '',
      sidecar: { sampler: pick('sampler'), shift: pick('shift'), seed_mode: pick('seed_mode'), overrides: rest },
      native: payload,
    };
  },

  // Send the plan and return the PNG bytes.
  async render(session, plan, { timeoutMs = 900000 } = {}) {
    const res = await httpJson(`${session.url}/sdapi/v1/${plan.mode}`, { method: 'POST', body: plan.native, timeoutMs });
    const image = res.images?.[0];
    if (!image) throw new Error(`No image in response: ${JSON.stringify(res).slice(0, 300)}`);
    return Buffer.from(String(image).split(',').pop(), 'base64');
  },

  // Generation parameters the engine stored in one of its own PNG files, in the generic shape, or null.
  readMetadata: extractPngMetadata,
};
