import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { storeRoot, dayOf, listDir, locateRollout, firstRecord, lastTurnContext, turnFields, UUID_V7 } from '../src/adapters/codex-rollout.js';
import { tempStore, threadAt, record, sessionMeta, turnContext } from './helpers/codex-store.js';

const AT = Date.parse('2026-10-17T02:30:00.000Z');
const thread = threadAt(AT);

test('a fixture thread id is a UUIDv7 and names its own day', () => {
  assert.match(thread, UUID_V7);
  assert.deepEqual(dayOf(thread, 'UTC'), ['2026', '10', '17']);
  assert.deepEqual(dayOf(thread, 'America/New_York'), ['2026', '10', '16']);
});
test('storeRoot: CODEX_HOME when set and absolute, else HOME/.codex; anything else is INVALID_CONFIG', () => {
  assert.equal(storeRoot({ CODEX_HOME: '/x/codex', HOME: '/h' }), '/x/codex');
  assert.equal(storeRoot({ HOME: '/h' }), path.join('/h', '.codex'));
  for (const env of [{ CODEX_HOME: 'rel' }, { CODEX_HOME: '' }, {}, { HOME: '' }, { HOME: 'rel' }])
    assert.throws(() => storeRoot(env), { code: 'INVALID_CONFIG' }, JSON.stringify(env));
});
test('locateRollout lists only the day directory when it holds the rollout', (t) => {
  const store = tempStore(t), file = store.day(['2026', '10', '17'], thread, [sessionMeta(thread)]);
  const listed = [];
  assert.deepEqual(locateRollout(store.root, thread, { timeZone: 'UTC', list: (dir) => { listed.push(dir); return listDir(dir); } }), [file]);
  assert.deepEqual(listed, [path.join(store.root, 'sessions', '2026', '10', '17')]);
});
test('locateRollout scans the store after a miss: another day, or archived', (t) => {
  const store = tempStore(t), elsewhere = store.day(['2026', '10', '16'], thread, [sessionMeta(thread)]);
  assert.deepEqual(locateRollout(store.root, thread, { timeZone: 'UTC' }), [elsewhere]);
  const other = threadAt(AT + 1), archived = store.archived(other, [sessionMeta(other)]);
  assert.deepEqual(locateRollout(store.root, other, { timeZone: 'UTC' }), [archived]);
});
test('locateRollout returns every match of the pass that found any, and none for an absent store', (t) => {
  const store = tempStore(t);
  assert.deepEqual(locateRollout(store.root, thread, { timeZone: 'UTC' }), []);
  store.day(['2026', '10', '17'], thread, [sessionMeta(thread)]);
  store.day(['2026', '10', '17'], thread, [sessionMeta(thread)], { stamp: '2026-10-17T07-00-00' });
  assert.equal(locateRollout(store.root, thread, { timeZone: 'UTC' }).length, 2);
});
test('an unreadable store directory is IO_ERROR, never an absent rollout', { skip: process.getuid?.() === 0 && 'root reads any directory' }, (t) => {
  const store = tempStore(t), sessions = path.join(store.root, 'sessions');
  fs.mkdirSync(sessions); fs.chmodSync(sessions, 0o000);
  try { assert.throws(() => locateRollout(store.root, thread, { timeZone: 'UTC' }), { code: 'IO_ERROR' }); }
  finally { fs.chmodSync(sessions, 0o700); }
});
test('firstRecord reads a first line longer than one block; no complete first line is INVALID_ROLLOUT', (t) => {
  const store = tempStore(t);
  const long = record('session_meta', { id: thread, pad: 'y'.repeat(200 * 1024) });
  assert.equal(firstRecord(store.day(['a', 'b', 'c'], thread, [long, turnContext('m', '2026-10-17T10:00:00.000Z')])).payload.id, thread);
  assert.throws(() => firstRecord(store.day(['d', 'e', 'f'], thread, [], { trailingNewline: false })), { code: 'INVALID_ROLLOUT' });
  assert.throws(() => firstRecord(store.day(['g', 'h', 'i'], thread, [long], { trailingNewline: false })), { code: 'INVALID_ROLLOUT' });
});
test('lastTurnContext returns the last turn_context, which in a forked child is its own', (t) => {
  const store = tempStore(t);
  const file = store.day(['a', 'b', 'c'], thread, [sessionMeta(thread), sessionMeta('parent'), turnContext('gpt-6-luna', '2026-10-17T09:00:00.000Z'),
    turnContext('gpt-6-astra', '2026-10-17T10:00:00.000Z'), record('event_msg', { type: 'task_started' })]);
  assert.equal(lastTurnContext(file).record?.payload.model, 'gpt-6-astra');
});
test('lastTurnContext skips a final line still being written, and handles records longer than a block', (t) => {
  const store = tempStore(t);
  const partial = turnContext('gpt-6-sol', '2026-10-17T11:00:00.000Z').slice(0, 40);
  const file = store.day(['a', 'b', 'c'], thread, [sessionMeta(thread), turnContext('gpt-6-astra', '2026-10-17T10:00:00.000Z'), partial], { trailingNewline: false });
  assert.equal(lastTurnContext(file).record?.payload.model, 'gpt-6-astra');
  assert.equal(lastTurnContext(file, { block: 16 }).record?.payload.model, 'gpt-6-astra');
  const one = store.day(['d', 'e', 'f'], thread, [turnContext('m', '2026-10-17T10:00:00.000Z')], { trailingNewline: false });
  assert.deepEqual(lastTurnContext(one), { record: null, limited: false });
});
test('lastTurnContext: an invalid line in range fails; none at all, or none within the limit, are told apart', (t) => {
  const store = tempStore(t);
  const broken = store.day(['a', 'b', 'c'], thread, [sessionMeta(thread), '{oops', record('event_msg', {})]);
  assert.throws(() => lastTurnContext(broken), { code: 'INVALID_ROLLOUT' });
  const none = store.day(['d', 'e', 'f'], thread, [sessionMeta(thread), record('event_msg', {})]);
  assert.deepEqual(lastTurnContext(none), { record: null, limited: false });
  const pad = record('event_msg', { pad: 'z'.repeat(600) });
  const far = store.day(['g', 'h', 'i'], thread, [sessionMeta(thread), turnContext('m', '2026-10-17T10:00:00.000Z'), pad, pad]);
  assert.deepEqual(lastTurnContext(far, { limit: 1024 }), { record: null, limited: true });
  assert.equal(lastTurnContext(far).record?.payload.model, 'm');
});
// Review regression: both readers once re-copied the growing record on every block, which is
// quadratic (a 64 MiB record copied 32 GiB). With 4 KiB blocks a 16 MiB record would copy
// 32 GiB that way; read linearly it takes well under a second. The reads are synchronous,
// which would block node:test's own timeout, so they run in a child killed after 5 s.
test('records of many blocks are assembled once', (t) => {
  const store = tempStore(t), big = 'w'.repeat(16 * 1024 * 1024);
  const tc = record('turn_context', { model: 'big', effort: 'high', pad: big }, '2026-10-17T10:00:00.000Z');
  const file = store.day(['a', 'b', 'c'], thread, [record('session_meta', { id: thread, pad: big }), tc, record('event_msg', {})]);
  const reader = new URL('../src/adapters/codex-rollout.js', import.meta.url).href;
  const script = `import { firstRecord, lastTurnContext } from ${JSON.stringify(reader)};
const [file] = process.argv.slice(1);
process.stdout.write(JSON.stringify([firstRecord(file, { block: 4096 }).payload.id, lastTurnContext(file, { block: 4096 }).record?.payload.model]));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, file], { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' });
  assert.equal(r.signal, null, 'the reads must finish within 5 s');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [thread, 'big']);
});
test('turnFields validates the model, effort and timestamp', () => {
  const parse = (line) => turnFields(JSON.parse(line));
  assert.deepEqual(parse(turnContext('gpt-6-astra', '2026-10-17T10:00:00.000Z')), { model: 'gpt-6-astra', effort: 'high', at: Date.parse('2026-10-17T10:00:00.000Z') });
  assert.equal(parse(record('turn_context', { model: 'm' }, '2026-10-17T10:00:00Z')).effort, null);
  assert.equal(parse(turnContext('m', '2026-10-17T10:00:00Z', null)).effort, null);
  assert.throws(() => parse(turnContext('', '2026-10-17T10:00:00Z')), { code: 'INVALID_ROLLOUT' });
  assert.throws(() => parse(record('turn_context', { model: 'm', effort: 3 })), { code: 'INVALID_ROLLOUT' });
  assert.throws(() => parse(turnContext('m', '2026-10-17T10:00:00+02:00')), { code: 'INVALID_ROLLOUT' });
});
