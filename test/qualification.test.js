import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { judge, qualifiedRows } from '../scripts/hook-qualification/judge.mjs';
import { parseQualification } from '../src/install/qualification.js';
import { COMMIT, DIGEST, qualificationFor } from './helpers/qualification.js';

const workload = JSON.parse(readFileSync(new URL('../scripts/hook-qualification/workload.json', import.meta.url), 'utf8'));
const q = workload.qualification;
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const PACKAGE = 'e'.repeat(64), SCRIPT = 'f'.repeat(64);

test('the qualification workload is the frozen table, and the pilot bounds are unchanged', () => {
  assert.deepEqual(workload.pilot.migrated.bounds, { p95DeltaMs: 100, p99DeltaMs: 150, maxDeltaMs: 250, absoluteMaxMs: 1000 });
  assert.deepEqual({ outerMs: q.outerMs, timeoutMs: q.timeoutMs, contextChars: q.contextChars, payloadBytes: q.payloadBytes, wallMs: q.wallMs, hosts: q.hosts },
    { outerMs: 20000, timeoutMs: 1000, contextChars: 64, payloadBytes: 1024, wallMs: 600000, hosts: 2 });
  assert.deepEqual(q.conditions, {
    warm: { warmups: 20, samples: 200, bounds: { p95DeltaMs: 100, p99DeltaMs: 150, maxDeltaMs: 250, absoluteMaxMs: 1000 } },
    cold: { samples: 50, bounds: { p99DeltaMs: 200, maxDeltaMs: 300, absoluteMaxMs: 1500 } },
    missing: { samples: 50, bounds: { maxMs: 1000 } },
    timeout: { samples: 20, bounds: { overTimeoutMs: 750 } },
    concurrent: { batches: 20, batchSize: 4, bounds: { p99DeltaMs: 250, maxDeltaMs: 500, absoluteMaxMs: 2000 } },
    supervisorAlone: { samples: 50, bounds: { combinedP99Ms: 150, combinedMaxMs: 250 } },
    noSubscriber: { warmups: 20, samples: 200 },
  });
  assert.deepEqual(q.schedules, { 'claude-code': { kind: 'parallel', evidence: 'https://code.claude.com/docs/en/hooks#hook-handler-fields' } });
});

// One complete, passing result for one host and runtime; each test perturbs a copy.
const sample = (ms, stateDir, over = {}) => ({ elapsedMs: ms, ok: true, statuses: ['exited 0', 'exited 0'], survivors: [], invocations: 3, stderr: '', stateDir,
  branches: [{ name: 'deployed-relay', startedMs: 0, elapsedMs: ms }, { name: 'turn-pause', startedMs: 1, elapsedMs: ms / 2 }], ...over });
