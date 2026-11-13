import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createChildSupervisor, recoverChildRecords } from '../src/child-supervisor.js';
import { launchSupervisor, releaseSupervisor } from '../src/supervisor-launch.js';
import { createProcessOps } from '../src/bus/proc.js';
import { dispatchHook, reconcile } from '../src/dispatch.js';
import { relayError } from '../src/protocol.js';
import { processMarker, markedPids, reapMarked } from './helpers/survivors.js';
import { until } from './helpers/wait.js';
import { tempPaths, writeSubscribers } from './helpers/fixture.js';

const fixture = new URL('./fixtures/descendant.js', import.meta.url).pathname;
const node = (mode, ...rest) => [process.execPath, fixture, mode, ...rest];
const ops = createProcessOps();
const far = () => performance.now() + 20000;
const env = () => ({ PATH: process.env.PATH, HOME: tmpdir() });
const run = (supervisor, argv, timeoutMs = 5000) => supervisor.runChild(argv, '', { timeoutMs, deadline: far(), env: env(), cwd: '/' });

// Whether any recorded identity still names a live or zombie process: the process table, not the
// registry's liveness verdict.
async function anyRecordedHandleExists(handles) {
  for (const { pid, start } of handles) {
    try {
      const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
      if (text.slice(text.lastIndexOf(')') + 2).split(' ')[19] === start) return true;
    } catch {}
  }
  return false;
}
async function recordDir(t) {
  const dir = join(realpathSync(await mkdtemp(join(tmpdir(), 'relay-records-'))), 'children');
  t.after(() => rm(join(dir, '..'), { recursive: true, force: true }));
  return dir;
}
const marked = (t) => { const marker = processMarker(); t.after(() => reapMarked(marker)); return marker; };
const records = async (dir) => (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json'));
const readRecord = async (dir) => JSON.parse(await readFile(join(dir, (await records(dir))[0]), 'utf8'));

test('a successful subscriber leaving a grandchild on its pipes is contained before its result', async (t) => {
  const dir = await recordDir(t), marker = marked(t);
  const supervisor = await createChildSupervisor({ deadline: far(), sessionHandle: null, recordDir: dir });
  const result = await run(supervisor, node('grandchild', marker));
  assert.equal(result.status, 'exited'); assert.equal(result.exitCode, 0); assert.equal(result.stdout, '{"decision":"allow"}');
  assert.equal(result.cleanup, 'complete');
  assert.deepEqual(markedPids(marker), [], 'the grandchild is gone before the invocation reports');
  assert.deepEqual(await supervisor.close(), { cleanup: 'complete' });
  assert.deepEqual(await records(dir), [], 'a clean close removes the ownership record');
});

test('timeout and overflow contain the whole group; a fast exit needs no signal', async (t) => {
  const dir = await recordDir(t), marker = marked(t);
  const supervisor = await createChildSupervisor({ deadline: far(), sessionHandle: null, recordDir: dir });
  let started = performance.now();
  const timedOut = await run(supervisor, node('hang-grandchild', marker), 200);
  assert.equal(timedOut.status, 'timeout'); assert.equal(timedOut.cleanup, 'complete');
  assert.ok(performance.now() - started < 200 + 750, 'timeout plus cleanup stays inside its reserve');
  assert.deepEqual(markedPids(marker), []);
  const overflow = await run(supervisor, node('overflow'));
  assert.equal(overflow.status, 'output-exceeded'); assert.equal(overflow.cleanup, 'complete'); assert.equal(overflow.stdout.length, 65536);
  started = performance.now();
  const fast = await run(supervisor, ['/bin/true']);
  assert.equal(fast.status, 'exited'); assert.equal(fast.exitCode, 0); assert.equal(fast.cleanup, 'complete');
  assert.ok(fast.timings.cleanupMs < 50, `a group already empty cleans at once (${fast.timings.cleanupMs} ms)`);
  started = performance.now();
  const missing = await run(supervisor, ['/nonexistent/relay-subscriber'], 3000);
  assert.equal(missing.status, 'spawn-failed'); assert.equal(missing.cleanup, 'complete');
  assert.ok(performance.now() - started < 1000, `a spawn failure reports at once, not after its timeout (${(performance.now() - started).toFixed(0)} ms)`);
  started = performance.now();
  const late = await supervisor.runChild(node('allow'), '', { timeoutMs: 3000, deadline: performance.now() - 1, env: env(), cwd: '/' });
  assert.equal(late.status, 'timeout');
  assert.ok(performance.now() - started < 1000, 'an expired deadline reports at once');
  assert.deepEqual(await supervisor.close(), { cleanup: 'complete' });
});

test('a descendant escaping its group but holding the pipes ends the run within its cleanup reserve as a failed cleanup', async (t) => {
  const dir = await recordDir(t), marker = marked(t);
  const supervisor = await createChildSupervisor({ deadline: far(), sessionHandle: null, recordDir: dir });
  const started = performance.now();
  const result = await run(supervisor, node('escape', marker), 3000);
  assert.ok(performance.now() - started < 1500, `bounded by the cleanup reserve, not the escaped process (${(performance.now() - started).toFixed(0)} ms)`);
  assert.equal(result.status, 'exited'); assert.equal(result.cleanup, 'failed');
  assert.equal(result.stdout, '{"decision":"allow"}');
});

test('a supervisor whose dispatcher is gone exits even while an escaped descendant holds the pipes', async (t) => {
  const dir = await recordDir(t), marker = marked(t);
  let supervisorProcess;
  const supervisor = await createChildSupervisor({ deadline: far(), sessionHandle: null, recordDir: dir, spawnFn: (...args) => (supervisorProcess = spawn(...args)) });
  void run(supervisor, node('escape-hang', marker), 10000);
  await until(async () => (await records(dir)).length === 1 && (await readRecord(dir)).phase === 'active', { timeoutMs: 3000, what: 'admission' });
  const { supervisor: own } = await readRecord(dir);
  supervisorProcess.stdio[3].destroy();
  await until(() => ops.probe(own).status === 'dead', { timeoutMs: 2500, what: 'supervisor exit despite held pipes' });
});

test('one supervisor serves sequential runs, rejects a concurrent one, and concurrent dispatches each keep their own', async (t) => {
  const dir = await recordDir(t), marker = marked(t);
  let spawned = 0;
  const counting = (...args) => { spawned++; return spawn(...args); };
  const supervisor = await createChildSupervisor({ deadline: far(), sessionHandle: null, recordDir: dir, spawnFn: counting });
  for (let i = 0; i < 3; i++) assert.equal((await run(supervisor, node('allow'))).status, 'exited');
  assert.equal(spawned, 1, 'three sequential subscribers share one supervisor');
  const [first, second] = await Promise.all([run(supervisor, node('hang', marker), 300), run(supervisor, node('allow'))]);
  assert.equal(first.status, 'timeout');
  assert.equal(second.status, 'supervisor-failed', 'a second run while one is active is refused');
  assert.deepEqual(markedPids(marker), []);
  await supervisor.close();
  const pair = await Promise.all([0, 1].map(async () => {
    const own = await createChildSupervisor({ deadline: far(), sessionHandle: null, recordDir: dir });
    const result = await run(own, node('grandchild', marker));
    return [result.cleanup, (await own.close()).cleanup];
  }));
  assert.deepEqual(pair, [['complete', 'complete'], ['complete', 'complete']]);
  assert.deepEqual(markedPids(marker), []);
});

test('a dispatcher killed after admission or while sending leaves no subscriber behind', async (t) => {
  for (const when of ['after-admit', 'at-send']) {
    const dir = await recordDir(t), marker = marked(t);
    const dispatcher = spawn(process.execPath, [fixture, 'dispatcher', dir, marker, when], { stdio: ['ignore', 'pipe', 'inherit'], env: env() });
    const signal = await new Promise((resolve) => dispatcher.once('exit', (_code, sig) => resolve(sig)));
    assert.equal(signal, 'SIGKILL', when);
    await until(async () => markedPids(marker).length === 0 && (await records(dir)).length === 0, { timeoutMs: 3000, what: `${when}: survivors gone and record removed` });
  }
});

test('control-pipe loss stops the active subscriber while the dispatcher process survives', async (t) => {
  const dir = await recordDir(t), marker = marked(t);
  let supervisorProcess;
  const capture = (...args) => (supervisorProcess = spawn(...args));
  const supervisor = await createChildSupervisor({ deadline: far(), sessionHandle: null, recordDir: dir, spawnFn: capture });
  const started = performance.now();
  const pending = run(supervisor, node('hang-grandchild', marker), 10000);
  await until(async () => (await records(dir)).length === 1 && (await readRecord(dir)).phase === 'active', { timeoutMs: 3000, what: 'admission' });
  supervisorProcess.stdio[3].destroy(); // the dispatcher lives on; only its control pipe is gone
  const result = await pending;
  assert.equal(result.cleanup, 'complete');
  assert.ok(performance.now() - started < 3000, 'pipe loss ends the run well before its timeout');
  assert.deepEqual(markedPids(marker), []);
});

test('native session death stops the active subscriber; absent session proof still runs it', async (t) => {
  const dir = await recordDir(t), marker = marked(t);
  const session = spawn('/bin/sleep', ['60'], { stdio: 'ignore' });
  t.after(() => session.kill('SIGKILL'));
  const handle = ops.handleOf(session.pid);
  const supervisor = await createChildSupervisor({ deadline: far(), sessionHandle: handle, recordDir: dir });
  const started = performance.now();
  const pending = run(supervisor, node('hang-grandchild', marker), 10000);
  await until(async () => (await records(dir)).length === 1 && (await readRecord(dir)).phase === 'active', { timeoutMs: 3000, what: 'admission' });
  session.kill('SIGKILL');
  const result = await pending;
  assert.equal(result.status, 'stopped'); assert.equal(result.cleanup, 'complete');
  assert.ok(performance.now() - started < 3000, 'session death ends the run well before its timeout');
  assert.deepEqual(markedPids(marker), []);
});

test('the supervisor holds its own absolute deadline when the dispatcher stops talking', async (t) => {
  const dir = await recordDir(t);
  const supervisor = await createChildSupervisor({ deadline: performance.now() + 300, sessionHandle: null, recordDir: dir });
  const { supervisor: own } = await readRecord(dir);
  assert.equal(ops.probe(own).status, 'alive');
  await until(() => ops.probe(own).status === 'dead', { timeoutMs: 3000, what: 'supervisor exit at its deadline' });
  assert.deepEqual(await records(dir), []);
  assert.equal((await supervisor.close()).cleanup, 'complete');
});

test('an early-started supervisor keeps its provisional deadline; init can only shorten it', async (t) => {
  const dir = await recordDir(t);
  const short = launchSupervisor({ deadlineMs: 300 });
  await createChildSupervisor({ deadline: far(), sessionHandle: null, recordDir: dir, launched: short });
  const { supervisor: first } = await readRecord(dir);
  await until(() => ops.probe(first).status === 'dead', { timeoutMs: 2500, what: 'the provisional deadline wins over a later init deadline' });
  const long = launchSupervisor({ deadlineMs: 20000 });
  await createChildSupervisor({ deadline: performance.now() + 300, sessionHandle: null, recordDir: dir, launched: long });
  const { supervisor: second } = await readRecord(dir);
  await until(() => ops.probe(second).status === 'dead', { timeoutMs: 2500, what: 'an earlier init deadline shortens the provisional one' });
});

test('an early supervisor that is never adopted exits without a record', async (t) => {
  const dir = await recordDir(t);
  const early = launchSupervisor({ deadlineMs: 20000 });
  const handle = ops.handleOf(early.pid);
  await releaseSupervisor(early);
  assert.equal(ops.probe(handle).status, 'dead');
  assert.deepEqual(await records(dir), []);
});

test('a killed supervisor with an acknowledged group is contained by the living dispatcher and leaves an incident record', async (t) => {
  const dir = await recordDir(t), marker = marked(t);
  const supervisor = await createChildSupervisor({ deadline: far(), sessionHandle: null, recordDir: dir });
  const pending = run(supervisor, node('hang-grandchild', marker), 10000);
  await until(async () => (await records(dir)).length === 1 && (await readRecord(dir)).phase === 'active', { timeoutMs: 3000, what: 'admission' });
  const record = await readRecord(dir);
  process.kill(record.supervisor.pid, 'SIGKILL');
  const result = await pending;
  assert.equal(result.status, 'supervisor-failed'); assert.equal(result.cleanup, 'complete');
  assert.deepEqual(markedPids(marker), []);
  assert.equal(await anyRecordedHandleExists([record.child]), false);
  assert.equal((await records(dir)).length, 1, 'the record stays for explicit recovery');
  const recovered = await recoverChildRecords({ dir });
  assert.deepEqual(recovered.removed, []);
  assert.match(recovered.incidents.join('\n'), /CLEANUP_INCIDENT: .* live \(phase active supervisor dead dispatcher alive/);
  assert.equal((await supervisor.runChild(node('allow'), '', { timeoutMs: 1000, deadline: far(), env: env(), cwd: '/' })).status, 'supervisor-failed', 'no further admissions');
});

// Recovery fixtures: handles of processes that have exited, of this live process, of a foreign host.
async function deadHandle() {
  const child = spawn('/bin/sleep', ['0.01'], { stdio: 'ignore' });
  const handle = ops.handleOf(child.pid);
  await new Promise((resolve) => child.once('exit', resolve));
  return handle;
}
const write = (dir, record) => writeFile(join(dir, `${randomUUID()}.json`), JSON.stringify({ schema: 1, ...record }), { mode: 0o600 });

test('recovery removes only verified-dead records, retains every other kind and never signals', async (t) => {
  const dir = await recordDir(t); await mkdir(dir, { recursive: true });
  const dead = await deadHandle(), alive = ops.handleOf(process.pid), foreign = { ...alive, host: 'elsewhere.invalid' };
  const bystander = spawn('/bin/sleep', ['30'], { stdio: 'ignore', detached: true });
  t.after(() => { try { process.kill(-bystander.pid, 'SIGKILL'); } catch {} });
  const reused = { ...ops.handleOf(bystander.pid), start: '1' };
  const orphan = spawn('/bin/sleep', ['30'], { stdio: 'ignore', detached: true });
  t.after(() => { try { process.kill(-orphan.pid, 'SIGKILL'); } catch {} });
  const survivor = ops.handleOf(orphan.pid);
  await write(dir, { phase: 'idle', supervisor: dead, parent: dead, child: null, pgid: null });
  await write(dir, { phase: 'active', supervisor: dead, parent: dead, child: dead, pgid: dead.pid });
  await write(dir, { phase: 'active', supervisor: dead, parent: dead, child: reused, pgid: reused.pid });
  await write(dir, { phase: 'active', supervisor: dead, parent: dead, child: survivor, pgid: survivor.pid });
  await write(dir, { phase: 'active', supervisor: alive, parent: alive, child: null, pgid: null });
  await write(dir, { phase: 'idle', supervisor: foreign, parent: dead, child: null, pgid: null });
  await write(dir, { phase: 'spawn-pending', supervisor: dead, parent: dead, invocation: 3 });
  await writeFile(join(dir, `${randomUUID()}.json`), '{ not json');
  let signals = 0;
  const kill = process.kill;
  process.kill = (...args) => { signals++; return kill.apply(process, args); };
  let recovered;
  try { recovered = await recoverChildRecords({ dir }); } finally { process.kill = kill; }
  assert.equal(recovered.removed.length, 3, 'dead idle, dead active and reused-pid records go');
  assert.equal(recovered.incidents.length, 5);
  const text = recovered.incidents.join('\n');
  for (const pattern of [/ live \(phase active supervisor alive dispatcher alive/, / unverified ownership \(phase idle supervisor unknown/,
    /spawn-pending invocation 3/, /malformed record retained/, /surviving group, operator cleanup required \(phase active supervisor dead dispatcher dead child alive group present/]) assert.match(text, pattern);
  assert.equal(signals, 0, 'recovery never signals');
  assert.equal(ops.probe(ops.handleOf(bystander.pid)).status, 'alive', 'an unrelated process on a reused pid is untouched');
  assert.equal(ops.probe(survivor).status, 'alive', 'a verified surviving group is reported, never killed');
  assert.equal((await records(dir)).length, 5);
});

test('recovery scans at most 128 records per reap and continues from its cursor', async (t) => {
  const dir = await recordDir(t); await mkdir(dir, { recursive: true });
  const dead = await deadHandle();
  for (let i = 0; i < 130; i++) await write(dir, { phase: 'idle', supervisor: dead, parent: dead, child: null, pgid: null });
  const first = await recoverChildRecords({ dir });
  assert.equal(first.inspected, 128); assert.equal(first.removed.length, 128); assert.notEqual(first.nextCursor, null);
  const second = await recoverChildRecords({ dir, cursor: first.nextCursor });
  assert.equal(second.inspected, 2); assert.equal(second.nextCursor, null);
  assert.deepEqual(await records(dir), []);
});

test('relay reap runs recovery after reconciliation, even when reconciliation fails', async (t) => {
  const p = await tempPaths(t), dir = join(p.stateDir, 'children');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeSubscribers(p, []);
  await write(dir, { phase: 'idle', supervisor: await deadHandle(), parent: await deadHandle(), child: null, pgid: null });
  await writeFile(join(dir, `${randomUUID()}.json`), 'garbage');
  const { diagnostics } = await reconcile({}, { paths: p });
  assert.match(diagnostics.join('\n'), /CLEANUP_INCIDENT: .*malformed/);
  assert.equal((await records(dir)).length, 1);
  await assert.rejects(reconcile({}, { paths: p, reap: async () => { throw relayError('IO_ERROR', 'reap failed'); } }),
    (error) => error.code === 'IO_ERROR' && error.recovery.some((line) => /CLEANUP_INCIDENT/.test(line)));
});

// Dispatch-level: supervisor use per dispatch, optional native ancestry and deadline admission.
const CWD = realpathSync(tmpdir());
const payload = JSON.stringify({ session_id: 'sess', cwd: CWD, tool_name: 'Bash', tool_input: { command: 'ls' } });
const guard = (name, mode = 'allow') => ({ name, role: 'guard', kinds: ['before-tool'], harnesses: ['claude-code'], argv: ['node', fixture, mode], timeoutMs: 1000 });
const counted = () => {
  const calls = { supervisors: 0, runs: 0 };
  return { calls, supervise: async (options) => {
    calls.supervisors++;
    const real = await createChildSupervisor(options);
    return { ...real, runChild: (...args) => { calls.runs++; return real.runChild(...args); } };
  } };
};
const hook = (p, deps) => dispatchHook({ harness: 'claude-code', nativeEvent: 'PreToolUse', input: Readable.from([payload]), outerMs: 20000 },
  { paths: p, env: env(), applyOptions: { resolveSessionPid: () => process.pid, gitContext: async () => ({ remote: null, repoRoot: null }) }, ...deps });

test('a dispatch starts one supervisor for three subscribers and none for no subscriber', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [guard('a'), guard('b'), { name: 'o', role: 'observer', registry: 'occurrence', kinds: ['before-tool'], argv: ['node', fixture, 'allow'], timeoutMs: 1000 }]);
  let { calls, supervise } = counted();
  const r = await hook(p, { supervise });
  assert.equal(r.exitCode, 0, r.stderr);
  assert.deepEqual(calls, { supervisors: 1, runs: 3 });
  await writeSubscribers(p, []);
  ({ calls, supervise } = counted());
  assert.equal((await hook(p, { supervise })).exitCode, 0);
  assert.deepEqual(calls, { supervisors: 0, runs: 0 });
  assert.deepEqual(await records(join(p.stateDir, 'children')), []);
});

test('missing native ancestry still admits a PreToolUse guard and allows, with one diagnostic', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [guard('g')]);
  const { calls, supervise } = counted();
  const unknownSessionPreToolUse = await hook(p, { supervise, applyOptions: { resolveSessionPid: () => null, gitContext: async () => ({ remote: null, repoRoot: null }) } });
  assert.equal(calls.runs, 1);
  assert.equal(unknownSessionPreToolUse.exitCode, 0);
  assert.equal(unknownSessionPreToolUse.stdout, '');
  assert.equal(unknownSessionPreToolUse.stderr.match(/SESSION_HANDLE_UNAVAILABLE/g).length, 1);
  // The registry's own identity lookup is separate: with no session pid it reports, but the guard verdict stands.
  assert.doesNotMatch(unknownSessionPreToolUse.stdout, /deny/);
});

test('no subscriber is delivered after the dispatch deadline', async (t) => {
  const p = await tempPaths(t), marker = marked(t);
  await writeSubscribers(p, [{ name: 'o', role: 'observer', registry: 'occurrence', kinds: ['before-tool'], argv: ['node', fixture, 'hang', marker], timeoutMs: 1000 }]);
  const { calls, supervise } = counted();
  let now = 0;
  const r = await hook(p, { supervise, clock: () => now, apply: async () => { now = 19000; return { snapshot: null, changed: false, reaped: [], diagnostics: [] }; } });
  assert.match(r.stderr, /SUBSCRIBER_SKIPPED: o/);
  const deliveredAfterDeadline = calls.runs;
  assert.equal(deliveredAfterDeadline, 0);
  assert.deepEqual(markedPids(marker), []);
});
