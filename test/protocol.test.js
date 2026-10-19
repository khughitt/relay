import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStart, validateSnapshot } from '../src/protocol.js';
test('Linux start text does not round through a Number', () => {
  assert.equal(parseStart('9007199254740993'), '9007199254740993');
  for (const bad of ['01', '+1', '1e3', '1.0', ' 1', '18446744073709551616']) {
    assert.throws(() => parseStart(bad), { code: 'INVALID_SCHEMA' });
  }
});
test('unknown snapshot schema is not an empty registry', () => {
  for (const schema of [1, 3]) assert.throws(() => validateSnapshot({ ...snapshot, schema }), { code: 'INVALID_SCHEMA' });
});
import { readFileSync } from 'node:fs';
import { validateHandle, validateEvent } from '../src/protocol.js';
const corpus = JSON.parse(readFileSync(new URL('./fixtures/handles.json', import.meta.url)));
test('portable corpus validates its own values', () => {
  assert.equal(corpus.schema, 1);
  for (const [cases, validate] of [[corpus.starts, parseStart], [corpus.handles, validateHandle]]) {
    for (const c of cases) {
      if (c.errorCode) assert.throws(() => validate(c.input), { code: c.errorCode }, c.name);
      else assert.deepEqual(validate(c.input), c.expected, c.name);
    }
  }
});
const agent = { id: 'codex:s:1', harness: 'codex', sessionId: 's:1', scope: 'session', process: null,
  cwd: '/repo', repoRoot: null, remote: null, projectKey: '/repo', project: 'repo', state: 'idle', updatedAt: 0 };
const snapshot = { schema: 2, generation: '12345678-1234-4234-8234-123456789abc', revision: 0, agents: { [agent.id]: agent } };
test('snapshot requires every field and strips unknown fields at every level', () => {
  assert.deepEqual(validateSnapshot({ ...snapshot, extra: true, agents: { [agent.id]: { ...agent, prompt: 'private' } } }), snapshot);
  for (const key of Object.keys(agent)) {
    const bad = { ...agent }; delete bad[key];
    assert.throws(() => validateSnapshot({ ...snapshot, agents: { [agent.id]: bad } }), { code: 'INVALID_SCHEMA' }, key);
  }
  for (const change of [{ revision: Number.MAX_SAFE_INTEGER + 1 }, { generation: 'bad' }, { agents: [] }]) {
    assert.throws(() => validateSnapshot({ ...snapshot, ...change }), { code: 'INVALID_SCHEMA' });
  }
  for (const change of [{ sessionId: ' ' }, { cwd: 'repo' }, { id: 'other' }, { state: 'sleeping' }, { scope: 'process' }, { updatedAt: -1 }]) {
    assert.throws(() => validateSnapshot({ ...snapshot, agents: { [agent.id]: { ...agent, ...change } } }), { code: 'INVALID_SCHEMA' });
  }
});
test('handle qualification and event metadata are explicit', () => {
  for (const change of [{ pid: 0 }, { pid: 4294967296 }, { host: ' ' }, { bootId: 'bad' }, { platform: 'darwin' }]) {
    assert.throws(() => validateHandle({ ...corpus.handles[0].input, ...change }), { code: 'INVALID_SCHEMA' });
  }
  const e = { schema: 1, kind: 'prompt', harness: 'codex', nativeEvent: 'UserPromptSubmit', agentId: agent.id, sessionId: agent.sessionId, cwd: '/repo', tool: null };
  assert.deepEqual(validateEvent({ ...e, private: true }), e);
  assert.throws(() => validateEvent({ ...e, stopHookActive: 0 }), { code: 'INVALID_SCHEMA' });
});

