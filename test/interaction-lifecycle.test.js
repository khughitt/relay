import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/interaction/lifecycle.js';
import { questionMessage, answerMessage, deferMessage, withdrawalMessage, noticeMessage, HANDLE, OTHER_HANDLE, NOW } from './helpers/interaction.js';

const T = NOW + 5000;
const fresh = (opts = {}) => { const q = questionMessage(opts.question); return { q, e: L.createEntry(q, { handback: opts.handback ?? false, waiter: HANDLE, now: NOW }) }; };
const step = (r) => { assert.equal(r.error, null, JSON.stringify(r.error)); return r.entry; };
const refused = (r, code) => { assert.equal(r.changed, false); assert.equal(r.error?.code, code); return r; };
const answered = () => { const { q, e } = fresh(); const a = answerMessage(q); return { q, a, e: step(L.applyAnswer(e, a, T)) }; };
const handed = () => { const s = answered(); return { ...s, e: step(L.applyHanded(s.e, HANDLE, T)) }; };

test('a new entry is pending in the inbox with one log row', () => {
  const { e } = fresh();
  assert.equal(e.state, 'pending'); assert.equal(e.presentation, 'inbox');
  assert.deepEqual(e.log, [{ seq: null, at: NOW, state: 'pending', cause: 'question' }]);
  assert.deepEqual(L.validateEntry({ ...e, seq: 1, log: [{ ...e.log[0], seq: 1 }] }).id, e.id);
});
test('first answer saves; same answerId replays in every answer-holding state', () => {
  const { a, e } = answered();
  assert.equal(e.state, 'answered'); assert.deepEqual(e.answer, a);
  const h = step(L.applyHanded(e, HANDLE, T));
  const later = { consumed: step(L.applyConfirm(h, { matches: true, observed: {} }, T)), unconfirmed: step(L.applyClock(h, T + L.CONFIRM_WINDOW_MS)),
    undeliverable: step(L.applyAskerGone(e, T)), answered: e, handed: h };
  for (const [state, entry] of Object.entries(later)) {
    assert.equal(entry.state, state);
    const r = L.applyAnswer(entry, a, T + 9); assert.equal(r.error, null); assert.equal(r.changed, false);
  }
});
test('a second answerId gets ALREADY_ANSWERED with the winner', () => {
  const { q, a, e } = answered();
  assert.deepEqual(refused(L.applyAnswer(e, answerMessage(q), T), 'ALREADY_ANSWERED').error.answer, a);
  refused(L.applyAnswer(step(L.applyAskerGone(e, T)), answerMessage(q), T), 'ALREADY_ANSWERED');
});
test('answers to closed entries name the closure', () => {
  const { q, e } = fresh({ handback: true });
  refused(L.applyAnswer(step(L.applyDefer(e, deferMessage(q), T)), answerMessage(q), T), 'RELEASED');
  refused(L.applyAnswer(step(L.applyWithdraw(e, withdrawalMessage(q), T)), answerMessage(q), T), 'WITHDRAWN');
  refused(L.applyAnswer(step(L.applyClock(e, q.body.expiresAt)), answerMessage(q), T), 'EXPIRED');
});
test('validation and revision run after the state checks, in that order', () => {
  const { q, e } = fresh({ question: { body: { class: 'artifact-review', artifact: { ref: 'a', revision: 'r1' } } } });
  refused(L.applyAnswer(e, answerMessage(q, { values: {} , artifactRevision: 'r0' }), T), 'INVALID_ANSWER');
  assert.equal(refused(L.applyAnswer(e, answerMessage(q, { artifactRevision: 'r0' }), T), 'STALE').error.revision, 'r1');
  assert.equal(step(L.applyAnswer(e, answerMessage(q, { artifactRevision: 'r1' }), T)).state, 'answered');
});
test('authorization questions take an answer only from a local surface', () => {
  const { q, e } = fresh({ question: { body: { class: 'authorization' } } });
  refused(L.applyAnswer(e, answerMessage(q, { surface: 'phone' }), T), 'LOCAL_ONLY');
  assert.equal(step(L.applyAnswer(e, answerMessage(q, { surface: 'phone', outcome: 'declined', values: {} }), T)).state, 'answered');
  assert.equal(step(L.applyAnswer(e, answerMessage(q, { surface: 'desktop' }), T)).state, 'answered');
});
test('defer: release with handback, desktop presentation without', () => {
  const back = fresh({ handback: true }), stay = fresh();
  assert.equal(step(L.applyDefer(back.e, deferMessage(back.q), T)).state, 'released');
  const d = step(L.applyDefer(stay.e, deferMessage(stay.q), T));
  assert.deepEqual([d.state, d.presentation], ['pending', 'desktop']);
  const second = deferMessage(stay.q);
  const d2 = step(L.applyDefer(d, second, T + 1));
  assert.equal(d2.messages.length, 2);
  assert.equal(L.applyDefer(d2, second, T + 2).changed, false);
  const { q, e } = answered();
  refused(L.applyDefer(e, deferMessage(q), T), 'ALREADY_ANSWERED');
});
test('withdrawal: pending withdraws, answered returns ANSWERED with the answer', () => {
  const { q, e } = fresh();
  const w = step(L.applyWithdraw(e, withdrawalMessage(q), T));
  assert.deepEqual([w.state, w.withdrawal], ['withdrawn', { reason: 'user' }]);
  const s = answered();
  assert.deepEqual(refused(L.applyWithdraw(s.e, withdrawalMessage(s.q), T), 'ANSWERED').error.answer, s.a);
});
test('handed: only the recorded waiter, idempotent, refused before an answer', () => {
  const { e } = fresh();
  refused(L.applyHanded(e, HANDLE, T), 'NOT_ANSWERED');
  const s = answered();
  refused(L.applyHanded(s.e, OTHER_HANDLE, T), 'NOT_WAITER');
  const h = step(L.applyHanded(s.e, HANDLE, T));
  assert.deepEqual([h.state, h.handedAt], ['handed', T]);
  assert.equal(L.applyHanded(h, HANDLE, T + 1).changed, false);
  const u = step(L.applyClock(h, T + L.CONFIRM_WINDOW_MS));
  assert.equal(u.state, 'unconfirmed');
  const again = L.applyHanded(u, HANDLE, T + L.CONFIRM_WINDOW_MS + 1);
  assert.deepEqual([again.changed, again.error], [false, null]);
  refused(L.applyHanded(u, OTHER_HANDLE, T), 'NOT_WAITER');
});
test('confirmation: match consumes, mismatch is unconfirmed, late match still consumes', () => {
  const { e } = handed();
  assert.equal(step(L.applyConfirm(e, { matches: true, observed: { a: 'one' } }, T)).state, 'consumed');
  const m = step(L.applyConfirm(e, { matches: false, observed: { a: 'two' } }, T));
  assert.deepEqual([m.state, m.observed], ['unconfirmed', { a: 'two' }]);
  const late = step(L.applyClock(e, T + L.CONFIRM_WINDOW_MS));
  assert.equal(step(L.applyConfirm(late, { matches: true, observed: {} }, T + 70000)).state, 'consumed');
  refused(L.applyConfirm(answered().e, { matches: true, observed: {} }, T), 'NOT_HANDED');
});
test('a native answer after release or expiry is history only', () => {
  const { q, e } = fresh({ handback: true });
  const r = step(L.applyDefer(e, deferMessage(q), T));
  const c = step(L.applyConfirm(r, { matches: false, observed: { 'Which shape?': 'Circle' } }, T + 1));
  assert.deepEqual([c.state, c.observed], ['released', { 'Which shape?': 'Circle' }]);
});
test('asker gone: pending withdraws, answered is undeliverable, later states keep', () => {
  const p = step(L.applyAskerGone(fresh().e, T));
  assert.deepEqual([p.state, p.withdrawal], ['withdrawn', { reason: 'asker-gone' }]);
  assert.equal(step(L.applyAskerGone(answered().e, T)).state, 'undeliverable');
  assert.equal(L.applyAskerGone(handed().e, T).changed, false);
});
test('supersession checks the asker, the state, and reports an answer', () => {
  const { q, e } = fresh();
  const next = questionMessage({ body: { supersedes: q.id } });
  assert.equal(L.checkSupersede(e, next), null);
  assert.deepEqual(L.checkSupersede(null, next), { code: 'NOT_SUPERSEDABLE' });
  assert.deepEqual(L.checkSupersede(e, { ...next, from: { kind: 'agent', agentId: 'codex:x' } }), { code: 'NOT_SUPERSEDABLE' });
  const s = answered();
  assert.equal(L.checkSupersede(s.e, next).code, 'ANSWERED');
  const w = step(L.applySuperseded(e, next.id, T));
  assert.deepEqual([w.state, w.withdrawal, w.supersededBy], ['withdrawn', { reason: 'superseded' }, next.id]);
});
test('clock: expiry, window, deadlines, notices', () => {
  const { q, e } = fresh();
  assert.equal(L.applyClock(e, q.body.expiresAt - 1).changed, false);
  assert.equal(L.nextDeadline(e), q.body.expiresAt);
  assert.equal(L.nextDeadline(handed().e), T + L.CONFIRM_WINDOW_MS);
  assert.equal(L.nextDeadline(answered().e), null);
  const n = L.createNotice(noticeMessage(), { now: NOW });
  assert.equal(n.state, 'active'); assert.equal(L.isTerminal(n), false);
  const x = step(L.applyClock(n, n.notice.body.expiresAt));
  assert.equal(x.state, 'expired'); assert.equal(L.isTerminal(x), true);
  assert.equal(step(L.applySeen(n, T)).seen, true);
});
test('validateEntry rejects inconsistent entries', () => {
  const { e } = answered();
  const stamped = { ...e, seq: 2, log: e.log.map((l, i) => ({ ...l, seq: i + 1 })) };
  assert.equal(L.validateEntry(stamped).state, 'answered');
  for (const broken of [{ ...stamped, state: 'lost' }, { ...stamped, answer: null }, { ...stamped, seq: 0 }, { ...stamped, schema: 2 }, { ...stamped, id: 'x' }]) {
    assert.throws(() => L.validateEntry(broken), { code: 'INVALID_ENTRY' });
  }
});

