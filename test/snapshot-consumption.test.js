import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchHook, reconcile } from '../src/dispatch.js';
import { readSnapshot, applyEvent, readSnapshotFor } from '../src/bus/transaction.js';
import * as relay from '../src/index.js';
import { withLock } from '../src/bus/lock.js';
import { normalizeEvent } from '../src/adapters/index.js';
import { validateSubscribers } from '../src/subscribers.js';
import { relayError } from '../src/protocol.js';
import { tempPaths, writeSubscribers } from './helpers/fixture.js';
import { createConsumer } from './fixtures/snapshot-consumer.js';

const fixture = new URL('./fixtures/subscriber.js', import.meta.url).pathname;
const CWD = realpathSync(mkdtempSync(join(tmpdir(), 'relay-snap-')));
test.after(() => rmSync(CWD, { recursive: true, force: true }));
const local = { resolveSessionPid: () => process.pid, gitContext: async () => ({ remote: null, repoRoot: null }) };
const env = { PATH: process.env.PATH, HOME: CWD };
const observer = (name, registry, file, over = {}) => ({ name, role: 'observer', registry, kinds: ['after-tool'], harnesses: ['claude-code'], argv: ['node', fixture, 'record', file], timeoutMs: 2000, ...over });
const post = (n) => JSON.stringify({ session_id: 'sess', cwd: CWD, tool_name: 'Bash', tool_use_id: `t${n}`, tool_input: { command: 'ls' }, duration_ms: n });
const hook = (p, { nativeEvent = 'PostToolUse', body, deps = {}, outerMs = 20000 } = {}) =>
  dispatchHook({ harness: 'claude-code', nativeEvent, input: Readable.from([Buffer.from(body)]), outerMs }, { paths: p, env, applyOptions: local, ...deps });
const exists = (path) => access(path).then(() => true, () => false);

test('a metadata event with only occurrence observers takes no registry lock and delivers every occurrence', async (t) => {
  const p = await tempPaths(t), file = join(CWD, 'occurrence.json');
  await writeSubscribers(p, [observer('counter', 'occurrence', file)]);
  let release; const held = new Promise((resolve) => { release = resolve; });
  const holder = withLock(p.lockPath, async () => { await held; }, { deadline: performance.now() + 20000 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  let noStateChangeMutationCalls = 0, occurrencesDeliveredAtSameRevision = 0;
  const counting = async (...args) => { noStateChangeMutationCalls++; return applyEvent(...args); };
  for (const n of [1, 2]) {
    const started = performance.now(), r = await hook(p, { body: post(n), deps: { apply: counting } });
    assert.equal(r.exitCode, 0, r.stderr);
    assert.ok(performance.now() - started < 3000, 'the held registry lock does not delay an occurrence');
    const seen = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(seen.registry, { status: 'not-requested' });
    if (seen.event.tool.id.value === `t${n}`) occurrencesDeliveredAtSameRevision++;
  }
  release(); await holder;
  assert.equal(noStateChangeMutationCalls, 0);
  assert.equal(occurrencesDeliveredAtSameRevision, 2, 'distinct occurrences are never deduplicated by revision');
});

test('a publication failure still delivers occurrence observers; snapshot observers are skipped', async (t) => {
  const p = await tempPaths(t), occurrence = join(CWD, 'occ-failed.json'), snapshot = join(CWD, 'snap-failed.json');
  await writeSubscribers(p, [observer('counter', 'occurrence', occurrence, { kinds: ['before-tool'] }), observer('familiar', 'snapshot', snapshot, { kinds: ['before-tool'] })]);
  const r = await hook(p, { nativeEvent: 'PreToolUse', body: post(1), deps: { apply: async () => { throw relayError('LOCK_TIMEOUT', 'lock acquisition deadline exceeded'); } } });
  assert.equal(r.exitCode, 1);
  const unavailableEnvelope = JSON.parse(await readFile(occurrence, 'utf8'));
  assert.deepEqual(unavailableEnvelope.registry, { status: 'unavailable', code: 'LOCK_TIMEOUT' });
  const snapshotObserverCallsOnPublishFailure = await exists(snapshot) ? 1 : 0;
  assert.equal(snapshotObserverCallsOnPublishFailure, 0);
  assert.match(r.stderr, /SUBSCRIBER_SKIPPED: familiar skipped after registry failure/);
});

test('a metadata event reads the registry authoritatively, without mutating it, only for snapshot observers', async (t) => {
  const p = await tempPaths(t), file = join(CWD, 'snap-meta.json');
  await applyEvent(normalizeEvent('claude-code', 'SessionStart', JSON.stringify({ session_id: 'sess', cwd: CWD })), { paths: p, ...local });
  const before = await readSnapshot({ paths: p });
  await writeSubscribers(p, [observer('familiar', 'snapshot', file)]);
  const r = await hook(p, { body: post(1) });
  assert.equal(r.exitCode, 0, r.stderr);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).registry, { status: 'ready', generation: before.generation, revision: before.revision });
  assert.deepEqual(await readSnapshot({ paths: p }), before, 'no revision bump and no refresh for a metadata event');
});

