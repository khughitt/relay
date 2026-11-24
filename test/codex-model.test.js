import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessOps } from '../src/bus/proc.js';
import { bindTurn, chainWithInit, resolveCodexModel, CLOCK_ALLOWANCE_MS } from '../src/adapters/codex-model.js';
import { dayOf } from '../src/adapters/codex-rollout.js';
import { tempStore, threadAt, record, sessionMeta, turnContext } from './helpers/codex-store.js';

const B = Date.parse('2026-10-17T10:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const row = (pid, ppid, comm, starttime = '1') => ({ pid, ppid, comm, tty: null, starttime, state: 'S' });
const UNDER_CODEX = [row(30, 20, 'node'), row(20, 10, 'bash'), row(10, 5, 'codex')];
/** `starts` gives a pid its own start interval; `argv` answers argvOf, which otherwise must not be read. */
const fakeOps = ({ chain = UNDER_CODEX, init = null, start = { lo: B + 5000, hi: B + 5000 }, starts = {}, argv = {} } = {}) => ({
  ancestors: () => chain.map((r) => ({ ...r })), recordOf: (pid) => (pid === 1 ? init : null),
  executableOf: () => { throw new Error('executable must not be read'); },
  argvOf: (pid) => { if (!(pid in argv)) throw new Error(`argv of ${pid} must not be read`); return argv[pid]; },
  startedAtMs: (r) => starts[r.pid] ?? start });
const HELPER_ARGV = { 1: ['codex-linux-sandbox', '--sandbox-policy-cwd', '/w', '--command-cwd', '/w', '--', 'bash', '-lc', 'x'] };
/** A store holding one rollout whose last turn ran gpt-6-astra and was recorded at `turnAt`. */
const storeWith = (t, { turnAt = B, lines } = {}) => {
  const store = tempStore(t), thread = threadAt(B - 60_000);
  const rollout = store.day(dayOf(thread, 'UTC'), thread, lines?.(thread) ?? [sessionMeta(thread), turnContext('gpt-6-luna', iso(turnAt - 30_000)), turnContext('gpt-6-astra', iso(turnAt))]);
  return { store, thread, rollout, env: { CODEX_THREAD_ID: thread, CODEX_HOME: store.root } };
};
const resolve = (env, ops, extra = {}) => resolveCodexModel({ env, ops, startPid: 30, timeZone: 'UTC', ...extra });

test('bindTurn verifies only an interval wholly more than m after the record', () => {
  assert.equal(CLOCK_ALLOWANCE_MS, 1000);
  assert.equal(bindTurn({ lo: B + 1000, hi: B + 1000 }, B), 'verified');
  assert.equal(bindTurn({ lo: B + 999, hi: B + 1200 }, B), 'turn-boundary');
  assert.equal(bindTurn({ lo: B - 2200, hi: B - 1001 }, B), 'earlier-turn');
  assert.equal(bindTurn({ lo: B - 2000, hi: B - 1000 }, B), 'turn-boundary');
});
test('bindTurn on Darwin second intervals: same second, steps, and the pinned limit', () => {
  const S = 1_800_000_100_000, darwin = { lo: S, hi: S + 999 };
  assert.equal(bindTurn(darwin, S + 500), 'turn-boundary');            // started in the record's second
  assert.equal(bindTurn(darwin, S + 1500 - 900), 'turn-boundary');     // leftover, 900 ms backward step before t
  assert.equal(bindTurn(darwin, S + 6500), 'earlier-turn');            // leftover, harmless forward step
  assert.equal(bindTurn(darwin, S + 1500 - 2600), 'verified');         // stated limit: backward step > m + lead
});
test('chainWithInit appends pid 1 only when the walk ends under it', () => {
  const init = row(1, 0, 'codex');
  assert.deepEqual(chainWithInit(fakeOps({ chain: [row(2, 1, 'bash')], init }), 2).map((r) => r.pid), [2, 1]);
  assert.deepEqual(chainWithInit(fakeOps({ chain: [row(3, 2, 'bash')], init }), 3).map((r) => r.pid), [3]);
});
test('verified: the last turn_context of the thread, for a call process started in that turn', (t) => {
  const { env, thread, rollout } = storeWith(t);
  assert.deepEqual(resolve(env, fakeOps()), { answer: { verified: true, agent: 'codex/gpt-6-astra@high', harness: 'codex', model: 'gpt-6-astra', effort: 'high', effortReason: null, reason: null, source: { thread, nearest: 'codex', rollout } }, detail: null });
});
test('the sandbox: a codex-linux-sandbox helper at pid 1 binds the call by its own start', (t) => {
  const { env } = storeWith(t);
  const ops = fakeOps({ chain: [row(3, 2, 'node'), row(2, 1, 'bash')], init: row(1, 0, 'codex'), argv: HELPER_ARGV,
    starts: { 1: { lo: B + 2000, hi: B + 2000 }, 2: { lo: B + 500, hi: B + 500 } } });
  assert.equal(resolve(env, ops, { startPid: 3 }).answer.agent, 'codex/gpt-6-astra@high');
  const host = fakeOps({ chain: [row(3, 2, 'node'), row(2, 1, 'bash')], init: row(1, 0, 'systemd') });
  assert.equal(resolve(env, host, { startPid: 3 }).answer.reason, 'not-under-codex');
});
test('a namespace-init codex that is not the sandbox helper cannot bind the call', (t) => {
  const { env } = storeWith(t);
  for (const argv of [{ 1: ['/usr/bin/codex', 'app-server'] }, { 1: [] }, {}]) {
    const r = resolve(env, fakeOps({ chain: [row(3, 2, 'node'), row(2, 1, 'bash')], init: row(1, 0, 'codex'), argv }), { startPid: 3 });
    assert.deepEqual([r.answer.verified, r.answer.reason, r.answer.source.nearest], [false, 'unbound-call', 'codex'], JSON.stringify(argv));
  }
});

// Spec r10 "Call binding": turn A (old-model) at B - 30 s, turn B (new-model) at B.
const twoTurns = (t) => storeWith(t, { lines: (id) => [sessionMeta(id), turnContext('old-model', iso(B - 30_000)), turnContext('new-model', iso(B))] });
test('adopted later-born child never verifies a newer turn', (t) => {
  const { env } = twoTurns(t);
  // Turn A's helper (pid 1) started at B - 20 s; the old shell (pid 2, gone) after it; the
  // child (pid 7) was born after turn B's record and is now adopted by the helper.
  const adopted = resolve(env, fakeOps({ chain: [row(8, 7, 'node', '2600'), row(7, 1, 'sh', '2500')], init: row(1, 0, 'codex', '1000'), argv: HELPER_ARGV,
    starts: { 1: { lo: B - 20_000, hi: B - 20_000 }, 7: { lo: B + 5000, hi: B + 5000 }, 8: { lo: B + 6000, hi: B + 6000 } } }), { startPid: 8 }).answer;
  assert.equal(adopted.verified, false);
  assert.ok(['earlier-turn', 'unbound-call'].includes(adopted.reason), adopted.reason);
  assert.equal(adopted.source.nearest, 'codex');
});
test('an adopter that started after its child never verifies', (t) => {
  const { env } = twoTurns(t);
  // pid 1 started after the process directly below it: it cannot be that process's original helper.
  const sandboxed = resolve(env, fakeOps({ chain: [row(8, 7, 'node', '2600'), row(7, 1, 'sh', '2500')], init: row(1, 0, 'codex', '2550'), argv: HELPER_ARGV,
    starts: { 1: { lo: B + 5500, hi: B + 5500 } } }), { startPid: 8 }).answer;
  assert.deepEqual([sandboxed.verified, sandboxed.reason, sandboxed.source.nearest], [false, 'unbound-call', 'codex']);
  const harness = resolve(env, fakeOps({ chain: [row(30, 20, 'node', '2600'), row(20, 10, 'bash', '2500'), row(10, 5, 'codex', '2550')] })).answer;
  assert.deepEqual([harness.verified, harness.reason, harness.source.nearest], [false, 'unbound-call', 'codex']);
});
test('fresh helper and shell in the turn still verify', (t) => {
  const { env, thread, rollout } = twoTurns(t);
  const control = resolve(env, fakeOps({ chain: [row(9, 2, 'node', '1320'), row(2, 1, 'bash', '1303')], init: row(1, 0, 'codex', '1300'), argv: HELPER_ARGV,
    starts: { 1: { lo: B + 3000, hi: B + 3000 }, 2: { lo: B + 3030, hi: B + 3030 }, 9: { lo: B + 3200, hi: B + 3200 } } }), { startPid: 9 }).answer;
  assert.equal(control.verified, true);
  assert.equal(control.agent, 'codex/new-model@high');
  assert.deepEqual(control.source, { thread, nearest: 'codex', rollout });
});
test('nearest names the other harness', (t) => {
  const { env } = storeWith(t);
  const r = resolve(env, fakeOps({ chain: [row(30, 20, 'node'), row(20, 10, 'claude'), row(10, 5, 'codex')] })).answer;
  assert.deepEqual([r.reason, r.source.nearest], ['not-under-codex', 'claude-code']);
  const agy = resolve(env, fakeOps({ chain: [row(30, 20, 'node'), row(20, 10, 'agy'), row(10, 5, 'codex')] })).answer;
  assert.equal(agy.source.nearest, 'agy');
});
test('nearest is null without a harness', (t) => {
  const { env, thread } = storeWith(t);
  const r = resolve(env, fakeOps({ chain: [row(30, 20, 'node'), row(20, 2, 'bash')] })).answer;
  assert.deepEqual([r.reason, r.source], ['not-under-codex', { thread, nearest: null }]);
});
test('no-thread has no nearest', (t) => {
  const { env } = storeWith(t);
  assert.deepEqual(resolve({ CODEX_HOME: env.CODEX_HOME }, fakeOps()).answer.source, {});
});
test('no-thread does not require a supported process platform', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  t.after(() => Object.defineProperty(process, 'platform', descriptor));
  Object.defineProperty(process, 'platform', { value: 'freebsd' });
  assert.equal(resolveCodexModel({ env: {} }).answer.reason, 'no-thread');
});
test('later unverified answers carry nearest codex', (t) => {
  const { env, thread } = storeWith(t);
  const near = (e, ops = fakeOps(), extra) => { const a = resolve(e, ops, extra).answer; return [a.reason, a.source.nearest]; };
  assert.deepEqual(near(env, fakeOps({ start: { lo: B - 3000, hi: B - 2000 } })), ['earlier-turn', 'codex']);
  assert.deepEqual(near(env, fakeOps({ start: { lo: B - 500, hi: B - 400 } })), ['turn-boundary', 'codex']);
  assert.deepEqual(near({ ...env, CODEX_THREAD_ID: threadAt(B - 1) }), ['no-rollout', 'codex']);
  const two = storeWith(t);
  two.store.day(dayOf(two.thread, 'UTC'), two.thread, [sessionMeta(two.thread)], { stamp: '2026-10-17T07-00-00' });
  assert.deepEqual(near(two.env), ['ambiguous-rollout', 'codex']);
  const none = storeWith(t, { lines: (id) => [sessionMeta(id), record('event_msg', {})] });
  assert.deepEqual(near(none.env), ['no-turn-context', 'codex']);
  const pad = record('event_msg', { pad: 'z'.repeat(600) });
  const far = storeWith(t, { lines: (id) => [sessionMeta(id), turnContext('m', iso(B)), pad, pad] });
  assert.deepEqual(near(far.env, fakeOps(), { scanLimit: 1024 }), ['scan-limit', 'codex']);
  assert.equal(thread.length, 36);
});
test('existing keys keep their order', (t) => {
  const { env } = storeWith(t);
  for (const answer of [resolve(env, fakeOps()).answer, resolve({}, fakeOps()).answer, resolve(env, fakeOps({ start: { lo: B - 3000, hi: B - 2000 } })).answer])
    assert.deepEqual(Object.keys(answer), ['verified','agent','harness','model','effort','effortReason','reason','source']);
});
test('unverified reasons, each with its detail', (t) => {
  const { env, thread, rollout } = storeWith(t);
  const reason = (e, ops = fakeOps(), extra) => resolve(e, ops, extra);
  assert.equal(reason({ CODEX_HOME: env.CODEX_HOME }).answer.reason, 'no-thread');
  assert.equal(reason({ ...env, CODEX_THREAD_ID: '' }).answer.reason, 'no-thread');
  const claude = reason(env, fakeOps({ chain: [row(30, 20, 'node'), row(20, 10, 'claude'), row(10, 5, 'codex')] }));
  assert.equal(claude.answer.reason, 'not-under-codex'); assert.match(claude.detail ?? '', /claude-code/);
  assert.equal(reason(env, fakeOps({ chain: [row(30, 20, 'node'), row(20, 2, 'bash')] })).answer.reason, 'not-under-codex');
  assert.deepEqual(reason({ ...env, CODEX_THREAD_ID: threadAt(B - 1) }).answer, { verified: false, agent: 'codex', harness: 'codex', model: null, effort: null, effortReason: null, reason: 'no-rollout', source: { thread: threadAt(B - 1), nearest: 'codex' } });
  const early = reason(env, fakeOps({ start: { lo: B - 3000, hi: B - 2000 } }));
  assert.deepEqual([early.answer.reason, early.answer.source.rollout, early.answer.source.thread], ['earlier-turn', rollout, thread]);
  assert.equal(reason(env, fakeOps({ start: { lo: B - 500, hi: B - 400 } })).answer.reason, 'turn-boundary');
});
test('ambiguous, absent and out-of-range turn records', (t) => {
  const two = storeWith(t);
  two.store.day(dayOf(two.thread, 'UTC'), two.thread, [sessionMeta(two.thread)], { stamp: '2026-10-17T07-00-00' });
  assert.equal(resolve(two.env, fakeOps()).answer.reason, 'ambiguous-rollout');
  const none = storeWith(t, { lines: (id) => [sessionMeta(id), record('event_msg', {})] });
  assert.equal(resolve(none.env, fakeOps()).answer.reason, 'no-turn-context');
  const pad = record('event_msg', { pad: 'z'.repeat(600) });
  const far = storeWith(t, { lines: (id) => [sessionMeta(id), turnContext('m', iso(B)), pad, pad] });
  assert.equal(resolve(far.env, fakeOps(), { scanLimit: 1024 }).answer.reason, 'scan-limit');
});
test('failures: a malformed thread id, a relative store, a rollout that is not the thread\'s', (t) => {
  const { env } = storeWith(t);
  for (const id of ['bogus', '01A14985-3A99-7E12-9643-455088B7D4EC', '01a14985-3a99-4e12-9643-455088b7d4ec'])
    assert.throws(() => resolve({ ...env, CODEX_THREAD_ID: id }, fakeOps()), { code: 'INVALID_INPUT' }, id);
  assert.throws(() => resolve({ ...env, CODEX_HOME: 'relative' }, fakeOps()), { code: 'INVALID_CONFIG' });
  const foreign = storeWith(t, { lines: () => [sessionMeta('someone-else'), turnContext('m', iso(B))] });
  assert.throws(() => resolve(foreign.env, fakeOps()), { code: 'INVALID_ROLLOUT' });
});

