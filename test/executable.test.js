import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { mkdtemp, mkdir, writeFile, symlink, chmod, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { resolveExecutable } from '../src/executable.js';
import { runGroupLeader } from '../src/child.js';
const runChild = (argv, input, options) => runGroupLeader(argv, input, options).done;

const script = (body) => `#!/bin/sh\n${body}\n`;
async function executable(path, body = 'exit 0') { await mkdir(dirname(path), { recursive: true }); await writeFile(path, script(body), { mode: 0o755 }); }
const clock = () => performance.now();
const soon = () => clock() + 2000;
const find = (searchPath, options = {}) => resolveExecutable('guard', { searchPath, deadline: soon(), ...options });

// One fixture tree per test: a checkout, host directories that hold or link to its guard, and one
// directory per way a candidate can be unusable.
async function tree(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'relay-exec-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout'), hostbin = join(root, 'hostbin');
  await mkdir(join(checkout, '.git'), { recursive: true });
  await executable(join(checkout, 'bin', 'guard'), 'echo checkout-guard');
  await mkdir(hostbin);
  await symlink(join(checkout, 'bin', 'guard'), join(hostbin, 'guard'));
  await symlink(join(checkout, 'bin'), join(root, 'alias'));
  await mkdir(join(root, 'broken')); await symlink(join(root, 'missing'), join(root, 'broken', 'guard'));
  await mkdir(join(root, 'noexec')); await writeFile(join(root, 'noexec', 'guard'), script('exit 0'), { mode: 0o644 });
  await mkdir(join(root, 'dirguard', 'guard'), { recursive: true });
  await symlink(join(root, 'loop'), join(root, 'loop'));
  await writeFile(join(root, 'file'), '');
  await mkdir(join(root, 'empty'));
  return { root, checkout, hostbin };
}

test('the search tries each listed directory in order and passes over an absent one', async (t) => {
  const f = await tree(t);
  const installed = { candidate: join(f.hostbin, 'guard'), realPath: join(f.checkout, 'bin', 'guard') };
  assert.deepEqual(await find([join(f.root, 'no-such-directory'), f.hostbin]), installed);
  assert.deepEqual(await find([join(f.root, 'file'), f.hostbin]), installed, 'an entry that is a file holds nothing');
  assert.deepEqual(await find([join(f.root, 'empty'), f.hostbin, join(f.root, 'broken')]), installed, 'the first candidate wins');
});

test('a listed directory or link into a checkout resolves to the checkout file', async (t) => {
  const f = await tree(t), realPath = join(f.checkout, 'bin', 'guard');
  for (const dir of [join(f.checkout, 'bin'), join(f.root, 'alias'), f.hostbin]) assert.deepEqual(await find([dir]), { candidate: join(dir, 'guard'), realPath }, dir);
});

test('a present but unusable candidate ends the search even when a later entry holds a good one', async (t) => {
  const f = await tree(t);
  for (const dir of ['broken', 'noexec', 'dirguard', 'loop']) {
    await assert.rejects(find([join(f.root, dir), f.hostbin]), { code: 'EXECUTABLE_UNUSABLE', candidate: join(f.root, dir, 'guard') }, dir);
  }
});

test('a listed directory that cannot be searched is unusable, never a reason to look further', { skip: process.getuid?.() === 0 }, async (t) => {
  const f = await tree(t), locked = join(f.root, 'locked');
  await executable(join(locked, 'guard'));
  await chmod(locked, 0o000);
  try { await assert.rejects(find([locked, f.hostbin]), { code: 'EXECUTABLE_UNUSABLE' }); } finally { await chmod(locked, 0o755); }
});

test('an exhausted list names the search path', async (t) => {
  const f = await tree(t);
  await assert.rejects(find([join(f.root, 'empty'), join(f.root, 'no-such-directory')]), (error) => {
    assert.equal(error.code, 'EXECUTABLE_NOT_FOUND');
    assert.match(error.message, /guard .*search path/);
    assert.doesNotMatch(error.message, /PATH/);
    return true;
  });
});

test('every filesystem step ends at the work deadline', async (t) => {
  const f = await tree(t);
  await assert.rejects(find([f.hostbin], { deadline: clock() - 1 }), { code: 'DEADLINE_EXCEEDED' });
  for (const name of ['lstat', 'stat', 'access', 'realpath']) {
    const started = clock();
    await assert.rejects(find([f.hostbin], { deadline: clock() + 50, io: { ...fs, [name]: () => new Promise(() => {}) } }), { code: 'DEADLINE_EXCEEDED' }, name);
    assert.ok(clock() - started < 1000, name);
  }
});

test('a subscriber runs in the given cwd with exactly the given environment', async (t) => {
  const f = await tree(t);
  const out = join(f.root, 'env-out'), cwd = join(f.root, 'empty');
  await executable(join(f.root, 'probe', 'probe'), `pwd > ${out}; echo "$RELAY_ONLY:$HOME:\${LEAK-unset}" >> ${out}`);
  process.env.LEAK = 'leaked'; t.after(() => { delete process.env.LEAK; });
  const result = await runChild([join(f.root, 'probe', 'probe')], '', { deadline: soon(), timeoutMs: 2000, cwd, env: { PATH: '/usr/bin:/bin', HOME: f.root, RELAY_ONLY: 'yes' } });
  assert.equal(result.status, 'exited');
  assert.deepEqual((await readFile(out, 'utf8')).trim().split('\n'), [cwd, `yes:${f.root}:unset`]);
});
