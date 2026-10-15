import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSessionPid, resolveTerminalPid, reduceState, stateForEvent } from '../src/adapters/codex.js';
import { normalizeEvent } from '../src/adapters/index.js';
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
const R = '0199f000-0000-7000-8000-000000000001', W = '0199f000-0000-7000-8000-000000000002';
const payload = (fields = {}) => JSON.stringify({ session_id: R, cwd: '/repo', ...fields });
const tool = { tool_name: 'Bash', tool_input: { command: 'echo hi' } };
test('a hook without agent_id stays the root session', () => {
  const event = normalizeEvent('codex', 'PreToolUse', payload(tool));
  assert.equal(event.agentId, `codex:${R}`);
  assert.equal(Object.hasOwn(event, 'root'), false);
});
test('a hook carrying agent_id is the worker, rooted at the session', () => {
  for (const [native, fields, kind] of [['SubagentStart', {}, 'session-start'], ['PreToolUse', tool, 'before-tool'],
    ['PermissionRequest', {}, 'needs-approval'], ['SubagentStop', { stop_hook_active: false }, 'turn-end']]) {
    const event = normalizeEvent('codex', native, payload({ ...fields, agent_id: W, agent_type: 'default' }));
    assert.deepEqual([event.agentId, event.sessionId, event.root, event.kind], [`codex:${W}`, W, `codex:${R}`, kind], native);
  }
  assert.equal(stateForEvent('SubagentStart'), 'working');
  assert.equal(stateForEvent('SubagentStop'), 'done');
});
test('a worker identity is refused rather than guessed', () => {
  for (const native of ['SubagentStart', 'SubagentStop']) {
    assert.throws(() => normalizeEvent('codex', native, payload()), { code: 'INVALID_INPUT' }, native);
  }
  for (const agent_id of ['', ' ', null, 7, R]) {
    assert.throws(() => normalizeEvent('codex', 'PreToolUse', payload({ ...tool, agent_id })), { code: 'INVALID_INPUT' }, String(agent_id));
  }
});
test('a Claude Code payload carrying agent_id is not routed', () => {
  const event = normalizeEvent('claude-code', 'PreToolUse', payload({ ...tool, agent_id: W }));
  assert.equal(event.agentId, `claude-code:${R}`);
  assert.equal(Object.hasOwn(event, 'root'), false);
});
