import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReply, encodeStandardReply, CONTEXT_LIMIT } from '../src/adapters/reply.js';
import { adapterFor } from '../src/adapters/index.js';
import { KINDS } from '../src/protocol.js';

test('parseReply accepts only the documented reply shape', () => {
  assert.deepEqual(parseReply('{"decision":"allow"}'), { decision: 'allow' });
  assert.deepEqual(parseReply('{"decision":"deny","reason":"no"}'), { decision: 'deny', reason: 'no' });
  assert.deepEqual(parseReply(' {"decision":"allow","context":"c"}\n'), { decision: 'allow', context: 'c' });
  for (const bad of ['', 'not json', '[]', 'null', '{"decision":"maybe"}', '{"decision":"deny"}',
    '{"decision":"deny","reason":""}', '{"decision":"deny","reason":"  "}', '{"decision":"allow","extra":1}',
    '{"decision":"allow","context":5}', `{"decision":"allow","context":"${'x'.repeat(CONTEXT_LIMIT + 1)}"}`,
    `{"decision":"deny","reason":"${'x'.repeat(CONTEXT_LIMIT + 1)}"}`]) {
    assert.throws(() => parseReply(bad), { code: 'INVALID_REPLY' }, bad.slice(0, 40));
  }
  assert.equal(parseReply(`{"decision":"allow","context":"${'x'.repeat(CONTEXT_LIMIT)}"}`).context.length, CONTEXT_LIMIT);
  assert.equal(CONTEXT_LIMIT, 10000);
});

test('Claude and Codex share the standard decision model with exit 2 refusals', () => {
  for (const harness of ['claude-code', 'codex']) {
    const { encodeReply, replies } = adapterFor(harness);
    assert.deepEqual(Object.keys(replies).sort(), ['PreToolUse', 'Stop', 'UserPromptSubmit']);
    assert.deepEqual(encodeReply('PreToolUse', { decision: 'deny', reason: 'no' }), {
      stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"no"}}\n',
      stderr: 'no\n', exitCode: 2 });
    assert.deepEqual(encodeReply('UserPromptSubmit', { decision: 'deny', reason: 'no' }), {
      stdout: '{"decision":"block","reason":"no"}\n', stderr: 'no\n', exitCode: 2 });
    assert.deepEqual(encodeReply('Stop', { decision: 'deny', reason: 'keep going' }), {
      stdout: '{"decision":"block","reason":"keep going"}\n', stderr: 'keep going\n', exitCode: 2 });
    assert.deepEqual(encodeReply('PreToolUse', { decision: 'allow', context: 'c' }), {
      stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"c"}}\n', stderr: '', exitCode: 0 });
    assert.deepEqual(encodeReply('UserPromptSubmit', { decision: 'allow', context: 'c' }), {
      stdout: '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"c"}}\n', stderr: '', exitCode: 0 });
    for (const event of ['PreToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart', 'SessionEnd']) {
      assert.deepEqual(encodeReply(event, { decision: 'allow' }), { stdout: '', stderr: '', exitCode: 0 });
    }
    assert.throws(() => encodeReply('Stop', { decision: 'allow', context: 'c' }), { code: 'UNSUPPORTED_REPLY' });
    assert.throws(() => encodeReply('SessionStart', { decision: 'allow', context: 'c' }), { code: 'UNSUPPORTED_REPLY' });
    assert.throws(() => encodeReply('SessionStart', { decision: 'deny', reason: 'no' }), { code: 'UNSUPPORTED_REPLY' });
    assert.throws(() => encodeReply('SessionEnd', { decision: 'deny', reason: 'no' }), { code: 'UNSUPPORTED_REPLY' });
    assert.equal(encodeReply('PreToolUse', { decision: 'deny', reason: 'no', context: 'c' }).stdout.includes('additionalContext'), false);
  }
  assert.throws(() => adapterFor('claude-code').encodeReply('Notification:permission_prompt', { decision: 'deny', reason: 'no' }), { code: 'UNSUPPORTED_REPLY' });
  assert.throws(() => adapterFor('codex').encodeReply('PermissionRequest', { decision: 'deny', reason: 'no' }), { code: 'UNSUPPORTED_REPLY' });
  assert.throws(() => encodeStandardReply('PreToolUse', { decision: 'deny', reason: 'no' }), { code: 'UNSUPPORTED_REPLY' });
});

test('OpenCode has no reply channel and every adapter states its outer timeouts', () => {
  const opencode = adapterFor('opencode');
  assert.deepEqual(opencode.replies, {});
  assert.deepEqual(opencode.encodeReply('session.busy', { decision: 'allow' }), { stdout: '', stderr: '', exitCode: 0 });
  assert.throws(() => opencode.encodeReply('session.busy', { decision: 'deny', reason: 'no' }), { code: 'UNSUPPORTED_REPLY' });
  assert.deepEqual(adapterFor('claude-code').outerTimeouts, { default: 600000, UserPromptSubmit: 30000, SessionEnd: 1500, max: { SessionEnd: 60000 } });
  assert.deepEqual(adapterFor('codex').outerTimeouts, { default: 600000, SessionEnd: 1000, max: { SessionEnd: 3000 } });
  assert.deepEqual(opencode.outerTimeouts, { default: 5000, max: {} });
  assert.equal(KINDS.length, 10);
  assert.ok(Object.isFrozen(KINDS));
});
