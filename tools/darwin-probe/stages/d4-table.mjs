import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkParent, installParent } from '../lib/parents.mjs';
import { requireStarted } from '../lib/context.mjs';
import { capture, ps, tableCounts } from '../lib/ps.mjs';
const REPORT = fileURLToPath(new URL('../lib/chain-report.mjs', import.meta.url));
const wait = async (path, ms = 20000) => { const until = Date.now() + ms; while (!existsSync(path)) { if (Date.now() > until) throw new Error(`timeout waiting for ${path}`); await new Promise((r) => setTimeout(r, 50)); } };
const normTty = (t) => (!t || t === '??' ? null : t.startsWith('tty') ? t : `tty${t}`);
// `script` starts its command in a new session, outside the group the tracker kills. Losing the
// pty hangs that session up; this sweep kills whatever the hangup left: the constructed parent
// at `path` (the root is unique to this run, so nothing else matches) and, as the leader of its
// own group, any payload still under it.
const killStray = (path) => {
  for (const line of ps(['-ww', '-axo', 'pid=,args=']).stdout.split('\n')) {
    const [, pid, args] = /^\s*(\d+)\s+(.*)$/.exec(line) ?? [];
    if (!pid || !(args === path || args.startsWith(`${path} `))) continue;
    for (const target of [-Number(pid), Number(pid)]) { try { process.kill(target, 'SIGKILL'); } catch {} }
  }
};
export async function run(ctx) {
  if (ctx.platform !== 'darwin') return { status: 'skipped', reason: 'darwin only', observations: {} };
  const { createProcessOps } = await import(pathToFileURL(join(ctx.clone, 'src/index.js')).href);
  const ops = createProcessOps();
  // A parent that cannot run is one stage error in seconds, not a 20 s report timeout.
  await checkParent(ctx.t, ctx.root, ctx.env);
  // 1. A chain under a pseudo-terminal whose `claude` executable path exceeds 100 characters.
  const longDir = join(ctx.root, 'l', 'x'.repeat(90));
  const claude = installParent(ctx.root, longDir, 'claude');
  const chainOut = join(ctx.root, 'd4-chain.json');
  // BSD script (macOS): `script [-q] file command...`. util-linux script takes `-c "command"`
  // instead, which is one reason D4 runs on Darwin only. The parent runs chain-report as its
  // child under the pty, then blocks.
  const script = requireStarted(ctx.t.spawn('script', ['-q', '/dev/null', claude, process.execPath, REPORT, ctx.clone, chainOut, 'claude-code'], { env: ctx.env, stdio: 'ignore' }), 'script');
  let chain;
  try {
    await wait(chainOut);
    chain = JSON.parse(readFileSync(chainOut, 'utf8'));
  } finally {
    await ctx.t.kill(script.pid);
    killStray(claude);
  }
  // 2. A Claude-shaped native install: …/claude/versions/9.9.9 started as `9.9.9`.
  const versioned = installParent(ctx.root, join(ctx.root, 'n/claude/versions'), '9.9.9');
  const nativeOut = join(ctx.root, 'd4-native.json');
  // The parent blocks after the report, so it is still alive for executableOf.
  const native = requireStarted(ctx.t.spawn(versioned, [process.execPath, REPORT, ctx.clone, nativeOut, 'claude-code'], { env: ctx.env, argv0: '9.9.9', stdio: 'ignore' }), versioned);
  let nat, executable = null;
  try {
    await wait(nativeOut);
    nat = JSON.parse(readFileSync(nativeOut, 'utf8'));
    try { executable = ops.executableOf(native.pid); } catch (e) { executable = `error:${e.code}`; }
  } finally {
    await ctx.t.kill(native.pid);
  }
  // 3. argvOf on an executable path and arguments with spaces.
  const spaced = installParent(ctx.root, join(ctx.root, 'sp ace'), 's h');
  // The parent's own argv is what is read; it blocks whatever its /bin/sleep payload does.
  const sp = requireStarted(ctx.t.spawn(spaced, ['/bin/sleep', '300', 'arg with space'], { env: ctx.env, stdio: 'ignore' }), spaced);
  let argv = null, argvError = null, spCapture;
  try {
    await new Promise((r) => setTimeout(r, 300));
    try { argv = ops.argvOf(sp.pid); } catch (e) { argvError = e.code; }
    spCapture = capture(sp.pid, 'argv-spaces');
  } finally {
    await ctx.t.kill(sp.pid);
  }
  const commWw = chain.capture.forms.comm.ww;
  const comm_kind = commWw === claude ? 'path' : commWw === 'claude' || commWw === claude.split('/').pop() ? 'argv0' : 'other';
  return { status: 'ran', observations: {
    chain: { ancestors_match: JSON.stringify(chain.ancestors_relay) === JSON.stringify(chain.ancestors_ps.slice(0, chain.ancestors_relay.length)),
      tty_match: chain.tty_relay === normTty(chain.tty_ps), resolved: chain.resolved, expected: chain.ppid, error: chain.error },
    native: { recognized: nat.resolved === nat.ppid, executable, executable_absolute: typeof executable === 'string' && executable.startsWith('/') },
    argv: { expected_argv0: spaced, result: argv, error: argvError, ok: argvError === 'PROCESS_UNREADABLE' || argv?.[0] === spaced },
    captures: [chain.capture, nat.capture, spCapture].map((c) => ({ pid: c.pid, label: c.label, truncated: c.truncated, forms: c.forms })),
    comm_kind, table: tableCounts() } };
}
