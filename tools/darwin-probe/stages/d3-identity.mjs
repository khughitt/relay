import { fileURLToPath } from 'node:url';
import { ps } from '../lib/ps.mjs';
const CHILD = fileURLToPath(new URL('../lib/identity-child.mjs', import.meta.url));
export async function epochFromLstart(lstart, run, env) {
  const r = await run('date', ['-j', '-f', '%a %b %d %T %Y', lstart.replace(/\s+/g, ' ').trim(), '+%s'], { env: { ...env, LC_ALL: 'C' } });
  return r.stdout.trim();
}
// A zombie: python3 forks a child that exits at once and is never reaped; the parent prints
// the child's pid on its own line, flushes, then sleeps, holding the zombie alive under it.
const ZOMBIE_PY = 'import os, time\np = os.fork()\nif p == 0:\n    os._exit(0)\nprint(p, flush=True)\ntime.sleep(30)\n';
// Bounded: resolves on the child's first stdout line, on its own 'error' or 'close', or after
// `timeoutMs` — a missing interpreter or a child that dies before printing must not hang D3.
function readFirstLine(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => done({ ok: false, reason: `timed out after ${timeoutMs}ms waiting for zombie pid` }), timeoutMs);
    child.once('error', (error) => done({ ok: false, reason: `spawn error: ${error.code ?? error.message}` }));
    child.once('close', (code, signal) => done({ ok: false, reason: `zombie child exited before printing a pid (code ${code}, signal ${signal})` }));
    child.stdout?.once('data', (data) => {
      const pid = Number(String(data).trim().split(/\s+/)[0]);
      done(Number.isInteger(pid) && pid > 0 ? { ok: true, pid } : { ok: false, reason: `unexpected zombie output: ${JSON.stringify(String(data).slice(0, 80))}` });
    });
  });
}
export async function run(ctx) {
  if (ctx.platform !== 'darwin') return { status: 'skipped', reason: 'darwin only', observations: {} };
  const tzEnv = (tz) => { const env = { ...ctx.env }; if (tz) env.TZ = tz; else delete env.TZ; return env; };
  const handleUnder = async (tz, pid) => JSON.parse((await ctx.t.run(process.execPath, [CHILD, ctx.clone, 'handle', String(pid)], { env: tzEnv(tz) })).stdout);
  const probeUnder = async (tz, h) => JSON.parse((await ctx.t.run(process.execPath, [CHILD, ctx.clone, 'probe', JSON.stringify(h)], { env: tzEnv(tz) })).stdout);
  const sleeper = ctx.t.spawn('/bin/sleep', ['300'], { env: ctx.env, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 200));
  const h = await handleUnder('', sleeper.pid);
  const lstart = ps(['-p', String(sleeper.pid), '-o', 'lstart=']).stdout.trim();
  const independent = { relay: h.start, date: await epochFromLstart(lstart, ctx.t.run, ctx.env) };
  const zone = (await ctx.t.run('/bin/sh', ['-c', 'readlink /etc/localtime'], { env: ctx.env })).stdout.trim().replace(/^.*zoneinfo\//, '');
  const pairs = [['UTC', 'Pacific/Chatham'], ['Pacific/Chatham', 'UTC'], ['', zone], [zone, '']];
  const tz_pairs = [];
  for (const [publish, probe] of pairs) tz_pairs.push({ publish, probe, status: (await probeUnder(probe, await handleUnder(publish, sleeper.pid))).status });
  const alive = await probeUnder('', h);
  const replaced = await probeUnder('', { ...h, start: String(BigInt(h.start) + 1n) });
  const foreign_host = { ...(await probeUnder('', { ...h, host: `${h.host}-other` })), host: `${h.host}-other` };
  const foreign_platform = await probeUnder('', { ...h, platform: 'linux', bootId: null });
  const l = await handleUnder('', 1);
  await ctx.t.kill(sleeper.pid);
  const dead = await probeUnder('', h);
  let zombie;
  const z = ctx.t.spawn('python3', ['-c', ZOMBIE_PY], { env: ctx.env, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const read = await readFirstLine(z);
    if (!read.ok) { zombie = { status: 'no-handle', reason: read.reason }; }
    else {
      await new Promise((r) => setTimeout(r, 300));
      const zh = await handleUnder('', read.pid);
      zombie = zh ? await probeUnder('', zh) : { status: 'no-handle', reason: 'handleOf returned null' };
    }
  } finally {
    await ctx.t.kill(z.pid);
  }
  return { status: 'ran', observations: { independent, tz_pairs, alive, dead, replaced, foreign_host, foreign_platform,
    launchd: { valid: !!l && l.pid === 1, boot_id_null: l?.bootId === null }, zombie } };
}