const stamped = (entry) => ({ ...entry, seq: entry.log.length, log: entry.log.map((l, i) => ({ ...l, seq: i + 1 })) });
const roundtrip = (entry) => L.validateEntry(JSON.parse(JSON.stringify(stamped(entry))));

test('accepted envelopes survive roundtrip and exact retries do not duplicate history', () => {
  const { q, e } = fresh();
  const defer = deferMessage(q);
  const deferred = step(L.applyDefer(e, defer, T));
  assert.deepEqual(roundtrip(deferred).messages, [{ at: T, message: defer }]);
  assert.equal(L.applyDefer(deferred, defer, T + 1).changed, false);
  const answer = answerMessage(q);
  const saved = step(L.applyAnswer(deferred, answer, T + 2));
  assert.deepEqual(roundtrip(saved).messages, [{ at: T, message: defer }, { at: T + 2, message: answer }]);
  assert.equal(L.applyAnswer(saved, answer, T + 3).entry, saved);
  const withdrawal = withdrawalMessage(q);
  const withdrawn = step(L.applyWithdraw(e, withdrawal, T));
  assert.deepEqual(roundtrip(withdrawn).messages, [{ at: T, message: withdrawal }]);
  refused(L.applyWithdraw(withdrawn, withdrawal, T + 1), 'WITHDRAWN');
  assert.deepEqual(e.messages, []);
  assert.equal(e.state, 'pending');
});

