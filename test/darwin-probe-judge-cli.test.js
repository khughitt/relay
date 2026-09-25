import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSection, crossCheck } from '../tools/darwin-probe/judge-cli.mjs';
import { judge } from '../tools/darwin-probe/judge.mjs';
import { passingResults } from './helpers/darwin-results.js';
test('the section names commits, versions, every check and the findings', () => {
  const r = passingResults(), s = renderSection(r, judge(r));
  for (const needle of ['aaaaaaa', '15.6', 'arm64', '2.1.282', '| D5 | release | pass |', 'zombie', 'Cutover']) assert.ok(s.includes(needle), needle);
});
test('any verdict disagreement is refused', () => {
  const r = passingResults(), v = judge(r);
  assert.deepEqual(crossCheck(r, v, v), []);
  assert.deepEqual(crossCheck(r, v, { ...v, release: 'fail' }), ['verdict.redacted.json disagrees with the recomputed verdict']);
});
test('a pipe in a detail is escaped so it cannot split the table row', () => {
  const r = passingResults(), v = judge(r);
  v.checks.D1 = { ...v.checks.D1, detail: 'failed: a|b' };
  assert.ok(renderSection(r, v).includes('| D1 | release | pass | failed: a\\|b |'));
});

// The CLI end to end, as a child process: a results tarball built here, an ops repository
// holding bin/relay-guard-probe, a cwd with the runbook, and TMPDIR pointed at an empty
// directory so the extraction directory's cleanup is observable.
const CLI = fileURLToPath(new URL('../tools/darwin-probe/judge-cli.mjs', import.meta.url));
const RUNBOOK = '# Darwin live probe\n\n## Attempts\n';
function scene(t, { mutate = () => {}, runbook = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'dpj-test-')); t.after(() => rmSync(base, { recursive: true, force: true }));
  const ops = join(base, 'ops'), g = (...a) => execFileSync('git', ['-C', ops, '-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { encoding: 'utf8' }).trim();
  mkdirSync(join(ops, 'bin'), { recursive: true }); execFileSync('git', ['init', '-q', ops]);
  writeFileSync(join(ops, 'bin/relay-guard-probe'), 'def proven(summary, evidence):\n    return True\n');
  g('add', '.'); g('commit', '-qm', 'probe');
  const r = passingResults({ platform: 'linux' }); r.manifest.ops_commit = g('rev-parse', 'HEAD');
  const v = judge(r), files = { 'manifest.json': r.manifest, 'verdict.raw.json': v, 'verdict.redacted.json': v,
    ...Object.fromEntries(Object.values(r.stages).map((s) => [`stages/${s.id}.json`, s])) };
  mutate(files);
  const res = join(base, 'res'); mkdirSync(join(res, 'stages'), { recursive: true });
  for (const [f, body] of Object.entries(files)) if (body !== undefined) writeFileSync(join(res, f), JSON.stringify(body));
  const tarball = join(base, 'results.tar.gz'); execFileSync('tar', ['czf', tarball, '-C', res, '.']);
  const cwd = join(base, 'cwd'), tmp = join(base, 'tmp'); mkdirSync(tmp); mkdirSync(join(cwd, 'docs/runbooks'), { recursive: true });
  if (runbook) writeFileSync(join(cwd, 'docs/runbooks/darwin-probe.md'), RUNBOOK);
  const run = (args = ['--tarball', tarball, '--ops', ops]) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, TMPDIR: tmp } });
  return { run, cwd, tmp, ops, tarball };
}
const oneLine = (r) => { assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr); assert.doesNotMatch(r.stderr, /\n\s+at /); };
test('a clean tarball is judged, recorded, and leaves no extraction directory', (t) => {
  const s = scene(t), r = s.run();
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'release: smoke\n');
  assert.match(readFileSync(join(s.cwd, 'docs/runbooks/darwin-probe.md'), 'utf8'), /## Attempt .* \(smoke\)/);
  assert.equal(JSON.parse(readFileSync(join(s.cwd, 'docs/runbooks/darwin-evidence.json'), 'utf8')).verdict.release, 'smoke');
  assert.deepEqual(readdirSync(s.tmp), []);
});
test('a tampered verdict is rejected with exit 1, nothing recorded, and the extraction removed', (t) => {
  const s = scene(t, { mutate: (f) => { f['verdict.redacted.json'] = { ...f['verdict.redacted.json'], release: 'pass' }; } }), r = s.run();
  assert.equal(r.status, 1); assert.equal(r.stderr, 'verdict.redacted.json disagrees with the recomputed verdict\n');
  assert.equal(readFileSync(join(s.cwd, 'docs/runbooks/darwin-probe.md'), 'utf8'), RUNBOOK);
  assert.ok(!existsSync(join(s.cwd, 'docs/runbooks/darwin-evidence.json')));
  assert.deepEqual(readdirSync(s.tmp), []);
});
for (const [name, opts, status, pattern] of [
  ['no runbook in the cwd', { runbook: false }, 2, /docs\/runbooks\/darwin-probe\.md not found/],
  ['a missing verdict file', { mutate: (f) => { f['verdict.raw.json'] = undefined; } }, 1, /verdict\.raw\.json/],
  ['a malformed verdict file', { mutate: (f) => { f['verdict.raw.json'] = { schema: 1 }; } }, 1, /verdict\.raw\.json is malformed/],
  ['an older results schema', { mutate: (f) => { f['manifest.json'] = { ...f['manifest.json'], schema: 0 }; } }, 1, /schema 0/],
  ['a missing manifest', { mutate: (f) => { f['manifest.json'] = undefined; } }, 1, /manifest\.json/],
]) {
  test(`${name} fails with one line (exit ${status}) and leaves no extraction directory`, (t) => {
    const s = scene(t, opts), r = s.run();
    assert.equal(r.status, status, r.stderr); oneLine(r); assert.match(r.stderr, pattern); assert.deepEqual(readdirSync(s.tmp), []);
  });
}
test('operator mistakes in the arguments and environment fail with one line and exit 2', (t) => {
  const s = scene(t);
  for (const [args, pattern] of [
    [['--ops', s.ops], /usage/],
    [['--tarball', s.tarball], /usage/],
    [['--tarball', s.tarball, '--ops', s.ops, '--bogus'], /bogus/],
    [['--tarball', join(s.cwd, 'nope.tar.gz'), '--ops', s.ops], /tarball not found/],
    [['--tarball', s.tarball, '--ops', join(s.cwd, 'no-ops')], /bin\/relay-guard-probe/],
  ]) {
    const r = s.run(args);
    assert.equal(r.status, 2, `${args}: ${r.stderr}`); oneLine(r); assert.match(r.stderr, pattern);
  }
  assert.deepEqual(readdirSync(s.tmp), []);
});
test('an unreadable tarball is rejected with one line (exit 1)', (t) => {
  const s = scene(t); writeFileSync(s.tarball, 'not a tarball');
  const r = s.run(); assert.equal(r.status, 1); oneLine(r); assert.match(r.stderr, /cannot extract/); assert.deepEqual(readdirSync(s.tmp), []);
});
