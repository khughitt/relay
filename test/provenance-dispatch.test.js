import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, existsSync, readFileSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { dispatchHook } from '../src/dispatch.js';
import { tempPaths, writeSubscribers } from './helpers/fixture.js';

const fixture = new URL('./fixtures/subscriber.js', import.meta.url).pathname;
const local = { resolveSessionPid: () => process.pid, gitContext: async () => ({ remote: null, repoRoot: null }) };
const NATIVE = { CLAUDE_CODE_SESSION_ID: 'native-claude', CODEX_THREAD_ID: '01a1e3b5-c74b-7313-8094-95522b977b81', CODEX_SESSION_ID: 'native-codex', TASKS_SESSION: 'native-tasks' };
const denyOut = '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":';

/** A scratch world: event cwd, scratchpad, env file and a key-by-key parent environment with poisoned inherited stamps. */
function world(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'relay-provenance-dispatch-')));
  t.after(() => { try { chmodSync(join(base, 'scratch'), 0o700); } catch {} rmSync(base, { recursive: true, force: true }); });
  for (const d of ['cwd', 'scratch', 'home']) mkdirSync(join(base, d));
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(base, 'home'), CLAUDE_ENV_FILE: join(base, 'env.sh'),
    TASKS_AGENT: 'inherited/agent', TASKS_MODEL: 'inherited-model', ...NATIVE };
  return { base, cwd: join(base, 'cwd'), scratch: join(base, 'scratch'), envFile: env.CLAUDE_ENV_FILE, env, seen: (n) => join(base, `${n}.json`) };
}
const sub = (name, role, kinds, file, harnesses = ['claude-code', 'codex'], extra = []) => ({ name, role, kinds, harnesses, argv: ['node', fixture, 'env-json', file, ...extra], timeoutMs: 3000, ...(role === 'observer' ? { registry: 'snapshot' } : {}) });
const recorder = (name, mode, file) => ({ name, role: 'guard', kinds: ['before-tool'], harnesses: ['claude-code', 'codex'], argv: ['node', fixture, mode, ...(file ? [file] : [])], timeoutMs: 3000 });
async function hook(p, w, { harness = 'claude-code', nativeEvent = 'PreToolUse', body = {} } = {}) {
  const raw = JSON.stringify({ session_id: 'sess', cwd: w.cwd, ...(nativeEvent === 'PreToolUse' ? { tool_name: 'Bash', tool_input: { command: 'echo hi' } } : {}), ...body });
  return dispatchHook({ harness, nativeEvent, input: Readable.from([Buffer.from(raw)]) }, { paths: p, applyOptions: local, env: w.env, invokingCwd: w.cwd });
}
const childEnv = async (file) => JSON.parse(await readFile(file, 'utf8'));
/** The child environment apart from PATH (the launcher resolves it) and the two provenance keys. */
const rest = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !['PATH', 'TASKS_AGENT', 'TASKS_MODEL'].includes(k)));

test('codex events leave subscriber provenance untouched', async (t) => {
  const p = await tempPaths(t), w = world(t);
  await writeSubscribers(p, [sub('g', 'guard', ['before-tool'], w.seen('g'))]);
  const r = await hook(p, w, { harness: 'codex' });
  assert.deepEqual([r.exitCode, r.stderr], [0, '']);
  const env = await childEnv(w.seen('g'));
  assert.deepEqual([env.TASKS_AGENT, env.TASKS_MODEL], ['inherited/agent', 'inherited-model']);
  assert.deepEqual(rest(env), rest(w.env));
  assert.equal(existsSync(w.envFile), false);
});

test('claude events set exactly two subscriber keys', async (t) => {
  const p = await tempPaths(t), w = world(t);
  await writeSubscribers(p, [sub('o', 'observer', ['session-start'], w.seen('o'), ['claude-code'], ['silent']), sub('g', 'guard', ['before-tool'], w.seen('g'))]);
  const start = await hook(p, w, { nativeEvent: 'SessionStart', body: { model: 'm', scratchpad_dir: w.scratch } });
  assert.deepEqual([start.exitCode, start.stderr], [0, '']);
  const started = await childEnv(w.seen('o'));
  assert.deepEqual([started.TASKS_AGENT, started.TASKS_MODEL], ['claude-code/m', 'm']);
  assert.deepEqual(rest(started), rest(w.env));
  assert.equal(readFileSync(join(w.scratch, 'tasks-model'), 'utf8'), 'm');
  assert.match(readFileSync(w.envFile, 'utf8'), /export TASKS_AGENT=/);
  // A tool event carries no model: the inherited stamp is replaced by the bare harness, never copied.
  await hook(p, w);
  const tool = await childEnv(w.seen('g'));
  assert.deepEqual([tool.TASKS_AGENT, tool.TASKS_MODEL], ['claude-code', '']);
  assert.deepEqual(rest(tool), rest(w.env));
});

test('native IDs pass through to subscribers of both harnesses', async (t) => {
  const p = await tempPaths(t), w = world(t);
  await writeSubscribers(p, [sub('g', 'guard', ['before-tool'], w.seen('g'))]);
  for (const harness of ['claude-code', 'codex']) {
    await hook(p, w, { harness });
    const env = await childEnv(w.seen('g'));
    for (const [k, v] of Object.entries(NATIVE)) assert.equal(env[k], v, `${harness} ${k}`);
  }
});

