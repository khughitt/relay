import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adapterFor } from '../src/adapters/index.js';
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
    assert.equal(adapter.resolveTerminalPid({ startPid, ancestors }), chain.terminal, 'terminal');
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
