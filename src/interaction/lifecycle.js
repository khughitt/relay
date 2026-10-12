import { isDeepStrictEqual } from 'node:util';
import { relayError, validateHandle } from '../protocol.js';
import { checkAnswer, validateMessage, LOCAL_SURFACES, WITHDRAWAL_REASONS } from './message.js';
// The question lifecycle as pure functions (spec §5). Each returns { entry, changed, error };
// new log rows carry seq: null, which the store stamps when it persists the entry.
export const CONFIRM_WINDOW_MS = 60000;
export const QUESTION_STATES = Object.freeze(['pending', 'answered', 'handed', 'consumed', 'unconfirmed', 'undeliverable', 'released', 'withdrawn', 'expired']);
export const ANSWER_HOLDING = Object.freeze(['answered', 'handed', 'consumed', 'unconfirmed', 'undeliverable']);
const TERMINAL = ['consumed', 'unconfirmed', 'undeliverable', 'released', 'withdrawn', 'expired'];
const CLOSED = { withdrawn: 'WITHDRAWN', expired: 'EXPIRED', released: 'RELEASED', undeliverable: 'UNDELIVERABLE' };
export const isTerminal = (entry) => entry.kind === 'notice' ? entry.state === 'expired' : TERMINAL.includes(entry.state);

const keep = (entry) => ({ entry, changed: false, error: null });
const refuse = (entry, code, extra = {}) => ({ entry, changed: false, error: { code, ...extra } });
const row = (entry, now, state, cause) => [...entry.log, { seq: null, at: now, state, cause }];
const move = (entry, now, state, cause, patch = {}) => ({ entry: { ...entry, ...patch, state, updatedAt: now, log: row(entry, now, state, cause) }, changed: true, error: null });
const annotate = (entry, now, cause, patch) => ({ entry: { ...entry, ...patch, updatedAt: now, log: row(entry, now, entry.state, cause) }, changed: true, error: null });
const sameHandle = (a, b) => a !== null && b !== null && isDeepStrictEqual(a, b);
const sameParty = (a, b) => isDeepStrictEqual(a, b);
const accepted = (entry, message, now) => [...entry.messages, { at: now, message }];
const replayed = (entry, message) => entry.messages.some((row) => isDeepStrictEqual(row.message, message));

