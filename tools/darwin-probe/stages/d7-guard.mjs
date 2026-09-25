import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registryFor } from '../lib/context.mjs';
import { stripCapture } from '../lib/ps.mjs';
const WRAPPER = fileURLToPath(new URL('../lib/relay-wrapper.mjs', import.meta.url));
const PS = new URL('../lib/ps.mjs', import.meta.url).href;
const HARNESS_COMM = { 'claude-code': (c) => c === 'claude' || /^\d+\.\d+\.\d+$/.test(c), codex: (c) => c === 'codex' };
export function identityProof(agents, invocations, parseRow, harness) {
  const list = Object.entries(agents);
  const proven = ([id, a]) => a.process && invocations.some((inv) => {
    if (inv.agent_id !== id) return false;
    if (inv.resolved !== a.process.pid || !inv.ancestors?.some((r) => r.pid === a.process.pid)) return false;
    const row = inv.captures?.find((c) => c.pid === a.process.pid)?.forms?.row?.ww;
    if (!row) return false;
    try { const parsed = parseRow(row); return parsed.starttime === a.process.start && HARNESS_COMM[harness](basename(parsed.comm)); } catch { return false; }
  });
  const matched = list.filter(proven).length;
  return { agents: list.length, matched, ok: list.length > 0 && matched === list.length };
}
const PROVEN = `import json, runpy, sys
proven = runpy.run_path(sys.argv[1])["proven"]
print(json.dumps(bool(proven(json.load(open(sys.argv[2])), json.load(open(sys.argv[3]))))))`;
async function oneHarness(ctx, harness, token) {
  const name = harness === 'claude-code' ? 'claude' : 'codex';
  if ((await ctx.t.run('/usr/bin/which', [name])).exit !== 0) return { status: 'absent', reason: `${name} not installed` };
  const out = join(ctx.root, 'd7'); mkdirSync(out, { recursive: true });
  const hooks = join(out, `${harness}-hooks.jsonl`);
  // Fresh per harness run: the ops probe's own preflight replay runs (through the wrapper)
  // before every attempt, both --skip-live and the live one below, so a stale file would mix a
  // prior run's invocations into this one's.
  writeFileSync(hooks, '');
  const env = { ...ctx.env, DARWIN_PROBE_HOOKS: hooks, DARWIN_PROBE_PS: PS };
  if (harness === 'claude-code') {
    if (!existsSync(join(homedir(), '.claude/.credentials.json'))) { if (!token) return { status: 'skipped', reason: 'no credentials file and no token' }; env.CLAUDE_CODE_OAUTH_TOKEN = token; }
  } else if (!existsSync(join(homedir(), '.codex/auth.json'))) return { status: 'skipped', reason: 'codex credentials not in ~/.codex/auth.json (keychain?)' };
  const wrapperDir = join(ctx.clone, 'node_modules/.darwin-probe'), wrapper = join(wrapperDir, 'relay.js');
  mkdirSync(wrapperDir, { recursive: true }); copyFileSync(WRAPPER, wrapper); chmodSync(wrapper, 0o755);
  // Node 22.0-22.6 do not detect ESM syntax without a package boundary above the file, and
  // node_modules/ has none of relay's own package.json between it and the wrapper.
  writeFileSync(join(wrapperDir, 'package.json'), '{"type":"module"}\n');
  const probe = join(ctx.opsClone, 'bin/relay-guard-probe');
  const args = ['--harness', harness, '--relay', wrapper, '--guard', join(ctx.opsClone, 'hooks/relay-guard'), '--out', out];
  const pre = await ctx.t.run('python3', [probe, ...args, '--skip-live'], { env });
  ctx.log(`preflight ${harness}: exit ${pre.exit}\n${pre.stderr}`);
  if (pre.exit !== 0) return { status: 'error', reason: `preflight exited ${pre.exit}`, preflight: { allow: false, deny: false } };
  const replay = JSON.parse(readFileSync(join(out, harness, 'results.json'), 'utf8')).replay;
  const preflight = { allow: !!replay?.clean?.reply?.includes('additionalContext'), deny: replay?.attribution?.exit === 2 && replay.attribution.reply.includes('"deny"') };
  if (!preflight.allow || !preflight.deny) return { status: 'ran', preflight, proven: false, hook: { invocations: 0, truncated: false }, handle: { agents: 0, matched: 0, ok: false }, reason: 'preflight replies wrong' };
  const live = await ctx.t.run('python3', [probe, ...args], { env, timeoutMs: 3600000 });
  ctx.log(`live ${harness}: exit ${live.exit}\n${live.stderr}`);
  const results = join(out, harness, 'results.json'), evidence = join(out, harness, 'evidence.json');
  if (!existsSync(results) || !existsSync(evidence)) return { status: 'error', reason: `live run exited ${live.exit} without results`, preflight };
  const again = await ctx.t.run('python3', ['-c', PROVEN, probe, results, evidence]);
  if (again.exit !== 0) return { status: 'error', reason: `proven check exited ${again.exit}: ${again.stderr.slice(0, 200)}`, preflight };
  // The ops probe's own preflight replay publishes `<harness>:probe-replay` (process: null,
  // never a real session) before every attempt, both --skip-live and the live run below; it
  // can never be proven and must not count against D7w, so it is excluded from both the
  // registry agents identityProof sees and the invocations recorded here.
  const replaySession = `${harness}:probe-replay`;
  const invocations = (existsSync(hooks) ? readFileSync(hooks, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
    .filter((i) => i.agent_id !== replaySession)
    .map((i) => ({ ...i, captures: i.captures?.map(stripCapture) }));
  const { parseDarwinRow } = await import(pathToFileURL(join(ctx.clone, 'src/bus/proc.js')).href);
  const registry = await registryFor(ctx.clone, { ...ctx.env, RELAY_STATE_DIR: join(out, harness, 'state') });
  const snap = await registry.read();
  const agents = Object.fromEntries(Object.entries(snap?.agents ?? {}).filter(([id]) => id !== replaySession));
  const summary = JSON.parse(readFileSync(results, 'utf8'));
  return { status: 'ran', credentials: summary.credentials, preflight, proven: JSON.parse(again.stdout),
    hook: { invocations: invocations.length, truncated: invocations.some((i) => i.captures?.some((c) => c.truncated)) },
    handle: identityProof(agents, invocations, parseDarwinRow, harness),
    invocations, summary: { version: summary.version, attempt: summary.attempt, complete: summary.complete, results: summary.results },
    evidence: JSON.parse(readFileSync(evidence, 'utf8')) };
}
// The Claude token was asked for at probe startup (probe.mjs) and lives in ctx.token only; it
// reaches the Claude runs as CLAUDE_CODE_OAUTH_TOKEN in that one child's environment.
export async function run(ctx) {
  if (ctx.platform !== 'darwin') return { status: 'skipped', reason: 'darwin only', observations: {} };
  return { status: 'ran', observations: { 'claude-code': await oneHarness(ctx, 'claude-code', ctx.token ?? null), codex: await oneHarness(ctx, 'codex', null) } };
}
