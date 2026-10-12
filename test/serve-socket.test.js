import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';
import { tempState } from './helpers/fixture.js';
import { spawnLines } from './helpers/spawn-lines.js';
import { openInbox } from '../src/serve/inbox.js';
import { serveSocket } from '../src/serve/socket.js';
import { connectSocket } from '../src/serve/client.js';
import { expectAnswers } from '../src/routes/index.js';
import { createProcessOps } from '../src/bus/proc.js';
import { questionMessage, answerMessage, deferMessage, withdrawalMessage, noticeMessage, HANDLE, OTHER_HANDLE } from './helpers/interaction.js';

const waiterFile = new URL('./fixtures/socket-waiter.js', import.meta.url).pathname;
async function setup(t, { io } = {}) {
  const p = await tempState(t), socketPath = join(p.stateDir, 'serve.sock');
  const { inbox } = await openInbox({ stateDir: p.stateDir, expectAnswers, ...(io ? { io } : {}) });
  await inbox.setPresence('away');
  const server = await serveSocket({ inbox, socketPath, processOps: createProcessOps(), reattachMs: 60000, log: () => {} });
  t.after(() => server.close());
  const client = await connectSocket(socketPath); t.after(() => client.close());
  return { p, inbox, socketPath, client };
}
async function waiter(t, ctx, handback = false) {
  const q = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000 } });
  const file = join(ctx.p.stateDir, `${q.id}.msg.json`); await fs.writeFile(file, JSON.stringify(q));
  const w = spawnLines(t, waiterFile, [ctx.socketPath, file, String(handback)]);
  const r = await w.next((m) => m.op === 'ask');
  assert.equal(r.ok, true, JSON.stringify(r));
  return { q, w };
}

test('the socket is private and answers unknown ops and bad JSON with errors', async (t) => {
  const { socketPath, client } = await setup(t);
  assert.equal((await fs.stat(socketPath)).mode & 0o777, 0o600);
  assert.equal((await client.request('fly')).error.code, 'UNKNOWN_OP');
  assert.equal((await client.request('answer', { message: { nope: 1 } })).error.code, 'INVALID_MESSAGE');
});
test('a waiter receives state lines: answered, then its own handed', async (t) => {
  const ctx = await setup(t), { q, w } = await waiter(t, ctx);
  assert.equal((await ctx.client.request('answer', { message: answerMessage(q) })).ok, true);
  assert.equal((await w.next((m) => m.type === 'state' && m.entry.state === 'answered')).entry.id, q.id);
  w.send('handed');
  assert.equal((await w.next((m) => m.op === 'handed')).entry.state, 'handed');
});
test('a waiter killed while pending withdraws its question (asker-gone)', async (t) => {
  const ctx = await setup(t), { q, w } = await waiter(t, ctx);
  w.child.kill('SIGKILL'); await w.exited;
  await ctx.inbox.idle(); await new Promise((r) => setTimeout(r, 50)); await ctx.inbox.idle();
  assert.deepEqual([ctx.inbox.get(q.id).state, ctx.inbox.get(q.id).withdrawal], ['withdrawn', { reason: 'asker-gone' }]);
});
test('a waiter killed after an answer leaves it undeliverable; a replay still returns it', async (t) => {
  const ctx = await setup(t), { q, w } = await waiter(t, ctx), a = answerMessage(q);
  await ctx.client.request('answer', { message: a });
  await w.next((m) => m.type === 'state' && m.entry.state === 'answered');
  w.child.kill('SIGKILL'); await w.exited;
  await new Promise((r) => setTimeout(r, 50)); await ctx.inbox.idle();
  assert.equal(ctx.inbox.get(q.id).state, 'undeliverable');
  const replay = await ctx.client.request('answer', { message: a });
  assert.deepEqual([replay.ok, replay.entry.state], [true, 'undeliverable']);
});
test('handed from another process is NOT_WAITER', async (t) => {
  const ctx = await setup(t), { q } = await waiter(t, ctx);
  await ctx.client.request('answer', { message: answerMessage(q) });
  assert.equal((await ctx.client.request('handed', { id: q.id, waiter: OTHER_HANDLE })).error.code, 'NOT_WAITER');
});
test('a defer on a handback route reaches the waiter as released', async (t) => {
  const ctx = await setup(t), { q, w } = await waiter(t, ctx, true);
  await ctx.client.request('defer', { message: deferMessage(q) });
  assert.equal((await w.next((m) => m.type === 'state' && m.entry.state === 'released')).entry.id, q.id);
});
test('watch replays since a seq and then pushes changes and presence', async (t) => {
  const ctx = await setup(t), { q } = await waiter(t, ctx);
  const watcher = await connectSocket(ctx.socketPath); t.after(() => watcher.close());
  const pushes = []; watcher.onPush((m) => pushes.push(m));
  const first = await watcher.request('watch', { since: 0 });
  assert.equal(typeof first.seq, 'number');
  assert.ok(pushes.some((m) => m.type === 'entry' && m.entry.id === q.id));
  pushes.length = 0;
  await ctx.client.request('presence.set', { mode: 'here' });
  await ctx.client.request('withdraw', { message: { ...answerMessage(q), kind: 'withdrawal', body: { reason: 'user' } } });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(pushes.map((m) => m.type), ['presence', 'entry']);
});
test('a watcher that disconnects while its registration is queued leaves no listener', async (t) => {
  let release, reached = null;
  t.after(() => release?.());
  const io = { ...fs, rename: async (from, to) => { if (reached && to.endsWith('.json')) { const r = reached; reached = null; r(); await new Promise((g) => { release = g; }); } return fs.rename(from, to); } };
  const ctx = await setup(t, { io }), { q } = await waiter(t, ctx);
  const baseline = ctx.inbox.subscribers();
  const hit = new Promise((r) => { reached = r; });
  const answering = ctx.client.request('answer', { message: answerMessage(q) });
  await hit; // the answer's write is paused, so the watch below waits in the queue
  const raw = net.createConnection(ctx.socketPath);
  await new Promise((r) => raw.once('connect', r));
  raw.write(`${JSON.stringify({ reqId: 1, op: 'watch', since: 0 })}\n`);
  await new Promise((r) => setTimeout(r, 50));
  raw.destroy();
  await new Promise((r) => setTimeout(r, 50)); // the server has seen the close
  release(); await answering; await ctx.inbox.idle();
  assert.equal(ctx.inbox.subscribers(), baseline);
});
test('withdraw over the socket accepts only user and asker reasons', async (t) => {
  const ctx = await setup(t), { q } = await waiter(t, ctx);
  const msg = { ...answerMessage(q), kind: 'withdrawal', body: { reason: 'asker-gone' } };
  assert.equal((await ctx.client.request('withdraw', { message: msg })).error.code, 'INVALID_MESSAGE');
});