export function createEntry(question, { handback, waiter, now }) {
  return { schema: 1, id: question.id, kind: 'question', question, state: 'pending', presentation: 'inbox',
    route: { handback, waiter }, answer: null, handedAt: null, observed: null, withdrawal: null, supersededBy: null,
    messages: [], observations: [], seq: null, updatedAt: now, log: [{ seq: null, at: now, state: 'pending', cause: 'question' }] };
}
export function createNotice(notice, { now }) {
  return { schema: 1, id: notice.id, kind: 'notice', notice, state: 'active', seen: false,
    seq: null, updatedAt: now, log: [{ seq: null, at: now, state: 'active', cause: 'notice' }] };
}
export function applyAnswer(entry, message, now) {
  const body = message.body, q = entry.question.body;
  if (entry.answer !== null && entry.answer.body.answerId === body.answerId) return keep(entry);
  if (ANSWER_HOLDING.includes(entry.state)) return refuse(entry, 'ALREADY_ANSWERED', { answer: entry.answer });
  if (entry.state !== 'pending') return refuse(entry, CLOSED[entry.state]);
  try { checkAnswer(q, body); } catch (error) { return refuse(entry, 'INVALID_ANSWER', { message: error.message }); }
  if (q.class === 'authorization' && body.outcome === 'answered' && !LOCAL_SURFACES.includes(body.surface)) return refuse(entry, 'LOCAL_ONLY');
  if (q.artifact !== null && body.artifactRevision !== q.artifact.revision) return refuse(entry, 'STALE', { revision: q.artifact.revision });
  return move(entry, now, 'answered', 'answer', { answer: message, messages: accepted(entry, message, now) });
}
export function applyDefer(entry, message, now) {
  if (ANSWER_HOLDING.includes(entry.state)) return refuse(entry, 'ALREADY_ANSWERED', { answer: entry.answer });
  if (entry.state !== 'pending') return refuse(entry, CLOSED[entry.state]);
  if (replayed(entry, message)) return keep(entry);
  const messages = accepted(entry, message, now);
  if (entry.route.handback) return move(entry, now, 'released', `defer:${message.body.surface}`, { messages });
  return annotate(entry, now, `defer:${message.body.surface}`, { presentation: 'desktop', messages });
}
export function applyWithdraw(entry, message, now) {
  if (ANSWER_HOLDING.includes(entry.state)) return refuse(entry, 'ANSWERED', { answer: entry.answer });
  if (entry.state !== 'pending') return refuse(entry, CLOSED[entry.state]);
  const reason = message.body.reason;
  return move(entry, now, 'withdrawn', `withdrawal:${reason}`, { withdrawal: { reason }, messages: accepted(entry, message, now) });
}
export const applySuperseded = (entry, byId, now) => move(entry, now, 'withdrawn', 'withdrawal:superseded', { withdrawal: { reason: 'superseded' }, supersededBy: byId });
export function checkSupersede(predecessor, replacement) {
  if (!predecessor || predecessor.kind !== 'question') return { code: 'NOT_SUPERSEDABLE' };
  if (ANSWER_HOLDING.includes(predecessor.state)) return { code: 'ANSWERED', answer: predecessor.answer };
  if (predecessor.state !== 'pending' || !sameParty(predecessor.question.from, replacement.from)) return { code: 'NOT_SUPERSEDABLE' };
  return null;
}
export function applyHanded(entry, waiter, now) {
  if (!sameHandle(entry.route.waiter, waiter)) return refuse(entry, 'NOT_WAITER');
  if (['handed', 'unconfirmed', 'consumed'].includes(entry.state)) return keep(entry);
  if (entry.state === 'pending') return refuse(entry, 'NOT_ANSWERED');
  if (entry.state !== 'answered') return refuse(entry, CLOSED[entry.state]);
  return move(entry, now, 'handed', 'handed', { handedAt: now });
}
export function applyConfirm(entry, { matches, observed }, now) {
  const native = entry.state === 'released' || entry.state === 'expired';
  if (!native && entry.state !== 'handed' && entry.state !== 'unconfirmed') return refuse(entry, 'NOT_HANDED');
  if ((native || (entry.state === 'unconfirmed' && !matches)) && isDeepStrictEqual(entry.observed, observed)) return keep(entry);
  const patch = { observed, observations: [...entry.observations, { at: now, surface: 'terminal', answers: observed }] };
  if (native) return annotate(entry, now, 'native-answer', patch);
  return move(entry, now, matches ? 'consumed' : 'unconfirmed', matches ? 'confirm' : 'confirm-mismatch', patch);
}
export function applyAskerGone(entry, now) {
  if (entry.state === 'pending') return move(entry, now, 'withdrawn', 'withdrawal:asker-gone', { withdrawal: { reason: 'asker-gone' } });
  if (entry.state === 'answered') return move(entry, now, 'undeliverable', 'asker-gone');
  return keep(entry);
}
export function applyClock(entry, now) {
  if (entry.kind === 'notice') return entry.state === 'active' && now >= entry.notice.body.expiresAt ? move(entry, now, 'expired', 'expiry') : keep(entry);
  if (entry.state === 'pending' && now >= entry.question.body.expiresAt) return move(entry, now, 'expired', 'expiry');
  if (entry.state === 'handed' && now >= entry.handedAt + CONFIRM_WINDOW_MS) return move(entry, now, 'unconfirmed', 'window');
  return keep(entry);
}
export const applySeen = (entry, now) => entry.kind === 'notice' && !entry.seen ? annotate(entry, now, 'seen', { seen: true }) : keep(entry);
export function nextDeadline(entry) {
  if (entry.kind === 'notice') return entry.state === 'active' ? entry.notice.body.expiresAt : null;
  if (entry.state === 'pending') return entry.question.body.expiresAt;
  if (entry.state === 'handed') return entry.handedAt + CONFIRM_WINDOW_MS;
  return null;
}
const fail = (message) => { throw relayError('INVALID_ENTRY', message); };
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const seqOk = (v) => Number.isSafeInteger(v) && v >= 1;
const ms = (v) => Number.isSafeInteger(v) && v >= 0;
const keys = (v, allowed) => Object.keys(v).every((key) => allowed.includes(key));
const normalized = (message) => {
  const clean = validateMessage(message);
  if (!isDeepStrictEqual(clean, message)) fail('message is not normalized');
  return clean;
};
const uuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const answers = (v) => object(v) && Object.values(v).every((value) => typeof value === 'string');
export function validateEntry(v) {
  try {
    if (!object(v) || v.schema !== 1 || !seqOk(v.seq) || !ms(v.updatedAt) || !Array.isArray(v.log) || v.log.length === 0
      || !v.log.every((l) => object(l) && seqOk(l.seq) && l.seq <= v.seq && ms(l.at) && typeof l.cause === 'string')
      || v.log.at(-1).seq !== v.seq || v.log.at(-1).at !== v.updatedAt || v.log.at(-1).state !== v.state) fail('invalid entry frame');
    if (v.kind === 'notice') {
      if (normalized(v.notice).kind !== 'notice' || v.notice.id !== v.id || !['active', 'expired'].includes(v.state)
        || typeof v.seen !== 'boolean' || !v.log.every((l) => ['active', 'expired'].includes(l.state))) fail('invalid notice entry');
      return v;
    }
    if (v.kind !== 'question' || normalized(v.question).kind !== 'question' || v.question.id !== v.id
      || !QUESTION_STATES.includes(v.state) || !v.log.every((l) => QUESTION_STATES.includes(l.state))) fail('invalid question entry');
    if (!['inbox', 'desktop'].includes(v.presentation) || !object(v.route) || typeof v.route.handback !== 'boolean') fail('invalid route');
    if (v.route.waiter !== null && !isDeepStrictEqual(validateHandle(v.route.waiter), v.route.waiter)) fail('invalid waiter');
    if (ANSWER_HOLDING.includes(v.state) !== (v.answer !== null)) fail('answer does not match state');
    if (v.answer !== null) {
      if (normalized(v.answer).kind !== 'answer' || v.answer.correlationId !== v.id) fail('invalid answer');
      checkAnswer(v.question.body, v.answer.body);
      if (v.question.body.artifact !== null && v.answer.body.artifactRevision !== v.question.body.artifact.revision) fail('stale answer');
      if (v.question.body.class === 'authorization' && v.answer.body.outcome === 'answered'
        && !LOCAL_SURFACES.includes(v.answer.body.surface)) fail('nonlocal authorization');
    }
    if (['handed', 'consumed', 'unconfirmed'].includes(v.state) ? !ms(v.handedAt) : v.handedAt !== null) fail('invalid handedAt');
    if (v.state === 'withdrawn' ? !object(v.withdrawal) || !keys(v.withdrawal, ['reason'])
      || !WITHDRAWAL_REASONS.includes(v.withdrawal.reason) : v.withdrawal !== null) fail('invalid withdrawal');
    if (v.supersededBy !== null) {
      if (!uuid(v.supersededBy)) fail('invalid supersededBy');
      if (v.state !== 'withdrawn' || v.withdrawal.reason !== 'superseded' || v.supersededBy === v.id) fail('invalid supersession');
    }
    if (!Array.isArray(v.messages)) fail('invalid message history');
    const evidence = [...v.log];
    const consume = (at, causes) => {
      const index = evidence.findIndex((l) => l.at === at && causes.includes(l.cause));
      if (index === -1) fail('history lacks transition evidence');
      evidence.splice(index, 1);
    };
    const ids = new Set([v.id]);
    let savedAnswer = null, withdrawal = null;
    for (const row of v.messages) {
      if (!object(row) || !keys(row, ['at', 'message']) || !ms(row.at)) fail('invalid message history row');
      const message = normalized(row.message);
      if (!['answer', 'defer', 'withdrawal'].includes(message.kind) || message.correlationId !== v.id || ids.has(message.id)) fail('invalid history correlation');
      ids.add(message.id);
      if (message.kind === 'answer') {
        if (savedAnswer !== null) fail('multiple accepted answers');
        savedAnswer = message;
      }
      if (message.kind === 'withdrawal') {
        if (withdrawal !== null) fail('multiple accepted withdrawals');
        withdrawal = message.body;
      }
      const cause = message.kind === 'answer' ? 'answer' : message.kind === 'defer' ? `defer:${message.body.surface}` : `withdrawal:${message.body.reason}`;
      consume(row.at, [cause]);
    }
    if (!isDeepStrictEqual(savedAnswer, v.answer) || (withdrawal !== null && !isDeepStrictEqual(withdrawal, v.withdrawal))) fail('history does not match saved outcome');
    if (!Array.isArray(v.observations)) fail('invalid observation history');
    for (const observation of v.observations) {
      if (!object(observation) || !keys(observation, ['at', 'surface', 'answers']) || !ms(observation.at)
        || observation.surface !== 'terminal' || !answers(observation.answers)) fail('invalid native observation');
      consume(observation.at, ['confirm', 'confirm-mismatch', 'native-answer']);
    }
    if (evidence.some((l) => ['answer', 'confirm', 'confirm-mismatch', 'native-answer', 'withdrawal:asker', 'withdrawal:user', 'withdrawal:answered-elsewhere'].includes(l.cause)
      || l.cause.startsWith('defer:'))) fail('transition lacks history');
    if (!isDeepStrictEqual(v.observed, v.observations.at(-1)?.answers ?? null)) fail('observed does not match history');
    return v;
  } catch (error) {
    if (error.code === 'INVALID_ENTRY') throw error;
    return fail(error.message);
  }
}

