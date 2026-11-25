import test from 'node:test';
import assert from 'node:assert/strict';
import { adapterFor } from '../src/adapters/index.js';
import { normalizeHookEvent, registryEventFor } from '../src/adapters/hook-event.js';
import { applyEvent, readSnapshot } from '../src/bus/transaction.js';
import { validateSnapshot } from '../src/protocol.js';
import { createProcessOps } from '../src/bus/proc.js';
import { whoami } from '../src/identity/whoami.js';
import { tempState } from './helpers/fixture.js';

const OUTER = '01a2b3c4-0000-7000-8000-000000000001', INNER = '01a2b3c4-0000-7000-8000-000000000002', NEXT = '01a2b3c4-0000-7000-8000-000000000003';
const BOOT = '0f9d5a1e-1c2b-4d3e-8f4a-5b6c7d8e9f01';
const handle = (pid, start) => ({ platform: 'linux', host: 'h', bootId: BOOT, pid, start });
const pi = adapterFor('pi');
const row = (pid, comm, ppid, tty = null) => ({ pid, ppid, comm, tty, starttime: `${pid}0`, state: 'S' });

async function registry(t) {
  const paths = await tempState(t);
  // Every process is alive, so only an event can remove a row.
  const processOps = { ...createProcessOps({ platform: 'linux' }), ancestors: () => [], handleOf: (pid) => handle(pid, `${pid}0`), probe: () => ({ status: 'alive', reason: 'match' }) };
  const send = async (nativeEvent, sessionId, pid = /** @type {number|null} */ (42), cwd = '/project') => {
    const event = registryEventFor(normalizeHookEvent('pi', nativeEvent, JSON.stringify({ session_id: sessionId, cwd }), { invokingCwd: '/' }));
    return applyEvent(event, { paths, processOps, gitContext: async () => ({ remote: null, repoRoot: cwd }), resolveSessionPid: () => pid });
  };
  const states = async () => Object.fromEntries(Object.values((await readSnapshot({ paths }))?.agents ?? {}).map((a) => [a.id, a.state]));
  return { paths, processOps, send, states };
}

test('pi events map to registry kinds and levels, and nothing else does', () => {
  assert.deepEqual(pi.events, {
    'session_start': { kind: 'session-start', level: 'idle' },
    'agent_start': { kind: 'activity', level: 'working' },
    'agent_settled': { kind: 'turn-end', level: 'done' },
    'agent_settled:aborted': { kind: 'idle', level: 'idle' },
    'agent_settled:error': { kind: 'turn-error', level: 'error' },
    'session_shutdown': { kind: 'session-end', level: null },
  });
  for (const [name, { kind }] of Object.entries(pi.events)) assert.deepEqual(pi.hookEvents[name], { kind, registry: true });
  for (const name of ['before_agent_start', 'agent_end', 'tool_call', 'toString']) assert.throws(() => pi.stateForEvent(name), { code: 'UNSUPPORTED_EVENT' });
});

test('pi only observes: no reply channel and a five-second outer budget', () => {
  assert.deepEqual(pi.replies, {});
  assert.deepEqual(pi.encodeReply('agent_settled', { decision: 'allow' }), { stdout: '', stderr: '', exitCode: 0 });
  assert.throws(() => pi.encodeReply('agent_settled', { decision: 'deny', reason: 'no' }), { code: 'UNSUPPORTED_REPLY' });
  assert.deepEqual(pi.outerTimeouts, { default: 5000, max: {} });
});

test('the process is pi or its RPC entry point, nearest first, with a terminal only where one exists', () => {
  for (const comm of ['pi', 'pi-rpc']) assert.equal(pi.resolveSessionPid({ ancestors: () => [row(9, 'node', 8), row(8, comm, 7), row(7, 'zsh', 1)] }), 8);
  for (const comm of ['pip', 'python', 'pi-rpc2', 'PI']) assert.equal(pi.resolveSessionPid({ ancestors: () => [row(9, 'node', 8), row(8, comm, 7)] }), null);
  const nested = () => [row(9, 'node', 8), row(8, 'pi', 7), row(7, 'bash', 6), row(6, 'pi', 5, true)];
  assert.equal(pi.resolveSessionPid({ ancestors: nested }), 8);
  assert.equal(pi.resolveTerminalPid({ ancestors: nested }), 6);
});

test('a pi row is session-scoped and carries no background or root', () => {
  const agent = { id: `pi:${OUTER}`, harness: 'pi', sessionId: OUTER, scope: 'session', process: handle(42, '420'), cwd: '/p', repoRoot: null, remote: null, projectKey: '/p', project: 'p', state: 'idle', updatedAt: 1 };
  const snapshot = (a) => ({ schema: 2, generation: '11111111-2222-4333-8444-555555555555', revision: 1, agents: { [a.id]: a } });
  assert.deepEqual(validateSnapshot(snapshot(agent)).agents[agent.id], agent);
  for (const bad of [{ scope: 'process' }, { scope: 'worker', root: 'pi:x' }, { root: 'codex:x' }, { background: { agents: 0, other: 0 } }]) {
    assert.throws(() => validateSnapshot(snapshot({ ...agent, ...bad })), { code: 'INVALID_SCHEMA' });
  }
});

