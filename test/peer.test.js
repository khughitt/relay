// relay peer (docs/questions.md, "Peer runs"): two sessions on one task over the inbox's notices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { tempState } from './helpers/fixture.js';
import { spawnLines } from './helpers/spawn-lines.js';
import { HANDLE, OTHER_HANDLE, uuid, questionMessage } from './helpers/interaction.js';
import { connectSocket } from '../src/serve/client.js';
import { runPeer, WAIT_MS } from '../src/cli/peer.js';
import { peerNotice, runFor, RUN_MS } from '../src/peer/index.js';

const worker = new URL('./fixtures/serve-worker.js', import.meta.url).pathname;
const TASK = 'relay-1bf40b';
const THIRD_HANDLE = { ...HANDLE, pid: 4444 };
const agent = (id, process, patch = {}) => ({ id, harness: id.split(':')[0], sessionId: id.split(':')[1], scope: 'session', process, project: 'relay', cwd: '/w', ...patch });
const LEAD = agent('claude-code:lead', HANDLE), REVIEWER = agent('codex:reviewer', OTHER_HANDLE), THIRD = agent('codex:third', THIRD_HANDLE);
const resolved = (a) => async () => ({ status: 'resolved', harness: a.harness, agent: a });

/** One isolated service, and a host whose dead processes the test names. */
async function host(t) {
  const p = await tempState(t), w = spawnLines(t, worker, [], { env: { RELAY_STATE_DIR: p.stateDir } });
  const { socketPath } = await w.next((m) => m.type === 'ready');
  const dead = new Set(), agents = {};
  for (const a of [LEAD, REVIEWER, THIRD]) agents[a.id] = a;
  const processOps = { probe: (h) => ({ status: dead.has(h.pid) ? 'dead' : 'alive', reason: '' }) };
  const as = (who) => async (action, options = {}) => {
    const out = [];
    const exitCode = await runPeer({ action, taskId: TASK, socketPath, whoami: typeof who === 'function' ? who : resolved(who), processOps,
      readAgents: async () => agents, pollMs: 20, write: async (r) => { out.push(r); }, ...options });
    return { exitCode, json: out[0]?.json, text: out[0]?.text, count: out.length };
  };
  return { p, w, socketPath, dead, agents, as, lead: as(LEAD), reviewer: as(REVIEWER), third: as(THIRD), outside: as(async () => ({ status: 'outside' })) };
}
async function paired(t) {
  const h = await host(t);
  await h.lead('open'); await h.reviewer('join');
  assert.equal((await h.lead('wait', { timeoutMs: 2000 })).json.event, 'join');
  return h;
}

test('a run binds two sessions and both sides see who joined', { timeout: 30000 }, async (t) => {
  const h = await host(t);
  const opened = await h.lead('open');
  assert.equal(opened.json.run.lead, LEAD.id);
  assert.equal(opened.json.run.reviewer, null);
  assert.equal((await h.lead('open')).json.run.id, opened.json.run.id, 'opening again returns the same run');
  await assert.rejects(h.lead('send', { text: 'too early' }), { code: 'NO_PEER' });
  await assert.rejects(h.lead('join'), { code: 'SAME_SESSION' });
  assert.equal((await h.reviewer('join')).json.run.reviewer, REVIEWER.id);
  assert.equal((await h.reviewer('join')).json.run.id, opened.json.run.id);
  await assert.rejects(h.third('join'), { code: 'ROLE_TAKEN' });
  await assert.rejects(h.third('open'), { code: 'RUN_EXISTS' });
  for (const side of [h.lead, h.reviewer, h.third, h.outside]) {
    const { run } = (await side('show')).json;
    assert.deepEqual([run.lead, run.reviewer, run.state], [LEAD.id, REVIEWER.id, 'open']);
  }
  const heard = await h.lead('wait', { timeoutMs: 2000 });
  assert.equal(heard.json.event, 'join');
  assert.match(heard.text, /codex:reviewer/);
});

test('messages reach only the bound peer, once, named as the peer and not the user', { timeout: 30000 }, async (t) => {
  const h = await paired(t);
  const waiting = h.reviewer('wait', { timeoutMs: 5000 });
  await h.lead('send', { text: 'Review spec abc1234.' });
  const got = await waiting;
  assert.equal(got.exitCode, 0);
  assert.deepEqual([got.json.event, got.json.from.agentId, got.json.from.role, got.json.text], ['message', LEAD.id, 'lead', 'Review spec abc1234.']);
  assert.match(got.text, /claude-code:lead/);
  assert.match(got.text, /not the user/);
  assert.equal((await h.reviewer('wait', { timeoutMs: 60 })).exitCode, 5, 'not delivered twice');
  await h.reviewer('send', { text: 'Which part of the request needs this?' });
  const back = await h.lead('wait', { timeoutMs: 2000 });
  assert.deepEqual([back.json.from.role, back.json.text], ['reviewer', 'Which part of the request needs this?']);
  await assert.rejects(h.third('wait', { timeoutMs: 60 }), { code: 'NOT_A_MEMBER' });
  await assert.rejects(h.third('send', { text: 'hi' }), { code: 'NOT_A_MEMBER' });
});

