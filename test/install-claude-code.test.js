import test from 'node:test';
import assert from 'node:assert/strict';
import { planClaudeCode } from '../src/install/claude-code.js';

test('Claude planner creates one explicit settings artifact', () => {
  const result = planClaudeCode({ target: '/checkout/ai/claude/settings.work.json', text: '{"hooks":{}}', relayBin: '/relay/bin/relay', subscribers: { subscribers: [] } });
  assert.equal(result.changes[0].path, '/checkout/ai/claude/settings.work.json');
  assert.match(result.changes[0].after, /Notification/);
});
