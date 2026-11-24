// @ts-check
// Read-only per-host deployment wiring check for latency support across versions and modes.
//   node wiring.mjs --hq HQ_CHECKOUT --snapshot FROZEN_SETTINGS MANIFEST_SET...
// The harness settings link is deliberately not an argument: callers may run this over SSH where that
// protected link cannot be named. Git reads use an isolated environment and never refresh the index.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { packageSha256 } from './deployment.mjs';
import { deployedRelayBinding } from './hook-settings.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function requireThat(ok, message) { if (!ok) throw new Error(message); }
const gitEnv = () => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' });

function git(repo, args, quiet = false) {
  const result = spawnSync('git', ['--no-optional-locks', '--literal-pathspecs', '-C', repo, ...args], {
    encoding: 'utf8', env: gitEnv(),
  });
  if (quiet && [0, 1].includes(result.status)) return result.status === 0;
  requireThat(result.status === 0, `git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.trim()}`);
  return quiet ? false : result.stdout.trim();
}

export function checkWiring({ hq, snapshot, manifests }) {
  const repo = realpathSync(hq);
  requireThat(git(repo, ['rev-parse', '--show-toplevel']) === repo, '--hq must name the hq checkout root');
  const snapshotBytes = readFileSync(snapshot);
  const snapshotValue = JSON.parse(snapshotBytes.toString('utf8'));
  const executingHost = hostname();
  const reports = [];
  let ok = true;
  for (const file of manifests) {
    const set = JSON.parse(readFileSync(file, 'utf8'));
    const manifests = set.manifests ?? [set];
    requireThat(Array.isArray(manifests) && manifests.length > 0, `${file}: the manifest set names no routes`);
    for (const manifest of manifests) {
      const settings = manifest.settings, deployed = manifest.deployed;
      requireThat(settings?.repository === 'hq' && deployed, `${file}: the route needs hq settings and a deployed baseline`);
      const path = settings.path;
      requireThat(typeof path === 'string' && path === normalize(path) && !isAbsolute(path) && path !== '..' && !path.startsWith('../'),
        `${file}: settings path must be relative to hq`);
      const head = git(repo, ['rev-parse', 'HEAD']);
      const blob = git(repo, ['rev-parse', `HEAD:${path}`]);
      const content = git(repo, ['cat-file', 'blob', blob]);
      const blobValue = JSON.parse(content);
      const binding = deployedRelayBinding(blobValue.hooks, manifest.event);
      const installed = dirname(dirname(binding.entry));
      const checks = [
        ['executing hostname', executingHost, manifest.host],
        ['manifest set hostname', set.host ?? manifest.host, manifest.host],
        ['hq HEAD', head, settings.commit],
        ['settings blob', blob, settings.blob],
        ['filtered live file = index (git diff --quiet)', git(repo, ['diff', '--quiet', '--', path], true), true],
        ['index = HEAD (git diff --cached --quiet)', git(repo, ['diff', '--cached', '--quiet', '--', path], true), true],
        ['snapshot sha256 = frozen live sha256', sha(snapshotBytes), settings.liveSha256],
        ['blob hooks table = snapshot hooks table', isDeepStrictEqual(blobValue.hooks, snapshotValue.hooks), true],
        ['deployed package listing sha256', packageSha256(installed), deployed.packageSha256],
        ['deployed subscriber config sha256', sha(readFileSync(binding.config)), deployed.configSha256],
        ['relay line outer budget', binding.outerMs, deployed.outerMs],
      ];
      for (const [name, got, want] of checks) if (got !== want) ok = false;
      reports.push({ file, host: manifest.host, event: manifest.event, version: manifest.version, mode: manifest.mode,
        info: `raw blob sha256 ${sha(content).slice(0, 16)}; snapshot keys beyond the blob's: ${JSON.stringify(Object.keys(snapshotValue).filter((key) => !(key in blobValue)))}`,
        checks });
    }
  }
  return { ok, reports };
}

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { hq: { type: 'string' }, snapshot: { type: 'string' } } });
  requireThat(values.hq && values.snapshot && positionals.length > 0,
    'usage: node wiring.mjs --hq HQ_CHECKOUT --snapshot FROZEN_SETTINGS MANIFEST_SET...');
  const { ok, reports } = checkWiring({ hq: resolve(values.hq), snapshot: resolve(values.snapshot), manifests: positionals.map((file) => resolve(file)) });
  for (const report of reports) {
    process.stdout.write(`== ${basename(report.file)} (${report.host}, ${report.event}, recorded ${report.version} ${report.mode})\n`);
    process.stdout.write(`  (info) ${report.info}\n`);
    for (const [name, got, want] of report.checks) {
      const pass = got === want;
      const detail = pass ? '' : ` (got ${String(got).slice(0, 80)}; expected ${String(want).slice(0, 80)})`;
      process.stdout.write(`  ${name}: ${pass ? 'PASS' : 'FAIL'}${detail}\n`);
    }
  }
  process.stdout.write(`${ok ? 'ALL PASS' : 'SOME FAIL'}\n`);
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { process.stderr.write(`wiring.mjs: ${error.message}\n`); process.exitCode = 2; }
}