test('one session runs idle, working, done; an abort is idle and a failed run is an error', async (t) => {
  const r = await registry(t);
  const seen = [];
  for (const event of ['session_start', 'agent_start', 'agent_settled', 'agent_start', 'agent_settled:aborted', 'agent_start', 'agent_settled:error', 'agent_start']) {
    await r.send(event, OUTER); seen.push((await r.states())[`pi:${OUTER}`]);
  }
  assert.deepEqual(seen, ['idle', 'working', 'done', 'working', 'idle', 'working', 'error', 'working']);
  await r.send('session_shutdown', OUTER);
  assert.deepEqual(await r.states(), {});
});

// /new, /resume and /fork: pi awaits session_shutdown for the old session, then starts the next.
test('a replaced session leaves the registry and its successor enters it on the same process', async (t) => {
  const r = await registry(t);
  await r.send('session_start', OUTER); await r.send('session_shutdown', OUTER); await r.send('session_start', NEXT);
  assert.deepEqual(await r.states(), { [`pi:${NEXT}`]: 'idle' });
  await r.send('session_shutdown', NEXT); await r.send('session_start', OUTER);
  assert.deepEqual(await r.states(), { [`pi:${OUTER}`]: 'idle' }, 'resuming the first session restores its own row');
});

test('a reload republishes the same row', async (t) => {
  const r = await registry(t);
  await r.send('session_start', OUTER); await r.send('agent_start', OUTER); await r.send('agent_settled', OUTER); await r.send('session_start', OUTER);
  assert.deepEqual(await r.states(), { [`pi:${OUTER}`]: 'idle' });
});

const identify = (r, rows, env) => whoami({ platform: 'linux', startPid: rows[0].pid, paths: r.paths, env: {},
  processOps: { ...r.processOps, recordOf: (pid) => rows.find((x) => x.pid === pid) ?? null },
  readRaw: () => Buffer.from(Object.entries(env).map(([k, v]) => `${k}=${v}\0`).join('')) });
const inside = (pid) => [row(99, 'node', 98), row(98, 'bash', pid), row(pid, 'pi', 1), row(1, 'systemd', 0)];

test('two pi sessions in one process tree each resolve to their own row', async (t) => {
  const r = await registry(t);
  await r.send('session_start', OUTER, 42); await r.send('session_start', INNER, 50);
  const nested = [row(99, 'node', 98), row(98, 'bash', 50), row(50, 'pi', 49), row(49, 'bash', 42), row(42, 'pi', 1), row(1, 'systemd', 0)];
  const inner = await identify(r, nested, { PI_SESSION_ID: INNER });
  assert.equal(inner.status, 'resolved'); assert.equal(inner.agent.id, `pi:${INNER}`); assert.equal(inner.rootSession, null);
  const outer = await identify(r, inside(42), { PI_SESSION_ID: OUTER });
  assert.equal(outer.status, 'resolved'); assert.equal(outer.agent.id, `pi:${OUTER}`);
  // A process the inner pi starts outside its bash tool inherits the outer session's variable.
  const inherited = await identify(r, nested, { PI_SESSION_ID: OUTER });
  assert.equal(inherited.status, 'unresolved'); assert.equal(inherited.code, 'HINT_MISMATCH');
});

test('after a replacement the old session id no longer identifies the caller', async (t) => {
  const r = await registry(t);
  await r.send('session_start', OUTER); await r.send('session_shutdown', OUTER); await r.send('session_start', NEXT);
  assert.equal((await identify(r, inside(42), { PI_SESSION_ID: NEXT })).agent.id, `pi:${NEXT}`);
  assert.equal((await identify(r, inside(42), { PI_SESSION_ID: OUTER })).code, 'HINT_MISMATCH');
});

// A lost session_shutdown leaves two rows on one live process: only the session id tells them apart.
test('two rows on one pi process are told apart by PI_SESSION_ID alone', async (t) => {
  const r = await registry(t);
  await r.send('session_start', OUTER); await r.send('session_start', NEXT);
  assert.equal((await identify(r, inside(42), { PI_SESSION_ID: NEXT })).agent.id, `pi:${NEXT}`);
  assert.equal((await identify(r, inside(42), {})).code, 'MISSING_HINT');
  assert.equal((await identify(r, inside(42), { PI_SESSION_ID: INNER })).code, 'HINT_MISMATCH');
});

// The one row may be a session this process has already replaced, so it is never taken on trust.
test('a command pi runs without a session id is not identified by its process alone', async (t) => {
  const r = await registry(t);
  await r.send('session_start', OUTER);
  for (const env of [{}, { PI_SESSION_ID: '' }]) {
    const result = await identify(r, inside(42), env);
    assert.equal(result.status, 'unresolved'); assert.equal(result.code, 'MISSING_HINT'); assert.match(result.message, /PI_SESSION_ID/); assert.equal(result.nativeSession, false);
  }
});

// A hook that outlives pi, or runs under no pi, finds no process: the row could never be reaped.
test('a pi event without a process changes no row and creates none', async (t) => {
  const r = await registry(t);
  const result = await r.send('session_start', OUTER, null);
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['PROCESS_UNAVAILABLE']);
  assert.deepEqual(await r.states(), {});
  await r.send('session_start', OUTER); await r.send('agent_start', OUTER); await r.send('agent_settled', OUTER, null);
  const row = (await readSnapshot({ paths: r.paths })).agents[`pi:${OUTER}`];
  assert.equal(row.state, 'working'); assert.equal(row.process.pid, 42);
  await r.send('session_shutdown', OUTER, null);
  assert.deepEqual(await r.states(), {});
});
