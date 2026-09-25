import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHostName, pythonAtLeast } from '../tools/darwin-probe/stages/d0-env.mjs';
import { parseTap, suiteFiles } from '../tools/darwin-probe/stages/d2-suite.mjs';
import { readdirSync } from 'node:fs';

test('an unset HostName is null, not the error text', () => {
  assert.equal(parseHostName({ exit: 1, stdout: '', stderr: 'HostName: not set\n' }), null);
  assert.equal(parseHostName({ exit: 0, stdout: 'Mac-A\n', stderr: '' }), 'Mac-A');
  assert.equal(parseHostName({ exit: null, stdout: '', stderr: 'spawn scutil ENOENT' }), null);
});
test('python version floor', () => {
  assert.equal(pythonAtLeast('Python 3.9.6', [3, 11]), false);
  assert.equal(pythonAtLeast('Python 3.13.7', [3, 11]), true);
  assert.equal(pythonAtLeast('', [3, 11]), false);
});
test('TAP summary and failures', () => {
  const tap = 'TAP version 13\nok 1 - a\nnot ok 2 - b fails\n  ---\n  ...\n# tests 2\n# pass 1\n# fail 1\n# skipped 0\n# todo 0\n';
  assert.deepEqual(parseTap(tap), { tests: 2, pass: 1, fail: 1, skipped: 0, todo: 0, failures: ['b fails'] });
});
test('the gating suite is relay\'s own tests, without the probe\'s', () => {
  const { files, excluded } = suiteFiles(process.cwd());
  const probeTests = readdirSync('test').filter((f) => /^darwin-probe-.*\.test\.js$/.test(f));
  assert.ok(probeTests.length > 0); assert.equal(excluded, probeTests.length);
  assert.equal(files.some((f) => f.includes('darwin-probe')), false);
  assert.ok(files.includes('test/cli.test.js')); assert.ok(files.some((f) => /^integrations\/opencode\/.+\.test\.mjs$/.test(f)));
  assert.equal(files.length + excluded, readdirSync('test').filter((f) => f.endsWith('.test.js')).length + readdirSync('integrations/opencode').filter((f) => f.endsWith('.test.mjs')).length);
});
