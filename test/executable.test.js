import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, chmod, realpath, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { discoverBoundaries, resolveExecutable } from '../src/executable.js';
import { runChild } from '../src/child.js';

const script = (body) => `#!/bin/sh\n${body}\n`;
async function executable(path, body = 'exit 0') { await mkdir(dirname(path), { recursive: true }); await writeFile(path, script(body), { mode: 0o755 }); }
const clock = () => performance.now();
const soon = () => clock() + 2000;
const exists = (path) => access(path).then(() => true, () => false);

// One fixture tree per test: a main checkout with a linked worktree inside it and one beside it,
// a bare repository, installed host directories and lookalike siblings.
async function tree(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'relay-exec-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout');
  await mkdir(join(checkout, '.git', 'worktrees', 'inner'), { recursive: true });
  await mkdir(join(checkout, '.git', 'worktrees', 'beside'), { recursive: true });
  await executable(join(checkout, 'bin', 'guard'), 'echo checkout-guard');
  await mkdir(join(checkout, 'sub', 'nested'), { recursive: true });
  const inner = join(checkout, '.worktrees', 'inner'), beside = join(root, 'beside');
  for (const [wt, name] of [[inner, 'inner'], [beside, 'beside']]) {
    await mkdir(join(wt, 'src'), { recursive: true });
    await writeFile(join(wt, '.git'), `gitdir: ${join(checkout, '.git', 'worktrees', name)}\n`);
    await executable(join(wt, 'bin', 'guard'));
  }
  const hostbin = join(root, 'hostbin');
  await mkdir(hostbin);
  await symlink(join(checkout, 'bin', 'guard'), join(hostbin, 'guard'));
  await symlink(join(beside, 'bin', 'guard'), join(hostbin, 'beside-guard'));
  await symlink(join(checkout, 'bin'), join(root, 'alias'));
  await executable(join(root, 'checkout-tools', 'bin', 'guard'));
  await mkdir(join(root, 'broken')); await symlink(join(root, 'missing'), join(root, 'broken', 'guard'));
  await mkdir(join(root, 'noexec')); await writeFile(join(root, 'noexec', 'guard'), script('exit 0'), { mode: 0o644 });
  await mkdir(join(root, 'dirguard', 'guard'), { recursive: true });
  const bare = join(root, 'bare.git');
  for (const dir of ['objects', 'refs']) await mkdir(join(bare, dir), { recursive: true });
  await writeFile(join(bare, 'HEAD'), 'ref: refs/heads/main\n');
  await symlink(join(checkout, 'sub'), join(root, 'cwdlink'));
  const plain = join(root, 'plain', 'deep');
  await mkdir(plain, { recursive: true });
  return { root, checkout, inner, beside, hostbin, bare, plain };
}

test('boundary discovery finds every enclosing checkout through the filesystem, never through git', async (t) => {
  const f = await tree(t);
  const dirs = async (cwd, invokingCwd = cwd) => (await discoverBoundaries({ cwd, invokingCwd, deadline: soon() })).directories.sort();
  assert.deepEqual(await dirs(join(f.checkout, 'sub', 'nested')), [f.checkout, join(f.checkout, 'sub', 'nested')].sort());
  assert.deepEqual(await dirs(join(f.inner, 'src')), [f.checkout, f.inner, join(f.inner, 'src')].sort(), 'nested linked worktree and its enclosing main checkout');
  assert.deepEqual(await dirs(join(f.beside, 'src')), [f.beside, join(f.beside, 'src')].sort(), 'a linked worktree beside its main checkout excludes only itself');
  assert.deepEqual(await dirs(join(f.root, 'cwdlink', 'nested')), [f.checkout, join(f.checkout, 'sub', 'nested')].sort(), 'a symlinked cwd resolves before the walk');
  assert.deepEqual(await dirs(join(f.bare, 'objects')), [f.bare, join(f.bare, 'objects')].sort(), 'bare repository markers');
  assert.deepEqual(await dirs(f.plain), [f.plain], 'a proven non-repository contributes only the working directory');
  assert.deepEqual(await dirs(f.plain, join(f.checkout, 'sub')), [f.checkout, f.plain, join(f.checkout, 'sub')].sort(), 'native and invoking cwd both participate');
});

