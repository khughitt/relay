import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessOps } from '../src/bus/proc.js';
import { bindTurn, chainWithInit, resolveCodexModel, CLOCK_ALLOWANCE_MS } from '../src/adapters/codex-model.js';
import { dayOf } from '../src/adapters/codex-rollout.js';
import { tempStore, threadAt, record, sessionMeta, turnContext } from './helpers/codex-store.js';

const B = Date.parse('2026-10-17T10:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const row = (pid, ppid, comm) => ({ pid, ppid, comm, tty: null, starttime: '1', state: 'S' });
const UNDER_CODEX = [row(30, 20, 'node'), row(20, 10, 'bash'), row(10, 5, 'codex')];
const fakeOps = ({ chain = UNDER_CODEX, init = null, start = { lo: B + 5000, hi: B + 5000 } } = {}) => ({
  ancestors: () => chain.map((r) => ({ ...r })), recordOf: (pid) => (pid === 1 ? init : null),
  executableOf: () => { throw new Error('executable must not be read'); }, startedAtMs: () => start });
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
  assert.deepEqual(resolve(env, fakeOps()), { answer: { verified: true, agent: 'codex/gpt-6-astra', harness: 'codex', model: 'gpt-6-astra', effort: 'high', thread, rollout, reason: null }, detail: null });
});
test('the sandbox: a codex at pid 1 is the harness and the process below it is the call', (t) => {
  const { env } = storeWith(t);
  const ops = fakeOps({ chain: [row(3, 2, 'node'), row(2, 1, 'bash')], init: row(1, 0, 'codex') });
  assert.equal(resolve(env, ops, { startPid: 3 }).answer.agent, 'codex/gpt-6-astra');
  const host = fakeOps({ chain: [row(3, 2, 'node'), row(2, 1, 'bash')], init: row(1, 0, 'systemd') });
  assert.equal(resolve(env, host, { startPid: 3 }).answer.reason, 'not-under-codex');
});
test('unverified reasons, each with its detail', (t) => {
  const { env, thread, rollout } = storeWith(t);
  const reason = (e, ops = fakeOps(), extra) => resolve(e, ops, extra);
  assert.equal(reason({ CODEX_HOME: env.CODEX_HOME }).answer.reason, 'no-thread');
  assert.equal(reason({ ...env, CODEX_THREAD_ID: '' }).answer.reason, 'no-thread');
  const claude = reason(env, fakeOps({ chain: [row(30, 20, 'node'), row(20, 10, 'claude'), row(10, 5, 'codex')] }));
  assert.equal(claude.answer.reason, 'not-under-codex'); assert.match(claude.detail ?? '', /claude-code/);
  assert.equal(reason(env, fakeOps({ chain: [row(30, 20, 'node'), row(20, 2, 'bash')] })).answer.reason, 'not-under-codex');
  assert.deepEqual(reason({ ...env, CODEX_THREAD_ID: threadAt(B - 1) }).answer, { verified: false, agent: 'codex', harness: 'codex', model: null, effort: null, thread: threadAt(B - 1), rollout: null, reason: 'no-rollout' });
  const early = reason(env, fakeOps({ start: { lo: B - 3000, hi: B - 2000 } }));
  assert.deepEqual([early.answer.reason, early.answer.rollout, early.answer.thread], ['earlier-turn', rollout, thread]);
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
