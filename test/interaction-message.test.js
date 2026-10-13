import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateMessage, checkAnswer, MESSAGE_KINDS, CLASSES, ITEM_TYPES, SURFACES, WITHDRAWAL_REASONS } from '../src/interaction/message.js';
import { questionMessage, answerMessage, deferMessage, withdrawalMessage, noticeMessage, uuid } from './helpers/interaction.js';

const invalid = (value) => assert.throws(() => validateMessage(value), { code: 'INVALID_MESSAGE' });
const badAnswer = (q, body) => assert.throws(() => checkAnswer(q.body, body), { code: 'INVALID_ANSWER' });

// The committed schema is read, never restated, so a limit changed in the schema and not in the
// validator, or the reverse, fails here.
const schema = JSON.parse(readFileSync(new URL('../schemas/interaction/message.schema.json', import.meta.url), 'utf8'));
const deref = (node) => (node.$ref ? deref(node.$ref.slice(2).split('/').reduce((n, key) => n[key], schema)) : node);
function def(path) {
  const node = path.split('.').reduce((n, key) => n?.[key], schema);
  assert.ok(node, `the schema has ${path}`);
  return deref(node);
}
function number(node, key) {
  assert.equal(typeof node[key], 'number', `the schema node has a numeric ${key}`);
  return node[key];
}
function accepts(message) {
  try { validateMessage(message); return true; } catch (error) { if (error.code !== 'INVALID_MESSAGE') throw error; return false; }
}
const accepted = (message, label) => assert.equal(accepts(message), true, `accepted: ${label}`);
const rejected = (message, label) => assert.equal(accepts(message), false, `rejected: ${label}`);
// Both sides of each string bound: the bound is accepted, one past it rejected.
function lengths(node, make, label) {
  const min = node.minLength ?? 0, max = number(node, 'maxLength');
  accepted(make('x'.repeat(min)), `${label} at minLength ${min}`);
  accepted(make('x'.repeat(max)), `${label} at maxLength ${max}`);
  if (min > 0) rejected(make('x'.repeat(min - 1)), `${label} below minLength ${min}`);
  rejected(make('x'.repeat(max + 1)), `${label} past maxLength ${max}`);
}
function members(node, make, outsider, label) {
  assert.ok(Array.isArray(node.enum) && node.enum.length > 0, `${label} is an enum`);
  for (const value of node.enum) accepted(make(value), `${label} ${value}`);
  rejected(make(outsider), `${label} ${outsider}`);
}
// The validator accepts a candidate exactly when the schema's pattern matches it.
function agrees(node, make, candidates, label) {
  const pattern = new RegExp(node.pattern), verdicts = candidates.map((c) => pattern.test(c));
  assert.ok(verdicts.includes(true) && verdicts.includes(false), `${label} candidates fall on both sides of the pattern`);
  candidates.forEach((c, i) => assert.equal(accepts(make(c)), verdicts[i], `${label} ${JSON.stringify(c)}: the validator agrees with the schema pattern`));
}
const ID_CANDIDATES = ['q1', 'a', '0', 'a-b', '9-', `a${'-'.repeat(31)}`, `a${'b'.repeat(32)}`, '-a', 'Q1', 'q_1', 'q 1', '', 'q1\n', 'é'];

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
test('schema string bounds count Unicode code points', () => {
  const item = questionMessage().body.items[0];
  const withHeader = (header) => questionMessage({ body: { items: [{ ...item, header }] } });
  assert.ok(validateMessage(withHeader('😀'.repeat(9))));
  invalid(withHeader('😀'.repeat(17)));
});

test('answer text maxLength counts Unicode code points', () => {
  const item = questionMessage().body.items[0];
  const q = questionMessage({ body: { items: [{ ...item, type: 'text', options: [], allowOther: false, maxLength: 1 }] } });
  checkAnswer(q.body, answerMessage(q, { values: { q1: { type: 'text', text: '😀' } } }).body);
  badAnswer(q, answerMessage(q, { values: { q1: { type: 'text', text: '😀😀' } } }).body);
});
test('UUID text accepts the nil UUID and still rejects malformed values', () => {
  const nil = '00000000-0000-0000-0000-000000000000';
  assert.equal(validateMessage(questionMessage({ id: nil })).id, nil);
  const malformed = '00000000-0000-0000-0000-00000000000g';
  invalid({ ...questionMessage(), id: malformed, correlationId: malformed });
});
test('UUID text is lowercase only: an uppercase id would collide with its lowercase twin on a case-insensitive filesystem', () => {
  const q = questionMessage(), upper = q.id.toUpperCase();
  invalid({ ...q, id: upper, correlationId: upper });
  invalid({ ...answerMessage(q), correlationId: upper });
  invalid(answerMessage(q, { answerId: uuid().toUpperCase() }));
  invalid(questionMessage({ body: { supersedes: uuid().toUpperCase() } }));
  invalid({ ...deferMessage(q), id: uuid().toUpperCase() });
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
  const pattern = new RegExp(schema.$defs.uuid.pattern), id = uuid();
  for (const [text, valid] of [[id, true], ['00000000-0000-0000-0000-000000000000', true], [id.toUpperCase(), false], [`${id}x`, false], [`x${id}`, false]]) {
    assert.equal(pattern.test(text), valid, text);
    if (valid) assert.equal(validateMessage(questionMessage({ id: text })).id, text);
    else invalid(questionMessage({ id: text }));
  }
});

const withNotice = (body) => { const n = noticeMessage(); return { ...n, body: { ...n.body, ...body } }; };
const withItem = (patch) => { const q = questionMessage(); return questionMessage({ body: { items: [{ ...q.body.items[0], ...patch }] } }); };
const option = (n) => ({ id: `o${n}`, label: `Option ${n}`, description: null });
const textItem = { type: 'text', options: [], recommended: null, allowOther: false };

