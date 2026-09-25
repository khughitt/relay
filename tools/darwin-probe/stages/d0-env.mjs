import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { readlinkSync, realpathSync } from 'node:fs';
export const parseHostName = (r) => (r.exit === 0 && r.stdout.trim() ? r.stdout.trim() : null);
export function pythonAtLeast(text, [major, minor]) {
  const m = /Python (\d+)\.(\d+)/.exec(text ?? ''); return !!m && (+m[1] > major || (+m[1] === major && +m[2] >= minor));
}
// Direct and bounded, not through the tracker: finalization takes the end reading after the
// tracker has stopped accepting children.
async function hosts(ctx) {
  const scutil = async (key) => {
    if (ctx.platform !== 'darwin') return null;
    const r = spawnSync('scutil', ['--get', key], { encoding: 'utf8', timeout: 2000 });
    return parseHostName({ exit: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' });
  };
  return { os: hostname(), HostName: await scutil('HostName'), LocalHostName: await scutil('LocalHostName'), ComputerName: await scutil('ComputerName') };
}
export async function run(ctx) {
  const v = async (cmd, args) => { const r = await ctx.t.run(cmd, args, { env: ctx.env }); return r.exit === 0 ? (r.stdout || r.stderr).trim() : null; };
  const harness = async (name) => {
    const path = await v('/usr/bin/which', [name]); if (!path) return null;
    let real = null; try { real = realpathSync(path); } catch {}
    return { version: await v(name, ['--version']), path, real };
  };
  const python3 = await v('python3', ['--version']);
  const clt = ctx.platform === 'darwin' ? await v('xcode-select', ['-p']) : null;
  let zone = null; try { zone = readlinkSync('/etc/localtime').replace(/^.*zoneinfo\//, ''); } catch {}
  const node = process.versions.node;
  const observations = {
    platform: ctx.platform,
    sw_vers: ctx.platform === 'darwin' ? { ProductVersion: await v('sw_vers', ['-productVersion']), BuildVersion: await v('sw_vers', ['-buildVersion']) } : null,
    arch: await v('uname', ['-m']),
    versions: { node: `v${node}`, npm: await v('npm', ['--version']), git: await v('git', ['--version']), python3 },
    clt, tz: process.env.TZ ?? null, zone, columns_exported: ctx.ambient?.columns_exported ?? process.env.COLUMNS !== undefined,
    harnesses: { claude: await harness('claude'), codex: await harness('codex'), opencode: await harness('opencode') },
    hosts: { start: await hosts(ctx), end: null },
    prerequisites: { macos: ctx.platform === 'darwin', node22: +node.split('.')[0] >= 22, clt: ctx.platform !== 'darwin' || clt !== null, python311: pythonAtLeast(python3, [3, 11]) },
  };
  return { status: 'ran', observations };
}
export async function finish(ctx, record) { record.observations.hosts.end = await hosts(ctx); return record; }