test('readSnapshotFor returns the current snapshot only for the current generation', async (t) => {
  const p = await tempPaths(t);
  const start = (id) => applyEvent(normalizeEvent('claude-code', 'SessionStart', JSON.stringify({ session_id: id, cwd: CWD })), { paths: p, ...local });
  await start('a');
  const first = await readSnapshot({ paths: p });
  assert.equal(relay.readSnapshotFor, readSnapshotFor);
  assert.deepEqual(await readSnapshotFor({ generation: first.generation }, { paths: p }), first);
  await rm(p.agentsPath);
  await start('b');
  const oldGeneration = first.generation;
  assert.equal(await readSnapshotFor({ generation: oldGeneration }, { paths: p }), null);
  assert.equal(await readSnapshotFor({ generation: 'not-a-generation' }, { paths: p }), null);
  await assert.rejects(readSnapshotFor({ generation: oldGeneration }, { paths: p, deadline: performance.now() - 1 }), { code: 'DEADLINE_EXCEEDED' });
});

test('a sample consumer discards delayed old updates and adopts a replacement generation only through the registry', async (t) => {
  const p = await tempPaths(t);
  const start = (id) => applyEvent(normalizeEvent('claude-code', 'SessionStart', JSON.stringify({ session_id: id, cwd: CWD })), { paths: p, ...local });
  const envelope = (snap, value) => ({ registry: { status: 'ready', generation: snap.generation, revision: snap.revision }, value });
  let gate = Promise.resolve();
  const consumer = createConsumer({ readSnapshotFor, options: { paths: p }, delay: async (e) => { if (e.value === 'delayed-old') await gate; } });
  await start('a'); const r1 = await readSnapshot({ paths: p });
  await start('b'); const r2 = await readSnapshot({ paths: p });
  assert.equal(await consumer.apply(envelope(r2, 'r2')), 'applied');
  assert.equal(await consumer.apply(envelope(r1, 'r1-late')), 'stale-revision', 'a non-newer revision within a generation is discarded');
  // A delayed apply of the old generation races a registry replacement and must revalidate.
  let open; gate = new Promise((resolve) => { open = resolve; });
  await start('c'); const r3 = await readSnapshot({ paths: p });
  const delayed = consumer.apply(envelope(r3, 'delayed-old'));
  await rm(p.agentsPath); await start('d');
  const replacement = await readSnapshot({ paths: p });
  const replacementGeneration = replacement.generation;
  open();
  assert.equal(await delayed, 'stale-generation');
  assert.equal(await consumer.apply(envelope(replacement, 'new')), 'applied');
  assert.equal(consumer.state.current.generation, replacementGeneration);
  const appliedOldDelayedValue = consumer.state.applied.some((a) => a.value === 'delayed-old');
  assert.equal(appliedOldDelayedValue, false);
});

