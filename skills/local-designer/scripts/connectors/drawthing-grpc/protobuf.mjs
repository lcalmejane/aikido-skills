// Minimal protobuf wire-format reader/writer, enough for the Draw Things image service messages.
// Written from the public wire-format description: varint (0), fixed64 (1), length-delimited (2), fixed32 (5).

export function varint(value) {
  let n = BigInt(value);
  if (n < 0n) n += 1n << 64n; // negative int32/int64 are sent as 10-byte two's complement
  const out = [];
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) byte |= 0x80;
    out.push(byte);
  } while (n > 0n);
  return Buffer.from(out);
}

const tag = (field, wire) => varint((field << 3) | wire);

// Each helper returns a Buffer ready to be concatenated. Proto3 default values (0, "", empty) are omitted by `message()`.
export const pb = {
  varint: (field, value) => Buffer.concat([tag(field, 0), varint(value)]),
  bytes: (field, data) => {
    const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return Buffer.concat([tag(field, 2), varint(b.length), b]);
  },
  string: (field, text) => pb.bytes(field, Buffer.from(String(text), 'utf8')),
  float: (field, value) => {
    const b = Buffer.alloc(4);
    b.writeFloatLE(value);
    return Buffer.concat([tag(field, 5), b]);
  },
};

// Entries: [field, kind, value]; kind is "varint" | "bytes" | "string" | "float" | "message" (value is a Buffer).
// A zero/empty value is skipped unless `keep` is true on the entry (4th element).
export function message(entries) {
  const parts = [];
  for (const [field, kind, value, keep] of entries) {
    if (value === undefined || value === null) continue;
    const empty = value === 0 || value === false || value === '' || (Buffer.isBuffer(value) && value.length === 0);
    if (empty && !keep) continue;
    if (kind === 'varint') parts.push(pb.varint(field, value === true ? 1 : value === false ? 0 : value));
    else if (kind === 'string') parts.push(pb.string(field, value));
    else if (kind === 'float') parts.push(pb.float(field, value));
    else parts.push(pb.bytes(field, value));
  }
  return Buffer.concat(parts);
}

export function readVarint(buf, offset) {
  let result = 0n;
  let shift = 0n;
  let o = offset;
  for (;;) {
    if (o >= buf.length) throw new Error('Truncated protobuf varint');
    const byte = buf[o];
    o += 1;
    result |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7n;
    if (shift > 70n) throw new Error('Protobuf varint too long');
  }
  return [result, o];
}

// Yields { field, wire, value }: value is a BigInt (wire 0) or a Buffer (wire 1, 2, 5).
export function* fields(buf) {
  let o = 0;
  while (o < buf.length) {
    let key;
    [key, o] = readVarint(buf, o);
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) {
      let v;
      [v, o] = readVarint(buf, o);
      yield { field, wire, value: v };
    } else if (wire === 2) {
      let len;
      [len, o] = readVarint(buf, o);
      const n = Number(len);
      if (o + n > buf.length) throw new Error('Truncated protobuf field');
      yield { field, wire, value: buf.subarray(o, o + n) };
      o += n;
    } else if (wire === 5 || wire === 1) {
      const n = wire === 5 ? 4 : 8;
      if (o + n > buf.length) throw new Error('Truncated protobuf field');
      yield { field, wire, value: buf.subarray(o, o + n) };
      o += n;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
  }
}

// { field: value | [values] } grouped by field number (repeated fields become arrays only when seen more than once is NOT assumed:
// callers name the repeated ones).
export function collect(buf, repeated = []) {
  const out = {};
  for (const f of fields(buf)) {
    if (repeated.includes(f.field)) (out[f.field] ??= []).push(f.value);
    else out[f.field] = f.value;
  }
  return out;
}

// gRPC length-prefixed message framing: [compressed flag][uint32 length][payload].
export function grpcFrame(payload) {
  const head = Buffer.alloc(5);
  head.writeUInt32BE(payload.length, 1);
  return Buffer.concat([head, payload]);
}

// Pulls complete frames out of `pending` and returns { messages, rest }.
export function grpcUnframe(pending) {
  const messages = [];
  let o = 0;
  while (pending.length - o >= 5) {
    const flag = pending[o];
    const len = pending.readUInt32BE(o + 1);
    if (pending.length - o - 5 < len) break;
    if (flag !== 0) throw new Error('Compressed gRPC message received: this client never asks for compression');
    messages.push(pending.subarray(o + 5, o + 5 + len));
    o += 5 + len;
  }
  return { messages, rest: pending.subarray(o) };
}
