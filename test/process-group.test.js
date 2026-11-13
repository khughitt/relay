import test from 'node:test';
import assert from 'node:assert/strict';
import { containGroup } from '../src/bus/process-group.js';

// containGroup signals a group only when a fresh scan binds it to the recorded leader. These
// fixtures inject membership so a stale or reused group id can be shown never to be signalled.
const leader = { pid: 4242, start: '1000', state: 'S' };
function harness(scans) {
  const signals = [];
  let i = 0;
  return { signals, options: {
    leader, deadline: performance.now() + 200, graceMs: 10, pollMs: 1,
    members: () => scans[Math.min(i++, scans.length - 1)],
    exists: () => signals.length === 0, // the group empties once signalled
    kill: (pid, signal) => signals.push([pid, signal]),
  } };
}

test('a group consistent with the recorded leader is signalled', async () => {
  const { signals, options } = harness([[{ pid: 4300, start: '1200', state: 'S' }]]);
  assert.deepEqual(await containGroup(4242, options), { cleanup: 'complete', survivors: [], signals: 1 });
  assert.deepEqual(signals, [[-4242, 'SIGTERM']]);
});

test('a different process holding the leader pid means a reused group: never signalled', async () => {
  const { signals, options } = harness([[{ pid: 4242, start: '9999', state: 'S' }]]);
  const result = await containGroup(4242, options);
  assert.equal(result.cleanup, 'failed'); assert.deepEqual(signals, []);
});

test('a member started before the leader cannot be its descendant: never signalled', async () => {
  const { signals, options } = harness([[{ pid: 4300, start: '999', state: 'S' }]]);
  assert.equal((await containGroup(4242, options)).cleanup, 'failed'); assert.deepEqual(signals, []);
});

test('a group id other than the leader pid is never signalled', async () => {
  const { signals, options } = harness([[{ pid: 4300, start: '1200', state: 'S' }]]);
  assert.equal((await containGroup(4300, options)).cleanup, 'failed'); assert.deepEqual(signals, []);
});

test('an unreadable membership scan fails without signalling', async () => {
  const { signals, options } = harness([]);
  options.members = () => { throw new Error('unreadable'); };
  assert.equal((await containGroup(4242, options)).cleanup, 'failed'); assert.deepEqual(signals, []);
});

test('the recorded live leader itself may be signalled (dispatcher-side rescue)', async () => {
  const { signals, options } = harness([[{ ...leader }, { pid: 4300, start: '1100', state: 'S' }]]);
  assert.equal((await containGroup(4242, options)).cleanup, 'complete'); assert.deepEqual(signals, [[-4242, 'SIGTERM']]);
});
