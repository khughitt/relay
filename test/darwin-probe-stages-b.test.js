import test from 'node:test';
import assert from 'node:assert/strict';
import { run as d3 } from '../tools/darwin-probe/stages/d3-identity.mjs';
import { run as d4 } from '../tools/darwin-probe/stages/d4-table.mjs';

test('Darwin-only stages refuse to run elsewhere', async () => {
  for (const run of [d3, d4]) assert.deepEqual(await run({ platform: 'linux' }), { status: 'skipped', reason: 'darwin only', observations: {} });
});
