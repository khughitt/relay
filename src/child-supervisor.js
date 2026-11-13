// @ts-check
// One awaited supervisor per dispatch. The dispatcher starts it before its first subscriber and
// sends it one run at a time over a private control pipe (fd 3); the supervisor answers on a
// separate result pipe (fd 4). Each subscriber leads its own process group, and a run's result
// means its whole group is gone. The supervisor outlives a dispatcher that dies mid-run only long
// enough to contain the active group, bounded by an absolute deadline it holds itself.
// Frames are newline-delimited JSON; every frame carries the dispatch nonce, and runs carry a
// strictly increasing invocation number. See docs/api.md ("Subscriber containment").
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createProcessOps } from './bus/proc.js';
import { containGroup, groupMembers } from './bus/process-group.js';
import * as fsp from 'node:fs/promises';
import { relayError } from './protocol.js';
import { CLEANUP_MS } from './child.js';
import { readFrames, writeFrame, LIMITS } from './supervisor-process.js';

export { SUPERVISOR_STARTUP_MS as STARTUP_MS } from './child.js';
// The supervisor process runs a separate entry with a minimal import graph: its startup is on the hook path.
const SCRIPT = fileURLToPath(new URL('./supervisor-process.js', import.meta.url));

/** Monotonic nanoseconds shared by every process on the host (CLOCK_MONOTONIC). */
const nowNs = () => process.hrtime.bigint();
/** @param {number} deadline @param {() => number} clock a local performance-style deadline as absolute monotonic nanoseconds */
const toNs = (deadline, clock) => (nowNs() + BigInt(Math.max(0, Math.floor((deadline - clock()) * 1e6)))).toString();

/**
 * Starts the dispatch supervisor and waits for it to report ready.
 * The ownership record is recovery evidence, not part of live containment: with no record directory,
 * or when the record cannot be written, runs still proceed and `recording` is false.
 * @param {{deadline: number, sessionHandle: import("./types.js").Handle|null, recordDir: string|null, env?: NodeJS.ProcessEnv, cwd?: string,
 *   clock?: () => number, processOps?: ReturnType<typeof createProcessOps>, spawnFn?: typeof spawn}} options
 * @returns {Promise<{runChild: (argv: string[], input: string, options: {timeoutMs: number, deadline: number, env: NodeJS.ProcessEnv, cwd: string}) => Promise<import("./types.js").ChildResult>,
 *   close: () => Promise<{cleanup: 'complete'|'failed'}>, timings: {startupMs: number}, nonce: string, recording: boolean}>}
 */
