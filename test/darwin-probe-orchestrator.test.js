import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { cloneBundle, stableVerdict, verifyManifest } from '../tools/darwin-probe/probe.mjs';

test('a tampered bundle file fails manifest verification', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, 'a.txt'), 'x');
  const manifest = { files: { 'a.txt': '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881' } };
  assert.deepEqual(verifyManifest(d, manifest), []);
  writeFileSync(join(d, 'a.txt'), 'y');
  assert.deepEqual(verifyManifest(d, manifest), ['a.txt']);
});
test('verdicts compare on stable fields only', () => {
  const v = { release: 'pass', cutover: { codex: 'absent' }, checks: { D0: { class: 'release', verdict: 'pass', detail: 'x', findings: ['a'] } } };
  assert.deepEqual(stableVerdict(v), stableVerdict({ ...v, checks: { D0: { ...v.checks.D0, detail: 'y', findings: [] } } }));
  assert.notDeepEqual(stableVerdict(v), stableVerdict({ ...v, release: 'fail' }));
});
test('a bundle verifies and clones outside any repository', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const src = join(d, 'src'); execFileSync('git', ['init', '-q', src]); writeFileSync(join(src, 'f'), 'x');
  const g = (...a) => execFileSync('git', ['-C', src, '-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { encoding: 'utf8' }).trim();
  g('add', '.'); g('commit', '-qm', 'x'); g('bundle', 'create', join(d, 'r.bundle'), 'HEAD', g('rev-parse', '--abbrev-ref', 'HEAD'));
  const out = join(d, 'nowhere'); mkdirSync(out);
  assert.equal(execFileSync('git', ['-C', cloneBundle(join(d, 'r.bundle'), join(out, 'c'), g('rev-parse', 'HEAD')), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), g('rev-parse', 'HEAD'));
});
test('SIGINT after a normal D0 packs results, fills D0, and leaves no grandchild', { timeout: 90000 }, async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  // --self-test-hang runs the real D0, then a stage that respawns `sh` (with two sleeps)
  // whenever it dies, which is the race between cleanup and a resuming stage.
  const child = spawn(process.execPath, ['tools/darwin-probe/probe.mjs', '--self-test-hang', '--root', join(d, 'root'), '--bundle', d], { stdio: 'ignore' });
  const exited = new Promise((r) => child.once('exit', r)); // registered now, so an early exit is not missed
  const ps = () => execFileSync('/bin/ps', ['-axo', 'args='], { encoding: 'utf8' });
  for (let i = 0; i < 100 && child.exitCode === null && !ps().includes('sleep 600.654'); i++) await new Promise((r) => setTimeout(r, 200));
  assert.equal(child.exitCode, null, 'the probe exited before the interrupt');
  child.kill('SIGINT');
  assert.equal(await exited, 130);
  const tarball = readdirSync(d).find((f) => f.startsWith('relay-darwin-results-'));
  assert.ok(tarball);
  // `--numeric-owner` at pack time keeps the Mac account's user and group name out of
  // every archive header, not only the files it contains.
  const listing = execFileSync('tar', ['tvzf', join(d, tarball)], { encoding: 'utf8' });
  const groupname = execFileSync('id', ['-gn'], { encoding: 'utf8' }).trim();
  assert.equal(listing.includes(userInfo().username), false, 'tar header carries the username');
  assert.equal(listing.includes(groupname), false, 'tar header carries the group name');
  const x = join(d, 'x'); mkdirSync(x); execFileSync('tar', ['xzf', join(d, tarball), '-C', x]);
  const d0 = JSON.parse(readFileSync(join(x, 'stages/D0.json'), 'utf8'));
  assert.equal(d0.status, 'ran'); assert.ok(d0.observations.hosts.end);
  assert.ok(JSON.parse(readFileSync(join(x, 'verdict.redacted.json'), 'utf8')).checks.D0);
  assert.deepEqual(JSON.parse(readFileSync(join(x, 'manifest.json'), 'utf8')).cleanup.survivors, []);
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(ps().includes('sleep 600.321'), false); assert.equal(ps().includes('sleep 600.654'), false);
  for (const f of ['verdict.raw.json', 'verdict.redacted.json', 'manifest.json']) assert.equal(readFileSync(join(x, f), 'utf8').includes(homedir()), false, f);
});
