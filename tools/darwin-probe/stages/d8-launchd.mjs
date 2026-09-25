import { writeFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fleetBase, killParents, PARENT_ROW_CUT, parentCapture, parentRowCut, startFleet } from '../lib/fleet.mjs';
export async function run(ctx) {
  // Reap in a minimal environment, on a fleet of its own (D5's parents are gone by now).
  const base = await fleetBase(ctx, join(ctx.root, 'd8-state'));
  const fleet = await startFleet(ctx, base, { count: 4, prefix: 'q' });
  try {
    const parent_capture = parentCapture(fleet[0].pid, 'd8-parent');
    if (parentRowCut(parent_capture)) return { status: 'error', reason: PARENT_ROW_CUT, observations: { parent_capture } };
    const before = await base.registry.read();
    await killParents(ctx, fleet.slice(0, 2));
    const minimal = { HOME: ctx.root, PATH: `/usr/bin:/bin:${dirname(process.execPath)}`, RELAY_STATE_DIR: base.env.RELAY_STATE_DIR };
    const r = await ctx.t.run('/usr/bin/env', ['-i', ...Object.entries(minimal).map(([k, v]) => `${k}=${v}`), process.execPath, join(ctx.clone, 'bin/relay.js'), '--json', 'reap']);
    ctx.log(`reap: exit ${r.exit}\n${r.stdout}${r.stderr}`);
    const after = await base.registry.read();
    const live = fleet.slice(2).map((p) => p.id);
    const reap = { exit: r.exit, kept: Object.keys(after?.agents ?? {}), expected_kept: live,
      handles_unchanged: live.every((id) => after?.agents[id] && JSON.stringify(after.agents[id].process) === JSON.stringify(before?.agents[id]?.process)) };
    // The command relay's installer renders for PreToolUse, from its own hook planner. The
    // installer CLI would demand capability evidence first; rendering needs none.
    const deny = join(ctx.root, 'd8-deny.sh');
    writeFileSync(deny, '#!/bin/sh\nprintf \'{"decision":"deny","reason":"d8 probe"}\'\n', { mode: 0o755 });
    const subs = join(ctx.root, 'xdg/relay/d8-subscribers.json');
    writeFileSync(subs, JSON.stringify({ schema: 1, subscribers: [{ name: 'd8-deny', role: 'guard', kinds: ['before-tool'], harnesses: ['claude-code'], argv: [deny], timeoutMs: 5000 }] }), { mode: 0o600 });
    const { planHooks } = await import(pathToFileURL(join(ctx.clone, 'src/install/hooks.js')).href);
    const rendered = JSON.parse(planHooks({ text: '{}', harness: 'claude-code', relayBin: realpathSync(join(ctx.clone, 'bin/relay.js')), subscribersPath: subs }));
    const command = rendered.hooks.PreToolUse.flatMap((e) => e.hooks).find((h) => / hook /.test(h.command))?.command;
    if (!command) return { status: 'error', reason: 'planHooks rendered no PreToolUse relay command', observations: { parent_capture, reap } };
    const payload = JSON.stringify({ session_id: 'd8', cwd: base.repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' } });
    const h = await ctx.t.run('/bin/sh', ['-c', command], { env: { ...base.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, input: payload });
    return { status: 'ran', observations: { parent_capture, reap, hook_path: { exit: h.exit, denied: h.stdout.includes('"permissionDecision":"deny"'), stderr_head: h.stderr.slice(0, 400), command } } };
  } finally { await killParents(ctx, fleet); }
}
