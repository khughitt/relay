import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentPid, reduceState } from '../src/adapters/opencode.js';
import { STATES } from '../src/protocol.js';
test('the idle that follows an error does not erase it', () => {
  assert.equal(reduceState('error', 'working'), 'error');
  assert.equal(reduceState('idle', 'error'), 'error');
});

test('quiet after an ACTIVE state is `done` — that is what done means', () => {
  for (const active of ['working', 'needs-input', 'needs-approval']) {
    assert.equal(reduceState('idle', active), 'done');
  }
});

test('quiet after quiet is just quiet', () => {
  assert.equal(reduceState('idle', null), 'idle');    // `init`: the window just opened
  assert.equal(reduceState('idle', 'idle'), 'idle');
  assert.equal(reduceState('idle', 'done'), 'idle');  // a `done` that already decayed
});

test('every other level is what it says it is', () => {
  for (const prev of ['idle', 'working', 'needs-input', 'needs-approval', 'error', 'done', null]) {
    assert.equal(reduceState('working', prev), 'working');
    assert.equal(reduceState('needs-approval', prev), 'needs-approval');
    assert.equal(reduceState('needs-input', prev), 'needs-input');
    assert.equal(reduceState('error', prev), 'error');
  }
});

test('resolveAgentPid finds the opencode process with a tty, and skips the hook itself', () => {
  const chain = [
    { pid: 400, comm: 'node', tty: null },        // the hook: index 0, always skipped
    { pid: 300, comm: 'opencode', tty: null },    // a daemon: right name, no terminal
    { pid: 200, comm: 'opencode', tty: true },// the agent
  ];
  assert.equal(resolveAgentPid({ platform: 'linux', startPid: 400, ancestors: () => chain }), 200);
});

test('no opencode among the ancestors returns null', () => {
  assert.equal(resolveAgentPid({ platform: 'linux', startPid: 9, ancestors: () => [{ pid: 9, comm: 'node', tty: null }] }), null);
});

test('the Darwin chain measured on a real Mac resolves opencode at depth 1', () => {
  const chain = [
    { pid: 42885, ppid: 42878, comm: 'node', tty: 'ttys000' },
    { pid: 42878, ppid: 35113, comm: 'opencode', tty: 'ttys000' },
    { pid: 35113, ppid: 35112, comm: '-zsh', tty: 'ttys000' },
  ];
  assert.equal(
    resolveAgentPid({ startPid: 42885, ancestors: () => chain }),
    42878,
  );
});
