import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { CRASHED, cloneBundle, credentialHits, loadResults, packResults, packingHits, requestedStages, stableVerdict, verifyManifest } from '../tools/darwin-probe/probe.mjs';
import { credentialWrites, isolationOf } from '../tools/darwin-probe/lib/context.mjs';

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

// Shared by the tests below: poll `ps` until `needle` appears in some process's arguments.
const psArgs = () => execFileSync('/bin/ps', ['-axo', 'args='], { encoding: 'utf8' });
const waitFor = async (needle, child) => {
  for (let i = 0; i < 150 && (child === undefined || child.exitCode === null) && !psArgs().includes(needle); i++) await new Promise((r) => setTimeout(r, 200));
  return psArgs().includes(needle);
};
test('results load only non-dot *.json stage files (no AppleDouble entries)', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  mkdirSync(join(d, 'stages')); writeFileSync(join(d, 'manifest.json'), '{"schema":1}');
  writeFileSync(join(d, 'stages/D0.json'), '{"id":"D0","status":"ran"}');
  writeFileSync(join(d, 'stages/._D0.json'), Buffer.from([0, 5, 22, 7, 0, 2, 0, 0]));
  writeFileSync(join(d, 'stages/.DS_Store'), 'x'); writeFileSync(join(d, 'stages/notes.txt'), 'x');
  assert.deepEqual(Object.keys(loadResults(d).stages), ['D0']);
});
test('results are packed without AppleDouble entries, xattrs or owner names', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const bin = join(d, 'bin'), log = join(d, 'tar.log'), out = join(d, 'out'); mkdirSync(bin); mkdirSync(out); writeFileSync(join(out, 'a.json'), '{}');
  const realTar = execFileSync('/bin/sh', ['-c', 'command -v tar'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'tar'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\necho "COPYFILE_DISABLE=$COPYFILE_DISABLE" >> '${log}'\nexec '${realTar}' "$@"\n`, { mode: 0o755 });
  const saved = process.env.PATH; process.env.PATH = `${bin}:${saved}`; t.after(() => { process.env.PATH = saved; });
  packResults(out, join(d, 'r.tar.gz'));
  const lines = readFileSync(log, 'utf8').split('\n');
  for (const flag of ['--numeric-owner', '--no-xattrs', 'COPYFILE_DISABLE=1']) assert.ok(lines.includes(flag), flag);
  assert.deepEqual(execFileSync(realTar, ['tzf', join(d, 'r.tar.gz')], { encoding: 'utf8' }).split('\n').filter(Boolean).sort(), ['./', './a.json']);
});
test('a credential file or the token anywhere in the results is found', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  mkdirSync(join(d, 'stages')); mkdirSync(join(d, 'logs'));
  writeFileSync(join(d, 'stages/D0.json'), '{}'); writeFileSync(join(d, 'logs/D7.log'), 'clean');
  assert.deepEqual(credentialHits(d, null), []);
  const token = 'sk-ant-oat01-' + 'x'.repeat(40);
  writeFileSync(join(d, 'logs/D7.log'), `preflight: ${token}\n`); writeFileSync(join(d, 'auth.json'), '{}'); writeFileSync(join(d, 'stages/.credentials.json'), '{}');
  assert.deepEqual(credentialHits(d, token).sort(), ['auth.json', 'logs/D7.log', 'stages/.credentials.json']);
  assert.deepEqual(credentialHits(d, null).sort(), ['auth.json', 'stages/.credentials.json']);
});
test('a JWT-shaped token (Codex\'s login) anywhere in the results is found', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ sub: 'user-123456', exp: 1900000000 })}.${'s'.repeat(43)}`;
  writeFileSync(join(d, 'D7.log'), 'run a/allow: exit 0 after 12.0 s\n--- stdout\n{"note":"eyJ is a prefix","v":"a.b.c"}\n');
  assert.deepEqual(credentialHits(d, null), []);
  writeFileSync(join(d, 'D7.log'), `--- stderr\nAuthorization: Bearer ${jwt}\n`);
  assert.deepEqual(credentialHits(d, null), ['D7.log']);
});
test('credential material in the raw results alone still refuses packing', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const raw = join(d, 'results'), out = join(d, 'out'), token = 'sk-ant-oat01-' + 'x'.repeat(40);
  for (const dir of [raw, out]) { mkdirSync(join(dir, 'logs'), { recursive: true }); writeFileSync(join(dir, 'logs/D7.log'), 'clean'); }
  assert.deepEqual(packingHits(raw, out, token), []);
  writeFileSync(join(raw, 'logs/D7.log'), `preflight: ${token}\n`); mkdirSync(join(raw, 'd7')); writeFileSync(join(raw, 'd7/auth.json'), '{}');
  writeFileSync(join(out, 'auth.json'), '{}');
  assert.deepEqual(packingHits(raw, out, token), ['auth.json', 'd7/auth.json', 'logs/D7.log']);
});
test('requested stages run in canonical order, once each, and an unknown id is refused', () => {
  assert.deepEqual(requestedStages('D9,D7,D0'), ['D0', 'D7', 'D9']);
  assert.deepEqual(requestedStages('D7b,D7,D7'), ['D7', 'D7b']);
  assert.equal(requestedStages(undefined).join(','), 'D0,D1,D2,D3,D4,D5,D6,D7,D7b,D8,D9');
  assert.throws(() => requestedStages('D7,D10,x'), { message: 'unknown stage id(s): D10, x' });
});
test('the isolation reading is taken before D9 and later changes are only a finding', () => {
  const a = { '.codex/config.toml': { exists: true, size: 1 } }, b = { '.codex/config.toml': { exists: true, size: 2 } };
  assert.deepEqual(isolationOf(a, null, a), { before: a, after: a, after_taken: 'finalize', changed: [], written_back: [], changed_during_d9: [] });
  assert.deepEqual(isolationOf(a, a, b), { before: a, after: a, after_taken: 'before D9', changed: [], written_back: [], final: b, changed_during_d9: ['.codex/config.toml'] });
  assert.deepEqual(isolationOf(a, b, b).changed, ['.codex/config.toml']);
});
test('a login the guard probe wrote back is a finding, not a live-path change', () => {
  // ops relay-guard-probe writes a harness's refreshed token back to the live file (ops-4130ea).
  const f = (size, mtimeMs) => ({ exists: true, files: 1, size, mtimeMs });
  const before = { '.codex/auth.json': f(10, 1), '.codex/config.toml': f(1, 1) };
  const after = { '.codex/auth.json': f(12, 2), '.codex/config.toml': f(1, 1) };
  const write = { path: '.codex/auth.json', before: f(10, 1), after: f(12, 2) };
  const iso = isolationOf(before, null, after, [write]);
  assert.deepEqual([iso.changed, iso.written_back], [[], ['.codex/auth.json']]);
  assert.deepEqual(isolationOf(before, after, after, [write]).written_back, ['.codex/auth.json']);
  // Any other change to that file, before or after D7's own readings, still gates.
  assert.deepEqual(isolationOf(before, null, { ...after, '.codex/auth.json': f(13, 3) }, [write]).changed, ['.codex/auth.json']);
  assert.deepEqual(isolationOf(before, null, after, [{ ...write, before: f(11, 1) }]).changed, ['.codex/auth.json']);
  // A write D7 recorded for another path excuses nothing here.
  assert.deepEqual(isolationOf(before, null, after, [{ ...write, path: '.claude/.credentials.json' }]).changed, ['.codex/auth.json']);
});
test('credential writes are read from each D7 harness observation', () => {
  const w = { path: '.codex/auth.json', before: {}, after: {} };
  assert.deepEqual(credentialWrites({ status: 'ran', observations: { 'claude-code': { status: 'absent' }, codex: { status: 'ran', credential_write: w } } }), [w]);
  assert.deepEqual(credentialWrites(undefined), []);
  assert.deepEqual(credentialWrites({ status: 'skipped', observations: {} }), []);
});
test('python3 older than 3.11, or none, stops the probe with one line (exit 2)', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const bin = join(d, 'bin'), empty = join(d, 'empty'); mkdirSync(bin); mkdirSync(empty);
  writeFileSync(join(bin, 'python3'), '#!/bin/sh\necho "Python 3.9.6"\n', { mode: 0o755 });
  for (const [path, found] of [[bin, 'Python 3.9.6'], [empty, 'none']]) {
    const r = spawnSync(process.execPath, ['tools/darwin-probe/probe.mjs', '--self-test-hang', '--root', join(d, `root-${found.length}`), '--bundle', d], { encoding: 'utf8', env: { ...process.env, PATH: path } });
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stderr, `python3 >= 3.11 is required (found ${found}); install one, e.g. brew install python\n`);
  }
});
test('credential material in the results stops packing (exit 1, no tarball)', { timeout: 90000 }, async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const root = join(d, 'root');
  const child = spawn(process.execPath, ['tools/darwin-probe/probe.mjs', '--self-test-hang', '--root', root, '--bundle', d], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', (x) => { stderr += x; });
  const exited = new Promise((r) => child.once('exit', r));
  assert.ok(await waitFor('sleep 600.654', child), 'the probe never reached its hanging stage');
  mkdirSync(join(root, 'results/logs'), { recursive: true }); writeFileSync(join(root, 'results/logs/auth.json'), '{}');
  child.kill('SIGINT');
  assert.equal(await exited, 1);
  assert.match(stderr, /refusing to pack: credential material in logs\/auth\.json/);
  assert.equal(readdirSync(d).some((f) => f.startsWith('relay-darwin-results-')), false);
  assert.equal(psArgs().includes('sleep 600.654'), false);
});
// `run` as the user starts it: a copied bundle layout (run + probe/), under each POSIX shell here.
const bundleLayout = (d) => {
  execFileSync('cp', ['tools/darwin-probe/run', join(d, 'run')]);
  symlinkSync(join(process.cwd(), 'tools/darwin-probe'), join(d, 'probe'));
};
const rdpRoots = () => new Set(readdirSync('/tmp').filter((f) => f.startsWith('rdp.')));
const shells = [...new Set(['/bin/sh', '/usr/bin/dash', '/bin/dash'].filter((s) => existsSync(s)).map((s) => realpathSync(s)))];
for (const shell of shells) {
  test(`closing the terminal (${shell}) still packs the results and leaves no child`, { timeout: 120000 }, async (t) => {
    const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
    bundleLayout(d);
    const roots = rdpRoots();
    // A pty whose master is closed once the probe hangs: the shell and node both get SIGHUP,
    // and every later write to the terminal fails with EIO. The needle is split so this
    // harness's own argv never matches it.
    const harness = `import json, os, pty, select, signal, subprocess, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])
deadline = time.time() + 60
while time.time() < deadline and b"sleep 600." + b"654" not in subprocess.run(["/bin/ps", "-axo", "args="], capture_output=True).stdout:
    try:
        if select.select([fd], [], [], 0.2)[0]: os.read(fd, 65536)
    except OSError:
        break
os.close(fd)
# The kernel signals only the session leader; the user's login shell then sends SIGHUP to its
# jobs' process groups, which is what reaches ./run and node on a closed terminal window.
os.killpg(pid, signal.SIGHUP)
deadline = time.time() + 60
while True:
    done, status = os.waitpid(pid, os.WNOHANG)
    if done: break
    if time.time() > deadline:
        os.killpg(pid, signal.SIGKILL); os.waitpid(pid, 0); status = None; break
    time.sleep(0.1)
print(json.dumps({"exit": None if status is None else os.waitstatus_to_exitcode(status)}))`;
    const r = spawnSync('python3', ['-c', harness, shell, join(d, 'run'), '--self-test-hang'], { encoding: 'utf8', timeout: 110000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).exit, 129);
    const tarball = readdirSync(d).find((f) => f.startsWith('relay-darwin-results-'));
    assert.ok(tarball, 'no results tarball after the hangup');
    const x = join(d, 'x'); mkdirSync(x); execFileSync('tar', ['xzf', join(d, tarball), '-C', x]);
    const manifest = JSON.parse(readFileSync(join(x, 'manifest.json'), 'utf8'));
    assert.equal(manifest.interrupted, 'SIGHUP'); assert.deepEqual(manifest.cleanup.survivors, []);
    await new Promise((res) => setTimeout(res, 500));
    const left = psArgs();
    for (const needle of ['sleep 600.321', 'sleep 600.654', join(d, 'run')]) assert.equal(left.includes(needle), false, needle);
    assert.deepEqual([...rdpRoots()].filter((f) => !roots.has(f)), [], 'run left its root behind');
  });
}
test('run keeps its root and names it when the probe dies abnormally, and removes it otherwise', (t) => {
  for (const [body, status, kept] of [['process.kill(process.pid, "SIGKILL")', 137, true], ['process.exit(2)', 2, false]]) {
    const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
    execFileSync('cp', ['tools/darwin-probe/run', join(d, 'run')]); mkdirSync(join(d, 'probe'));
    writeFileSync(join(d, 'probe/probe.mjs'), `import { writeFileSync } from 'node:fs';\nconst a = process.argv; writeFileSync(${JSON.stringify(join(d, 'root.txt'))}, a[a.indexOf('--root') + 1]);\n${body};\n`);
    const r = spawnSync('/bin/sh', [join(d, 'run')], { encoding: 'utf8' });
    const root = readFileSync(join(d, 'root.txt'), 'utf8');
    assert.equal(r.status, status, r.stderr); assert.match(root, /^\/tmp\/rdp\.[A-Za-z0-9]{6}$/);
    assert.equal(existsSync(root), kept);
    if (kept) { assert.ok(r.stderr.includes(root), r.stderr); rmSync(root, { recursive: true, force: true }); }
  }
});
test('a probe crash exits CRASHED; run keeps the root, without credential copies, and says it is unredacted', { timeout: 90000 }, async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  bundleLayout(d);
  // Once the self-test's hanging stage starts, plant a guard probe's credential copies (as a
  // SIGKILLed ops relay-guard-probe leaves them) and crash outside any stage.
  const crash = join(d, 'crash.mjs');
  writeFileSync(crash, `import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
// NODE_OPTIONS reaches the probe's own node children too; only the probe carries --root.
const at = process.argv.indexOf('--root'), root = process.argv[at + 1];
const timer = at > 0 && setInterval(() => {
  if (!existsSync(root + '/results/stages/D0.json')) return;
  clearInterval(timer);
  mkdirSync(root + '/d7/home/.codex', { recursive: true }); mkdirSync(root + '/d7/home/.claude', { recursive: true });
  writeFileSync(root + '/d7/home/.codex/auth.json', '{}'); writeFileSync(root + '/d7/home/.claude/.credentials.json', '{}');
  writeFileSync(root + '/d7/home/.codex/config.toml', '');
  throw new Error('injected crash');
}, 100);
`);
  const r = spawnSync('/bin/sh', [join(d, 'run'), '--self-test-hang'], { encoding: 'utf8', timeout: 80000, env: { ...process.env, NODE_OPTIONS: `--import=${crash}` } });
  const root = r.stderr.match(/\/tmp\/rdp\.[A-Za-z0-9]{6}/)?.[0];
  t.after(() => { if (root) rmSync(root, { recursive: true, force: true }); });
  assert.equal(r.status, CRASHED, r.stderr);
  assert.match(r.stderr, /injected crash/);
  assert.ok(root && existsSync(root), r.stderr);
  assert.match(r.stderr, /unredacted/);
  assert.equal(existsSync(join(root, 'd7/home/.codex/auth.json')), false);
  assert.equal(existsSync(join(root, 'd7/home/.claude/.credentials.json')), false);
  assert.equal(existsSync(join(root, 'd7/home/.codex/config.toml')), true);
  assert.equal(existsSync(join(root, 'results/stages/D0.json')), true);
  assert.equal(psArgs().includes('sleep 600.654'), false);
});
const asRoot = process.getuid?.() === 0; // chmod does not stop root from writing
test('a failure while packing exits CRASHED, not the signal code, so run keeps the root', { timeout: 90000, skip: asRoot }, async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => { chmodSync(d, 0o755); rmSync(d, { recursive: true, force: true }); });
  const root = join(d, 'root'); mkdirSync(root);
  chmodSync(d, 0o555); // the tarball cannot be moved into the bundle directory
  const child = spawn(process.execPath, ['tools/darwin-probe/probe.mjs', '--self-test-hang', '--root', root, '--bundle', d], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', (x) => { stderr += x; });
  const exited = new Promise((r) => child.once('exit', r));
  assert.ok(await waitFor('sleep 600.654', child), 'the probe never reached its hanging stage');
  child.kill('SIGINT');
  assert.equal(await exited, CRASHED, stderr);
  assert.match(stderr, /finalize failed/);
  assert.equal(psArgs().includes('sleep 600.654'), false);
});
test('a throw outside a stage whose finalize also fails exits CRASHED, not 2', { timeout: 60000, skip: asRoot }, async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')), root = join(d, 'root'), results = join(root, 'results');
  t.after(() => { chmodSync(results, 0o755); rmSync(d, { recursive: true, force: true }); });
  // An unwritable results directory: the first stage's log cannot be opened (outside the
  // stage's own try), and finalize cannot write the manifest either.
  mkdirSync(results, { recursive: true }); chmodSync(results, 0o555);
  const r = spawnSync(process.execPath, ['tools/darwin-probe/probe.mjs', '--self-test-hang', '--root', root, '--bundle', d], { encoding: 'utf8', timeout: 50000 });
  assert.equal(r.status, CRASHED, r.stderr);
  assert.match(r.stderr, /finalize failed/);
});
test('a kept root whose credential copy cannot be removed says so', { skip: asRoot }, (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  execFileSync('cp', ['tools/darwin-probe/run', join(d, 'run')]); mkdirSync(join(d, 'probe'));
  writeFileSync(join(d, 'probe/probe.mjs'), `import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
const a = process.argv, root = a[a.indexOf('--root') + 1];
writeFileSync(${JSON.stringify(join(d, 'root.txt'))}, root);
mkdirSync(root + '/d7/locked', { recursive: true }); writeFileSync(root + '/d7/locked/auth.json', '{}'); chmodSync(root + '/d7/locked', 0o555);
process.kill(process.pid, 'SIGKILL');
`);
  const r = spawnSync('/bin/sh', [join(d, 'run')], { encoding: 'utf8' });
  const root = readFileSync(join(d, 'root.txt'), 'utf8');
  t.after(() => { chmodSync(join(root, 'd7/locked'), 0o755); rmSync(root, { recursive: true, force: true }); });
  assert.equal(r.status, 137, r.stderr);
  assert.match(r.stderr, /could not remove every credential copy/);
  assert.doesNotMatch(r.stderr, /credential copies removed/);
});
