import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateMessage, checkAnswer, MESSAGE_KINDS, CLASSES, ITEM_TYPES, SURFACES, WITHDRAWAL_REASONS } from '../src/interaction/message.js';
import { questionMessage, answerMessage, deferMessage, withdrawalMessage, noticeMessage, uuid } from './helpers/interaction.js';

const invalid = (value) => assert.throws(() => validateMessage(value), { code: 'INVALID_MESSAGE' });
const badAnswer = (q, body) => assert.throws(() => checkAnswer(q.body, body), { code: 'INVALID_ANSWER' });

test('every kind round-trips to an equal normalized object', () => {
  const q = questionMessage();
  for (const m of [q, answerMessage(q), deferMessage(q), withdrawalMessage(q), noticeMessage()]) assert.deepEqual(validateMessage(m), m);
});
test('unknown optional fields are dropped, unknown schema and kind rejected', () => {
  const q = questionMessage();
  assert.equal(Object.hasOwn(validateMessage({ ...q, extra: 1 }), 'extra'), false);
  invalid({ ...q, schema: 2 }); invalid({ ...q, kind: 'verdict' }); invalid(null); invalid([]);
});
test('question and notice correlate to themselves', () => {
  invalid({ ...questionMessage(), correlationId: uuid() });
  invalid({ ...noticeMessage(), correlationId: uuid() });
});
test('ids, parties and context are checked', () => {
  invalid({ ...questionMessage(), id: 'not-a-uuid' });
  invalid({ ...questionMessage(), from: { kind: 'agent', agentId: 'vim:1' } });
  invalid({ ...questionMessage(), to: { kind: 'robot' } });
  invalid({ ...questionMessage(), context: { project: null, taskId: 'relay-zz', cwd: null } });
  assert.equal(validateMessage(questionMessage({ context: { project: 'p', taskId: 'relay-f58531', cwd: null } })).context.taskId, 'relay-f58531');
  assert.deepEqual(validateMessage(questionMessage({ context: { project: '', taskId: null, cwd: '' } })).context,
    { project: '', taskId: null, cwd: '' });
});
test('items: 1 to 4, unique ids, option counts by type, limits', () => {
  const item = questionMessage().body.items[0];
  const withItems = (items) => questionMessage({ body: { items } });
  invalid(withItems([])); invalid(withItems([item, item]));
  invalid(withItems([1, 2, 3, 4, 5].map((n) => ({ ...item, id: `q${n}` }))));
  invalid(withItems([{ ...item, options: [item.options[0]] }]));
  invalid(withItems([{ ...item, options: [item.options[0], item.options[0]] }]));
  invalid(withItems([{ ...item, header: 'x'.repeat(17) }]));
  invalid(withItems([{ ...item, prompt: 'x'.repeat(1001) }]));
  invalid(withItems([{ ...item, recommended: 'o9' }]));
  invalid(withItems([{ ...item, type: 'text', options: [], allowOther: true }]));
  invalid(withItems([{ ...item, type: 'boolean', options: [], allowOther: false, maxLength: 5 }]));
  invalid(withItems([{ ...item, maxLength: 10 }]));
  assert.ok(validateMessage(withItems([{ ...item, type: 'text', options: [], allowOther: false, maxLength: 200 }])));
  assert.ok(validateMessage(withItems([{ ...item, recommended: 'o2' }])));
});
test('question native, artifact, supersedes and expiry', () => {
  invalid(questionMessage({ body: { native: { harness: 'vim', sessionId: 's', callId: 'c' } } }));
  invalid(questionMessage({ body: { artifact: { ref: 'x' } } }));
  invalid(questionMessage({ body: { supersedes: 'x' } }));
  invalid(questionMessage({ body: { expiresAt: -1 } }));
  invalid(questionMessage({ body: { class: 'verdict' } }));
  const revision = 'r'.repeat(300);
  assert.equal(validateMessage(questionMessage({ body: { artifact: { ref: 'x', revision } } })).body.artifact.revision, revision);
});
test('answer bodies', () => {
  const q = questionMessage();
  invalid(answerMessage(q, { answerId: 'x' })); invalid(answerMessage(q, { surface: 'watch' }));
  invalid(answerMessage(q, { values: { q1: { type: 'choice', optionIds: [] } } }));
  invalid(answerMessage(q, { values: { q1: { type: 'other', text: '' } } }));
  invalid({ ...withdrawalMessage(q), body: { reason: 'bored' } });
});
test('checkAnswer fits values to items', () => {
  const q = questionMessage(), body = (patch) => answerMessage(q, patch).body;
  checkAnswer(q.body, body());
  checkAnswer(q.body, body({ outcome: 'declined', values: {} }));
  badAnswer(q, body({ outcome: 'declined' }));
  badAnswer(q, body({ values: {} }));
  badAnswer(q, body({ values: { q1: { type: 'choice', optionIds: ['o1', 'o2'] } } }));
  badAnswer(q, body({ values: { q1: { type: 'choice', optionIds: ['o9'] } } }));
  badAnswer(q, body({ values: { q1: { type: 'text', text: 'hi' } } }));
  badAnswer(q, body({ values: { q1: { type: 'choice', optionIds: ['o1'] }, q2: { type: 'boolean', value: true } } }));
  checkAnswer(q.body, body({ values: { q1: { type: 'other', text: 'Hexagon' } } }));
  const closed = questionMessage({ body: { items: [{ ...q.body.items[0], allowOther: false }] } });
  badAnswer(closed, answerMessage(closed, { values: { q1: { type: 'other', text: 'x' } } }).body);
  const multi = questionMessage({ body: { items: [{ ...q.body.items[0], type: 'multi' }] } });
  checkAnswer(multi.body, answerMessage(multi, { values: { q1: { type: 'choice', optionIds: ['o1', 'o2'] } } }).body);
  const text = questionMessage({ body: { items: [{ ...q.body.items[0], type: 'text', options: [], allowOther: false, maxLength: 3 }] } });
  badAnswer(text, answerMessage(text, { values: { q1: { type: 'text', text: 'four' } } }).body);
  const bool = questionMessage({ body: { items: [{ ...q.body.items[0], type: 'boolean', options: [], allowOther: false }] } });
  checkAnswer(bool.body, answerMessage(bool, { values: { q1: { type: 'boolean', value: false } } }).body);
});
test('artifactRevision is present exactly when the question has an artifact', () => {
  const plain = questionMessage(), reviewed = questionMessage({ body: { class: 'artifact-review', artifact: { ref: 'docs/x.md', revision: 'abc' } } });
  badAnswer(plain, answerMessage(plain, { artifactRevision: 'abc' }).body);
  badAnswer(reviewed, answerMessage(reviewed).body);
  checkAnswer(reviewed.body, answerMessage(reviewed, { artifactRevision: 'other' }).body); // a mismatch is STALE, judged by the lifecycle
});
test('the committed JSON Schema agrees with the validator vocabularies', () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/interaction/message.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.properties.kind.enum, MESSAGE_KINDS);
  assert.deepEqual(schema.$defs.question.properties.class.enum, CLASSES);
  assert.deepEqual(schema.$defs.item.properties.type.enum, ITEM_TYPES);
  assert.deepEqual(schema.$defs.surface.enum, SURFACES);
  assert.deepEqual(schema.$defs.withdrawal.properties.reason.enum, WITHDRAWAL_REASONS);
});
