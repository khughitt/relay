import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_VARIABLES, ELIGIBLE, readNative, hintFor } from '../src/identity/native.js';

const decoded = (env) => readNative({ platform: 'darwin', env });
const raw = (block) => readNative({ platform: 'linux', readRaw: () => Buffer.from(block), env: {} });
const hint = (harness, env) => hintFor(harness, decoded(env).native);

test('raw native evidence classifies every state without inventing a Unicode value', () => {
  const cases = [
    [Buffer.alloc(0), { state: 'absent' }],
    [Buffer.from('CODEX_THREAD_ID=\0'), { state: 'empty' }],
    [Buffer.from('CODEX_THREAD_ID=c1\0'), { state: 'present', value: 'c1' }],
    [Buffer.concat([Buffer.from('CODEX_THREAD_ID='), Buffer.from([0xff, 0xfe, 0x61, 0])]),
      { state: 'invalid', reason: 'not-unicode' }],
    [Buffer.from('CODEX_THREAD_ID=c1\tx\0'), { state: 'invalid', reason: 'control-characters', value: 'c1\tx' }],
    [Buffer.from('CODEX_THREAD_ID=\u0085\0'), { state: 'invalid', reason: 'control-characters', value: '\u0085' }],
    [Buffer.from('CODEX_THREAD_ID=\uFEFFa=b\0'), { state: 'present', value: '\uFEFFa=b' }],
    [Buffer.from('CODEX_THREAD_ID=a\uFFFDb\0'), { state: 'present', value: 'a\uFFFDb' }],
  ];
  for (const [block, expected] of cases) {
    const result = raw(block);
    assert.deepEqual(result.native.CODEX_THREAD_ID, expected);
    assert.equal(result.nativeSource, 'raw');
    assert.equal(result.rawError, null);
    assert.deepEqual(Object.keys(result.native), [
      'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'ANTIGRAVITY_CONVERSATION_ID',
    ]);
  }
});

test('raw environment uses the first duplicate and exact keys', () => {
  assert.deepEqual(raw('CODEX_THREAD_ID=a\0CODEX_THREAD_ID=b\0').native.CODEX_THREAD_ID,
    { state: 'present', value: 'a' });
  assert.deepEqual(raw('CODEX_THREAD_ID=\0CODEX_THREAD_ID=b\0').native.CODEX_THREAD_ID,
    { state: 'empty' });
  assert.deepEqual(raw('CODEX_THREAD_ID\0OTHER_CODEX_THREAD_ID=a\0').native.CODEX_THREAD_ID,
    { state: 'absent' });
});

test('decoded evidence marks replacement characters unverified and does not read raw bytes', () => {
  const result = readNative({ platform: 'darwin', env: { CODEX_THREAD_ID: 'a\uFFFDb' },
    readRaw: () => { throw new Error('must not read'); } });
  assert.deepEqual(result.native.CODEX_THREAD_ID, { state: 'unverified', value: 'a\uFFFDb' });
  assert.equal(result.nativeSource, 'decoded');
  assert.equal(result.rawError, null);
  assert.deepEqual(decoded({ CODEX_THREAD_ID: '\t\uFFFD' }).native.CODEX_THREAD_ID,
    { state: 'unverified', value: '\t\uFFFD' });
  assert.deepEqual(decoded({ CODEX_THREAD_ID: '\u0085' }).native.CODEX_THREAD_ID,
    { state: 'invalid', reason: 'control-characters', value: '\u0085' });
});

test('Linux raw read failure retains decoded evidence and the error code', () => {
  const result = readNative({ platform: 'linux', env: { CODEX_THREAD_ID: 'fallback' },
    readRaw: () => { throw Object.assign(new Error('blocked'), { code: 'EACCES' }); } });
  assert.equal(result.nativeSource, 'decoded');
  assert.equal(result.rawError, 'EACCES');
  assert.equal(result.nativeSession, true);
  assert.deepEqual(result.native.CODEX_THREAD_ID, { state: 'present', value: 'fallback' });
});

