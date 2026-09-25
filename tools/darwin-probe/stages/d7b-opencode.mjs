import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { registryFor, requireStarted } from '../lib/context.mjs';
export const PINNED = '2.0.15';
export function pluginOutcome(log, pluginPath) {
  // The message and the plugin path must name the same event, not merely both appear
  // somewhere in a multi-line log: match them on one line.
  const lines = log.split('\n');
  const matches = (needle) => lines.some((line) => line.includes(needle) && line.includes(pluginPath));
  if (matches('configured plugin path must be a directory')) return 'rejected-file';
  if (matches('failed to load plugin')) return 'load-failed';
  if (matches('loading plugin')) return 'loaded';
  return 'none';
}
const freePort = () => new Promise((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
// The plugin-request endpoint and the readiness probe both run against a server this stage
// spawned itself; a request with no bound cannot be told from a server that has wedged, so
// every fetch here carries its own deadline instead of relying on the caller's loop.
const FETCH_MS = 5000;
export async function run(ctx) {
  if ((await ctx.t.run('/usr/bin/which', ['opencode'])).exit !== 0) return { status: 'absent', reason: 'opencode not installed', observations: {} };
  const version = /(\d+\.\d+\.\d+)/.exec((await ctx.t.run('opencode', ['--version'], { env: ctx.env })).stdout)?.[1] ?? null;
  const subs = join(ctx.root, 'xdg/relay/subscribers.json'); writeFileSync(subs, '{"schema":1,"subscribers":[]}\n', { mode: 0o600 });
  const configDir = join(ctx.root, 'xdg/opencode'); mkdirSync(configDir, { recursive: true });
  const install = await ctx.t.run(process.execPath, [join(ctx.clone, 'bin/relay.js'), 'install', '--harness', 'opencode', '--subscribers', subs,
    '--config-dir', configDir, '--artifact', join(ctx.root, 'd7b-artifact.json'), '--apply'], { env: ctx.env });
  ctx.log(`install: exit ${install.exit}\n${install.stderr}`);
  if (install.exit !== 0) return { status: 'error', reason: `relay install --harness opencode exited ${install.exit}`, observations: { version, install: { exit: install.exit } } };
  const project = join(ctx.root, 'd7b-project'); mkdirSync(project); execFileSync('git', ['init', '-q', project]);
  const password = randomBytes(18).toString('base64url'), port = await freePort(), base = `http://127.0.0.1:${port}`;
  // The tracker makes the server lead its own process group: `opencode` forks the process that
  // keeps serving, and a signal to the spawned pid alone leaves that child running (observed
  // on the Linux host with v2.0.15).
  const server = requireStarted(ctx.t.spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: ctx.root, env: { ...ctx.env, OPENCODE_SERVER_PASSWORD: password }, stdio: 'ignore' }), 'opencode');
  const auth = { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` };
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/`, { signal: AbortSignal.timeout(FETCH_MS) }); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  // v2.0.15 creates no project instance at startup; this request names the project, and the
  // plugin loads with that instance.
  const url = `${base}/api/plugin?${new URLSearchParams({ 'location[directory]': project })}`;
  const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(FETCH_MS) }).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  // macOS resolves /var to /private/var; the server may report either form for the same
  // project, so both the given path and its realpath count as a match.
  const realProject = (() => { try { return realpathSync(project); } catch { return project; } })();
  const request = { status: res?.status ?? null, directory_match: body?.location?.directory === project || body?.location?.directory === realProject };
  const registry = await registryFor(ctx.clone, ctx.env);
  const opencodeAgents = async () => Object.entries((await registry.read())?.agents ?? {}).filter(([id]) => id.startsWith('opencode:'));
  const started = performance.now(); let agents = [];
  while (performance.now() - started < 10000) { agents = await opencodeAgents(); if (agents.length) break; await new Promise((r) => setTimeout(r, 200)); }
  // Every process in the server's group counts as the server: `opencode` forks the one that serves.
  const serverPids = execFileSync('/bin/ps', ['-axo', 'pid=,pgid='], { encoding: 'utf8' }).trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter(([, g]) => g === server.pid).map(([p]) => p);
  const agent = { count: agents.length, scope: agents[0]?.[1]?.scope ?? null, matches_server: agents.length === 1 && serverPids.includes(agents[0][1].process?.pid) };
  // SIGTERM first so the plugin can deliver dispose; then the tracker kills and waits out the group.
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  await new Promise((r) => { const t = setTimeout(r, 10000); server.once('exit', () => { clearTimeout(t); r(); }); });
  await ctx.t.kill(server.pid);
  let gone = (await opencodeAgents()).length === 0, via = gone && agents.length ? 'dispose' : null;
  if (!gone) { await registry.reap(); gone = (await opencodeAgents()).length === 0; via = gone ? 'reap' : null; }
  const logDir = join(ctx.root, 'data/opencode/log');
  // The server may exit before it ever creates its log directory (a crash on startup, or the
  // plugin path being rejected before the server binds); a missing directory is a finding, not
  // a thrown error that would abort the stage before it can report what happened.
  const log = existsSync(logDir) ? readdirSync(logDir).map((f) => readFileSync(join(logDir, f), 'utf8')).join('\n') : '';
  const pluginPath = JSON.parse(readFileSync(join(configDir, 'opencode.json'), 'utf8')).plugin?.[0] ?? '';
  return { status: 'ran', observations: { version, pinned: PINNED, version_match: version === PINNED, install: { exit: install.exit },
    request, plugin_log: pluginOutcome(log, pluginPath.replace(/\/plugin\.js$/, '')), appeared: agents.length > 0, ms: performance.now() - started, agent, after: { gone, via } } };
}
