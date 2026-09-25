import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertClean, shallowBundle } from '../tools/darwin-probe/bundle.mjs';

const repo = (t) => { const d = mkdtempSync(join(tmpdir(), 'dpb-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', d]); writeFileSync(join(d, 'f'), 'x');
  execFileSync('git', ['-C', d, '-c', 'user.email=p@example.invalid', '-c', 'user.name=p', 'add', '.']);
  execFileSync('git', ['-C', d, '-c', 'user.email=p@example.invalid', '-c', 'user.name=p', 'commit', '-qm', 'x']); return d; };
test('a dirty checkout is refused', (t) => {
  const d = repo(t); assertClean(d); writeFileSync(join(d, 'f'), 'y');
  assert.throws(() => assertClean(d), /dirty/);
});
test('a shallow bundle clones back to the same clean commit', (t) => {
  const d = repo(t), out = mkdtempSync(join(tmpdir(), 'dpo-')); t.after(() => rmSync(out, { recursive: true, force: true }));
  const commit = shallowBundle(d, join(out, 'r.bundle'));
  execFileSync('git', ['clone', '-q', join(out, 'r.bundle'), join(out, 'c')]);
  assert.equal(execFileSync('git', ['-C', join(out, 'c'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), commit);
});
