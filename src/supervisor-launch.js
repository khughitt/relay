// @ts-check
// Starts the dispatch supervisor process. Kept tiny so `relay hook` can start the supervisor before it
// loads its dispatch modules (plan amendment 1): the two Node startups overlap. The supervisor holds a
// provisional absolute deadline from its command line until the dispatcher's init frame, which may
// only shorten it; an early supervisor never adopted is released before the reply.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./supervisor-process.js', import.meta.url));

/** @param {{deadlineMs: number, env?: NodeJS.ProcessEnv, cwd?: string, spawnFn?: typeof spawn}} options @returns {import('node:child_process').ChildProcess} */
export function launchSupervisor({ deadlineMs, env = {}, cwd = '/', spawnFn = spawn }) {
  const deadlineNs = (process.hrtime.bigint() + BigInt(Math.max(0, Math.floor(deadlineMs * 1e6)))).toString();
  const child = spawnFn(process.execPath, [SCRIPT, '--relay-supervisor', deadlineNs], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], env, cwd, detached: false });
  child.stdio[3]?.on('error', () => {});
  child.once('error', () => {});
  return child;
}

/** Closes an early supervisor that was never adopted and waits for it to exit (it has no record). @param {import('node:child_process').ChildProcess} child @param {{waitMs?: number}} [options] */
export async function releaseSupervisor(child, { waitMs = 500 } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  /** @type {import('node:stream').Writable|undefined} */ (child.stdio[3])?.end();
  /** @type {import('node:stream').Readable|undefined} */ (child.stdio[4])?.resume();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, waitMs))]);
  if (child.exitCode === null && child.signalCode === null) { try { child.kill('SIGKILL'); } catch {} await exited; }
}