const candidateSample = (ms, stateDir, over = {}) => ({ ...sample(ms, stateDir), statuses: ['exited 0'], branches: [{ name: 'candidate-relay', startedMs: 0, elapsedMs: ms }], ...over });
function manifest(host) {
  return { schema: 1, host, harness: 'claude-code', version: '2.1.322', mode: 'interactive', event: 'PreToolUse', baselineKind: 'deployed-relay-plus-native',
    settings: { repository: 'hq', commit: '9'.repeat(40), path: 'harnesses/claude/settings.json', blob: '8'.repeat(40) },
    inventory: { relayedEvents: ['PreToolUse', 'Stop'] },
    deployed: { version: '0.3.0', relayEntry: '/deployed/relay.js', packageSha256: PACKAGE, configSha256: 'b'.repeat(64) },
    schedule: { kind: 'parallel', evidence: 'https://code.claude.com/docs/en/hooks#hook-handler-fields' },
    branches: [{ name: 'deployed-relay', role: 'deployed-relay', argv: ['/bin/sh', '-c', 'x'] }, { name: 'turn-pause', role: 'native', migrates: true, argv: ['/bin/sh', '-c', 'y'] }],
    replacementMap: [
      { invocation: 'ops-guard', baseline: 'deployed-relay:ops-guard', candidate: 'candidate:ops-guard' },
      { invocation: 'familiar', baseline: 'deployed-relay:familiar', candidate: 'candidate:familiar' },
      { invocation: 'turn-pause', baseline: 'turn-pause', candidate: 'candidate:turn-pause' }],
    candidate: { configSha256: 'c'.repeat(64) } };
}
function result(host, runtime) {
  const c = q.conditions;
  const pair = (n, base, cand, dirs) => ({ baseline: range(n, (i) => sample(base, dirs ? `/s/${host}/${runtime}/b${i}` : `/s/${host}/${runtime}/warm-b`)),
    candidate: range(n, (i) => candidateSample(cand, dirs ? `/s/${host}/${runtime}/c${i}` : `/s/${host}/${runtime}/warm-c`)) });
  return {
    schema: 1, mode: 'measure', route: { harness: 'claude-code', event: 'PreToolUse', outerMs: 20000 }, host, runtime, harnessAncestor: { pid: 4100, resolved: 4100 },
    candidate: { commit: COMMIT, dirty: false, configSha256: 'c'.repeat(64) }, manifest: manifest(host), deployedDigest: PACKAGE,
    workLists: { baseline: ['deployed-relay:ops-guard', 'deployed-relay:familiar', 'turn-pause'], candidate: ['candidate:ops-guard', 'candidate:turn-pause', 'candidate:familiar'] },
    fixtures: { baseline: { 'deployed-relay:ops-guard': SCRIPT, 'deployed-relay:familiar': SCRIPT, 'turn-pause': SCRIPT },
      candidate: { 'candidate:ops-guard': SCRIPT, 'candidate:familiar': SCRIPT, 'candidate:turn-pause': SCRIPT } },
    conditions: {
      supervisorAlone: range(c.supervisorAlone.samples, () => ({ startupMs: 60, cleanupMs: 5, combinedMs: 70, cleanup: 'complete' })),
      warm: pair(c.warm.samples, 100, 140, false),
      cold: pair(c.cold.samples, 150, 200, true),
      missing: range(c.missing.samples, () => ({ elapsedMs: 120, ok: true, expected: 'refusal', observed: 'refusal', fallback: false, survivors: [] })),
      timeout: range(c.timeout.samples, () => ({ elapsedMs: 1300, ok: true, cleanup: 'complete', survivors: [] })),
      concurrent: { ...pair(c.concurrent.batches * c.concurrent.batchSize, 160, 220, false), lostOccurrences: 0 },
      noSubscriber: { deployed: range(c.noSubscriber.samples, () => 80), candidate: range(c.noSubscriber.samples, () => 85), native: range(c.noSubscriber.samples, () => 3), failures: [], starts: { candidate: false } },
    },
  };
}
const completePair = () => ['host-a', 'host-b'].flatMap((host) => ['v22.23.2', 'v26.5.0'].map((runtime) => result(host, runtime)));
const failing = (mutate) => { const samples = completePair(); mutate(samples); return judge(samples, workload); };

test('a complete pair of hosts, each on Node 22 and the development runtime, passes', () => {
  const verdict = judge(completePair(), workload);
  assert.deepEqual(verdict.failures, []);
  assert.equal(verdict.passed, true);
  assert.ok(verdict.rows.some((r) => r.host === 'host-b' && r.runtime === 'v26.5.0' && r.case === 'warm candidate'));
  assert.deepEqual(verdict.evidence.map((e) => e.split(' ', 1)[0]).sort(), ['host=host-a', 'host=host-a', 'host=host-b', 'host=host-b']);
  assert.ok(verdict.evidence.every((e) => e.includes(COMMIT) && e.includes('claude-code PreToolUse') && / outerMs=20000 /.test(e)), 'each line names the budget it was measured at');
});

