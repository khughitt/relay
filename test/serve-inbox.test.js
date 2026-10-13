import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { validateEntry } from '../src/interaction/lifecycle.js';
import { RETENTION_MS } from '../src/interaction/store.js';
import { tempState } from './helpers/fixture.js';
import { openInbox } from '../src/serve/inbox.js';
import { CONFIRM_WINDOW_MS } from '../src/interaction/lifecycle.js';
import { questionMessage, answerMessage, deferMessage, noticeMessage, withdrawalMessage, HANDLE, NOW } from './helpers/interaction.js';

async function setup(t, { mode = 'away' } = {}) {
  const p = await tempState(t); let now = NOW;
  const clock = () => now, open = () => openInbox({ stateDir: p.stateDir, clock, expectAnswers: () => ({ 'Which shape?': 'Square' }) });
  const { inbox } = await open();
  if (mode) await inbox.setPresence(mode);
  return { p, inbox, open, advance: (ms) => { now += ms; }, at: () => now };
}
const ask = (inbox, q = questionMessage(), handback = false) => inbox.ask(q, { handback, waiter: HANDLE });

test('presence here passes through and creates nothing; default presence is here', async (t) => {
  const { inbox } = await setup(t, { mode: null });
  assert.equal(inbox.presence().mode, 'here');
  assert.deepEqual(await ask(inbox), { passthrough: true });
  assert.deepEqual(inbox.list(), []);
});
test('ask is idempotent by id and refuses a different body under the same id', async (t) => {
  const { inbox } = await setup(t), q = questionMessage();
  const first = await ask(inbox, q), again = await ask(inbox, q);
  assert.equal(first.entry.seq, again.entry.seq);
  assert.equal((await ask(inbox, { ...q, createdAt: q.createdAt + 1 })).error.code, 'ID_CONFLICT');
});
test('a reattach still finds its entry after presence moves to here', async (t) => {
  const { inbox } = await setup(t), q = questionMessage();
  await ask(inbox, q); await inbox.setPresence('here');
  assert.equal((await ask(inbox, q)).entry.id, q.id);
});
test('expiry applies before an answer that arrives late', async (t) => {
  const { inbox, advance } = await setup(t), q = questionMessage();
  await ask(inbox, q); advance(3_600_000);
  const r = await inbox.answer(q.id, answerMessage(q));
  assert.equal(r.error.code, 'EXPIRED'); assert.equal(inbox.get(q.id).state, 'expired');
});
test('concurrent answers: exactly one wins', async (t) => {
  const { inbox } = await setup(t), q = questionMessage();
  await ask(inbox, q);
  const results = await Promise.all([inbox.answer(q.id, answerMessage(q)), inbox.answer(q.id, answerMessage(q))]);
  assert.deepEqual(results.map((r) => r.error?.code ?? 'ok').sort(), ['ALREADY_ANSWERED', 'ok']);
});
test('supersession withdraws the predecessor and publishes both after both writes', async (t) => {
  const { inbox } = await setup(t), x = questionMessage(); await ask(inbox, x);
  const seen = []; inbox.subscribe((e) => seen.push(e.entry.id));
  const n = questionMessage({ body: { supersedes: x.id } });
  const r = await ask(inbox, n);
  assert.equal(r.entry.state, 'pending');
  assert.deepEqual([inbox.get(x.id).state, inbox.get(x.id).supersededBy], ['withdrawn', n.id]);
  assert.deepEqual(seen, [n.id, x.id]);
  assert.equal((await inbox.answer(x.id, answerMessage(x))).error.code, 'WITHDRAWN');
});
test('supersession is refused for an answered predecessor or another asker', async (t) => {
  const { inbox } = await setup(t), x = questionMessage(); await ask(inbox, x);
  await inbox.answer(x.id, answerMessage(x));
  const r = await ask(inbox, questionMessage({ body: { supersedes: x.id } }));
  assert.equal(r.error.code, 'ANSWERED'); assert.ok(r.error.answer);
  const y = questionMessage(); await ask(inbox, y);
  assert.equal((await ask(inbox, questionMessage({ from: { kind: 'agent', agentId: 'codex:z' }, body: { supersedes: y.id } }))).error.code, 'NOT_SUPERSEDABLE');
});
test('confirm finds the entry by native call and compares with expectAnswers', async (t) => {
  const { inbox } = await setup(t), q = questionMessage();
  await ask(inbox, q); await inbox.answer(q.id, answerMessage(q)); await inbox.handed(q.id, HANDLE);
  assert.equal((await inbox.confirm({ harness: 'claude-code', callId: 'toolu_1', observed: { 'Which shape?': 'Square' } })).entry.state, 'consumed');
  assert.equal((await inbox.confirm({ harness: 'claude-code', callId: 'nope', observed: {} })).error.code, 'NOT_FOUND');
});
test('sweep moves handed to unconfirmed after the window; nextDeadline follows', async (t) => {
  const { inbox, advance, at } = await setup(t), q = questionMessage();
  await ask(inbox, q); await inbox.answer(q.id, answerMessage(q)); await inbox.handed(q.id, HANDLE);
  assert.equal(inbox.nextDeadline(), at() + CONFIRM_WINDOW_MS);
  advance(CONFIRM_WINDOW_MS); await inbox.sweep();
  assert.equal(inbox.get(q.id).state, 'unconfirmed'); assert.equal(inbox.nextDeadline(), null);
});
test('reopen recovers entries and presence, and sweeps overdue entries at once', async (t) => {
  const { inbox, open, advance } = await setup(t), q = questionMessage();
  await ask(inbox, q); advance(3_600_000);
  const { inbox: again } = await open();
  assert.equal(again.get(q.id).state, 'expired'); assert.equal(again.presence().mode, 'away');
});
test('list: non-terminal by default, terminal ones changed since a seq; notices', async (t) => {
  const { inbox } = await setup(t), a = questionMessage(), b = questionMessage();
  await ask(inbox, a); await ask(inbox, b);
  const mark = inbox.seq();
  await inbox.withdraw(a.id, withdrawalMessage(a));
  assert.deepEqual(inbox.list().map((e) => e.id), [b.id]);
  assert.deepEqual(inbox.list({ since: mark }).map((e) => e.id).sort(), [a.id, b.id].sort());
  const n = noticeMessage(); await inbox.notify(n);
  assert.equal((await inbox.seen(n.id)).entry.seen, true);
});
test('a failed replacement write stops the inbox; reopening reconciles', async (t) => {
  const p = await tempState(t), arm = { fail: null };
  const io = { ...fs, rename: async (from, to) => { if (arm.fail?.(to)) { arm.fail = null; throw Object.assign(new Error('disk'), { code: 'EIO' }); } return fs.rename(from, to); } };
  const open = () => openInbox({ stateDir: p.stateDir, io, expectAnswers: () => ({}) });
  const { inbox } = await open(); await inbox.setPresence('away');
  const x = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000 } });
  await ask(inbox, x);
  const n = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000, supersedes: x.id } });
  arm.fail = (to) => to.endsWith(`${x.id}.json`);
  await assert.rejects(ask(inbox, n), { code: 'STORE_FAILED' });
  for (const id of [n.id, x.id]) await assert.rejects(inbox.answer(id, answerMessage(id === n.id ? n : x)), { code: 'STORE_FAILED' });
  await assert.rejects(inbox.snapshot(), { code: 'STORE_FAILED' });
  assert.equal((await inbox.halted).code, 'STORE_FAILED');
  const { inbox: again, rejected } = await open();
  assert.deepEqual(rejected, []);
  assert.deepEqual([again.get(x.id).state, again.get(x.id).supersededBy, again.get(n.id).state], ['withdrawn', n.id, 'pending']);
});
test('snapshot and watch wait for a write in flight and never skip it', async (t) => {
  const p = await tempState(t);
  let release, reached = null;
  const io = { ...fs, rename: async (from, to) => { if (reached && to.endsWith('.json')) { const r = reached; reached = null; r(); await new Promise((g) => { release = g; }); } return fs.rename(from, to); } };
  const { inbox } = await openInbox({ stateDir: p.stateDir, io, expectAnswers: () => ({}) });
  await inbox.setPresence('away');
  const q = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000 } });
  const asked = (await ask(inbox, q)).entry;
  const hit = new Promise((r) => { reached = r; });
  const answering = inbox.answer(q.id, answerMessage(q));
  await hit;
  const snap = inbox.snapshot(), seen = [], watching = inbox.watch(asked.seq, (e) => seen.push(e));
  assert.equal(inbox.seq(), asked.seq);
  release();
  const [answered, s] = await Promise.all([answering, snap]);
  assert.equal(s.seq, answered.entry.seq);
  assert.equal(s.entries.find((e) => e.id === q.id).state, 'answered');
  const w = await watching;
  assert.equal(w.seq, answered.entry.seq);
  assert.deepEqual(seen.map((e) => e.entry.state), ['answered']);
});
test('defer on a handback route releases', async (t) => {
  const { inbox } = await setup(t), q = questionMessage();
  await ask(inbox, q, true);
  assert.equal((await inbox.defer(q.id, deferMessage(q))).entry.state, 'released');
});

