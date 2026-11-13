import test from 'node:test';
import assert from 'node:assert/strict';
import { planCodex } from '../src/install/codex.js';
import { qualifiedInstall } from './helpers/qualification.js';

test('Codex planner edits only the explicit hooks.json artifact', () => {
  const result = planCodex({ target: '/checkout/ai/codex/hooks.json', text: '{"hooks":{}}', relayBin: '/relay/bin/relay', subscribersPath: '/home/me/.config/relay/subscribers.json', subscribers: { subscribers: [] }, ...qualifiedInstall('codex', { subscribers: [] }) });
  assert.equal(result.changes[0].path, '/checkout/ai/codex/hooks.json');
  assert.equal(result.changes[0].after.includes('config.toml'), false);
  assert.match(result.changes[0].after, /--subscribers '\/home\/me\/\.config\/relay\/subscribers\.json'/);
  assert.throws(() => planCodex({ target: '/checkout/ai/codex/config.toml', text: '{}', relayBin: '/relay/bin/relay', subscribersPath: '/home/me/.config/relay/subscribers.json', subscribers: { subscribers: [] } }), { code: 'INVALID_CONFIG', message: /--target must be an absolute path ending in \/hooks\.json/ });
  assert.throws(() => planCodex({ target: '/checkout/ai/codex/hooks.json', text: '{"hooks":{}}', relayBin: '/relay/bin/relay', subscribers: { subscribers: [] } }), { code: 'INVALID_CONFIG', message: /subscriber/ });
});
