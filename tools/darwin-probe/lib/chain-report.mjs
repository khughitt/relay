// chain-report.mjs — runs as the child of a constructed harness process.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ps, capture } from './ps.mjs';
const [clone, out, harness] = process.argv.slice(2);
const { createProcessOps, adapterFor } = await import(pathToFileURL(join(clone, 'src/index.js')).href);
const ops = createProcessOps();
// Guarded like `resolveSessionPid` below: a throw here must still leave a report on disk, so
// the stage fails on a mismatch it can observe rather than waiting out `wait()`'s timeout.
let relayChain = [], resolved = null, error = null;
try { relayChain = ops.ancestors(process.pid); } catch (e) { error = e.code ?? e.message; }
const table = new Map(ps(['-ww', '-axo', 'pid=,ppid=']).stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number)));
const psChain = []; for (let p = process.pid; p > 1 && psChain.length < 64; p = table.get(p)) psChain.push(p);
try { resolved = adapterFor(harness).resolveSessionPid(); } catch (e) { error = error ? `${error}; ${e.code ?? e.message}` : (e.code ?? e.message); }
writeFileSync(out, JSON.stringify({ pid: process.pid, ppid: process.ppid, ancestors_relay: relayChain.map((r) => r.pid), ancestors_ps: psChain,
  tty_relay: relayChain[1]?.tty ?? null, tty_ps: ps(['-p', String(process.ppid), '-o', 'tty=']).stdout.trim(), resolved, error,
  capture: capture(process.ppid, `chain-${harness}`) }));
