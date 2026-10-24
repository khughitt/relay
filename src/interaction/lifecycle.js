// @ts-check
import { isDeepStrictEqual } from 'node:util';
import { relayError, validateHandle } from '../protocol.js';
import { checkAnswer, isUuid, validateMessage, LOCAL_SURFACES, WITHDRAWAL_REASONS } from './message.js';
// The question lifecycle as pure functions (spec §5). Each returns { entry, changed, error };
// new log rows carry seq: null, which the store stamps when it persists the entry.
export const CONFIRM_WINDOW_MS = 60000;
export const QUESTION_STATES = Object.freeze(['pending', 'answered', 'handed', 'consumed', 'unconfirmed', 'undeliverable', 'released', 'withdrawn', 'expired']);
export const ANSWER_HOLDING = Object.freeze(['answered', 'handed', 'consumed', 'unconfirmed', 'undeliverable']);
const TERMINAL = ['consumed', 'unconfirmed', 'undeliverable', 'released', 'withdrawn', 'expired'];
/** @type {Record<string, string>} */
const CLOSED = { withdrawn: 'WITHDRAWN', expired: 'EXPIRED', released: 'RELEASED', undeliverable: 'UNDELIVERABLE' };
/** @param {import("../types.js").Entry} entry */
export const isTerminal = (entry) => entry.kind === 'notice' ? entry.state === 'expired' : TERMINAL.includes(entry.state);

/** @template {import("../types.js").Entry} E @param {E} entry @returns {import("../types.js").Result<E>} */
const keep = (entry) => ({ entry, changed: false, error: null });
/** @template {import("../types.js").Entry} E @param {E} entry @param {string} code @param {Partial<import("../types.js").Refusal>} [extra] @returns {import("../types.js").Result<E>} */
const refuse = (entry, code, extra = {}) => ({ entry, changed: false, error: { code, ...extra } });
/** @param {import("../types.js").Entry} entry @param {number} now @param {string} state @param {string} cause */
const row = (entry, now, state, cause) => [...entry.log, { seq: null, at: now, state, cause }];
/** @template {import("../types.js").Entry} E @param {E} entry @param {number} now @param {E["state"]} state @param {string} cause @param {Partial<E>} [patch] @returns {import("../types.js").Result<E>} */
const move = (entry, now, state, cause, patch = {}) => ({ entry: { ...entry, ...patch, state, updatedAt: now, log: row(entry, now, state, cause) }, changed: true, error: null });
/** @template {import("../types.js").Entry} E @param {E} entry @param {number} now @param {string} cause @param {Partial<E>} patch @returns {import("../types.js").Result<E>} */
const annotate = (entry, now, cause, patch) => ({ entry: { ...entry, ...patch, updatedAt: now, log: row(entry, now, entry.state, cause) }, changed: true, error: null });
/** @param {import("../types.js").Handle|null} a @param {import("../types.js").Handle|null} b */
const sameHandle = (a, b) => a !== null && b !== null && isDeepStrictEqual(a, b);
/** @param {import("../types.js").Party} a @param {import("../types.js").Party} b */
const sameParty = (a, b) => isDeepStrictEqual(a, b);
/** @param {import("../types.js").QuestionEntry} entry @param {import("../types.js").Message} message @param {number} now */
const accepted = (entry, message, now) => [...entry.messages, { at: now, message }];
/** @param {import("../types.js").QuestionEntry} entry @param {import("../types.js").Message} message */
const conflictingId = (entry, message) => message.id === entry.id || entry.messages.some((row) => row.message.id === message.id);
/** @param {import("../types.js").QuestionEntry} entry @param {import("../types.js").Message} message */
const replayed = (entry, message) => entry.messages.some((row) => isDeepStrictEqual(row.message, message));

