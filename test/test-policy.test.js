import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('..', import.meta.url));
const policy = 'automatic_broad = false\nbroad_targets = ["test", "test-fast", "check-code"]\n';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'relay-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'home'));
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: join(root, 'home'), USER: 'fixture',
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', TT_LOG: join(root, 'runs.jsonl') };
  assert.equal(env.TT_FORCE, undefined);
  assert.equal(env.GITHUB_ACTIONS, undefined);
  const run = (cmd, args, extra = {}, input) => spawnSync(cmd, args, { cwd: root, env: { ...env, ...extra }, input, encoding: 'utf8', timeout: 15000 });
  assert.equal(run('git', ['init', '-q', '-b', 'main']).status, 0);
  assert.equal(run('git', ['rev-parse', '--show-toplevel']).stdout.trim(), root);
  assert.ok(resolve(run('git', ['rev-parse', '--absolute-git-dir']).stdout.trim()).startsWith(root + '/'));
  mkdirSync(join(root, 'tools')); mkdirSync(join(root, '.githooks'));
  copyFileSync(join(source, 'tools/tt'), join(root, 'tools/tt'));
  copyFileSync(join(source, '.githooks/pre-push'), join(root, '.githooks/pre-push'));
  let justfile = readFileSync(join(source, 'justfile'), 'utf8');
  const marker = (label) => `${JSON.stringify(process.execPath)} marker.mjs ${label}`;
  const commands = { fast_cmd: marker('test'), test_cmd: marker('test'), one_cmd: marker('one'),
    check_cmd: `${marker('hygiene')} && ${marker('code')}`, check_hygiene_cmd: marker('hygiene'),
    check_code_cmd: marker('code'), ci_hygiene_cmd: marker('ci-hygiene') };
  for (const [key, value] of Object.entries(commands))
    justfile = justfile.replace(new RegExp(`^${key} := .*`, 'm'), `${key} := ${JSON.stringify(value)}`);
  // Task 1 is independently testable before Task 2 declares actual remote coverage.
  if (!/^ci_remote :=/m.test(justfile)) justfile += '\nci_remote := "origin"\nci_suite_refs := "refs/heads/*"\n';
  writeFileSync(join(root, 'justfile'), justfile);
  writeFileSync(join(root, 'marker.mjs'), `import {appendFileSync} from 'node:fs';
const [label,...args]=process.argv.slice(2);
appendFileSync('markers.jsonl',JSON.stringify([label,...args])+'\\n');
if(process.env.FAIL_AT===label) process.exit(7);
`);
  return { root, env, run, just: (args, extra) => run('just', args, extra),
    off: () => writeFileSync(join(root, '.tt.toml'), policy),
    markers: () => existsSync(join(root, 'markers.jsonl')) ? readFileSync(join(root, 'markers.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [],
    rows: () => readFileSync(env.TT_LOG, 'utf8').trim().split('\n').map(JSON.parse) };
}
for (const enabled of [undefined, true, false]) test(`hook preserves hygiene with policy ${enabled}`, (t) => {
  const f = fixture(t);
  if (enabled !== undefined) { f.off(); if (enabled) writeFileSync(join(f.root, '.tt.toml'), policy.replace('false', 'true')); }
  assert.equal(f.just(['hook-pre-push']).status, 0);
  assert.deepEqual(f.markers(), enabled === false ? [['hygiene']] : [['hygiene'], ['code'], ['test']]);
  if (enabled === false) {
    assert.equal(f.env.TT_FORCE, undefined); assert.equal(f.env.GITHUB_ACTIONS, undefined);
    assert.equal(f.just(['test-fast']).status, 0);
    const skipped = f.rows().filter((r) => r.execution === 'skipped');
    assert.deepEqual(skipped.map((r) => r.target).sort(), ['check-code', 'test', 'test-fast']);
    for (const r of skipped) for (const key of ['exit', 'tests', 'selection', 'slowest']) assert.equal(r[key], null);
  }
});
for (const [label, expected] of [['hygiene', [['hygiene']]], ['code', [['hygiene'], ['code']]]])
  test(`failed ${label} stops the push chain`, (t) => {
    const f = fixture(t); assert.notEqual(f.just(['hook-pre-push'], { FAIL_AT: label }).status, 0);
    assert.deepEqual(f.markers(), expected);
  });
test('pre-commit retains hygiene and skips only types', (t) => {
  const f = fixture(t); f.off(); assert.equal(f.just(['hook-pre-commit']).status, 0);
  assert.deepEqual(f.markers(), [['hygiene']]);
  assert.deepEqual(f.rows().map((r) => [r.target, r.execution]), [['hook-pre-commit', 'ran'], ['check-code', 'skipped']]);
});
test('focused arguments remain intact and force alias propagates failure once', (t) => {
  const f = fixture(t); f.off();
  assert.equal(f.just(['test-one', '--test-name-pattern', 'a spaced pattern', 'file with spaces.js']).status, 0);
  assert.deepEqual(f.markers(), [['one', '--test-name-pattern', 'a spaced pattern', 'file with spaces.js']]);
  assert.notEqual(f.just(['test-full'], { FAIL_AT: 'test' }).status, 0);
  const rows = f.rows().filter((r) => r.target === 'test');
  assert.equal(rows.length, 1); assert.equal(rows[0].exit, 7); assert.equal(rows[0].execution_reason, 'forced');
});
test('hosted missing force refuses direct and nested skips; force propagates failure', (t) => {
  const f = fixture(t); f.off();
  for (const target of ['test', 'gate']) {
    const r = f.just([target], { GITHUB_ACTIONS: 'true' });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /TT_FORCE=1/);
  }
  assert.ok(f.markers().every(([label]) => label === 'hygiene'));
  assert.notEqual(f.just(['gate'], { GITHUB_ACTIONS: 'true', TT_FORCE: '1', FAIL_AT: 'test' }).status, 0);
  assert.ok(f.rows().every((r) => r.execution !== 'skipped'));
  assert.equal(f.rows().find((r) => r.target === 'test').exit, 7);
});
test('invalid policy is an error before running a child', (t) => {
  const f = fixture(t); writeFileSync(join(f.root, '.tt.toml'), 'automatic_broad = "false"\n');
  assert.notEqual(f.just(['gate']).status, 0); assert.deepEqual(f.markers(), []);
});
test('push hook routes refs intact, warns when uncovered, and preserves keepalive refusal', (t) => {
  const f = fixture(t), bin = join(f.root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'just'), '#!/bin/sh\nif [ "$1" = --evaluate ]; then exec /usr/bin/just "$@"; fi\nprintf "%s" "$1" > recipe\ncat > refs\nenv > child-env\n', { mode: 0o755 });
  writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nprintf "serveraliveinterval %s\\n" "${KEEPALIVE:-60}"\n', { mode: 0o755 });
  const line = (ref) => `refs/heads/local ${'1'.repeat(40)} ${ref} ${'0'.repeat(40)}\n`;
  const covered = line('refs/heads/feature/x');
  for (const [remote, refs, want] of [['origin', covered, 'hook-pre-push-fast'], ['mirror', covered, 'hook-pre-push'],
    ['origin', covered + line('refs/tags/v1'), 'hook-pre-push'], ['origin', 'bad input\n', 'hook-pre-push']]) {
    const r = f.run('sh', ['.githooks/pre-push', remote, 'git@example.invalid:repo'], { PATH: `${bin}:${f.env.PATH}` }, refs);
    assert.equal(r.status, 0, r.stderr); assert.equal(readFileSync(join(f.root, 'recipe'), 'utf8'), want);
    assert.equal(readFileSync(join(f.root, 'refs'), 'utf8'), refs);
  }
  f.off();
  const r = f.run('sh', ['.githooks/pre-push', 'mirror', 'git@example.invalid:repo'], { PATH: `${bin}:${f.env.PATH}`, GIT_INDEX_FILE: join(f.root, 'other-index') }, covered);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stderr, /coverage is not declared/);
  assert.doesNotMatch(readFileSync(join(f.root, 'child-env'), 'utf8'), /^GIT_INDEX_FILE=/m);
  assert.deepEqual(f.markers(), []);
  assert.notEqual(f.run('sh', ['.githooks/pre-push', 'origin', 'git@example.invalid:repo'], { PATH: `${bin}:${f.env.PATH}`, KEEPALIVE: '0' }, covered).status, 0);
});
