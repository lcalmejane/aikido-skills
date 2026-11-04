// Connector registry. A connector drives one image engine installed on the machine.
// The contract is documented in references/connectors.md and checked by validateConnector().
import { connector as drawthing } from './drawthing.mjs';
import { connector as drawthingGrpc } from './drawthing-grpc/index.mjs';
import { engineOptions } from '../engine-config.mjs';

export const DEFAULT_CONNECTOR = 'drawthing';
const REGISTRY = new Map();

const ID = /^[a-z0-9][a-z0-9-]*$/;
const FUNCTIONS = ['connect', 'describe', 'plan', 'render', 'readMetadata'];

// Optional request keys a connector can decline to support; the generic keys are mandatory.
export const OPTIONAL_KEYS = ['model', 'sampler', 'shift', 'seedMode', 'clipSkip', 'plain', 'lora', 'set', 'initImage', 'strength'];

export function validateConnector(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return ['connector must be an object'];
  if (!ID.test(c.id ?? '')) errors.push('id must match [a-z0-9][a-z0-9-]*');
  if (!c.label) errors.push('label is required');
  if (!Array.isArray(c.supports)) errors.push('supports must be an array of optional request keys');
  else for (const k of c.supports) if (!OPTIONAL_KEYS.includes(k)) errors.push(`supports: unknown key "${k}"`);
  for (const f of FUNCTIONS) if (typeof c[f] !== 'function') errors.push(`${f}() is required`);
  if (c.detect !== undefined && typeof c.detect !== 'function') errors.push('detect() must be a function');
  return errors;
}

export function registerConnector(c) {
  const errors = validateConnector(c);
  if (errors.length) throw new Error(`Invalid connector ${c?.id ?? '?'}: ${errors.join('; ')}`);
  REGISTRY.set(c.id, c);
  return c;
}

export function unregisterConnector(id) {
  if (id !== DEFAULT_CONNECTOR) REGISTRY.delete(id);
}

export const listConnectors = () => [...REGISTRY.values()];

export function getConnector(id) {
  const c = REGISTRY.get(id);
  if (!c) throw new Error(`Unknown connector "${id}". Available: ${[...REGISTRY.keys()].join(', ')}`);
  return c;
}

// Choice order: --connector, then $LOCAL_DESIGNER_CONNECTOR, then "auto".
// "auto" keeps the default when it is the only one registered (no extra request); otherwise it probes each
// registered connector in order and takes the first that answers, falling back to the default so the usual
// "engine not reachable" hint is what the user sees.
export async function resolveConnector(opts = {}, env = process.env) {
  opts = engineOptions(opts, { env });
  const asked = (opts.connector && opts.connector !== true ? String(opts.connector) : env.LOCAL_DESIGNER_CONNECTOR) || 'auto';
  if (asked !== 'auto') return getConnector(asked);
  const all = listConnectors();
  if (all.length > 1) {
    for (const c of all) if (typeof c.detect === 'function' && (await c.detect(opts))) return c;
  }
  return getConnector(DEFAULT_CONNECTOR);
}

registerConnector(drawthing);
registerConnector(drawthingGrpc);
