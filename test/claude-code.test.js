import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSessionPid, resolveTerminalPid, reduceState } from '../src/adapters/claude-code.js';
import { STATES } from '../src/protocol.js';
test('no Claude process in the chain is null for both lookups', () => {
  const chain = () => [{ pid: 500, comm: 'node', tty: null }, { pid: 400, comm: 'zsh', tty: true }];
  assert.equal(resolveSessionPid({ ancestors: chain, executableOf: () => { throw new Error('not read'); }, argvOf: () => [] }), null);
  assert.equal(resolveTerminalPid({ ancestors: chain }), null);
});
