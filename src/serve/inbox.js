import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { relayError } from '../protocol.js';
import { readJson } from '../bus/store.js';
import { loadStore, writeDurable } from '../interaction/store.js';
import * as L from '../interaction/lifecycle.js';
// The service's inbox (spec §5-§6, §8): every operation runs one at a time on a promise chain,
// the clock is applied to an entry before any write to it, and listeners hear each persisted
// change after the store has it.
const MODES = ['here', 'away'];
export async function openInbox({ stateDir, clock = Date.now, io = fs, expectAnswers, onCommit = () => {} }) {
  const { store, rejected } = await loadStore(stateDir, { io, now: clock() });
  const presencePath = join(stateDir, 'presence.json');
  const saved = await readJson(presencePath, { io });
  if (saved !== undefined && !(saved?.schema === 1 && MODES.includes(saved.mode) && Number.isSafeInteger(saved.updatedAt) && saved.updatedAt >= 0)) throw relayError('CORRUPT_STATE', 'invalid presence file');
  let presence = saved ? { mode: saved.mode, updatedAt: saved.updatedAt } : { mode: 'here', updatedAt: 0 };
  const listeners = new Set();
  // Fail-stop: after any failed write the in-memory state may disagree with the disk (a
  // replacement saved, its predecessor not yet withdrawn). Nothing more is served; the service
  // exits on `halted`, and the next start reconciles from disk before accepting a request.
  let failure = null;
  const halted = Promise.withResolvers();
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(() => { if (failure) throw failure; return fn(clock()); });
    chain = run.catch(() => {});
    return run;
  };
  async function persist(write) {
    try { return await write(); }
    catch (cause) { failure = relayError('STORE_FAILED', 'an inbox write failed; relay serve must restart', cause); halted.resolve(failure); throw failure; }
  }
  const publish = (event) => { for (const fn of listeners) fn(event); };
  async function commit(result) {
    if (!result.changed) return { entry: result.entry, error: result.error };
    const entry = await persist(() => store.put(result.entry));
    onCommit(entry); publish({ type: 'entry', entry });
    return { entry, error: result.error };
  }
  const list = ({ since, states } = {}) => store.all().filter((e) => (!L.isTerminal(e) || (since !== undefined && e.seq > since)) && (!states || states.includes(e.state)));
  async function current(id, now) {
    const entry = store.get(id);
    return entry ? (await commit(L.applyClock(entry, now))).entry : null;
  }
  const on = (id, fn) => serial(async (now) => {
    const entry = await current(id, now);
    return entry ? commit(fn(entry, now)) : { entry: null, error: { code: 'NOT_FOUND' } };
  });
  const inbox = {
    ask: (message, { handback, waiter }) => serial(async (now) => {
      const existing = await current(message.id, now);
      if (existing) return existing.kind === 'question' && isDeepStrictEqual(existing.question, message)
        ? { entry: existing, error: null } : { entry: existing, error: { code: 'ID_CONFLICT' } };
      if (presence.mode === 'here') return { passthrough: true };
      const entry = L.applyClock(L.createEntry(message, { handback, waiter, now }), now).entry;
      const x = message.body.supersedes;
      if (x === null) return commit({ entry, changed: true, error: null });
      if (entry.state === 'expired') {
        const saved = store.get(x), predecessor = saved ? L.applyClock(saved, now).entry : null;
        return { entry: null, error: L.checkSupersede(predecessor, message) ?? { code: 'EXPIRED' } };
      }
      const predecessor = await current(x, now), refusal = L.checkSupersede(predecessor, message);
      if (refusal) return { entry: null, error: refusal };
      const [n, w] = await persist(() => store.supersede(entry, L.applySuperseded(predecessor, entry.id, now).entry));
      for (const e of [n, w]) { onCommit(e); publish({ type: 'entry', entry: e }); }
      return { entry: n, error: null };
    }),
    answer: (id, message) => on(id, (e, now) => e.kind === 'question' ? L.applyAnswer(e, message, now) : { entry: e, changed: false, error: { code: 'NOT_A_QUESTION' } }),
    defer: (id, message) => on(id, (e, now) => e.kind === 'question' ? L.applyDefer(e, message, now) : { entry: e, changed: false, error: { code: 'NOT_A_QUESTION' } }),
    withdraw: (id, message) => on(id, (e, now) => e.kind === 'question' ? L.applyWithdraw(e, message, now) : { entry: e, changed: false, error: { code: 'NOT_A_QUESTION' } }),
    handed: (id, waiter) => on(id, (e, now) => L.applyHanded(e, waiter, now)),
    askerGone: (id) => on(id, (e, now) => L.applyAskerGone(e, now)),
    seen: (id) => on(id, (e, now) => L.applySeen(e, now)),
    confirm: ({ harness, callId, observed }) => serial(async (now) => {
      const found = store.all().find((e) => e.kind === 'question' && e.question.body.native?.harness === harness && e.question.body.native.callId === callId);
      if (!found) return { entry: null, error: { code: 'NOT_FOUND' } };
      const e = await current(found.id, now);
      const matches = e.answer !== null && isDeepStrictEqual(expectAnswers(e), observed);
      return commit(L.applyConfirm(e, { matches, observed }, now));
    }),
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
    get: (id) => store.get(id),
    seq: () => store.seq(),
    snapshot: ({ since, states } = {}) => serial(() => ({ seq: store.seq(), entries: list({ since, states }) })),
    // Replays the entries changed after `since` through fn, then subscribes fn, in one queued
    // step: nothing published in between is lost or reordered.
    watch: (since, fn) => serial(() => {
      for (const entry of list({ since }).filter((e) => e.seq > since)) fn({ type: 'entry', entry });
      listeners.add(fn);
      return { seq: store.seq(), unsubscribe: () => listeners.delete(fn) };
    }),
    halted: halted.promise,
    subscribers: () => listeners.size, // diagnostic: tests assert no listener outlives its client
    presence: () => presence,
    setPresence: (mode) => serial(async (now) => {
      if (!MODES.includes(mode)) throw relayError('INVALID_INPUT', `presence must be here or away, got ${JSON.stringify(mode)}`);
      const next = { mode, updatedAt: now };
      await persist(() => writeDurable(presencePath, `${JSON.stringify({ schema: 1, ...next })}\n`, { io }));
      presence = next; publish({ type: 'presence', presence });
      return presence;
    }),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    idle: () => serial(async () => {}),
  };
  await inbox.sweep();
  return { inbox, rejected };
}
