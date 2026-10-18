import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedEnv } from '../tools/release/portability.mjs';

const SCRIPT = fileURLToPath(new URL('../tools/release/portability.mjs', import.meta.url));

// The portability check proves anonymous installation: no credential, config or variable of the
// host may reach its children. SSH is disabled outright, since OpenSSH finds keys through the
// passwd home directory whatever HOME says.
test('the child environment holds exactly the isolation keys', (t) => {
  process.env.RELAY_SENTINEL = '1'; t.after(() => { delete process.env.RELAY_SENTINEL; });
  const env = isolatedEnv('/t/r', '/t/r/cache');
  assert.deepEqual(Object.keys(env).sort(), ['GIT_CEILING_DIRECTORIES', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_SSH_COMMAND', 'GIT_TERMINAL_PROMPT',
    'HOME', 'PATH', 'RELAY_STATE_DIR', 'TMPDIR', 'XDG_CONFIG_HOME', 'npm_config_cache', 'npm_config_globalconfig', 'npm_config_update_notifier', 'npm_config_userconfig']);
  assert.equal(env.GIT_SSH_COMMAND, '/usr/bin/false');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(env.npm_config_cache, '/t/r/cache');
  assert.equal(env.GIT_CEILING_DIRECTORIES, '/t');
  assert.equal(env.TMPDIR, '/t/r/tmp');
  assert.equal(env.npm_config_update_notifier, 'false');
  assert.equal(env.HOME, '/t/r/home');
  assert.equal(env.RELAY_SENTINEL, undefined);
});

// Global and system config are off, but git also reads the config of any repository above its
// working directory. One around the scratch directory must not redirect, or authenticate, a fetch.
test('a repository around the scratch directory cannot redirect the check', { timeout: 60000 }, (t) => {
  const outer = mkdtempSync(join(tmpdir(), 'relay-outer-')); t.after(() => rmSync(outer, { recursive: true, force: true }));
  const g = (...args) => execFileSync('git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...args], { stdio: 'ignore' });
  const remote = join(outer, 'remote.git'), src = join(outer, 'src');
  g('init', '-q', '-b', 'main', src); writeFileSync(join(src, 'f'), 'x'); g('-C', src, 'add', 'f'); g('-C', src, 'commit', '-qm', 'x');
  g('clone', '-q', '--bare', src, remote);
  g('init', '-q', outer); g('-C', outer, 'config', `url.file://${remote}.insteadOf`, 'https://example.invalid/relay.git');
  mkdirSync(join(outer, 'tmp'));
  const r = spawnSync(process.execPath, [SCRIPT, '--spec', 'git+https://example.invalid/relay.git#main', '--commit', '0'.repeat(40)],
    { env: { ...process.env, TMPDIR: join(outer, 'tmp') }, encoding: 'utf8', timeout: 50000 });
  assert.doesNotMatch(r.stdout, /^ok reach/m);
  assert.match(r.stdout, /^FAIL reach: /m);
});