test('discovery refuses malformed markers, unreadable paths and an exhausted deadline instead of assuming outside', async (t) => {
  const f = await tree(t);
  const fails = (cwd, deadline = soon()) => assert.rejects(discoverBoundaries({ cwd, invokingCwd: cwd, deadline }), { code: 'REPOSITORY_UNREADABLE' }, cwd);
  const make = async (name, gitText) => { const dir = join(f.root, name, 'w'); await mkdir(dir, { recursive: true }); await writeFile(join(dir, '..', '.git'), gitText); return dir; };
  await fails(await make('garbage', 'not a gitdir line\n'));
  await fails(await make('dangling', `gitdir: ${join(f.root, 'nowhere')}\n`));
  await fails(await make('huge', `gitdir: ${'x'.repeat(9000)}\n`));
  await fails(join(f.root, 'does-not-exist'));
  await fails(f.plain, clock() - 1);
  if (process.getuid?.() !== 0) {
    const locked = await make('locked', `gitdir: ${join(f.checkout, '.git')}\n`);
    await chmod(join(locked, '..', '.git'), 0o000);
    try { await fails(locked); } finally { await chmod(join(locked, '..', '.git'), 0o644); }
  }
});

test('an installed link into the checkout resolves; repository-local PATH entries and their aliases refuse', async (t) => {
  const f = await tree(t);
  for (const cwd of [join(f.checkout, 'sub'), join(f.inner, 'src')]) {
    const boundaries = await discoverBoundaries({ cwd, invokingCwd: cwd, deadline: soon() });
    const options = (path) => ({ path, boundaries, deadline: soon() });
    const outsideLinkOptions = options(['', 'relative', '.', f.hostbin, join(f.checkout, 'bin')].join(':'));
    const installedLink = join(f.hostbin, 'guard'), checkoutGuard = join(f.checkout, 'bin', 'guard');
    assert.equal((await resolveExecutable('guard', outsideLinkOptions)).candidate, installedLink, cwd);
    assert.equal((await resolveExecutable('guard', outsideLinkOptions)).realPath, checkoutGuard, cwd);
    const repoFirstOptions = options([join(f.checkout, 'bin'), f.hostbin].join(':'));
    await assert.rejects(resolveExecutable('guard', repoFirstOptions), { code: 'EXECUTABLE_FORBIDDEN' }, cwd);
    await assert.rejects(resolveExecutable('guard', options([join(f.root, 'alias'), f.hostbin].join(':'))), { code: 'EXECUTABLE_FORBIDDEN' }, 'directory alias');
    assert.equal((await resolveExecutable('guard', options(join(f.root, 'checkout-tools', 'bin')))).candidate, join(f.root, 'checkout-tools', 'bin', 'guard'), 'a similar-name sibling is outside');
  }
  const innerBoundaries = await discoverBoundaries({ cwd: join(f.inner, 'src'), invokingCwd: join(f.inner, 'src'), deadline: soon() });
  await assert.rejects(resolveExecutable('guard', { path: join(f.inner, 'bin'), boundaries: innerBoundaries, deadline: soon() }), { code: 'EXECUTABLE_FORBIDDEN' }, 'the linked worktree bin');
  const besideBoundaries = await discoverBoundaries({ cwd: join(f.beside, 'src'), invokingCwd: join(f.beside, 'src'), deadline: soon() });
  assert.equal((await resolveExecutable('beside-guard', { path: f.hostbin, boundaries: besideBoundaries, deadline: soon() })).realPath, join(f.beside, 'bin', 'guard'), 'an installed link into a linked worktree resolves');
  assert.equal((await resolveExecutable('guard', { path: join(f.checkout, 'bin'), boundaries: besideBoundaries, deadline: soon() })).candidate, join(f.checkout, 'bin', 'guard'), 'the main checkout is not a boundary of a worktree beside it');
});

