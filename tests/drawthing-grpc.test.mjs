import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http2 from 'node:http2';
import test from 'node:test';
import { decodePng, encodePng, readPngText, resizePixels, toRgb } from '../skills/local-designer/scripts/png.mjs';
import { CONFIG_FIELDS, ENUMS, LORA_FIELDS } from '../skills/local-designer/scripts/connectors/drawthing-grpc/config-schema.mjs';
import { decodeTable, encodeTable } from '../skills/local-designer/scripts/connectors/drawthing-grpc/flatbuffers.mjs';
import { fpzipDecode } from '../skills/local-designer/scripts/connectors/drawthing-grpc/fpzip.mjs';
import {
  coerceField, connectionOptions, connector, enumIndex, modelDefaults,
} from '../skills/local-designer/scripts/connectors/drawthing-grpc/index.mjs';
import { collect, fields, grpcFrame, grpcUnframe, message, varint } from '../skills/local-designer/scripts/connectors/drawthing-grpc/protobuf.mjs';
import { DATATYPE, floatToHalf, halfToFloat, imageToTensor, parseTensor, tensorToImage } from '../skills/local-designer/scripts/connectors/drawthing-grpc/tensor.mjs';
import { parseTarget } from '../skills/local-designer/scripts/connectors/drawthing-grpc/transport.mjs';

// 8x8x3 tensor compressed by the reference fpzip library (precision 19), 256 bytes, header included.
const FPZIP_TENSOR =
  'F3IPAAEAAAACAAAAAAACAAAAAAABAAAACAAAAAgAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABmcHkphw7xEe0C/QAAB/gAAAf4AAAA/wAThL/icFK7Ar6eg1qyPsASyNK1gLQcmX5kzpgQjeEin7NuWcUF72q9l8l15DL/L8IUuosDfWmnvpStkT/cbnMVs94yurWD3p3c2TaVr1XbA2X1u/D/89MRQ7JSIsoT9LmkoDw26I7tNIpUh3GTptaptyXpW753rxejCKQCV3XhcCS6C3yCOo10Z8V7QacRD3mtOBBLBSs5+isqEtRVq42ii7ZYAA==';

// ---------------------------------------------------------------------------
// protobuf
// ---------------------------------------------------------------------------

test('protobuf: varints, strings, floats, nested messages and zero-value omission', () => {
  assert.deepEqual([...varint(300)], [0xac, 0x02]);
  assert.equal(varint(-1).length, 10);
  const inner = message([[1, 'varint', 7], [2, 'string', 'dojo']]);
  const outer = message([[1, 'string', 'hi'], [2, 'bytes', inner], [3, 'varint', 0], [4, 'float', 1.5], [5, 'varint', 0, true]]);
  const f = collect(outer);
  assert.equal(f[1].toString(), 'hi');
  assert.equal(f[3], undefined, 'a zero is omitted');
  assert.equal(f[5], 0n, '... unless it must be kept');
  assert.equal(f[4].readFloatLE(0), 1.5);
  const nested = collect(f[2]);
  assert.equal(nested[1], 7n);
  assert.equal(nested[2].toString(), 'dojo');
  assert.deepEqual([...fields(Buffer.alloc(0))], []);
  assert.throws(() => [...fields(Buffer.from([0x0a, 0x05, 0x01]))], /Truncated/);
});

test('gRPC framing: split and glued frames, and refusal of compressed messages', () => {
  const a = grpcFrame(Buffer.from('one'));
  const b = grpcFrame(Buffer.from('second'));
  const glued = Buffer.concat([a, b]);
  const first = grpcUnframe(glued.subarray(0, a.length + 3));
  assert.deepEqual(first.messages.map(String), ['one']);
  const second = grpcUnframe(Buffer.concat([first.rest, glued.subarray(a.length + 3)]));
  assert.deepEqual(second.messages.map(String), ['second']);
  assert.equal(second.rest.length, 0);
  const compressed = Buffer.from(a);
  compressed[0] = 1;
  assert.throws(() => grpcUnframe(compressed), /Compressed/);
});

// ---------------------------------------------------------------------------
// FlatBuffers
// ---------------------------------------------------------------------------

const TYPES = { LoRA: LORA_FIELDS };