// The real process helper with injected Linux clocks: sampling pauses and clock steps.
// The call process (pid 20) started at uptime 100 s; the command runs at uptime 130 s; the
// host booted at wall time BOOT, so with no step the wall clock reads BOOT + uptime.
const BOOT = B - 200_000;
const stat = (pid, comm, ppid, ticks) => `${pid} (${comm}) ${['S', ppid, ...Array(13).fill(0), 20, 0, 1, 0, ticks, 0].join(' ')}\n`;
const linuxHost = ({ uptimeMs = 130_000, wall }) => {
  const procs = { 30: stat(30, 'node', 20, 12_900), 20: stat(20, 'bash', 10, 10_000), 10: stat(10, 'codex', 1, 100), 1: stat(1, 'systemd', 0, 1) };
  const reads = [...wall];
  return createProcessOps({ platform: 'linux', now: () => /** @type {number} */ (reads.shift()),
    readLink: () => '/usr/bin/x',
    readText: (p) => {
      if (p === '/proc/uptime') return `${(uptimeMs / 1000).toFixed(2)} 0.00\n`;
      const pid = /^\/proc\/([0-9]+)\/stat$/.exec(p)?.[1];
      if (pid && procs[pid]) return procs[pid];
      throw Object.assign(new Error('absent'), { code: 'ENOENT' });
    } });
};
const cases = [
  // name, turn record (ms after BOOT), uptime at the sample, wall clock at [w0, w1] (ms after BOOT), expected
  ['current call', 98_000, 130_000, [130_000, 130_000], 'verified'],
  ['leftover from the previous turn', 101_500, 130_000, [130_000, 130_000], 'earlier-turn'],
  ['started 500 ms before the record', 100_500, 130_000, [130_000, 130_000], 'turn-boundary'],
  ['1.2 s pause after the uptime read, started 100 ms before', 100_100, 130_000, [130_000, 131_200], 'turn-boundary'],
  ['1.2 s pause before the uptime read, started 100 ms before', 100_100, 131_200, [130_000, 131_200], 'turn-boundary'],
  ['forward step of 900 ms, leftover', 101_500, 130_000, [130_900, 130_900], 'turn-boundary'],
  ['backward step of 900 ms, current call 1.2 s after the record', 98_800, 130_000, [129_100, 129_100], 'turn-boundary'],
  ['backward step of 900 ms, current call 3 s after the record', 97_000, 130_000, [129_100, 129_100], 'verified'],
  ['backward step of 50 s, leftover', 101_500, 130_000, [80_000, 80_000], 'earlier-turn'],
  ['stated limit: forward step of 2.6 s verifies a leftover with a 1.5 s lead', 101_500, 130_000, [132_600, 132_600], 'verified'],
];
for (const [name, turn, uptimeMs, wall, expected] of cases) {
  test(`Linux clocks: ${name}`, (t) => {
    const { env } = storeWith(t, { turnAt: BOOT + turn });
    const ops = linuxHost({ uptimeMs, wall: wall.map((w) => BOOT + w) });
    const { answer } = resolve(env, ops);
    assert.equal(answer.verified ? 'verified' : answer.reason, expected);
  });
}
test('a chain whose nearest harness is agy is not under codex', (t) => {
  const { env } = storeWith(t);
  const r = resolve(env, fakeOps({ chain: [row(30, 20, 'node'), row(20, 10, 'agy'), row(10, 5, 'codex')] }));
  assert.equal(r.answer.reason, 'not-under-codex'); assert.match(r.detail ?? '', /agy/);
});

test('an empty effort verifies the model without stamping effort', (t) => {
  const { env, thread } = storeWith(t, { lines: (id) => [sessionMeta(id), turnContext('gpt-6-astra', iso(B), '')] });
  const r = resolve(env, fakeOps());
  assert.equal(r.answer.agent, 'codex/gpt-6-astra');
  assert.equal(r.answer.effort, null);
  assert.equal(r.answer.effortReason, 'not-recorded');
  assert.equal(r.detail, `turn_context of thread ${thread} carries no effort`);
});
test('a model with spaces is unstampable despite verified turn evidence', (t) => {
  const { env } = storeWith(t, { lines: (id) => [sessionMeta(id), turnContext('gpt oss', iso(B))] });
  const r = resolve(env, fakeOps());
  assert.equal(r.answer.verified, false);
  assert.equal(r.answer.reason, 'unstampable');
  assert.match(r.detail, /gpt oss/);
});
