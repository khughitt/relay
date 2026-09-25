#!/usr/bin/env node
// relay-wrapper.mjs — installed as <clone>/node_modules/.darwin-probe/relay.js (gitignored).
// Records this hook process's own ancestry as relay will read it, then runs the committed
// relay in this same process, so the recorded ancestry is the hook's real ancestry.
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { fileURLToPath, pathToFileURL } from 'node:url';
const clone = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { createProcessOps, adapterFor } = await import(pathToFileURL(join(clone, 'src/index.js')).href);
const args = process.argv.slice(2), harness = args[args.indexOf('--harness') + 1];
let stdin = process.stdin;
if (args[0] === 'hook' && process.env.DARWIN_PROBE_HOOKS) {
  // Only the hook path records ancestry, so only it needs Task 4's capture(); an unset
  // DARWIN_PROBE_PS would otherwise fail every wrapper invocation, not just this one.
  const { capture } = await import(process.env.DARWIN_PROBE_PS);
  // Read the payload once: its session id binds this evidence to one agent, and the same
  // bytes go on to relay.
  const payload = await buffer(process.stdin);
  stdin = Readable.from([payload]);
  let agentId = null; try { agentId = `${harness}:${JSON.parse(payload.toString('utf8')).session_id}`; } catch {}
  // Whether the harness exported COLUMNS into this hook: capture() drops it for its own ps
  // calls, so this records what relay's own ps saw.
  const columns = process.env.COLUMNS ?? null;
  let record;
  try {
    const chain = createProcessOps().ancestors(process.pid);
    let resolved = null, error = null; try { resolved = adapterFor(harness).resolveSessionPid(); } catch (e) { error = e.code ?? e.message; }
    const upTo = chain.findIndex((r) => r.pid === resolved);
    const captured = chain.slice(1, upTo >= 0 ? upTo + 1 : Math.min(chain.length, 6));
    record = { pid: process.pid, agent_id: agentId, columns, resolved, error, ancestors: chain.map((r) => ({ pid: r.pid, ppid: r.ppid, comm: r.comm, tty: r.tty, starttime: r.starttime })),
      captures: captured.map((r) => capture(r.pid, `hook-${r.pid}`)) };
  } catch (e) { record = { pid: process.pid, agent_id: agentId, columns, error: e.code ?? e.message }; }
  appendFileSync(process.env.DARWIN_PROBE_HOOKS, `${JSON.stringify(record)}\n`);
}
const { main } = await import(pathToFileURL(join(clone, 'bin/relay.js')).href);
process.exit(await main(args, { stdin }));
