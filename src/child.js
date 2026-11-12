// @ts-check
// Runs one subscriber inside the dispatch supervisor: no shell, the given cwd and environment,
// stdin fed once, stdout/stderr each capped, and the subscriber leading its own process group.
// The invocation reports only after that whole group is gone (or cleanup is known to have
// failed), so a descendant holding the pipes never outlives a "successful" result.
import { spawn } from 'node:child_process';
import { createProcessOps } from './bus/proc.js';
import { containGroup, groupExists } from './bus/process-group.js';

export const OUTPUT_LIMIT = 64 * 1024;
export const CLEANUP_MS = 500;
export const TERM_GRACE_MS = 100;

/**
 * @typedef {{status: string, exitCode: number|null, signal: string|null, stdout: string, stderr: string, error?: unknown,
 *   cleanup: 'complete'|'failed', timings: {runMs: number, cleanupMs: number}}} LeaderResult
 * @typedef {{pid: number, start: string, state: string}} Member
 */

/**
 * @param {string[]} argv @param {string} input
 * @param {{deadline: number, timeoutMs: number, env: NodeJS.ProcessEnv, cwd: string, clock?: () => number, limit?: number,
 *   cleanupMs?: number, onSpawn?: (owned: {pid: number, pgid: number, handle: import("./types.js").Handle|null, leader: Member|null}) => void,
 *   processOps?: ReturnType<typeof createProcessOps>, spawnFn?: typeof spawn}} options
 * @returns {{done: Promise<LeaderResult>, abort: (why: string) => void}}
 */
export function runGroupLeader(argv, input, { deadline, timeoutMs, env, cwd, clock = performance.now.bind(performance), limit = OUTPUT_LIMIT,
  cleanupMs = CLEANUP_MS, onSpawn = () => {}, processOps = createProcessOps(), spawnFn = spawn }) {
  const started = clock();
  /** @type {(why: string) => void} */
  let abort = () => {};
  const allowed = Math.min(timeoutMs, deadline - started);
  const empty = (/** @type {string} */ status, /** @type {unknown} */ error = undefined) => ({ status, exitCode: null, signal: null, stdout: '', stderr: '',
    ...(error === undefined ? {} : { error }), cleanup: /** @type {'complete'} */ ('complete'), timings: { runMs: 0, cleanupMs: 0 } });
  if (allowed <= 0) return { done: Promise.resolve(empty('timeout')), abort };
  let child;
  try { child = spawnFn(argv[0], argv.slice(1), { shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env, cwd }); }
  catch (caught) { return { done: Promise.resolve(empty('spawn-failed', caught)), abort }; }
  const pid = child.pid;
  if (pid === undefined) {
    // Spawn failed before a process existed (missing file, bad cwd): nothing to contain.
    const failed = new Promise((resolve) => child.once('error', (error) => resolve(empty('spawn-failed', error))));
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy();
    return { done: /** @type {Promise<LeaderResult>} */ (failed), abort };
  }
  // The leader is unreaped until this turn of the event loop ends, so its identity and group read
  // here belong to this invocation even when it has already exited.
  let handle = null;
  try { handle = processOps.handleOf(pid); } catch {}
  /** @type {Member|null} */
  const leader = handle === null ? null : { pid, start: handle.start, state: 'R' };
  onSpawn({ pid, pgid: pid, handle, leader });

  const out = { chunks: /** @type {Buffer[]} */ ([]), bytes: 0 }, err = { chunks: /** @type {Buffer[]} */ ([]), bytes: 0 };
  let status = 'exited', exitCode = /** @type {number|null} */ (null), signal = /** @type {string|null} */ (null);
  /** @type {unknown} */
  let error;
  let leaderAlive = true, exitedAt = 0;
  /** @param {string} why @param {unknown} [cause] */
  abort = (why, cause) => {
    if (status !== 'exited' || !leaderAlive) return;
    status = why; error = cause;
    // While the leader is unreaped its pid, and so its group id, cannot be reused.
    try { process.kill(-pid, 'SIGTERM'); } catch {}
    child.stdin?.destroy();
    killTimer = setTimeout(() => { if (leaderAlive) try { process.kill(-pid, 'SIGKILL'); } catch {} }, TERM_GRACE_MS);
  };
  /** @type {NodeJS.Timeout|undefined} */
  let killTimer;
  /** @param {{chunks: Buffer[], bytes: number}} sink @returns {(chunk: Buffer|string) => void} */
  const collect = (sink) => (chunk) => {
    const buffer = Buffer.from(chunk), remaining = limit - sink.bytes;
    if (remaining > 0) sink.chunks.push(buffer.subarray(0, remaining));
    sink.bytes += buffer.length;
    if (sink.bytes > limit) abort('output-exceeded');
  };
  const timer = setTimeout(() => abort('timeout'), allowed);
  child.stdout?.on('data', collect(out)); child.stderr?.on('data', collect(err));
  child.stdin?.on('error', () => {}); // an early exit closes stdin; the exit status is the useful signal
  child.stdin?.end(input);
  const streamsClosed = Promise.all([child.stdout, child.stderr].map((stream) => new Promise((resolve) => {
    if (!stream || stream.destroyed) resolve(undefined); else stream.once('close', resolve);
  })));
  const exited = new Promise((resolve) => child.once('exit', (code, sig) => {
    leaderAlive = false; exitedAt = clock(); exitCode = code; signal = sig; clearTimeout(timer); clearTimeout(killTimer); resolve(undefined);
  }));
  child.once('error', (cause) => { if (status === 'exited') { status = 'spawn-failed'; error = cause; } });
  const done = (async () => {
    await exited;
    child.stdin?.destroy();
    const cleanupStart = clock();
    // Without the leader's identity the group cannot be bound to this invocation: never signal it.
    const contained = leader === null ? { cleanup: /** @type {'complete'|'failed'} */ (groupExists(pid) ? 'failed' : 'complete') }
      : await containGroup(pid, { leader, deadline: cleanupStart + cleanupMs, clock });
    // With the group gone every writer has closed; a failed cleanup leaves holders, so stop reading.
    if (contained.cleanup === 'failed') for (const stream of [child.stdout, child.stderr]) stream?.destroy();
    await streamsClosed;
    return { status, exitCode, signal, stdout: Buffer.concat(out.chunks).toString('utf8'), stderr: Buffer.concat(err.chunks).toString('utf8'),
      ...(error === undefined ? {} : { error }), cleanup: contained.cleanup,
      timings: { runMs: exitedAt - started, cleanupMs: clock() - cleanupStart } };
  })();
  return { done, abort: (why) => abort(why) };
}
