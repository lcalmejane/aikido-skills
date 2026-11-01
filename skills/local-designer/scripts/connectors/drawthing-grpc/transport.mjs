// gRPC over HTTP/2 for the Draw Things image service, using only Node built-ins.
// TLS: the Draw Things server uses a self-signed certificate, so the chain cannot be validated. Policy:
//   - loopback host: accepted (the traffic never leaves the machine);
//   - other host: the certificate SHA-256 fingerprint must be given (--fingerprint), or --insecure-tls must be explicit.
import http2 from 'node:http2';
import tls from 'node:tls';
import { grpcFrame, grpcUnframe } from './protobuf.mjs';

export const SERVICE = '/ImageGenerationService';

export const isLoopback = (host) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(host));

const normalizeFingerprint = (text) => String(text).replace(/[^0-9a-f]/gi, '').toLowerCase();

export function parseTarget(text, fallback = '127.0.0.1:7859') {
  const s = String(text || fallback).replace(/^grpcs?:\/\//, '').replace(/\/+$/, '');
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(s);
  if (!m) throw new Error(`Invalid gRPC address "${text}" (expected host:port)`);
  return { host: m[1].replace(/^\[|\]$/g, ''), port: Number(m[2] ?? 7859) };
}

const GRPC_STATUS = {
  1: 'CANCELLED', 2: 'UNKNOWN', 3: 'INVALID_ARGUMENT', 4: 'DEADLINE_EXCEEDED', 5: 'NOT_FOUND', 7: 'PERMISSION_DENIED',
  8: 'RESOURCE_EXHAUSTED', 12: 'UNIMPLEMENTED', 13: 'INTERNAL', 14: 'UNAVAILABLE', 16: 'UNAUTHENTICATED',
};

export class GrpcError extends Error {
  constructor(code, detail) {
    super(`gRPC ${GRPC_STATUS[code] ?? code}${detail ? `: ${detail}` : ''}`);
    this.code = code;
  }
}

// Opens a channel. Returns { client, fingerprint, close() }.
export async function openChannel({ host, port, useTls = true, fingerprint, insecure = false, timeoutMs = 5000 }) {
  if (!useTls) {
    const client = http2.connect(`http://${host}:${port}`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout connecting to ${host}:${port}`)), timeoutMs);
      client.once('connect', () => { clearTimeout(timer); resolve(); });
      client.once('error', (e) => { clearTimeout(timer); reject(e); });
    }).catch((e) => { client.destroy(); throw e; });
    client.on('error', () => {});
    client.unref();
    return { client, fingerprint: null, close: () => client.close() };
  }
  const socket = tls.connect({ host, port, rejectUnauthorized: false, ALPNProtocols: ['h2'], servername: /^[\d.]+$|:/.test(host) ? undefined : host });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`Timeout connecting to ${host}:${port}`)); }, timeoutMs);
    socket.once('secureConnect', () => { clearTimeout(timer); resolve(); });
    socket.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
  const observed = socket.getPeerCertificate()?.fingerprint256 ?? null;
  const fail = (message) => { socket.destroy(); throw new Error(message); };
  if (socket.alpnProtocol !== 'h2') fail(`${host}:${port} did not negotiate HTTP/2 (is this a Draw Things gRPC server with TLS on?)`);
  if (fingerprint) {
    if (normalizeFingerprint(fingerprint) !== normalizeFingerprint(observed ?? '')) {
      fail(`Certificate fingerprint mismatch for ${host}:${port}. Expected ${fingerprint}, got ${observed}. Refusing to connect.`);
    }
  } else if (!isLoopback(host) && !insecure) {
    fail(`${host}:${port} presents a self-signed certificate (SHA-256 ${observed}). Pass --fingerprint ${observed} after checking it, or --insecure-tls to accept any certificate.`);
  }
  const client = http2.connect(`https://${host}:${port}`, { createConnection: () => socket });
  client.on('error', () => {});
  client.unref();
  return { client, fingerprint: observed, close: () => client.close() };
}

// One call. `onMessage(buffer)` runs for every response message; resolves with the list of messages when it is not given.
export function call(channel, method, payload, { onMessage, timeoutMs = 30000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const req = channel.client.request({
      ':method': 'POST', ':path': `${SERVICE}/${method}`, 'content-type': 'application/grpc', te: 'trailers',
    });
    const collected = [];
    let pending = Buffer.alloc(0);
    let status = null;
    let detail = '';
    let done = false;
    let timer;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) {
        if (!req.closed) req.close(http2.constants.NGHTTP2_CANCEL);
        reject(error);
      } else resolve(collected);
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(new Error(`Timeout after ${Math.round(timeoutMs / 1000)}s without any answer on ${method}`)), timeoutMs);
    };
    const onAbort = () => finish(new Error('Generation cancelled'));
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const readStatus = (headers) => {
      if (headers['grpc-status'] !== undefined) status = Number(headers['grpc-status']);
      if (headers['grpc-message'] !== undefined) detail = decodeURIComponent(String(headers['grpc-message']));
    };
    req.on('response', readStatus);
    req.on('trailers', readStatus);
    req.on('data', (chunk) => {
      arm();
      try {
        const { messages, rest } = grpcUnframe(Buffer.concat([pending, chunk]));
        pending = rest;
        for (const m of messages) {
          if (onMessage) onMessage(m);
          else collected.push(m);
        }
      } catch (e) {
        finish(e);
      }
    });
    req.on('error', (e) => finish(e));
    req.on('end', () => {
      if (status !== null && status !== 0) finish(new GrpcError(status, detail));
      else finish();
    });
    arm();
    req.end(grpcFrame(payload));
  });
}