test('reconcile reaches snapshot observers only; occurrence observers cannot select it', async (t) => {
  const p = await tempPaths(t), file = join(CWD, 'reconcile-snap.json');
  assert.throws(() => validateSubscribers({ schema: 2, subscribers: [{ name: 'c', role: 'observer', registry: 'occurrence', kinds: ['reconcile'], argv: ['true'], timeoutMs: 100 }] }), { code: 'INVALID_CONFIG', message: /occurrence/ });
  await writeSubscribers(p, [{ name: 'familiar', role: 'observer', registry: 'snapshot', kinds: ['reconcile'], argv: ['node', fixture, 'record', file], timeoutMs: 1000 }]);
  await reconcile({}, { paths: p, env });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).type, 'reconcile');
});

test('a SessionStart notice sees the registry before this event publishes', async (t) => {
  const p = await tempPaths(t), copy = join(CWD, 'notice-saw.json');
  await applyEvent(normalizeEvent('claude-code', 'PreToolUse', JSON.stringify({ session_id: 'sess', cwd: CWD, tool_name: 'Bash', tool_input: {} })), { paths: p, ...local });
  await writeSubscribers(p, [{ name: 'n', role: 'notice', kinds: ['session-start'], harnesses: ['claude-code'], argv: ['node', fixture, 'copy-then-notice', p.agentsPath, copy], timeoutMs: 2000 }]);
  const r = await hook(p, { nativeEvent: 'SessionStart', body: JSON.stringify({ session_id: 'sess', cwd: CWD }) });
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(JSON.parse(await readFile(copy, 'utf8')).agents['claude-code:sess'].state, 'working', 'the notice ran before publication');
  assert.equal((await readSnapshot({ paths: p })).agents['claude-code:sess'].state, 'idle');
});

test('the publication deadline cancels admission and is checked before commit; no mutation runs after a reported failure', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, []);
  let calls = 0, now = 0;
  const late = await hook(p, { nativeEvent: 'PreToolUse', body: post(1), outerMs: 20000, deps: {
    clock: () => now, readInput: async () => { now = 30000; return Buffer.from(post(1)); }, apply: async (...args) => { calls++; return applyEvent(...args); } } });
  assert.equal(calls, 0, 'no publication starts once its deadline has passed');
  assert.match(late.stderr + late.stdout, /DEADLINE_EXCEEDED/);
  assert.equal(await exists(p.agentsPath), false);
  let clock = 0;
  const event = normalizeEvent('claude-code', 'SessionStart', JSON.stringify({ session_id: 'sess', cwd: CWD }));
  await assert.rejects(applyEvent(event, { paths: p, ...local, clock: () => clock, deadline: 1000, gitContext: async () => { clock = 5000; return { remote: null, repoRoot: null }; } }), { code: /DEADLINE_EXCEEDED|LOCK_TIMEOUT/ });
  assert.equal(await exists(p.agentsPath), false, 'a mutation past its deadline never commits');
});

test('a publication still waiting at the deadline is reported and can never commit afterwards', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, []);
  const fs = await import('node:fs/promises');
  // Stall the publication inside the writer lock, after admission and before its commit, past the
  // dispatch's registry deadline (outerMs 5000 leaves 1666 ms).
  await applyEvent(normalizeEvent('claude-code', 'SessionStart', JSON.stringify({ session_id: 'sess', cwd: CWD })), { paths: p, ...local });
  const before = await readFile(p.agentsPath, 'utf8');
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const io = { ...fs, readFile: async (path, ...rest) => { if (String(path) === p.agentsPath) await gate; return fs.readFile(path, ...rest); } };
  let pending;
  const started = performance.now();
  const r = await hook(p, { nativeEvent: 'PreToolUse', body: post(1), outerMs: 5000, deps: {
    applyOptions: { ...local, io }, apply: (...args) => { const work = applyEvent(...args); pending = work.then(() => 'committed', (e) => e); return work; } } });
  assert.ok(performance.now() - started < 3000, 'the reply does not wait past its deadline for a stalled publication');
  assert.match(r.stderr, /registry: DEADLINE_EXCEEDED: registry publication did not finish before the deadline/);
  release();
  const outcome = await pending;
  assert.ok(outcome instanceof Error, `the abandoned publication fails rather than committing late (${outcome})`);
  assert.equal(await readFile(p.agentsPath, 'utf8'), before, 'no mutation commits after the dispatch reported its failure');
});
