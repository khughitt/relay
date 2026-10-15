// @ts-check
import { spawn } from 'node:child_process';

export const OUTPUT_LIMIT = 64 * 1024;

// Runs one subscriber directly: no shell, the hook environment inherited untouched (no env
// option), stdin fed once, stdout/stderr each capped. It resolves a status instead of
// throwing so the dispatcher can classify a failure without losing partial output.
/** @param {string[]} argv @param {string} input @param {{clock?: () => number, deadline: number, timeoutMs: number, spawnFn?: typeof spawn, limit?: number, graceMs?: number}} options @returns {Promise<import("./types.js").ChildResult>} */
export function runChild(argv, input, { clock = performance.now.bind(performance), deadline, timeoutMs, spawnFn = spawn, limit = OUTPUT_LIMIT, graceMs = 200 } = /** @type {NonNullable<Parameters<typeof runChild>[2]>} */ ({})) {
  const allowed = Math.min(timeoutMs, deadline - clock());
  if (allowed <= 0) return Promise.resolve({ status: 'timeout', exitCode: null, signal: null, stdout: '', stderr: '' });
  return new Promise((resolve) => {
    let child;
    try { child = spawnFn(argv[0], argv.slice(1), { shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (caught) { const error = /** @type {import('./types.js').Failure} */ (caught); resolve({ status: 'spawn-failed', exitCode: null, signal: null, stdout: '', stderr: '', error }); return; }
    /** @type {{chunks: Buffer[], bytes: number}} */
    const out = { chunks: [], bytes: 0 }, err = { chunks: /** @type {Buffer[]} */ ([]), bytes: 0 };
    let status = 'exited', settled = false;
    /** @type {unknown} */
    let error;
    /** @type {NodeJS.Timeout|undefined} */
    let grace;
    /** @param {number|null} exitCode @param {string|null} signal */
    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(grace);
      resolve({ status, exitCode, signal, stdout: Buffer.concat(out.chunks).toString('utf8'), stderr: Buffer.concat(err.chunks).toString('utf8'), ...(error ? { error } : {}) });
    };
    /** @param {string} why @param {unknown} [cause] */
    const abort = (why, cause) => {
      if (status !== 'exited') return;
      status = why; error = cause;
      try { child.kill('SIGKILL'); } catch {}
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy();
      grace = setTimeout(() => finish(null, 'SIGKILL'), graceMs);
    };
    /** @param {{chunks: Buffer[], bytes: number}} sink @returns {(chunk: Buffer|string) => void} */
    const collect = (sink) => (chunk) => {
      const buffer = Buffer.from(chunk), remaining = limit - sink.bytes;
      if (remaining > 0) sink.chunks.push(buffer.subarray(0, remaining));
      sink.bytes += buffer.length;
      if (sink.bytes > limit) abort('output-exceeded');
    };
    const timer = setTimeout(() => abort('timeout'), allowed);
    child.stdout.on('data', collect(out)); child.stderr.on('data', collect(err));
    child.once('error', (cause) => { error = cause; if (status === 'exited') abort('spawn-failed', cause); finish(null, null); });
    child.once('close', (code, signal) => finish(code, signal));
    child.stdin.on('error', () => {}); // an early exit closes stdin; the exit status is the useful signal
    child.stdin.end(input);
  });
}