test('flatbuffers: scalars, enums, strings and a vector of tables survive a round trip', () => {
  const sampler = ENUMS.SamplerType.indexOf('EulerATrailing');
  const input = {
    start_width: 8, start_height: 12, seed: 4000000000, steps: 20, guidance_scale: 3.5, model: 'flux.ckpt', sampler,
    shift: 1.5, hires_fix: true, tiled_decoding: true,
    loras: [{ file: 'a.ckpt', weight: 0.5 }, { file: 'b.ckpt', weight: -0.25, mode: 1 }],
  };
  const buf = encodeTable(CONFIG_FIELDS, input, TYPES);
  assert.equal(buf.readUInt32LE(0) % 4, 0);
  const back = decodeTable(buf, CONFIG_FIELDS, TYPES);
  assert.equal(back.seed, 4000000000, 'unsigned 32-bit values are not truncated');
  assert.equal(back.start_height, 12);
  assert.equal(back.model, 'flux.ckpt');
  assert.equal(back.sampler, sampler);
  assert.equal(back.shift, 1.5);
  assert.equal(back.hires_fix, true);
  assert.deepEqual(back.loras.map((l) => [l.file, l.weight, l.mode]), [['a.ckpt', 0.5, 0], ['b.ckpt', -0.25, 1]]);
  assert.ok(encodeTable(CONFIG_FIELDS, { steps: 20 }, TYPES).length < buf.length, 'absent fields cost nothing');
});

test('flatbuffers: a value equal to its default is not written, an explicit false overrides a true default', () => {
  const trueDefault = CONFIG_FIELDS.find((f) => f[1] === 'bool' && f[2] === true);
  assert.ok(trueDefault, 'the schema has a boolean defaulting to true');
  const off = decodeTable(encodeTable(CONFIG_FIELDS, { [trueDefault[0]]: false }, TYPES), CONFIG_FIELDS, TYPES);
  assert.equal(off[trueDefault[0]], false);
  const untouched = decodeTable(encodeTable(CONFIG_FIELDS, {}, TYPES), CONFIG_FIELDS, TYPES);
  assert.equal(untouched[trueDefault[0]], true);
});

// ---------------------------------------------------------------------------
// Tensors, fpzip, PNG
// ---------------------------------------------------------------------------

test('half precision floats convert both ways', () => {
  for (const v of [0, 1, -1, 0.5, 0.0009765625, 65504, -2.5]) assert.equal(halfToFloat(floatToHalf(v)), v);
  assert.equal(floatToHalf(1e9), 0x7c00);
  assert.ok(Number.isNaN(halfToFloat(floatToHalf(NaN))));
});

test('tensor: pixels survive the trip to the fp16 form the server expects and back', () => {
  const pixels = Buffer.alloc(4 * 4 * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 37) % 256;
  const tensor = imageToTensor({ width: 4, height: 4, channels: 3, pixels });
  const parsed = parseTensor(tensor);
  assert.deepEqual(parsed.dims, [1, 4, 4, 3]);
  assert.equal(parsed.datatype, DATATYPE.f16);
  const back = tensorToImage(tensor);
  assert.deepEqual([back.width, back.height, back.channels], [4, 4, 3]);
  for (let i = 0; i < pixels.length; i += 1) assert.ok(Math.abs(back.pixels[i] - pixels[i]) <= 1, `pixel ${i}`);
});

test('tensor: truncated, unknown-codec and non-image tensors are refused with a clear message', () => {
  assert.throws(() => parseTensor(Buffer.alloc(10)), /too short/);
  const odd = imageToTensor({ width: 2, height: 2, channels: 3, pixels: Buffer.alloc(12) });
  odd.writeUInt32LE(0x12345, 0);
  assert.throws(() => parseTensor(odd), /unsupported codec/);
  const cut = imageToTensor({ width: 2, height: 2, channels: 3, pixels: Buffer.alloc(12) }).subarray(0, 80);
  assert.throws(() => parseTensor(cut), /shorter than its declared shape/);
});

test('fpzip: a tensor written by the reference library decodes to the expected image', () => {
  const tensor = Buffer.from(FPZIP_TENSOR, 'base64');
  const img = tensorToImage(tensor);
  assert.deepEqual([img.width, img.height, img.channels], [8, 8, 3]);
  // First row of the image: x runs -1..1 on red, y is -1 on green, sin((x+y)/3) on blue.
  assert.equal(img.pixels[0], 0);
  assert.equal(img.pixels[1], 0);
  assert.equal(img.pixels[2], 128);
  assert.equal(img.pixels[img.pixels.length - 3 + 0], 255, 'bottom-right red is white');
  assert.equal(
    createHash('sha256').update(img.pixels).digest('hex'),
    '6037e4d9049ea9675455d75b212737ca5be457a9fe9f19776073245d817c35c4',
    'bit-exact against the reference decoder',
  );
});

