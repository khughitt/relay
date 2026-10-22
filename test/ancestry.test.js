import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adapterFor, nearestHarness } from '../src/adapters/index.js';
import { createProcessOps } from '../src/bus/proc.js';
const corpus = JSON.parse(readFileSync(new URL('./fixtures/ancestry.json', import.meta.url)));
test('ancestry corpus is versioned and names every harness', () => {
  assert.equal(corpus.schema, 1);
  assert.deepEqual([...new Set(corpus.chains.map(c => c.harness))].sort(), ['claude-code', 'codex', 'opencode']);
});
for (const chain of corpus.chains) {
  test(`ancestry corpus: ${chain.name}`, () => {
    const adapter = adapterFor(chain.harness), rows = new Map(chain.rows.map(r => [r.pid, r]));
    const ancestors = () => chain.rows.map(({ pid, ppid, comm, tty }) => ({ pid, ppid, comm, tty, starttime: '1', state: 'S' }));
    const gated = (field) => (pid) => {
      const value = rows.get(pid)?.[field];
      if (value === null || value === undefined) throw new Error(`${field} of ${pid} must not be read`);
      return value;
    };
    const startPid = chain.rows[0].pid;
    assert.equal(adapter.resolveSessionPid({ startPid, ancestors, executableOf: gated('exe'), argvOf: gated('argv') }), chain.session, 'session');
    assert.equal(adapter.resolveTerminalPid({ startPid, ancestors, executableOf: gated('exe'), argvOf: gated('argv') }), chain.terminal, 'terminal');
  });
}
test('unreadable executable or arguments of the process under test is an error, never a skip', () => {
  const claude = adapterFor('claude-code');
  const unreadable = () => { throw Object.assign(new Error('denied'), { code: 'PROCESS_UNREADABLE' }); };
  const version = () => [{ pid: 5, comm: 'node', tty: null }, { pid: 4, comm: '2.1.280', tty: null }, { pid: 3, comm: 'claude', tty: true }];
  assert.throws(() => claude.resolveSessionPid({ ancestors: version, executableOf: unreadable, argvOf: () => ['x'] }), { code: 'PROCESS_UNREADABLE' });
  const plain = () => [{ pid: 5, comm: 'node', tty: null }, { pid: 3, comm: 'claude', tty: true }];
  assert.throws(() => claude.resolveSessionPid({ ancestors: plain, executableOf: unreadable, argvOf: unreadable }), { code: 'PROCESS_UNREADABLE' });
});
test('the terminal walk surfaces an unreadable executable or parent arguments, never a skip', () => {
  const claude = adapterFor('claude-code');
  const unreadable = () => { throw Object.assign(new Error('denied'), { code: 'PROCESS_UNREADABLE' }); };
  const exe = () => '/home/user/.local/share/claude/versions/2.1.304';
  const chain = () => [{ pid: 5, comm: 'node', tty: null }, { pid: 4, comm: '2.1.304', tty: true }, { pid: 3, comm: 'zsh', tty: true }];
  assert.throws(() => claude.resolveTerminalPid({ ancestors: chain, executableOf: unreadable, argvOf: () => ['zsh'] }), { code: 'PROCESS_UNREADABLE' });
  assert.throws(() => claude.resolveTerminalPid({ ancestors: chain, executableOf: exe, argvOf: unreadable }), { code: 'PROCESS_UNREADABLE' });
});
test('a terminal-owning version process is the terminal unless its parent holds a hosting role', () => {
  const claude = adapterFor('claude-code');
  const exe = () => '/home/user/.local/share/claude/versions/2.1.304';
  const under = (parent) => () => [{ pid: 5, comm: 'node', tty: null }, { pid: 4, comm: '2.1.304', tty: true }, ...parent];
  const argvOf = (pid) => ({ 3: ['claude', 'daemon', 'run'] })[pid] ?? (() => { throw new Error(`argv of ${pid} must not be read`); })();
  assert.equal(claude.resolveTerminalPid({ ancestors: under([]), executableOf: exe, argvOf }), 4, 'parent outside the chain');
  assert.equal(claude.resolveTerminalPid({ ancestors: under([{ pid: 3, comm: 'claude', tty: null }]), executableOf: exe, argvOf }), null, 'daemon parent');
});
test('an empty cmdline on the nearest Claude process is no role, so its pid is published', () => {
  const chain = () => [{ pid: 5, comm: 'node', tty: null }, { pid: 3, comm: 'claude', tty: null }];
  assert.equal(adapterFor('claude-code').resolveSessionPid({ ancestors: chain, executableOf: () => { throw new Error('not read'); }, argvOf: () => [] }), 3);
});
// Review regression: with args split on whitespace, argv[1] of this daemon was "User/.local/bin/claude".
const darwinPs = (comm, args) => createProcessOps({ platform: 'darwin',
  runPs: (a) => a.includes('comm=') ? `${comm}\n` : a.includes('args=') ? `${args}\n` : '' });
test('a Darwin daemon under a home with a space is never published as a session', () => {
  const ops = darwinPs('/Users/Test User/.local/bin/claude', '/Users/Test User/.local/bin/claude daemon run --origin transient');
  const chain = () => [{ pid: 5, comm: 'node', tty: null }, { pid: 9, comm: 'claude', tty: null }, { pid: 3, comm: 'claude', tty: 'ttys000' }];
  assert.equal(adapterFor('claude-code').resolveSessionPid({ ancestors: chain, executableOf: (p) => ops.executableOf(p), argvOf: (p) => ops.argvOf(p) }), null);
});
test('the hook itself is never the session, even when it is a harness process', () => {
  for (const [harness, comm] of [['claude-code', 'claude'], ['codex', 'codex'], ['opencode', 'opencode']]) {
    const only = () => [{ pid: 5, comm, tty: true }];
    assert.equal(adapterFor(harness).resolveSessionPid({ ancestors: only, executableOf: () => '', argvOf: () => [] }), null);
    assert.equal(adapterFor(harness).resolveTerminalPid({ ancestors: only }), null);
  }
});

// Spec docs/specs/2026-10-17-codex-model-resolver.md, "Resolution" step 3.
const hrow = (pid, comm) => ({ pid, ppid: pid - 1, comm, tty: null, starttime: '1', state: 'S' });
const noExecutable = { executableOf: () => { throw new Error('executable must not be read'); } };
test('nearestHarness finds the nearest harness of any kind and never the caller itself', () => {
  assert.deepEqual(nearestHarness([hrow(9, 'codex'), hrow(8, 'bash'), hrow(7, 'codex')], noExecutable), { harness: 'codex', index: 2 });
  assert.deepEqual(nearestHarness([hrow(9, 'node'), hrow(8, 'claude'), hrow(7, 'codex')], noExecutable), { harness: 'claude-code', index: 1 });
  assert.deepEqual(nearestHarness([hrow(9, 'node'), hrow(8, 'opencode')], noExecutable), { harness: 'opencode', index: 1 });
  assert.equal(nearestHarness([hrow(9, 'node'), hrow(8, 'bash'), hrow(2, 'systemd')], noExecutable), null);
});
test('nearestHarness counts a versioned Claude binary only under claude/versions/', () => {
  const chain = [hrow(9, 'node'), hrow(8, '2.1.280'), hrow(7, 'codex')];
  assert.deepEqual(nearestHarness(chain, { executableOf: () => '/home/u/.local/share/claude/versions/2.1.280' }), { harness: 'claude-code', index: 1 });
  assert.deepEqual(nearestHarness(chain, { executableOf: () => '/usr/bin/other' }), { harness: 'codex', index: 2 });
});
