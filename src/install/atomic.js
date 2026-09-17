import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

const harnesses = new Set(['claude-code', 'codex', 'opencode']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(`invalid artifact: ${message}`); };

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
  return value;
}

const inspect = (path, io) => {
  try {
    const stat = io.lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`unsafe target: ${path}`);
    return io.readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

export function writeAtomicSync(path, text, { io = fs, suffix = randomUUID } = {}) {
  const temp = `${path}.tmp.${suffix()}`;
  try {
    io.writeFileSync(temp, text, { flag: 'wx', mode: 0o600 });
    const fd = io.openSync(temp, 'r');
    try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
    io.renameSync(temp, path);
  } catch (error) {
    try { io.unlinkSync(temp); }
    catch (cleanup) {
      if (cleanup.code !== 'ENOENT') throw new AggregateError([error, cleanup], `atomic write and cleanup failed for ${temp}`);
    }
    throw error;
  }
}

const targetState = (change, io) => {
  const current = inspect(change.path, io);
  if (change.before === null) {
    if (current === null) return 'before';
    if (current === change.after) return 'after';
    throw new Error(`target must be absent: ${change.path}`);
  }
  if (current === change.after) return 'after';
  if (current === change.before) return 'before';
  throw new Error(`preimage drift: ${change.path}`);
};

export function applyArtifact(path, value, { io = fs } = {}) {
  const artifact = validateArtifact(value);
  writeAtomicSync(path, `${JSON.stringify(artifact)}\n`, { io });
  for (const change of artifact.changes) {
    if (targetState(change, io) === 'before') writeAtomicSync(change.path, change.after, { io });
  }
}

export function rollbackArtifact(value, { io = fs } = {}) {
  const artifact = validateArtifact(value);
  for (const change of artifact.changes) {
    if (targetState(change, io) !== 'after') continue;
    if (change.before === null) io.unlinkSync(change.path);
    else writeAtomicSync(change.path, change.before, { io });
  }
}