for (const [name, data] of [
  ['unfinished ASCII', 'x'.repeat(1024 * 1024 + 1)],
  ['complete ASCII', 'x'.repeat(1024 * 1024 + 1) + '\n'],
  ['unfinished Unicode', '界'.repeat(350000)],
  ['complete Unicode', '界'.repeat(350000) + '\n'],
]) {
  test(`an oversized ${name} request closes before dispatch`, { timeout: 10000 }, async (t) => {
    const { socketPath } = await setup(t);
    const raw = net.createConnection(socketPath); t.after(() => raw.destroy());
    raw.on('error', () => {});
    await new Promise((r) => raw.once('connect', r));
    let replies = ''; raw.on('data', (d) => { replies += d; });
    const closed = new Promise((r) => raw.once('close', r));
    raw.write(data); await closed;
    assert.equal(replies, '');
  });
}

test('bad JSON returns INVALID_REQUEST and leaves the socket usable', async (t) => {
  const { socketPath } = await setup(t);
  const raw = net.createConnection(socketPath); t.after(() => raw.destroy());
  await new Promise((r) => raw.once('connect', r));
  const response = new Promise((r) => raw.once('data', (d) => r(JSON.parse(d))));
  raw.write('nope\n'); assert.equal((await response).error.code, 'INVALID_REQUEST');
});

test('socket withdrawal persists the complete normalized envelope', async (t) => {
  const ctx = await setup(t), { q } = await waiter(t, ctx);
  const message = withdrawalMessage(q);
  const response = await ctx.client.request('withdraw', { message: { ...message, raw: 'not retained' } });
  assert.equal(response.ok, true);
  assert.deepEqual(response.entry.messages, [{ at: response.entry.updatedAt, message }]);
});

test('concurrent watch requests reserve one listener before registration', async (t) => {
  const ctx = await setup(t), baseline = ctx.inbox.subscribers();
  const result = await Promise.all([ctx.client.request('watch'), ctx.client.request('watch')]);
  assert.equal(result.filter((r) => r.ok).length, 1);
  assert.equal(result.find((r) => !r.ok).error.code, 'INVALID_REQUEST');
  assert.equal(ctx.inbox.subscribers(), baseline + 1);
});

