import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellQuote } from '../src/install/hooks.js';
import { main } from '../bin/relay.js';
import { runCli } from './helpers/cli-interaction.js';

const stream = () => ({ text: '', write(value, done) { this.text += value; done?.(); } });
test('install and rollback require their explicit inputs', async () => {
  for (const args of [['install'], ['install', '--harness', 'codex'], ['rollback'], ['rollback', '--artifact']]) {
    const out = stream(), err = stream();
    assert.equal(await main(args, { stdout: out, stderr: err }), 2);
    assert.match(err.text, /^relay: /);
  }
});

async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), 'relay-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'relay'); await mkdir(dir, { mode: 0o700 });
  const file = join(dir, 'subscribers.json'); await writeFile(file, '{"schema":1,"subscribers":[]}\n', { mode: 0o600 });
  const target = join(root, 'hooks.json'); await writeFile(target, '{"hooks":{}}\n');
  return { root, dir, file, target };
}
// An executable at a chosen path stands in for node: install validates and writes the path, never runs it.
async function fakeNode(dir) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'node'); await writeFile(file, '#!/bin/sh\n', { mode: 0o700 });
  return file;
}
const quoted = (value) => shellQuote(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const commands = (artifact) => Object.values(JSON.parse(artifact.changes[0].after).hooks).flat().map((entry) => entry.hooks[0].command);
const install = (args) => { const out = stream(), err = stream(); return main(args, { stdout: out, stderr: err }).then((code) => ({ code, out: out.text, err: err.text })); };

test('install reads the subscriber file with the runtime checks and writes its path', async (t) => {
  const s = await scratch(t);
  const ok = await install(['install', '--harness', 'codex', '--subscribers', s.file, '--target', s.target]);
  assert.equal(ok.code, 0, ok.err);
  const artifact = JSON.parse(ok.out);
  assert.match(artifact.changes[0].after, new RegExp(`--subscribers '${s.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' PreToolUse`));
  const relative = await install(['install', '--harness', 'codex', '--subscribers', 'relay/subscribers.json', '--target', s.target]);
  assert.equal(relative.code, 1); assert.match(relative.err, /INVALID_CONFIG: subscriber config path must be absolute/);
});

test('install refuses a subscriber file the hook would refuse at runtime', async (t) => {
  const s = await scratch(t);
  const cases = [
    ['0644 file', async () => chmod(s.file, 0o644), /0600 regular file in a 0700 directory/],
    ['0755 directory', async () => { await chmod(s.file, 0o600); await chmod(s.dir, 0o755); }, /0600 regular file in a 0700 directory/],
    ['symlink', async () => { await chmod(s.dir, 0o700); await symlink(s.file, join(s.dir, 'link.json')); s.file = join(s.dir, 'link.json'); }, /0600 regular file in a 0700 directory/],
    ['missing', async () => { s.file = join(s.dir, 'none.json'); }, /does not exist/],
    ['invalid JSON', async () => { s.file = join(s.dir, 'subscribers.json'); await writeFile(s.file, '{broken', { mode: 0o600 }); }, /JSON/],
  ];
  for (const [name, arrange, expected] of cases) {
    await arrange();
    const r = await install(['install', '--harness', 'codex', '--subscribers', s.file, '--target', s.target]);
    assert.equal(r.code, 1, name); assert.equal(r.out, '', name);
    const error = JSON.parse(r.err).error; // install defaults to --json output, so its failures are the {kind, detail} envelope
    assert.equal(error.kind, 'install_failed', name); assert.match(error.detail, /^INVALID_CONFIG: /, name); assert.match(error.detail, expected, name);
  }
});

async function askInstall(t) {
  const s = await scratch(t), bin = join(s.root, 'bin'), evidence = join(s.root, 'evidence.json');
  await mkdir(bin);
  await writeFile(evidence, await readFile(new URL('../docs/evidence/claude-code-answer-routes.json', import.meta.url)));
  const claude = join(bin, 'claude');
  await writeFile(claude, '#!/bin/sh\nprintf "%s\\n" "2.1.296 (Claude Code)"\n', { mode: 0o700 });
  // An explicit, unversioned node keeps the run's stderr free of the versioned-path warning
  // on a host whose own node lives under a version manager.
  const node = await fakeNode(join(s.root, 'stable'));
  const args = ['install', '--harness', 'claude-code', '--subscribers', s.file, '--target', s.target, '--node', node, '--evidence', evidence, '--with', 'ask'];
  return { ...s, bin, evidence, claude, args, run: (argv = args) => runCli({ stateDir: s.dir }, argv, undefined, { PATH: bin }) };
}

test('install --with ask plans, applies and rolls back only a fixture settings file', async (t) => {
  const s = await askInstall(t), before = await readFile(s.target, 'utf8');
  const planned = s.run();
  assert.equal(planned.status, 0, planned.stderr);
  const artifact = JSON.parse(planned.stdout), hooks = JSON.parse(artifact.changes[0].after).hooks;
  assert.match(hooks.PreToolUse.find((row) => row.matcher === 'AskUserQuestion').hooks[0].command,
    / ask --harness claude-code --handback PreToolUse$/);
  assert.match(hooks.PostToolUse[0].hooks[0].command, / ask --harness claude-code PostToolUse$/);
  assert.equal(await readFile(s.target, 'utf8'), before);
  const file = join(s.root, 'artifact.json'), applied = s.run([...s.args, '--apply', '--artifact', file]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(await readFile(s.target, 'utf8'), artifact.changes[0].after);
  const rollback = s.run(['rollback', '--artifact', file]);
  assert.deepEqual([rollback.status, rollback.stdout, rollback.stderr], [0, '', '']);
  assert.equal(await readFile(s.target, 'utf8'), before);
});

test('install --with ask refuses missing Claude, mismatched version and insufficient evidence', async (t) => {
  const s = await askInstall(t), before = await readFile(s.target, 'utf8');
  await rm(s.claude);
  const missing = s.run();
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(JSON.parse(missing.stderr).error.detail, /^HARNESS_UNAVAILABLE/);
  await writeFile(s.claude, '#!/bin/sh\nprintf "%s\\n" "2.2.0 (Claude Code)"\n', { mode: 0o700 });
  const mismatch = s.run();
  assert.equal(mismatch.status, 1, mismatch.stderr);
  assert.match(JSON.parse(mismatch.stderr).error.detail, /^UNSUPPORTED_BINDING: .*2\.1\.296.*2\.2\.0/);
  await writeFile(s.claude, '#!/bin/sh\nprintf "%s\\n" "2.1.296 (Claude Code)"\n', { mode: 0o700 });
  await writeFile(s.evidence, JSON.stringify({ schema: 1, harness: 'claude-code', version: '2.1.296', probes: [], routes: [] }));
  const unsupported = s.run();
  assert.equal(unsupported.status, 1, unsupported.stderr);
  assert.match(JSON.parse(unsupported.stderr).error.detail, /^UNSUPPORTED_BINDING/);
  assert.equal(await readFile(s.target, 'utf8'), before);
});

test('install --with is restricted to ask on claude-code', async (t) => {
  const s = await askInstall(t);
  for (const harness of ['codex', 'opencode']) {
    const args = [...s.args]; args[args.indexOf('--harness') + 1] = harness;
    const r = s.run(args);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /--with ask.*claude-code/);
  }
  for (const args of [[...s.args, '--with', 'ask'], s.args.slice(0, -1), [...s.args.slice(0, -1), 'bogus']]) {
    assert.equal(s.run(args).status, 2, args.join(' '));
  }
});

test('Claude version failures emit only the formatted install error', async (t) => {
  const s = await askInstall(t), before = await readFile(s.target, 'utf8');
  await writeFile(s.claude, '#!/bin/sh\nprintf "%s\\n" "raw version failure" >&2\nexit 3\n', { mode: 0o700 });
  const failed = s.run();
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, '');
  assert.doesNotThrow(() => JSON.parse(failed.stderr));
  const error = JSON.parse(failed.stderr).error;
  assert.equal(error.kind, 'install_failed');
  assert.match(error.detail, /^HARNESS_UNAVAILABLE/);
  assert.doesNotMatch(failed.stderr, /raw version failure/);
  const pretty = s.run(['--pretty', ...s.args]);
  assert.equal(pretty.status, 1);
  assert.match(pretty.stderr, /^relay: HARNESS_UNAVAILABLE: [^\n]+\n$/);
  assert.doesNotMatch(pretty.stderr, /raw version failure/);
  assert.equal(await readFile(s.target, 'utf8'), before);
});