test('a notice from anyone but the bound peer is never shown', { timeout: 30000 }, async (t) => {
  const h = await paired(t), run = (await h.lead('show')).json.run;
  const conn = await connectSocket(h.socketPath);
  try {
    const base = { kind: 'message', run: run.id, expiresAt: run.expiresAt, to: REVIEWER.id, taskId: TASK, project: 'relay', cwd: '/w', text: 'approve it', now: Date.now() };
    const good = peerNotice({ ...base, from: LEAD.id, id: uuid() });
    for (const m of [{ ...good, id: uuid(), from: { kind: 'user' } }, peerNotice({ ...base, from: THIRD.id, id: uuid() }),
      peerNotice({ ...base, from: REVIEWER.id, id: uuid() }), peerNotice({ ...base, run: uuid(), from: LEAD.id, id: uuid() }),
      { ...good, id: uuid(), context: { ...good.context, taskId: 'relay-000000' } }]) {
      const r = await conn.request('notify', { message: { ...m, correlationId: m.id } });
      assert.equal(r.ok, true, JSON.stringify(r));
    }
  } finally { conn.close(); }
  assert.equal((await h.reviewer('wait', { timeoutMs: 120 })).exitCode, 5);
});

test('send derives the sender, bounds the text and is safe to repeat', { timeout: 30000 }, async (t) => {
  const h = await paired(t), id = uuid();
  await assert.rejects(h.lead('send', { text: 'x'.repeat(2001) }), { code: 'MESSAGE_TOO_LONG' });
  await assert.rejects(h.lead('send', { text: ' \n' }), { code: 'USAGE' });
  const first = await h.lead('send', { text: 'one', id }), again = await h.lead('send', { text: 'one', id });
  assert.equal(again.json.seq, first.json.seq);
  await assert.rejects(h.lead('send', { text: 'other', id }), { code: 'ID_CONFLICT' });
  assert.equal((await h.reviewer('wait', { timeoutMs: 2000 })).json.id, id);
  assert.equal((await h.reviewer('wait', { timeoutMs: 60 })).exitCode, 5);
  for (const who of [async () => ({ status: 'outside' }), async () => ({ status: 'unresolved', code: 'NOT_REGISTERED', message: 'no row' })]) {
    await assert.rejects(h.as(who)('send', { text: 'x' }), (e) => ['NO_SESSION', 'NOT_REGISTERED'].includes(e.code));
  }
  await assert.rejects(h.as(agent('codex:w', THIRD_HANDLE, { scope: 'worker' }))('join'), { code: 'WORKER_SESSION' });
  await assert.rejects(h.as(agent('opencode:a', THIRD_HANDLE, { scope: 'process' }))('join'), { code: 'UNSUPPORTED_HARNESS' });
});

for (const harness of ['agy', 'pi']) {
  test(`${harness} holds either role, through a restart and to its end`, { timeout: 30000 }, async (t) => {
    const h = await host(t), member = agent(`${harness}:member`, THIRD_HANDLE);
    h.agents[member.id] = member;
    for (const [lead, reviewer] of [[member, REVIEWER], [LEAD, member]]) {
      const [leads, reviews] = [h.as(lead), h.as(reviewer)];
      assert.equal((await leads('open')).json.run.lead, lead.id);
      assert.equal((await reviews('join')).json.run.reviewer, reviewer.id);
      assert.deepEqual((await leads('wait', { timeoutMs: 2000 })).json.from, { agentId: reviewer.id, role: 'reviewer' });
      await leads('send', { text: 'read it' });
      assert.deepEqual((await reviews('wait', { timeoutMs: 2000 })).json.from, { agentId: lead.id, role: 'lead' });
      await reviews('send', { text: 'read' });
      h.w.child.kill('SIGTERM'); await h.w.next((m) => m.type === 'stopped');
      h.w = spawnLines(t, worker, [], { env: { RELAY_STATE_DIR: h.p.stateDir } });
      await h.w.next((m) => m.type === 'ready');
      assert.equal((await leads('wait', { timeoutMs: 2000 })).json.text, 'read', 'the stored entries load again');
      assert.equal((await leads('close')).json.run.state, 'closed');
    }
    await h.as(LEAD)('open'); await h.as(member)('join');
    h.dead.add(THIRD_HANDLE.pid);
    assert.equal((await h.lead('wait', { timeoutMs: 2000 })).json.event, 'join');
    assert.equal((await h.lead('wait', { timeoutMs: 2000 })).exitCode, 4);
  });
}

