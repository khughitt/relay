// @ts-check
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { relayError } from '../protocol.js';
import { connectSocket } from '../serve/client.js';
import { validateMessage } from '../interaction/message.js';

/** @param {string} message */
const usage = (message) => relayError('USAGE', message);
/** @param {import("../types.js").QuestionEntry} entry @param {string[]} tokens @returns {Record<string, import("../types.js").Value>} */
export function parseValues(entry, tokens) {
  const items = entry.question.body.items, values = /** @type {Record<string, import("../types.js").Value>} */ ({});
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq < 1) throw usage(`expected <item>=<value>, got ${JSON.stringify(token)}`);
    const id = token.slice(0, eq), raw = token.slice(eq + 1), item = items.find((i) => i.id === id);
    if (!item) throw usage(`no item ${JSON.stringify(id)} in this question`);
    if (Object.hasOwn(values, id)) throw usage(`item ${id} given twice`);
    if (item.type === 'boolean') {
      if (raw !== 'true' && raw !== 'false') throw usage(`${id} takes true or false`);
      values[id] = { type: 'boolean', value: raw === 'true' };
    } else if (item.type === 'text') {
      if (!raw.startsWith('text:')) throw usage(`${id} takes text:<text>`);
      values[id] = { type: 'text', text: raw.slice(5) };
    } else if (raw.startsWith('other:')) {
      if (!item.allowOther) throw usage(`${id} allows no other`);
      values[id] = { type: 'other', text: raw.slice(6) };
    } else {
      if (raw.startsWith('text:')) throw usage(`${id} takes option ids`);
      values[id] = { type: 'choice', optionIds: raw.split(',') };
    }
  }
  const missing = items.filter((i) => !Object.hasOwn(values, i.id)).map((i) => i.id);
  if (missing.length) throw usage(`missing a value for ${missing.join(', ')}`);
  return values;
}

/** @template T @param {string} socketPath @param {(conn: import("../types.js").Connection) => Promise<T>} fn */
async function withSocket(socketPath, fn) {
  const conn = await connectSocket(socketPath);
  try { return await fn(conn); } finally { conn.close(); }
}
/** @template T @param {import("../types.js").SocketReply<T>} r @returns {{ok: true} & T} */
const ok = (r) => {
  if (!r.ok) throw Object.assign(relayError(r.error.code, r.error.message), { entry: r.entry });
  return r;
};
/** @type {Record<string, string>} */
const answerLabels = { answered: 'answer saved', handed: 'handed to the agent', consumed: 'the agent received it', unconfirmed: 'handed, receipt not confirmed' };
/** @param {import("../types.js").Entry} entry */
function humanState(entry) {
  if (entry.state !== 'undeliverable') return answerLabels[entry.state] ?? entry.state;
  const cause = entry.log.at(-1)?.cause;
  if (!entry.answer || typeof cause !== 'string') throw relayError('INVALID_ENTRY', 'undeliverable entry is missing its saved answer or recorded cause');
  return `saved answer ${JSON.stringify(entry.answer)}; reason: ${cause}`;
}
/** @param {import("../types.js").Entry} e */
const line = (e) => `${e.id} ${humanState(e)}${e.kind === 'question' && e.presentation === 'desktop' ? ' (desktop)' : ''} ${e.kind === 'notice' ? `notice ${e.notice.body.title}` : `${e.question.from.agentId ?? 'user'} ${e.question.body.items[0].prompt}`}`;
/** @param {import("../types.js").QuestionEntry} entry @param {string} kind @param {unknown} body @param {() => number} clock @param {() => string} newId */
const reply = (entry, kind, body, clock, newId) => ({ schema: 1, id: newId(), kind, correlationId: entry.id, from: { kind: 'user' }, to: entry.question.from,
  createdAt: clock(), context: entry.question.context, body });

