// parents.mjs — a constructed harness parent: parent.c compiled on the host and installed under
// the harness's name, so relay's adapter (nearest ancestor whose comm is the harness, no
// terminal required) names it. Not a copy of /bin/sh: macOS kills a copied Apple platform
// binary launched from /tmp before it runs anything.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireStarted } from './context.mjs';
const TIMED = fileURLToPath(new URL('./timed-hook.mjs', import.meta.url));
const SOURCE = fileURLToPath(new URL('./parent.c', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstLine = (text) => String(text).trim().split('\n')[0].slice(0, 200);
const built = new Map();
// Compiled once per root into <root>/bin/parent. Bounded: a wedged compiler is a stage error.
export function buildParent(root) {
  if (built.has(root)) return built.get(root);
  const out = join(root, 'bin/parent');
  mkdirSync(join(root, 'bin'), { recursive: true });
  const r = spawnSync('cc', ['-O2', '-o', out, SOURCE], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL' });
  if (r.error || r.status !== 0) {
    const why = r.error ? (r.error.code ?? r.error.message) : `exit ${r.status ?? r.signal}: ${firstLine(r.stderr) || 'no stderr'}`;
    throw new Error(`cc could not build the constructed parent: ${why}`);
  }
  built.set(root, out);
  return out;
}
const place = (binary, dir, name) => {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name); copyFileSync(binary, path); chmodSync(path, 0o755); return path;
};
// The path's basename is the harness name the adapter matches.
export const installParent = (root, dir, name) => place(buildParent(root), dir, name);
// A parent that cannot run its payload is one clear error in seconds, not a fleet timeout.
// `binary` is the compiled parent to install; the default builds it for this root.
export async function checkParent(t, root, env, binary = buildParent(root)) {
  const dir = join(root, 'pcheck'), out = join(dir, 'ok');
  const parent = place(binary, dir, 'codex');
  rmSync(out, { force: true });
  let child;
  try { child = requireStarted(t.spawn(parent, [process.execPath, '-e', "require('fs').writeFileSync(process.argv[1], 'ok')", out], { env, stdio: ['ignore', 'ignore', 'pipe'] }), parent); }
  catch (error) { throw new Error(`constructed parent could not run: ${error.message}`); }
  let stderr = '', ended = null;
  child.stderr.on('data', (d) => { stderr += d; });
  child.once('exit', (code, signal) => { ended = { code, signal }; });
  try {
    for (const until = Date.now() + 5000; !existsSync(out) && !ended && Date.now() < until;) await sleep(50);
    if (existsSync(out)) return;
    // Let a dying parent's exit status and stderr arrive before they are reported.
    await sleep(100);
    const how = ended ? `it exited (code=${ended.code}, signal=${ended.signal})` : 'no payload output within 5000ms';
    throw new Error(`constructed parent could not run: ${how}${stderr.trim() ? `; ${firstLine(stderr)}` : ''}`);
  } finally { await t.kill(child.pid); }
}
export function startParent(t, { parent, clone, plan, workdir, env, timeoutMs = 30000 }) {
  mkdirSync(workdir, { recursive: true });
  const steps = plan.steps.map((s, i) => ({ ...s, out: join(workdir, `step-${i}.json`) }));
  writeFileSync(join(workdir, 'plan.json'), JSON.stringify({ ...plan, clone, steps }));
  // The parent runs the hook as its child, then blocks by itself until the probe kills it.
  const child = requireStarted(t.spawn(parent, [process.execPath, TIMED, join(workdir, 'plan.json')], { env, stdio: 'ignore' }), parent);
  let ended = null;
  child.once('exit', (code, signal) => { ended = { code, signal }; });
  const done = async () => {
    const until = Date.now() + timeoutMs;
    while (!existsSync(join(workdir, 'done'))) {
      // A constructed parent never exits by itself: one that has is not coming back.
      if (ended) throw new Error(`parent ${child.pid} exited before finishing (code=${ended.code}, signal=${ended.signal})`);
      if (Date.now() > until) throw new Error(`parent ${child.pid} did not finish`);
      await sleep(50);
    }
    return steps.map((s) => JSON.parse(readFileSync(s.out, 'utf8')));
  };
  return { child, pid: child.pid, workdir, done };
}