test('fpzip: damaged or foreign streams fail cleanly instead of looping or allocating', () => {
  assert.throws(() => fpzipDecode(Buffer.from('this is not fpzip data at all, not even close')), /fpzip/);
  const good = Buffer.from(FPZIP_TENSOR, 'base64').subarray(68);
  assert.throws(() => fpzipDecode(Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), good.subarray(4)])), /fpzip/);
  assert.doesNotThrow(() => { try { fpzipDecode(good.subarray(0, 40)); } catch (e) { assert.match(e.message, /fpzip/); } });
});

test('PNG: encode, decode, text chunks, size and resize', () => {
  const pixels = Buffer.alloc(5 * 3 * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 11) % 256;
  const png = encodePng({ width: 5, height: 3, channels: 3, pixels }, { 'local-designer': '{"seed":7}' });
  const back = decodePng(png);
  assert.equal(Buffer.compare(back.pixels, pixels), 0);
  assert.deepEqual(readPngText(png), { 'local-designer': '{"seed":7}' });
  assert.deepEqual(readPngText(Buffer.from('nope')), {});
  const big = resizePixels({ width: 5, height: 3, channels: 3, pixels }, 10, 6);
  assert.deepEqual([big.width, big.height, big.pixels.length], [10, 6, 180]);
  assert.equal(toRgb({ width: 1, height: 1, channels: 1, pixels: Buffer.from([9]) }).pixels.length, 3);
  assert.throws(() => decodePng(Buffer.from('nope')), /Not a PNG/);
});

// ---------------------------------------------------------------------------
// Names, ranges, defaults, connection policy
// ---------------------------------------------------------------------------

test('sampler names match whatever way the user spells them', () => {
  const i = ENUMS.SamplerType.indexOf('DPMPP2MKarras');
  assert.equal(enumIndex('SamplerType', 'DPM++ 2M Karras'), i);
  assert.equal(enumIndex('SamplerType', 'dpmpp2mkarras'), i);
  assert.equal(enumIndex('SamplerType', i), i);
  assert.throws(() => enumIndex('SamplerType', 'warp drive'), /Unknown SamplerType/);
});

test('--set values are checked against the configuration table', () => {
  assert.equal(coerceField('tiled_decoding', 'true' === 'true'), true);
  assert.equal(coerceField('steps', '12'), 12);
  assert.equal(coerceField('sampler', 'Euler A Trailing'), ENUMS.SamplerType.indexOf('EulerATrailing'));
  assert.throws(() => coerceField('stepz', 3), /Unknown configuration field/);
  assert.throws(() => coerceField('steps', -1), /integer between/);
  assert.throws(() => coerceField('steps', 'many'), /must be a number/);
  assert.throws(() => coerceField('tiled_decoding', 'maybe'), /true or false/);
});

test('starting points follow the model family', () => {
  assert.deepEqual(modelDefaults({ version: 'sd_xl_base', default_scale: 16 }), { size: 1024, steps: 20, guidance: 7, sampler: 'DPMPP2MKarras' });
  assert.equal(modelDefaults({ version: 'flux1', default_scale: 16, is_consistency_model: true }).steps, 4);
  assert.equal(modelDefaults({ version: 'flux1', default_scale: 16 }).guidance, 1);
  assert.equal(modelDefaults({ version: 'qwen_image', default_scale: 16 }).guidance, 4);
  assert.equal(modelDefaults({}).size, 1024);
});

test('addresses and the clear-text safety rule', () => {
  assert.deepEqual(parseTarget('192.168.1.5:7000'), { host: '192.168.1.5', port: 7000 });
  assert.deepEqual(parseTarget('grpcs://box.example.com'), { host: 'box.example.com', port: 7859 });
  assert.deepEqual(parseTarget('[::1]:9'), { host: '::1', port: 9 });
  assert.throws(() => connectionOptions({ grpc: '10.0.0.4:7859', 'no-tls': true }, {}), /clear text/);
  assert.equal(connectionOptions({ grpc: '10.0.0.4:7859', 'no-tls': true, 'insecure-tls': true }, {}).useTls, false);
  assert.equal(connectionOptions({ 'no-tls': true }, {}).host, '127.0.0.1');
  assert.equal(connectionOptions({}, { DRAWTHING_GRPC: 'studio.local:1234', DRAWTHING_FINGERPRINT: 'AB:CD' }).fingerprint, 'AB:CD');
});

