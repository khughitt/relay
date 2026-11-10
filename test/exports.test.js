import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as relay from '../src/index.js';

for (const name of ['withLock', 'validateHandle', 'parsePayload', 'whoami']) {
  test(`root exports ${name}`, () => assert.equal(typeof relay[name], 'function'));
}

test('root validateHandle round-trips the portable fixture', async () => {
  const corpus = JSON.parse(await readFile(new URL('fixtures/handles.json', import.meta.url), 'utf8'));
  const fixture = corpus.handles[0];
  const handle = relay.validateHandle(fixture.input);
  assert.deepEqual(handle, fixture.expected);
  assert.ok(Object.isFrozen(handle));
});

test('root parsePayload rejects a relative cwd', () => {
  assert.throws(() => relay.parsePayload('{"session_id":"fixture-session","cwd":"relative"}', 'SessionStart'),
    { code: 'INVALID_INPUT' });
});


test('root validateHandle rejects malformed handles and starts as public input errors', () => {
  for (const value of [null, {}, { platform: 'linux', host: 'fixture-host', bootId: null, pid: 42, start: '01' }]) {
    assert.throws(() => relay.validateHandle(value), { code: 'INVALID_INPUT' });
  }
});
