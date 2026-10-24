import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// A child that speaks JSON lines on stdout; next(match) waits for the first unclaimed line that
// matches. Every child is SIGKILLed at test end if still running.
export function spawnLines(t, file, args = [], { env = {}, input } = {}) {
  const home = env.HOME ?? mkdtempSync(join(tmpdir(), 'relay-child-'));
  const child = spawn(process.execPath, [file, ...args], { env: { PATH: process.env.PATH, HOME: home, USER: 'test-user',
    XDG_CONFIG_HOME: join(home, 'config'), XDG_STATE_HOME: join(home, 'state'),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  t.after(async () => {
    for (const w of waiters) clearTimeout(w.timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    if (!env.HOME) rmSync(home, { recursive: true, force: true });
  });
  const unclaimed = [], waiters = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    let value; try { value = JSON.parse(line); } catch { value = { type: 'raw', line }; }
    const w = waiters.find((x) => x.match(value));
    if (w) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(value); } else unclaimed.push(value);
  });
  if (input !== undefined) child.stdin.end(input);
  // 'close', not 'exit': stdout and stderr are drained by then, so stderr() and every line are complete.
  const exited = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  return {
    child, exited, stderr: () => stderr,
    send: (line) => child.stdin.write(`${line}\n`),
    next(match, ms = 15000) {
      const i = unclaimed.findIndex(match);
      if (i !== -1) return Promise.resolve(unclaimed.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { match, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timed out in ${file}; stderr: ${stderr}`)); }, ms) };
        waiters.push(w);
      });
    },
  };
}
