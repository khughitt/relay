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
  assert.throws(() => validateSnapshot({ schema: 2 }), { code: 'INVALID_SCHEMA' });
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
const snapshot = { schema: 1, generation: '12345678-1234-4234-8234-123456789abc', revision: 0, agents: { [agent.id]: agent } };
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