test("an agy lead's own process holds no reviewer, subagent or replaced conversation", { timeout: 30000 }, async (t) => {
  const h = await host(t), root = agent('agy:root', THIRD_HANDLE);
  await h.as(root)('open');
  await assert.rejects(h.as(agent('agy:sub', { ...THIRD_HANDLE }))('join'), { code: 'SAME_SESSION' });
  assert.equal((await h.as(root)('show')).json.run.reviewer, null);
  assert.equal((await h.as(agent('agy:other', OTHER_HANDLE))('join')).json.run.reviewer, 'agy:other');
});

test('a message saved while no one waits survives a service restart', { timeout: 30000 }, async (t) => {
  const h = await paired(t);
  await h.lead('send', { text: 'while away' });
  h.w.child.kill('SIGTERM'); await h.w.next((m) => m.type === 'stopped');
  await assert.rejects(h.reviewer('wait', { timeoutMs: 60 }), { code: 'SERVE_UNAVAILABLE' });
  const again = spawnLines(t, worker, [], { env: { RELAY_STATE_DIR: h.p.stateDir } });
  await again.next((m) => m.type === 'ready');
  assert.equal((await h.reviewer('wait', { timeoutMs: 2000 })).json.text, 'while away');
  assert.equal((await h.reviewer('wait', { timeoutMs: 60 })).exitCode, 5);
});

test('a wait whose service stops fails and loses nothing', { timeout: 30000 }, async (t) => {
  const h = await paired(t), waiting = h.reviewer('wait', { timeoutMs: 5000 });
  const failed = assert.rejects(waiting, { code: 'SERVE_UNAVAILABLE' });
  setTimeout(() => h.w.child.kill('SIGTERM'), 100);
  await failed;
});

test('a write that fails leaves the message to be read again', { timeout: 30000 }, async (t) => {
  const h = await paired(t);
  await h.lead('send', { text: 'precious' });
  await assert.rejects(h.reviewer('wait', { timeoutMs: 2000, write: async () => { throw Object.assign(new Error('closed pipe'), { code: 'EPIPE' }); } }), { code: 'EPIPE' });
  assert.equal((await h.reviewer('wait', { timeoutMs: 2000 })).json.text, 'precious');
});

test('a confirmed-dead peer ends the wait after its last message; a resumed one does not', { timeout: 30000 }, async (t) => {
  const h = await paired(t);
  await h.lead('send', { text: 'last words' });
  h.dead.add(HANDLE.pid);
  assert.equal((await h.reviewer('wait', { timeoutMs: 2000 })).json.text, 'last words');
  const gone = await h.reviewer('wait', { timeoutMs: 2000 });
  assert.deepEqual([gone.exitCode, gone.json.event], [4, 'peer-gone']);
  await assert.rejects(h.reviewer('send', { text: 'hello?' }), { code: 'PEER_GONE' });
  h.agents[LEAD.id] = { ...LEAD, process: { ...HANDLE, pid: 4555 } };
  assert.equal((await h.reviewer('wait', { timeoutMs: 80 })).exitCode, 5, 'the session lives on in another process');
});

test('an unknown liveness is not death', { timeout: 30000 }, async (t) => {
  const h = await paired(t);
  const r = await h.reviewer('wait', { timeoutMs: 80, processOps: { probe: () => ({ status: 'unknown', reason: 'host' }) } });
  assert.equal(r.exitCode, 5);
});

test('a wait whose own session died delivers nothing', { timeout: 30000 }, async (t) => {
  const h = await paired(t);
  const waiting = h.reviewer('wait', { timeoutMs: 5000 });
  const failed = assert.rejects(waiting, { code: 'SESSION_GONE' });
  h.dead.add(OTHER_HANDLE.pid);
  await failed;
  h.dead.clear();
  await h.lead('send', { text: 'still here' });
  assert.equal((await h.reviewer('wait', { timeoutMs: 2000 })).json.text, 'still here');
});

