import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedEnv, prepareRoot, tracker } from '../tools/darwin-probe/lib/context.mjs';
import { run as d5 } from '../tools/darwin-probe/stages/d5-registry.mjs';
import { run as d8 } from '../tools/darwin-probe/stages/d8-launchd.mjs';
import { parentRowCut } from '../tools/darwin-probe/lib/fleet.mjs';

const ctxFor = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dp-')); prepareRoot(root);
  const tr = tracker(root); t.after(async () => { await tr.killAll(); rmSync(root, { recursive: true, force: true }); });
  return { root, env: isolatedEnv(root), t: tr, clone: process.cwd(), platform: process.platform, log: () => {} };
};
// Each stage records relay's own reading of one constructed parent, stripped of argument text.
const assertParentCapture = (c, label) => {
  assert.equal(c.label, label); assert.ok(c.forms.row.relay, 'relay read no row for the parent');
  assert.equal(parentRowCut(c), false); assert.equal(c.forms.args.relay, undefined);
};
test('a cut constructed-parent row is detected', () => {
  assert.equal(parentRowCut({ forms: { row: { truncated: true } } }), true);
  assert.equal(parentRowCut({ forms: { row: { truncated: false } } }), false);
});
test('D5 on this host: eight publishers, lock recovery, exact reap, SessionEnd mutation', { timeout: 180000 }, async (t) => {
  const o = (await d5(ctxFor(t))).observations;
  assert.equal(o.concurrent.present, 8); assert.ok(o.concurrent.handles_match);
  assertParentCapture(o.parent_capture, 'd5-parent');
  assert.ok(o.lock.recovered);
  assert.deepEqual(o.reap.removed.sort(), o.reap.expected_removed.sort());
  const s = o.cost.n10.sessionend;
  assert.equal(s.exit, 0); assert.equal(s.stderr, ''); assert.ok(s.ending_absent); assert.equal(s.revision_delta, 1); assert.ok(s.others_retained);
});
test('D8 reap keeps exactly the live half of its own fleet', { timeout: 120000 }, async (t) => {
  const o = (await d8(ctxFor(t))).observations;
  assertParentCapture(o.parent_capture, 'd8-parent');
  assert.equal(o.reap.exit, 0); assert.deepEqual(o.reap.kept.sort(), o.reap.expected_kept.sort()); assert.ok(o.reap.handles_unchanged);
  // A PreToolUse deny under claude-code always exits 2 (src/adapters/reply.js:
  // encodeStandardReply writes the refusal "as exit 2 with the reason on stderr"); the deny
  // is what `denied` checks.
  assert.equal(o.hook_path.exit, 2); assert.equal(o.hook_path.denied, true);
});
