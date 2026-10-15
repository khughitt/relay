// @ts-check
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from '../bus/paths.js';
import { withLock } from '../bus/lock.js';
import { ensurePrivateDir } from '../bus/store.js';
import { createProcessOps } from '../bus/proc.js';
import { relayError } from '../protocol.js';
import { expectAnswers } from '../routes/index.js';
import { openInbox } from './inbox.js';
import { serveSocket } from './socket.js';
import { serveConfig } from './config.js';
import { serveHttp } from './http.js';
import { readSnapshot } from '../bus/transaction.js';
// relay serve (spec §7.1): holds the registry's lock primitive on serve.lock for its whole life,
// so a second instance fails and a dead holder's lock is reclaimed by the reviewed path.
/** @param {string} stateDir */
export function servePaths(stateDir) { return { socketPath: join(stateDir, 'serve.sock'), lockPath: join(stateDir, 'serve.lock') }; }
const DAY_MS = 24 * 3600 * 1000;
/** @param {{env?: NodeJS.ProcessEnv, signal?: AbortSignal, io?: typeof fs, clock?: () => number, processOps?: import("../types.js").ProcessOps, log?: (line: string) => void, onCommit?: (entry: import("../types.js").Entry) => void, reattachMs?: number, ready?: (info: {socketPath: string, httpPort: number|null}) => void}} [options] */
export async function runServe({ env = process.env, signal, io = fs, clock = Date.now, processOps = createProcessOps(),
  log = (line) => process.stderr.write(`relay serve: ${line}\n`), onCommit = () => {}, reattachMs = 10000, ready = () => {} } = {}) {
  const config = serveConfig(env);
  const registryPaths = paths(env), { stateDir } = registryPaths, sp = servePaths(stateDir);
  await ensurePrivateDir(stateDir, { io });
  /** @param {import("../types.js").Failure} error */
  const report = (error) => log(`${error.code ?? 'ERROR'}: ${error.message}`);
  async function serveUntilAborted() {
    /** @type {import("../types.js").Inbox|null} */
    let inbox = null;
    /** @type {NodeJS.Timeout|undefined} */
    let timer;
    let socket = null, web = null, daily = /** @type {NodeJS.Timeout|undefined} */ (undefined), stopping = false;
    const arm = () => {
      if (!inbox || stopping) return;
      clearTimeout(timer);
      const at = inbox.nextDeadline();
      if (at !== null) timer = setTimeout(() => (/** @type {import("../types.js").Inbox} */ (inbox)).sweep().then(arm, report), Math.min(Math.max(0, at - clock()), 2 ** 31 - 1));
    };
    const opened = await openInbox({ stateDir, io, clock, expectAnswers, onCommit: (entry) => { onCommit(entry); queueMicrotask(arm); } });
    inbox = opened.inbox;
    for (const r of opened.rejected) log(`INVALID_ENTRY: quarantined ${r.name}: ${r.reason}`);
    /** @type {(() => void)|undefined} */
    let onAbort;
    try {
      await inbox.prune(); arm();
      daily = setInterval(() => inbox.prune().catch(report), DAY_MS);
      socket = await serveSocket({ inbox, socketPath: sp.socketPath, processOps, reattachMs, log });
      if (config.http) web = await serveHttp({ inbox, http: config.http, readAgents: () => readSnapshot({ paths: registryPaths }), clock, log });
      ready({ socketPath: sp.socketPath, httpPort: web?.port ?? null });
      const stopped = new Promise((resolve) => {
        onAbort = () => resolve(null);
        if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
      });
      const failure = await Promise.race([stopped, inbox.halted]);
      if (failure) throw failure; // the unit restarts us and startup reconciles
    } finally {
      stopping = true; clearTimeout(timer); clearInterval(daily);
      signal?.removeEventListener('abort', /** @type {() => void} */ (onAbort));
      await web?.close();
      await socket?.close();
      await inbox.idle();
    }
  }
  let held;
  try { held = await withLock(sp.lockPath, serveUntilAborted, { deadline: performance.now() + 2000, processOps }); }
  catch (caught) { const error = /** @type {import('../types.js').Failure} */ (caught); if (error.code === 'LOCK_TIMEOUT') throw relayError('SERVE_RUNNING', 'relay serve is already running'); throw error; }
  if (held.cleanupError) report(held.cleanupError);
}