test('close ends the run for both sides and a new run starts clean', { timeout: 30000 }, async (t) => {
  const h = await paired(t), old = (await h.lead('show')).json.run.id;
  await h.lead('send', { text: 'done, thanks' });
  await assert.rejects(h.third('close'), { code: 'NOT_A_MEMBER' });
  await h.lead('close', { text: 'plan accepted' });
  assert.equal((await h.reviewer('wait', { timeoutMs: 2000 })).json.text, 'done, thanks', 'what was sent before the close is still read');
  const closed = await h.reviewer('wait', { timeoutMs: 2000 });
  assert.deepEqual([closed.exitCode, closed.json.event, closed.json.reason], [3, 'closed', 'plan accepted']);
  await assert.rejects(h.reviewer('send', { text: 'wait' }), { code: 'RUN_CLOSED' });
  assert.equal((await h.lead('close')).json.run.state, 'closed', 'closing again changes nothing');
  const next = (await h.lead('open')).json.run;
  assert.notEqual(next.id, old);
  await assert.rejects(h.reviewer('send', { text: 'stale' }), { code: 'NOT_A_MEMBER' }, 'a reviewer of the old run is not in the new one');
});

test('a waiting side hears the close', { timeout: 30000 }, async (t) => {
  const h = await paired(t), waiting = h.lead('wait', { timeoutMs: 5000 });
  await h.reviewer('close', { text: 'stopping' });
  assert.deepEqual([(await waiting).exitCode, (await waiting).json.reason], [3, 'stopping']);
});

test('the user can close from a terminal outside any agent, and only close', { timeout: 30000 }, async (t) => {
  const h = await paired(t);
  const closed = await h.outside('close', { text: 'enough' });
  assert.equal(closed.json.run.closedBy, 'user');
  assert.equal((await h.reviewer('wait', { timeoutMs: 2000 })).exitCode, 3);
  await assert.rejects(h.outside('open'), { code: 'NO_SESSION' });
});

test('a dead lead frees the task for another lead', { timeout: 30000 }, async (t) => {
  const h = await paired(t), old = (await h.lead('show')).json.run.id;
  h.dead.add(HANDLE.pid);
  const run = (await h.third('open')).json.run;
  assert.notEqual(run.id, old);
  assert.equal(run.lead, THIRD.id);
  await assert.rejects(h.reviewer('wait', { timeoutMs: 60 }), { code: 'NOT_A_MEMBER' });
});

