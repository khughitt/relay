import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync, appendFileSync as log } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SESSION_VARS = ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SESSION_ID', 'CODEX_THREAD_ID'];
export function isolatedEnv(root, base = process.env) {
  const env = { ...base };
  delete env.COLUMNS;
  for (const key of SESSION_VARS) delete env[key];
  return { ...env, RELAY_STATE_DIR: join(root, 'relay-state'), XDG_CONFIG_HOME: join(root, 'xdg'), XDG_STATE_HOME: join(root, 'state'),
    XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), CLAUDE_CONFIG_DIR: join(root, 'claude'), CODEX_HOME: join(root, 'codex'),
    // Temporary files too: relay's tests, npm, OpenCode and Node's own caches otherwise land in
    // the host's TMPDIR, outside the root the run removes.
    TMPDIR: join(root, 'tmp') };
}
export function prepareRoot(root) {
  for (const dir of ['state', 'data', 'cache', 'claude', 'codex', 'tmp']) mkdirSync(join(root, dir), { recursive: true });
  mkdirSync(join(root, 'xdg/relay'), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'relay-state'), { mode: 0o700 });
}
// relay's registry functions take `paths`; without it they use the ambient default, which on
// the Mac is the user's live registry.
export async function registryFor(clone, env) {
  const relay = await import(pathToFileURL(join(clone, 'src/index.js')).href);
  const paths = relay.paths(env);
  return { paths, read: () => relay.readSnapshot({ paths }), list: () => relay.listAgents({ paths }), reap: () => relay.reapRegistry({ paths }) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A child with no pid never started. The cause arrives a tick later as child.spawnError; the
// synchronous check names the program only (its basename, so no path reaches a stage record).
export function requireStarted(child, cmd) {
  if (!child.pid) throw new Error(`cannot start ${basename(cmd)}: ${child.spawnError?.code ?? 'spawn failed'}`);
  return child;
}
export function tracker(root) {
  const file = join(root, 'pids'), groups = new Map();
  let stopping = false, sweeper = null;
  const save = () => writeFileSync(file, [...groups.keys()].map((g) => `-${g}\n`).join(''));
  const alive = (pgid) => { try { process.kill(-pgid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
  // Retire a group once it is empty, whichever member exits last; only owned, non-empty groups
  // are ever signalled, which bounds the window in which a reused pgid could be hit.
  const sweep = () => {
    let changed = false;
    for (const pgid of groups.keys()) if (!alive(pgid)) { groups.delete(pgid); changed = true; }
    if (changed) save();
    if (!groups.size && sweeper) { clearInterval(sweeper); sweeper = null; }
  };
  const refuse = () => { if (stopping) throw new Error('probe is stopping'); };
  // Every child leads its own process group, so one signal reaches everything it forks.
  const spawnTracked = (cmd, args, options = {}) => {
    refuse();
    const child = spawn(cmd, args, { ...options, detached: true });
    // Retire eagerly on the leader's own exit too, not only on the 250ms tick: a fast-lived
    // child (no grandchildren) would otherwise leave its group, and the sweeper interval,
    // alive for up to 250ms after the caller has moved on and may have torn down `root`.
    // A spawn failure (ENOENT, EACCES) is emitted as 'error' on the next tick; unheard, it would
    // crash the probe. Record it on the child; callers that spawn directly check requireStarted.
    child.on('error', (error) => { child.spawnError = error; });
    if (child.pid) { groups.set(child.pid, child); save(); child.once('exit', sweep); sweeper ??= setInterval(sweep, 250); sweeper.unref?.(); }
    return child;
  };
  const kill = async (pgid) => {
    if (!groups.has(pgid)) return;
    if (alive(pgid)) { try { process.kill(-pgid, 'SIGKILL'); } catch {} }
    for (const until = Date.now() + 5000; alive(pgid) && Date.now() < until;) await sleep(50);
    sweep();
  };
  const fork = (module, args, options = {}) => spawnTracked(process.execPath, [module, ...args], { ...options, stdio: options.stdio ?? ['ignore', 'ignore', 'inherit', 'ipc'] });
  // stdin is a pipe only when there is input to send. A child may exit without reading it
  // (`python3 --version`), so EPIPE on stdin is expected; any other stdin error is reported in
  // the result's stderr rather than escaping as an unhandled stream error.
  const run = (cmd, args, { env, cwd, input, timeoutMs = 600000, argv0 } = {}) => new Promise((resolve, reject) => {
    let child; try { child = spawnTracked(cmd, args, { env, cwd, argv0, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] }); } catch (error) { reject(error); return; }
    const started = performance.now();
    let stdout = '', stderr = '', stdinError = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { kill(child.pid); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); resolve({ exit: null, signal: null, stdout, stderr: `${stderr}${error.message}\n`, ms: performance.now() - started }); });
    child.once('close', (exit, signal) => { clearTimeout(timer); resolve({ exit, signal, stdout, stderr: stderr + stdinError, ms: performance.now() - started }); });
    if (input !== undefined) {
      child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') stdinError = `stdin: ${error.message}\n`; });
      child.stdin.end(input);
    }
  });
  const killAll = async () => {
    for (const until = Date.now() + 10000; groups.size && Date.now() < until;) { await Promise.all([...groups.keys()].map(kill)); sweep(); }
    return { survivors: [...groups.keys()].filter(alive) };
  };
  return { spawn: spawnTracked, fork, run, kill, killAll, stop: () => { stopping = true; }, get stopping() { return stopping; } };
}
// Live sessions the user keeps open (D9) write transcripts under ~/.claude and ~/.codex, so
// those two are watched by their configuration and credential files only.
export const WATCHED_FILES = ['.claude/settings.json', '.claude/settings.local.json', '.claude/.credentials.json',
  '.codex/hooks.json', '.codex/config.toml', '.codex/auth.json'];
export const WATCHED_TREES = ['.config/relay', '.local/state/relay', '.config/opencode', '.local/share/opencode', '.cache/opencode'];
function tree(path) {
  let files = 0, size = 0, mtimeMs = 0;
  const walk = (p) => { const s = lstatSync(p); mtimeMs = Math.max(mtimeMs, s.mtimeMs);
    if (s.isDirectory()) for (const name of readdirSync(p)) walk(join(p, name)); else { files++; size += s.size; } };
  walk(path);
  return { exists: true, files, size, mtimeMs };
}
export function fingerprint(home) {
  const out = {};
  for (const rel of [...WATCHED_FILES, ...WATCHED_TREES]) {
    const path = join(home, rel);
    out[rel] = existsSync(path) ? tree(path) : { exists: false, files: 0, size: 0, mtimeMs: 0 };
  }
  return out;
}
export const changedPaths = (before, after) => Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
// The gating reading is the one before D9 when D9 ran (it invites live sessions that may write
// their own config); whatever changed from there to the end is recorded, not gated.
// The ops guard probe writes a harness's refreshed login back to the live file (ops-4130ea).
// D7 reads that file just before and after the live run it drives; a change is the write-back,
// not the probe's own, only when those readings are the run's own before and after readings,
// so nothing else touched the file.
export function isolationOf(before, beforeD9, final, writes = []) {
  const after = beforeD9 ?? final, same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const wroteBack = (path) => writes.some((w) => w.path === path && same(w.before, before[path]) && same(w.after, after[path]));
  const all = changedPaths(before, after), changed = all.filter((p) => !wroteBack(p)), written_back = all.filter(wroteBack);
  if (!beforeD9) return { before, after, after_taken: 'finalize', changed, written_back, changed_during_d9: [] };
  return { before, after, after_taken: 'before D9', changed, written_back, final, changed_during_d9: changedPaths(beforeD9, final) };
}
export const credentialWrites = (d7) => Object.values(d7?.observations ?? {}).map((h) => h?.credential_write).filter(Boolean);
export function writeStage(resultsDir, id, record) {
  mkdirSync(join(resultsDir, 'stages'), { recursive: true });
  writeFileSync(join(resultsDir, 'stages', `${id}.json`), `${JSON.stringify({ id, ...record }, null, 2)}\n`);
}
export function stageLog(resultsDir, id) {
  mkdirSync(join(resultsDir, 'logs'), { recursive: true });
  return (line) => log(join(resultsDir, 'logs', `${id}.log`), `${line}\n`);
}
