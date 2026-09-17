import test from 'node:test';
import assert from 'node:assert/strict';
import { planCodex } from '../src/install/codex.js';

test('Codex planner edits only the explicit hooks.json artifact', () => {
  const result = planCodex({ target: '/checkout/ai/codex/hooks.json', text: '{"hooks":{}}', relayBin: '/relay/bin/relay', subscribers: { subscribers: [] } });
  assert.equal(result.changes[0].path, '/checkout/ai/codex/hooks.json');
  assert.equal(result.changes[0].after.includes('config.toml'), false);
  assert.throws(() => planCodex({ target: '/checkout/ai/codex/config.toml', text: '{}', relayBin: '/relay/bin/relay', subscribers: { subscribers: [] } }), /hooks.json/);
});
