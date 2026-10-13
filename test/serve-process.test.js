import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tempState } from './helpers/fixture.js';
import { spawnLines } from './helpers/spawn-lines.js';
import { connectSocket } from '../src/serve/client.js';
import { runServe } from '../src/serve/serve.js';
import { inboxPaths } from '../src/interaction/store.js';
import { CONFIRM_WINDOW_MS } from '../src/interaction/lifecycle.js';
import { questionMessage, answerMessage, HANDLE } from './helpers/interaction.js';
import { until } from './helpers/wait.js';

const worker = new URL('./fixtures/serve-worker.js', import.meta.url).pathname;
const waiterFile = new URL('./fixtures/socket-waiter.js', import.meta.url).pathname;
async function start(t, p, env = {}) {
  const w = spawnLines(t, worker, [], { env: { RELAY_STATE_DIR: p.stateDir, ...env } });
  const ready = await w.next((m) => m.type === 'ready');
  const client = await connectSocket(ready.socketPath); t.after(() => client.close());
  return { w, client, socketPath: ready.socketPath };
}
async function ask(t, p, socketPath) {
  const q = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000 } });
  const file = join(p.stateDir, `${q.id}.msg.json`); await fs.writeFile(file, JSON.stringify(q));
  const w = spawnLines(t, waiterFile, [socketPath, file]);
  assert.equal((await w.next((m) => m.op === 'ask')).ok, true);
  return { q, w };
}
const onDisk = async (p, id) => JSON.parse(await fs.readFile(join(inboxPaths(p.stateDir).entriesDir, `${id}.json`), 'utf8'));

test('a second service is refused with SERVE_RUNNING', { timeout: 30000 }, async (t) => {
  const p = await tempState(t); await start(t, p);
  await assert.rejects(runServe({ env: { RELAY_STATE_DIR: p.stateDir }, signal: new AbortController().signal }), { code: 'SERVE_RUNNING' });
});
test('SIGTERM stops the service cleanly and a restart reclaims nothing stale', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), a = await start(t, p);
  a.w.child.kill('SIGTERM'); await a.w.next((m) => m.type === 'stopped');
  await start(t, p);
});
for (const late of [false, true]) {
  test(`a crash between persisting handed and its ack is finished on reattach (${late ? 'after' : 'inside'} the window)`, { timeout: 60000 }, async (t) => {
    const p = await tempState(t), a = await start(t, p, { CRASH_ON: 'handed' });
    await a.client.request('presence.set', { mode: 'away' });
    const { q, w } = await ask(t, p, a.socketPath);
    await a.client.request('answer', { message: answerMessage(q) });
    await w.next((m) => m.type === 'state' && m.entry.state === 'answered');
    w.send('handed');
    await a.w.exited;
    assert.equal((await w.next((m) => m.op === 'handed' && m.type === 'error')).code, 'SERVE_UNAVAILABLE');
    assert.equal((await onDisk(p, q.id)).state, 'handed');
    const b = await start(t, p, { CLOCK_OFFSET_MS: late ? '61000' : '0' });
    w.send('reattach');
    const reattached = await w.next((m) => m.op === 'ask' && m.ok);
    assert.equal(reattached.entry.state, late ? 'unconfirmed' : 'handed');
    w.send('handed');
    const ack = await w.next((m) => m.op === 'handed' && m.type === 'response');
    assert.deepEqual([ack.ok, ack.entry.state], [true, late ? 'unconfirmed' : 'handed']);
    const confirmed = await b.client.request('confirm', { harness: 'claude-code', callId: 'toolu_1', observed: { 'Which shape?': 'Square' } });
    assert.equal(confirmed.entry.state, 'consumed');
  });
}
test('after a restart, a live waiter keeps its question and a dead one is withdrawn', { timeout: 60000 }, async (t) => {
  const p = await tempState(t), a = await start(t, p);
  await a.client.request('presence.set', { mode: 'away' });
  const live = await ask(t, p, a.socketPath), dead = await ask(t, p, a.socketPath);
  a.w.child.kill('SIGKILL'); await a.w.exited;
  dead.w.child.kill('SIGKILL'); await dead.w.exited;
  const b = await start(t, p, { REATTACH_MS: '200' });
  await new Promise((r) => setTimeout(r, 800));
  assert.equal((await b.client.request('get', { id: live.q.id })).entry.state, 'pending');
  const gone = (await b.client.request('get', { id: dead.q.id })).entry;
  assert.deepEqual([gone.state, gone.withdrawal], ['withdrawn', { reason: 'asker-gone' }]);
});


test('service lifetime exceeds the lock acquisition deadline', { timeout: 15000 }, async (t) => {
  const p = await tempState(t), a = await start(t, p);
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal((await a.client.request('presence.get')).presence.mode, 'here');
  await assert.rejects(runServe({ env: { RELAY_STATE_DIR: p.stateDir }, signal: new AbortController().signal }), { code: 'SERVE_RUNNING' });
});

test('service startup refuses an unsafe state directory without changing its mode', async (t) => {
  const p = await tempState(t); await fs.chmod(p.stateDir, 0o755);
  await assert.rejects(runServe({ env: { RELAY_STATE_DIR: p.stateDir }, signal: new AbortController().signal }), { code: 'IO_ERROR' });
  assert.equal((await fs.stat(p.stateDir)).mode & 0o777, 0o755);
});

