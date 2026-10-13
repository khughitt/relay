import { randomUUID } from 'node:crypto';
import { relayError } from '../protocol.js';
import { connectSocket } from '../serve/client.js';

const usage = (message) => relayError('USAGE', message);
export function parseValues(entry, tokens) {
  const items = entry.question.body.items, values = {};
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

async function withSocket(socketPath, fn) {
  const conn = await connectSocket(socketPath);
  try { return await fn(conn); } finally { conn.close(); }
}
const ok = (r) => {
  if (!r.ok) throw Object.assign(relayError(r.error.code, r.error.message), { entry: r.entry });
  return r;
};
const answerLabels = { answered: 'answer saved', handed: 'handed to the agent', consumed: 'the agent received it', unconfirmed: 'handed, receipt not confirmed' };
function humanState(entry) {
  if (entry.state !== 'undeliverable') return answerLabels[entry.state] ?? entry.state;
  const cause = entry.log.at(-1)?.cause;
  if (!entry.answer || typeof cause !== 'string') throw relayError('INVALID_ENTRY', 'undeliverable entry is missing its saved answer or recorded cause');
  return `saved answer ${JSON.stringify(entry.answer)}; reason: ${cause}`;
}
const line = (e) => `${e.id} ${humanState(e)}${e.presentation === 'desktop' ? ' (desktop)' : ''} ${e.kind === 'notice' ? `notice ${e.notice.body.title}` : `${e.question.from.agentId ?? 'user'} ${e.question.body.items[0].prompt}`}`;
const reply = (entry, kind, body, clock, newId) => ({ schema: 1, id: newId(), kind, correlationId: entry.id, from: { kind: 'user' }, to: entry.question.from,
  createdAt: clock(), context: entry.question.context, body });

export function runInbox({ action, args = [], decline = false, since, socketPath, clock = Date.now, newId = randomUUID }) {
  return withSocket(socketPath, async (conn) => {
    if (action === 'list') {
      if (args.length) throw usage('inbox list takes no arguments');
      const r = ok(await conn.request('list', since === undefined ? {} : { since }));
      return { json: { seq: r.seq, entries: r.entries }, text: r.entries.map((e) => `${line(e)}\n`).join('') };
    }
    const [id, ...rest] = args;
    if (!id) throw usage(`inbox ${action} needs an id`);
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
      r = ok(await conn.request('answer', { message: reply(entry, 'answer', { answerId: newId(), surface: 'cli', outcome: decline ? 'declined' : 'answered',
        artifactRevision: entry.question.body.artifact?.revision ?? null, values }, clock, newId) }));
    } else if (action === 'defer') {
      if (rest.length) throw usage('inbox defer takes only an id');
      r = ok(await conn.request('defer', { message: reply(entry, 'defer', { surface: 'cli' }, clock, newId) }));
    } else if (action === 'withdraw') {
      if (rest.length) throw usage('inbox withdraw takes only an id');
      r = ok(await conn.request('withdraw', { message: reply(entry, 'withdrawal', { reason: 'user' }, clock, newId) }));
    } else throw usage(`unknown inbox action ${JSON.stringify(action)}`);
    return { json: { entry: r.entry }, text: `${r.entry.id} ${humanState(r.entry)}\n` };
  });
}

export function runPresence({ mode, socketPath }) {
  return withSocket(socketPath, async (conn) => {
    const r = ok(mode ? await conn.request('presence.set', { mode }) : await conn.request('presence.get'));
    return { json: { presence: r.presence }, text: `${r.presence.mode}\n` };
  });
}
