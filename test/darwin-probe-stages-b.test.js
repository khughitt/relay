import test from 'node:test';
import assert from 'node:assert/strict';
import { run as d3 } from '../tools/darwin-probe/stages/d3-identity.mjs';
import { commKind, run as d4 } from '../tools/darwin-probe/stages/d4-table.mjs';

test('Darwin-only stages refuse to run elsewhere', async () => {
  for (const run of [d3, d4]) assert.deepEqual(await run({ platform: 'linux' }), { status: 'skipped', reason: 'darwin only', observations: {} });
});
test('comm_kind reads the native and chain parents together', () => {
  // The native parent's argv[0] (9.9.9) is not its path; the chain parent's argv[0] is its path,
  // which is not its basename. Attempt 2's chain alone read argv[0] as "path".
  const chain = '/r/l/xxx/claude', native = '/r/n/claude/versions/9.9.9';
  const kind = (chainComm, nativeComm) => commKind({ chain: { path: chain, comm: chainComm }, native: { path: native, argv0: '9.9.9', comm: nativeComm } });
  assert.equal(kind(chain, '9.9.9'), 'argv0');
  assert.equal(kind(chain, native), 'path');
  assert.equal(kind('claude', '9.9.9'), 'basename');
  assert.equal(kind(chain, 'node'), 'other');
  assert.equal(kind('claud', '9.9.9'), 'other');
});
