import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSection, crossCheck } from '../tools/darwin-probe/judge-cli.mjs';
import { judge } from '../tools/darwin-probe/judge.mjs';
import { passingResults } from './helpers/darwin-results.js';
test('the section names commits, versions, every check and the findings', () => {
  const r = passingResults(), s = renderSection(r, judge(r));
  for (const needle of ['aaaaaaa', '15.6', 'arm64', '2.1.282', '| D5 | release | pass |', 'zombie', 'Cutover']) assert.ok(s.includes(needle), needle);
});
test('any verdict disagreement is refused', () => {
  const r = passingResults(), v = judge(r);
  assert.deepEqual(crossCheck(r, v, v), []);
  assert.deepEqual(crossCheck(r, v, { ...v, release: 'fail' }), ['verdict.redacted.json disagrees with the recomputed verdict']);
});