test('resolution stops at an unusable candidate and never searches relative entries', async (t) => {
  const f = await tree(t);
  const boundaries = await discoverBoundaries({ cwd: f.plain, invokingCwd: f.plain, deadline: soon() });
  const resolve = (command, path) => resolveExecutable(command, { path, boundaries, deadline: soon() });
  for (const dir of ['broken', 'noexec', 'dirguard']) await assert.rejects(resolve('guard', [join(f.root, dir), f.hostbin].join(':')), { code: 'EXECUTABLE_UNUSABLE' }, dir);
  await assert.rejects(resolve('guard', join(f.root, 'empty-missing-dir')), { code: 'EXECUTABLE_NOT_FOUND' });
  await assert.rejects(resolve('relay.js', ['bin', './bin', ''].join(':')), { code: 'EXECUTABLE_NOT_FOUND' }, 'a relative bin that would hold relay.js is skipped');
  await assert.rejects(resolveExecutable('guard', { path: f.hostbin, boundaries, deadline: clock() - 1 }), { code: 'DEADLINE_EXCEEDED' });
  for (const command of ['/usr/bin/true', 'bin/guard', '', '.', '..']) await assert.rejects(resolve(command, f.hostbin), { code: 'EXECUTABLE_FORBIDDEN' }, JSON.stringify(command));
});

test('the child PATH keeps only canonical outside directories, so an env shebang cannot reach a repo interpreter', async (t) => {
  const f = await tree(t);
  const safe = join(f.root, 'safe-marker'), evil = join(f.root, 'evil-marker');
  await executable(join(f.checkout, 'bin', 'fakeinterp'), `echo evil > ${evil}`);
  await executable(join(f.root, 'tools', 'fakeinterp'), `echo safe > ${safe}`);
  await mkdir(join(f.root, 'scripts'));
  await writeFile(join(f.root, 'scripts', 'tool'), '#!/usr/bin/env fakeinterp\n', { mode: 0o755 });
  const cwd = join(f.checkout, 'sub');
  const boundaries = await discoverBoundaries({ cwd, invokingCwd: cwd, deadline: soon() });
  const path = [join(f.checkout, 'bin'), join(f.root, 'alias'), 'relative', join(f.root, 'scripts'), join(f.root, 'tools'), '/usr/bin', '/bin', join(f.root, 'tools')].join(':');
  const resolved = await resolveExecutable('tool', { path, boundaries, deadline: soon() });
  assert.deepEqual(resolved.childPath.split(':').filter((dir) => dir.startsWith(f.root)), [join(f.root, 'scripts'), join(f.root, 'tools')]);
  const result = await runChild([resolved.candidate], '', { deadline: soon(), timeoutMs: 2000, cwd, env: { PATH: resolved.childPath, HOME: f.root } });
  assert.equal(result.status, 'exited');
  assert.equal(await exists(evil), false);
  assert.equal((await readFile(safe, 'utf8')).trim(), 'safe');
});

test('runChild runs in the given cwd with exactly the given environment', async (t) => {
  const f = await tree(t);
  const out = join(f.root, 'env-out');
  await executable(join(f.root, 'probe', 'probe'), `pwd > ${out}; echo "$RELAY_ONLY:$HOME:\${LEAK-unset}" >> ${out}`);
  process.env.LEAK = 'leaked'; t.after(() => { delete process.env.LEAK; });
  const result = await runChild([join(f.root, 'probe', 'probe')], '', { deadline: soon(), timeoutMs: 2000, cwd: f.plain, env: { PATH: '/usr/bin:/bin', HOME: f.root, RELAY_ONLY: 'yes' } });
  assert.equal(result.status, 'exited');
  assert.deepEqual((await readFile(out, 'utf8')).trim().split('\n'), [f.plain, `yes:${f.root}:unset`]);
});