const workers = JSON.parse(readFileSync(new URL('./fixtures/registry-workers.json', import.meta.url)));
const R = '0199f000-0000-7000-8000-000000000001', W1 = '0199f000-0000-7000-8000-000000000002';
test('the shared worker fixture validates unchanged', () => {
  assert.deepEqual(validateSnapshot(workers), workers);
});
test('a worker row needs Codex and a root other than itself; a session row has no root', () => {
  const worker = workers.agents[`codex:${W1}`], root = workers.agents[`codex:${R}`];
  const { root: _dropped, ...rootless } = worker;
  const alone = (agent) => ({ ...workers, agents: { [agent.id]: agent } });
  const bad = [rootless, { ...worker, root: `codex:${W1}` }, { ...worker, root: 'claude-code:x' },
    { ...worker, root: 'codex:' }, { ...worker, root: 7 }, { ...root, root: `codex:${W1}` },
    { ...worker, id: `claude-code:${W1}`, harness: 'claude-code' },
    { ...worker, id: `opencode:${W1}`, harness: 'opencode' }];
  for (const agent of bad) assert.throws(() => validateSnapshot(alone(agent)), { code: 'INVALID_SCHEMA' }, JSON.stringify([agent.id, agent.root]));
});
test('an event root is a Codex root other than the event itself', () => {
  const base = { schema: 1, kind: 'before-tool', harness: 'codex', nativeEvent: 'PreToolUse', agentId: 'codex:w',
    sessionId: 'w', cwd: '/repo', tool: { name: 'Bash', input: {}, command: null } };
  assert.equal(validateEvent({ ...base, root: 'codex:r' }).root, 'codex:r');
  assert.equal(Object.hasOwn(validateEvent(base), 'root'), false);
  for (const root of ['codex:w', 'claude-code:r', 'codex:', '', null]) {
    assert.throws(() => validateEvent({ ...base, root }), { code: 'INVALID_SCHEMA' }, String(root));
  }
  assert.throws(() => validateEvent({ ...base, harness: 'claude-code', agentId: 'claude-code:w', root: 'codex:r' }), { code: 'INVALID_SCHEMA' });
});

const claudeRow = { ...agent, id: 'claude-code:s:1', harness: 'claude-code' };
const alone = (row) => ({ ...snapshot, agents: { [row.id]: row } });
const badCounts = [{ agents: -1, other: 0 }, { agents: 0.5, other: 0 },
  { agents: 0, other: Number.MAX_SAFE_INTEGER + 1 }, { agents: 0 }, []];
test('a Claude row keeps its background counts through validation', () => {
  const row = { ...claudeRow, background: { agents: 1, other: 2, extra: 3 } };
  assert.deepEqual(validateSnapshot(alone(row)), alone({ ...claudeRow, background: { agents: 1, other: 2 } }));
  assert.equal(Object.hasOwn(validateSnapshot(alone(claudeRow)).agents[claudeRow.id], 'background'), false);
});
test('row background is counts on a Claude row only', () => {
  for (const row of [agent, { ...agent, id: 'opencode:s:1', harness: 'opencode', scope: 'process' }]) {
    assert.throws(() => validateSnapshot(alone({ ...row, background: { agents: 0, other: 0 } })), { code: 'INVALID_SCHEMA' });
  }
  for (const background of [null, ...badCounts]) {
    assert.throws(() => validateSnapshot(alone({ ...claudeRow, background })), { code: 'INVALID_SCHEMA' });
  }
});
const claudeStop = { schema: 1, kind: 'turn-end', harness: 'claude-code', nativeEvent: 'Stop',
  agentId: claudeRow.id, sessionId: claudeRow.sessionId, cwd: '/repo', tool: null };
test('event background is counts or null on a Claude Stop only', () => {
  assert.deepEqual(validateEvent({ ...claudeStop, background: { agents: 1, other: 2, extra: 3 } }),
    { ...claudeStop, background: { agents: 1, other: 2 } });
  assert.deepEqual(validateEvent({ ...claudeStop, background: null }), { ...claudeStop, background: null });
  for (const event of [
    { ...claudeStop, kind: 'before-tool', nativeEvent: 'PreToolUse', tool: { name: 'Bash', input: {}, command: null } },
    { ...claudeStop, harness: 'codex', agentId: agent.id },
    { ...claudeStop, harness: 'opencode', agentId: 'opencode:s:1', nativeEvent: 'init', kind: 'session-start' },
  ]) {
    for (const background of [{ agents: 0, other: 0 }, null]) {
      assert.throws(() => validateEvent({ ...event, background }), { code: 'INVALID_SCHEMA' });
    }
  }
  for (const background of badCounts) {
    assert.throws(() => validateEvent({ ...claudeStop, background }), { code: 'INVALID_SCHEMA' });
  }
});