// ---------------------------------------------------------------------------
// The connector against an in-process fake server (clear-text HTTP/2, loopback)
// ---------------------------------------------------------------------------

const MODELS = [
  { file: 'big.ckpt', name: 'Big Model', version: 'sd_xl_base', default_scale: 16 },
  { file: 'fast.ckpt', name: 'Fast Model', version: 'flux1', default_scale: 8, is_consistency_model: true },
];
const LORAS = [{ file: 'ink_lora_f16.ckpt', name: 'Ink', version: 'flux1' }];

function fakeServer({ secret = '', hold = false } = {}) {
  const seen = { echoes: [], requests: [] };
  const server = http2.createServer();
  server.on('stream', (stream, headers) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => {
      const body = Buffer.concat(chunks);
      const request = body.length >= 5 ? body.subarray(5) : Buffer.alloc(0);
      const method = String(headers[':path']).split('/').pop();
      stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true });
      stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '0' }));
      if (method === 'Echo') {
        const f = collect(request);
        seen.echoes.push({ name: f[1]?.toString(), secret: f[2]?.toString() ?? '' });
        const denied = secret && (f[2]?.toString() ?? '') !== secret;
        const override = message([[1, 'string', JSON.stringify(MODELS)], [2, 'string', JSON.stringify(LORAS)], [3, 'string', '[]']]);
        stream.end(grpcFrame(denied
          ? message([[1, 'string', 'denied'], [4, 'varint', 1]])
          : message([[1, 'string', 'hello'], [2, 'string', 'big.ckpt'], [2, 'string', 'fast.ckpt'], [2, 'string', 'ink_lora_f16.ckpt'], [3, 'bytes', override]])));
        return;
      }
      if (method === 'GenerateImage') {
        const f = collect(request);
        seen.requests.push({
          prompt: f[5]?.toString(),
          negative: f[6]?.toString(),
          config: decodeTable(f[7], CONFIG_FIELDS, TYPES),
          secret: f[13]?.toString() ?? '',
          hasInit: Boolean(f[12]),
        });
        if (hold) return; // never answers: used for the cancellation test
        const pixels = Buffer.alloc(8 * 8 * 3);
        for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 5) % 256;
        const tensor = imageToTensor({ width: 8, height: 8, channels: 3, pixels });
        const half = Math.floor(tensor.length / 2);
        const step = (n) => message([[2, 'bytes', message([[3, 'bytes', message([[1, 'varint', n]])]])]]);
        stream.write(grpcFrame(message([[2, 'bytes', message([[1, 'bytes', Buffer.from([1])]])]])));
        stream.write(grpcFrame(step(3)));
        stream.write(grpcFrame(message([[1, 'bytes', tensor.subarray(0, half)], [8, 'varint', 1]])));
        stream.end(grpcFrame(message([[1, 'bytes', tensor.subarray(half)]])));
        return;
      }
      stream.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ seen, port: server.address().port, close: () => { server.closeAllConnections?.(); server.close(); } });
  }));
}

const optsFor = (srv, extra = {}) => ({ grpc: `127.0.0.1:${srv.port}`, 'no-tls': true, ...extra });

test('connector: connect, describe and plan against a server, with the shared secret kept out of sight', async () => {
  const srv = await fakeServer({ secret: 'sesame' });
  try {
    const session = await connector.connect(optsFor(srv), { DRAWTHING_SECRET: 'sesame' }).catch((e) => e);
    assert.match(session.message, /shared secret/, 'without the secret the server refuses and the message says what to set');
    process.env.DRAWTHING_SECRET = 'sesame';
    const ok = await connector.connect(optsFor(srv));
    assert.equal(ok.where, 'local');
    assert.equal(ok.models.length, 2);
    const described = connector.describe(ok);
    assert.deepEqual(described.models.map((m) => m.file), ['big.ckpt', 'fast.ckpt']);
    assert.equal(described.models[1].fast, true);
    assert.ok(!JSON.stringify(described).includes('sesame'));
    assert.ok(!JSON.stringify(ok).includes('sesame'), 'the secret is not enumerable on the session');
    ok.channel.close();
  } finally {
    delete process.env.DRAWTHING_SECRET;
    srv.close();
  }
});

