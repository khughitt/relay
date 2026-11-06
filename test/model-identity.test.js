import test from 'node:test';
import assert from 'node:assert/strict';
import { verified, unverified, renderAnswer } from '../src/model-identity.js';

const keys = ['verified', 'agent', 'harness', 'model', 'effort', 'effortReason', 'reason', 'source'];
const result = (model = 'gpt-6.1-sol', effort = 'high', harness = 'codex') =>
  verified({ harness, model, effort, source: { thread: 'thread' }, effortDetail: 'the turn carries no effort' });

for (const [model, effort, harness, agent] of [
  ['gpt-6.1-sol', 'high', 'codex', 'codex/gpt-6.1-sol@high'],
  ['gpt-oss:20b', null, 'codex', 'codex/gpt-oss:20b'],
  ['openai/x', 'low', 'agy', 'agy/openai/x@low'],
  ['gpt-6.1-sol', '', 'codex', 'codex/gpt-6.1-sol'],
]) {
  test(`stamps ${agent} with the shared answer contract`, () => {
    const r = result(model, effort, harness);
    assert.deepEqual(r, { answer: { verified: true, agent, harness, model, effort: effort || null,
      effortReason: effort ? null : 'not-recorded', reason: null, source: { thread: 'thread' } },
      detail: effort ? null : 'the turn carries no effort' });
    assert.deepEqual(Object.keys(r.answer), keys);
  });
}
for (const [model, effort, invalid] of [['gpt 6', 'high', 'gpt 6'], ['a@b', 'high', 'a@b'], ['gpt-6.1-sol', 'High', 'High']]) {
  test(`refuses unstampable value ${invalid}`, () => {
    const r = result(model, effort);
    assert.deepEqual(r.answer, { verified: false, agent: 'codex', harness: 'codex', model: null,
      effort: null, effortReason: null, reason: 'unstampable', source: { thread: 'thread' } });
    assert.ok(r.detail.includes(invalid));
    assert.deepEqual(Object.keys(r.answer), keys);
  });
}
test('renders JSON silently and pretty answers with their diagnostic', () => {
  const yes = result(), missing = result('gpt-oss:20b', null);
  const no = unverified('codex', 'no-thread', 'thread is absent');
  assert.deepEqual(Object.keys(no.answer), keys);
  assert.deepEqual(no.answer.source, {});
  for (const r of [yes, missing, no]) {
    assert.deepEqual(renderAnswer(r, 'json'), { stdout: `${JSON.stringify(r.answer)}\n`, stderr: '' });
  }
  assert.deepEqual(renderAnswer(yes, 'pretty'), { stdout: 'codex/gpt-6.1-sol@high\n', stderr: '' });
  assert.deepEqual(renderAnswer(missing, 'pretty'), { stdout: 'codex/gpt-oss:20b\n', stderr: 'relay: effort not recorded: the turn carries no effort\n' });
  assert.deepEqual(renderAnswer(no, 'pretty'), { stdout: 'codex\n', stderr: 'relay: model unverified (no-thread): thread is absent\n' });
});