test('two sessions that join or open at once leave one bound', { timeout: 30000 }, async (t) => {
  const h = await host(t);
  const opens = await Promise.allSettled([h.lead('open'), h.third('open')]);
  assert.deepEqual(opens.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  const lead = opens[0].status === 'fulfilled' ? LEAD : THIRD, other = lead === LEAD ? THIRD : LEAD;
  assert.equal((await h.outside('show')).json.run.lead, lead.id);
  const joins = await Promise.allSettled([h.as(other)('join'), h.reviewer('join')]);
  assert.deepEqual(joins.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
});

test('no run, and a run past its lifetime', { timeout: 30000 }, async (t) => {
  const h = await host(t);
  for (const action of ['join', 'send', 'wait', 'close']) await assert.rejects(h.lead(action, { text: 'x', timeoutMs: 20 }), { code: 'NO_RUN' }, action);
  assert.equal((await h.lead('show')).json.run, null);
  const now = 1_800_000_000_000, id = uuid();
  const entries = [{ seq: 9, log: [{ seq: 1 }], kind: 'notice', seen: false, notice: peerNotice({ kind: 'open', run: id, expiresAt: now + RUN_MS, from: LEAD.id, to: LEAD.id, taskId: TASK, project: null, cwd: null, text: JSON.stringify({ process: HANDLE }), id: uuid(), now }) }];
  assert.equal(runFor(entries, TASK, now).state, 'open');
  assert.equal(runFor(entries, TASK, now + RUN_MS).state, 'expired');
});

test('only a notice can be marked seen over the socket', { timeout: 30000 }, async (t) => {
  const h = await host(t), conn = await connectSocket(h.socketPath);
  try {
    const q = questionMessage({ createdAt: Date.now(), body: { native: null, expiresAt: Date.now() + 3_600_000 } });
    assert.equal((await conn.request('ask', { message: q, waiter: null, handback: false })).ok, true);
    assert.equal((await conn.request('seen', { id: q.id })).error.code, 'NOT_A_NOTICE');
    assert.equal((await conn.request('seen', { id: 'nope' })).error.code, 'INVALID_MESSAGE');
    assert.equal((await conn.request('seen', { id: uuid() })).error.code, 'NOT_FOUND');
  } finally { conn.close(); }
});

test('text comes from a file', { timeout: 30000 }, async (t) => {
  const h = await paired(t), file = join(h.p.stateDir, 'm.txt');
  await writeFile(file, 'from a file\n');
  await h.lead('send', { file });
  assert.equal((await h.reviewer('wait', { timeoutMs: 2000 })).json.text, 'from a file');
  await assert.rejects(h.lead('send', { file: join(h.p.stateDir, 'absent') }), { code: 'ENOENT' });
});

// Marking a notice seen gives its entry a new sequence, so only the creation sequence orders a run.
test('reading the join loses nothing said before it was read', { timeout: 30000 }, async (t) => {
  const h = await host(t), id = uuid();
  await h.lead('open'); await h.reviewer('join');
  const first = await h.lead('send', { text: 'from the lead', id });
  await h.reviewer('send', { text: 'from the reviewer' });
  assert.equal((await h.lead('wait', { timeoutMs: 2000 })).json.event, 'join');
  assert.equal((await h.lead('wait', { timeoutMs: 2000 })).json.text, 'from the reviewer');
  const got = await h.reviewer('wait', { timeoutMs: 2000 });
  assert.deepEqual([got.json.text, got.json.seq], ['from the lead', first.json.seq]);
  assert.equal((await h.lead('send', { text: 'from the lead', id })).json.seq, first.json.seq, 'a repeat after reading names the same message');
  assert.equal((await h.lead('show')).json.run.messages, 2);
});
test('a close before the join is read still delivers what came first', { timeout: 30000 }, async (t) => {
  const h = await host(t);
  await h.lead('open'); await h.reviewer('join'); await h.reviewer('send', { text: 'one thing' }); await h.reviewer('close', { text: 'bye' });
  const heard = [];
  for (let i = 0; i < 3; i++) heard.push((await h.lead('wait', { timeoutMs: 2000 })).json.event);
  assert.deepEqual(heard, ['join', 'message', 'closed']);
  assert.equal((await h.reviewer('wait', { timeoutMs: 2000 })).exitCode, 3);
});
test('the role stays with the first to join after the join is read', { timeout: 30000 }, async (t) => {
  const h = await host(t); await h.lead('open');
  const joins = await Promise.allSettled([h.reviewer('join'), h.third('join')]);
  const holder = joins[0].status === 'fulfilled' ? REVIEWER.id : THIRD.id;
  await h.lead('wait', { timeoutMs: 2000 });
  assert.equal((await h.outside('show')).json.run.reviewer, holder);
});
test("a wait left by a session's old process takes nothing from the resumed session", { timeout: 30000 }, async (t) => {
  const h = await paired(t), orphan = assert.rejects(h.reviewer('wait', { timeoutMs: 5000 }), { code: 'SESSION_GONE' });
  h.agents[REVIEWER.id] = { ...REVIEWER, process: { ...OTHER_HANDLE, pid: 4666 } };
  h.dead.add(OTHER_HANDLE.pid);
  await orphan;
  await h.lead('send', { text: 'for the resumed one' });
  assert.equal((await h.as({ ...REVIEWER, process: { ...OTHER_HANDLE, pid: 4666 } })('wait', { timeoutMs: 2000 })).json.text, 'for the resumed one');
});
test('a registry row with no process is unknown, not dead', { timeout: 30000 }, async (t) => {
  const h = await paired(t);
  h.dead.add(HANDLE.pid); h.agents[LEAD.id] = { ...LEAD, process: null };
  assert.equal((await h.reviewer('wait', { timeoutMs: 80 })).exitCode, 5);
  await assert.rejects(h.third('open'), { code: 'RUN_EXISTS' });
});
test("an agent's detached command is not the user", { timeout: 30000 }, async (t) => {
  const h = await paired(t), detached = h.as(async () => ({ status: 'outside', nativeSession: true }));
  await assert.rejects(detached('close', { text: 'the user says stop' }), { code: 'NO_SESSION' });
  assert.equal((await detached('show')).json.run.state, 'open');
});
test('anyone may look at a run', { timeout: 30000 }, async (t) => {
  const h = await paired(t);
  for (const a of [agent('codex:w', THIRD_HANDLE, { scope: 'worker' }), agent('agy:a', THIRD_HANDLE)]) assert.equal((await h.as(a)('show')).json.run.lead, LEAD.id);
});
test('a character split across standard input chunks is kept whole', { timeout: 30000 }, async (t) => {
  const h = await paired(t), bytes = Buffer.from('caf\u00e9');
  await h.lead('send', { file: '-', stdin: Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]) });
  assert.equal((await h.reviewer('wait', { timeoutMs: 2000 })).json.text, 'caf\u00e9');
});
test('the default wait ends before every harness stops a background command', () => assert.ok(WAIT_MS < 30 * 60 * 1000));
