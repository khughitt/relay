import { join } from 'node:path';
import { paths } from '../bus/paths.js';
import { withLock } from '../bus/lock.js';
import { ensurePrivateDir } from '../bus/store.js';
import { createProcessOps } from '../bus/proc.js';
import { relayError } from '../protocol.js';
import { expectAnswers } from '../routes/index.js';
import { openInbox } from './inbox.js';
import { serveSocket } from './socket.js';
// relay serve (spec §7.1): holds the registry's lock primitive on serve.lock for its whole life,
// so a second instance fails and a dead holder's lock is reclaimed by the reviewed path.
export function servePaths(stateDir) { return { socketPath: join(stateDir, 'serve.sock'), lockPath: join(stateDir, 'serve.lock') }; }
const DAY_MS = 24 * 3600 * 1000;
export async function runServe({ env = process.env, signal, clock = Date.now, processOps = createProcessOps(),
  log = (line) => process.stderr.write(`relay serve: ${line}\n`), onCommit = () => {}, reattachMs = 10000, ready = () => {} } = {}) {
  const { stateDir } = paths(env), sp = servePaths(stateDir);
  await ensurePrivateDir(stateDir);
  const report = (error) => log(`${error.code ?? 'ERROR'}: ${error.message}`);
  async function serveUntilAborted() {
    let inbox = null, timer = null, socket = null, daily = null, stopping = false;
    const arm = () => {
      if (!inbox || stopping) return;
      clearTimeout(timer);
      const at = inbox.nextDeadline();
      if (at !== null) timer = setTimeout(() => inbox.sweep().then(arm, report), Math.min(Math.max(0, at - clock()), 2 ** 31 - 1));
    };
    const opened = await openInbox({ stateDir, clock, expectAnswers, onCommit: (entry) => { onCommit(entry); queueMicrotask(arm); } });
    inbox = opened.inbox;
    for (const r of opened.rejected) log(`INVALID_ENTRY: quarantined ${r.name}: ${r.reason}`);
    let onAbort;
    try {
      await inbox.prune(); arm();
      daily = setInterval(() => inbox.prune().catch(report), DAY_MS);
      socket = await serveSocket({ inbox, socketPath: sp.socketPath, processOps, reattachMs, log });
      ready({ socketPath: sp.socketPath, httpPort: null });
      const stopped = new Promise((resolve) => {
        onAbort = () => resolve(null);
        if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
      });
      const failure = await Promise.race([stopped, inbox.halted]);
      if (failure) throw failure; // the unit restarts us and startup reconciles
    } finally {
      stopping = true; clearTimeout(timer); clearInterval(daily);
      signal?.removeEventListener('abort', onAbort);
      await socket?.close();
      await inbox.idle();
    }
  }
  let held;
  try { held = await withLock(sp.lockPath, serveUntilAborted, { deadline: performance.now() + 2000, processOps }); }
  catch (error) { if (error.code === 'LOCK_TIMEOUT') throw relayError('SERVE_RUNNING', 'relay serve is already running'); throw error; }
  if (held.cleanupError) report(held.cleanupError);
}
