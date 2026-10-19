import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSessionPid, resolveTerminalPid } from '../src/adapters/claude-code.js';
test('no Claude process in the chain is null for both lookups', () => {
  const chain = () => [{ pid: 500, comm: 'node', tty: null }, { pid: 400, comm: 'zsh', tty: true }];
  assert.equal(resolveSessionPid({ ancestors: chain, executableOf: () => { throw new Error('not read'); }, argvOf: () => [] }), null);
  assert.equal(resolveTerminalPid({ ancestors: chain }), null);
});

import { normalizeEvent } from '../src/adapters/index.js';
const entry = (type, status = 'running') => ({ id: 'x', type, status, description: 'PRIVATE_DESCRIPTION', command: 'PRIVATE_COMMAND' });
const stop = (fields = {}) => normalizeEvent('claude-code', 'Stop', JSON.stringify({ session_id: 's', cwd: '/repo', ...fields }));
test('a Stop without background_tasks reports nothing', () => {
  assert.equal(Object.hasOwn(stop(), 'background'), false);
});
test('in-flight work splits into agent-type and other', () => {
  for (const [list, expected] of [
    [[], { agents: 0, other: 0 }], [[entry('subagent')], { agents: 1, other: 0 }],
    [[entry('workflow', 'pending')], { agents: 1, other: 0 }],
    [[entry('teammate'), entry('cloud session')], { agents: 2, other: 0 }],
    [[entry('shell')], { agents: 0, other: 1 }], [[entry('monitor')], { agents: 0, other: 1 }],
    [[entry('subagent', 'completed')], { agents: 0, other: 0 }],
    [[entry('local_newkind')], { agents: 0, other: 1 }],
    [[entry('subagent'), entry('shell'), entry('shell', 'completed')], { agents: 1, other: 1 }],
  ]) assert.deepEqual(stop({ background_tasks: list }).background, expected);
});
test('entry text never reaches the event', () => {
  const event = JSON.stringify(stop({ background_tasks: [entry('shell')] }));
  assert.equal(event.includes('PRIVATE_DESCRIPTION'), false);
  assert.equal(event.includes('PRIVATE_COMMAND'), false);
});
test('a minimal entry is readable', () => {
  assert.deepEqual(stop({ background_tasks: [{ type: 'shell', status: 'running' }] }).background, { agents: 0, other: 1 });
});
test('an unreadable background_tasks is null, not a failure', () => {
  for (const list of [{}, 'x', [null], ['shell'], [[]], [{ status: 'running' }],
    [{ type: 'shell', status: 1 }], [entry('shell'), { type: 'subagent', status: null }]]) {
    assert.equal(stop({ background_tasks: list }).background, null);
  }
});
test('only a Claude Stop is read', () => {
  for (const [harness, native, fields] of [['claude-code', 'PreToolUse', { tool_name: 'Bash', tool_input: {} }], ['codex', 'Stop', {}]]) {
    const event = normalizeEvent(harness, native, JSON.stringify({ session_id: 's', cwd: '/repo', background_tasks: [entry('shell')], ...fields }));
    assert.equal(Object.hasOwn(event, 'background'), false);
  }
});

import { reduceState } from '../src/adapters/claude-code.js';
import { STATES } from '../src/protocol.js';
test('Claude reduction is the identity without counts', () => {
  for (const level of [...STATES, null]) {
    assert.equal(reduceState(level, 'done'), level);
    assert.equal(reduceState(level, 'done', {}), level);
    assert.equal(reduceState(level, 'done', { background: { agents: 0, other: 0 } }), level);
  }
});
test('a Stop with agent work in flight stays working', () => {
  for (const background of [{ agents: 1, other: 0 }, { agents: 2, other: 3 }]) {
    assert.equal(reduceState('done', 'working', { background }), 'working');
  }
});
test('idle_prompt with other work in flight is idle; agent counts do not count', () => {
  assert.equal(reduceState('needs-input', 'done', { background: { agents: 0, other: 1 } }), 'idle');
  assert.equal(reduceState('needs-input', 'done', { background: { agents: 2, other: 0 } }), 'needs-input');
});
test('other levels ignore the counts', () => {
  for (const level of ['idle', 'working', 'needs-approval', 'error']) {
    assert.equal(reduceState(level, 'done', { background: { agents: 1, other: 1 } }), level);
  }
});
