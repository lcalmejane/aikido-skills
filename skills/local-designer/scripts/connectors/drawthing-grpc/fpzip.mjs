// fpzip decoder (floating-point arrays compressed with a 3D Lorenzo predictor and a range coder).
//
// JavaScript port of the decompression path of fpzip 1.3.0 (https://github.com/LLNL/fpzip), single-precision data
// only, in the default "fast" floating-point mode (the mode the Draw Things server writes).
// fpzip is Copyright (c) 2018-2019, Lawrence Livermore National Security, LLC, distributed under the BSD 3-Clause
// License; the license text is kept next to this file in LICENSE-fpzip.txt, as that license requires.
//
// Why it exists: a Draw Things server sends its images with fpzip compression when "response compression" is on
// (the default), and the request has no field to refuse it. Decoding it here makes the client work with any server,
// including a cloud one whose settings the caller cannot change.

const TBLSHIFT = 7;
const SEARCH_SHIFT = 16 - TBLSHIFT;
const MODEL_BITS = 16;
const PERIOD = 0x400;
const PC_BIT_MAX = 8; // alphabets of up to 2^8 prediction residual classes are coded directly
const MAX_ELEMENTS = 2 ** 28;

export const FPZIP_IDENTIFIER = 0xf7217;

// ---------------------------------------------------------------------------
// Quasi-static probability model (RCqsmodel, decompression side)
// ---------------------------------------------------------------------------

class Model {
  constructor(symbols) {
    this.n = symbols;
    this.symf = new Uint32Array(symbols + 1);
    this.cumf = new Uint32Array(symbols + 1);
    this.cumf[symbols] = 1 << MODEL_BITS;
    this.search = new Uint32Array((1 << TBLSHIFT) + 1);
    this.targetRescale = PERIOD;
    this.l = 0;
    this.r = 0;
    this.reset();
  }

  reset() {
    const n = this.n;
    this.rescale = (n >>> 4) | 2;
    this.more = 0;
    const f = Math.floor(this.cumf[n] / n);
    const m = this.cumf[n] % n;
    for (let i = 0; i < m; i += 1) this.symf[i] = f + 1;
    for (let i = m; i < n; i += 1) this.symf[i] = f;
    this.refresh();
  }

  // update(): rebuild the cumulative table (or hand out the remaining symbols of the current period)
  refresh() {
    if (this.more) {
      this.left = this.more;
      this.more = 0;
      this.incr += 1;
      return;
    }
    if (this.rescale !== this.targetRescale) {
      this.rescale *= 2;
      if (this.rescale > this.targetRescale) this.rescale = this.targetRescale;
    }
    const n = this.n;
    let cf = this.cumf[n];
    let count = cf;
    for (let i = n; i--;) {
      let sf = this.symf[i];
      cf -= sf;
      this.cumf[i] = cf;
      sf = (sf >>> 1) | 1;
      count -= sf;
      this.symf[i] = sf;
    }
    this.incr = Math.floor(count / this.rescale);
    this.more = count % this.rescale;
    this.left = this.rescale - this.more;
    let h = 1 << TBLSHIFT;
    for (let i = n; i--;) {
      for (let l = this.cumf[i] >>> SEARCH_SHIFT; l <= h; l += 1) this.search[l] = i;
      h = this.cumf[i] >>> SEARCH_SHIFT;
    }
  }

  // Finds the symbol for cumulative frequency `l`; leaves the symbol's low bound and width in this.l / this.r.
  decode(l) {
    if (l >= 1 << MODEL_BITS) throw new Error('fpzip: corrupted stream');
    const i = l >>> SEARCH_SHIFT;
    let s = this.search[i];
    let h = this.search[i + 1] + 1;
    while (s + 1 < h) {
      const m = (s + h) >>> 1;
      if (l < this.cumf[m]) h = m;
      else s = m;
    }
    this.l = this.cumf[s];
    this.r = this.cumf[s + 1] - this.l;
    if (!this.left) this.refresh();
    this.left -= 1;
    this.symf[s] += this.incr;
    return s;
  }
}

// ---------------------------------------------------------------------------
// Range decoder (RCdecoder over a memory buffer)
// ---------------------------------------------------------------------------

class RangeDecoder {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
    this.low = 0;
    this.range = 0xffffffff;
    this.code = 0;
    this.get(4);
  }

  byte() {
    const b = this.pos < this.buf.length ? this.buf[this.pos] : 0;
    this.pos += 1;
    return b;
  }

  get(n) {
    for (let i = 0; i < n; i += 1) {
      this.code = ((this.code << 8) | this.byte()) >>> 0;
      this.low = (this.low << 8) >>> 0;
    }
  }

  normalize() {
    for (let guard = 0; ((this.low ^ ((this.low + this.range) >>> 0)) >>> 24) === 0; guard += 1) {
      if (guard > 8) throw new Error('fpzip: corrupted stream');
      this.get(1);
      this.range = (this.range << 8) >>> 0;
    }
    if (!(this.range >>> 16)) {
      this.get(2);
      this.range = (0 - this.low) >>> 0;
    }
  }

  shift(n) {
    this.range >>>= n;
    if (!this.range) throw new Error('fpzip: corrupted stream');
    const s = Math.floor(((this.code - this.low) >>> 0) / this.range);
    this.low = (this.low + this.range * s) >>> 0;
    this.normalize();
    return s;
  }

  // decode<uint>(n): n bits, low 16 bits first when more than 16 are requested
  bits(n) {
    let s = 0;
    let m = 0;
    if (n > 16) {
      s += this.shift(16);
      m = 16;
      n -= 16;
    }
    return this.shift(n) * 2 ** m + s;
  }

  symbol(model) {
    this.range >>>= MODEL_BITS;
    if (!this.range) throw new Error('fpzip: corrupted stream');
    const s = model.decode(Math.floor(((this.code - this.low) >>> 0) / this.range));
    this.low = (this.low + this.range * model.l) >>> 0;
    this.range = (this.range * model.r) >>> 0;
    this.normalize();
    return s;
  }
}

