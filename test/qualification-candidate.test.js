import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveExecutable } from '../src/executable.js';
import { CANDIDATE_HOOK_PATH, renderCandidate, selectPrograms } from '../scripts/hook-qualification/candidate-config.mjs';

const runner = fileURLToPath(new URL('../scripts/hook-qualification/run.mjs', import.meta.url));
const subscriber = (name, command, over = {}) => ({ name, role: 'observer', registry: 'occurrence', kinds: ['session-start'], argv: [command], timeoutMs: 1000, ...over });
const template = (over = {}) => ({ schema: 3, searchPath: ['@WORK@/bin', '@FIXTURE@/bin', '/usr/bin', '/bin'], subscribers: [subscriber('o', 'relay-fixture-observer')], ...over });
const places = { work: '/w/route', fixture: '/f/fixture' };

test('both placeholders render in the search path and nothing else changes', () => {
  const text = `${JSON.stringify(template())}\n`;
  assert.equal(renderCandidate(text, places), `${JSON.stringify(template({ searchPath: ['/w/route/bin', '/f/fixture/bin', '/usr/bin', '/bin'] }), null, 2)}\n`);
  const plain = template({ searchPath: ['/usr/bin', '/bin'] });
  assert.deepEqual(JSON.parse(renderCandidate(JSON.stringify(plain), places)), plain);
});

test('a placeholder anywhere else is refused', () => {
  for (const bad of [template({ searchPath: ['@FIXTURE@/other'] }), template({ searchPath: ['@FIXTURE@'] }), template({ searchPath: ['@WORK@/bin/'] }),
    template({ subscribers: [subscriber('@WORK@', 'relay-fixture-observer')] }), template({ subscribers: [subscriber('o', 'relay-fixture-observer', { argv: ['relay-fixture-observer', '@FIXTURE@/bin'] })] }),
    template({ note: '@WORK@/bin' })]) {
    assert.throws(() => renderCandidate(JSON.stringify(bad), places), { message: /candidate template: unexpected placeholder .*@(WORK|FIXTURE)@/ }, JSON.stringify(bad));
  }
});

// The prepared fixture, with the route's own bin beside it, as the runner lays them out.
function prepared(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'relay-candidate-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [runner, '--prepare', '--output', root], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: root } });
  assert.equal(r.status, 0, r.stderr);
  const fixtureBin = join(root, 'fixture', 'bin'), workBin = join(root, 'work', 'bin');
  mkdirSync(workBin, { recursive: true });
  const programs = JSON.parse(readFileSync(join(root, 'fixture', 'programs.json'), 'utf8'));
  const searchPath = [workBin, fixtureBin, '/usr/bin', '/bin'];
  const select = (config, missing) => selectPrograms(config, { resolveExecutable, programs, fixtureBin, workBin, ...(missing ? { missing } : {}) });
  const config = (...subscribers) => ({ schema: 3, searchPath, subscribers });
  return { root, fixtureBin, workBin, programs, searchPath, select, config };
}

test('the prepared programs a candidate selects are credited by subscriber', async (t) => {
  const f = prepared(t), name = 'relay-fixture-observer';
  assert.deepEqual(await f.select(f.config(subscriber('o', name), subscriber('n', 'relay-fixture-notice'))), {
    o: { path: join(f.fixtureBin, name), sha256: f.programs[name].sha256, work: f.programs[name].work },
    n: { path: join(f.fixtureBin, 'relay-fixture-notice'), sha256: f.programs['relay-fixture-notice'].sha256, work: f.programs['relay-fixture-notice'].work } });
  // A listed link to the prepared program is that program.
  const links = join(f.root, 'links'); mkdirSync(links); symlinkSync(join(f.fixtureBin, name), join(links, name));
  assert.equal((await f.select({ ...f.config(subscriber('o', name)), searchPath: [links, ...f.searchPath] })).o.path, join(f.fixtureBin, name));
  // The route's own copy stands in for the timeout program alone.
  for (const program of ['relay-fixture-hang', name]) writeFileSync(join(f.workBin, program), readFileSync(join(f.fixtureBin, program)), { mode: 0o755 });
  assert.equal((await f.select(f.config(subscriber('h', 'relay-fixture-hang')))).h.path, join(f.workBin, 'relay-fixture-hang'));
  await assert.rejects(f.select(f.config(subscriber('o', name))), { message: `candidate subscriber o selects ${join(f.workBin, name)}, not the prepared program` });
});

