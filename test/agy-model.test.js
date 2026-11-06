import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveAgyModel, effortOf, modelOf } from '../src/adapters/agy-model.js';
import { encodeGeneration, agyStore } from './helpers/agy-store.js';

const conversation = '45d5430e-0906-4123-8123-0123456789ab';
const trajectory = 'trajectory';
const row = (pid, ppid, comm) => ({ pid, ppid, comm, tty: null, starttime: '1', state: 'S' });
const underAgy = [row(30, 20, 'node'), row(20, 10, 'bash'), row(10, 5, 'agy')];
const fakeOps = (chain = underAgy, init = null) => ({
  ancestors: () => chain.map((r) => ({ ...r })), recordOf: (pid) => pid === 1 ? init : null,
  executableOf: () => { throw new Error('executable must not be read'); },
  startedAtMs: () => { throw new Error('clock must not be read'); },
});
const metadata = (stepIndex = 3, id = conversation) => JSON.stringify({ tool: { conversationId: id, stepIndex } });
const generation = (options = {}) => encodeGeneration({ model: 'gemini-4-argon', label: 'Gemini 4 Argon (High)', lastStep: 1, cascade: conversation, trajectory, ...options });
const fixture = (t, rows = [generation()], id = conversation) => {
  const store = agyStore(t, { conversation: id, rows });
  return { ...store, env: { ANTIGRAVITY_CONVERSATION_ID: id, ANTIGRAVITY_SOURCE_METADATA: metadata(3, id),
    ANTIGRAVITY_APP_DATA_DIR: store.appData, ANTIGRAVITY_TRAJECTORY_ID: trajectory } };
};
const resolve = (env, ops = fakeOps(), extra = {}) => resolveAgyModel({ env, ops, startPid: 30, ...extra });

test('model and effort helpers remove only the recorded effort suffix', () => {
  assert.equal(effortOf(null), null);
  assert.equal(effortOf('Gemini 4 Argon (Medium)'), 'medium');
  assert.equal(effortOf('Gemini 4 Argon (High) (Preview)'), null);
  assert.equal(effortOf('Gemini 4 (Thinking 2)'), null);
  assert.equal(modelOf('claude-sonnet-5-5-low', 'low'), 'claude-sonnet-5-5');
  assert.equal(modelOf('gemini-4-argon-f', 'high'), 'gemini-4-argon-f');
  assert.equal(modelOf('model-low', null), 'model-low');
});

for (const [model, label, agent, effort] of [
  ['gemini-4-argon', 'Gemini 4 Argon (High)', 'agy/gemini-4-argon@high', 'high'],
  ['gemini-3.8-flash', 'Gemini 3.8 Flash (Low)', 'agy/gemini-3.8-flash@low', 'low'],
  ['claude-sonnet-5-5-low', 'Claude Sonnet 5.5 (Low)', 'agy/claude-sonnet-5-5@low', 'low'],
  ['gemini-4-argon-f', 'Gemini 4 Argon (High)', 'agy/gemini-4-argon-f@high', 'high'],
  ['gemini-4-argon', 'Gemini 4 Argon (Medium)', 'agy/gemini-4-argon@medium', 'medium'],
  ['gemini-3.8-flash-tiered', undefined, 'agy/gemini-3.8-flash-tiered', null],
  ['gemini-4-argon', 'Gemini 4 Argon (High) (Preview)', 'agy/gemini-4-argon', null],
  ['gemini-4-argon', 'Gemini 4 (Thinking 2)', 'agy/gemini-4-argon', null],
]) test(`verified ${agent}, label ${label}`, async (t) => {
  const { env, database } = fixture(t, [generation({ model, label }), generation({ lastStep: 4, model: 'later-model' })]);
  const result = await resolve(env);
  assert.deepEqual(result.answer, { verified: true, agent, harness: 'agy', model: model === 'claude-sonnet-5-5-low' ? 'claude-sonnet-5-5' : model,
    effort, effortReason: effort === null ? 'not-recorded' : null, reason: null,
    source: { conversation, step: 3, generation: 0, database, label: label ?? null } });
  if (effort === null) assert.match(result.detail, /generation 0/);
  else assert.equal(result.detail, null);
});

test('subagent root_cascade_id may differ from its own conversation', async (t) => {
  const key = Buffer.from('root_cascade_id'), value = Buffer.from('parent');
  const entry = Buffer.concat([Buffer.from([10, key.length]), key, Buffer.from([18, value.length]), value]);
  const extra = Buffer.concat([Buffer.from([162, 1, entry.length]), entry]);
  const { env } = fixture(t, [generation({ extra })]);
  assert.equal((await resolve(env)).answer.agent, 'agy/gemini-4-argon@high');
});