test('nativeSession counts only nonempty eligible evidence, including malformed values', () => {
  for (const variable of ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'ANTIGRAVITY_CONVERSATION_ID']) {
    for (const value of ['session', '\t', '\uFFFD']) {
      assert.equal(decoded({ [variable]: value }).nativeSession, true);
    }
    assert.equal(raw(Buffer.concat([Buffer.from(`${variable}=`), Buffer.from([0xff, 0])])).nativeSession, true);
  }
  assert.equal(decoded({ CODEX_SESSION_ID: 'root' }).nativeSession, false);
  assert.equal(decoded(Object.fromEntries(NATIVE_VARIABLES.map((key) => [key, '']))).nativeSession, false);
  assert.equal(decoded({}).nativeSession, false);
  assert.equal(ELIGIBLE.includes('CODEX_SESSION_ID'), false);
});

test('Claude accepts Unicode hints including controls and never refuses malformed evidence', () => {
  for (const [value, expected] of [['c1', 'c1'], ['c1\tx', 'c1\tx'], ['a\uFFFDb', null], ['', null]]) {
    assert.deepEqual(hint('claude-code', { CLAUDE_CODE_SESSION_ID: value }),
      { hint: expected, invalid: null, missing: false });
  }
  assert.deepEqual(hint('claude-code', {}), { hint: null, invalid: null, missing: false });
  assert.deepEqual(hintFor('claude-code', raw(Buffer.concat([
    Buffer.from('CLAUDE_CODE_SESSION_ID='), Buffer.from([0xff, 0]),
  ])).native), { hint: null, invalid: null, missing: false });
});

test('Codex prefers thread over session but rejects either malformed variable', () => {
  assert.deepEqual(hint('codex', { CODEX_THREAD_ID: 'thread', CODEX_SESSION_ID: 'root' }),
    { hint: 'thread', invalid: null, missing: false });
  assert.deepEqual(hint('codex', { CODEX_SESSION_ID: 'root' }),
    { hint: 'root', invalid: null, missing: false });
  assert.deepEqual(hint('codex', { CODEX_THREAD_ID: '', CODEX_SESSION_ID: 'root' }),
    { hint: 'root', invalid: null, missing: false });
  assert.deepEqual(hint('codex', {}), { hint: null, invalid: null, missing: false });
  for (const value of ['\t', '\uFFFD']) {
    assert.equal(hint('codex', { CODEX_THREAD_ID: 'thread', CODEX_SESSION_ID: value }).invalid, 'CODEX_SESSION_ID');
    assert.equal(hint('codex', { CODEX_THREAD_ID: value, CODEX_SESSION_ID: '\t' }).invalid, 'CODEX_THREAD_ID');
  }
  assert.equal(hintFor('codex', raw(Buffer.concat([
    Buffer.from('CODEX_THREAD_ID='), Buffer.from([0xff, 0]),
  ])).native).invalid, 'CODEX_THREAD_ID');
});

test('agy requires a present hint and rejects malformed or unverified evidence', () => {
  assert.deepEqual(hint('agy', { ANTIGRAVITY_CONVERSATION_ID: 'a1' }),
    { hint: 'a1', invalid: null, missing: false });
  for (const env of [{}, { ANTIGRAVITY_CONVERSATION_ID: '' }]) {
    assert.deepEqual(hint('agy', env), { hint: null, invalid: null, missing: true });
  }
  for (const value of ['\t', '\uFFFD']) {
    assert.deepEqual(hint('agy', { ANTIGRAVITY_CONVERSATION_ID: value }),
      { hint: null, invalid: 'ANTIGRAVITY_CONVERSATION_ID', missing: false });
  }
});

test('OpenCode does not derive a native hint', () => {
  assert.deepEqual(hint('opencode', { CODEX_THREAD_ID: 'thread' }),
    { hint: null, invalid: null, missing: false });
});
