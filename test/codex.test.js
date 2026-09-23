import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSessionPid, resolveTerminalPid, reduceState } from '../src/adapters/codex.js';
import { STATES } from '../src/protocol.js';
test('codex reduces a level to itself — it has no state that depends on what came before', () => {
  for (const level of STATES) assert.equal(reduceState(level, null), level);
  assert.equal(reduceState('done', 'working'), 'done');
});

test('a same-named process without a terminal is the session when nearest, and never the terminal', () => {
  // Modelled on the Claude spike, not measured for codex: kept as the terminal predicate's case.
  const chain = () => [{ pid: 10, comm: 'node', tty: null }, { pid: 9, comm: 'sh', tty: null },
    { pid: 8, comm: 'codex', tty: null }, { pid: 7, comm: 'codex', tty: true }];
  assert.equal(resolveSessionPid({ ancestors: chain }), 8);
  assert.equal(resolveTerminalPid({ ancestors: chain }), 7);
});
