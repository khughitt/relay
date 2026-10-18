#!/usr/bin/env node
// The release portability check (docs/runbooks/release.md): install relay from a git spec the way a
// fresh, anonymous consumer would, and prove every packaged path works.
//
//   node tools/release/portability.mjs --spec <npm git spec> --commit <40-hex sha>
//
// Checks run in order and stop at the first failure: reach, install, manifest, lockfile, smoke, ci.
// Exit 0 when all pass, 1 when one fails, 2 on a usage error.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SMOKE = fileURLToPath(new URL('../../test/fixtures/consumer-smoke.mjs', import.meta.url));
const TIMEOUT_MS = 180000;
const REGISTRY = 'https://registry.npmjs.org/';

// Built from nothing: no variable of the host reaches a child. SSH is disabled outright rather than
// made non-interactive: OpenSSH reads its configuration and identities from the passwd home
// directory, not $HOME, and BatchMode still permits configured keys and agents. The check proves
// anonymous HTTPS installation only.
export function isolatedEnv(root, cache) {
  return {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: join(root, 'home'),
    npm_config_cache: cache,
    // Two empty files: npm refuses to load one file as both its user and global config.
    npm_config_userconfig: join(root, 'npmrc-user'),
    npm_config_globalconfig: join(root, 'npmrc-global'),
    npm_config_update_notifier: 'false',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: '/usr/bin/false',
    RELAY_STATE_DIR: join(root, 'state'),
    XDG_CONFIG_HOME: join(root, 'config'),
  };
}

class Failure extends Error {}
const tail = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).join(' / ');

function run(cmd, args, cwd, env) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: TIMEOUT_MS });
  if (r.error) throw new Failure(`${cmd} ${args[0]}: ${r.error.message}`);
  return r;
}

function checks({ spec, commit, root }) {
  const consumer = join(root, 'consumer'), manifest = join(consumer, 'package.json');
  const env = isolatedEnv(root, join(root, 'cache'));
  const hash = spec.lastIndexOf('#'), url = spec.slice('git+'.length, hash), ref = spec.slice(hash + 1);
  const manifestText = `${JSON.stringify({ private: true, type: 'module', dependencies: { relay: spec } })}\n`;
  const smoke = (smokeEnv) => {
    copyFileSync(SMOKE, join(consumer, 'consumer-smoke.mjs'));
    const r = run(process.execPath, ['consumer-smoke.mjs'], consumer, smokeEnv);
    if (r.status !== 0 || !r.stdout.includes('installed package verified')) throw new Failure(tail(r.stderr) || `exit ${r.status}`);
  };
  return [
    ['reach', () => {
      // ls-remote matches ref names, so a commit spec only needs the repository to answer.
      const sha = /^[0-9a-f]{40}$/.test(ref);
      const r = run('git', sha ? ['ls-remote', url] : ['ls-remote', url, ref], root, env);
      if (r.status !== 0) throw new Failure(tail(r.stderr) || `git ls-remote exit ${r.status}`);
      if (!sha && !r.stdout.trim()) throw new Failure(`${url} has no ref ${ref}`);
      return sha ? `${url} answers; ${ref} is a commit` : tail(r.stdout);
    }],
    ['install', () => {
      writeFileSync(manifest, manifestText);
      const r = run('npm', ['install', '--no-audit', '--no-fund'], consumer, env);
      if (r.status !== 0) throw new Failure(tail(r.stderr) || `npm install exit ${r.status}`);
      return `npm install of ${spec}`;
    }],
    ['manifest', () => {
      const now = readFileSync(manifest, 'utf8');
      if (now !== manifestText) throw new Failure(`package.json changed: ${now.trim()}`);
      return `dependency kept as ${spec}`;
    }],
    ['lockfile', () => {
      const packages = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8')).packages;
      const relay = packages['node_modules/relay'];
      if (!relay?.resolved?.endsWith(`#${commit}`)) throw new Failure(`relay resolved ${relay?.resolved}, not #${commit}`);
      const parts = [`relay ${relay.resolved}`];
      for (const name of Object.keys(relay.dependencies ?? {})) {
        const dep = packages[`node_modules/${name}`];
        if (!dep) throw new Failure(`${name}: no lockfile entry (relay resolved ${relay.resolved})`);
        if (!dep.resolved?.startsWith(REGISTRY) || !dep.integrity) throw new Failure(`${name}: resolved ${dep.resolved}, integrity ${dep.integrity}`);
        parts.push(`${name} ${dep.resolved} ${dep.integrity}`);
      }
      return parts.join('; ');
    }],
    ['smoke', () => { smoke(env); return 'installed package verified'; }],
    ['ci', () => {
      // A cache the install never touched: nothing it downloaded may satisfy npm ci.
      for (const dir of ['node_modules', '../state', '../config']) rmSync(join(consumer, dir), { recursive: true, force: true });
      const ciEnv = isolatedEnv(root, join(root, 'cache-ci'));
      const r = run('npm', ['ci', '--no-audit', '--no-fund'], consumer, ciEnv);
      if (r.status !== 0) throw new Failure(tail(r.stderr) || `npm ci exit ${r.status}`);
      smoke(ciEnv);
      return 'npm ci from the lockfile with an empty cache; installed package verified';
    }],
  ];
}

function main() {
  const usage = (message) => {
    process.stderr.write(`portability: ${message}\nusage: node tools/release/portability.mjs --spec <npm git spec> --commit <40-hex sha>\n`);
    process.exit(2);
  };
  let values;
  try { ({ values } = parseArgs({ options: { spec: { type: 'string' }, commit: { type: 'string' } }, strict: true })); }
  catch (error) { usage(error.message); }
  const { spec, commit } = values;
  if (!spec || !commit) usage('--spec and --commit are required');
  if (!/^git\+[a-z]+:\/\/.+#.+$/.test(spec)) usage(`--spec must be git+<url>#<ref>: ${spec}`);
  if (!/^[0-9a-f]{40}$/.test(commit)) usage(`--commit must be a 40-hex sha: ${commit}`);

  const root = mkdtempSync(join(tmpdir(), 'relay-portability-'));
  const cleanup = () => { if (existsSync(root)) rmSync(root, { recursive: true, force: true }); };
  process.on('exit', cleanup);
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(signal, () => { cleanup(); process.exit(code); });
  mkdirSync(join(root, 'home')); mkdirSync(join(root, 'consumer')); writeFileSync(join(root, 'npmrc-user'), ''); writeFileSync(join(root, 'npmrc-global'), '');

  for (const [name, check] of checks({ spec, commit, root })) {
    try { process.stdout.write(`ok ${name}: ${check()}\n`); }
    catch (error) {
      if (!(error instanceof Failure)) throw error;
      process.stdout.write(`FAIL ${name}: ${error.message}\nportability: fail\n`);
      process.exitCode = 1;
      return;
    }
  }
  process.stdout.write('portability: pass\n');
}

// Real paths: a worktree reached through a symlink names this file two ways.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) main();
