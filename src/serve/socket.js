// @ts-check
import net from 'node:net';
import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ensurePrivateDir } from '../bus/store.js';
import { relayError, validateHandle } from '../protocol.js';
import { validateMessage } from '../interaction/message.js';
import { lineReader } from './lines.js';
/** @typedef {import("node:net").Socket & {waiting: Map<string, Owner>, watching?: boolean, unwatch?: () => void}} ServiceSocket */
/** @typedef {{socket: ServiceSocket, previous: Owner|null|undefined, accepted: boolean, refused: boolean}} Owner */
// relay serve's local socket (spec §7.2, §9.1 step 5). A connection that asked a question is that
// question's waiter: it receives a state line on every transition, and its close is the asker's
// death unless the service itself is closing.
/** @param {import("node:net").Socket} socket @param {unknown} value */
const send = (socket, value) => { if (!socket.destroyed) socket.write(`${JSON.stringify(value)}\n`); };
/** @template {import("../types.js").Message["kind"]} K @param {import("../types.js").Message} message @param {K} expected @returns {Extract<import("../types.js").Message, {kind: K}>} */
const kind = (message, expected) => { if (message.kind !== expected) throw relayError('INVALID_MESSAGE', `expected a ${expected} message`); return /** @type {Extract<import("../types.js").Message, {kind: K}>} */ (message); };
/** @param {{inbox: import("../types.js").Inbox, socketPath: string, processOps: import("../types.js").ProcessOps, reattachMs?: number, log: (line: string) => void}} options */
export async function serveSocket({ inbox, socketPath, processOps, reattachMs = 10000, log }) {
  await ensurePrivateDir(dirname(socketPath));
  let existing;
  try { existing = await fs.lstat(socketPath); } catch (caught) { const error = /** @type {import('../types.js').Failure} */ (caught); if (error.code !== 'ENOENT') throw error; }
  if (existing && (!existing.isSocket() || existing.uid !== (/** @type {() => number} */ (process.getuid))() || (existing.mode & 0o7777) !== 0o600)) {
    throw relayError('IO_ERROR', 'service socket must be privately owned with safe type and mode');
  }
  await fs.rm(socketPath, { force: true }); // the caller holds the service lock: no live server owns this path
  /** @type {Map<string, Owner>} */
  const waiters = new Map();
  /** @type {Set<ServiceSocket>} */
  const sockets = new Set();
  let closing = false, closed;
  const pending = new Set();
  /** @param {import("../types.js").Failure} error */
  const report = (error) => log(`${error.code ?? 'ERROR'}: ${error.message}`);
  /** @param {string} id @param {Owner} owner */
  const gone = (id, owner) => {
    if (closing || waiters.get(id) !== owner) return;
    waiters.delete(id);
    return inbox.askerGone(id).catch(report);
  };
  /** @param {string} id @param {Owner} owner */
  const restore = (id, owner) => {
    owner.refused = true;
    if (waiters.get(id) !== owner) return;
    let previous = owner.previous;
    while (previous?.refused) previous = previous.previous;
    if (previous) {
      waiters.set(id, previous);
      if (previous.accepted && previous.socket.destroyed) gone(id, previous);
    } else waiters.delete(id);
  };
  /** @param {string} id */
  const acceptedOwner = (id) => {
    let owner = /** @type {Owner|null|undefined} */ (waiters.get(id));
    while (owner && !owner.accepted) owner = owner.previous;
    return owner;
  };
  const unsubscribe = inbox.subscribe((event) => {
    if (event.type !== 'entry') return;
    const owner = acceptedOwner(event.entry.id) ?? waiters.get(event.entry.id);
    if (owner) send(owner.socket, { type: 'state', entry: event.entry });
  });
  /** @type {Record<string, (req: Record<string, any>, socket: ServiceSocket) => unknown>} */
  const handlers = {
    async ask(req, socket) {
      const message = kind(validateMessage(req.message), 'question');
      if (typeof req.handback !== 'boolean') throw relayError('INVALID_MESSAGE', 'ask needs a boolean handback');
      const waiter = validateHandle(req.waiter);
      /** @type {Owner} */
      const owner = { socket, previous: waiters.get(message.id), accepted: false, refused: false };
      waiters.set(message.id, owner);
      let result;
      try { result = await inbox.ask(message, { handback: req.handback, waiter }); }
      catch (caught) { const error = /** @type {import('../types.js').Failure} */ (caught); restore(message.id, owner); throw error; }
      if (!result.passthrough && !result.error && !isDeepStrictEqual((/** @type {import("../types.js").QuestionEntry} */ (result.entry)).route.waiter, waiter)) {
        result = { ...result, error: { code: 'NOT_WAITER' } };
      }
      if (result.passthrough || result.error) restore(message.id, owner);
      else {
        owner.accepted = true; owner.previous = /** @type {Owner|null|undefined} */ (null);
        socket.waiting.set(message.id, owner);
        // A close while ask was queued is a lost route only after that ask succeeds.
        if (socket.destroyed) await gone(message.id, owner);
      }
      return result.passthrough ? { passthrough: true } : result;
    },
    handed: (req) => inbox.handed(req.id, validateHandle(req.waiter)),
    confirm: (req) => {
      if (typeof req.harness !== 'string' || typeof req.callId !== 'string' || req.observed === null || typeof req.observed !== 'object' || Array.isArray(req.observed) || !Object.values(req.observed).every((v) => typeof v === 'string')) throw relayError('INVALID_MESSAGE', 'confirm needs harness, callId and observed');
      return inbox.confirm({ harness: req.harness, callId: req.callId, observed: req.observed });
    },
    answer: (req) => { const m = kind(validateMessage(req.message), 'answer'); return inbox.answer(m.correlationId, m); },
    defer: (req) => { const m = kind(validateMessage(req.message), 'defer'); return inbox.defer(m.correlationId, m); },
    withdraw: (req) => {
      const m = kind(validateMessage(req.message), 'withdrawal');
      if (!['user', 'asker'].includes(m.body.reason)) throw relayError('INVALID_MESSAGE', 'only user or asker may withdraw over the socket');
      return inbox.withdraw(m.correlationId, m);
    },
    notify: (req) => inbox.notify(kind(validateMessage(req.message), 'notice')),
    list: (req) => inbox.snapshot({ since: req.since, states: req.states }),
    get: async (req) => {
      const { entries } = await inbox.snapshot({ since: 0 });
      const entry = entries.find((e) => e.id === req.id);
      return entry ? { entry } : { entry: null, error: { code: 'NOT_FOUND' } };
    },
    'presence.get': () => ({ presence: inbox.presence() }),
    'presence.set': async (req) => ({ presence: await inbox.setPresence(req.mode) }),
    // Replayed entries arrive as pushes before this response; then live changes follow.
    // Ownership is reserved before the queued registration; a socket that closed while it
    // waited is unsubscribed as soon as registration resolves, so no listener outlives it.
    watch: async (req, socket) => {
      if (socket.watching) throw relayError('INVALID_REQUEST', 'this connection already watches');
      socket.watching = true;
      let registration;
      try { registration = await inbox.watch(req.since === undefined ? 0 : req.since, (event) => send(socket, event)); }
      catch (caught) { const error = /** @type {import('../types.js').Failure} */ (caught); socket.watching = false; throw error; }
      const { seq, unsubscribe } = registration;
      if (socket.destroyed) { unsubscribe(); return { seq }; }
      socket.unwatch = unsubscribe;
      return { seq };
    },
  };
  /** @param {ServiceSocket} socket @param {string} line */
  async function handle(socket, line) {
    let req;
    try { req = JSON.parse(line); } catch { return send(socket, { reqId: null, ok: false, error: { code: 'INVALID_REQUEST', message: 'request is not JSON' } }); }
    const reqId = req?.reqId ?? null, handler = typeof req?.op === 'string' && Object.hasOwn(handlers, req.op) ? handlers[req.op] : null;
    if (!handler) return send(socket, { reqId, ok: false, error: { code: 'UNKNOWN_OP', message: `unknown op ${JSON.stringify(req?.op)}` } });
    try {
      const { error, ...result } = /** @type {{error?: import("../types.js").Refusal, entry?: import("../types.js").Entry|null} & Record<string, unknown>} */ (await handler(req, socket));
      if (!error) return send(socket, { reqId, ok: true, ...result });
      const { code, message, ...detail } = error;
      return send(socket, { reqId, ok: false, error: { code, message: message ?? code }, entry: result.entry ?? null, ...detail });
    } catch (caught) { const error = /** @type {import('../types.js').Failure} */ (caught);
      if (!error.code) report(error);
      return send(socket, { reqId, ok: false, error: { code: error.code ?? 'INTERNAL', message: error.code ? error.message : 'internal error' } });
    }
  }
  const server = net.createServer((rawSocket) => {
    const socket = /** @type {ServiceSocket} */ (rawSocket);
    socket.waiting = new Map(); sockets.add(socket);
    socket.on('error', () => {}); // always followed by close
    lineReader(socket, (line) => {
      if (closing) return;
      const run = handle(socket, line); pending.add(run);
      run.finally(() => pending.delete(run));
    });
    socket.on('close', () => {
      sockets.delete(socket); socket.unwatch?.(); // a registration still queued cleans up after itself
      if (closing) return;
      for (const [id, owner] of socket.waiting) gone(id, owner);
    });
  });
  try {
    await /** @type {Promise<void>} */ (new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); }));
    await fs.chmod(socketPath, 0o600);
  } catch (caught) { const error = /** @type {import('../types.js').Failure} */ (caught);
    closing = true; unsubscribe();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }
  // Waiters recorded before a restart get reattachMs to come back; only a confirmed death withdraws.
  const recheck = setTimeout(() => {
    const run = (async () => {
      const { entries } = await inbox.snapshot({ states: ['pending', 'answered'] });
      for (const e of entries) {
        if (closing) return;
        if (e.kind !== 'question' || !e.route.waiter) continue;
        let latest = waiters.get(e.id);
        // A request queued after the first snapshot must settle before it counts as reattached.
        while (latest && !latest.accepted && !latest.refused) {
          await inbox.snapshot({ since: 0 });
          if (closing) return;
          latest = waiters.get(e.id);
        }
        const owner = acceptedOwner(e.id);
        if (!owner || owner.socket.destroyed) {
          if (processOps.probe(e.route.waiter).status === 'dead') await inbox.askerGone(e.id);
        }
      }
    })().catch(report);
    pending.add(run); run.finally(() => pending.delete(run));
  }, reattachMs);
  recheck.unref();
  return {
    close() {
      return closed ??= (async () => {
        closing = true; clearTimeout(recheck); unsubscribe();
        for (const s of sockets) s.destroy();
        await new Promise((resolve) => server.close(resolve));
        await Promise.allSettled([...pending]);
      })();
    },
  };
}
