// Vision: an OPTIONAL local vision-language model (VL) can read the images the skill has to judge.
// It is set in the project's `.local-designer.json` ("vision": { "url", "model" }) by the user. Without it, or when it
// does not answer, the agent's current model reads the images itself, silently (see references/vision.md).
// The tool never picks or writes a model by itself.
// The server speaks the OpenAI chat API (LM Studio, Ollama /v1, llama.cpp, vLLM, mlx-vlm...). Local by default:
// an image never leaves the machine unless the user agreed (--allow-remote).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CONFIG_FILE, findConfig } from './design-target.mjs';
import { isLocalUrl } from './connectors/drawthing.mjs';

export const VISION_DEFAULT_URL = 'http://127.0.0.1:1234/v1';
export const MAX_IMAGES = 4;
const DEFAULT_MAX_SIDE = 1024;

const clean = (url) => String(url).replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Pinned model: config file, then environment
// ---------------------------------------------------------------------------

// { url, model, source } - `model` is undefined when nothing is pinned.
export function loadVisionConfig({ env = process.env, cwd = process.cwd() } = {}) {
  const file = findConfig(cwd);
  let fromFile = {};
  if (file) {
    let config;
    try { config = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { throw new Error(`${file} is not valid JSON: ${error.message}`); }
    fromFile = config.vision ?? {};
  }
  // An empty variable counts as unset: it must not hide the model pinned in the project.
  const url = clean(env.LOCAL_DESIGNER_VISION_URL || fromFile.url || VISION_DEFAULT_URL);
  const model = env.LOCAL_DESIGNER_VISION_MODEL || fromFile.model || undefined;
  const source = env.LOCAL_DESIGNER_VISION_MODEL ? 'env LOCAL_DESIGNER_VISION_MODEL' : fromFile.model ? file : 'not pinned';
  return { url, model, source, file };
}

// Writes the pin in the nearest .local-designer.json (created in `cwd` when the project has none).
export function pinVision({ model, url, cwd = process.cwd() }) {
  if (!model) throw new Error('vision pin needs --model <id> (see: vision models)');
  const file = findConfig(cwd) ?? join(resolve(cwd), CONFIG_FILE);
  const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  config.vision = { url: clean(url ?? config.vision?.url ?? VISION_DEFAULT_URL), model: String(model) };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return { file, vision: config.vision };
}

// The one place that decides whether an image may be sent to this server.
export function assertAllowed(cfg, { allowRemote = false } = {}) {
  if (!isLocalUrl(cfg.url) && !allowRemote) {
    throw new Error(`The vision server ${cfg.url} is not on this machine: the images would leave it. Ask the user, then add --allow-remote.`);
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function getJson(url, fetchFn, timeoutMs = 8000) {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  return res.json();
}

// Models offered by the server. LM Studio also tells which ones read images (`type: "vlm"`); other servers do not.
export async function listVisionModels(cfg, { fetchFn = globalThis.fetch, allowRemote = false } = {}) {
  assertAllowed(cfg, { allowRemote });
  let ids;
  try {
    ids = (await getJson(`${cfg.url}/models`, fetchFn)).data?.map((m) => m.id) ?? [];
  } catch (error) {
    throw new Error(`No vision server at ${cfg.url} (${error.message}). Start LM Studio / Ollama, or set LOCAL_DESIGNER_VISION_URL.`);
  }
  const types = new Map();
  try {
    const rich = await getJson(`${cfg.url.replace(/\/v1$/, '')}/api/v0/models`, fetchFn, 4000);
    for (const m of rich.data ?? []) types.set(m.id, { type: m.type, state: m.state });
  } catch { /* the server does not describe its models: the type stays unknown */ }
  return ids.map((id) => ({ id, type: types.get(id)?.type ?? 'unknown', state: types.get(id)?.state ?? 'unknown' }));
}

export async function visionStatus(cfg, options = {}) {
  const base = { url: cfg.url, local: isLocalUrl(cfg.url), pinned: cfg.model ?? null, source: cfg.source };
  if (!cfg.model) return { ...base, status: 'not-pinned', next: 'Normal state: no local model is set, the current model reads the images. Optional: vision models, then vision pin --model <id>.' };
  try {
    const models = await listVisionModels(cfg, options);
    const found = models.find((m) => m.id === cfg.model);
    if (!found) return { ...base, status: 'model-missing', error: `The local model "${cfg.model}" is not on the server: the current model reads the images instead. Load it or re-pin to use it again.` };
    if (found.type === 'llm') return { ...base, status: 'not-a-vision-model', error: `"${cfg.model}" is a text-only model on this server.` };
    return { ...base, status: 'ok', type: found.type, state: found.state };
  } catch (error) {
    return { ...base, status: 'unreachable', error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

const MAGIC = [[[0x89, 0x50, 0x4e, 0x47], 'image/png'], [[0xff, 0xd8, 0xff], 'image/jpeg']];
const mimeOf = (buf) => MAGIC.find(([sig]) => sig.every((b, i) => buf[i] === b))?.[1];

// PNG data URL, longest side limited (a VL model reads about 1000 px; more only costs time).
// Converts any format ImageMagick or sips can read; PNG and JPEG pass through when neither is installed.
export function prepareImage(file, { maxSide = DEFAULT_MAX_SIDE } = {}) {
  const path = resolve(file);
  if (!existsSync(path)) throw new Error(`Image not found: ${file}`);
  const dir = mkdtempSync(join(tmpdir(), 'local-designer-vision-'));
  const out = join(dir, 'v.png');
  try {
    const mg = spawnSync('magick', [`${path}[0]`, '-background', 'white', '-alpha', 'remove', '-resize', `${maxSide}x${maxSide}>`, out]);
    if (mg.status === 0 && existsSync(out)) return toDataUrl(readFileSync(out), 'image/png');
    const sp = spawnSync('sips', ['-Z', String(maxSide), '-s', 'format', 'png', path, '--out', out], { encoding: 'utf8' });
    if (sp.status === 0 && existsSync(out)) return toDataUrl(readFileSync(out), 'image/png');
    const raw = readFileSync(path);
    const mime = mimeOf(raw);
    if (mime) return toDataUrl(raw, mime);
    throw new Error('Cannot read this image: install ImageMagick (brew install imagemagick) or use png / jpg.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const toDataUrl = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`;

// ---------------------------------------------------------------------------
// Question to the model
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = [
  'You are an image analyst. You look at the image(s) and report only what is visible.',
  'Never guess: when something cannot be seen clearly, write "unclear" rather than inventing it.',
  'Count what you are asked to count (fingers, eyes, limbs) by looking at them one by one.',
  'Quote any text you can read exactly; if there is none, say so.',
  'Be short and concrete. Answer in the language of the question.',
].join(' ');

// Removes the reasoning block some models print before the answer.
export const stripThinking = (text) => String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

// JSON from a reply that may carry a code fence or a sentence around it; null when there is none.
export function parseJsonReply(text) {
  const body = stripThinking(text);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(body)?.[1];
  for (const candidate of [fenced, body, body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* try the next form */ }
  }
  return null;
}

// Ask the pinned model about 1 to MAX_IMAGES images.
export async function askVision(cfg, { images, prompt, system = SYSTEM_PROMPT, maxTokens = 4096, timeout = 300, seed = 42, maxSide, allowRemote = false, fetchFn = globalThis.fetch }) {
  if (!cfg.model) throw new Error('No local vision model is set for this project: the current model reads the image itself (vision checks prints the checklist). Optional: vision models, then vision pin --model <id>.');
  assertAllowed(cfg, { allowRemote });
  if (!images?.length) throw new Error('vision needs at least one image');
  if (images.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images per question (got ${images.length}).`);
  if (!prompt) throw new Error('vision needs a question (--prompt "...")');
  const content = [{ type: 'text', text: prompt }, ...images.map((file) => ({ type: 'image_url', image_url: { url: prepareImage(file, { maxSide }) } }))];
  const body = { model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content }], temperature: 0, seed, max_tokens: maxTokens, stream: false };
  const started = Date.now();
  let res;
  try {
    res = await fetchFn(`${cfg.url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout * 1000) });
  } catch (error) {
    throw new Error(`The vision model ${cfg.model} did not answer at ${cfg.url} (${error.message}).`);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`The local vision model ${cfg.model} refused the request (HTTP ${res.status}): ${detail}. The current model reads the image instead.`);
  }
  const data = await res.json();
  const message = data.choices?.[0]?.message ?? {};
  const answer = stripThinking(message.content);
  if (!answer) {
    throw new Error(message.reasoning_content
      ? `The model spent its ${maxTokens} tokens reasoning and gave no answer: raise --max-tokens.`
      : `The model ${cfg.model} returned an empty answer.`);
  }
  return {
    status: 'ok', model: data.model ?? cfg.model, source: cfg.source, url: cfg.url, local: isLocalUrl(cfg.url),
    images: images.map((f) => resolve(f)), seed, seconds: Math.round((Date.now() - started) / 100) / 10,
    tokens: data.usage?.total_tokens, answer,
  };
}

// ---------------------------------------------------------------------------
// Review: a checklist answered pass / fail / unclear
// ---------------------------------------------------------------------------

export const DEFAULT_CHECKS = [
  'There is no readable text, letters, numbers, logo or watermark in the image',
  'Hands show the right number of fingers and look natural',
  'No limb, eye or object is duplicated, fused or cut off by mistake',
  'The main subject is entirely inside the frame',
  'No visible artefact: melted shapes, smeared areas, stray marks',
];

// Checks written from a client brief: its subject, its forbidden list and its constraints.
export function checksFromBrief(brief) {
  const checks = [];
  if (brief.subject) checks.push(`The image shows: ${brief.subject}`);
  for (const item of brief.brand?.forbidden ?? []) checks.push(`The image does not show: ${item}`);
  for (const item of brief.constraints ?? []) checks.push(String(item));
  return checks;
}

export function reviewPrompt(checks, { context } = {}) {
  const list = checks.map((c, i) => `${i + 1}. ${c}`).join('\n');
  return [
    context ? `Context: ${context}` : null,
    'Check the image against this list, one line each. Look before you answer.',
    list,
    'Reply with JSON only, no other text:',
    '{"summary": "one sentence on what the image shows",',
    ' "checks": [{"n": 1, "result": "pass|fail|unclear", "evidence": "what you see"}],',
    ' "problems": [{"where": "place in the image", "what": "defect", "severity": "minor|major"}],',
    ' "text_in_image": "exact text read, or none"}',
  ].filter(Boolean).join('\n');
}

// Reads the model's JSON and returns a verdict: ok when every check passes, to-check when one is unclear, fail otherwise.
export function summariseReview(checks, reply) {
  const json = parseJsonReply(reply);
  if (!json || !Array.isArray(json.checks)) return { verdict: 'unparsed', checks: [], problems: [], raw: stripThinking(reply).slice(0, 1500) };
  const rows = checks.map((check, i) => {
    const row = json.checks.find((c) => Number(c.n) === i + 1) ?? json.checks[i] ?? {};
    const result = ['pass', 'fail', 'unclear'].includes(row.result) ? row.result : 'unclear';
    return { n: i + 1, check, result, evidence: row.evidence ?? '' };
  });
  const verdict = rows.some((r) => r.result === 'fail') ? 'fail' : rows.some((r) => r.result === 'unclear') ? 'to-check' : 'ok';
  return { verdict, summary: json.summary ?? '', checks: rows, problems: Array.isArray(json.problems) ? json.problems : [], text_in_image: json.text_in_image ?? 'none' };
}
