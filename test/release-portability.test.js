import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv } from '../tools/release/portability.mjs';

// The portability check proves anonymous installation: no credential, config or variable of the
// host may reach its children. SSH is disabled outright, since OpenSSH finds keys through the
// passwd home directory whatever HOME says.
test('the child environment holds exactly the isolation keys', (t) => {
  process.env.RELAY_SENTINEL = '1'; t.after(() => { delete process.env.RELAY_SENTINEL; });
  const env = isolatedEnv('/r', '/r/cache');
  assert.deepEqual(Object.keys(env).sort(), ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_SSH_COMMAND', 'GIT_TERMINAL_PROMPT', 'HOME', 'PATH',
    'RELAY_STATE_DIR', 'XDG_CONFIG_HOME', 'npm_config_cache', 'npm_config_globalconfig', 'npm_config_update_notifier', 'npm_config_userconfig']);
  assert.equal(env.GIT_SSH_COMMAND, '/usr/bin/false');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(env.npm_config_cache, '/r/cache');
  assert.equal(env.npm_config_update_notifier, 'false');
  assert.equal(env.HOME, '/r/home');
  assert.equal(env.RELAY_SENTINEL, undefined);
});
