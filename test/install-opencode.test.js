import test from 'node:test';
import assert from 'node:assert/strict';
import { planOpenCode } from '../src/install/opencode.js';

const args = over => ({ configDir: '/cfg', json: '{\n // mine\n "plugin":["/familiar/sprite.js"]\n}', jsonc: null,
  relayPlugin: '/relay/integrations/opencode/plugin.js', subscribers: { subscribers: [] }, ...over });

test('OpenCode plans only the server plugin and preserves JSONC', () => {
  const artifact = planOpenCode(args());
  assert.equal(artifact.changes[0].path, '/cfg/opencode.json');
  assert.match(artifact.changes[0].after, /\/familiar\/sprite\.js/);
  assert.match(artifact.changes[0].after, /\/relay\/integrations\/opencode\/plugin\.js/);
  assert.equal(artifact.changes[0].after.includes('tui'), false);
});

test('OpenCode accepts a jsonc-only target and refuses ambiguous or duplicate relay writers', () => {
  assert.equal(planOpenCode(args({ json: null, jsonc: '{"plugin":[]}' })).changes[0].path, '/cfg/opencode.jsonc');
  assert.throws(() => planOpenCode(args({ jsonc: '{}' })), /ambiguous/);
  assert.throws(() => planOpenCode(args({ json: '{"plugin":["/relay/integrations/opencode/plugin.js","/relay/integrations/opencode/plugin.js"]}' })), /duplicate relay/);
});
