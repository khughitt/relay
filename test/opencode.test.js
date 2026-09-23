import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSessionPid, resolveTerminalPid, reduceState } from '../src/adapters/opencode.js';
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

test('a same-named process without a terminal is the session when nearest, and never the terminal', () => {
  // Modelled on the Claude spike, not measured for opencode: kept as the terminal predicate's case.
  const chain = () => [{ pid: 400, comm: 'node', tty: null }, { pid: 300, comm: 'opencode', tty: null },
    { pid: 200, comm: 'opencode', tty: true }];
  assert.equal(resolveSessionPid({ ancestors: chain }), 300);
  assert.equal(resolveTerminalPid({ ancestors: chain }), 200);
});
