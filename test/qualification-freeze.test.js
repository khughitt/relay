import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateManifest } from '../scripts/hook-qualification/baseline.mjs';
import { renderCandidate } from '../scripts/hook-qualification/candidate-config.mjs';
import { loadSubscribersFrom } from '../src/subscribers.js';

const freezer = fileURLToPath(new URL('../scripts/hook-qualification/freeze.mjs', import.meta.url));
const runner = fileURLToPath(new URL('../scripts/hook-qualification/run.mjs', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function setup(t, event, kind, matcher, nativeHooks) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'relay-freeze-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'hq');
  mkdirSync(repo);
  const env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const run = (command, args) => spawnSync(command, args, { env, encoding: 'utf8' });
  const checked = (command, args) => {
    const result = run(command, args);
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    return result.stdout.trim();
  };
  const git = (...args) => checked('git', ['-C', repo, ...args]);
  const write = (path, value) => {
    const bytes = `${JSON.stringify(value, null, 2)}\n`;
    writeFileSync(path, bytes);
    return sha(bytes);
  };
  git('init', '--quiet');
  assert.equal(git('rev-parse', '--show-toplevel'), repo);
  assert.equal(git('rev-parse', '--absolute-git-dir'), join(repo, '.git'));
  const settingsPath = 'settings.json';
  const settings = join(repo, settingsPath);
  const installed = join(root, 'installed relay');
  mkdirSync(join(installed, 'bin'), { recursive: true });
  mkdirSync(join(installed, 'src', 'fixture'), { recursive: true });
  const entry = join(installed, 'bin', 'relay.js');
  writeFileSync(entry, '/* deployed CLI */');
  writeFileSync(join(installed, 'src', 'fixture', 'index.js'), '/* deployed module */');
  // The deployed relay judges its own side: this stub reads schema 2 whatever the checkout reads.
  writeFileSync(join(installed, 'src', 'index.js'), `
export function validateSubscribers(v) { if (v.schema !== 2) throw new Error('deployed relay reads schema 2'); return v; }
export const matchSubscribers = (config, { kind }) => config.subscribers.filter((s) => s.kinds.includes(kind));
`);
  write(join(installed, 'package.json'), { version: '0.5.0', type: 'module' });

  const subscriber = (name) => ({ name, role: 'observer', registry: 'snapshot', kinds: [kind], argv: ['relay-fixture-observer'], timeoutMs: 1000 });
  const config = (names) => ({ schema: 2, subscribers: names.map(subscriber) });
  const candidateConfig = (names) => ({ schema: 3, searchPath: ['@WORK@/bin', '@FIXTURE@/bin', '/usr/bin', '/bin'], subscribers: names.map(subscriber) });
  const liveConfig = join(root, 'installed subscribers.json');
  const configSha = write(liveConfig, config(['familiar']));
  const relay = { command: `'/usr/bin/node' '${entry}' hook --harness claude-code --outer-ms 60000 --subscribers '${liveConfig}' ${event}`, timeout: 60 };
  const hooks = [nativeHooks[0][0], relay, ...nativeHooks.slice(1).map(([command]) => command)]
    .map((hook) => ({ type: 'command', ...(typeof hook === 'string' ? { command: hook } : hook) }));
  const snapshot = join(root, 'active-settings.json');
  const snapshotOf = (routeHooks) => ({ hooks: { [event]: [{ matcher, hooks: routeHooks }] } });
  const liveSha256 = write(snapshot, snapshotOf(hooks));
  // The live capture may contain host-specific paths that are different in the committed blob.
  write(settings, { committed: true });
  git('add', settingsPath);
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  const identity = { repository: 'hq', commit: git('rev-parse', 'HEAD'), path: settingsPath, blob: git('rev-parse', `HEAD:${settingsPath}`), liveSha256 };
  const identityFile = join(root, 'settings-identity.json');
  write(identityFile, identity);
  const sourceFile = join(root, 'settings-source.txt');
  writeFileSync(sourceFile, `${settings}\n`);

  const fixtureOutput = join(root, 'prepared');
  checked(process.execPath, [runner, '--prepare', '--output', fixtureOutput]);
  const branchNames = nativeHooks.flatMap(([, names]) => names);
  const nativeBranches = branchNames.map((name) => ({ name, role: 'native', migrates: name !== 'turn-pause',
    fixture: 'relay-fixture-native', argv: ['@FIXTURE@/bin/relay-fixture-native'] }));
  const invocations = [['deployed-relay:familiar', 'familiar'], ...nativeBranches.filter((b) => b.migrates)
    .map(({ name }, i) => [name, `fixture-${i}`])];
  const candidate = { config: 'candidate.json', configSha256: write(join(root, 'candidate.json'), candidateConfig(invocations.map(([, name]) => name))) };
  const deployedName = `deployed-${event.toLowerCase()}.json`;
  write(join(root, deployedName), config(['familiar']));
  write(join(root, 'empty-deployed.json'), config([]));
  write(join(root, 'empty-candidate.json'), candidateConfig([]));
  const template = join(root, 'template.json');
  write(template, { schema: 1, manifests: [{ schema: 1, event, harness: 'claude-code', mode: 'interactive',
    baselineKind: 'deployed-relay-plus-native', fixture: 'fixture', payload: { hook_event_name: event },
    schedule: { kind: 'parallel', evidence: 'fixture' }, noSubscriber: { candidate: 'empty-candidate.json', deployed: 'empty-deployed.json' }, candidate,
    branches: [{ name: 'deployed-relay', role: 'deployed-relay', argv: [] }, ...nativeBranches.reverse()],
    replacementMap: invocations.map(([baseline, invocation]) => ({ baseline, invocation, candidate: `candidate:${invocation}` })) }] });

  const output = join(root, 'frozen');
  const freeze = (identityOption = '--settings-identity', identityPath = identityFile) => run(process.execPath, [freezer,
    '--snapshot', snapshot, '--template', template, '--hq', repo, '--version', '2.1.331',
    '--fixture', join(fixtureOutput, 'fixture'), '--output', output, identityOption, identityPath]);
  return { root, output, settings, snapshot, sourceFile, identity, freeze, write, snapshotOf, hooks, configSha, deployedName, installed, entry, git };
}

const stop = [['~/ops/claim-guard --harness claude-code', ['claim-guard']],
  ['~/.local/bin/harness-state-refresh', ['harness-state-refresh']], ['~/hq/turn-pause --harness claude-code Stop', ['turn-pause']]];
const start = [['~/ops/claude-sessionstart', ['claude-sessionstart.halt', 'claude-sessionstart.stale', 'claude-sessionstart.index-repair']],
  ['~/lore/claude-profile', ['claude-profile']], ['~/ops/capture-notice', ['capture-notice']]];

for (const [event, kind, matcher, nativeHooks] of [['Stop', 'turn-end', undefined, stop], ['SessionStart', 'session-start', 'startup|resume', start]]) {
  test(`freezes ${event} in settings order with private fixture configs`, async (t) => {
    const f = setup(t, event, kind, matcher, nativeHooks);
    const result = event === 'Stop' ? f.freeze('--settings-source', f.sourceFile) : f.freeze();
    assert.equal(result.status, 0, result.stderr);
    const file = join(f.output, `${event.toLowerCase()}-manifest.json`);
    const bytes = readFileSync(file);
    const set = JSON.parse(bytes);
    const [manifest] = set.manifests;
    validateManifest(manifest, { harness: 'claude-code', event });
    assert.equal(set.host, manifest.host);
    assert.deepEqual(manifest.branches.map((b) => b.name), [
      ...nativeHooks[0][1], 'deployed-relay', ...nativeHooks.slice(1).flatMap(([, names]) => names),
    ]);
    assert.deepEqual(manifest.settings, event === 'Stop' ? { ...f.identity, source: f.settings } : f.identity);
    assert.equal(manifest.deployed.outerMs, 60000);
    assert.equal(manifest.deployed.configSha256, f.configSha);
    assert.equal(sha(readFileSync(join(f.output, manifest.deployed.fileList))), manifest.deployed.packageSha256);
    assert.match(readFileSync(join(f.output, manifest.deployed.fileList), 'utf8'), /  src\/fixture\/index\.js\n/);
    assert.equal(result.stdout.trim(), `${sha(bytes)}  ${file}`);
    const configs = join(f.output, 'fixture', 'config');
    assert.equal(statSync(configs).mode & 0o7777, 0o700);
    for (const config of ['candidate.json', 'empty-candidate.json', f.deployedName, 'empty-deployed.json']) assert.equal(statSync(join(configs, config)).mode & 0o7777, 0o600);
    // The frozen candidate files are the templates themselves, which no relay loads; a rendered copy loads.
    for (const config of ['candidate.json', 'empty-candidate.json']) {
      const text = readFileSync(join(configs, config), 'utf8');
      assert.equal(text, readFileSync(join(f.root, config), 'utf8'));
      await assert.rejects(loadSubscribersFrom(join(configs, config)), { code: 'INVALID_CONFIG', message: /searchPath\[0\]/ });
      const rendered = join(f.root, 'rendered', config);
      mkdirSync(join(f.root, 'rendered'), { recursive: true, mode: 0o700 });
      writeFileSync(rendered, renderCandidate(text, { work: '/work', fixture: '/fixture' }), { mode: 0o600 });
      assert.equal((await loadSubscribersFrom(rendered)).searchPath[0], '/work/bin');
    }
    assert.equal(manifest.candidate.configSha256, sha(readFileSync(join(configs, 'candidate.json'))));
    assert.notEqual(f.freeze().status, 0, 'a second freeze cannot overwrite the bundle');
    assert.deepEqual(readFileSync(file), bytes);
  });
}

test('refuses stale settings evidence and drift in the captured composition', (t) => {
  const f = setup(t, 'Stop', 'turn-end', undefined, stop);
  f.write(f.settings, { staged: true });
  f.git('add', 'settings.json');
  assert.match(f.freeze().stderr, /settings path is dirty/);
  f.git('restore', '--source=HEAD', '--staged', '--worktree', '--', 'settings.json');
  f.write(f.snapshot, f.snapshotOf(f.hooks.slice(1)));
  assert.match(f.freeze().stderr, /settings identity.*does not match/);
  assert.match(f.freeze('--settings-source', f.sourceFile).stderr, /native composition/);
});

test('refuses a capture whose deployed package lacks the relay entry', (t) => {
  const f = setup(t, 'Stop', 'turn-end', undefined, stop);
  unlinkSync(f.entry);
  const result = f.freeze();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deployed package is missing bin\/relay\.js/);
  assert.equal(existsSync(f.output), false);
});

test('the deployed side is judged by the captured deployed relay', (t) => {
  const f = setup(t, 'Stop', 'turn-end', undefined, stop);
  const index = join(f.installed, 'src', 'index.js');
  writeFileSync(index, readFileSync(index, 'utf8').replace("if (v.schema !== 2) throw new Error('deployed relay reads schema 2')", "throw new Error('deployed validator')"));
  const result = f.freeze();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deployed validator/);
  assert.equal(existsSync(f.output), false);
});

test('a deployed package without the validators is refused', (t) => {
  const f = setup(t, 'Stop', 'turn-end', undefined, stop);
  writeFileSync(join(f.installed, 'src', 'index.js'), 'export const other = 1;\n');
  const result = f.freeze();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the deployed relay exports no subscriber validator/);
  assert.equal(existsSync(f.output), false);
});