test('the judge refuses incomplete, mismatched or unsound evidence', () => {
  const oneHostOnly = completePair().filter((r) => r.host === 'host-a');
  assert.equal(judge(oneHostOnly, workload).passed, false);
  assert.match(judge(oneHostOnly, workload).failures.join('\n'), /two hosts/);
  const cases = [
    ['missing sample', /warm.*200/, (s) => s[0].conditions.warm.candidate.pop()],
    ['one runtime per host', /Node 22 and a development runtime/, (s) => s.splice(1, 1)],
    ['different commits', /one candidate commit/, (s) => { s[2].candidate.commit = 'd'.repeat(40); }],
    ['dirty candidate', /uncommitted/, (s) => { s[0].candidate.dirty = true; }],
    ['reused host manifest', /manifest is for host-a/, (s) => { s[2].manifest = manifest('host-a'); }],
    ['wrong baseline kind', /native-only.*relays PreToolUse|relays PreToolUse/, (s) => { Object.assign(s[0].manifest, { baselineKind: 'native-only', deployed: null, branches: [s[0].manifest.branches[1]] }); }],
    ['wrong deployed artifact', /deployed package/, (s) => { s[1].deployedDigest = 'a'.repeat(64); }],
    ['serial baseline', /serial.*parallel|parallel/, (s) => { s[0].manifest.schedule = { kind: 'serial', evidence: 'x' }; }],
    ['serialized branches', /overlap/, (s) => { s[0].conditions.warm.baseline[4].branches[1].startedMs = 500; }],
    ['work credited to one side', /replacement map/, (s) => { s[0].workLists.candidate = ['candidate:ops-guard', 'candidate:turn-pause']; }],
    ['unequal fixtures', /fixture/, (s) => { s[3].fixtures.candidate['candidate:familiar'] = '0'.repeat(64); }],
    ['no-subscriber diagnostics absent', /no-subscriber/, (s) => { delete s[0].conditions.noSubscriber; }],
    ['empty candidate started a supervisor', /supervisor/, (s) => { s[0].conditions.noSubscriber.starts.candidate = true; }],
    ['cold mixed with warm', /cold/, (s) => { s[0].conditions.cold.candidate[3].stateDir = s[0].conditions.warm.candidate[0].stateDir; }],
    ['warm samples from fresh state', /warm/, (s) => { s[1].conditions.warm.baseline[9].stateDir = '/s/fresh'; }],
    ['p99 bad despite good p95', /warm p99/, (s) => { s[0].conditions.warm.candidate.forEach((x, i) => { if (i >= 196) x.elapsedMs = 420; }); }],
    ['max bad', /cold max/, (s) => { s[0].conditions.cold.candidate[0].elapsedMs = 520; }],
    ['absolute bound', /concurrent absolute max/, (s) => { s[0].conditions.concurrent.baseline.forEach((x) => { x.elapsedMs = 1800; }); s[0].conditions.concurrent.candidate.forEach((x) => { x.elapsedMs = 2100; }); }],
    ['failed call', /failed/, (s) => { s[0].conditions.cold.baseline[2].ok = false; }],
    ['surviving process', /surviv/, (s) => { s[0].conditions.timeout[1].survivors = ['grandchild 4242']; }],
    ['timeout late', /timeout/, (s) => { s[0].conditions.timeout[0].elapsedMs = 1800; }],
    ['missing command fallback', /fallback|missing/, (s) => { s[0].conditions.missing[0].fallback = true; }],
    ['wrong missing-command failure', /missing/, (s) => { s[0].conditions.missing[1].observed = 'allow'; }],
    ['lost occurrence', /occurrence/, (s) => { s[0].conditions.concurrent.lostOccurrences = 1; }],
    ['candidate failure diagnostic', /diagnostic/, (s) => { s[0].conditions.warm.candidate[0].stderr = 'relay: CONTAINMENT_FAILED: x\n'; }],
    ['supervisor alone tail', /supervisor-alone/, (s) => { s[0].conditions.supervisorAlone[0].combinedMs = 251; }],
    ['pilot results', /pilot/, (s) => { s[0].mode = 'pilot'; }],
    ['speculative start unobserved', /speculative/, (s) => { Object.assign(s[0].conditions.noSubscriber, { speculative: range(200, () => 95) }); s[0].conditions.noSubscriber.starts.speculative = false; }],
    ['unscheduled harness', /scheduling evidence/, (s) => { for (const r of s) { r.route.harness = 'codex'; r.manifest.harness = 'codex'; } }],
    ['no harness ancestor check', /harness ancestor/, (s) => { delete s[0].harnessAncestor; }],
    ['hooks borrowed another session', /harness ancestor/, (s) => { s[3].harnessAncestor.resolved = 1; }],
  ];
  for (const [name, message, mutate] of cases) {
    const verdict = failing(mutate);
    assert.equal(verdict.passed, false, name);
    assert.match(verdict.failures.join('\n'), message, name);
  }
});

test('the native-only comparator for a newly transported route needs no deployed relay', () => {
  const samples = completePair();
  for (const r of samples) {
    Object.assign(r.manifest, { baselineKind: 'native-only', deployed: null, inventory: { relayedEvents: ['Stop'] },
      branches: [{ name: 'turn-pause', role: 'native', migrates: true, argv: ['/bin/sh', '-c', 'y'] }],
      replacementMap: [{ invocation: 'turn-pause', baseline: 'turn-pause', candidate: 'candidate:turn-pause' }] });
    r.deployedDigest = null;
    r.workLists = { baseline: ['turn-pause'], candidate: ['candidate:turn-pause'] };
    r.fixtures = { baseline: { 'turn-pause': SCRIPT }, candidate: { 'candidate:turn-pause': SCRIPT } };
    for (const s of [...r.conditions.warm.baseline, ...r.conditions.cold.baseline, ...r.conditions.concurrent.baseline]) s.branches = [s.branches[1]];
    delete r.conditions.noSubscriber.deployed;
  }
  assert.deepEqual(judge(samples, workload).failures, []);
});

