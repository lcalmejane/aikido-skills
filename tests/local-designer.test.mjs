import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStyle,
  assertSize,
  buildJobs,
  buildPayload,
  decodeEntities,
  expandVary,
  extractPngMetadata,
  insideGitRepo,
  isLocalUrl,
  loadStyles,
  parseArgs,
  parseLora,
  parseSetting,
  renderIndexHtml,
} from '../skills/local-designer/scripts/local-designer.mjs';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, data, Buffer.alloc(4)]);
}

function pngWithXmp(xmp) {
  const body = Buffer.concat([
    Buffer.from('XML:com.adobe.xmp', 'latin1'),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(xmp, 'utf8'),
  ]);
  return Buffer.concat([SIGNATURE, chunk('iTXt', body), chunk('IEND', Buffer.alloc(0))]);
}

test('parseArgs reads flags, values and positionals', () => {
  const { command, opts } = parseArgs(['generate', '--out', 'a.png', '--webp', '--seed', '7', 'x.png']);
  assert.equal(command, 'generate');
  assert.equal(opts.out, 'a.png');
  assert.equal(opts.webp, true);
  assert.equal(opts.seed, '7');
  assert.deepEqual(opts._, ['x.png']);
});

test('assertSize accepts multiples of 64 and rejects the rest', () => {
  assert.equal(assertSize('width', '1664'), 1664);
  assert.throws(() => assertSize('width', 1000), /multiple of 64/);
  assert.throws(() => assertSize('height', 64), /multiple of 64/);
});

test('buildPayload overrides prompt and size consistently without mutating the base', () => {
  const base = { prompt: 'old', width: 1728, height: 960, original_width: 1728, target_width: 1728, original_height: 960, target_height: 960, loras: [{ file: 'x' }], controls: [], steps: 16 };
  const payload = buildPayload(base, { prompt: 'new', width: 1664, height: 832, seed: '42', plain: true });
  assert.equal(payload.prompt, 'new');
  assert.deepEqual([payload.width, payload.original_width, payload.target_width], [1664, 1664, 1664]);
  assert.deepEqual([payload.height, payload.original_height, payload.target_height], [832, 832, 832]);
  assert.equal(payload.seed, 42);
  assert.deepEqual(payload.loras, []);
  assert.equal(payload.batch_count, 1);
  assert.equal(base.prompt, 'old');
  assert.equal(base.loras.length, 1);
});

test('buildPayload with an empty base only carries the overrides', () => {
  const payload = buildPayload({}, { prompt: 'p', width: 512, height: 256, seed: 1 });
  assert.deepEqual(Object.keys(payload).sort(), ['batch_count', 'batch_size', 'height', 'original_height', 'original_width', 'prompt', 'seed', 'target_height', 'target_width', 'width']);
});

test('decodeEntities handles newline, hex and ampersand', () => {
  assert.equal(decodeEntities('a&#xA;b &lt;c&gt; &amp;amp;'), 'a\nb <c> &amp;');
});