// ---------------------------------------------------------------------------
// Float <-> ordered unsigned integer map (PCmap<float, bits>)
// ---------------------------------------------------------------------------

const scratch = new DataView(new ArrayBuffer(4));
const fcast = (d) => {
  scratch.setFloat32(0, d, true);
  return scratch.getUint32(0, true);
};
const icast = (r) => {
  scratch.setUint32(0, r >>> 0, true);
  return scratch.getFloat32(0, true);
};

function makeMap(bits) {
  const shift = 32 - bits;
  const fix = (r) => (r ^ (((0 - (r >>> (bits - 1))) >>> 0) >>> (shift + 1))) >>> 0;
  return {
    forward: (d) => fix((~fcast(d) >>> 0) >>> shift),
    inverse: (r) => icast((~fix(r) >>> 0) << shift),
    identity: (d) => icast((fcast(d) >>> shift) << shift),
  };
}

// ---------------------------------------------------------------------------
// Predictive decoder (PCdecoder) and 3D front
// ---------------------------------------------------------------------------

function makeDecoder(rd, bits) {
  const map = makeMap(bits);
  const wide = bits > PC_BIT_MAX;
  const symbols = wide ? 2 * bits + 1 : 2 * (1 << bits) - 1;
  const model = new Model(symbols);
  if (!wide) {
    const bias = (1 << bits) - 1;
    return (pred) => map.inverse((map.forward(pred) + rd.symbol(model) - bias) >>> 0);
  }
  return (pred) => {
    const s = rd.symbol(model);
    if (s > bits) {
      const k = s - bits - 1;
      const d = 2 ** k + rd.bits(k);
      return map.inverse((map.forward(pred) + d) >>> 0);
    }
    if (s < bits) {
      const k = bits - 1 - s;
      const d = 2 ** k + rd.bits(k);
      return map.inverse((map.forward(pred) - d) >>> 0);
    }
    return map.identity(pred);
  };
}

function frontMask(n) {
  let m = n - 1;
  while (m & (m + 1)) m |= m + 1;
  return m;
}

function decompress3d(rd, out, offset, nx, ny, nz, bits) {
  const decode = makeDecoder(rd, bits);
  const dx = 1;
  const dy = nx + 1;
  const dz = dy * (ny + 1);
  const m = frontMask(dx + dy + dz);
  const a = new Float32Array(m + 1);
  let i = 0;
  const push = (v, n = 1) => {
    do {
      a[i & m] = v;
      i += 1;
      n -= 1;
    } while (n);
  };
  const at = (x, y, z) => a[(i - dx * x - dy * y - dz * z) & m];
  const f = Math.fround;
  let k = offset;
  push(0, dz);
  for (let z = 0; z < nz; z += 1) {
    push(0, dy);
    for (let y = 0; y < ny; y += 1) {
      push(0, dx);
      for (let x = 0; x < nx; x += 1) {
        let p = f(at(1, 0, 0) - at(0, 1, 1));
        p = f(p + at(0, 1, 0));
        p = f(p - at(1, 0, 1));
        p = f(p + at(0, 0, 1));
        p = f(p - at(1, 1, 0));
        p = f(p + at(1, 1, 1));
        const v = decode(p);
        out[k] = v;
        k += 1;
        push(v);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

// buf: the compressed stream (starts with the encoded "fpz\0" magic). Returns { nx, ny, nz, nf, precision, data }.
export function fpzipDecode(buf) {
  const rd = new RangeDecoder(buf);
  const magic = [rd.bits(8), rd.bits(8), rd.bits(8), rd.bits(8)];
  if (magic.join() !== [0x66, 0x70, 0x7a, 0].join()) throw new Error('fpzip: not an fpzip stream');
  if (rd.bits(16) !== 0x0110) throw new Error('fpzip: unsupported format version');
  const mode = rd.bits(8);
  if (mode !== 1 && mode !== 2) throw new Error(`fpzip: stream written in floating-point mode ${mode}, only the default mode is supported`);
  const type = rd.bits(1);
  const precision = rd.bits(7);
  const nx = rd.bits(32);
  const nz2 = [rd.bits(32), rd.bits(32), rd.bits(32)];
  const [ny, nz, nf] = nz2;
  if (type !== 0) throw new Error('fpzip: double precision streams are not supported');
  const bits = precision || 32;
  if (bits < 2 || bits > 32) throw new Error(`fpzip: invalid precision ${precision}`);
  const field = nx * ny * nz;
  const total = field * nf;
  if (!field || !nf || total > MAX_ELEMENTS) throw new Error(`fpzip: implausible array size ${nx}x${ny}x${nz}x${nf}`);
  const data = new Float32Array(total);
  for (let f = 0; f < nf; f += 1) decompress3d(rd, data, f * field, nx, ny, nz, bits);
  return { nx, ny, nz, nf, precision: bits, data };
}
