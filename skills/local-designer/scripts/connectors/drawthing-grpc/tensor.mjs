// Tensors exchanged with the Draw Things gRPC server.
// Wire layout of one tensor: [uint32 codec identifier][64-byte parameter block][payload].
// Parameter block = 4 x int32 (memory type, format, datatype, reserved) + 12 x int32 dimensions.
// Identifier 0: the payload is the raw tensor. Identifier 0xf7217: the payload is an fpzip stream (what the server
// sends while its "response compression" setting is on, which the request cannot refuse). Any other identifier
// (zip, 8-bit packing) is reported as an explicit error.
import { FPZIP_IDENTIFIER, fpzipDecode } from './fpzip.mjs';

const HEADER = 4 + 64;
const MAX_DIM = 12;

export const DATATYPE = { u8: 0x01000, i32: 0x02000, f32: 0x04000, f16: 0x20000, bf16: 0x80000 };
export const FORMAT = { nchw: 0x01, nhwc: 0x02, chwn: 0x04 };
const BYTES = { [DATATYPE.u8]: 1, [DATATYPE.i32]: 4, [DATATYPE.f32]: 4, [DATATYPE.f16]: 2, [DATATYPE.bf16]: 2 };

export function halfToFloat(h) {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

export function floatToHalf(value) {
  if (Number.isNaN(value)) return 0x7e00;
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const v = Math.abs(value);
  if (v === Infinity || v >= 65520) return sign | 0x7c00;
  if (v < 2 ** -24 / 2) return sign;
  if (v < 2 ** -14) return sign | Math.round(v / 2 ** -24);
  const exp = Math.floor(Math.log2(v));
  let frac = Math.round((v / 2 ** exp - 1) * 1024);
  let e = exp + 15;
  if (frac === 1024) {
    frac = 0;
    e += 1;
  }
  return sign | (e << 10) | frac;
}

export function parseTensor(buf) {
  if (buf.length < HEADER) throw new Error(`Tensor too short (${buf.length} bytes)`);
  const identifier = buf.readUInt32LE(0);
  const memory = buf.readInt32LE(4);
  const format = buf.readInt32LE(8);
  const datatype = buf.readInt32LE(12);
  const dims = [];
  for (let i = 0; i < MAX_DIM; i += 1) {
    const d = buf.readInt32LE(20 + 4 * i);
    if (d === 0) break;
    dims.push(d);
  }
  if (identifier === FPZIP_IDENTIFIER) {
    const count = dims.reduce((a, b) => a * b, 1);
    const decoded = fpzipDecode(buf.subarray(HEADER));
    if (decoded.data.length !== count) {
      throw new Error(`fpzip tensor holds ${decoded.data.length} values but its shape ${dims.join('x')} needs ${count}`);
    }
    // Values come back as 32-bit floats whatever the original storage type was.
    const data = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
    return { memory, format, datatype: DATATYPE.f32, dims, data };
  }
  if (identifier !== 0) {
    throw new Error(
      `The server sent a tensor compressed with an unsupported codec (0x${identifier.toString(16)}). Turn off "Response Compression" in the Draw Things server settings.`,
    );
  }
  const unit = BYTES[datatype];
  if (!unit) throw new Error(`Unsupported tensor datatype 0x${datatype.toString(16)}`);
  const count = dims.reduce((a, b) => a * b, 1);
  if (buf.length < HEADER + count * unit) throw new Error('Tensor payload shorter than its declared shape');
  return { memory, format, datatype, dims, data: buf.subarray(HEADER, HEADER + count * unit) };
}

function readSample(t, i) {
  switch (t.datatype) {
    case DATATYPE.f16: return halfToFloat(t.data.readUInt16LE(i * 2));
    case DATATYPE.f32: return t.data.readFloatLE(i * 4);
    case DATATYPE.bf16: {
      const b = Buffer.alloc(4);
      b.writeUInt16LE(t.data.readUInt16LE(i * 2), 2);
      return b.readFloatLE(0);
    }
    case DATATYPE.u8: return t.data[i];
    default: return t.data.readInt32LE(i * 4);
  }
}

// Image tensor (1,H,W,C) or (H,W,C) with floats in [-1,1] (or bytes) -> { width, height, channels, rgb: Buffer(H*W*C) in 8 bits }.
export function tensorToImage(buf) {
  const t = parseTensor(buf);
  const dims = t.dims.length === 4 ? t.dims.slice(1) : t.dims;
  if (dims.length !== 3) throw new Error(`Not an image tensor (shape ${t.dims.join('x')})`);
  const [height, width, channels] = dims;
  if (![1, 3, 4].includes(channels)) throw new Error(`Unexpected channel count ${channels} (shape ${t.dims.join('x')})`);
  const out = Buffer.alloc(width * height * channels);
  const isByte = t.datatype === DATATYPE.u8;
  for (let i = 0; i < out.length; i += 1) {
    const v = readSample(t, i);
    out[i] = isByte ? v : Math.max(0, Math.min(255, Math.round((v + 1) * 127.5)));
  }
  return { width, height, channels, pixels: out };
}

// 8-bit RGB(A) pixels -> fp16 tensor (1,H,W,C) with values in [-1,1], the form the server expects for init images and masks.
export function imageToTensor({ width, height, channels, pixels }, { bytes = false } = {}) {
  const unit = bytes ? 1 : 2;
  const header = Buffer.alloc(HEADER);
  header.writeInt32LE(0x1, 4); // CPU memory
  header.writeInt32LE(FORMAT.nhwc, 8);
  header.writeInt32LE(bytes ? DATATYPE.u8 : DATATYPE.f16, 12);
  [1, height, width, channels].forEach((d, i) => header.writeInt32LE(d, 20 + 4 * i));
  const body = Buffer.alloc(pixels.length * unit);
  for (let i = 0; i < pixels.length; i += 1) {
    if (bytes) body[i] = pixels[i];
    else body.writeUInt16LE(floatToHalf(pixels[i] / 127.5 - 1), i * 2);
  }
  return Buffer.concat([header, body]);
}
