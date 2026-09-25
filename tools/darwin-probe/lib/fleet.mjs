import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registryFor } from './context.mjs';
import { capture, stripCapture } from './ps.mjs';
import { checkParent, installParent, startParent } from './parents.mjs';
export async function fleetBase(ctx, stateDir) {
  mkdirSync(stateDir, { mode: 0o700, recursive: true });
  const env = { ...ctx.env, RELAY_STATE_DIR: stateDir };
  const subscribers = join(ctx.root, 'xdg/relay/subscribers.json');
  writeFileSync(subscribers, '{"schema":1,"subscribers":[]}\n', { mode: 0o600 });
  const repo = join(ctx.root, 'fleet-repo'); mkdirSync(repo, { recursive: true }); execFileSync('git', ['init', '-q', repo]);
  // A short path (the root is /tmp/rdp.XXXXXX) keeps D5 and D8 independent of the ps width
  // question D4 owns; parentCapture below confirms it on the Mac rather than assuming it.
  // A parent that cannot run is one stage error now, not a fleet timeout later.
  await checkParent(ctx.t, ctx.root, env);
  const parent = installParent(ctx.root, join(ctx.root, 'p'), 'codex');
  const { createProcessOps } = await import(pathToFileURL(join(ctx.clone, 'src/index.js')).href);
  return { env, subscribers, repo, parent, ops: createProcessOps(), registry: await registryFor(ctx.clone, env) };
}
// Each publish probes every live agent, and on Darwin each probe is a ps spawn (~1,225 of them
// for a 50-agent fleet), so a fleet's wait scales with the agents live while it starts.
export const fleetTimeoutMs = (count, live = 0) => 30000 + 2000 * (count + live);
export async function startFleet(ctx, base, { count, prefix, live = 0, extraSteps = () => [] }) {
  const parents = [], timeoutMs = fleetTimeoutMs(count, live);
  try {
    for (let i = 0; i < count; i++) {
      const id = `${prefix}${i}`;
      const p = startParent(ctx.t, { parent: base.parent, clone: ctx.clone, workdir: join(ctx.root, 'fleet', id), env: base.env, timeoutMs,
        plan: { harness: 'codex', subscribers: base.subscribers, steps: [{ event: 'SessionStart', outerMs: 600000, payload: { session_id: id, cwd: base.repo } }, ...extraSteps(id)] } });
      parents.push({ id: `codex:${id}`, pid: p.pid, handle: base.ops.handleOf(p.pid), done: p.done });
    }
    const settled = await Promise.allSettled(parents.map((p) => p.done()));
    const failed = settled.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
    return parents.map((p, i) => ({ ...p, steps: settled[i].value }));
  } catch (error) {
    // A fleet that failed to start leaves nothing running behind the caller's back.
    await killParents(ctx, parents);
    throw error;
  }
}
export const killParents = (ctx, parents) => Promise.all(parents.map((p) => ctx.t.kill(p.pid)));
// Darwin's comm is the full executable path. If relay's own plain-width row reading of a
// constructed parent is cut, relay cannot name the harness and every constructed agent
// publishes process:null: D5 and D8 would then fail for a reason D4 owns. Callers record the
// capture either way and report that case as an error (release incomplete), not a failure.
export const PARENT_ROW_CUT = 'constructed parent row truncated: D5/D8 not independent of the ps width';
export const parentCapture = (pid, label) => stripCapture(capture(pid, label));
export const parentRowCut = (c) => c.forms.row.truncated === true;
