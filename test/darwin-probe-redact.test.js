import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectHosts, redactFile, redactionMap, redactText, redactValue } from '../tools/darwin-probe/redact.mjs';
import { judge } from '../tools/darwin-probe/judge.mjs';
import { passingResults } from './helpers/darwin-results.js';

test('distinct hosts keep distinct tokens, ordered by first appearance', () => {
  const r = passingResults();
  r.stages.D0.observations.hosts.end.os = 'Mac-B.local';
  const hosts = collectHosts(r);
  assert.deepEqual(hosts, ['Mac-A.local', 'Mac-A', 'Mac A', 'Mac-B.local', 'other-host']);
  const map = redactionMap({ hosts, user: 'kh', home: '/Users/kh' });
  const out = redactValue(r, map, { host: 0, user: 0, home: 0 });
  assert.equal(out.stages.D0.observations.hosts.start.os, '<host-1>');
  assert.equal(out.stages.D0.observations.hosts.end.os, '<host-4>');
  assert.equal(out.stages.D3.observations.foreign_host.host, '<host-5>');
});
test('the home path stays absolute and booleans and numbers are untouched', () => {
  const map = redactionMap({ hosts: [], user: 'kh', home: '/Users/kh' });
  const { text, counts } = redactText('/Users/kh/.local/bin/claude and kh', map);
  assert.equal(text, '/Users/<user>/.local/bin/claude and <user>');
  assert.deepEqual(counts, { host: 0, user: 1, home: 1 });
  const v = redactValue({ a: true, b: 42, c: null, d: '/Users/kh' }, map, { host: 0, user: 0, home: 0 });
  assert.deepEqual(v, { a: true, b: 42, c: null, d: '/Users/<user>' });
});
test('a longer host is replaced before a host it contains', () => {
  const map = redactionMap({ hosts: ['Mac-A', 'Mac-A.local'], user: 'kh', home: '/Users/kh' });
  assert.equal(redactText('Mac-A.local Mac-A', map).text, '<host-2> <host-1>');
});
test('JSON files are redacted structurally: a user named true leaves literals and keys intact', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dpr-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const file = join(d, 'D5.json');
  writeFileSync(file, JSON.stringify({ true: true, ok: false, n: 3, who: 'true', home: '/Users/true/x' }));
  const out = JSON.parse(redactFile(file, redactionMap({ hosts: [], user: 'true', home: '/Users/true' })).text);
  assert.deepEqual(out, { true: true, ok: false, n: 3, who: '<user>', home: '/Users/<user>/x' });
});
test('an over-matching user name never changes a verdict', () => {
  const r = passingResults();
  const map = redactionMap({ hosts: collectHosts(r), user: 'sh', home: '/Users/sh' });
  assert.deepEqual(judge(redactValue(r, map, { host: 0, user: 0, home: 0 })), judge(r));
});