test('presence rejects corrupt timestamps and unsafe permissions without repairing them', async (t) => {
  const p = await tempState(t), path = join(p.stateDir, 'presence.json');
  await fs.writeFile(path, JSON.stringify({ schema: 1, mode: 'away', updatedAt: -1 }), { mode: 0o600 });
  await assert.rejects(openInbox({ stateDir: p.stateDir, clock: () => NOW }), { code: 'CORRUPT_STATE' });
  await fs.writeFile(path, JSON.stringify({ schema: 1, mode: 'away', updatedAt: NOW }));
  await fs.chmod(path, 0o644);
  await assert.rejects(openInbox({ stateDir: p.stateDir, clock: () => NOW }), { code: 'IO_ERROR' });
  assert.equal((await fs.stat(path)).mode & 0o777, 0o644);
});
test('presence persists before publishing, invalid updates leave the queue usable', async (t) => {
  const { p, inbox, open, advance, at } = await setup(t);
  const events = [], unsubscribe = inbox.subscribe((event) => events.push(event));
  advance(1);
  await assert.rejects(inbox.setPresence('sleeping'), { code: 'INVALID_INPUT' });
  const presence = await inbox.setPresence('here');
  assert.deepEqual(presence, { mode: 'here', updatedAt: at() });
  assert.deepEqual(events, [{ type: 'presence', presence }]);
  assert.deepEqual(JSON.parse(await fs.readFile(join(p.stateDir, 'presence.json'), 'utf8')), { schema: 1, ...presence });
  assert.equal((await fs.stat(join(p.stateDir, 'presence.json'))).mode & 0o777, 0o600);
  assert.deepEqual((await open()).inbox.presence(), presence);
  unsubscribe();
  assert.equal(inbox.subscribers(), 0);
  await inbox.idle();
});
test('onCommit and supersession listeners only observe durable complete replacement state', async (t) => {
  const p = await tempState(t), commits = [], events = [];
  let inbox;
  ({ inbox } = await openInbox({ stateDir: p.stateDir, clock: () => NOW, expectAnswers: () => ({}), onCommit: (entry) => {
    validateEntry(entry); commits.push(entry.id);
    assert.equal(inbox.get(entry.id).seq, entry.seq);
  } }));
  await inbox.setPresence('away');
  const x = questionMessage(); await ask(inbox, x);
  commits.length = 0;
  const n = questionMessage({ body: { supersedes: x.id } });
  inbox.subscribe((event) => {
    events.push(event.entry.id);
    assert.equal(inbox.get(x.id).supersededBy, n.id);
    assert.equal(inbox.get(n.id).state, 'pending');
    assert.equal(commits.includes(event.entry.id), true);
  });
  await ask(inbox, n);
  assert.deepEqual(commits, [n.id, x.id]);
  assert.deepEqual(events, [n.id, x.id]);
  const reopened = await openInbox({ stateDir: p.stateDir, clock: () => NOW });
  assert.deepEqual(reopened.rejected, []);
  assert.equal(reopened.inbox.get(x.id).state, 'withdrawn');
});
test('accepted response and native observation histories survive strict store recovery', async (t) => {
  const { inbox, open, advance } = await setup(t), q = questionMessage();
  await ask(inbox, q);
  const d = deferMessage(q); await inbox.defer(q.id, d);
  const a = answerMessage(q); await inbox.answer(q.id, a);
  await inbox.handed(q.id, HANDLE);
  advance(CONFIRM_WINDOW_MS); await inbox.sweep();
  await inbox.confirm({ harness: 'claude-code', callId: 'toolu_1', observed: { 'Which shape?': 'Circle' } });
  await inbox.confirm({ harness: 'claude-code', callId: 'toolu_1', observed: { 'Which shape?': 'Square' } });
  const withdrawn = questionMessage(); await ask(inbox, withdrawn);
  const w = withdrawalMessage(withdrawn); await inbox.withdraw(withdrawn.id, w);
  const gone = questionMessage(); await ask(inbox, gone); await inbox.askerGone(gone.id);
  const undeliverable = questionMessage(); await ask(inbox, undeliverable);
  await inbox.answer(undeliverable.id, answerMessage(undeliverable)); await inbox.askerGone(undeliverable.id);
  const reopened = await open();
  assert.deepEqual(reopened.rejected, []);
  const e = reopened.inbox.get(q.id);
  assert.equal(e.state, 'consumed');
  assert.deepEqual(e.messages.map((row) => row.message), [d, a]);
  assert.deepEqual(e.observations.map((row) => row.answers), [{ 'Which shape?': 'Circle' }, { 'Which shape?': 'Square' }]);
  assert.deepEqual(reopened.inbox.get(withdrawn.id).messages.map((row) => row.message), [w]);
  assert.equal(reopened.inbox.get(gone.id).state, 'withdrawn');
  assert.equal(reopened.inbox.get(undeliverable.id).state, 'undeliverable');
  for (const entry of reopened.inbox.list({ since: 0 })) validateEntry(entry);
});
test('expiry is applied before defer, withdraw, askerGone and seen writes', async (t) => {
  const { inbox, advance } = await setup(t);
  const questions = [questionMessage(), questionMessage(), questionMessage()];
  for (const q of questions) await ask(inbox, q);
  const notice = noticeMessage(); await inbox.notify(notice);
  advance(3_600_000);
  assert.equal((await inbox.defer(questions[0].id, deferMessage(questions[0]))).error.code, 'EXPIRED');
  assert.equal((await inbox.withdraw(questions[1].id, withdrawalMessage(questions[1]))).error.code, 'EXPIRED');
  assert.equal((await inbox.askerGone(questions[2].id)).entry.state, 'expired');
  const seen = (await inbox.seen(notice.id)).entry;
  assert.equal(seen.state, 'expired'); assert.equal(seen.seen, true);
  assert.deepEqual(seen.log.map((row) => row.cause), ['notice', 'expiry', 'seen']);
});
test('watch replay is ordered, state filters apply and unsubscribing ends delivery', async (t) => {
  const { inbox } = await setup(t), q = questionMessage(), n = noticeMessage();
  await ask(inbox, q); const mark = inbox.seq();
  await inbox.notify(n); await inbox.answer(q.id, answerMessage(q));
  const seen = [], w = await inbox.watch(mark, (event) => seen.push(event.entry));
  assert.deepEqual(seen.map((entry) => entry.id), [n.id, q.id]);
  assert.equal(w.seq, inbox.seq()); assert.equal(inbox.subscribers(), 1);
  assert.deepEqual((await inbox.snapshot({ states: ['answered'] })).entries.map((entry) => entry.id), [q.id]);
  w.unsubscribe(); await inbox.seen(n.id);
  assert.equal(seen.length, 2); assert.equal(inbox.subscribers(), 0);
});
test('prune deletes terminal entries after retention and keeps the sequence cursor', async (t) => {
  const { inbox, advance, open } = await setup(t), q = questionMessage();
  await ask(inbox, q); await inbox.withdraw(q.id, withdrawalMessage(q));
  const mark = inbox.seq();
  advance(RETENTION_MS - 1); assert.deepEqual(await inbox.prune(), []);
  advance(1); assert.deepEqual(await inbox.prune(), [q.id]);
  assert.equal(inbox.get(q.id), null); assert.equal(inbox.seq(), mark);
  assert.equal((await open()).inbox.seq(), mark);
});
test('a presence write failure halts queued operations without publishing an update', async (t) => {
  const p = await tempState(t), events = [];
  let fail = false;
  const io = { ...fs, rename: async (from, to) => {
    if (fail && to.endsWith('presence.json')) throw Object.assign(new Error('disk'), { code: 'EIO' });
    return fs.rename(from, to);
  } };
  const { inbox } = await openInbox({ stateDir: p.stateDir, clock: () => NOW, io });
  inbox.subscribe((event) => events.push(event)); fail = true;
  const updating = inbox.setPresence('away'), queued = inbox.snapshot();
  await assert.rejects(updating, { code: 'STORE_FAILED' });
  await assert.rejects(queued, { code: 'STORE_FAILED' });
  await assert.rejects(inbox.idle(), { code: 'STORE_FAILED' });
  assert.equal((await inbox.halted).code, 'STORE_FAILED');
  assert.equal(inbox.presence().mode, 'here'); assert.deepEqual(events, []);
});