test('native confirmations preserve each terminal observation with its surface and time', () => {
  for (const state of ['released', 'expired']) {
    const { q, e } = fresh({ handback: true });
    const closed = state === 'released' ? step(L.applyDefer(e, deferMessage(q), T)) : step(L.applyClock(e, q.body.expiresAt));
    const first = { 'Which shape?': 'Circle' }, second = { 'Which shape?': 'Square' };
    const native = step(L.applyConfirm(closed, { matches: false, observed: first }, T + 1));
    assert.deepEqual(native.observations, [{ at: T + 1, surface: 'terminal', answers: first }]);
    assert.equal(L.applyConfirm(native, { matches: false, observed: first }, T + 2).changed, false);
    const later = step(L.applyConfirm(native, { matches: false, observed: second }, T + 3));
    assert.deepEqual(roundtrip(later).observations, [
      { at: T + 1, surface: 'terminal', answers: first }, { at: T + 3, surface: 'terminal', answers: second },
    ]);
    assert.deepEqual(later.observed, second);
    assert.equal(later.state, state);
    assert.equal(later.handedAt, null);
    assert.deepEqual(later.messages, closed.messages);
  }
});

test('generated observations never fabricate sender messages', () => {
  const { e } = fresh();
  for (const result of [L.applyAskerGone(e, T), L.applyClock(e, e.question.body.expiresAt), L.applySuperseded(e, questionMessage().id, T)]) {
    assert.deepEqual(roundtrip(result.entry).messages, []);
    assert.deepEqual(result.entry.observations, []);
  }
});

