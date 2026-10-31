#!/usr/bin/env node
// Draw Things HTTP API client (A1111-compatible server) for AI-KIDO.
// Zero dependency, Node >= 18. Commands: status | generate | inspect
import http from 'node:http';
import https from 'node:https';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

export const DEFAULT_URL = 'http://127.0.0.1:7860';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      opts._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else {
      opts[key] = next;
      i += 1;
    }
  }
  return { command, opts };
}

export function assertSize(name, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 256 || n > 4096 || n % 64 !== 0) {
    throw new Error(`${name} must be an integer multiple of 64 between 256 and 4096 (got ${value})`);
  }
  return n;
}

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
  if (o.seed !== undefined) payload.seed = Number(o.seed);
  if (o.steps !== undefined) payload.steps = Number(o.steps);
  if (o.guidance !== undefined) payload.guidance_scale = Number(o.guidance);
  if (o.model !== undefined) payload.model = o.model;
  if (o.plain) Object.assign(payload, { loras: [], controls: [] });
  payload.batch_count = 1;
  payload.batch_size = 1;
  return payload;
}

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
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Not a PNG file');
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
  'with protocol HTTP on port 7860, keep the app open with a model loaded, then retry (or set DRAWTHING_URL).';

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
  return { model: o.model, width: o.width, height: o.height, steps: o.steps, sampler: o.sampler, guidance_scale: o.guidance_scale, loras: (o.loras ?? []).length, controls: (o.controls ?? []).length };
}

async function cmdStatus(opts) {
  const url = opts.url ?? process.env.DRAWTHING_URL ?? DEFAULT_URL;
  const options = await fetchOptions(url);
  return { status: 'ok', url, current: summarizeOptions(options) };
}

async function cmdGenerate(opts) {
  const url = opts.url ?? process.env.DRAWTHING_URL ?? DEFAULT_URL;
  if (!opts.out || opts.out === true) throw new Error('--out <file.png> is required');
  const out = resolve(String(opts.out));
  if (!out.toLowerCase().endsWith('.png')) throw new Error('--out must end with .png');

  const from = opts.from ? extractPngMetadata(readFileSync(resolve(String(opts.from)))) : null;
  if (opts.from && !from) throw new Error(`No Draw Things metadata found in ${opts.from}`);
  let prompt = opts.prompt;
  if (opts['prompt-file']) prompt = readFileSync(resolve(String(opts['prompt-file'])), 'utf8').trim();
  prompt = prompt && prompt !== true ? prompt : from?.prompt;
  if (!prompt) throw new Error('Provide --prompt, --prompt-file or --from <png>');

  const seed = opts.seed !== undefined ? Number(opts.seed) : from?.seed ?? Math.floor(Math.random() * 2 ** 31);
  const overrides = {
    prompt,
    negative: opts.negative === undefined ? from?.negative_prompt : opts.negative,
    width: opts.width,
    height: opts.height,
    seed,
    steps: opts.steps ?? from?.steps,
    guidance: opts.guidance ?? from?.guidance_scale,
    model: opts.model ?? from?.model,
    plain: Boolean(opts.plain),
  };
  // Only the overrides are sent: the GET /options snapshot contains values the server then rejects
  // on txt2img (hires_fix_width 0, tea_cache_end -1), so unspecified settings come from the app itself.
  const current = await fetchOptions(url);
  const payload = buildPayload({}, overrides);
  const pick = (key) => payload[key] ?? current[key];
  const summary = { model: pick('model'), width: pick('width'), height: pick('height'), steps: pick('steps'), guidance_scale: pick('guidance_scale'), seed: payload.seed };
  if (opts['dry-run']) return { status: 'dry-run', summary, prompt };

  const timeoutMs = Number(opts.timeout ?? 900) * 1000;
  const started = Date.now();
  const res = await httpJson(`${url}/sdapi/v1/txt2img`, { method: 'POST', body: payload, timeoutMs });
  const image = res.images?.[0];
  if (!image) throw new Error(`No image in response: ${JSON.stringify(res).slice(0, 300)}`);
  const png = Buffer.from(String(image).split(',').pop(), 'base64');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);

  const result = { status: 'ok', output: out, bytes: png.length, seconds: Math.round((Date.now() - started) / 1000), summary };
  if (opts.webp) {
    const webp = out.replace(/\.png$/i, '.webp');
    const quality = String(opts.quality ?? 82);
    const run = spawnSync('cwebp', ['-q', quality, '-m', '6', out, '-o', webp], { encoding: 'utf8' });
    if (run.status !== 0) result.webp_error = (run.stderr || run.error?.message || 'cwebp failed').trim().slice(0, 300);
    else result.webp = webp;
  }
  if (opts.sidecar) {
    const side = out.replace(/\.png$/i, '.json');
    writeFileSync(side, `${JSON.stringify({ prompt, negative_prompt: payload.negative_prompt ?? '', ...summary, sampler: pick('sampler'), shift: pick('shift') }, null, 2)}\n`);
    result.sidecar = side;
  }
  return result;
}

function cmdInspect(opts) {
  const file = opts._[0];
  if (!file) throw new Error('Usage: inspect <image.png>');
  const meta = extractPngMetadata(readFileSync(resolve(file)));
  if (!meta) throw new Error('No Draw Things metadata found in this PNG (WebP/JPEG copies lose it)');
  return { status: 'ok', file: resolve(file), metadata: meta };
}

const USAGE = `Usage: drawthing.mjs <command> [options]
  status                         Check the API server and show the current app settings
  generate --out f.png (--prompt "..." | --prompt-file f.txt | --from ref.png)
           [--width 1664 --height 832 --seed N --steps N --guidance N --model name.ckpt]
           [--negative "..."] [--plain] [--webp [--quality 82]] [--sidecar] [--dry-run] [--timeout 900]
  inspect <image.png>            Print the prompt and parameters stored in a Draw Things PNG
Environment: DRAWTHING_URL (default ${DEFAULT_URL})`;

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  try {
    let result;
    if (command === 'status') result = await cmdStatus(opts);
    else if (command === 'generate') result = await cmdGenerate(opts);
    else if (command === 'inspect') result = cmdInspect(opts);
    else {
      process.stderr.write(`${USAGE}\n`);
      process.exit(command ? 2 : 0);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'error', error: error.message }, null, 2)}\n`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
