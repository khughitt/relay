import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bind } from './binding.js';

// pi gives each extension instance one ExtensionAPI and every handler a context; nothing else here is pi.
function fakePi() {
  const handlers = new Map();
  return { on: (name, handler) => { assert.ok(!handlers.has(name), name); handlers.set(name, handler); }, handlers,
    emit: (event, ctx) => handlers.get(event.type)?.(event, ctx) };
}
const ctx = (id = 's1', cwd = '/proj') => ({ cwd, sessionManager: { getSessionId: () => id } });
function bound(options = {}) {
  const pi = fakePi(), calls = [], reported = [];
  bind(pi, { spawn: async (event, payload) => { calls.push([event, payload.session_id, payload.cwd]); }, report: (m) => reported.push(m), ...options });
  return { pi, calls, reported, events: () => calls.map(([event]) => event) };
}
const assistant = (stopReason) => ({ role: 'assistant', stopReason });
const settle = async (pi, messages, aborted = false) => {
  pi.emit({ type: 'agent_start' }, ctx());
  pi.emit({ type: 'agent_end', messages }, ctx());
  pi.emit({ type: 'agent_settled', aborted }, ctx());
};

test('a session reports its start, its work and its end, keyed by its own id and cwd', async () => {
  const b = bound();
  b.pi.emit({ type: 'session_start', reason: 'startup' }, ctx('s1', '/a'));
  await settle(b.pi, [assistant('stop')]);
  await b.pi.emit({ type: 'session_shutdown', reason: 'quit' }, ctx('s1', '/a'));
  assert.deepEqual(b.calls, [['session_start', 's1', '/a'], ['agent_start', 's1', '/proj'], ['agent_settled', 's1', '/proj'], ['session_shutdown', 's1', '/a']]);
});

test('no handler returns a value, so pi never reads one as a result', async () => {
  const b = bound();
  for (const event of [{ type: 'session_start', reason: 'startup' }, { type: 'agent_start' }, { type: 'agent_end', messages: [] }, { type: 'agent_settled', aborted: false }]) {
    assert.equal(b.pi.emit(event, ctx()), undefined, event.type);
  }
  assert.equal(await b.pi.emit({ type: 'session_shutdown', reason: 'quit' }, ctx()), undefined);
});

test('an abort and a failed run are told apart from a finished one', async () => {
  for (const [messages, aborted, expected] of [
    [[assistant('stop')], false, 'agent_settled'],
    [[assistant('aborted')], true, 'agent_settled:aborted'],
    [[assistant('error')], true, 'agent_settled:aborted'],
    [[assistant('toolUse'), assistant('error')], false, 'agent_settled:error'],
    [[assistant('error'), { role: 'user' }, assistant('stop')], false, 'agent_settled'],
    [[], false, 'agent_settled'],
  ]) {
    const b = bound();
    await settle(b.pi, messages, aborted);
    await b.pi.emit({ type: 'session_shutdown', reason: 'quit' }, ctx());
    assert.equal(b.events()[1], expected);
  }
});

test('an error pi retried, or one from an earlier run, does not mark the next settle', async () => {
  const b = bound();
  b.pi.emit({ type: 'agent_start' }, ctx());
  b.pi.emit({ type: 'agent_end', messages: [assistant('error')] }, ctx());
  b.pi.emit({ type: 'agent_start' }, ctx());
  b.pi.emit({ type: 'agent_end', messages: [assistant('stop')] }, ctx());
  b.pi.emit({ type: 'agent_settled', aborted: false }, ctx());
  await settle(b.pi, [assistant('error')]);
  await settle(b.pi, [assistant('stop')]);
  await b.pi.emit({ type: 'session_shutdown', reason: 'quit' }, ctx());
  assert.deepEqual(b.events(), ['agent_start', 'agent_start', 'agent_settled', 'agent_start', 'agent_settled:error', 'agent_start', 'agent_settled', 'session_shutdown']);
});

test('new, resume and fork end the session; a reload does not, and waits for what is queued', async () => {
  for (const reason of ['quit', 'new', 'resume', 'fork']) {
    const b = bound();
    b.pi.emit({ type: 'session_start', reason: 'startup' }, ctx());
    await b.pi.emit({ type: 'session_shutdown', reason }, ctx());
    assert.deepEqual(b.events(), ['session_start', 'session_shutdown'], reason);
  }
  let release; const held = new Promise((resolve) => { release = resolve; });
  const seen = [];
  const b = bound({ spawn: async (event) => { await held; seen.push(event); } });
  b.pi.emit({ type: 'session_start', reason: 'startup' }, ctx());
  let drained = false;
  const done = b.pi.emit({ type: 'session_shutdown', reason: 'reload' }, ctx()).then(() => { drained = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  release(); await done;
  assert.deepEqual(seen, ['session_start']);
});

// Quitting mid-turn: pi emits session_shutdown before it aborts the run.
test('events after the shutdown are ignored, so a late settle cannot recreate the row', async () => {
  const b = bound();
  b.pi.emit({ type: 'session_start', reason: 'startup' }, ctx());
  const done = b.pi.emit({ type: 'session_shutdown', reason: 'quit' }, ctx());
  b.pi.emit({ type: 'agent_settled', aborted: true }, ctx());
  b.pi.emit({ type: 'agent_start' }, ctx());
  await done;
  b.pi.emit({ type: 'agent_settled', aborted: true }, ctx());
  await b.pi.emit({ type: 'session_shutdown', reason: 'quit' }, ctx());
  assert.deepEqual(b.events(), ['session_start', 'session_shutdown']);
  assert.deepEqual(b.reported, []);
});

test('the payload is read when the event arrives, before pi invalidates the context', async () => {
  const b = bound();
  let id = 's1';
  b.pi.emit({ type: 'session_start', reason: 'startup' }, { cwd: '/p', sessionManager: { getSessionId: () => id } });
  id = 's2';
  await b.pi.emit({ type: 'session_shutdown', reason: 'fork' }, ctx('s1', '/p'));
  assert.deepEqual(b.calls.map(([, session]) => session), ['s1', 's1']);
});

test('a failing hook or a broken context is reported by code and never reaches pi', async () => {
  const b = bound({ spawn: async () => { throw Object.assign(new Error('PRIVATE'), { code: 'INPUT_TIMEOUT' }); } });
  b.pi.emit({ type: 'session_start', reason: 'startup' }, ctx());
  b.pi.emit({ type: 'agent_start' }, { get cwd() { throw new Error('PRIVATE stale context'); }, sessionManager: ctx().sessionManager });
  await b.pi.emit({ type: 'session_shutdown', reason: 'quit' }, ctx());
  assert.deepEqual([...b.reported].sort(), ['relay: pi agent_start INVALID_INPUT', 'relay: pi session_shutdown INPUT_TIMEOUT', 'relay: pi session_start INPUT_TIMEOUT']);
});

test('the extension pi loads is a factory', async () => {
  const { default: factory } = await import('./index.js');
  assert.equal(typeof factory, 'function');
  const pi = fakePi(); assert.equal(factory(pi), undefined);
  assert.deepEqual([...pi.handlers.keys()].sort(), ['agent_end', 'agent_settled', 'agent_start', 'session_shutdown', 'session_start']);
});