test('validation rejects malformed histories, correlations and latest observations', () => {
  const { q, e } = fresh();
  const a = answerMessage(q), saved = stamped(step(L.applyAnswer(e, a, T)));
  const native = stamped(step(L.applyConfirm(step(L.applyClock(e, q.body.expiresAt)), { matches: false, observed: { Shape: 'Square' } }, T)));
  for (const broken of [
    { ...saved, messages: null },
    { ...saved, messages: [] },
    { ...saved, messages: [{ at: -1, message: a }] },
    { ...saved, messages: [{ at: T, message: { ...a, correlationId: questionMessage().id } }] },
    { ...saved, messages: [{ at: T, message: q }] },
    { ...saved, messages: [{ at: T, message: { ...a, rawPayload: 'secret' } }] },
    { ...saved, messages: [...saved.messages, ...saved.messages] },
    { ...saved, observations: [{ at: T, surface: 'phone', answers: {} }] },
    { ...native, observed: { Shape: 'Circle' } },
    { ...native, observations: [{ at: T, surface: 'terminal', answers: { Shape: { raw: 'payload' } } }] },
    { ...native, observations: [{ at: -1, surface: 'terminal', answers: {} }] },
  ]) assert.throws(() => L.validateEntry(broken), { code: 'INVALID_ENTRY' });
});

test('validation rejects extra question, notice, route and log fields', () => {
  const question = stamped(fresh().e), notice = stamped(L.createNotice(noticeMessage(), { now: NOW }));
  for (const clean of [question, notice]) {
    assert.deepEqual(L.validateEntry(clean), clean);
    for (const broken of [
      { ...clean, rawHarnessPayload: { transcript: 'private text' } },
      { ...clean, log: clean.log.map((row) => ({ ...row, environment: { TOKEN: 'secret' } })) },
    ]) assert.throws(() => L.validateEntry(broken), { code: 'INVALID_ENTRY' });
  }
  assert.throws(() => L.validateEntry({ ...question, route: { ...question.route, environment: { TOKEN: 'secret' } } }), { code: 'INVALID_ENTRY' });
  assert.throws(() => L.validateEntry({ ...question, route: { ...question.route,
    waiter: { ...question.route.waiter, environment: { TOKEN: 'secret' } } } }), { code: 'INVALID_ENTRY' });
  assert.throws(() => L.validateEntry({ ...notice, route: question.route }), { code: 'INVALID_ENTRY' });
  assert.throws(() => L.validateEntry({ ...question, seen: false }), { code: 'INVALID_ENTRY' });
});

test('every lifecycle state validates after persistence without losing history', () => {
  const { q, e } = fresh(), a = answerMessage(q);
  const saved = step(L.applyAnswer(e, a, T));
  const hand = step(L.applyHanded(saved, HANDLE, T));
  const entries = [e, saved, hand,
    step(L.applyConfirm(hand, { matches: true, observed: { Shape: 'Square' } }, T + 1)),
    step(L.applyConfirm(hand, { matches: false, observed: { Shape: 'Circle' } }, T + 1)),
    step(L.applyClock(hand, T + L.CONFIRM_WINDOW_MS)),
    step(L.applyAskerGone(saved, T)),
    step(L.applyWithdraw(e, withdrawalMessage(q), T)),
    step(L.applyClock(e, q.body.expiresAt))];
  const release = fresh({ handback: true });
  entries.push(step(L.applyDefer(release.e, deferMessage(release.q), T)));
  for (const entry of entries) assert.deepEqual(roundtrip(entry), stamped(entry));
  const notice = L.createNotice(noticeMessage(), { now: NOW });
  for (const entry of [notice, step(L.applySeen(notice, T)), step(L.applyClock(notice, notice.notice.body.expiresAt))]) {
    assert.deepEqual(roundtrip(entry), stamped(entry));
  }
});

test('history validation rejects missing or fabricated transition evidence', () => {
  const { q, e } = fresh();
  const deferred = stamped(step(L.applyDefer(e, deferMessage(q), T)));
  const expired = step(L.applyClock(e, q.body.expiresAt));
  const native = stamped(step(L.applyConfirm(expired, { matches: false, observed: {} }, T)));
  for (const broken of [
    { ...deferred, messages: [] },
    { ...deferred, messages: [...deferred.messages, { at: T, message: deferMessage(q) }] },
    { ...native, observations: [] , observed: null },
    { ...native, observations: [...native.observations, ...native.observations] },
  ]) assert.throws(() => L.validateEntry(broken), { code: 'INVALID_ENTRY' });
});

