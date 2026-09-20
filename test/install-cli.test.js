import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../bin/relay.js';

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
