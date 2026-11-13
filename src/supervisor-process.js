// @ts-check
// The dispatch supervisor process (started by src/child-supervisor.js) and the frame transport both
// sides share. Its import graph is kept minimal because its startup is on the hook path.
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProcessOps } from './bus/proc.js';
import { runGroupLeader, CLEANUP_MS } from './child.js';

export const POLL_MS = 100;
export const LIMITS = Object.freeze({ ready: 4 * 1024, result: 1024 * 1024, run: 8 * 1024 * 1024, control: 8 * 1024 * 1024 });
/** @param {string} code @param {string} message */
const protocolError = (code, message) => Object.assign(new Error(message), { code });
/** Monotonic nanoseconds shared by every process on the host (CLOCK_MONOTONIC). */
const nowNs = () => process.hrtime.bigint();
/** @param {string} ns @returns {number} milliseconds remaining until an absolute monotonic deadline */
const remainingMs = (ns) => Number(BigInt(ns) - nowNs()) / 1e6;
/** @param {unknown} error */
const errorOf = (error) => ({ code: String(/** @type {any} */ (error)?.code ?? 'IO_ERROR'), message: String(/** @type {any} */ (error)?.message ?? 'failed') });

// Newline-delimited JSON frames from a stream, each bounded; an oversized or malformed frame is a protocol error.
/** @param {import('node:stream').Readable} stream @param {number} limit @param {(frame: Record<string, any>) => void} onFrame @param {(error: Error|null) => void} onEnd */
export function readFrames(stream, limit, onFrame, onEnd) {
  let buffer = '';
  let ended = false;
  /** @param {Error|null} error */
  const end = (error) => { if (!ended) { ended = true; onEnd(error); } };
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (Buffer.byteLength(line) > limit) { end(protocolError('PROTOCOL', 'supervisor frame exceeds its size limit')); stream.destroy(); return; }
      let frame;
      try { frame = JSON.parse(line); } catch { end(protocolError('PROTOCOL', 'supervisor frame is not JSON')); stream.destroy(); return; }
      if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) { end(protocolError('PROTOCOL', 'supervisor frame is not an object')); stream.destroy(); return; }
      onFrame(frame);
    }
    if (Buffer.byteLength(buffer) > limit) { end(protocolError('PROTOCOL', 'supervisor frame exceeds its size limit')); stream.destroy(); }
  });
  stream.once('end', () => end(null));
  stream.once('close', () => end(null));
  stream.once('error', (error) => end(error));
}
/** @param {import('node:stream').Writable} stream @param {unknown} frame */
export const writeFrame = (stream, frame) => { if (!stream.destroyed && stream.writable) stream.write(`${JSON.stringify(frame)}\n`); };


/** @param {string} path @param {Record<string, unknown>} record */
function writeRecord(path, record) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ schema: 1, ...record, updatedAt: Date.now() })}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

