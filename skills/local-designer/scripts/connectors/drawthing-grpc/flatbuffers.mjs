// Minimal FlatBuffers writer/reader driven by a field table (see config-schema.mjs).
// Binary layout from the public FlatBuffers format description: little endian, a root offset, tables that start with a
// signed offset to their vtable, strings and vectors stored as length + data, every offset relative to its own position.

const SIZES = { bool: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, i64: 8 };
const isOffset = (type) => type === 'str' || type.startsWith('vec:') || type.startsWith('table:');

class Writer {
  constructor() {
    this.chunks = [];
    this.size = 0;
  }
  align(n) {
    const pad = (n - (this.size % n)) % n;
    if (pad) this.alloc(pad);
  }
  alloc(n) {
    const b = Buffer.alloc(n);
    this.chunks.push(b);
    this.size += n;
    return this.size - n;
  }
  bytes(buf) {
    this.chunks.push(buf);
    this.size += buf.length;
    return this.size - buf.length;
  }
  finish() {
    return Buffer.concat(this.chunks);
  }
}

function patchBuffer(w, pos, fn) {
  // Find the chunk holding `pos` (chunks are small and few): patch in place.
  let o = 0;
  for (const c of w.chunks) {
    if (pos >= o && pos < o + c.length) return fn(c, pos - o);
    o += c.length;
  }
  throw new Error('internal: patch outside buffer');
}

function writeScalar(w, type, value) {
  const pos = w.alloc(SIZES[type]);
  patchBuffer(w, pos, (c, i) => {
    if (type === 'bool') c.writeUInt8(value ? 1 : 0, i);
    else if (type === 'i8') c.writeInt8(value, i);
    else if (type === 'u8') c.writeUInt8(value, i);
    else if (type === 'i16') c.writeInt16LE(value, i);
    else if (type === 'u16') c.writeUInt16LE(value, i);
    else if (type === 'i32') c.writeInt32LE(value, i);
    else if (type === 'u32') c.writeUInt32LE(value >>> 0, i);
    else if (type === 'f32') c.writeFloatLE(value, i);
    else if (type === 'i64') c.writeBigInt64LE(BigInt(value), i);
  });
}

function writeString(w, text) {
  w.align(4);
  const data = Buffer.from(String(text), 'utf8');
  const pos = w.alloc(4);
  patchBuffer(w, pos, (c, i) => c.writeUInt32LE(data.length, i));
  w.bytes(data);
  w.alloc(1); // NUL terminator
  w.align(4);
  return pos;
}

// `types` resolves "table:Name" to that table's field list.
function writeTable(w, fields, values, types) {
  const present = [];
  fields.forEach(([name, type, def], slot) => {
    const v = values[name];
    if (v === undefined || v === null) return;
    if (!isOffset(type) && (type.startsWith('enum:') ? false : v === def)) return;
    if (type.startsWith('vec:') && Array.isArray(v) && v.length === 0) return;
    present.push({ slot, name, type, value: v });
  });
  const slots = fields.length;
  w.align(2);
  const vtablePos = w.alloc(4 + 2 * slots);
  w.align(8);
  const tablePos = w.alloc(4); // soffset to vtable
  patchBuffer(w, tablePos, (c, i) => c.writeInt32LE(tablePos - vtablePos, i));
  const offsets = new Array(slots).fill(0);
  const pending = [];
  for (const f of present) {
    const type = f.type.startsWith('enum:') ? 'i8' : f.type;
    if (isOffset(type)) {
      w.align(4);
      const at = w.alloc(4);
      offsets[f.slot] = at - tablePos;
      pending.push({ at, f });
    } else {
      w.align(SIZES[type]);
      const at = w.size;
      offsets[f.slot] = at - tablePos;
      writeScalar(w, type, f.type.startsWith('enum:') ? f.value : f.value);
    }
  }
  const tableSize = w.size - tablePos;
  patchBuffer(w, vtablePos, (c, i) => {
    c.writeUInt16LE(4 + 2 * slots, i);
    c.writeUInt16LE(tableSize, i + 2);
    offsets.forEach((o, k) => c.writeUInt16LE(o, i + 4 + 2 * k));
  });
  for (const { at, f } of pending) {
    w.align(4);
    let target;
    if (f.type === 'str') target = writeString(w, f.value);
    else if (f.type.startsWith('vec:')) target = writeVector(w, f.type.slice(4), f.value, types);
    else target = writeTable(w, types[f.type.slice(6)], f.value, types);
    patchBuffer(w, at, (c, i) => c.writeUInt32LE(target - at, i));
  }
  return tablePos;
}

