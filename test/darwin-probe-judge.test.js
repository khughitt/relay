import test from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../tools/darwin-probe/judge.mjs';
import { passingResults } from './helpers/darwin-results.js';

const mutate = (f) => { const r = structuredClone(passingResults()); f(r); return judge(r); };
test('a complete passing Darwin run passes the release', () => {
  const v = judge(passingResults());
  assert.equal(v.release, 'pass');
  assert.equal(v.cutover['claude-code'], 'pass');
  assert.equal(v.cutover.codex, 'absent');
  assert.equal(v.cutover.opencode, 'absent');
});
test('a Linux smoke run never reports a release pass', () => {
  assert.equal(judge(passingResults({ platform: 'linux' })).release, 'smoke');
});
test('each release check fails the release on its own', () => {
  const cases = {
    D0: (r) => { r.stages.D0.observations.prerequisites.clt = false; },
    D1: (r) => { r.stages.D1.observations.exports.dispatchHook = false; },
    D2: (r) => { r.stages.D2.observations.summary.fail = 1; },
    D3: (r) => { r.stages.D3.observations.tz_pairs[1].status = 'dead'; },
    D4: (r) => { r.stages.D4.observations.captures[0].truncated = true; },
    D5: (r) => { r.stages.D5.observations.lock.recovered = false; },
    D6: (r) => { r.stages.D6.observations.hang[0].survivors = [77]; },
    D8: (r) => { r.stages.D8.observations.reap.handles_unchanged = false; },
  };
  for (const [id, f] of Object.entries(cases)) {
    const v = mutate(f);
    assert.equal(v.checks[id].verdict, 'fail', id);
    assert.equal(v.release, 'fail', id);
  }
});
test('an incomplete D0 prerequisites record is an error, not a silent pass', () => {
  const empty = mutate((r) => { r.stages.D0.observations.prerequisites = {}; });
  assert.equal(empty.checks.D0.verdict, 'error');
  assert.equal(empty.release, 'incomplete');
  const missingKey = mutate((r) => { delete r.stages.D0.observations.prerequisites.python311; });
  assert.equal(missingKey.checks.D0.verdict, 'error');
  assert.equal(missingKey.release, 'incomplete');
});
test('a fast but failed SessionEnd fails D5', () => {
  for (const f of [(c) => { c.exit = 1; }, (c) => { c.stderr = 'DEADLINE_EXCEEDED: registry'; }, (c) => { c.ending_absent = false; }, (c) => { c.others_retained = false; }, (c) => { c.revision_delta = 0; }, (c) => { c.ms = 3001; }])
    assert.equal(mutate((r) => f(r.stages.D5.observations.cost.n10.sessionend)).checks.D5.verdict, 'fail');
});
test('the 50-agent timings are a finding, not a gate', () => {
  const v = mutate((r) => { r.stages.D5.observations.cost.n50.sessionend.ms = 9000; });
  assert.equal(v.checks.D5.verdict, 'pass');
  assert.ok(v.checks.D5.findings.some((f) => f.includes('50 agents')));
});
test('a missing or errored release stage makes the release incomplete', () => {
  assert.equal(mutate((r) => { delete r.stages.D3; }).release, 'incomplete');
  assert.equal(mutate((r) => { r.stages.D5 = { id: 'D5', status: 'error', reason: 'boom', observations: {} }; }).release, 'incomplete');
});
test('cutover evidence never changes the release', () => {
  const v = mutate((r) => { r.stages.D7.observations['claude-code'].proven = false; r.stages.D8.observations.hook_path.denied = false; });
  assert.equal(v.release, 'pass');
  assert.equal(v.cutover['claude-code'], 'fail');
  assert.equal(v.cutover['launchd-path'], 'fail');
});
test('findings are reported: host drift, unset HostName, zombie, comm kind', () => {
  const v = mutate((r) => { r.stages.D0.observations.hosts.end.os = 'Mac-B.local'; });
  assert.ok(v.checks.D0.findings.some((f) => f.includes('host changed')));
  assert.ok(v.checks.D0.findings.some((f) => f.includes('HostName is not set')));
  assert.ok(v.checks.D3.findings.some((f) => f.includes('zombie')));
  assert.ok(v.checks.D4.findings.some((f) => f.includes('comm')));
});
test('requirements the first draft missed each fail on their own', () => {
  assert.equal(mutate((r) => { r.stages.D4.observations.native.recognized = false; }).checks.D4.verdict, 'fail');
  const iso = mutate((r) => { r.manifest.isolation.changed = ['.config/relay']; });
  assert.equal(iso.checks.ISO.verdict, 'fail'); assert.equal(iso.release, 'fail');
  assert.equal(mutate((r) => { r.stages.D6.observations = { replies: [], hang: [] }; }).checks.D6.verdict, 'fail');
  const trunc = mutate((r) => { r.stages.D7.observations['claude-code'].hook.truncated = true; });
  assert.equal(trunc.checks.D7w.verdict, 'fail'); assert.equal(trunc.release, 'fail');
});
test('partial observations are an error verdict, never a throw', () => {
  const v = mutate((r) => { r.stages.D0.observations.hosts.end = null; delete r.stages.D6.observations.hang; });
  assert.equal(v.checks.D0.verdict, 'error'); assert.equal(v.checks.D6.verdict, 'error'); assert.equal(v.release, 'incomplete');
});
test('verdicts never carry stage text', () => {
  const v = mutate((r) => {
    r.stages.D5 = { id: 'D5', status: 'error', reason: 'Error: EACCES /Users/alice/private-directory on Mac-A.local', observations: {} };
    r.stages.D6.observations = { replies: null };
  });
  const text = JSON.stringify(v);
  assert.equal(text.includes('/Users/alice'), false); assert.equal(text.includes('Mac-A'), false);
  assert.equal(v.checks.D5.detail, 'stage error'); assert.equal(v.checks.D6.detail, 'malformed observations');
});
test('execution failures are distinct from absent harnesses', () => {
  assert.equal(mutate((r) => { r.stages.D7b = { id: 'D7b', status: 'error', reason: 'boom', observations: {} }; }).cutover.opencode, 'error');
  assert.equal(mutate((r) => { r.stages.D7.observations.codex = { status: 'skipped', reason: 'no credentials' }; }).cutover.codex, 'skipped');
  assert.equal(mutate((r) => { r.stages.D7 = { id: 'D7', status: 'error', reason: 'boom', observations: {} }; }).cutover['claude-code'], 'error');
});
test('D7b fails its cutover when the plugin is rejected or the version is not the pinned one', () => {
  const ran = (o) => mutate((r) => { r.stages.D7b = { id: 'D7b', status: 'ran', observations: { version: '2.0.15', version_match: true, install: { exit: 0 },
    request: { status: 200, directory_match: true }, plugin_log: 'loaded', appeared: true, agent: { count: 1, scope: 'process', matches_server: true },
    after: { gone: true, via: 'dispose' }, ...o } }; }).cutover.opencode;
  assert.equal(ran({}), 'pass');
  assert.equal(ran({ plugin_log: 'rejected-file', appeared: false, agent: { count: 0 } }), 'fail');
  assert.equal(ran({ version: '2.1.0', version_match: false }), 'fail');
});
