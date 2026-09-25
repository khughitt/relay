import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ask } from '../lib/tty.mjs';
import { capture, sampleHarnessRows, stripCapture } from '../lib/ps.mjs';
export { stripCapture };
const ROLES = ['daemon', 'bg-pty-host'];
// ps joins arguments with spaces, so a prompt's boundaries are unknowable; keep only what
// relay's recognition reads (argv[0]'s name and whether argv[1] is a role word).
export const argSummary = (argv) => ({ argv0_name: basename(argv[0] ?? ''), role: ROLES.includes(argv[1]) ? argv[1] : argv.length > 1 ? 'other' : 'none', count: argv.length });
export async function run(ctx) {
  if (ctx.platform !== 'darwin') return { status: 'skipped', reason: 'darwin only', observations: {} };
  const answer = await ask('Optional: open an interactive `claude` (and `claude --bg` or `codex` if you use them) in another terminal, then press Enter to sample them. Type s and Enter to skip. ');
  if (answer === null || answer.toLowerCase() === 's') return { status: 'skipped', reason: answer === null ? 'no terminal' : 'user skipped', observations: {} };
  const { createProcessOps } = await import(pathToFileURL(join(ctx.clone, 'src/index.js')).href);
  const ops = createProcessOps();
  const processes = sampleHarnessRows(['claude', 'codex', 'opencode']).map((r) => {
    let chain = null, args = null, error = null;
    try { chain = ops.ancestors(r.pid).map((x) => ({ pid: x.pid, ppid: x.ppid, comm: x.comm, tty: x.tty })); } catch (e) { error = e.code; }
    try { args = argSummary(ops.argvOf(r.pid)); } catch (e) { args = { error: e.code }; }
    return { pid: r.pid, comm_ww: r.comm_ww, args, chain, error, capture: stripCapture(capture(r.pid, `ambient-${r.pid}`)) };
  });
  return { status: 'ran', observations: { processes } };
}