test('another program of the same name, changed bytes or an unknown program is refused', async (t) => {
  const f = prepared(t), name = 'relay-fixture-observer', decoys = join(f.root, 'decoys');
  mkdirSync(decoys); writeFileSync(join(decoys, name), '#!/bin/sh\ncat >/dev/null\n', { mode: 0o755 });
  await assert.rejects(f.select({ ...f.config(subscriber('o', name)), searchPath: [decoys, ...f.searchPath] }), { message: `candidate subscriber o selects ${join(decoys, name)}, not the prepared program` });
  await assert.rejects(f.select(f.config(subscriber('o', 'sh'))), { message: /candidate subscriber o selects .*, not the prepared program/ });
  writeFileSync(join(f.fixtureBin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await assert.rejects(f.select(f.config(subscriber('o', name))), { message: /candidate subscriber o selects .*, not the prepared program/ });
});

test('a subscriber declared missing must not resolve, and any other must', async (t) => {
  const f = prepared(t);
  const config = f.config(subscriber('gone', 'relay-qualification-missing'), subscriber('o', 'relay-fixture-observer'));
  assert.deepEqual(Object.keys(await f.select(config, ['gone'])), ['o']);
  await assert.rejects(f.select(config), { code: 'EXECUTABLE_NOT_FOUND' });
  await assert.rejects(f.select(f.config(subscriber('gone', 'relay-fixture-observer')), ['gone']), { message: /candidate subscriber gone selects .*, but the missing-command condition needs none/ });
});

test("the candidate hook's own PATH holds no prepared program", (t) => {
  const f = prepared(t);
  for (const dir of CANDIDATE_HOOK_PATH.split(':')) for (const name of Object.keys(f.programs)) assert.equal(existsSync(join(dir, name)), false, join(dir, name));
});

// One whole runner invocation refuses before it measures anything.
test('the runner refuses a candidate whose list selects another program, and measures nothing', { skip: process.platform !== 'linux' }, (t) => {
  const f = prepared(t), config = join(f.root, 'fixture', 'config'), decoys = join(f.root, 'decoys');
  mkdirSync(decoys); writeFileSync(join(decoys, 'relay-fixture-notice'), '#!/bin/sh\ncat >/dev/null\n', { mode: 0o755 });
  const write = (file, value) => writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  write(join(config, 'candidate.json'), template({ searchPath: [decoys, '@WORK@/bin', '@FIXTURE@/bin', '/usr/bin', '/bin'], subscribers: [{ name: 'notice', role: 'notice', harnesses: ['claude-code'], kinds: ['session-start'], argv: ['relay-fixture-notice'], timeoutMs: 1000 }] }));
  write(join(config, 'candidate-empty.json'), { schema: 3, searchPath: [], subscribers: [] });
  const env = { PATH: '/usr/bin:/bin', HOME: f.root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const configSha256 = spawnSync('sha256sum', [join(config, 'candidate.json')], { encoding: 'utf8', env }).stdout.split(' ')[0];
  write(join(f.root, 'set.json'), { schema: 1, host: 'h', manifests: [{ schema: 1, host: 'h', harness: 'claude-code', version: '0.0.0', mode: 'interactive', event: 'SessionStart', baselineKind: 'native-only',
    settings: { commit: 'synthetic', path: 'synthetic', blob: 'synthetic' }, inventory: { relayedEvents: [] }, schedule: { kind: 'parallel', evidence: 'synthetic' }, fixture: 'fixture',
    payload: { session_id: 's', hook_event_name: 'SessionStart', source: 'startup' }, candidate: { config: 'candidate.json', configSha256 }, noSubscriber: { candidate: 'candidate-empty.json' },
    branches: [{ name: 'notice', role: 'native', fixture: 'relay-fixture-native', argv: ['@FIXTURE@/bin/relay-fixture-native'] }],
    replacementMap: [{ invocation: 'notice', baseline: 'notice', candidate: 'candidate:notice' }] }] });
  const out = join(f.root, 'out'), candidate = fileURLToPath(new URL('..', import.meta.url));
  const r = spawnSync(process.execPath, [runner, '--candidate', candidate, '--baseline-manifest', join(f.root, 'set.json'), '--workload', join(candidate, 'scripts/hook-qualification/workload.json'), '--output', out, '--pilot'], { encoding: 'utf8', env });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, new RegExp(`candidate subscriber notice selects ${join(decoys, 'relay-fixture-notice')}, not the prepared program`));
  assert.match(r.stdout, /no result written/);
  assert.equal(existsSync(join(out, 'claude-code-SessionStart', `${process.version}-pilot.json`)), false);
  assert.equal(existsSync(join(out, 'claude-code-SessionStart', `${process.version}-pilot`, 'state')), false, 'no condition ran');
});
