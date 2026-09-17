import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { applyArtifact, rollbackArtifact, validateArtifact, writeAtomicSync } from '../src/install/atomic.js';

const change = (path, before, after) => ({ path, before, after });
const artifact = (changes) => ({ schema: 1, harness: 'codex', changes, evidence: null });
const setup = async t => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-install-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, target: join(dir, 'hooks.json'), artifact: join(dir, 'artifact.json') };
};

test('artifact validation rejects non-deterministic and invalid changes', () => {
  assert.deepEqual(validateArtifact(artifact([])), artifact([]));
  assert.throws(() => validateArtifact(artifact([{ path: '/tmp/x', before: 'a', after: 'a' }])), /change must differ/);
  assert.throws(() => validateArtifact(artifact([{ path: 'relative', before: null, after: 'a' }])), /absolute/);
  assert.throws(() => validateArtifact({ ...artifact([]), unknown: true }), /unexpected field/);
});

test('apply writes and fsyncs the artifact before the first target rename', async t => {
  const p = await setup(t);
  await writeFile(p.target, 'before');
  const calls = [];
  const io = {
    ...fs,
    fsyncSync(fd) { calls.push(['fsync', fd]); return fs.fsyncSync(fd); },
    renameSync(from, to) { calls.push(['rename', from, to]); return fs.renameSync(from, to); },
  };
  applyArtifact(p.artifact, artifact([change(p.target, 'before', 'after')]), { io });
  assert.equal(await readFile(p.target, 'utf8'), 'after');
  assert.equal(JSON.parse(await readFile(p.artifact, 'utf8')).changes[0].after, 'after');
  assert.ok(calls.findIndex(([kind]) => kind === 'fsync') < calls.findIndex(([kind]) => kind === 'rename'));
});

test('apply refuses preimage drift and a present before-null target', async t => {
  const p = await setup(t);
  await writeFile(p.target, 'third-party');
  assert.throws(() => applyArtifact(p.artifact, artifact([change(p.target, 'before', 'after')])), /preimage/);
  assert.throws(() => applyArtifact(p.artifact, artifact([change(p.target, null, 'after')])), /must be absent/);
  assert.equal(await readFile(p.target, 'utf8'), 'third-party');
});

test('atomic writer cleans its sibling temporary file after a rename failure', async t => {
  const p = await setup(t), temp = `${p.target}.tmp.fixed`;
  const io = { ...fs, renameSync() { throw new Error('rename blocked'); } };
  assert.throws(() => writeAtomicSync(p.target, 'after', { io, suffix: () => 'fixed' }), /rename blocked/);
  assert.equal(fs.existsSync(temp), false);
});

test('rollback restores after, skips before, and refuses drift per file', async t => {
  const p = await setup(t), second = join(p.dir, 'second.json'), third = join(p.dir, 'third.json');
  await writeFile(p.target, 'after');
  await writeFile(second, 'before');
  await writeFile(third, 'drift');
  const a = artifact([change(p.target, 'before', 'after'), change(second, 'before', 'after'), change(third, 'before', 'after')]);
  assert.throws(() => rollbackArtifact(a), /drift/);
  assert.equal(await readFile(p.target, 'utf8'), 'before');
  assert.equal(await readFile(second, 'utf8'), 'before');
  assert.equal(await readFile(third, 'utf8'), 'drift');
});

test('rollback removes only a matching before-null target', async t => {
  const p = await setup(t);
  await writeFile(p.target, 'after');
  rollbackArtifact(artifact([change(p.target, null, 'after')]));
  assert.equal(fs.existsSync(p.target), false);
});
