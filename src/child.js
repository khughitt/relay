import { spawn } from 'node:child_process';

export const OUTPUT_LIMIT = 64 * 1024;

// Runs one subscriber directly: no shell, the hook environment inherited untouched (no env
// option), stdin fed once, stdout/stderr each capped. It resolves a status instead of
// throwing so the dispatcher can classify a failure without losing partial output.
export function runChild(argv, input, { clock = performance.now.bind(performance), deadline, timeoutMs, spawnFn = spawn, limit = OUTPUT_LIMIT, graceMs = 200 } = {}) {
  const allowed = Math.min(timeoutMs, deadline - clock());
  if (allowed <= 0) return Promise.resolve({ status: 'timeout', exitCode: null, signal: null, stdout: '', stderr: '' });
  return new Promise((resolve) => {
    let child;
    try { child = spawnFn(argv[0], argv.slice(1), { shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { resolve({ status: 'spawn-failed', exitCode: null, signal: null, stdout: '', stderr: '', error }); return; }
    const out = { chunks: [], bytes: 0 }, err = { chunks: [], bytes: 0 };
    let status = 'exited', error, settled = false, grace;
    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(grace);
      resolve({ status, exitCode, signal, stdout: Buffer.concat(out.chunks).toString('utf8'), stderr: Buffer.concat(err.chunks).toString('utf8'), ...(error ? { error } : {}) });
    };
    const abort = (why, cause) => {
      if (status !== 'exited') return;
      status = why; error = cause;
      try { child.kill('SIGKILL'); } catch {}
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy();
      grace = setTimeout(() => finish(null, 'SIGKILL'), graceMs);
    };
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
