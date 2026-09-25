import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ps } from '../lib/ps.mjs';
const CHILD = fileURLToPath(new URL('../lib/identity-child.mjs', import.meta.url));
export async function epochFromLstart(lstart, run) {
  const r = await run('date', ['-j', '-f', '%a %b %d %T %Y', lstart.replace(/\s+/g, ' ').trim(), '+%s'], { env: { ...process.env, LC_ALL: 'C' } });
  return r.stdout.trim();
}
export async function run(ctx) {
  if (ctx.platform !== 'darwin') return { status: 'skipped', reason: 'darwin only', observations: {} };
  const tzEnv = (tz) => { const env = { ...ctx.env }; if (tz) env.TZ = tz; else delete env.TZ; return env; };
  const handleUnder = async (tz, pid) => JSON.parse((await ctx.t.run(process.execPath, [CHILD, ctx.clone, 'handle', String(pid)], { env: tzEnv(tz) })).stdout);
  const probeUnder = async (tz, h) => JSON.parse((await ctx.t.run(process.execPath, [CHILD, ctx.clone, 'probe', JSON.stringify(h)], { env: tzEnv(tz) })).stdout);
  const sleeper = ctx.t.spawn('/bin/sleep', ['300'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 200));
  const h = await handleUnder('', sleeper.pid);
  const lstart = ps(['-p', String(sleeper.pid), '-o', 'lstart=']).stdout.trim();
  const independent = { relay: h.start, date: await epochFromLstart(lstart, ctx.t.run) };
  const zone = (await ctx.t.run('/bin/sh', ['-c', 'readlink /etc/localtime'])).stdout.trim().replace(/^.*zoneinfo\//, '');
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
  // A zombie: perl forks a child that exits at once and never reaps it.
  const z = ctx.t.spawn('perl', ['-e', '$|=1; my $p=fork(); if($p==0){exit 0} print "$p\\n"; sleep 30'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const zpid = Number(await new Promise((r) => z.stdout.once('data', (d) => r(String(d).trim()))));
  await new Promise((r) => setTimeout(r, 300));
  const zh = await handleUnder('', zpid);
  const zombie = zh ? await probeUnder('', zh) : { status: 'no-handle', reason: 'handleOf returned null' };
  await ctx.t.kill(z.pid);
  return { status: 'ran', observations: { independent, tz_pairs, alive, dead, replaced, foreign_host, foreign_platform,
    launchd: { valid: !!l && l.pid === 1, boot_id_null: l?.bootId === null }, zombie } };
}