test('derived persisted states require legal cause and state evidence', () => {
  const saved = stamped(answered().e);
  for (const [state, cause] of [['consumed', 'answer'], ['handed', 'answer'], ['unconfirmed', 'answer'], ['undeliverable', 'answer']]) {
    const forged = { ...saved, state, handedAt: ['handed', 'consumed', 'unconfirmed'].includes(state) ? T : null,
      log: saved.log.map((l, i) => i === saved.log.length - 1 ? { ...l, state, cause } : l) };
    assert.throws(() => L.validateEntry(forged), { code: 'INVALID_ENTRY' });
  }
  const consumed = stamped(step(L.applyConfirm(handed().e, { matches: true, observed: {} }, T + 1)));
  const missingHand = { ...consumed, log: consumed.log.filter((l) => l.cause !== 'handed') };
  const unsuccessful = { ...consumed, log: consumed.log.map((l) => l.cause === 'confirm' ? { ...l, cause: 'confirm-mismatch' } : l) };
  const wrongHandTime = { ...consumed, handedAt: T + 1 };
  const noObservation = { ...consumed, observed: null, observations: [] };
  const pending = stamped(fresh().e);
  const released = { ...pending, state: 'released', log: [{ ...pending.log[0], state: 'released' }] };
  const expired = { ...pending, state: 'expired', log: [{ ...pending.log[0], state: 'expired' }] };
  const withdrawn = { ...pending, state: 'withdrawn', withdrawal: { reason: 'user' }, log: [{ ...pending.log[0], state: 'withdrawn' }] };
  const window = stamped(step(L.applyClock(handed().e, T + L.CONFIRM_WINDOW_MS)));
  const earlyWindow = { ...window, updatedAt: T + 1, log: window.log.map((l) => l.cause === 'window' ? { ...l, at: T + 1 } : l) };
  const notice = stamped(L.createNotice(noticeMessage(), { now: NOW }));
  const expiredNotice = { ...notice, state: 'expired', log: [{ ...notice.log[0], state: 'expired' }] };
  for (const broken of [missingHand, unsuccessful, wrongHandTime, noObservation, released, expired, withdrawn, earlyWindow, expiredNotice]) {
    assert.throws(() => L.validateEntry(broken), { code: 'INVALID_ENTRY' });
  }
});

test('sender withdrawals with special reasons always require their accepted envelopes', () => {
  for (const reason of ['asker-gone', 'superseded']) {
    const { q, e } = fresh();
    const result = step(L.applyWithdraw(e, withdrawalMessage(q, reason), T));
    assert.deepEqual(roundtrip(result), stamped(result));
    assert.throws(() => L.validateEntry({ ...stamped(result), messages: [] }), { code: 'INVALID_ENTRY' });
  }
});

test('conflicting accepted envelope IDs are refused without changing the entry', () => {
  const { q, e } = fresh();
  for (const [apply, make] of [[L.applyDefer, deferMessage], [L.applyAnswer, answerMessage], [L.applyWithdraw, withdrawalMessage]]) {
    const originalCollision = refused(apply(e, { ...make(q), id: q.id }, T), 'ID_CONFLICT');
    assert.equal(originalCollision.entry, e);
    const defer = deferMessage(q), deferred = step(L.applyDefer(e, defer, T));
    assert.deepEqual(roundtrip(deferred), stamped(deferred));
    const historyCollision = refused(apply(deferred, { ...make(q), id: defer.id, createdAt: T + 1 }, T + 1), 'ID_CONFLICT');
    assert.equal(historyCollision.entry, deferred);
  }
  const defer = deferMessage(q), deferred = step(L.applyDefer(e, defer, T));
  const altered = { ...defer, body: { surface: 'desktop' } };
  assert.equal(refused(L.applyDefer(deferred, altered, T + 1), 'ID_CONFLICT').entry, deferred);
  assert.equal(L.applyDefer(deferred, defer, T + 1).changed, false);
  const answer = answerMessage(q), saved = step(L.applyAnswer(deferred, answer, T + 1));
  assert.deepEqual(roundtrip(saved), stamped(saved));
  assert.equal(L.applyAnswer(saved, { ...answer, id: q.id }, T + 2).changed, false);
  refused(L.applyAnswer(saved, { ...answerMessage(q), id: q.id }, T + 2), 'ALREADY_ANSWERED');
  refused(L.applyWithdraw(saved, { ...withdrawalMessage(q), id: q.id }, T + 2), 'ANSWERED');
  refused(L.applyDefer(saved, { ...deferMessage(q), id: q.id }, T + 2), 'ALREADY_ANSWERED');
  refused(L.applyAnswer(e, { ...answerMessage(q, { values: {} }), id: q.id }, T), 'INVALID_ANSWER');
});