test('the original input reaches every subscriber', async (t) => {
  const p = await tempPaths(t), w = world(t), a = join(w.base, 'a.json'), b = join(w.base, 'b.json');
  await writeSubscribers(p, [recorder('a', 'record', a), recorder('b', 'record', b)]);
  await hook(p, w, { body: { tool_input: { command: 'echo PRIVATE' } } });
  for (const file of [a, b]) {
    const seen = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(seen.event.private.toolInput, { status: 'valid', value: { command: 'echo PRIVATE' } });
    assert.equal(seen.event.harness, 'claude-code');
  }
});

test('a guard denial or failure is unchanged', async (t) => {
  const p = await tempPaths(t), w = world(t);
  await writeSubscribers(p, [recorder('d', 'deny')]);
  const denied = await hook(p, w);
  assert.deepEqual(denied, { stdout: `${denyOut}"denied by fixture"}}\n`, stderr: 'denied by fixture\n', exitCode: 2 });
  await writeSubscribers(p, [recorder('c', 'crash')]);
  const crashed = await hook(p, w);
  assert.equal(crashed.exitCode, 2); assert.ok(crashed.stdout.startsWith(denyOut));
  assert.doesNotMatch(crashed.stderr, /PROVENANCE/);
});

test('a failed provenance write is an advisory diagnostic and subscribers still run', async (t) => {
  const p = await tempPaths(t), w = world(t);
  writeFileSync(join(w.scratch, 'tasks-model'), 'old');
  chmodSync(w.scratch, 0o500);
  await writeSubscribers(p, [sub('o', 'observer', ['model-change'], w.seen('o'), ['claude-code'], ['silent'])]);
  const r = await hook(p, w, { nativeEvent: 'PostModelSwitch', body: { from_model: 'old', to_model: 'new', scratchpad_dir: w.scratch } });
  assert.equal(r.exitCode, 0);
  assert.match(r.stderr, /^PROVENANCE_WRITE_FAILED: PostModelSwitch state-replace E[A-Z]+\n$/);
  const env = await childEnv(w.seen('o'));
  assert.deepEqual([env.TASKS_AGENT, env.TASKS_MODEL], ['claude-code/new', 'new']);
});

test('provenance runs only for claude-code events', async (t) => {
  const p = await tempPaths(t), w = world(t);
  await writeSubscribers(p, [sub('g', 'guard', ['before-tool'], w.seen('g'))]);
  let calls = 0;
  const provenance = async () => { calls++; throw new Error('provenance must not run'); };
  const raw = JSON.stringify({ session_id: 'sess', cwd: w.cwd, tool_name: 'Bash', tool_input: { command: 'echo hi' } });
  const r = await dispatchHook({ harness: 'codex', nativeEvent: 'PreToolUse', input: Readable.from([Buffer.from(raw)]) }, { paths: p, applyOptions: local, env: w.env, invokingCwd: w.cwd, provenance });
  assert.deepEqual([r.exitCode, r.stderr, calls], [0, '', 0]);
});

test('an unexpected provenance error is labelled apart from the deadline', async (t) => {
  const p = await tempPaths(t), w = world(t);
  await writeSubscribers(p, [sub('g', 'guard', ['before-tool'], w.seen('g'))]);
  const raw = JSON.stringify({ session_id: 'sess', cwd: w.cwd, tool_name: 'Bash', tool_input: { command: 'echo hi' } });
  const provenance = async () => { throw new TypeError('bug'); };
  const r = await dispatchHook({ harness: 'claude-code', nativeEvent: 'PreToolUse', input: Readable.from([Buffer.from(raw)]) }, { paths: p, applyOptions: local, env: w.env, invokingCwd: w.cwd, provenance });
  assert.deepEqual([r.exitCode, r.stderr], [0, 'PROVENANCE_WRITE_FAILED: PreToolUse unexpected\n']);
  const env = await childEnv(w.seen('g'));
  assert.deepEqual([env.TASKS_AGENT, env.TASKS_MODEL], ['claude-code', '']);
});

test('a hung provenance write ends at its own budget and leaves the rest of the deadline to subscribers', async (t) => {
  const p = await tempPaths(t), w = world(t);
  await writeSubscribers(p, [sub('g', 'guard', ['before-tool'], w.seen('g'))]);
  const raw = JSON.stringify({ session_id: 'sess', cwd: w.cwd, tool_name: 'Bash', tool_input: { command: 'echo hi' } });
  const provenance = () => new Promise(() => {});
  const began = performance.now();
  const r = await dispatchHook({ harness: 'claude-code', nativeEvent: 'PreToolUse', input: Readable.from([Buffer.from(raw)]), outerMs: 30000 }, { paths: p, applyOptions: local, env: w.env, invokingCwd: w.cwd, provenance });
  assert.deepEqual([r.exitCode, r.stderr], [0, 'PROVENANCE_WRITE_FAILED: PreToolUse deadline\n']);
  assert.ok(performance.now() - began < 10000, 'provenance did not consume the whole work deadline');
  const env = await childEnv(w.seen('g'));
  assert.deepEqual([env.TASKS_AGENT, env.TASKS_MODEL], ['claude-code', '']);
});