test('client get waits for a supersession to finish committing', async (t) => {
  let pause = false, release, reached;
  t.after(() => release?.());
  const io = { ...fs, rename: async (from, to) => {
    const result = await fs.rename(from, to);
    if (pause && to.endsWith('.json')) { pause = false; reached(); await new Promise((r) => { release = r; }); }
    return result;
  } };
  const ctx = await setup(t, { io }), { q } = await waiter(t, ctx);
  const replacement = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3600000, supersedes: q.id } });
  const hit = new Promise((r) => { reached = r; }); pause = true;
  const replacing = ctx.client.request('ask', { message: replacement, waiter: HANDLE, handback: false });
  await hit;
  let resolved = false;
  const reading = ctx.client.request('get', { id: q.id }).then((r) => { resolved = true; return r; });
  try { await new Promise((r) => setTimeout(r, 30)); assert.equal(resolved, false); }
  finally { release(); }
  await replacing;
  assert.equal((await reading).entry.state, 'withdrawn');
});

test('the real client receives a valid entry and list larger than the request cap', async (t) => {
  const ctx = await setup(t);
  const q = questionMessage({ createdAt: Date.now(), context: { project: '界'.repeat(220000), taskId: null, cwd: null },
    body: { expiresAt: Date.now() + 3600000 } });
  assert.equal((await ctx.client.request('ask', { message: q, waiter: HANDLE, handback: false })).ok, true);
  const a = answerMessage(q);
  assert.equal((await ctx.client.request('answer', { message: a })).entry.state, 'answered');
  const entry = (await ctx.client.request('get', { id: q.id })).entry;
  assert.ok(Buffer.byteLength(JSON.stringify(entry)) > 1024 * 1024);
  assert.deepEqual(entry.messages[0].message, a);
  const list = await ctx.client.request('list');
  assert.deepEqual(list.entries, [entry]);
});


test('closing the socket service waits for queued writes without withdrawing live routes', async (t) => {
  let pause = false, release, reached;
  t.after(() => release?.());
  const io = { ...fs, rename: async (from, to) => {
    if (pause && to.endsWith('.json')) { pause = false; reached(); await new Promise((r) => { release = r; }); }
    return fs.rename(from, to);
  } };
  const p = await tempState(t), socketPath = join(p.stateDir, 'serve.sock');
  const { inbox } = await openInbox({ stateDir: p.stateDir, io, expectAnswers }); await inbox.setPresence('away');
  const server = await serveSocket({ inbox, socketPath, processOps: createProcessOps(), log: () => {} });
  t.after(() => server.close());
  const client = await connectSocket(socketPath); t.after(() => client.close());
  const q = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3600000 } });
  const hit = new Promise((r) => { reached = r; }); pause = true;
  const asking = client.request('ask', { message: q, handback: false, waiter: HANDLE }).catch((e) => e.code);
  await hit;
  let closed = false; const closing = server.close().then(() => { closed = true; });
  try { await new Promise((r) => setTimeout(r, 30)); assert.equal(closed, false); }
  finally { release(); }
  await closing; await asking;
  assert.equal(inbox.get(q.id).state, 'pending');
});

test('a conflicting ask disconnected while queued cannot withdraw the original route', async (t) => {
  let pause = false, release, reached;
  t.after(() => release?.());
  const io = { ...fs, rename: async (from, to) => {
    if (pause && to.endsWith('.json')) { pause = false; reached(); await new Promise((r) => { release = r; }); }
    return fs.rename(from, to);
  } };
  const ctx = await setup(t, { io }), { q, w } = await waiter(t, ctx);
  const hit = new Promise((r) => { reached = r; }); pause = true;
  const writing = ctx.client.request('presence.set', { mode: 'away' }); await hit;
  const raw = net.createConnection(ctx.socketPath); t.after(() => raw.destroy());
  await new Promise((r) => raw.once('connect', r));
  raw.write(`${JSON.stringify({ reqId: 1, op: 'ask', message: { ...q, context: { ...q.context, project: 'conflict' } }, waiter: HANDLE, handback: false })}\n`);
  try {
    await new Promise((r) => setTimeout(r, 30)); raw.destroy();
    await new Promise((r) => setTimeout(r, 30));
  } finally { release(); }
  await writing; await ctx.inbox.idle();
  assert.equal(ctx.inbox.get(q.id).state, 'pending');
  await ctx.client.request('answer', { message: answerMessage(q) });
  assert.equal((await w.next((m) => m.type === 'state' && m.entry.state === 'answered')).entry.id, q.id);
});

