import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedEnv, prepareRoot, tracker } from '../tools/darwin-probe/lib/context.mjs';
import { replay } from '../tools/darwin-probe/stages/d6-dispatch.mjs';
test('replay: allow, deny and a hung guard for both harnesses; the hung guard is killed', { timeout: 60000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dp-')); prepareRoot(root); const tr = tracker(root);
  t.after(async () => { await tr.killAll(); rmSync(root, { recursive: true, force: true }); });
  const rows = await replay({ root, env: isolatedEnv(root), t: tr, clone: process.cwd() });
  assert.equal(rows.length, 6);
  for (const r of rows.filter((x) => x.guard === 'hang')) { assert.deepEqual(r.survivors, []); assert.ok(r.ms < 5000); }
  assert.ok(rows.find((x) => x.harness === 'claude-code' && x.guard === 'deny').stdout.includes('deny'));
});
