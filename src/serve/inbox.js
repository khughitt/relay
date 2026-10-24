// @ts-check
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { relayError } from '../protocol.js';
import { readJson } from '../bus/store.js';
import { loadStore, writeDurable } from '../interaction/store.js';
import * as L from '../interaction/lifecycle.js';
import { expiryLimit } from '../routes/index.js';
// The service's inbox (spec §5-§6, §8): every operation runs one at a time on a promise chain,
// the clock is applied to an entry before any write to it, and listeners hear each persisted
// change after the store has it.
const MODES = ['here', 'away'];
// Spec §5.4: an asker's own expiry is lowered to createdAt plus its route's maximum. The clamp
// depends on the message alone, so an identical resend clamps to the stored question and reattaches.
/** @param {import("../types.js").QuestionMessage} message */
function bounded(message) {
  const latest = message.createdAt + expiryLimit(message);
  return message.body.expiresAt <= latest ? message : { ...message, body: { ...message.body, expiresAt: latest } };
}
// A cursor or state filter a client sends is refused when invalid, never widened to everything.
const ENTRY_STATES = Object.freeze([...new Set([...L.QUESTION_STATES, 'active', 'expired'])]);
/** @param {number} v */
const isCursor = (v) => Number.isSafeInteger(v) && v >= 0;
/** @param {{since?: number, states?: string[]}} selection */
function checkSelection({ since, states }) {
  if (since !== undefined && !isCursor(since)) throw relayError('INVALID_INPUT', 'since must be a nonnegative sequence');
  if (states !== undefined && !(Array.isArray(states) && states.every((state) => ENTRY_STATES.includes(state)))) {
    throw relayError('INVALID_INPUT', `states must be an array of entry states (${ENTRY_STATES.join(', ')})`);
  }
}
/** @param {{stateDir: string, clock?: () => number, io?: typeof fs, expectAnswers: typeof import("../routes/index.js").expectAnswers, onCommit?: (entry: import("../types.js").Entry) => void}} options */
export async function openInbox({ stateDir, clock = Date.now, io = fs, expectAnswers, onCommit = () => {} }) {
  const { store, rejected } = await loadStore(stateDir, { io, now: clock() });
  const presencePath = join(stateDir, 'presence.json');
  const saved = await readJson(presencePath, { io });
  if (saved !== undefined && !(saved?.schema === 1 && MODES.includes(saved.mode) && Number.isSafeInteger(saved.updatedAt) && saved.updatedAt >= 0)) throw relayError('CORRUPT_STATE', 'invalid presence file');
  let presence = saved ? { mode: saved.mode, updatedAt: saved.updatedAt } : { mode: 'here', updatedAt: 0 };
/** @type {Set<(event: import("../types.js").InboxEvent) => void>} */
  /** @param {{since?: number, states?: string[]}} [selection] */
  const listeners = new Set();
  // Fail-stop: after any failed write the in-memory state may disagree with the disk (a
  // replacement saved, its predecessor not yet withdrawn). Nothing more is served; the service
  // exits on `halted`, and the next start reconciles from disk before accepting a request.
  let failure = /** @type {Error|null} */ (null);
  /** @type {PromiseWithResolvers<Error>} */
  const halted = Promise.withResolvers();
  /** @type {Promise<unknown>} */
  let chain = Promise.resolve();
  /** @template T @param {(now: number) => T|Promise<T>} fn @returns {Promise<T>} */
  const serial = (fn) => {
    const run = chain.then(() => { if (failure) throw failure; return fn(clock()); });
    chain = run.catch(() => {});
    return run;
  };
  /** @template T @param {() => Promise<T>} write */
  async function persist(write) {
    try { return await write(); }
    catch (cause) { failure = relayError('STORE_FAILED', 'an inbox write failed; relay serve must restart', cause); halted.resolve(failure); throw failure; }
  }
  /** @param {import("../types.js").InboxEvent} event */
  const publish = (event) => { for (const fn of listeners) fn(event); };
  /** @param {import("../types.js").Result} result */
  async function commit(result) {
    if (!result.changed) return { entry: result.entry, error: result.error };
    const entry = await persist(() => store.put(result.entry));
    onCommit(entry); publish({ type: 'entry', entry });
    return { entry, error: result.error };
  }
  const list = (/** @type {{since?: number, states?: string[]}} */ { since, states } = {}) => store.all().filter((e) => (!L.isTerminal(e) || (since !== undefined && e.seq > since)) && (!states || states.includes(e.state)));
  /** @param {string} id @param {number} now */
  async function current(id, now) {
    const entry = store.get(id);
    return entry ? (await commit(L.applyClock(entry, now))).entry : null;
  }
  /** @param {string} id @param {(entry: import("../types.js").Entry, now: number) => import("../types.js").Result} fn */
  const on = (id, fn) => serial(async (now) => {
    const entry = await current(id, now);
    return entry ? commit(fn(entry, now)) : { entry: null, error: { code: 'NOT_FOUND' } };
  });
  const inbox = {
    /** @param {import("../types.js").QuestionMessage} message @param {{handback: boolean, waiter: import("../types.js").Handle|null}} route @returns {Promise<import("../types.js").InboxResult>} */
    ask: (message, { handback, waiter }) => serial(async (now) => {
      const detached = message.body.native === null;
      if (detached && (waiter !== null || handback !== false || message.from.kind !== 'agent' || message.to.kind !== 'user'
        || message.createdAt > now + 1000)) throw relayError('INVALID_MESSAGE', 'detached ask requires an agent sender, user recipient, null waiter, false handback, and createdAt no more than one second ahead');
      const question = bounded(message);
      const existing = await current(question.id, now);
      if (existing) return existing.kind === 'question' && isDeepStrictEqual(existing.question, question)
        ? { entry: existing, error: null } : { entry: existing, error: { code: 'ID_CONFLICT' } };
      if (presence.mode === 'here' && !detached) return { passthrough: true };
      const entry = L.applyClock(L.createEntry(question, { handback, waiter, now }), now).entry;
      const x = question.body.supersedes;
      if (x === null) return commit({ entry, changed: true, error: null });
      if (entry.state === 'expired') {
        const saved = store.get(x), predecessor = saved ? L.applyClock(saved, now).entry : null;
        return { entry: null, error: L.checkSupersede(predecessor, question) ?? { code: 'EXPIRED' } };
      }
      const predecessor = await current(x, now), refusal = L.checkSupersede(predecessor, question);
      if (refusal) return { entry: null, error: refusal };
      const [n, w] = await persist(() => store.supersede(entry, L.applySuperseded(/** @type {import("../types.js").QuestionEntry} */ (predecessor), entry.id, now).entry));
      for (const e of [n, w]) { onCommit(e); publish({ type: 'entry', entry: e }); }
      return { entry: n, error: null };
    }),
    /** @param {string} id @param {import("../types.js").AnswerMessage} message */
    answer: (id, message) => on(id, (e, now) => e.kind === 'question' ? L.applyAnswer(e, message, now) : { entry: e, changed: false, error: { code: 'NOT_A_QUESTION' } }),
    /** @param {string} id @param {import("../types.js").DeferMessage} message */
    defer: (id, message) => on(id, (e, now) => e.kind === 'question' ? L.applyDefer(e, message, now) : { entry: e, changed: false, error: { code: 'NOT_A_QUESTION' } }),
    /** @param {string} id @param {import("../types.js").WithdrawalMessage} message */
    withdraw: (id, message) => on(id, (e, now) => e.kind === 'question' ? L.applyWithdraw(e, message, now) : { entry: e, changed: false, error: { code: 'NOT_A_QUESTION' } }),
    /** @param {string} id @param {import("../types.js").Handle|null} waiter */
    handed: (id, waiter) => on(id, (e, now) => L.applyHanded(/** @type {import("../types.js").QuestionEntry} */ (e), waiter, now)),
    /** @param {string} id */
    take: (id) => on(id, (e, now) => L.applyTake(e, now)),
    /** @param {string} id */
    askerGone: (id) => on(id, (e, now) => L.applyAskerGone(/** @type {import("../types.js").QuestionEntry} */ (e), now)),
    /** @param {string} id */
    seen: (id) => on(id, (e, now) => L.applySeen(e, now)),
    /** @param {{harness: string, callId: string, observed: Record<string, string>}} observation */
    confirm: ({ harness, callId, observed }) => serial(async (now) => {
      const found = store.all().find((e) => e.kind === 'question' && e.question.body.native?.harness === harness && e.question.body.native.callId === callId);
      if (!found) return { entry: null, error: { code: 'NOT_FOUND' } };
      const e = /** @type {import("../types.js").QuestionEntry} */ (await current(found.id, now));
      const matches = e.answer !== null && isDeepStrictEqual(expectAnswers(e), observed);
      return commit(L.applyConfirm(e, { matches, observed }, now));
    }),
    /** @param {import("../types.js").NoticeMessage} message */
    notify: (message) => serial(async (now) => {
      const existing = await current(message.id, now);
      if (existing) return existing.kind === 'notice' && isDeepStrictEqual(existing.notice, message)
        ? { entry: existing, error: null } : { entry: existing, error: { code: 'ID_CONFLICT' } };
      return commit({ entry: L.applyClock(L.createNotice(message, { now }), now).entry, changed: true, error: null });
    }),
    sweep: () => serial(async (now) => { for (const e of store.all()) await commit(L.applyClock(e, now)); }),
    prune: () => serial((now) => persist(() => store.prune(now))),
    nextDeadline: () => { const due = store.all().map(L.nextDeadline).filter((d) => d !== null); return due.length ? Math.min(...due) : null; },
    // Unserialized reads for internal checks; anything that hands a client a cursor uses
    // snapshot or watch, which run in the queue so no write is half done.
    list,
    /** @param {string} id */
    get: (id) => store.get(id),
    seq: () => store.seq(),
    /** @param {{since?: number, states?: string[]}} [selection] */
    snapshot: ({ since, states } = {}) => serial(() => { checkSelection({ since, states }); return { seq: store.seq(), entries: list({ since, states }) }; }),
    // Replays the entries changed after `since` through fn, then subscribes fn, in one queued
    // step: nothing published in between is lost or reordered.
    /** @param {number} since @param {(event: import("../types.js").InboxEvent) => void} fn */
    watch: (since, fn) => serial(() => {
      if (!isCursor(since)) throw relayError('INVALID_INPUT', 'since must be a nonnegative sequence');
      for (const entry of list({ since }).filter((e) => e.seq > since)) fn({ type: 'entry', entry });
      listeners.add(fn);
      return { seq: store.seq(), unsubscribe: () => listeners.delete(fn) };
    }),
    halted: halted.promise,
    subscribers: () => listeners.size, // diagnostic: tests assert no listener outlives its client
    presence: () => presence,
    /** @param {string} mode */
    setPresence: (mode) => serial(async (now) => {
      if (!MODES.includes(mode)) throw relayError('INVALID_INPUT', `presence must be here or away, got ${JSON.stringify(mode)}`);
      const next = { mode, updatedAt: now };
      await persist(() => writeDurable(presencePath, `${JSON.stringify({ schema: 1, ...next })}\n`, { io }));
      presence = next; publish({ type: 'presence', presence });
      return presence;
    }),
    /** @param {(event: import("../types.js").InboxEvent) => void} fn */
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    idle: () => serial(async () => {}),
  };
  await inbox.sweep();
  return { inbox, rejected };
}
