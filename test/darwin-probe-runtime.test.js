import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isolatedEnv, prepareRoot, registryFor, tracker, fingerprint, changedPaths, WATCHED_FILES, WATCHED_TREES } from '../tools/darwin-probe/lib/context.mjs';
import { compareCapture, rowFor } from '../tools/darwin-probe/lib/ps.mjs';
import { installShell, startParent } from '../tools/darwin-probe/lib/parents.mjs';
import { createProcessOps } from '../src/index.js';

const root = (t) => { const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
test('isolation sets every redirect and drops COLUMNS and session variables', (t) => {
  const r = root(t), env = isolatedEnv(r, { HOME: '/h', COLUMNS: '80', CLAUDE_CODE_SESSION_ID: 'x', PATH: '/bin' });
  for (const k of ['RELAY_STATE_DIR','XDG_CONFIG_HOME','XDG_STATE_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','CLAUDE_CONFIG_DIR','CODEX_HOME']) assert.ok(env[k].startsWith(r), k);
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
  const r = root(t); prepareRoot(r); const tr = tracker(r); t.after(() => tr.killAll());
  const env = isolatedEnv(r); writeFileSync(join(r, 'xdg/relay/subscribers.json'), '{"schema":1,"subscribers":[]}\n', { mode: 0o600 });
  const repo = join(r, 'repo'); mkdirSync(repo); execFileSync('git', ['init', '-q', repo]);
  const shell = installShell(join(r, 'p'), 'codex');
  const parent = startParent(tr, { shell, clone: process.cwd(), workdir: join(r, 'w0'), env, plan: { harness: 'codex',
    subscribers: join(r, 'xdg/relay/subscribers.json'), steps: [{ event: 'SessionStart', outerMs: 600000, payload: { session_id: 'k0', cwd: repo } }] } });
  const expected = createProcessOps().handleOf(parent.pid);
  const [step] = await parent.done();
  assert.equal(step.exit, 0);
  assert.deepEqual(step.after.agents['codex:k0'].process, expected);
  assert.equal(createProcessOps().probe(expected).status, 'alive');
});
