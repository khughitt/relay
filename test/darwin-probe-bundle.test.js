import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertClean, gitBundle, packDependencies } from '../tools/darwin-probe/bundle.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const repo = (t) => { const d = mkdtempSync(join(tmpdir(), 'dpb-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', d]); writeFileSync(join(d, 'f'), 'x');
  execFileSync('git', ['-C', d, '-c', 'user.email=p@example.invalid', '-c', 'user.name=p', 'add', '.']);
  execFileSync('git', ['-C', d, '-c', 'user.email=p@example.invalid', '-c', 'user.name=p', 'commit', '-qm', 'x']); return d; };
test('a dirty checkout is refused', (t) => {
  const d = repo(t); assertClean(d); writeFileSync(join(d, 'f'), 'y');
  assert.throws(() => assertClean(d), /dirty/);
});
test('a Git bundle clones back to the same clean commit', (t) => {
  const d = repo(t), out = mkdtempSync(join(tmpdir(), 'dpo-')); t.after(() => rmSync(out, { recursive: true, force: true }));
  const commit = gitBundle(d, join(out, 'r.bundle'));
  execFileSync('git', ['clone', '-q', join(out, 'r.bundle'), join(out, 'c')]);
  assert.equal(execFileSync('git', ['-C', join(out, 'c'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), commit);
});
// relay's runtime dependency is no longer bundled: the Mac's offline D1 install needs its tarball beside relay's.
test('relay\'s runtime dependencies are packed at the lock\'s version', { timeout: 30000 }, (t) => {
  const out = mkdtempSync(join(tmpdir(), 'dpd-')); t.after(() => rmSync(out, { recursive: true, force: true }));
  assert.deepEqual(packDependencies(ROOT, out), ['jsonc-parser-3.3.1.tgz']);
  assert.ok(existsSync(join(out, 'jsonc-parser-3.3.1.tgz')));
});
test('a dependency whose installed version differs from the lock is refused', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dpl-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'r', version: '0.0.0', dependencies: { 'jsonc-parser': '^3.3.1' } }));
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/jsonc-parser': { version: '9.9.9' } } }));
  mkdirSync(join(d, 'node_modules/jsonc-parser'), { recursive: true });
  writeFileSync(join(d, 'node_modules/jsonc-parser/package.json'), JSON.stringify({ name: 'jsonc-parser', version: '3.3.1' }));
  assert.throws(() => packDependencies(d, d), /jsonc-parser 3\.3\.1 does not match the lock's 9\.9\.9/);
});