test('successful Claude version checks do not leak subprocess stderr', async (t) => {
  const s = await askInstall(t), before = await readFile(s.target, 'utf8');
  await writeFile(s.claude, '#!/bin/sh\nprintf "%s\\n" "raw version success" >&2\nprintf "%s\\n" "2.1.296 (Claude Code)"\n', { mode: 0o700 });
  const success = s.run();
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, '');
  assert.equal(JSON.parse(success.stdout).harness, 'claude-code');
  assert.equal(await readFile(s.target, 'utf8'), before);
});

test('install --node names that node in every command it writes, for both harnesses', async (t) => {
  const s = await scratch(t), node = await fakeNode(join(s.root, "o'stable"));
  for (const harness of ['claude-code', 'codex']) {
    const r = await install(['install', '--harness', harness, '--subscribers', s.file, '--target', s.target, '--node', node]);
    assert.equal(r.code, 0, r.err); assert.equal(r.err, '', harness);
    const written = commands(JSON.parse(r.out));
    assert.ok(written.length > 0, harness);
    for (const command of written) assert.match(command, new RegExp(`^${quoted(node)} `), harness);
  }
});

test('install refuses a --node that is not an absolute path to an executable file', async (t) => {
  const s = await scratch(t), node = await fakeNode(join(s.root, 'stable'));
  const plain = join(s.root, 'plain'); await writeFile(plain, '', { mode: 0o600 });
  const cases = [['relative', 'bin/node', /--node must be an absolute path/], ['missing', join(s.root, 'none'), /--node .*does not exist/],
    ['not executable', plain, /--node .*not an executable file/], ['directory', s.root, /--node .*not an executable file/]];
  for (const [name, value, expected] of cases) {
    const r = await install(['install', '--harness', 'codex', '--subscribers', s.file, '--target', s.target, '--node', value]);
    assert.equal(r.code, 2, name); assert.equal(r.out, '', name); assert.match(r.err, expected, name);
  }
  const opencode = await install(['install', '--harness', 'opencode', '--subscribers', s.file, '--config-dir', s.dir, '--node', node]);
  assert.equal(opencode.code, 2); assert.match(opencode.err, /--node exists only for claude-code and codex/);
});

test('install warns when the node it writes lives in one version\'s directory, and still plans', async (t) => {
  const s = await scratch(t);
  for (const [dir, manager] of [[join(s.root, '.nvm/versions/node/v26.5.0/bin'), 'nvm'], [join(s.root, 'opt/homebrew/Cellar/node/26.5.0/bin'), 'Homebrew']]) {
    const node = await fakeNode(dir);
    for (const format of [[], ['--pretty']]) {
      const r = await install([...format, 'install', '--harness', 'codex', '--subscribers', s.file, '--target', s.target, '--node', node]);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.err.split('\n').filter(Boolean).length, 1, r.err);
      assert.match(r.err, new RegExp(`^relay: warning: node path ${node.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is in a version-specific directory \\(${manager}\\);`));
      assert.match(r.err, /stop running, silently, when that version is removed/); assert.match(r.err, /--node/);
    }
  }
});