for (const kind of ['question', 'notice']) for (const lateness of [0, 1]) {
  test(`new ${kind} at expiry plus ${lateness}ms is published expired and reopens intact`, async (t) => {
    const { inbox, open } = await setup(t), events = [];
    inbox.subscribe((event) => events.push(event.entry));
    const message = kind === 'question'
      ? questionMessage({ body: { expiresAt: NOW - lateness } })
      : noticeMessage({ body: { expiresAt: NOW - lateness, title: 'Done', text: 'All green', level: 'info' } });
    const result = kind === 'question' ? await ask(inbox, message) : await inbox.notify(message);
    assert.equal(result.error, null); assert.equal(result.entry.state, 'expired');
    assert.deepEqual(events.map((entry) => entry.state), ['expired']);
    assert.deepEqual(result.entry.log.map((row) => row.cause), [kind, 'expiry']);
    assert.equal(result.entry.log.every((row) => row.seq === result.entry.seq && row.at === NOW), true);
    validateEntry(result.entry);
    assert.deepEqual((await inbox.snapshot()).entries, []);
    const reopened = await open();
    assert.deepEqual(reopened.rejected, []);
    assert.deepEqual(reopened.inbox.get(message.id), result.entry);
  });
}
test('expired superseding question preserves the predecessor without publication or allocation', async (t) => {
  const { inbox, open } = await setup(t), q = questionMessage(), events = [];
  const original = (await ask(inbox, q)).entry, mark = inbox.seq();
  inbox.subscribe((event) => events.push(event));
  const expired = questionMessage({ body: { expiresAt: NOW, supersedes: q.id } });
  const result = await ask(inbox, expired);
  assert.deepEqual(result, { entry: null, error: { code: 'EXPIRED' } });
  assert.deepEqual(inbox.get(q.id), original); assert.equal(inbox.get(expired.id), null);
  assert.equal(inbox.seq(), mark); assert.deepEqual(events, []);
  const reopened = await open();
  assert.deepEqual(reopened.rejected, []); assert.deepEqual(reopened.inbox.get(q.id), original);
  assert.equal(reopened.inbox.get(expired.id), null); assert.equal(reopened.inbox.seq(), mark);
});
test('expired replacement still reports answered or ineligible predecessor first', async (t) => {
  const { inbox } = await setup(t), q = questionMessage();
  await ask(inbox, q); const answer = answerMessage(q); await inbox.answer(q.id, answer);
  const expired = questionMessage({ body: { expiresAt: NOW, supersedes: q.id } });
  assert.deepEqual((await ask(inbox, expired)).error, { code: 'ANSWERED', answer });
  const other = questionMessage(); await ask(inbox, other);
  const wrongAsker = questionMessage({ from: { kind: 'agent', agentId: 'codex:z' }, body: { expiresAt: NOW, supersedes: other.id } });
  assert.equal((await ask(inbox, wrongAsker)).error.code, 'NOT_SUPERSEDABLE');
});
test('answer uses one operation timestamp when clock readings would cross expiry', async (t) => {
  const p = await tempState(t), expiresAt = NOW + 100;
  let crossing = false, reads = 0;
  const clock = () => crossing ? expiresAt - 1 + reads++ : NOW;
  const { inbox } = await openInbox({ stateDir: p.stateDir, clock, expectAnswers: () => ({}) });
  await inbox.setPresence('away');
  const q = questionMessage({ body: { expiresAt } }); await ask(inbox, q);
  crossing = true;
  const result = await inbox.answer(q.id, answerMessage(q));
  assert.equal(result.error, null); assert.equal(result.entry.state, 'answered');
  assert.equal(result.entry.updatedAt, expiresAt - 1);
  assert.equal(result.entry.messages[0].at, expiresAt - 1);
  assert.equal(result.entry.log.at(-1).at, expiresAt - 1);
  assert.equal(reads, 1); validateEntry(result.entry);
});
test('sweep uses the same timestamp for every entry when the clock crosses expiry', async (t) => {
  const p = await tempState(t), expiresAt = NOW + 100;
  let crossing = false, reads = 0;
  const clock = () => crossing ? expiresAt - 1 + reads++ : NOW;
  const { inbox } = await openInbox({ stateDir: p.stateDir, clock });
  await inbox.setPresence('away');
  const a = questionMessage({ body: { expiresAt } }), b = questionMessage({ body: { expiresAt } });
  await ask(inbox, a); await ask(inbox, b);
  crossing = true; await inbox.sweep();
  assert.deepEqual([inbox.get(a.id).state, inbox.get(b.id).state], ['pending', 'pending']);
  assert.equal(reads, 1);
});