/** @param {import("../types.js").QuestionMessage} question @param {{handback: boolean, waiter: import("../types.js").Handle|null, now: number}} options @returns {import("../types.js").QuestionEntry} */
export function createEntry(question, { handback, waiter, now }) {
  return { schema: 1, id: question.id, kind: 'question', question, state: 'pending', presentation: 'inbox',
    route: { handback, waiter }, answer: null, handedAt: null, observed: null, withdrawal: null, supersededBy: null,
    messages: [], observations: [], seq: null, updatedAt: now, log: [{ seq: null, at: now, state: 'pending', cause: 'question' }] };
}
/** @param {import("../types.js").NoticeMessage} notice @param {{now: number}} options @returns {import("../types.js").NoticeEntry} */
export function createNotice(notice, { now }) {
  return { schema: 1, id: notice.id, kind: 'notice', notice, state: 'active', seen: false,
    seq: null, updatedAt: now, log: [{ seq: null, at: now, state: 'active', cause: 'notice' }] };
}
/** @param {import("../types.js").QuestionEntry} entry @param {import("../types.js").AnswerMessage} message @param {number} now */
export function applyAnswer(entry, message, now) {
  const body = message.body, q = entry.question.body;
  if (entry.answer !== null && entry.answer.body.answerId === body.answerId) return keep(entry);
  if (ANSWER_HOLDING.includes(entry.state)) return refuse(entry, 'ALREADY_ANSWERED', { answer: entry.answer });
  if (entry.state !== 'pending') return refuse(entry, CLOSED[entry.state]);
  try { checkAnswer(q, body); } catch (caught) { const error = /** @type {import('../types.js').Failure} */ (caught); return refuse(entry, 'INVALID_ANSWER', { message: error.message }); }
  if (q.class === 'authorization' && body.outcome === 'answered' && !LOCAL_SURFACES.includes(body.surface)) return refuse(entry, 'LOCAL_ONLY');
  if (q.artifact !== null && body.artifactRevision !== q.artifact.revision) {
    return { ...annotate(entry, now, 'refusal:STALE', {}), error: { code: 'STALE', revision: q.artifact.revision } };
  }
  if (conflictingId(entry, message)) return refuse(entry, 'ID_CONFLICT');
  return move(entry, now, 'answered', 'answer', { answer: message, messages: accepted(entry, message, now) });
}
/** @param {import("../types.js").QuestionEntry} entry @param {import("../types.js").DeferMessage} message @param {number} now */
export function applyDefer(entry, message, now) {
  if (ANSWER_HOLDING.includes(entry.state)) return refuse(entry, 'ALREADY_ANSWERED', { answer: entry.answer });
  if (entry.state !== 'pending') return refuse(entry, CLOSED[entry.state]);
  if (replayed(entry, message)) return keep(entry);
  if (conflictingId(entry, message)) return refuse(entry, 'ID_CONFLICT');
  const messages = accepted(entry, message, now);
  if (entry.route.handback) return move(entry, now, 'released', `defer:${message.body.surface}`, { messages });
  return annotate(entry, now, `defer:${message.body.surface}`, { presentation: 'desktop', messages });
}
/** @param {import("../types.js").QuestionEntry} entry @param {import("../types.js").WithdrawalMessage} message @param {number} now */
export function applyWithdraw(entry, message, now) {
  if (ANSWER_HOLDING.includes(entry.state)) return refuse(entry, 'ANSWERED', { answer: entry.answer });
  if (entry.state !== 'pending') return refuse(entry, CLOSED[entry.state]);
  if (conflictingId(entry, message)) return refuse(entry, 'ID_CONFLICT');
  const reason = message.body.reason;
  return move(entry, now, 'withdrawn', `withdrawal:${reason}`, { withdrawal: { reason }, messages: accepted(entry, message, now) });
}
/** @param {import("../types.js").QuestionEntry} entry @param {string} byId @param {number} now */
export const applySuperseded = (entry, byId, now) => move(entry, now, 'withdrawn', 'superseded', { withdrawal: { reason: 'superseded' }, supersededBy: byId });
/** @param {import("../types.js").Entry|null} predecessor @param {import("../types.js").QuestionMessage} replacement */
export function checkSupersede(predecessor, replacement) {
  if (!predecessor || predecessor.kind !== 'question') return { code: 'NOT_SUPERSEDABLE' };
  if (ANSWER_HOLDING.includes(predecessor.state)) return { code: 'ANSWERED', answer: predecessor.answer };
  if (predecessor.state !== 'pending' || !sameParty(predecessor.question.from, replacement.from)) return { code: 'NOT_SUPERSEDABLE' };
  return null;
}
/** @param {import("../types.js").QuestionEntry} entry @param {import("../types.js").Handle|null} waiter @param {number} now */
export function applyHanded(entry, waiter, now) {
  if (!sameHandle(entry.route.waiter, waiter)) return refuse(entry, 'NOT_WAITER');
  if (['handed', 'unconfirmed', 'consumed'].includes(entry.state)) return keep(entry);
  if (entry.state === 'pending') return refuse(entry, 'NOT_ANSWERED');
  if (entry.state !== 'answered') return refuse(entry, CLOSED[entry.state]);
  return move(entry, now, 'handed', 'handed', { handedAt: now });
}
/** @param {import("../types.js").QuestionEntry} entry @param {{matches: boolean, observed: Record<string, string>}} observation @param {number} now */
export function applyConfirm(entry, { matches, observed }, now) {
  if (entry.question.body.native === null) return refuse(entry, 'NOT_HANDED');
  const native = entry.state === 'released' || entry.state === 'expired';
  if (!native && entry.state !== 'handed' && entry.state !== 'unconfirmed') return refuse(entry, 'NOT_HANDED');
  if ((native || (entry.state === 'unconfirmed' && !matches)) && isDeepStrictEqual(entry.observed, observed)) return keep(entry);
  const patch = { observed, observations: [...entry.observations, { at: now, surface: 'terminal', answers: observed }] };
  if (native) return annotate(entry, now, 'native-answer', patch);
  return move(entry, now, matches ? 'consumed' : 'unconfirmed', matches ? 'confirm' : 'confirm-mismatch', patch);
}
/** @param {import("../types.js").QuestionEntry} entry @param {number} now */
export function applyAskerGone(entry, now) {
  if (entry.question.body.native === null) return keep(entry);
  if (entry.state === 'pending') return move(entry, now, 'withdrawn', 'asker-gone', { withdrawal: { reason: 'asker-gone' } });
  if (entry.state === 'answered') return move(entry, now, 'undeliverable', 'asker-gone');
  return keep(entry);
}
/** @param {import("../types.js").Entry} entry @param {number} now */
export function applyTake(entry, now) {
  if (entry.kind !== 'question') return refuse(entry, 'NOT_A_QUESTION');
  if (entry.question.body.native !== null) return refuse(entry, 'UNSUPPORTED_ROUTE');
  if (entry.state === 'consumed') return keep(entry);
  if (entry.state === 'pending') return refuse(entry, 'NOT_ANSWERED');
  if (entry.state !== 'answered' && entry.state !== 'undeliverable') return refuse(entry, CLOSED[entry.state]);
  return move(entry, now, 'consumed', 'take');
}
/** @template {import("../types.js").Entry} E @param {E} entry @param {number} now @returns {import("../types.js").Result<E>} */
export function applyClock(entry, now) {
  if (entry.kind === 'notice') return entry.state === 'active' && now >= entry.notice.body.expiresAt ? move(entry, now, 'expired', 'expiry') : keep(entry);
  if (entry.state === 'pending' && now >= entry.question.body.expiresAt) return move(entry, now, 'expired', 'expiry');
  // Native handoff expires here; detached answers remain available through take until pruning.
  if (entry.state === 'answered' && now >= entry.question.body.expiresAt) return move(entry, now, 'undeliverable', 'expiry');
  if (entry.state === 'handed' && now >= (/** @type {number} */ (entry.handedAt)) + CONFIRM_WINDOW_MS) return move(entry, now, 'unconfirmed', 'window');
  return keep(entry);
}
/** @param {import("../types.js").Entry} entry @param {number} now */
export const applySeen = (entry, now) => entry.kind === 'notice' && !entry.seen ? annotate(entry, now, 'seen', { seen: true }) : keep(entry);
/** @param {import("../types.js").Entry} entry */
export function nextDeadline(entry) {
  if (entry.kind === 'notice') return entry.state === 'active' ? entry.notice.body.expiresAt : null;
  if (entry.state === 'pending' || entry.state === 'answered') return entry.question.body.expiresAt;
  if (entry.state === 'handed') return (/** @type {number} */ (entry.handedAt)) + CONFIRM_WINDOW_MS;
  return null;
}
/** @type {(message: string) => never} */
const fail = (message) => { throw relayError('INVALID_ENTRY', message); };
/** @param {unknown} v @returns {v is Record<string, any>} */
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** @param {number} v */
const seqOk = (v) => Number.isSafeInteger(v) && v >= 1;
/** @param {number} v */
const ms = (v) => Number.isSafeInteger(v) && v >= 0;
/** @param {Record<string, unknown>} v @param {string[]} allowed */
const keys = (v, allowed) => Object.keys(v).every((key) => allowed.includes(key));
/** @param {unknown} message */
const normalized = (message) => {
  const clean = validateMessage(message);
  if (!isDeepStrictEqual(clean, message)) fail('message is not normalized');
  return clean;
};
/** @param {unknown} v */
const answers = (v) => object(v) && Object.values(v).every((value) => typeof value === 'string');
/** @param {unknown} v @returns {import("../types.js").StoredEntry} */
export function validateEntry(v) {
  try {
    if (!object(v) || v.schema !== 1 || !seqOk(v.seq) || !ms(v.updatedAt) || !Array.isArray(v.log) || v.log.length === 0
      || !v.log.every((l) => object(l) && keys(l, ['seq', 'at', 'state', 'cause']) && seqOk(l.seq) && l.seq <= v.seq && ms(l.at) && typeof l.cause === 'string')
      || v.log.at(-1).seq !== v.seq || v.log.at(-1).at !== v.updatedAt || v.log.at(-1).state !== v.state) fail('invalid entry frame');
    if (v.kind === 'notice') {
      if (!keys(v, ['schema', 'id', 'kind', 'notice', 'state', 'seen', 'seq', 'updatedAt', 'log'])
        || normalized(v.notice).kind !== 'notice' || v.notice.id !== v.id || !['active', 'expired'].includes(v.state)
        || typeof v.seen !== 'boolean' || !v.log.every((l) => ['active', 'expired'].includes(l.state))) fail('invalid notice entry');
      if (v.log[0].state !== 'active' || v.log[0].cause !== 'notice') fail('invalid notice creation');
      for (let i = 1; i < v.log.length; i++) {
        const previous = v.log[i - 1].state, row = v.log[i];
        if (row.cause === 'seen' ? row.state !== previous
          : row.cause !== 'expiry' || previous !== 'active' || row.state !== 'expired' || row.at < v.notice.body.expiresAt) fail('invalid notice transition');
      }
      if (v.seen !== v.log.some((l) => l.cause === 'seen')) fail('seen lacks evidence');
      return /** @type {import("../types.js").StoredEntry} */ (v);
    }
    if (v.kind !== 'question' || !keys(v, ['schema', 'id', 'kind', 'question', 'state', 'presentation', 'route', 'answer',
      'handedAt', 'observed', 'withdrawal', 'supersededBy', 'messages', 'observations', 'seq', 'updatedAt', 'log'])
      || normalized(v.question).kind !== 'question' || v.question.id !== v.id
      || !QUESTION_STATES.includes(v.state) || !v.log.every((l) => QUESTION_STATES.includes(l.state))) fail('invalid question entry');
    if (!['inbox', 'desktop'].includes(v.presentation) || !object(v.route) || !keys(v.route, ['handback', 'waiter'])
      || typeof v.route.handback !== 'boolean') fail('invalid route');
    if (v.route.waiter !== null && !isDeepStrictEqual(validateHandle(v.route.waiter), v.route.waiter)) fail('invalid waiter');
    const detached = v.question.body.native === null;
    if (detached && (v.route.waiter !== null || v.route.handback || v.question.from.kind !== 'agent' || v.question.to.kind !== 'user'
      || v.handedAt !== null || v.observed !== null || !Array.isArray(v.observations) || v.observations.length !== 0
      || ['handed', 'unconfirmed', 'released'].includes(v.state))) fail('invalid detached entry');
    if (ANSWER_HOLDING.includes(v.state) !== (v.answer !== null)) fail('answer does not match state');
    if (v.answer !== null) {
      if (normalized(v.answer).kind !== 'answer' || v.answer.correlationId !== v.id) fail('invalid answer');
      checkAnswer(v.question.body, v.answer.body);
      if (v.question.body.artifact !== null && v.answer.body.artifactRevision !== v.question.body.artifact.revision) fail('stale answer');
      if (v.question.body.class === 'authorization' && v.answer.body.outcome === 'answered'
        && !LOCAL_SURFACES.includes(v.answer.body.surface)) fail('nonlocal authorization');
    }
    if (!detached && (['handed', 'consumed', 'unconfirmed'].includes(v.state) ? !ms(v.handedAt) : v.handedAt !== null)) fail('invalid handedAt');
    if (v.state === 'withdrawn' ? !object(v.withdrawal) || !keys(v.withdrawal, ['reason'])
      || !WITHDRAWAL_REASONS.includes(v.withdrawal.reason) : v.withdrawal !== null) fail('invalid withdrawal');
    if (v.supersededBy !== null) {
      if (!isUuid(v.supersededBy)) fail('invalid supersededBy');
      if (v.state !== 'withdrawn' || v.withdrawal.reason !== 'superseded' || v.supersededBy === v.id) fail('invalid supersession');
    }
    if (v.log[0].state !== 'pending' || v.log[0].cause !== 'question') fail('invalid question creation');
    for (let i = 1; i < v.log.length; i++) {
      const previous = v.log[i - 1].state, row = v.log[i];
      let valid = false;
      if (detached && ['handed', 'confirm', 'confirm-mismatch', 'window', 'native-answer', 'asker-gone'].includes(row.cause)) fail('invalid detached transition');
      if (row.cause === 'answer') valid = previous === 'pending' && row.state === 'answered';
      else if (row.cause === 'take') valid = detached && ['answered', 'undeliverable'].includes(previous) && row.state === 'consumed';
      else if (row.cause === 'refusal:STALE') valid = previous === 'pending' && row.state === 'pending' && v.question.body.artifact !== null;
      else if (row.cause.startsWith('defer:')) valid = previous === 'pending' && row.state === (v.route.handback ? 'released' : 'pending');
      else if (row.cause.startsWith('withdrawal:')) valid = previous === 'pending' && row.state === 'withdrawn'
        && WITHDRAWAL_REASONS.includes(row.cause.slice('withdrawal:'.length)) && v.withdrawal?.reason === row.cause.slice('withdrawal:'.length);
      else if (row.cause === 'superseded') valid = previous === 'pending' && row.state === 'withdrawn'
        && v.withdrawal?.reason === 'superseded' && v.supersededBy !== null;
      else if (row.cause === 'asker-gone') valid = previous === 'pending' ? row.state === 'withdrawn' && v.withdrawal?.reason === 'asker-gone'
        : previous === 'answered' && row.state === 'undeliverable';
      else if (row.cause === 'handed') valid = previous === 'answered' && row.state === 'handed' && row.at === v.handedAt && v.route.waiter !== null;
      else if (row.cause === 'confirm' || row.cause === 'confirm-mismatch') valid = ['handed', 'unconfirmed'].includes(previous)
        && row.state === (row.cause === 'confirm' ? 'consumed' : 'unconfirmed');
      else if (row.cause === 'window') valid = previous === 'handed' && row.state === 'unconfirmed' && row.at >= v.handedAt + CONFIRM_WINDOW_MS;
      else if (row.cause === 'expiry') valid = row.at >= v.question.body.expiresAt
        && ((previous === 'pending' && row.state === 'expired') || (previous === 'answered' && row.state === 'undeliverable'));
      else if (row.cause === 'native-answer') valid = ['released', 'expired'].includes(previous) && row.state === previous;
      if (!valid) fail('invalid question transition');
    }
    if (v.supersededBy !== null && !v.log.some((l) => l.cause === 'superseded')) fail('supersededBy lacks evidence');
    if (v.presentation !== (!v.route.handback && v.log.some((l) => l.cause.startsWith('defer:')) ? 'desktop' : 'inbox')) fail('presentation lacks evidence');
    if (!Array.isArray(v.messages)) fail('invalid message history');
    const evidence = [...v.log];
    /** @param {number} at @param {string[]} causes */
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
      const cause = message.kind === 'answer' ? 'answer' : message.kind === 'defer' ? `defer:${message.body.surface}` : `withdrawal:${(/** @type {import("../types.js").WithdrawalMessage} */ (message)).body.reason}`;
      consume(row.at, [cause]);
    }
    if (!isDeepStrictEqual(savedAnswer, v.answer) || (withdrawal !== null && !isDeepStrictEqual(withdrawal, v.withdrawal))) fail('history does not match saved outcome');
    if (!Array.isArray(v.observations)) fail('invalid observation history');
    for (const observation of v.observations) {
      if (!object(observation) || !keys(observation, ['at', 'surface', 'answers']) || !ms(observation.at)
        || observation.surface !== 'terminal' || !answers(observation.answers)) fail('invalid native observation');
      consume(observation.at, ['confirm', 'confirm-mismatch', 'native-answer']);
    }
    if (evidence.some((l) => ['answer', 'confirm', 'confirm-mismatch', 'native-answer'].includes(l.cause)
      || l.cause.startsWith('defer:') || l.cause.startsWith('withdrawal:'))) fail('transition lacks history');
    if (!isDeepStrictEqual(v.observed, v.observations.at(-1)?.answers ?? null)) fail('observed does not match history');
    return /** @type {import("../types.js").StoredEntry} */ (v);
  } catch (caught) { const error = /** @type {import('../types.js').Failure} */ (caught);
    if (error.code === 'INVALID_ENTRY') throw error;
    return fail(error.message);
  }
}

