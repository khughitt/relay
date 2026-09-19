import test from 'node:test';
import assert from 'node:assert/strict';
import { planClaudeCode } from '../src/install/claude-code.js';

test('Claude planner creates one explicit settings artifact', () => {
  const result = planClaudeCode({ target: '/checkout/ai/claude/settings.work.json', text: '{"hooks":{}}', relayBin: '/relay/bin/relay', subscribersPath: '/home/me/.config/relay/subscribers.json', subscribers: { subscribers: [] } });
  assert.equal(result.changes[0].path, '/checkout/ai/claude/settings.work.json');
  assert.match(result.changes[0].after, /Notification/);
  assert.match(result.changes[0].after, /--subscribers '\/home\/me\/\.config\/relay\/subscribers\.json'/);
  assert.throws(() => planClaudeCode({ target: '/checkout/ai/claude/settings.work.json', text: '{"hooks":{}}', relayBin: '/relay/bin/relay', subscribers: { subscribers: [] } }), /subscriber/);
});