export async function createChildSupervisor({ deadline, sessionHandle, recordDir, env = {}, cwd = '/', clock = performance.now.bind(performance),
  processOps = createProcessOps(), spawnFn = spawn }) {
  const started = clock(), nonce = randomUUID(), recordPath = recordDir === null ? null : join(recordDir, `${nonce}.json`);
  const child = spawnFn(process.execPath, [SCRIPT, '--relay-supervisor'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], env, cwd, detached: false });
  const control = /** @type {import('node:stream').Writable} */ (child.stdio[3]), results = /** @type {import('node:stream').Readable} */ (child.stdio[4]);
  control.on('error', () => {});
  /** @type {((frame: Record<string, any>|null, error?: Error|null) => void)[]} */
  let waiters = [];
  let gone = false, failed = /** @type {Error|null} */ (null);
  // A supervisor that stops on its own (deadline, session or parent loss) reports closed before
  // anyone asks; remember it so a later close() does not wait for a frame already delivered.
  let closed = /** @type {Record<string, any>|null} */ (null);
  // Acknowledged groups by invocation, kept from the frame stream so a run never waits for one.
  /** @type {Map<number, Record<string, any>>} */
  const admissions = new Map();
  const exited = new Promise((resolve) => child.once('exit', () => { gone = true; resolve(undefined); for (const w of waiters) w(null); waiters = []; }));
  child.once('error', (error) => { failed ??= error; gone = true; for (const w of waiters) w(null, error); waiters = []; });
  readFrames(results, LIMITS.result, (frame) => {
    if (frame.nonce === nonce && frame.type === 'closed') closed = frame;
    if (frame.nonce === nonce && frame.type === 'admitted') admissions.set(frame.n, frame);
    for (const w of [...waiters]) w(frame);
  }, (error) => { failed ??= error; for (const w of waiters) w(null, error); waiters = []; });
  /** Waits for the first frame accepted by match, or null when the supervisor is gone or the time is up. @param {(f: Record<string, any>) => boolean} match @param {number} until */
  const next = (match, until) => new Promise((resolve) => {
    if (gone) { resolve(null); return; }
    const timer = setTimeout(() => { waiters = waiters.filter((w) => w !== waiter); resolve(null); }, Math.max(0, until - clock()));
    /** @param {Record<string, any>|null} frame */
    const waiter = (frame) => {
      if (frame !== null && (frame.nonce !== nonce || !match(frame))) return;
      clearTimeout(timer); waiters = waiters.filter((w) => w !== waiter); resolve(frame);
    };
    waiters.push(waiter);
  });
  const kill = () => { try { child.kill('SIGKILL'); } catch {} };
  writeFrame(control, { type: 'init', nonce, deadlineNs: toNs(deadline, clock), parent: processOps.handleOf(process.pid), session: sessionHandle, recordPath });
  const ready = await next((f) => f.type === 'ready', deadline);
  if (ready === null) { kill(); await exited; throw relayError('CONTAINMENT_FAILED', `the dispatch supervisor did not start${failed ? `: ${failed.message}` : ''}`); }
  const timings = { startupMs: clock() - started };
  let n = 0, broken = /** @type {string|null} */ (null);

  // The supervisor died or stopped answering while a subscriber it acknowledged may still run:
  // stop admissions and contain that group here with the same identity checks.
  /** @param {Record<string, any>|null} admitted @param {number} until */
  async function rescue(admitted, until) {
    kill(); await exited;
    if (admitted === null || admitted.leader === null || !Number.isSafeInteger(admitted.pgid)) return 'failed';
    const contained = await containGroup(admitted.pgid, { leader: admitted.leader, deadline: until, clock });
    return contained.cleanup;
  }

  return {
    nonce,
    timings,
    recording: ready.record === true,
    async runChild(argv, input, { timeoutMs, deadline: childDeadline, env: childEnv, cwd: childCwd }) {
      const none = { exitCode: null, signal: null, stdout: '', stderr: '' };
      if (broken !== null || gone) return { status: 'supervisor-failed', ...none, error: relayError('CONTAINMENT_FAILED', broken ?? 'the dispatch supervisor is gone'), cleanup: 'failed', timings: { runMs: 0, cleanupMs: 0 } };
      const id = ++n, sent = clock();
      const until = Math.min(childDeadline, sent + timeoutMs) + CLEANUP_MS + 50;
      const resultWait = next((f) => (f.type === 'result' || f.type === 'error') && f.n === id, until);
      writeFrame(control, { type: 'run', nonce, n: id, argv, input, timeoutMs, deadlineNs: toNs(childDeadline, clock), env: childEnv, cwd: childCwd });
      // A run that never spawned (spawn failure, expired deadline, refusal) answers without an admission.
      const frame = await resultWait;
      const admitted = admissions.get(id) ?? null;
      admissions.delete(id);
      if (frame === null || frame.type === 'error') {
        const reason = String(frame?.error?.message ?? 'the dispatch supervisor stopped answering');
        broken = reason;
        const cleanup = frame?.type === 'error' && admitted === null ? 'complete' : await rescue(admitted, clock() + CLEANUP_MS);
        return { status: 'supervisor-failed', ...none, error: relayError('CONTAINMENT_FAILED', reason), cleanup, timings: { runMs: clock() - sent, cleanupMs: 0 } };
      }
      const r = frame.result;
      if (r.cleanup === 'failed') broken = 'a subscriber group could not be contained';
      return { status: r.status, exitCode: r.exitCode, signal: r.signal, stdout: r.stdout, stderr: r.stderr,
        ...(r.error ? { error: relayError(r.error.code, r.error.message) } : {}), cleanup: r.cleanup, timings: r.timings };
    },
    async close() {
      if (closed !== null) {
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, CLEANUP_MS))]);
        if (!gone) kill();
        return { cleanup: closed.cleanup === 'complete' && broken === null ? 'complete' : 'failed' };
      }
      if (gone) return { cleanup: broken === null && failed === null ? 'complete' : 'failed' };
      writeFrame(control, { type: 'close', nonce });
      const frame = await next((f) => f.type === 'closed', clock() + CLEANUP_MS);
      control.end();
      if (frame === null) { kill(); await exited; return { cleanup: 'failed' }; }
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, CLEANUP_MS))]);
      if (!gone) kill();
      return { cleanup: frame.cleanup === 'complete' && broken === null ? 'complete' : 'failed' };
    },
  };
}

// ---- ownership record recovery (explicit relay reap only) ----

const RECOVERY = Object.freeze({ records: 128, bytes: 512 * 1024, scanMs: 500 });
const RECORD_NAME = /^[0-9a-f-]{36}\.json$/;

