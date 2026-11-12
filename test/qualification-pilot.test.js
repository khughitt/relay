import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { statistics } from '../scripts/hook-qualification/statistics.mjs';
import { validateManifest, checkRetainedWork, runBaseline } from '../scripts/hook-qualification/baseline.mjs';
import { judgePilot } from '../scripts/hook-qualification/pilot.mjs';

const workload = JSON.parse(readFileSync(new URL('../scripts/hook-qualification/workload.json', import.meta.url), 'utf8'));
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

test('statistics use nearest rank with no outlier removal', () => {
  const samples = range(200, (i) => i + 1);
  assert.deepEqual(statistics(samples), { count: 200, p50: 100, p95: 190, p99: 198, max: 200 });
  assert.deepEqual(statistics([5]), { count: 1, p50: 5, p95: 5, p99: 5, max: 5 });
  for (const bad of [[], [1, NaN], 'x']) assert.throws(() => statistics(bad));
});

// A complete, passing pilot result that each test perturbs.
function passing() {
  const event = (ms) => ({ elapsedMs: ms, ok: true });
  return {
    supervisorAlone: { samples: range(50, () => ({ startupMs: 50, cleanupMs: 5, combinedMs: 60, cleanup: 'complete' })) },
    migrated: { baseline: range(200, () => event(100)), candidate: range(200, () => ({ ...event(150), supervisors: 1 })) },
    noSubscriber: { deployed: range(200, () => 80), candidate: range(200, () => 85), native: range(200, () => 3), candidateSupervisorStarts: 0 },
  };
}

test('the pilot judge passes only complete results inside every unchanged bound', () => {
  assert.equal(judgePilot(passing(), workload).passed, true);
  const p95GoodP99Bad = passing();
  p95GoodP99Bad.migrated.candidate = range(200, (i) => ({ elapsedMs: i >= 196 ? 420 : 150, ok: true, supervisors: 1 }));
  const judged = judgePilot(p95GoodP99Bad, workload);
  assert.equal(judged.passed, false, 'a good p95 does not excuse a failing p99');
  assert.match(judged.failures.join('\n'), /p99/);
  const short = passing(); short.migrated.candidate.pop();
  assert.equal(judgePilot(short, workload).passed, false, 'a missing sample fails');
  const fewer = passing(); fewer.supervisorAlone.samples.pop();
  assert.equal(judgePilot(fewer, workload).passed, false);
  const twice = passing(); twice.migrated.candidate[7].supervisors = 2;
  assert.match(judgePilot(twice, workload).failures.join('\n'), /supervisor/, 'two supervisors in one dispatch fail regardless of timing');
  const failedCall = passing(); failedCall.migrated.baseline[3].ok = false;
  assert.equal(judgePilot(failedCall, workload).passed, false, 'a failed call is a failure, never excluded');
  const slowSupervisor = passing(); slowSupervisor.supervisorAlone.samples[0].combinedMs = 251;
  assert.equal(judgePilot(slowSupervisor, workload).passed, false);
  const dirty = passing(); dirty.supervisorAlone.samples[1].cleanup = 'failed';
  assert.equal(judgePilot(dirty, workload).passed, false);
  const absolute = passing(); absolute.migrated.baseline = range(200, () => ({ elapsedMs: 900, ok: true })); absolute.migrated.candidate = range(200, () => ({ elapsedMs: 1001, ok: true, supervisors: 1 }));
  assert.match(judgePilot(absolute, workload).failures.join('\n'), /absolute/);
});

test('no-subscriber diagnostics are required, start nothing, and add no numeric limit', () => {
  const missing = passing(); delete missing.noSubscriber;
  const judged = judgePilot(missing, workload);
  assert.equal(judged.passed, false); assert.equal(judged.complete, false);
  const started = passing(); started.noSubscriber.candidateSupervisorStarts = 1;
  assert.equal(judgePilot(started, workload).passed, false, 'the empty candidate must start zero supervisors');
  const slow = passing(); slow.noSubscriber.candidate = range(200, () => 5000);
  assert.equal(judgePilot(slow, workload).passed, true, 'diagnostic quantiles never gate');
  assert.ok(judgePilot(slow, workload).rows.some((row) => row.case === 'no-subscriber candidate' && row.p95 === 5000));
});

const manifest = (over = {}) => ({
  schema: 1, host: 'pilot-host', harness: 'claude-code', version: '2.1.322', mode: 'interactive', event: 'PreToolUse',
  baselineKind: 'deployed-relay-plus-native', settings: { repository: 'hq', commit: '99193f6c2232f98c044b5db1ebb548af33834733', path: 'harnesses/claude/settings.json', blob: '88971b5ae5ceb664d9eca1adbf986ebda6e7c950' },
  deployed: { version: '0.3.0', relayEntry: '/deployed/relay.js', packageSha256: 'a'.repeat(64), configSha256: 'b'.repeat(64) },
  schedule: { kind: 'parallel', evidence: 'https://code.claude.com/docs/en/hooks#hook-handler-fields' },
  branches: [{ name: 'deployed-relay', role: 'deployed-relay', argv: ['/bin/sh', '-c', 'cat >/dev/null'] }, { name: 'turn-pause', role: 'native', argv: ['/bin/sh', '-c', 'cat >/dev/null'] }],
  replacementMap: [
    { invocation: 'ops-guard', baseline: 'deployed-relay:ops-guard', candidate: 'candidate:ops-guard' },
    { invocation: 'familiar', baseline: 'deployed-relay:familiar', candidate: 'candidate:familiar' },
    { invocation: 'turn-pause', baseline: 'turn-pause', candidate: 'candidate:turn-pause' },
  ],
  candidate: { configSha256: 'c'.repeat(64) },
  ...over,
});

