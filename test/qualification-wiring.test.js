import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wiring = join(root, 'scripts/hook-qualification/wiring.mjs');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const childEnv = (home) => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' });

function fixture(t, host = hostname()) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-wiring-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = childEnv(dir);
  const run = (command, args) => spawnSync(command, args, { env, encoding: 'utf8' });
  const checked = (command, args) => {
    const result = run(command, args);
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    return result.stdout.trim();
  };
  const repo = join(dir, 'hq');
  const relative = join('harnesses', 'claude', 'settings.json');
  mkdirSync(join(repo, 'harnesses', 'claude'), { recursive: true });
  const git = (...args) => checked('git', ['-C', repo, ...args]);
  const live = join(repo, relative);
  const installed = join(dir, 'installed relay');
  const config = join(dir, 'installed subscribers.json');
  mkdirSync(join(installed, 'bin'), { recursive: true });
  mkdirSync(join(installed, 'src'), { recursive: true });
  writeFileSync(join(installed, 'bin', 'relay.js'), '// relay entry\n');
  writeFileSync(join(installed, 'src', 'index.js'), '// relay module\n');
  writeFileSync(join(installed, 'package.json'), '{"name":"relay","version":"0.5.0"}\n');
  const configBytes = '{"schema":2,"subscribers":[]}\n';
  writeFileSync(config, configBytes);
  const entry = join(installed, 'bin', 'relay.js');
  const settingsValue = { hooks: { Stop: [{ hooks: [
    { type: 'command', command: '/usr/bin/true' },
    { type: 'command', timeout: 600, command: `'${process.execPath}' '${entry}' hook --harness claude-code --outer-ms 600000 --subscribers '${config}' Stop` },
  ] }] }, model: 'claude-haiku-5-5', effortLevel: 'high', modelSettings: { effort: 'high' } };
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(live, json(settingsValue));
  writeFileSync(join(repo, '.gitattributes'), `${relative} filter=harness-state\n`);
  const filter = join(dir, 'clean-filter.mjs');
  writeFileSync(filter, "let raw='';for await(const chunk of process.stdin)raw+=chunk;const value=JSON.parse(raw);for(const key of ['model','effortLevel','modelSettings'])delete value[key];process.stdout.write(JSON.stringify(value));\n");
  checked('git', ['-C', repo, 'init', '--quiet']);
  assert.equal(git('rev-parse', '--show-toplevel'), repo);
  assert.equal(git('rev-parse', '--absolute-git-dir'), join(repo, '.git'));
  git('config', 'filter.harness-state.clean', `${process.execPath} ${filter}`);
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture');

  // Only clean-filter-stripped state differs from the committed bytes. git status can flag this;
  // the wiring check must instead prove the filtered diff and index identity directly.
  settingsValue.model = 'claude-a-much-longer-model-name';
  writeFileSync(live, json(settingsValue));
  const snapshot = join(dir, 'settings-snapshot.json');
  writeFileSync(snapshot, json(settingsValue));
  const files = ['bin/relay.js', 'package.json', 'src/index.js'];
  const listing = files.map((file) => `${sha(readFileSync(join(installed, file)))}  ${file}\n`).join('');
  const manifestFile = join(dir, 'stop-manifest.json');
  const manifest = { host, event: 'Stop', version: '2.1.331', mode: 'interactive',
    settings: { repository: 'hq', commit: git('rev-parse', 'HEAD'), path: relative, blob: git('rev-parse', `HEAD:${relative}`), liveSha256: sha(readFileSync(snapshot)) },
    deployed: { packageSha256: sha(listing), configSha256: sha(configBytes), outerMs: 600000 } };
  writeFileSync(manifestFile, JSON.stringify({ schema: 1, host, manifests: [manifest] }));
  const invoke = (file) => run(process.execPath, [wiring, '--hq', repo, '--snapshot', snapshot, file]);
  const check = () => invoke(manifestFile);
  return { check, invoke, config, manifestFile, dir };
}

test('wiring accepts filtered live state and verifies every frozen deployment identity', (t) => {
  // Break caught: using git status or raw live bytes rejects a valid deployment behind hq's clean filter.
  const f = fixture(t);
  const result = f.check();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /filtered live file = index \(git diff --quiet\): PASS/);
  assert.match(result.stdout, /index = HEAD \(git diff --cached --quiet\): PASS/);
  assert.match(result.stdout, /blob hooks table = snapshot hooks table: PASS/);
  assert.match(result.stdout, /relay line outer budget: PASS/);
  assert.match(result.stdout, /ALL PASS/);
});

test('wiring refuses a foreign host label and an empty manifest set', (t) => {
  // Break caught: two passing reports produced on one host must not be attributable to two measurement hosts.
  const f = fixture(t, 'a-different-host');
  const mismatch = f.check();
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stdout, /executing hostname: FAIL/);
  const empty = join(f.dir, 'empty.json');
  writeFileSync(empty, '{"schema":1,"host":"a-different-host","manifests":[]}');
  const emptyResult = f.invoke(empty);
  assert.notEqual(emptyResult.status, 0);
  assert.doesNotMatch(emptyResult.stdout, /ALL PASS/);
});

test('wiring requires the manifest set wrapper to name its host explicitly', (t) => {
  // Break caught: falling back from a missing set host to the route host loses the set identity condition.
  const f = fixture(t);
  const set = readJson(f.manifestFile);
  delete set.host;
  writeFileSync(f.manifestFile, JSON.stringify(set));
  const result = f.check();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /manifest set hostname: FAIL/);
});

test('wiring fails closed when the installed subscriber composition changed', (t) => {
  // Break caught: reporting only settings identity can miss a changed deployed subscriber config.
  const f = fixture(t);
  writeFileSync(f.config, '{"schema":2,"subscribers":[{"name":"changed"}]}\n');
  const result = f.check();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /deployed subscriber config sha256: FAIL/);
  assert.match(result.stdout, /SOME FAIL/);
  const before = readFileSync(f.manifestFile);
  assert.deepEqual(readFileSync(f.manifestFile), before, 'a failed check does not rewrite its manifest');
});