test('the accepted waiter keeps state delivery while a conflicting ask is queued', async (t) => {
  let pause = false, release, reached;
  t.after(() => release?.());
  const io = { ...fs, rename: async (from, to) => {
    if (pause && to.endsWith('.json')) { pause = false; reached(); await new Promise((r) => { release = r; }); }
    return fs.rename(from, to);
  } };
  const ctx = await setup(t, { io }), { q, w } = await waiter(t, ctx);
  const hit = new Promise((r) => { reached = r; }); pause = true;
  const answering = ctx.client.request('answer', { message: answerMessage(q) }); await hit;
  const conflicting = ctx.client.request('ask', { message: { ...q, context: { ...q.context, project: 'conflict' } }, waiter: HANDLE, handback: false });
  try { await new Promise((r) => setTimeout(r, 30)); } finally { release(); }
  await answering; assert.equal((await conflicting).error.code, 'ID_CONFLICT');
  assert.equal((await w.next((m) => m.type === 'state' && m.entry.state === 'answered', 500)).entry.id, q.id);
});

test('a new ask disconnected while queued loses its route only after acceptance', async (t) => {
  let pause = false, release, reached;
  t.after(() => release?.());
  const io = { ...fs, rename: async (from, to) => {
    if (pause && to.endsWith('.json')) { pause = false; reached(); await new Promise((r) => { release = r; }); }
    return fs.rename(from, to);
  } };
  const ctx = await setup(t, { io });
  const q = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3600000 } });
  const hit = new Promise((r) => { reached = r; }); pause = true;
  const writing = ctx.client.request('presence.set', { mode: 'away' }); await hit;
  const raw = net.createConnection(ctx.socketPath); t.after(() => raw.destroy());
  await new Promise((r) => raw.once('connect', r));
  raw.write(`${JSON.stringify({ reqId: 1, op: 'ask', message: q, waiter: HANDLE, handback: false })}\n`);
  try { await new Promise((r) => setTimeout(r, 30)); raw.destroy(); await new Promise((r) => setTimeout(r, 30)); }
  finally { release(); }
  await writing; await ctx.inbox.idle();
  const entry = (await ctx.client.request('get', { id: q.id })).entry;
  assert.equal(entry.state, 'withdrawn');
  assert.equal(entry.log.filter((r) => r.cause === 'asker-gone').length, 1);
});

test('confirm rejects a raw or non-string answer map without changing the handed entry', async (t) => {
  const ctx = await setup(t), { q, w } = await waiter(t, ctx);
  await ctx.client.request('answer', { message: answerMessage(q) }); w.send('handed');
  await w.next((m) => m.op === 'handed');
  for (const observed of [[], { 'Which shape?': { raw: 'payload' } }]) {
    const result = await ctx.client.request('confirm', { harness: 'claude-code', callId: 'toolu_1', observed });
    assert.equal(result.error.code, 'INVALID_MESSAGE');
  }
  assert.equal((await ctx.client.request('get', { id: q.id })).entry.state, 'handed');
});

for (const status of ['alive', 'unknown', 'dead']) {
  test(`startup recheck preserves ${status} evidence unless death is confirmed`, async (t) => {
    const p = await tempState(t), socketPath = join(p.stateDir, 'serve.sock');
    const { inbox } = await openInbox({ stateDir: p.stateDir, expectAnswers }); await inbox.setPresence('away');
    const q = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3600000 } });
    await inbox.ask(q, { handback: false, waiter: HANDLE });
    const server = await serveSocket({ inbox, socketPath, processOps: { probe: () => ({ status }) }, reattachMs: 10, log: () => {} });
    t.after(() => server.close());
    await new Promise((r) => setTimeout(r, 40)); await inbox.idle();
    assert.equal(inbox.get(q.id).state, status === 'dead' ? 'withdrawn' : 'pending');
  });
}

test('service refuses a non-socket path without deleting it or retaining a subscriber', async (t) => {
  const p = await tempState(t), socketPath = join(p.stateDir, 'serve.sock');
  const { inbox } = await openInbox({ stateDir: p.stateDir, expectAnswers });
  await fs.writeFile(socketPath, 'keep', { mode: 0o600 });
  await assert.rejects(serveSocket({ inbox, socketPath, processOps: createProcessOps(), log: () => {} }), { code: 'IO_ERROR' });
  assert.equal(await fs.readFile(socketPath, 'utf8'), 'keep');
  assert.equal(inbox.subscribers(), 0);
});


test('each socket message operation rejects a valid envelope of the wrong kind', async (t) => {
  const { client, inbox } = await setup(t), q = questionMessage();
  for (const [op, message] of [
    ['ask', noticeMessage()], ['notify', q], ['answer', q],
    ['defer', answerMessage(q)], ['withdraw', deferMessage(q)],
  ]) {
    const result = await client.request(op, { message, waiter: HANDLE, handback: false });
    assert.equal(result.error.code, 'INVALID_MESSAGE', op);
  }
  assert.equal(inbox.seq(), 0);
});