function writeVector(w, elem, items, types) {
  w.align(4);
  const pos = w.alloc(4);
  patchBuffer(w, pos, (c, i) => c.writeUInt32LE(items.length, i));
  const slots = items.map(() => w.alloc(4));
  items.forEach((item, k) => {
    w.align(4);
    const target = elem === 'string' || elem === 'str' ? writeString(w, item) : writeTable(w, types[elem], item, types);
    patchBuffer(w, slots[k], (c, i) => c.writeUInt32LE(target - slots[k], i));
  });
  return pos;
}

// Normalises "vec:LoRA" -> "vec:LoRA" and "vec:string" -> element kind handled in writeVector.
export function encodeTable(fields, values, types = {}) {
  const w = new Writer();
  w.alloc(4);
  const root = writeTable(w, fields, values, types);
  patchBuffer(w, 0, (c, i) => c.writeUInt32LE(root, i));
  return w.finish();
}

// ---------------------------------------------------------------------------
// Reader (used by tests and by `inspect`-style tools)
// ---------------------------------------------------------------------------

function readScalar(buf, type, pos) {
  switch (type) {
    case 'bool': return buf.readUInt8(pos) !== 0;
    case 'i8': return buf.readInt8(pos);
    case 'u8': return buf.readUInt8(pos);
    case 'i16': return buf.readInt16LE(pos);
    case 'u16': return buf.readUInt16LE(pos);
    case 'i32': return buf.readInt32LE(pos);
    case 'u32': return buf.readUInt32LE(pos);
    case 'f32': return buf.readFloatLE(pos);
    case 'i64': return Number(buf.readBigInt64LE(pos));
    default: throw new Error(`unknown scalar ${type}`);
  }
}

function readTable(buf, pos, fields, types) {
  const vtable = pos - buf.readInt32LE(pos);
  const vsize = buf.readUInt16LE(vtable);
  const out = {};
  fields.forEach(([name, type, def], slot) => {
    const at = 4 + 2 * slot;
    const off = at < vsize ? buf.readUInt16LE(vtable + at) : 0;
    if (!off) {
      if (def !== undefined && def !== null && !isOffset(type)) out[name] = def;
      return;
    }
    const p = pos + off;
    if (type === 'str') {
      const s = p + buf.readUInt32LE(p);
      out[name] = buf.toString('utf8', s + 4, s + 4 + buf.readUInt32LE(s));
    } else if (type.startsWith('vec:')) {
      const v = p + buf.readUInt32LE(p);
      const n = buf.readUInt32LE(v);
      const elem = type.slice(4);
      out[name] = Array.from({ length: n }, (_, k) => {
        const ep = v + 4 + 4 * k;
        const t = ep + buf.readUInt32LE(ep);
        if (elem === 'string' || elem === 'str') return buf.toString('utf8', t + 4, t + 4 + buf.readUInt32LE(t));
        return readTable(buf, t, types[elem], types);
      });
    } else if (type.startsWith('enum:')) out[name] = buf.readInt8(p);
    else out[name] = readScalar(buf, type, p);
  });
  return out;
}

export function decodeTable(buf, fields, types = {}) {
  return readTable(buf, buf.readUInt32LE(0), fields, types);
}