test('extractPngMetadata prefers the JSON block', () => {
  const json = JSON.stringify({ c: 'a prompt', model: 'm.ckpt', seed: 5, steps: 16, scale: 4, sampler: 'Euler A Trailing', size: '1408x704' }).replace(/"/g, '&quot;');
  const xmp = `<x><rdf:li xml:lang="x-default">${json}</rdf:li></x>`;
  const meta = extractPngMetadata(pngWithXmp(xmp));
  assert.equal(meta.prompt, 'a prompt');
  assert.equal(meta.model, 'm.ckpt');
  assert.equal(meta.seed, 5);
  assert.equal(meta.guidance_scale, 4);
});

test('extractPngMetadata falls back to the text description', () => {
  const xmp = '<x><rdf:li xml:lang="x-default">hello world.&#xA;Steps: 16, Sampler: Euler A Trailing, Guidance Scale: 4.0, Seed: 9, Size: 1408x704, Model: q.ckpt</rdf:li></x>';
  const meta = extractPngMetadata(pngWithXmp(xmp));
  assert.equal(meta.prompt, 'hello world.');
  assert.equal(meta.steps, 16);
  assert.equal(meta.seed, 9);
  assert.equal(meta.model, 'q.ckpt');
});

test('extractPngMetadata rejects non-PNG input and returns null without XMP', () => {
  assert.throws(() => extractPngMetadata(Buffer.from('nope nope nope')), /Not a PNG/);
  assert.equal(extractPngMetadata(Buffer.concat([SIGNATURE, chunk('IEND', Buffer.alloc(0))])), null);
});

test('parseArgs collects repeatable flags', () => {
  const { opts } = parseArgs(['generate', '--lora', 'a.ckpt:0.5', '--lora', 'b.ckpt', '--set', 'x=1', '--vary', 'steps=8,16']);
  assert.deepEqual(opts.lora, ['a.ckpt:0.5', 'b.ckpt']);
  assert.deepEqual(opts.set, ['x=1']);
  assert.deepEqual(opts.vary, ['steps=8,16']);
  assert.throws(() => parseArgs(['generate', '--lora']), /needs a value/);
});

test('parseSetting parses JSON values and keeps strings', () => {
  assert.deepEqual(parseSetting('tiled_decoding=true'), ['tiled_decoding', true]);
  assert.deepEqual(parseSetting('shift=4.5'), ['shift', 4.5]);
  assert.deepEqual(parseSetting('sampler=DPM++ 2M'), ['sampler', 'DPM++ 2M']);
  assert.throws(() => parseSetting('novalue'), /key=value/);
});

test('parseLora reads an optional weight', () => {
  assert.deepEqual(parseLora('x.ckpt:0.6'), { file: 'x.ckpt', weight: 0.6 });
  assert.deepEqual(parseLora('x.ckpt'), { file: 'x.ckpt', weight: 1 });
});

test('buildPayload handles img2img, loras and raw settings', () => {
  const p = buildPayload({ loras: [{ file: 'app.ckpt', weight: 1 }] }, { initImage: 'AAA', strength: '0.6', loras: [{ file: 'n.ckpt', weight: 0.5 }], set: { tiled_decoding: true }, seedMode: 'Scale Alike' });
  assert.deepEqual(p.init_images, ['AAA']);
  assert.equal(p.strength, 0.6);
  assert.equal(p.loras.length, 2);
  assert.equal(p.tiled_decoding, true);
  assert.equal(p.seed_mode, 'Scale Alike');
  const plain = buildPayload({ loras: [{ file: 'app.ckpt' }] }, { plain: true, loras: [{ file: 'n.ckpt', weight: 1 }] });
  assert.deepEqual(plain.loras, [{ file: 'n.ckpt', weight: 1 }]);
  assert.throws(() => buildPayload({}, { steps: 'abc' }), /number/);
});

test('bundled styles are valid and carry no project branding', () => {
  const styles = loadStyles();
  assert.ok(Object.keys(styles).length >= 10);
  for (const s of Object.values(styles)) {
    assert.ok(s.name && s.description && s.template.includes('{subject}'), s.name);
    assert.doesNotMatch(JSON.stringify(s), /ai-?kido|aikido/i);
  }
  assert.match(applyStyle(styles.watercolor, 'a fox'), /watercolour painting of a fox\./);
  assert.equal(applyStyle({ template: 'moody' }, 'a fox'), 'a fox. moody');
});

test('expandVary and buildJobs make the cartesian product', () => {
  assert.equal(expandVary(['steps=8,16', 'guidance=3,5']).length, 4);
  assert.deepEqual(expandVary(), [{}]);
  assert.throws(() => expandVary(['bad']), /key=v1/);
  const jobs = buildJobs({ styles: ['a', 'b'], seeds: ['1', '2'], vary: ['steps=8,16'] });
  assert.equal(jobs.length, 8);
  assert.equal(new Set(jobs.map((j) => j.name)).size, 8);
});

test('isLocalUrl and insideGitRepo', () => {
  assert.equal(isLocalUrl('http://127.0.0.1:7860'), true);
  assert.equal(isLocalUrl('http://192.168.1.2:7860'), false);
  assert.equal(insideGitRepo(new URL('../skills', import.meta.url).pathname), true);
  assert.equal(insideGitRepo('/tmp/local-designer-not-a-repo-xyz'), false);
});

test('renderIndexHtml escapes content and lists errors', () => {
  const html = renderIndexHtml('t<1>', [{ name: 'a', file: 'a.png', label: 'x', prompt: '<b>' }, { name: 'b', file: 'b.png', error: 'boom' }]);
  assert.match(html, /t&lt;1&gt;/);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /class="err">boom/);
});