test('baseline selection is per harness and event and refuses a deployed baseline without its relay branch', () => {
  assert.equal(validateManifest(manifest(), { harness: 'claude-code', event: 'PreToolUse' }).baselineKind, 'deployed-relay-plus-native');
  assert.throws(() => validateManifest(manifest(), { harness: 'codex', event: 'PreToolUse' }), { code: 'BASELINE_INVALID' });
  assert.throws(() => validateManifest(manifest(), { harness: 'claude-code', event: 'PostToolUse' }), { code: 'BASELINE_INVALID' });
  assert.throws(() => validateManifest(manifest({ branches: [manifest().branches[1]] }), { harness: 'claude-code', event: 'PreToolUse' }), { code: 'BASELINE_INVALID', message: /deployed relay branch/ });
  assert.throws(() => validateManifest(manifest({ deployed: { ...manifest().deployed, packageSha256: undefined } }), { harness: 'claude-code', event: 'PreToolUse' }), { code: 'BASELINE_INVALID' });
  assert.throws(() => validateManifest(manifest({ schedule: { kind: 'parallel' } }), { harness: 'claude-code', event: 'PreToolUse' }), { code: 'BASELINE_INVALID', message: /evidence/ });
  const nativeOnly = manifest({ baselineKind: 'native-only', event: 'PostToolUse', deployed: null, branches: [manifest().branches[1]],
    replacementMap: [{ invocation: 'turn-pause', baseline: 'turn-pause', candidate: 'candidate:turn-pause' }] });
  assert.equal(validateManifest(nativeOnly, { harness: 'claude-code', event: 'PostToolUse' }).baselineKind, 'native-only');
  assert.throws(() => validateManifest({ ...nativeOnly, branches: manifest().branches }, { harness: 'claude-code', event: 'PostToolUse' }), { code: 'BASELINE_INVALID', message: /native-only/ });
});

test('retained subscriber work must be accounted exactly once on both sides', () => {
  const m = manifest();
  checkRetainedWork(m, { baseline: ['deployed-relay:ops-guard', 'deployed-relay:familiar', 'turn-pause'], candidate: ['candidate:ops-guard', 'candidate:turn-pause', 'candidate:familiar'] });
  assert.throws(() => checkRetainedWork(m, { baseline: ['deployed-relay:ops-guard', 'deployed-relay:familiar', 'turn-pause'], candidate: ['candidate:turn-pause'] }), { code: 'BASELINE_INVALID' }, 'existing work dropped from the candidate');
  assert.throws(() => checkRetainedWork(m, { baseline: ['turn-pause'], candidate: ['candidate:ops-guard', 'candidate:turn-pause', 'candidate:familiar'] }), { code: 'BASELINE_INVALID' }, 'existing work credited only to the candidate');
  assert.throws(() => checkRetainedWork({ ...m, replacementMap: [...m.replacementMap, m.replacementMap[0]] }, { baseline: ['deployed-relay:ops-guard', 'deployed-relay:familiar', 'turn-pause'], candidate: ['candidate:ops-guard', 'candidate:turn-pause', 'candidate:familiar'] }), { code: 'BASELINE_INVALID' });
});

test('a parallel baseline is timed on its critical path, never as a sum of branches', async () => {
  const m = manifest({ branches: [
    { name: 'deployed-relay', role: 'deployed-relay', argv: ['/bin/sh', '-c', 'cat >/dev/null; sleep 0.3'] },
    { name: 'turn-pause', role: 'native', argv: ['/bin/sh', '-c', 'cat >/dev/null; sleep 0.2'] }] });
  const env = { PATH: '/usr/bin:/bin' };
  const parallel = await runBaseline(m, { event: 'PreToolUse', input: '{}', env, cwd: '/' });
  assert.ok(parallel.elapsedMs >= 300 && parallel.elapsedMs < 450, `critical path ${parallel.elapsedMs} ms (the branch sum is 500 ms)`);
  assert.deepEqual(parallel.statuses, ['exited 0', 'exited 0']);
  const serial = await runBaseline({ ...m, schedule: { kind: 'serial', evidence: 'test' } }, { event: 'PreToolUse', input: '{}', env, cwd: '/' });
  assert.ok(serial.elapsedMs >= 500, `serial ${serial.elapsedMs} ms`);
  await assert.rejects(runBaseline(m, { event: 'Stop', input: '{}', env, cwd: '/' }), { code: 'BASELINE_INVALID' });
});
