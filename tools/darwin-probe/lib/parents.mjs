// parents.mjs — a constructed harness parent: a copy of /bin/sh named after the harness, so
// relay's adapter (nearest ancestor whose comm is the harness, no terminal required) names it.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireStarted } from './context.mjs';
const TIMED = fileURLToPath(new URL('./timed-hook.mjs', import.meta.url));
export function installShell(dir, name) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name); copyFileSync('/bin/sh', path); chmodSync(path, 0o755); return path;
}
export function startParent(t, { shell, clone, plan, workdir, env }) {
  mkdirSync(workdir, { recursive: true });
  const steps = plan.steps.map((s, i) => ({ ...s, out: join(workdir, `step-${i}.json`) }));
  writeFileSync(join(workdir, 'plan.json'), JSON.stringify({ ...plan, clone, steps }));
  execFileSync('mkfifo', [join(workdir, 'hold')]);
  // The hook runs as a non-final command so this shell stays its parent; `read` from a FIFO
  // nobody writes keeps it alive with no child until the probe kills it.
  const script = '"$1" "$2" "$3/plan.json"; read line < "$3/hold"';
  const child = requireStarted(t.spawn(shell, ['-c', script, 'parent', process.execPath, TIMED, workdir], { env, stdio: 'ignore' }), shell);
  const done = async (timeoutMs = 30000) => {
    const until = Date.now() + timeoutMs;
    while (!existsSync(join(workdir, 'done'))) { if (Date.now() > until) throw new Error(`parent ${child.pid} did not finish`); await new Promise((r) => setTimeout(r, 50)); }
    return steps.map((s) => JSON.parse(readFileSync(s.out, 'utf8')));
  };
  return { child, pid: child.pid, workdir, done };
}