test('notice title, text and level follow the schema bounds and vocabulary', () => {
  const props = def('$defs.notice.properties');
  lengths(def('$defs.notice.properties.title'), (title) => withNotice({ title }), 'notice title');
  lengths(def('$defs.notice.properties.text'), (text) => withNotice({ text }), 'notice text');
  members(def('$defs.notice.properties.level'), (level) => withNotice({ level }), 'error', 'notice level');
  assert.deepEqual(def('$defs.notice').required, ['expiresAt', 'title', 'text', 'level']);
  for (const key of Object.keys(props)) {
    const body = { ...noticeMessage().body }; delete body[key];
    rejected({ ...noticeMessage(), body }, `notice without ${key}`);
  }
  rejected(withNotice({ title: 7 }), 'a non-string notice title');
});
test('a defer surface and an answer outcome come from the schema vocabularies', () => {
  const q = questionMessage();
  members(def('$defs.defer.properties.surface'), (surface) => deferMessage(q, surface), 'watch', 'defer surface');
  rejected({ ...deferMessage(q), body: {} }, 'a defer without a surface');
  members(def('$defs.answer.properties.outcome'), (outcome) => answerMessage(q, { outcome }), 'maybe', 'answer outcome');
  rejected(answerMessage(q, { outcome: undefined }), 'an answer without an outcome');
});
test('option label and description limits come from the schema', () => {
  const q = questionMessage(), [, second] = q.body.items[0].options;
  const withOption = (patch) => withItem({ options: [{ ...option(1), ...patch }, second] });
  lengths(def('$defs.option.properties.label'), (label) => withOption({ label }), 'option label');
  lengths(def('$defs.option.properties.description'), (description) => withOption({ description }), 'option description');
  accepted(withOption({ description: null }), 'a null option description');
});
test('a choice item takes between the schema minimum and maximum of options', () => {
  const max = number(def('$defs.item.properties.options'), 'maxItems');
  const min = number(def('$defs.item').allOf[0].then.properties.options, 'minItems');
  for (const type of ['single', 'multi']) {
    const withOptions = (n) => withItem({ type, options: Array.from({ length: n }, (_, i) => option(i + 1)) });
    accepted(withOptions(min), `${type} with ${min} options`);
    accepted(withOptions(max), `${type} with ${max} options`);
    rejected(withOptions(min - 1), `${type} with ${min - 1} options`);
    rejected(withOptions(max + 1), `${type} with ${max + 1} options`);
  }
});
test('item and option ids match the schema id pattern', () => {
  assert.equal(schema.$defs.item.properties.id.$ref, '#/$defs/id');
  assert.equal(schema.$defs.option.properties.id.$ref, '#/$defs/id');
  agrees(def('$defs.item.properties.id'), (id) => withItem({ id }), ID_CANDIDATES, 'item id');
  const [, second] = questionMessage().body.items[0].options;
  agrees(def('$defs.option.properties.id'), (id) => withItem({ options: [{ ...option(1), id }, second] }), ID_CANDIDATES, 'option id');
});
test('a text item maxLength lies within the schema minimum and maximum', () => {
  const node = def('$defs.item.properties.maxLength'), min = number(node, 'minimum'), max = number(node, 'maximum');
  const withLimit = (maxLength) => withItem({ ...textItem, maxLength });
  for (const n of [min, max]) accepted(withLimit(n), `text maxLength ${n}`);
  for (const n of [min - 1, max + 1, 1.5, '10']) rejected(withLimit(n), `text maxLength ${n}`);
  accepted(withLimit(null), 'text maxLength null');
});
test('answer values: text and other bounds, and a choice of unique option ids within the schema count', () => {
  const q = questionMessage(), variant = (type) => def('$defs.value').oneOf.find((v) => v.properties.type.const === type);
  const valued = (value) => answerMessage(q, { values: { q1: value } });
  lengths(variant('text').properties.text, (text) => valued({ type: 'text', text }), 'text value');
  lengths(variant('other').properties.text, (text) => valued({ type: 'other', text }), 'other value');
  const ids = variant('choice').properties.optionIds;
  assert.equal(ids.uniqueItems, true);
  const min = number(ids, 'minItems'), max = number(ids, 'maxItems');
  const chosen = (n) => valued({ type: 'choice', optionIds: Array.from({ length: n }, (_, i) => `o${i + 1}`) });
  accepted(chosen(min), `${min} option ids`); accepted(chosen(max), `${max} option ids`);
  rejected(chosen(min - 1), `${min - 1} option ids`); rejected(chosen(max + 1), `${max + 1} option ids`);
  rejected(valued({ type: 'choice', optionIds: ['o1', 'o1'] }), 'duplicate option ids in a choice value');
  rejected(valued({ type: 'choice', optionIds: ['o1', 'o2', 'o1'] }), 'a repeated option id after another');
});
test('createdAt is an integer millisecond time within the schema range', () => {
  assert.equal(schema.properties.createdAt.$ref, '#/$defs/ms');
  const node = def('properties.createdAt'), min = number(node, 'minimum'), max = number(node, 'maximum');
  assert.equal(node.type, 'integer');
  for (const createdAt of [min, max]) {
    accepted(questionMessage({ createdAt }), `createdAt ${createdAt}`);
    accepted({ ...noticeMessage(), createdAt }, `notice createdAt ${createdAt}`);
  }
  for (const createdAt of [min - 1, max + 1, 1.5, '0', null, undefined, Number.NaN]) {
    rejected(questionMessage({ createdAt }), `createdAt ${createdAt}`);
    rejected({ ...answerMessage(questionMessage()), createdAt }, `answer createdAt ${createdAt}`);
  }
});