test('no conversation decides before ancestry, files or SQLite', async () => {
  for (const id of [undefined, '']) {
    const result = await resolve({ ANTIGRAVITY_CONVERSATION_ID: id }, {
      ancestors: () => { throw new Error('unexpected ancestry'); },
    }, { importSqlite: () => { throw new Error('unexpected SQLite'); } });
    assert.equal(result.answer.reason, 'no-conversation');
    assert.deepEqual(result.answer.source, {});
  }
});

test('the nearest harness must be agy, including an agy at pid 1', async () => {
  const env = { ANTIGRAVITY_CONVERSATION_ID: conversation };
  for (const chain of [[row(30, 20, 'node'), row(20, 10, 'claude'), row(10, 5, 'agy')], [row(30, 20, 'node')]]) {
    const result = await resolve(env, fakeOps(chain));
    assert.equal(result.answer.reason, 'not-under-agy');
    assert.deepEqual(result.answer.source, { conversation });
  }
  assert.equal((await resolve(env, fakeOps([row(30, 1, 'node')], row(1, 0, 'agy')))).answer.reason, 'no-step');
});

test('unreadable process ancestry remains a failure', async () => {
  await assert.rejects(resolve({ ANTIGRAVITY_CONVERSATION_ID: conversation }, {
    ancestors: () => { throw Object.assign(new Error('unreadable'), { code: 'PROCESS_UNREADABLE' }); },
  }), { code: 'PROCESS_UNREADABLE' });
});

test('missing step decides before app-data configuration', async () => {
  for (const value of [undefined, '']) {
    const result = await resolve({ ANTIGRAVITY_CONVERSATION_ID: conversation, ANTIGRAVITY_SOURCE_METADATA: value });
    assert.equal(result.answer.reason, 'no-step');
    assert.deepEqual(result.answer.source, { conversation });
  }
});

for (const value of ['{', '{}', 'null', '[]', metadata('3'), metadata(-1), metadata(2.5), metadata(3, 'other')])
  test(`rejects invalid source metadata ${value}`, async () => {
    await assert.rejects(resolve({ ANTIGRAVITY_CONVERSATION_ID: conversation, ANTIGRAVITY_SOURCE_METADATA: value }), { code: 'INVALID_INPUT' });
  });

test('rejects uppercase conversation before inspecting ancestry', async () => {
  await assert.rejects(resolve({ ANTIGRAVITY_CONVERSATION_ID: conversation.toUpperCase() }, { ancestors: () => { throw new Error('unexpected ancestry'); } }), { code: 'INVALID_INPUT' });
});

test('accepts a lowercase UUIDv7 conversation', async (t) => {
  const id = '01a14985-3a99-7e12-9643-455088b7d4ec';
  const { env } = fixture(t, [generation({ cascade: id })], id);
  assert.equal((await resolve(env)).answer.verified, true);
});

for (const appData of [undefined, '', 'relative']) test(`rejects invalid app-data ${appData}`, async () => {
  await assert.rejects(resolve({ ANTIGRAVITY_CONVERSATION_ID: conversation, ANTIGRAVITY_SOURCE_METADATA: metadata(), ANTIGRAVITY_APP_DATA_DIR: appData }), { code: 'INVALID_CONFIG' });
});

test('missing conversation database is unverified with its path', async (t) => {
  const { env, database } = fixture(t);
  fs.unlinkSync(database);
  const result = await resolve(env);
  assert.equal(result.answer.reason, 'no-conversation-record');
  assert.deepEqual(result.answer.source, { conversation, step: 3, database });
});

for (const [rows, reason, source] of [
  [[generation({ lastStep: 3 })], 'no-generation', {}],
  [[generation({ model: undefined })], 'no-model', { generation: 0, label: 'Gemini 4 Argon (High)' }],
  [[generation({ trajectory: 'other' })], 'trajectory-mismatch', { generation: 0, label: 'Gemini 4 Argon (High)' }],
  [[generation({ model: 'gemini 4' })], 'unstampable', { generation: 0, label: 'Gemini 4 Argon (High)' }],
]) test(`unverified ${reason} preserves the evidence reached`, async (t) => {
  const { env, database } = fixture(t, rows);
  const result = await resolve(env);
  assert.equal(result.answer.reason, reason);
  assert.equal(result.answer.verified, false);
  assert.deepEqual(result.answer.source, { conversation, step: 3, database, ...source });
  assert.ok(result.detail);
});

test('missing model decides before a trajectory mismatch', async (t) => {
  const { env } = fixture(t, [generation({ model: undefined, trajectory: 'other' })]);
  assert.equal((await resolve(env)).answer.reason, 'no-model');
});

test('unset trajectory does not compare the generation trajectory', async (t) => {
  const { appData } = fixture(t, [generation({ trajectory: 'different' })]);
  const result = await resolve({ ANTIGRAVITY_CONVERSATION_ID: conversation, ANTIGRAVITY_SOURCE_METADATA: metadata(), ANTIGRAVITY_APP_DATA_DIR: appData });
  assert.equal(result.answer.agent, 'agy/gemini-4-argon@high');
});