async function supervise() {
  const processOps = createProcessOps();
  const control = new Socket({ fd: 3, readable: true, writable: false });
  const results = new Socket({ fd: 4, readable: false, writable: true });
  results.on('error', () => {});
  /** @type {{nonce: string, deadlineNs: string, parent: any, session: any, recordPath: string|null}|null} */
  let init = null;
  /** @type {{n: number, abort: (why: string) => void, done: Promise<any>}|null} */
  let active = null;
  let last = 0, stopping = false, incident = false, recording = false;
  // A provisional absolute deadline from the command line bounds an early-started supervisor until
  // init, which may only shorten it.
  const provisional = /^[0-9]+$/.test(process.argv[3] ?? '') ? process.argv[3] : null;
  /** @type {Record<string, unknown>} */
  let record = {};
  const self = processOps.handleOf(process.pid);
  /** @param {Record<string, unknown>} change */
  const note = (change) => {
    if (init === null || init.recordPath === null || !recording) return;
    record = { ...record, ...change };
    try { writeRecord(init.recordPath, record); } catch { recording = false; }
  };
  /** @type {NodeJS.Timeout[]} */
  const timers = [];
  /** @param {string} reason */
  async function stop(reason) {
    if (stopping) return; stopping = true;
    for (const timer of timers) clearTimeout(timer), clearInterval(timer);
    if (active !== null) { active.abort('stopped'); await active.done.catch(() => {}); }
    if (init !== null) {
      if (incident) note({ phase: 'incident', reason });
      else if (init.recordPath !== null && recording) { try { unlinkSync(init.recordPath); } catch {} }
      writeFrame(results, { type: 'closed', nonce: init.nonce, cleanup: incident ? 'failed' : 'complete', reason });
    }
    results.end(() => process.exit(0));
    setTimeout(() => process.exit(0), 50).unref();
  }
  /** @param {Record<string, any>} frame */
  async function run(frame) {
    if (init === null) return;
    const refuse = (/** @type {string} */ message) => writeFrame(results, { type: 'error', nonce: init?.nonce, n: frame.n, error: { code: 'PROTOCOL', message } });
    if (stopping || incident) return refuse('the supervisor accepts no further runs');
    if (active !== null || !Number.isSafeInteger(frame.n) || frame.n <= last) return refuse('run frames are sequential and strictly increasing');
    if (!Array.isArray(frame.argv) || typeof frame.input !== 'string' || typeof frame.cwd !== 'string') return refuse('malformed run frame');
    last = frame.n;
    note({ phase: 'spawn-pending', invocation: frame.n, child: null, pgid: null });
    const deadline = performance.now() + Math.min(remainingMs(frame.deadlineNs), remainingMs(init.deadlineNs));
    const leader = runGroupLeader(frame.argv, frame.input, { deadline, timeoutMs: frame.timeoutMs, env: frame.env, cwd: frame.cwd, processOps,
      onSpawn: ({ pgid, handle, leader: owned }) => {
        note({ phase: 'active', child: handle, pgid });
        writeFrame(results, { type: 'admitted', nonce: init?.nonce, n: frame.n, child: handle, pgid, leader: owned });
      } });
    active = { n: frame.n, abort: leader.abort, done: leader.done };
    const result = await leader.done;
    active = null;
    if (result.cleanup === 'failed') { incident = true; note({ phase: 'incident', reason: 'cleanup failed' }); }
    else note({ phase: 'idle', invocation: null, child: null, pgid: null });
    const { error, ...rest } = result;
    writeFrame(results, { type: 'result', nonce: init.nonce, n: frame.n, result: { ...rest, ...(error === undefined ? {} : { error: errorOf(error) }) } });
  }
  if (provisional !== null) {
    timers.push(setTimeout(() => void stop('deadline'), Math.max(0, remainingMs(provisional) + CLEANUP_MS)));
    setTimeout(() => process.exit(1), Math.max(0, remainingMs(provisional) + 2 * CLEANUP_MS)).unref();
  }
  readFrames(control, LIMITS.control, (frame) => {
    if (init === null) {
      if (frame.type !== 'init' || typeof frame.nonce !== 'string' || !(frame.recordPath === null || typeof frame.recordPath === 'string') || typeof frame.deadlineNs !== 'string') { void stop('bad init'); return; }
      const deadlineNs = provisional !== null && BigInt(provisional) < BigInt(frame.deadlineNs) ? provisional : frame.deadlineNs;
      init = { nonce: frame.nonce, deadlineNs, parent: frame.parent ?? null, session: frame.session ?? null, recordPath: frame.recordPath };
      const host = processOps.handleOf(process.pid);
      recording = init.recordPath !== null;
      note({ nonce: init.nonce, host: host?.host ?? null, bootId: host?.bootId ?? null, parent: init.parent, supervisor: self, session: init.session,
        phase: 'idle', invocation: null, child: null, pgid: null, deadlineNs: init.deadlineNs });
      // The absolute deadline holds even if the dispatcher survives but stops talking.
      timers.push(setTimeout(() => void stop('deadline'), Math.max(0, remainingMs(init.deadlineNs) + CLEANUP_MS)));
      // A hard exit no stop path can postpone: one more cleanup reserve after the deadline.
      setTimeout(() => process.exit(1), Math.max(0, remainingMs(init.deadlineNs) + 2 * CLEANUP_MS)).unref();
      timers.push(setInterval(() => {
        if (init === null) return;
        for (const [who, handle] of /** @type {[string, any][]} */ ([['parent', init.parent], ['session', init.session]])) {
          if (handle !== null && processOps.probe(handle).status === 'dead') void stop(`${who} died`);
        }
      }, POLL_MS));
      writeFrame(results, { type: 'ready', nonce: init.nonce, supervisor: self, record: recording });
      return;
    }
    if (frame.nonce !== init.nonce) { void stop('foreign frame'); return; }
    if (frame.type === 'run') void run(frame);
    else if (frame.type === 'close') void stop('closed');
    else void stop('unknown frame');
  }, () => void stop('control closed'));
}

if (process.argv[2] === '--relay-supervisor' && import.meta.url === pathToFileURL(process.argv[1]).href) await supervise();