/** @param {{action: string, args?: string[], decline?: boolean, since?: number, file?: string, surface?: 'cli'|'terminal', reason?: 'user'|'asker', socketPath: string, clock?: () => number, newId?: () => string}} options */
export async function runInbox({ action, args = [], decline = false, since, file, surface = 'cli', reason = 'user', socketPath, clock = Date.now, newId = randomUUID }) {
  /** @type {import('../types.js').QuestionMessage|undefined} */
  let question;
  if (action === 'ask') {
    if (!file || args.length) throw usage('inbox ask requires only --file PATH');
    let text;
    try { text = await readFile(file, 'utf8'); }
    catch (caught) { const error = /** @type {NodeJS.ErrnoException} */ (caught); throw relayError(/** @type {string} */ (error.code), `cannot read question file ${JSON.stringify(file)}`, error); }
    let raw;
    try { raw = JSON.parse(text); } catch { throw relayError('INVALID_MESSAGE', 'question file is not valid JSON'); }
    const message = validateMessage(raw);
    if (message.kind !== 'question' || !isDeepStrictEqual(message, raw)) throw relayError('INVALID_MESSAGE', 'question file must contain a question with only recognized fields');
    if (message.body.native !== null) throw relayError('UNSUPPORTED_ROUTE', 'inbox ask accepts only detached questions');
    question = message;
  }
  return withSocket(socketPath, async (conn) => {
    if (question) {
      const r = ok(await conn.request('ask', { message: question, waiter: null, handback: false }));
      if (r.passthrough) throw relayError('UNEXPECTED_STATE', 'detached question was passed through');
      return { json: { entry: r.entry }, text: `${r.entry.id} ${humanState(r.entry)}\n` };
    }
    if (action === 'list') {
      if (args.length) throw usage('inbox list takes no arguments');
      const r = ok(await conn.request('list', since === undefined ? {} : { since }));
      return { json: { seq: r.seq, entries: r.entries }, text: r.entries.map((/** @type {import("../types.js").Entry} */ e) => `${line(e)}\n`).join('') };
    }
    const [id, ...rest] = args;
    if (!id) throw usage(`inbox ${action} needs an id`);
    if (action === 'take') {
      if (rest.length) throw usage('inbox take takes only an id');
      const r = ok(await conn.request('take', { id }));
      return { json: { entry: r.entry }, text: `${r.entry.id} ${humanState(r.entry)}\n` };
    }
    const entry = ok(await conn.request('get', { id })).entry;
    if (action === 'show') {
      if (rest.length) throw usage('inbox show takes only an id');
      return { json: { entry }, text: `${entry.id} ${humanState(entry)}\n${JSON.stringify(entry, null, 2)}\n` };
    }
    if (entry.kind !== 'question') throw usage(`${id} is not a question`);
    let r;
    if (action === 'answer') {
      if (decline && rest.length) throw usage('--decline takes no values');
      const values = decline ? {} : parseValues(entry, rest);
      r = ok(await conn.request('answer', { message: reply(entry, 'answer', { answerId: newId(), surface, outcome: decline ? 'declined' : 'answered',
        artifactRevision: entry.question.body.artifact?.revision ?? null, values }, clock, newId) }));
    } else if (action === 'defer') {
      if (rest.length) throw usage('inbox defer takes only an id');
      r = ok(await conn.request('defer', { message: reply(entry, 'defer', { surface: 'cli' }, clock, newId) }));
    } else if (action === 'withdraw') {
      if (rest.length) throw usage('inbox withdraw takes only an id');
      const message = reply(entry, 'withdrawal', { reason }, clock, newId);
      if (reason === 'asker') { message.from = entry.question.from; message.to = { kind: 'user' }; }
      r = ok(await conn.request('withdraw', { message }));
    } else throw usage(`unknown inbox action ${JSON.stringify(action)}`);
    return { json: { entry: r.entry }, text: `${r.entry.id} ${humanState(r.entry)}\n` };
  });
}

/** @param {{mode?: string, socketPath: string}} options */
export function runPresence({ mode, socketPath }) {
  return withSocket(socketPath, async (conn) => {
    const r = ok(mode ? await conn.request('presence.set', { mode }) : await conn.request('presence.get'));
    return { json: { presence: r.presence }, text: `${r.presence.mode}\n` };
  });
}
