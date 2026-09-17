import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentPid, reduceState } from '../src/adapters/codex.js';
import { STATES } from '../src/protocol.js';
test('codex reduces a level to itself — it has no state that depends on what came before', () => {
  for (const level of STATES) assert.equal(reduceState(level, null), level);
  assert.equal(reduceState('done', 'working'), 'done');
});

test('the agent is the codex process WITH a terminal — not the hook, and not its helper child', () => {
  // A live codex session on this machine is a `codex` process with a tty, and it spawns a
  // `codex-code-mode` child. Walking up from the hook we must land on `codex`, and the tty test
  // must survive a same-named process that owns no terminal -- the failure claude-code's spike
  // found in 370 of 1507 samples, where fd 1 was a log file and we would have written escape
  // codes into it.
  const chain = [
    { pid: 10, comm: 'node', tty: null },          // the hook itself — index 0, always skipped
    { pid: 9, comm: 'sh', tty: null },
    { pid: 8, comm: 'codex', tty: null },          // same comm, NO terminal: a daemon. Not our agent.
    { pid: 7, comm: 'codex', tty: true },          // the real one
  ];
  assert.equal(resolveAgentPid({ platform: 'linux', startPid: 10, ancestors: () => chain }), 7);
});

test('no codex process among the ancestors is a null result', () => {
  const chain = [
    { pid: 10, comm: 'node', tty: null },
    { pid: 9, comm: 'claude', tty: true },     // a claude-code session: the wrong --agent flag
  ];
  assert.equal(resolveAgentPid({ platform: 'linux', startPid: 10, ancestors: () => chain }), null);
});

test('the Darwin chain measured on a real Mac resolves codex, not its npm launcher', () => {
  const chain = [
    { pid: 38843, ppid: 38829, comm: 'node', tty: 'ttys000' },
    { pid: 38829, ppid: 38609, comm: 'zsh', tty: 'ttys000' },
    { pid: 38609, ppid: 38608, comm: 'codex', tty: 'ttys000' },
    { pid: 38608, ppid: 35113, comm: 'node', tty: 'ttys000' },
  ];
  assert.equal(
    resolveAgentPid({ startPid: 38843, ancestors: () => chain }),
    38609,
  );
});
