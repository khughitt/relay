import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registryFor } from './context.mjs';
import { capture, stripCapture } from './ps.mjs';
import { installShell, startParent } from './parents.mjs';
export async function fleetBase(ctx, stateDir) {
  mkdirSync(stateDir, { mode: 0o700, recursive: true });
  const env = { ...ctx.env, RELAY_STATE_DIR: stateDir };
  const subscribers = join(ctx.root, 'xdg/relay/subscribers.json');
  writeFileSync(subscribers, '{"schema":1,"subscribers":[]}\n', { mode: 0o600 });
  const repo = join(ctx.root, 'fleet-repo'); mkdirSync(repo, { recursive: true }); execFileSync('git', ['init', '-q', repo]);
  // A short path (the root is /tmp/rdp.XXXXXX) keeps D5 and D8 independent of the ps width
  // question D4 owns; parentCapture below confirms it on the Mac rather than assuming it.
  const shell = installShell(join(ctx.root, 'p'), 'codex');
  const { createProcessOps } = await import(pathToFileURL(join(ctx.clone, 'src/index.js')).href);
  return { env, subscribers, repo, shell, ops: createProcessOps(), registry: await registryFor(ctx.clone, env) };
}
export async function startFleet(ctx, base, { count, prefix, extraSteps = () => [] }) {
  const parents = Array.from({ length: count }, (_, i) => {
    const id = `${prefix}${i}`;
    const p = startParent(ctx.t, { shell: base.shell, clone: ctx.clone, workdir: join(ctx.root, 'fleet', id), env: base.env,
      plan: { harness: 'codex', subscribers: base.subscribers, steps: [{ event: 'SessionStart', outerMs: 600000, payload: { session_id: id, cwd: base.repo } }, ...extraSteps(id)] } });
    return { id: `codex:${id}`, pid: p.pid, handle: base.ops.handleOf(p.pid), done: p.done };
  });
  const steps = await Promise.all(parents.map((p) => p.done()));
  return parents.map((p, i) => ({ ...p, steps: steps[i] }));
}
export const killParents = (ctx, parents) => Promise.all(parents.map((p) => ctx.t.kill(p.pid)));
// Darwin's comm is the full executable path. If relay's own plain-width row reading of a
// constructed parent is cut, relay cannot name the harness and every constructed agent
// publishes process:null: D5 and D8 would then fail for a reason D4 owns. Callers record the
// capture either way and report that case as an error (release incomplete), not a failure.
export const PARENT_ROW_CUT = 'constructed parent row truncated: D5/D8 not independent of the ps width';
export const parentCapture = (pid, label) => stripCapture(capture(pid, label));
export const parentRowCut = (c) => c.forms.row.truncated === true;