test('connector: the request carries the configuration, LoRA, seed and init image; the answer comes back as a PNG with metadata', async () => {
  const srv = await fakeServer();
  try {
    const session = await connector.connect(optsFor(srv));
    const plan = connector.plan(session, {
      prompt: 'a dojo', negative: 'blurry', model: 'Fast Model', width: 320, height: 256, seed: 99, steps: 6, guidance: 2,
      sampler: 'Euler A Trailing', lora: ['ink_lora_f16.ckpt:0.6'], set: ['tiled_decoding=true'],
    });
    assert.equal(plan.mode, 'txt2img');
    assert.deepEqual([plan.summary.model, plan.summary.width, plan.summary.height], ['fast.ckpt', 320, 256]);
    const events = [];
    const png = await connector.render(session, plan, { timeoutMs: 5000, onProgress: (e) => events.push(e.stage) });
    const got = srv.seen.requests[0];
    assert.equal(got.prompt, 'a dojo');
    assert.equal(got.negative, 'blurry');
    assert.equal(got.config.model, 'fast.ckpt');
    assert.deepEqual([got.config.start_width, got.config.start_height, got.config.seed, got.config.steps], [5, 4, 99, 6]);
    assert.equal(got.config.guidance_scale, 2);
    assert.equal(got.config.sampler, ENUMS.SamplerType.indexOf('EulerATrailing'));
    assert.equal(got.config.tiled_decoding, true);
    assert.deepEqual(got.config.loras.map((l) => l.file), ['ink_lora_f16.ckpt']);
    assert.ok(Math.abs(got.config.loras[0].weight - 0.6) < 1e-6);
    assert.ok(events.includes('text-encoded') && events.includes('sampling'));
    // The image arrived in two chunks and was reassembled.
    const img = decodePng(png);
    assert.deepEqual([img.width, img.height], [8, 8]);
    const meta = connector.readMetadata(png);
    assert.equal(meta.prompt, 'a dojo');
    assert.equal(meta.seed, 99);
    assert.equal(meta.model, 'fast.ckpt');
    assert.equal(meta.sampler, 'EulerATrailing');
    session.channel.close();
  } finally {
    srv.close();
  }
});

test('connector: img2img sends the init image and its strength; unknown LoRA and model are refused before any generation', async () => {
  const srv = await fakeServer();
  try {
    const session = await connector.connect(optsFor(srv));
    const init = encodePng({ width: 4, height: 4, channels: 3, pixels: Buffer.alloc(48, 120) }).toString('base64');
    const plan = connector.plan(session, { prompt: 'p', model: 'big.ckpt', width: 256, height: 256, initImage: init, strength: 0.4 });
    assert.equal(plan.mode, 'img2img');
    await connector.render(session, plan, { timeoutMs: 5000 });
    const got = srv.seen.requests[0];
    assert.equal(got.hasInit, true);
    assert.ok(Math.abs(got.config.strength - 0.4) < 1e-6);
    assert.throws(() => connector.plan(session, { prompt: 'p', model: 'big.ckpt', lora: ['ghost.ckpt:1'] }), /not on the server/);
    assert.throws(() => connector.plan(session, { prompt: 'p', model: 'nothing-like-it' }), /not found on the server/);
    assert.throws(() => connector.plan(session, { prompt: 'p', model: 'big.ckpt', width: 100 }), /multiple of 64/);
    assert.equal(connector.plan(session, { prompt: 'p' }).summary.model, 'fast.ckpt', 'no model given: the fast one is picked and says so');
    assert.match(connector.plan(session, { prompt: 'p' }).summary.model_choice, /default/);
    session.channel.close();
  } finally {
    srv.close();
  }
});

test('connector: a generation can be cancelled, and an unreachable server gets the setup hint', async () => {
  const srv = await fakeServer({ hold: true });
  try {
    const session = await connector.connect(optsFor(srv));
    const plan = connector.plan(session, { prompt: 'p', model: 'big.ckpt', width: 256, height: 256 });
    const abort = new AbortController();
    const pending = connector.render(session, plan, { timeoutMs: 30000, signal: abort.signal });
    setTimeout(() => abort.abort(), 100);
    await assert.rejects(pending, /cancelled/);
    session.channel.close();
  } finally {
    srv.close();
  }
  await assert.rejects(connector.connect({ grpc: '127.0.0.1:1', 'no-tls': true }), /gRPC server not reachable/);
  assert.equal(await connector.detect({ grpc: '127.0.0.1:1', 'no-tls': true }), false);
});