/**
 * Inspects ownership records left by dispatch supervisors. A record is removed only when it is
 * terminal and everything it names is verified gone: supervisor, dispatcher, the child and its
 * group. Spawn-pending, live, unknown, malformed or incomplete records stay, each reported as a
 * CLEANUP_INCIDENT. Recovery never signals any process, not even a verified survivor: a surviving
 * group after a supervisor was killed is an operator action. At most 128 records or 512 KiB are
 * read within a 500 ms scan bound; nextCursor resumes the next explicit reap after the last one read.
 * @param {{dir: string, cursor?: string|null, deadline?: number, clock?: () => number, processOps?: ReturnType<typeof createProcessOps>,
 *   io?: typeof import('node:fs/promises'), groupAlive?: (pgid: number, leaderStart: string) => boolean|null}} options
 * @returns {Promise<{inspected: number, removed: string[], incidents: string[], nextCursor: string|null}>}
 */
export async function recoverChildRecords({ dir, cursor = null, deadline = Infinity, clock = performance.now.bind(performance),
  processOps = createProcessOps(), io = fsp, groupAlive = defaultGroupAlive }) {
  const until = Math.min(deadline, clock() + RECOVERY.scanMs);
  /** @type {string[]} */
  let names;
  try { names = (await io.readdir(dir)).filter((name) => RECORD_NAME.test(name)).sort(); }
  catch (error) { if (/** @type {any} */ (error)?.code === 'ENOENT') return { inspected: 0, removed: [], incidents: [], nextCursor: null }; throw error; }
  const pending = names.filter((name) => cursor === null || name > cursor);
  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const incidents = [];
  let inspected = 0, bytes = 0, last = /** @type {string|null} */ (null);
  for (const name of pending) {
    if (inspected >= RECOVERY.records || bytes >= RECOVERY.bytes || clock() >= until) break;
    const path = join(dir, name);
    inspected++; last = name;
    /** @param {string} reason */
    const incident = (reason) => incidents.push(`CLEANUP_INCIDENT: ${name} ${reason}`);
    let record;
    try {
      const text = await io.readFile(path, 'utf8');
      bytes += Buffer.byteLength(text);
      record = JSON.parse(text);
    } catch { incident('unreadable or malformed record retained'); continue; }
    if (record === null || typeof record !== 'object' || record.schema !== 1 || typeof record.phase !== 'string') { incident('malformed record retained'); continue; }
    if (record.phase === 'spawn-pending') { incident(`spawn-pending invocation ${record.invocation ?? 'unknown'} retained: ownership of a possible child is ambiguous`); continue; }
    /** @param {unknown} handle */
    const verdict = (handle) => handle === null || handle === undefined ? 'absent' : processOps.probe(handle).status;
    const supervisor = verdict(record.supervisor), parent = verdict(record.parent), child = verdict(record.child);
    const group = Number.isSafeInteger(record.pgid) && record.child ? groupAlive(record.pgid, record.child.start) : false;
    const summary = `phase ${record.phase} supervisor ${supervisor} dispatcher ${parent} child ${child} group ${group === null ? 'unknown' : group ? 'present' : 'absent'}`;
    if (supervisor === 'alive' || parent === 'alive') { incident(`live (${summary}) retained`); continue; }
    if (supervisor !== 'dead' || !['dead', 'absent'].includes(parent) || !['dead', 'absent'].includes(child) || group !== false) {
      incident(`${group === true ? 'surviving group, operator cleanup required' : 'unverified ownership'} (${summary}) retained`); continue;
    }
    try { await io.unlink(path); removed.push(name); } catch (error) { if (/** @type {any} */ (error)?.code !== 'ENOENT') incident('verified dead but not removable'); }
  }
  const more = last !== null && pending.indexOf(last) < pending.length - 1;
  return { inspected, removed, incidents, nextCursor: more ? last : null };
}

// Whether the recorded group still has members consistent with the recorded leader: any member
// started at or after it. A group whose id now names an unrelated, earlier-started process is not
// this record's. null when membership cannot be read.
/** @param {number} pgid @param {string} leaderStart */
function defaultGroupAlive(pgid, leaderStart) {
  let members;
  try { members = groupMembers(pgid, { deadline: performance.now() + 100 }); } catch { return null; }
  const start = BigInt(leaderStart);
  // A different process now holding the leader's pid leads a reused group, not this record's.
  return members.some((m) => BigInt(m.start) >= start && !(m.pid === pgid && m.start !== leaderStart));
}