test('clean shutdown preserves connected live waiters for restart', { timeout: 15000 }, async (t) => {
  const p = await tempState(t), a = await start(t, p);
  await a.client.request('presence.set', { mode: 'away' });
  const { q, w } = await ask(t, p, a.socketPath);
  a.w.child.kill('SIGTERM'); await a.w.next((m) => m.type === 'stopped'); await a.w.exited;
  assert.equal((await onDisk(p, q.id)).state, 'pending');
  const b = await start(t, p); w.send('reattach');
  assert.equal((await w.next((m) => m.op === 'ask' && m.ok)).entry.state, 'pending');
  assert.equal((await b.client.request('answer', { message: answerMessage(q) })).ok, true);
  await w.next((m) => m.type === 'state' && m.entry.state === 'answered');
  w.send('handed'); await w.next((m) => m.op === 'handed');
  w.child.kill('SIGKILL'); await w.exited;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await b.client.request('get', { id: q.id })).entry.state, 'handed');
});

test('service startup publishes precreated nested ancestors and refuses a failed sync before ready', async (t) => {
  const p = await tempState(t), a = join(p.stateDir, 'a'), stateDir = join(a, 'b', 'state'), synced = [];
  let armed = true, ready = false;
  const io = { ...fs, open: async (path, ...args) => {
    const handle = await fs.open(path, ...args);
    if (args[0] !== 'r') return handle;
    return { close: () => handle.close(), sync: async () => {
      if (armed && path === a) { armed = false; throw Object.assign(new Error('ancestor sync failed'), { code: 'EIO' }); }
      await handle.sync(); synced.push(path);
    } };
  } };
  await assert.rejects(runServe({ env: { RELAY_STATE_DIR: stateDir }, io, signal: AbortSignal.timeout(1000), ready: () => { ready = true; } }), { code: 'IO_ERROR' });
  assert.equal(ready, false);
  await fs.access(join(stateDir, 'inbox', 'entries'));
  synced.length = 0;
  const controller = new AbortController();
  await runServe({ env: { RELAY_STATE_DIR: stateDir }, io, signal: controller.signal, ready: () => { ready = true; controller.abort(); } });
  assert.equal(ready, true);
  assert.deepEqual(synced.filter((path) => path.startsWith(p.stateDir)), [p.stateDir, a, join(a, 'b'), stateDir, join(stateDir, 'inbox')]);
  await assert.rejects(fs.access(join(stateDir, 'serve.sock')), { code: 'ENOENT' });
  await assert.rejects(fs.access(join(stateDir, 'serve.lock')), { code: 'ENOENT' });
});

// Spec §5.3: expiry is checked on a timer. A running service, with no sweep() and no restart, must
// move each entry on at its deadline and send its waiter the state line. The service runs with an
// injected clock; when an entry reaches a watched state, onCommit (which runs before the service
// re-arms its timer) jumps the clock to LEAD ms before that entry's deadline, so the service's own
// timer, armed from nextDeadline(), is what has to fire.
test('the running service moves entries on at their deadlines by its own timer, and tells each waiter', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), LEAD = 300, jumps = new Map();
  let offset = 0;
  const clock = () => Date.now() + offset;
  const onCommit = (entry) => {
    const deadline = jumps.get(`${entry.id}:${entry.state}`);
    if (deadline) { jumps.delete(`${entry.id}:${entry.state}`); offset = deadline(entry) - LEAD - Date.now(); }
  };
  const abort = new AbortController();
  let ready; const started = new Promise((resolve) => { ready = resolve; });
  const run = runServe({ env: { RELAY_STATE_DIR: p.stateDir }, signal: abort.signal, clock, onCommit, ready, log: () => {} });
  t.after(async () => { abort.abort(); await run; });
  const client = await connectSocket((await started).socketPath); t.after(() => client.close());
  const lines = []; client.onPush((m) => { if (m.type === 'state') lines.push(m.entry); });
  const line = (id, state) => until(() => lines.find((e) => e.id === id && e.state === state), { timeoutMs: 5000, what: `the ${state} state line` });
  const ask = async (onState, deadline) => {
    const now = clock(), q = questionMessage({ createdAt: now, body: { expiresAt: now + 3_600_000 } });
    jumps.set(`${q.id}:${onState}`, deadline);
    assert.equal((await client.request('ask', { message: q, waiter: HANDLE, handback: false })).entry.state, 'pending');
    return q;
  };
  await client.request('presence.set', { mode: 'away' });

  const pending = await ask('pending', (e) => e.question.body.expiresAt);
  const expired = await line(pending.id, 'expired');
  assert.deepEqual([expired.log.at(-1).cause, expired.log.at(-1).at >= pending.body.expiresAt], ['expiry', true]);

  const handed = await ask('handed', (e) => e.handedAt + CONFIRM_WINDOW_MS);
  assert.equal((await client.request('answer', { message: answerMessage(handed) })).entry.state, 'answered');
  const hand = await client.request('handed', { id: handed.id, waiter: HANDLE });
  assert.equal(hand.entry.state, 'handed');
  const unconfirmed = await line(handed.id, 'unconfirmed');
  assert.deepEqual([unconfirmed.log.at(-1).cause, unconfirmed.log.at(-1).at >= hand.entry.handedAt + CONFIRM_WINDOW_MS], ['window', true]);

  const untaken = await ask('answered', (e) => e.question.body.expiresAt);
  const saved = (await client.request('answer', { message: answerMessage(untaken) })).entry;
  assert.equal(saved.state, 'answered');
  const undeliverable = await line(untaken.id, 'undeliverable');
  assert.deepEqual([undeliverable.log.at(-1).cause, undeliverable.answer], ['expiry', saved.answer]);
  assert.equal(jumps.size, 0);
});
