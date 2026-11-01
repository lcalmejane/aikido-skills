// PNG helpers shared by the tool and the connectors (engine independent).
import { deflateSync, inflateSync } from 'node:zlib';

export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export const isPng = (buf) => buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);

// { width, height } read from the IHDR chunk, or null when `buf` is not a PNG.
export function pngSize(buf) {
  if (buf.length < 24 || !isPng(buf)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

const COLOR_TYPE = { 1: 0, 3: 2, 4: 6 };

// 8-bit pixels (grey, RGB or RGBA, row major) -> PNG file. `text` is an optional { keyword: value } set of tEXt chunks.
export function encodePng({ width, height, channels, pixels }, text = {}) {
  if (!COLOR_TYPE[channels] && COLOR_TYPE[channels] !== 0) throw new Error(`Cannot encode ${channels} channels as PNG`);
  const stride = width * channels;
  if (pixels.length !== stride * height) throw new Error('Pixel buffer does not match width x height x channels');
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = COLOR_TYPE[channels];
  const texts = Object.entries(text).map(([k, v]) => chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(String(v), 'latin1')])));
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), ...texts, chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// { keyword: text } for every tEXt chunk of a PNG (latin-1), or {} when there is none.
export function readPngText(buf) {
  const out = {};
  if (!isPng(buf)) return out;
  let o = 8;
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    if (type === 'tEXt') {
      const data = buf.subarray(o + 8, o + 8 + len);
      const k = data.indexOf(0);
      if (k > 0) out[data.toString('latin1', 0, k)] = data.toString('latin1', k + 1);
    }
    if (type === 'IEND') break;
    o += 12 + len;
  }
  return out;
}

// Bilinear resize of 8-bit pixels; used to fit an init image to the requested canvas.
export function resizePixels({ width, height, channels, pixels }, newWidth, newHeight) {
  if (width === newWidth && height === newHeight) return { width, height, channels, pixels };
  const out = Buffer.alloc(newWidth * newHeight * channels);
  for (let y = 0; y < newHeight; y += 1) {
    const fy = Math.min(height - 1, Math.max(0, ((y + 0.5) * height) / newHeight - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < newWidth; x += 1) {
      const fx = Math.min(width - 1, Math.max(0, ((x + 0.5) * width) / newWidth - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(width - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < channels; c += 1) {
        const p = (yy, xx) => pixels[(yy * width + xx) * channels + c];
        const top = p(y0, x0) * (1 - tx) + p(y0, x1) * tx;
        const bottom = p(y1, x0) * (1 - tx) + p(y1, x1) * tx;
        out[(y * newWidth + x) * channels + c] = Math.round(top * (1 - ty) + bottom * ty);
      }
    }
  }
  return { width: newWidth, height: newHeight, channels, pixels: out };
}

// Any decoded image -> 3 channels (alpha dropped, grey expanded).
export function toRgb({ width, height, channels, pixels }) {
  if (channels === 3) return { width, height, channels, pixels };
  const out = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    for (let c = 0; c < 3; c += 1) out[i * 3 + c] = channels === 1 ? pixels[i] : pixels[i * channels + c];
  }
  return { width, height, channels: 3, pixels: out };
}

// PNG written by encodePng or by most tools (8-bit, no interlace, any filter) -> { width, height, channels, pixels }.
export function decodePng(buf) {
  if (!isPng(buf)) throw new Error('Not a PNG file');
  let o = 8;
  let header = null;
  const idat = [];
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (!header) throw new Error('PNG without IHDR');
  const channels = { 0: 1, 2: 3, 6: 4 }[header.color];
  if (!channels || header.depth !== 8 || header.interlace) throw new Error('Only 8-bit grey/RGB/RGBA non-interlaced PNG files can be decoded');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = header.width * channels;
  const pixels = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let p = 0;
      if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) {
        const est = a + b - c;
        const pa = Math.abs(est - a);
        const pb = Math.abs(est - b);
        const pc = Math.abs(est - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = (v + p) & 0xff;
    }
  }
  return { width: header.width, height: header.height, channels, pixels };
}
