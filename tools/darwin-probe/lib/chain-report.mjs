// chain-report.mjs — runs as the child of a constructed harness process.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ps, capture } from './ps.mjs';
const [clone, out, harness] = process.argv.slice(2);
const { createProcessOps, adapterFor } = await import(pathToFileURL(join(clone, 'src/index.js')).href);
const ops = createProcessOps();
const relayChain = ops.ancestors(process.pid);
const table = new Map(ps(['-ww', '-axo', 'pid=,ppid=']).stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number)));
const psChain = []; for (let p = process.pid; p > 1 && psChain.length < 64; p = table.get(p)) psChain.push(p);
let resolved = null, error = null;
try { resolved = adapterFor(harness).resolveSessionPid(); } catch (e) { error = e.code ?? e.message; }
writeFileSync(out, JSON.stringify({ pid: process.pid, ppid: process.ppid, ancestors_relay: relayChain.map((r) => r.pid), ancestors_ps: psChain,
  tty_relay: relayChain[1]?.tty ?? null, tty_ps: ps(['-p', String(process.ppid), '-o', 'tty=']).stdout.trim(), resolved, error,
  capture: capture(process.ppid, `chain-${harness}`) }));
