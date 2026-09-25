import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installShell } from '../lib/parents.mjs';
import { requireStarted } from '../lib/context.mjs';
import { capture, tableCounts } from '../lib/ps.mjs';
const REPORT = fileURLToPath(new URL('../lib/chain-report.mjs', import.meta.url));
const wait = async (path, ms = 20000) => { const until = Date.now() + ms; while (!existsSync(path)) { if (Date.now() > until) throw new Error(`timeout waiting for ${path}`); await new Promise((r) => setTimeout(r, 50)); } };
const normTty = (t) => (!t || t === '??' ? null : t.startsWith('tty') ? t : `tty${t}`);
export async function run(ctx) {
  if (ctx.platform !== 'darwin') return { status: 'skipped', reason: 'darwin only', observations: {} };
  const { createProcessOps } = await import(pathToFileURL(join(ctx.clone, 'src/index.js')).href);
  const ops = createProcessOps();
  // 1. A chain under a pseudo-terminal whose `claude` executable path exceeds 100 characters.
  const longDir = join(ctx.root, 'l', 'x'.repeat(90));
  const claude = installShell(longDir, 'claude');
  const chainOut = join(ctx.root, 'd4-chain.json');
  const script = requireStarted(ctx.t.spawn('script', ['-q', '/dev/null', claude, '-c', `"${process.execPath}" "${REPORT}" "${ctx.clone}" "${chainOut}" claude-code; true`], { env: ctx.env, stdio: 'ignore' }), 'script');
  let chain;
  try {
    await wait(chainOut);
    chain = JSON.parse(readFileSync(chainOut, 'utf8'));
  } finally {
    await ctx.t.kill(script.pid);
  }
  // 2. A Claude-shaped native install: …/claude/versions/9.9.9 started as `9.9.9`.
  const versioned = installShell(join(ctx.root, 'n/claude/versions'), '9.9.9');
  const nativeOut = join(ctx.root, 'd4-native.json');
  const native = requireStarted(ctx.t.spawn(versioned, ['-c', `"${process.execPath}" "${REPORT}" "${ctx.clone}" "${nativeOut}" claude-code; sleep 300; true`], { env: ctx.env, argv0: '9.9.9', stdio: 'ignore' }), versioned);
  let nat, executable = null;
  try {
    await wait(nativeOut);
    nat = JSON.parse(readFileSync(nativeOut, 'utf8'));
    try { executable = ops.executableOf(native.pid); } catch (e) { executable = `error:${e.code}`; }
  } finally {
    await ctx.t.kill(native.pid);
  }
  // 3. argvOf on an executable path and arguments with spaces.
  const spaced = installShell(join(ctx.root, 'sp ace'), 's h');
  // `; true` keeps the shell itself alive: sh may exec a final simple command in its place.
  const sp = requireStarted(ctx.t.spawn(spaced, ['-c', 'sleep 300; true', 'arg with space'], { env: ctx.env, stdio: 'ignore' }), spaced);
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
