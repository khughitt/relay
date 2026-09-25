import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ps } from '../lib/ps.mjs';
const HANG = '599.4242'; // a unique sleep argument, so a survivor is findable
const GUARDS = {
  allow: (dir) => { const p = join(dir, 'allow.sh'); writeFileSync(p, '#!/bin/sh\nprintf \'{"decision":"allow"}\'\n', { mode: 0o755 }); return [p]; },
  deny: (dir) => { const p = join(dir, 'deny.sh'); writeFileSync(p, '#!/bin/sh\nprintf \'{"decision":"deny","reason":"d6 probe"}\'\n', { mode: 0o755 }); return [p]; },
  hang: () => ['/bin/sleep', HANG],
};
export async function replay(ctx) {
  const dir = join(ctx.root, 'd6'); mkdirSync(dir, { recursive: true });
  const repo = join(dir, 'repo'); mkdirSync(repo); execFileSync('git', ['init', '-q', repo]);
  const rows = [];
  for (const harness of ['claude-code', 'codex']) for (const [guard, argv] of Object.entries(GUARDS)) {
    const subs = join(ctx.root, 'xdg/relay', `d6-${harness}-${guard}.json`);
    writeFileSync(subs, JSON.stringify({ schema: 1, subscribers: [{ name: `d6-${guard}`, role: 'guard', kinds: ['before-tool'], harnesses: [harness], argv: argv(dir), timeoutMs: 2000 }] }), { mode: 0o600 });
    const payload = JSON.stringify({ session_id: `d6-${harness}-${guard}`, cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' } });
    const r = await ctx.t.run(process.execPath, [join(ctx.clone, 'bin/relay.js'), 'hook', '--harness', harness, '--subscribers', subs, 'PreToolUse'], { env: ctx.env, input: payload });
    await new Promise((res) => setTimeout(res, 300));
    const survivors = ps(['-ww', '-axo', 'pid=,args=']).stdout.split('\n').filter((l) => l.includes(`sleep ${HANG}`)).map((l) => Number(l.trim().split(/\s+/)[0]));
    rows.push({ harness, guard, exit: r.exit, stdout: r.stdout, ms: r.ms, budget_ms: 2000, survivors });
  }
  return rows;
}
export async function run(ctx) {
  const expected = JSON.parse(readFileSync(join(ctx.bundle, 'expected/d6.json'), 'utf8'));
  const rows = await replay(ctx);
  const key = (r) => `${r.harness}/${r.guard}`, want = new Map(expected.map((r) => [key(r), r]));
  return { status: 'ran', observations: {
    replies: rows.map((r) => ({ harness: r.harness, guard: r.guard, exit: r.exit, stdout: r.stdout, expected_exit: want.get(key(r))?.exit, expected_stdout: want.get(key(r))?.stdout,
      match: want.has(key(r)) && want.get(key(r)).exit === r.exit && want.get(key(r)).stdout === r.stdout })),
    hang: rows.filter((r) => r.guard === 'hang').map((r) => ({ harness: r.harness, ms: r.ms, budget_ms: r.budget_ms, survivors: r.survivors })) } };
}
