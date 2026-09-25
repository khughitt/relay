import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isolatedEnv, prepareRoot, registryFor, requireStarted, tracker, fingerprint, changedPaths, WATCHED_FILES, WATCHED_TREES } from '../tools/darwin-probe/lib/context.mjs';
import { readHidden } from '../tools/darwin-probe/lib/tty.mjs';
import { compareCapture, rowFor } from '../tools/darwin-probe/lib/ps.mjs';
import { buildParent, checkParent, installParent, startParent } from '../tools/darwin-probe/lib/parents.mjs';
import { fleetTimeoutMs } from '../tools/darwin-probe/lib/fleet.mjs';
import { createProcessOps } from '../src/index.js';

const root = (t) => { const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
test('isolation sets every redirect and drops COLUMNS and session variables', (t) => {
  const r = root(t), env = isolatedEnv(r, { HOME: '/h', COLUMNS: '80', CLAUDE_CODE_SESSION_ID: 'x', PATH: '/bin' });
  for (const k of ['RELAY_STATE_DIR','XDG_CONFIG_HOME','XDG_STATE_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','CLAUDE_CONFIG_DIR','CODEX_HOME','TMPDIR']) assert.ok(env[k].startsWith(r), k);
  assert.equal(env.COLUMNS, undefined); assert.equal(env.CLAUDE_CODE_SESSION_ID, undefined); assert.equal(env.PATH, '/bin');
});
test('the watched set covers config and credentials, not session transcripts', () => {
  assert.ok(WATCHED_FILES.includes('.claude/settings.json') && WATCHED_FILES.includes('.codex/auth.json'));
  assert.ok(!WATCHED_TREES.some((p) => p === '.claude' || p === '.codex'));
  assert.ok(WATCHED_TREES.includes('.local/share/opencode') && WATCHED_TREES.includes('.cache/opencode'));
});
test('fingerprints report a new file inside a watched tree and ignore unwatched writes', (t) => {
  const home = root(t); mkdirSync(join(home, '.config/relay'), { recursive: true }); mkdirSync(join(home, '.claude/projects'), { recursive: true });
  const before = fingerprint(home);
  writeFileSync(join(home, '.claude/projects/session.jsonl'), 'x');
  assert.deepEqual(changedPaths(before, fingerprint(home)), []);
  writeFileSync(join(home, '.config/relay/new.json'), '{}');
  assert.deepEqual(changedPaths(before, fingerprint(home)), ['.config/relay']);
});
test('registry access follows the given env, never the ambient one', async (t) => {
  const r = root(t); prepareRoot(r);
  const saved = process.env.RELAY_STATE_DIR; process.env.RELAY_STATE_DIR = join(r, 'ambient');
  t.after(() => { if (saved === undefined) delete process.env.RELAY_STATE_DIR; else process.env.RELAY_STATE_DIR = saved; });
  const reg = await registryFor(process.cwd(), isolatedEnv(r));
  assert.equal(reg.paths.stateDir, join(r, 'relay-state'));
});
test('after stop, spawning is refused and a resumed stage cannot outlive cleanup', async (t) => {
  const r = root(t); const tr = tracker(r);
  // A stage that resumes whenever its child dies and immediately spawns another.
  const stage = (async () => { for (;;) await tr.run('/bin/sleep', ['600.777']); })().catch((e) => e.message);
  await new Promise((x) => setTimeout(x, 300));
  tr.stop();
  const { survivors } = await tr.killAll();
  assert.deepEqual(survivors, []);
  assert.equal(await stage, 'probe is stopping');
  assert.equal(execFileSync('/bin/ps', ['-axo', 'args='], { encoding: 'utf8' }).includes('sleep 600.777'), false);
  assert.throws(() => tr.spawn('/bin/true', []), /stopping/);
});
test('run survives a child that exits without reading its stdin', async (t) => {
  const r = root(t); const tr = tracker(r);
  assert.equal((await tr.run(process.execPath, ['--version'])).exit, 0);
  assert.equal((await tr.run('/bin/sh', ['-c', 'exit 0'], { input: 'x'.repeat(4 * 1024 * 1024) })).exit, 0);
  assert.equal((await tr.run('/bin/sh', ['-c', 'head -c 1 >/dev/null'], { input: 'y'.repeat(4 * 1024 * 1024) })).exit, 0);
});
test('kill is idempotent and a group is retired when its last member exits', async (t) => {
  const r = root(t); const tr = tracker(r);
  const c = tr.spawn('/bin/sh', ['-c', 'sleep 0.3 & exit 0'], { stdio: 'ignore' });
  await new Promise((x) => setTimeout(x, 1000));
  assert.equal(readFileSync(join(r, 'pids'), 'utf8'), '');
  await tr.kill(c.pid); await tr.kill(c.pid);
});
test('killAll reaches grandchildren and forgets only emptied groups', async (t) => {
  const r = root(t); const tr = tracker(r);
  const child = tr.spawn('/bin/sh', ['-c', 'sleep 600.321 & sleep 600.654; true'], { stdio: 'ignore' });
  await new Promise((x) => setTimeout(x, 300));
  assert.match(readFileSync(join(r, 'pids'), 'utf8'), new RegExp(`^-${child.pid}$`, 'm'));
  assert.deepEqual((await tr.killAll()).survivors, []);
  assert.equal(execFileSync('/bin/ps', ['-axo', 'args='], { encoding: 'utf8' }).includes('sleep 600.321'), false);
  assert.equal(execFileSync('/bin/ps', ['-axo', 'args='], { encoding: 'utf8' }).includes('sleep 600.654'), false);
  assert.equal(readFileSync(join(r, 'pids'), 'utf8'), '');
});
test('capture comparison flags a cut row and a clean row', () => {
  assert.deepEqual(compareCapture('12 1 ?? Thu Sep 25 07:31:02 2026 /Users/u/.local/share/cl', '12 1 ?? Thu Sep 25 07:31:02 2026 /Users/u/.local/share/claude/versions/2.1.282'),
    { relay_len: 57, ww_len: 78, truncated: true, relay_is_prefix: true });
  assert.equal(compareCapture('a', 'a').truncated, false);
  assert.equal(rowFor('  7 1 x\n 12 1 y\n', 12), '12 1 y');
});
test('a constructed codex parent publishes its own qualified handle and stays alive', async (t) => {
  // Not the generic root(t) helper: its rmSync must run only after every owned group is
  // killed, so this test's own t.after does both, in that order, instead of two independently
  // ordered hooks (node:test runs t.after in registration order, not kill-then-remove order).
  const r = mkdtempSync(join(tmpdir(), 'dp-')); prepareRoot(r); const tr = tracker(r);
  t.after(async () => { await tr.killAll(); rmSync(r, { recursive: true, force: true }); });
  const env = isolatedEnv(r); writeFileSync(join(r, 'xdg/relay/subscribers.json'), '{"schema":1,"subscribers":[]}\n', { mode: 0o600 });
  const repo = join(r, 'repo'); mkdirSync(repo); execFileSync('git', ['init', '-q', repo]);
  const installed = installParent(r, join(r, 'p'), 'codex');
  const parent = startParent(tr, { parent: installed, clone: process.cwd(), workdir: join(r, 'w0'), env, plan: { harness: 'codex',
    subscribers: join(r, 'xdg/relay/subscribers.json'), steps: [{ event: 'SessionStart', outerMs: 600000, payload: { session_id: 'k0', cwd: repo } }] } });
  const expected = createProcessOps().handleOf(parent.pid);
  const [step] = await parent.done();
  assert.equal(step.exit, 0);
  assert.deepEqual(step.after.agents['codex:k0'].process, expected);
  // The compiled parent is named by its installed file and outlives its payload.
  assert.equal(execFileSync('/bin/ps', ['-p', String(parent.pid), '-o', 'comm='], { encoding: 'utf8' }).trim(), 'codex');
  await new Promise((x) => setTimeout(x, 300));
  assert.equal(createProcessOps().probe(expected).status, 'alive');
});
test('the parent is compiled once per root and every install is a copy of it', (t) => {
  const r = root(t), built = buildParent(r);
  assert.equal(built, join(r, 'bin/parent')); assert.equal(buildParent(r), built);
  const a = installParent(r, join(r, 'sp ace'), 's h');
  assert.equal(a, join(r, 'sp ace/s h')); assert.equal(statSync(a).mode & 0o777, 0o755);
  assert.deepEqual(readFileSync(a), readFileSync(built));
  // A reinstall is a fresh inode: macOS caches code-signature data per vnode, and an executed
  // binary rewritten in place is killed on its next launch.
  // A second link pins the old inode, so the filesystem cannot hand its number straight back.
  const old = join(r, 'old'); linkSync(a, old);
  assert.equal(installParent(r, join(r, 'sp ace'), 's h'), a); assert.notEqual(statSync(a).ino, statSync(old).ino);
});
test('a parent that runs its payload passes the check and leaves nothing behind', async (t) => {
  const r = mkdtempSync(join(tmpdir(), 'dp-')); prepareRoot(r); const tr = tracker(r);
  t.after(async () => { await tr.killAll(); rmSync(r, { recursive: true, force: true }); });
  await checkParent(tr, r, isolatedEnv(r));
  assert.deepEqual((await tr.killAll()).survivors, []);
  assert.equal(execFileSync('/bin/ps', ['-axo', 'args='], { encoding: 'utf8' }).includes(join(r, 'pcheck/codex')), false);
});
test('a parent that cannot run its payload is one error line within five seconds', async (t) => {
  const r = mkdtempSync(join(tmpdir(), 'dp-')); prepareRoot(r); const tr = tracker(r);
  t.after(async () => { await tr.killAll(); rmSync(r, { recursive: true, force: true }); });
  const junk = join(r, 'junk'); writeFileSync(junk, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 3]));
  const started = Date.now();
  await assert.rejects(checkParent(tr, r, isolatedEnv(r), junk), (e) => /^constructed parent could not run: /.test(e.message) && !e.message.includes('\n'));
  assert.ok(Date.now() - started < 5500, `${Date.now() - started}ms`);
  assert.deepEqual((await tr.killAll()).survivors, []);
});
test('a missing cc is one error line naming cc', (t) => {
  const r = root(t); const saved = process.env.PATH; process.env.PATH = join(r, 'nothing');
  t.after(() => { process.env.PATH = saved; });
  assert.throws(() => buildParent(r), (e) => /^cc /.test(e.message) && !e.message.includes('\n'));
});
test('a failed build names cc, its exit and the first line of its stderr', (t) => {
  const r = root(t), fake = join(r, 'fakebin'); mkdirSync(fake);
  writeFileSync(join(fake, 'cc'), '#!/bin/sh\necho "parent.c:1: error: first" >&2\necho "second line" >&2\nexit 1\n', { mode: 0o755 });
  const saved = process.env.PATH; process.env.PATH = `${fake}:${saved}`;
  t.after(() => { process.env.PATH = saved; });
  assert.throws(() => buildParent(r), { message: 'cc could not build the constructed parent: exit 1: parent.c:1: error: first' });
});
test('a constructed parent that exits fails its wait at once', async (t) => {
  const r = mkdtempSync(join(tmpdir(), 'dp-')); prepareRoot(r); const tr = tracker(r);
  t.after(async () => { await tr.killAll(); rmSync(r, { recursive: true, force: true }); });
  // The compiled parent with a payload that does not exist: exec fails and it exits 127.
  const exiting = join(r, 'exiting-parent');
  writeFileSync(exiting, `#!/bin/sh\nexec '${buildParent(r)}' '${join(r, 'no-such-command')}'\n`, { mode: 0o755 });
  const parent = startParent(tr, { parent: exiting, clone: process.cwd(), workdir: join(r, 'w0'), env: isolatedEnv(r), timeoutMs: 20000,
    plan: { harness: 'codex', subscribers: join(r, 'xdg/relay/subscribers.json'), steps: [] } });
  const started = Date.now();
  await assert.rejects(parent.done(), { message: `parent ${parent.pid} exited before finishing (code=127, signal=null)` });
  assert.ok(Date.now() - started < 2000, `${Date.now() - started}ms`);
});
test('a fleet waits longer the more agents are live', () => {
  assert.equal(fleetTimeoutMs(1, 0), 32000); assert.equal(fleetTimeoutMs(50, 0), 130000); assert.equal(fleetTimeoutMs(1, 50), 132000);
});
test('a child that cannot start records its spawn error instead of crashing the probe', async (t) => {
  const r = root(t); const tr = tracker(r);
  const child = tr.spawn(join(r, 'no-such-program'), [], { stdio: 'ignore' });
  assert.equal(child.pid, undefined);
  await new Promise((x) => setImmediate(x));
  assert.equal(child.spawnError?.code, 'ENOENT');
  assert.throws(() => requireStarted(child, join(r, 'no-such-program')), /cannot start no-such-program: ENOENT/);
});
test('a hidden paste skips a leading newline, keeps the first line, and Enter alone is empty', async () => {
  const chunks = (...xs) => (async function* () { yield* xs.map((x) => Buffer.from(x)); })();
  assert.equal(await readHidden(chunks('\nsk-ant-oat01-abc\n')), 'sk-ant-oat01-abc');
  assert.equal(await readHidden(chunks('sk-ant-', 'oat01-abc', '\r')), 'sk-ant-oat01-abc');
  assert.equal(await readHidden(chunks('\r')), '');
  assert.equal(await readHidden(chunks('abc', '\u0003')), '');
  assert.equal(await readHidden(chunks('first\nsecond\n')), 'first');
});