test('routes qualify independently: missing SubagentStop retry proof leaves Stop qualified', () => {
  const routes = [{ event: 'Stop', role: 'guard', outerMs: 600000 }, { event: 'SubagentStop', role: 'guard', outerMs: 600000 },
    { event: 'SessionStart', role: 'notice', outerMs: 600000, contextLimit: 4000 }, { event: 'UserPromptSubmit', role: 'notice', outerMs: 30000, contextLimit: 10000 }];
  const record = qualificationFor({ harness: 'codex', version: '0.167.2', routes });
  record.rows[1].retryFlag = { status: 'unknown', evidence: ['retry after a refused SubagentStop not probed'], owner: 'relay-123abc' };
  const target = { harness: 'codex', version: '0.167.2', mode: 'interactive', platform: process.platform, relayCommit: COMMIT, configDigest: DIGEST };
  const qualifiedRowsWithMissingSubagentRetry = qualifiedRows(parseQualification(JSON.stringify(record)), target);
  assert.equal(qualifiedRowsWithMissingSubagentRetry.includes('Stop'), true);
  assert.equal(qualifiedRowsWithMissingSubagentRetry.includes('SubagentStop'), false);
  assert.equal(qualifiedRowsWithMissingSubagentRetry.includes('SessionStart'), false, 'a native context limit below 10,000 does not qualify');
  assert.equal(qualifiedRowsWithMissingSubagentRetry.includes('UserPromptSubmit'), true);
  record.rows[0].retryFlag = { status: 'failed', evidence: ['the harness looped after a refusal'], owner: 'relay-123abc' };
  assert.equal(qualifiedRows(parseQualification(JSON.stringify(record)), target).includes('Stop'), false, 'false retry proof');
});

test('the qualification scripts import without an entry script path', async () => {
  const { spawnSync } = await import('node:child_process');
  for (const name of ['judge.mjs', 'run.mjs']) {
    const url = new URL(`../scripts/hook-qualification/${name}`, import.meta.url).href;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: '/' } });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
  }
});

// Node resolves symlinks in the entry module's URL but not in process.argv[1]; a script reached
// through a linked directory (a checkout's .worktrees link) must still run, never exit 0 unrun.
test('the qualification scripts run when invoked through a symlinked path', async () => {
  const { mkdtempSync, symlinkSync, rmSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'relay-linked-'));
  try {
    const linked = join(dir, 'scripts');
    symlinkSync(fileURLToPath(new URL('../scripts/hook-qualification', import.meta.url)), linked);
    const env = { PATH: '/usr/bin:/bin', HOME: dir };
    const judged = spawnSync(process.execPath, [join(linked, 'judge.mjs'), join(dir, 'absent.json')], { encoding: 'utf8', env });
    assert.notEqual(judged.status, 0, 'a judge that never ran must not report a pass');
    const ran = spawnSync(process.execPath, [join(linked, 'run.mjs')], { encoding: 'utf8', env });
    assert.equal(ran.status, 2, ran.stderr);
    assert.match(ran.stderr, /--output DIR is required/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A route process is plain node, whose /proc comm names no harness (Node 24 and later rename the
// main thread at startup); a route that did not name itself for its harness left its hooks without a
// session or, under a real harness session, borrowing that outer session silently. Its command line
// stays its own, so command-line views show the runner rather than a harness session.
test('a route names itself for its harness on every runtime, so its hooks resolve the route process', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'relay-harness-'));
  try {
    const run = new URL('../scripts/hook-qualification/run.mjs', import.meta.url).href, candidate = fileURLToPath(new URL('..', import.meta.url));
    const script = `const { readFileSync } = await import('node:fs');
const { becomeHarness, hookSessionPid } = await import(${JSON.stringify(run)});
const before = readFileSync('/proc/self/cmdline');
becomeHarness('claude-code');
process.stdout.write(JSON.stringify({ pid: process.pid, comm: readFileSync('/proc/self/comm', 'utf8').trim(), cmdlineKept: before.equals(readFileSync('/proc/self/cmdline')),
  resolved: hookSessionPid({ candidate: ${JSON.stringify(candidate)}, harness: 'claude-code' }) }));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: dir } });
    assert.equal(r.status, 0, r.stderr);
    const { pid, comm, cmdlineKept, resolved } = JSON.parse(r.stdout);
    assert.equal(comm, 'claude');
    assert.equal(cmdlineKept, true, 'the route keeps its own command line');
    assert.equal(resolved, pid, `on ${process.version} hooks resolved session ${resolved}, not the route process ${pid}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a route refuses when its hooks would resolve no session or another one', async () => {
  const { assertHarnessAncestor } = await import('../scripts/hook-qualification/run.mjs');
  assert.doesNotThrow(() => assertHarnessAncestor(41, 41));
  assert.throws(() => assertHarnessAncestor(null, 41), /hooks would resolve session none, not this route's fake harness process 41/);
  assert.throws(() => assertHarnessAncestor(7, 41), /hooks would resolve session 7, not this route's fake harness process 41/);
});
