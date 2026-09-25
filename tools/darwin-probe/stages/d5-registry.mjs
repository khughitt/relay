import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fleetBase, killParents, startFleet } from '../lib/fleet.mjs';
const pretool = (id, repo) => ({ event: 'PreToolUse', outerMs: 600000, payload: { session_id: id, cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' } } });
const sessionEnd = (id, repo) => ({ event: 'SessionEnd', outerMs: 3000, payload: { session_id: id, cwd: repo } });
const sameHandles = (before, after, ids) => ids.every((id) => after.agents[id] && JSON.stringify(before.agents[id]?.process) === JSON.stringify(after.agents[id].process));
export async function run(ctx) {
  const all = [];
  try {
    // Concurrent writers.
    const base = await fleetBase(ctx, join(ctx.root, 'd5-state'));
    const eight = await startFleet(ctx, base, { count: 8, prefix: 'p' }); all.push(...eight);
    const snap = await base.registry.read();
    const concurrent = { expected: 8, present: eight.filter((p) => snap?.agents[p.id]).length,
      handles_match: eight.every((p) => JSON.stringify(snap?.agents[p.id]?.process) === JSON.stringify(p.handle)),
      platforms: [...new Set(eight.map((p) => snap?.agents[p.id]?.process?.platform))], boot_ids_null: eight.every((p) => snap?.agents[p.id]?.process?.bootId === null) };
    // Lock recovery through relay's own worker fixture, forked under the tracker.
    const lockPath = base.registry.paths.lockPath;
    const worker = ctx.t.fork(join(ctx.clone, 'test/fixtures/lock-worker.js'), ['hold-main', base.env.RELAY_STATE_DIR]);
    const next = () => new Promise((r) => worker.once('message', r));
    await next(); worker.send('start'); await next();
    let holder = null; try { holder = JSON.parse(readFileSync(lockPath, 'utf8')).holder ?? null; } catch (e) { holder = `unreadable: ${e.code ?? e.message}`; }
    await ctx.t.kill(worker.pid);
    const { withLock } = await import(pathToFileURL(join(ctx.clone, 'src/bus/lock.js')).href);
    let recovered = false, value = null; try { value = (await withLock(lockPath, () => 42)).value; recovered = value === 42; } catch (e) { value = e.code ?? e.message; }
    // Reap: kill four, keep four.
    await killParents(ctx, eight.slice(0, 4));
    const reaped = await base.registry.reap();
    const after = await base.registry.read();
    const reap = { removed: eight.filter((p) => !after?.agents[p.id]).map((p) => p.id), kept: eight.filter((p) => after?.agents[p.id]).map((p) => p.id),
      expected_removed: eight.slice(0, 4).map((p) => p.id), expected_kept: eight.slice(4).map((p) => p.id), reaped: reaped.reaped?.length ?? null };
    await killParents(ctx, eight.slice(4));
    // Cost with 0, 10 and 50 live agents: fresh state per size.
    const cost = {};
    for (const n of [0, 10, 50]) {
      const b = await fleetBase(ctx, join(ctx.root, `d5-cost-${n}`));
      const live = await startFleet(ctx, b, { count: n, prefix: `c${n}-` }); all.push(...live);
      const [timed] = await startFleet(ctx, b, { count: 1, prefix: `t${n}-`, extraSteps: (id) => [pretool(id, b.repo), sessionEnd(id, b.repo)] }); all.push(timed);
      const [, pre, end] = timed.steps, ids = live.map((p) => p.id);
      cost[`n${n}`] = { agents: n,
        pretool: { ms: pre.ms, exit: pre.exit, stderr: pre.stderr, allow: pre.exit === 0, retained: sameHandles(pre.before, pre.after, ids) && !!pre.after?.agents[timed.id] },
        sessionend: { ms: end.ms, exit: end.exit, stderr: end.stderr, ending_absent: !end.after?.agents[timed.id],
          revision_delta: (end.after?.revision ?? 0) - (end.before?.revision ?? 0), others_retained: sameHandles(end.before, end.after, ids) } };
      await killParents(ctx, [...live, timed]);
    }
    return { status: 'ran', observations: { concurrent, lock: { holder, recovered, value }, reap, cost } };
  } finally { await killParents(ctx, all); }
}
