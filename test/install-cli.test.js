import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../bin/relay.js';

const stream = () => ({ text: '', write(value, done) { this.text += value; done?.(); } });
test('install and rollback require their explicit inputs', async () => {
  for (const args of [['install'], ['install', '--harness', 'codex'], ['rollback'], ['rollback', '--artifact']]) {
    const out = stream(), err = stream();
    assert.equal(await main(args, { stdout: out, stderr: err }), 1);
    assert.match(err.text, /USAGE/);
  }
});
