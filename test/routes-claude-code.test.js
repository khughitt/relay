import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toQuestion, nativeAnswers, allowReply, denyReply, observedAnswers, EXPIRY_MS, DECLINED } from '../src/routes/claude-code.js';
import { expectAnswers } from '../src/routes/index.js';
import { createEntry, applyAnswer } from '../src/interaction/lifecycle.js';
import { uuid, HANDLE, NOW } from './helpers/interaction.js';

const prePayload = (questions) => ({ session_id: 's-test', transcript_path: '/tmp/t.jsonl', cwd: '/tmp/ws', hook_event_name: 'PreToolUse',
  tool_name: 'AskUserQuestion', tool_use_id: 'toolu_test',
  tool_input: { questions: questions ?? [{ question: 'Which shape?', header: 'Shape', multiSelect: false,
    options: [{ label: 'Circle', description: 'Round' }, { label: 'Square', description: 'Four sides' }] }] } });
const answer = (patch) => ({ answerId: uuid(), surface: 'phone', outcome: 'answered', artifactRevision: null, values: { q1: { type: 'choice', optionIds: ['o2'] } }, ...patch });

test('a Claude call becomes a validated clarification keyed to its tool_use_id', () => {
  const id = uuid(), q = toQuestion(prePayload(), { now: NOW, id });
  assert.equal(q.id, id); assert.equal(q.from.agentId, 'claude-code:s-test');
  assert.deepEqual(q.body.native, { harness: 'claude-code', sessionId: 's-test', callId: 'toolu_test' });
  assert.equal(q.body.expiresAt, NOW + EXPIRY_MS); assert.equal(q.context.cwd, '/tmp/ws');
  assert.deepEqual(q.context, { project: null, taskId: null, cwd: '/tmp/ws' });
  assert.deepEqual(q.body.items[0], { id: 'q1', header: 'Shape', prompt: 'Which shape?', type: 'single',
    options: [{ id: 'o1', label: 'Circle', description: 'Round' }, { id: 'o2', label: 'Square', description: 'Four sides' }],
    recommended: null, allowOther: true, maxLength: null });
});
test('a registry-resolved project is explicit and payload fields cannot spoof it', () => {
  const payload = { ...prePayload(), project: 'spoof', projectKey: 'spoof-key' };
  assert.equal(toQuestion(payload, { now: NOW, id: uuid() }).context.project, null);
  assert.equal(toQuestion(payload, { now: NOW, id: uuid(), project: 'known-project' }).context.project, 'known-project');
});
test('out-of-schema calls are refused, never trimmed', () => {
  const one = prePayload().tool_input.questions[0];
  assert.throws(() => toQuestion(prePayload([one, one, one, one, one].map((q, i) => ({ ...q, question: `Q${i}` }))), { now: NOW, id: uuid() }), { code: 'INVALID_MESSAGE' });
  assert.throws(() => toQuestion(prePayload([{ ...one, header: 'x'.repeat(17) }]), { now: NOW, id: uuid() }), { code: 'INVALID_MESSAGE' });
  assert.throws(() => toQuestion({ ...prePayload(), tool_name: 'Bash' }, { now: NOW, id: uuid() }), { code: 'INVALID_INPUT' });
  assert.throws(() => toQuestion({ ...prePayload(), tool_use_id: undefined }, { now: NOW, id: uuid() }), { code: 'INVALID_INPUT' });
});
test('answers map back to labels: single, multi joined with comma-space, other, declined', () => {
  const multi = prePayload([{ ...prePayload().tool_input.questions[0], multiSelect: true }]);
  const q = toQuestion(prePayload(), { now: NOW, id: uuid() }), m = toQuestion(multi, { now: NOW, id: uuid() });
  assert.deepEqual(nativeAnswers(q, answer()), { 'Which shape?': 'Square' });
  assert.deepEqual(nativeAnswers(m, answer({ values: { q1: { type: 'choice', optionIds: ['o1', 'o2'] } } })), { 'Which shape?': 'Circle, Square' });
  assert.deepEqual(nativeAnswers(q, answer({ values: { q1: { type: 'other', text: 'Hexagon' } } })), { 'Which shape?': 'Hexagon' });
  assert.deepEqual(nativeAnswers(q, answer({ outcome: 'declined', values: {} })), { 'Which shape?': DECLINED });
});
test('allow echoes the original input plus answers; declined adds context; deny names the reason', () => {
  const p = prePayload(), q = toQuestion(p, { now: NOW, id: uuid() });
  assert.deepEqual(allowReply(p, q, answer()), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow',
    updatedInput: { questions: p.tool_input.questions, answers: { 'Which shape?': 'Square' } } } });
  assert.match(allowReply(p, q, answer({ outcome: 'declined', values: {} })).hookSpecificOutput.additionalContext, /chose not to answer/);
  assert.deepEqual(denyReply('gone'), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'gone' } });
});
test('observed answers come from the probed PostToolUse shape', () => {
  const post = JSON.parse(readFileSync(new URL('./fixtures/claude-askuserquestion-post.json', import.meta.url), 'utf8'));
  assert.deepEqual(observedAnswers(post), { [post.tool_input.questions[0].question]: 'Square' });
  assert.throws(() => observedAnswers({ ...post, tool_response: {} }), { code: 'INVALID_INPUT' });
});
test('expectAnswers dispatches by harness', () => {
  const q = toQuestion(prePayload(), { now: NOW, id: uuid() });
  const e = applyAnswer(createEntry(q, { handback: false, waiter: HANDLE, now: NOW }), { schema: 1, id: uuid(), kind: 'answer', correlationId: q.id,
    from: { kind: 'user' }, to: q.from, createdAt: NOW, context: q.context, body: answer() }, NOW).entry;
  assert.deepEqual(expectAnswers(e), { 'Which shape?': 'Square' });
  assert.throws(() => expectAnswers({ ...e, question: { ...q, body: { ...q.body, native: { ...q.body.native, harness: 'codex' } } } }), { code: 'UNSUPPORTED_ROUTE' });
});
