import test from 'node:test';
import assert from 'node:assert/strict';
import { paths } from '../src/bus/paths.js';
test('paths honor explicit roots and XDG empty fallback', () => {
  assert.deepEqual(paths({ HOME: '/home/fixture', XDG_STATE_HOME: '', XDG_CONFIG_HOME: '' }), {
    stateDir: '/home/fixture/.local/state/relay', agentsPath: '/home/fixture/.local/state/relay/agents.json',
    lockPath: '/home/fixture/.local/state/relay/agents.lock', reclaimPath: '/home/fixture/.local/state/relay/agents.lock.reclaim',
    configDir: '/home/fixture/.config/relay', subscribersPath: '/home/fixture/.config/relay/subscribers.json'
  });
  assert.equal(paths({ XDG_STATE_HOME: '/state', XDG_CONFIG_HOME: '/config' }).stateDir, '/state/relay');
  assert.equal(paths({ RELAY_STATE_DIR: '/override' }).stateDir, '/override');
  for (const env of [{ RELAY_STATE_DIR: '' }, { RELAY_STATE_DIR: 'relative' }, { XDG_STATE_HOME: 'relative' }, { XDG_CONFIG_HOME: 'relative' }, { HOME: '' }]) {
    assert.throws(() => paths(env), { code: 'INVALID_INPUT' });
  }
});
