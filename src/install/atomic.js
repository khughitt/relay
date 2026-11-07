// @ts-check
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { relayError } from '../protocol.js';

const harnesses = new Set(['claude-code', 'codex', 'opencode']);
/** @param {unknown} value @returns {value is Record<string, any>} */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @type {(message: string) => never} */
const fail = message => { throw relayError('INVALID_ARTIFACT', `invalid artifact: ${message}`); };

/** @param {unknown} value @returns {import("../types.js").Artifact} */
export function validateArtifact(value) {
  if (!object(value) || value.schema !== 1 || !harnesses.has(value.harness) || !Array.isArray(value.changes)
    || !Object.hasOwn(value, 'evidence')) fail('expected schema, harness, changes, and evidence');
  if (Object.keys(value).some(key => !['schema', 'harness', 'changes', 'evidence'].includes(key))) fail('unexpected field');
  if (value.evidence !== null && (!object(value.evidence) || typeof value.evidence.harness !== 'string' || typeof value.evidence.version !== 'string'
    || Object.keys(value.evidence).some(key => !['harness', 'version'].includes(key)))) fail('invalid evidence');
  const paths = new Set();
  for (const change of value.changes) {
    if (!object(change)) fail('change must be an object');
    if (!isAbsolute(change.path)) fail('change path must be absolute');
    if (!(change.before === null || typeof change.before === 'string') || typeof change.after !== 'string'
      || Object.keys(change).some(key => !['path', 'before', 'after'].includes(key))) fail('invalid change');
    if (change.before === change.after) fail('change must differ');
    if (paths.has(change.path)) fail('duplicate change path');
    paths.add(change.path);
  }
  return /** @type {import("../types.js").Artifact} */ (value);
}

/** @param {string} path @param {typeof fs} io */
const inspect = (path, io) => {
  try {
    const stat = io.lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw relayError('UNSAFE_TARGET', `unsafe target: ${path} is a symlink or not a regular file`);
    return io.readFileSync(path, 'utf8');
  } catch (caught) { const error = /** @type {import('../types.js').Failure} */ (caught);
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

/** @param {string} path @param {string} text */
export function writeAtomicSync(path, text, { io = fs, suffix = randomUUID } = {}) {
  const temp = `${path}.tmp.${suffix()}`;
  try {
    io.writeFileSync(temp, text, { flag: 'wx', mode: 0o600 });
    const fd = io.openSync(temp, 'r');
    try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
    io.renameSync(temp, path);
  } catch (caught) { const error = /** @type {import('../types.js').Failure} */ (caught);
    try { io.unlinkSync(temp); }
    catch (caught) { const cleanup = /** @type {import('../types.js').Failure} */ (caught);
      if (cleanup.code !== 'ENOENT') throw new AggregateError([error, cleanup], `atomic write and cleanup failed for ${temp}`);
    }
    throw error;
  }
}

// A target holding neither image refuses, naming the image the operation expected to find there.
/** @param {import("../types.js").Change} change @param {typeof fs} io @param {'apply'|'rollback'} operation */
const targetState = (change, io, operation) => {
  const current = inspect(change.path, io);
  if (current === change.after) return 'after';
  if (current === change.before) return 'before';
  const expected = operation === 'rollback' ? 'its after image' : change.before === null ? 'it absent' : 'its before image';
  throw relayError('TARGET_DRIFT', `target drift: ${change.path} matches neither image; ${operation} expected ${expected}`);
};

/** @param {string} path @param {unknown} value */
export function applyArtifact(path, value, { io = fs } = {}) {
  const artifact = validateArtifact(value);
  writeAtomicSync(path, `${JSON.stringify(artifact)}\n`, { io });
  for (const change of artifact.changes) {
    if (targetState(change, io, 'apply') === 'before') writeAtomicSync(change.path, change.after, { io });
  }
}

/** @param {unknown} value */
export function rollbackArtifact(value, { io = fs } = {}) {
  const artifact = validateArtifact(value);
  for (const change of artifact.changes) {
    if (targetState(change, io, 'rollback') !== 'after') continue;
    if (change.before === null) io.unlinkSync(change.path);
    else writeAtomicSync(change.path, change.before, { io });
  }
}
