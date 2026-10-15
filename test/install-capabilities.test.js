import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSubscribers } from '../src/subscribers.js';
import { parseEvidence, validateCapabilities } from '../src/install/capabilities.js';
import { bindingsFor } from '../src/install/hooks.js';

const guard = { name: 'guard', role: 'guard', kinds: ['before-tool'], harnesses: ['codex'], argv: ['/usr/bin/true'], timeoutMs: 100 };
const subscribers = (...entries) => validateSubscribers({ schema: 1, subscribers: entries });
const evidence = (probes, over = {}) => JSON.stringify({ schema: 1, harness: 'codex', version: '0.154.0', probes, ...over });
const probe = (reply, over = {}) => ({ event: 'PreToolUse', reply, outerMs: 60000, passed: true, ...over });

test('evidence is strict and names only supported replies', () => {
  assert.deepEqual(parseEvidence(evidence([probe('refuse')])), { schema: 1, harness: 'codex', version: '0.154.0', probes: [probe('refuse')] });
  for (const value of [
    evidence([probe('refuse')], { unknown: true }), evidence([probe('refuse', { outerMs: 1500 })]),
    evidence([probe('other')]), evidence([probe('refuse', { event: 'SessionStart' })]), evidence([probe('refuse')], { version: '' }),
  ]) assert.throws(() => parseEvidence(value), { code: 'INVALID_EVIDENCE' });
});

test('guard bindings require passed refusal and context probes at the configured budget', () => {
  const bindings = [{ event: 'PreToolUse', outerMs: 30000 }];
  assert.throws(() => validateCapabilities({ harness: 'codex', subscribers: subscribers(guard), bindings }), /codex,PreToolUse,refuse/);
  assert.throws(() => validateCapabilities({ harness: 'codex', subscribers: subscribers(guard), bindings,
    evidence: parseEvidence(evidence([probe('refuse', { passed: false }), probe('context')])), }), /codex,PreToolUse,refuse/);
  assert.throws(() => validateCapabilities({ harness: 'codex', subscribers: subscribers(guard), bindings,
    evidence: parseEvidence(evidence([probe('refuse', { outerMs: 1000 }), probe('context')])), }), /codex,PreToolUse,refuse/);
  assert.deepEqual(validateCapabilities({ harness: 'codex', subscribers: subscribers(guard), bindings,
    evidence: parseEvidence(evidence([probe('refuse'), probe('context')])), }), { evidence: { harness: 'codex', version: '0.154.0' } });
});

test('observation-only bindings need no evidence and guards cannot target OpenCode', () => {
  assert.deepEqual(validateCapabilities({ harness: 'codex', subscribers: subscribers(), bindings: [{ event: 'SessionStart', outerMs: 60000 }] }), { evidence: null });
  assert.throws(() => validateCapabilities({ harness: 'opencode', subscribers: { subscribers: [{ ...guard, harnesses: ['opencode'] }] },
    bindings: [{ event: 'session.busy', outerMs: 5000 }] }), /OpenCode/);
});
test('a Codex turn-end guard needs a passed SubagentStop refusal probe as well as Stop', () => {
  const subscribers = { schema: 1, subscribers: [{ name: 'g', role: 'guard', kinds: ['turn-end'], harnesses: ['codex'], tools: null, argv: ['/usr/bin/true'], timeoutMs: 1000 }] };
  const evidence = (events) => ({ schema: 1, harness: 'codex', version: '0.162.1',
    probes: events.map(event => ({ event, reply: 'refuse', outerMs: 600000, passed: true })) });
  assert.throws(() => validateCapabilities({ harness: 'codex', subscribers, bindings: bindingsFor('codex'), evidence: evidence(['Stop']) }),
    { code: 'UNSUPPORTED_BINDING', message: /SubagentStop/ });
  validateCapabilities({ harness: 'codex', subscribers, bindings: bindingsFor('codex'), evidence: evidence(['Stop', 'SubagentStop']) });
});
