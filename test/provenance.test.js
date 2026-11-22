import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeHookEvent } from '../src/adapters/hook-event.js';

const { prepareClaudeProvenance } = await import('../src/provenance.js').catch((e) => {
  if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e;
});

/** A disposable directory with a scratchpad and an env-file location. */
function world(t, name = 'scratch') {
  const base = mkdtempSync(join(tmpdir(), 'relay-provenance-'));
  t.after(() => { chmodTree(base); rmSync(base, { recursive: true, force: true }); });
  const scratch = join(base, name); mkdirSync(scratch, { recursive: true });
  return { base, scratch, state: join(scratch, 'tasks-model'), envFile: join(base, 'env.sh'), home: join(base, 'home') };
}
function chmodTree(dir) { try { chmodSync(dir, 0o700); for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) chmodTree(join(dir, e.name)); } catch {} }
const claude = (nativeEvent, over = {}) => normalizeHookEvent('claude-code', nativeEvent, JSON.stringify({ session_id: 'native-session', cwd: '/repo', ...over }), { invokingCwd: '/repo' });
const prepare = (event, env = {}, io) => prepareClaudeProvenance({ event, env }, io === undefined ? {} : { io });
const BARE = { TASKS_AGENT: 'claude-code', TASKS_MODEL: '' };
const SHELLS = ['/bin/bash', '/usr/bin/zsh', '/usr/bin/dash'].filter((s) => existsSync(s));
const nativeEnv = { CLAUDE_CODE_SESSION_ID: 'native-session', TASKS_SESSION: 'native-tasks-session' };

/** What a Bash command sees after Claude Code sources the env file, built key by key with poisoned inherited stamps. */
function sourced(w, { shell = '/bin/bash' } = {}) {
  mkdirSync(w.home, { recursive: true });
  const env = { PATH: '/usr/bin:/bin', HOME: w.home, LC_ALL: 'C.UTF-8', TASKS_AGENT: 'inherited/agent', TASKS_MODEL: 'inherited-model', ...nativeEnv };
  const r = spawnSync(shell, ['-c', '. "$1"; printf "%s|%s|%s|%s" "$TASKS_AGENT" "$TASKS_MODEL" "$CLAUDE_CODE_SESSION_ID" "$TASKS_SESSION"', 'sh', w.envFile], { env, encoding: 'utf8', cwd: w.base });
  assert.equal(r.status, 0, r.stderr);
  const [agent, model, session, tasksSession] = r.stdout.split('|');
  return { agent, model, session, tasksSession, stderr: r.stderr };
}
const failing = (op, code) => ({ ...fsp, [op]: async () => { throw Object.assign(new Error(`injected ${op}`), { code }); } });
const noWrites = Object.fromEntries(['writeFile', 'appendFile', 'rename', 'unlink', 'open', 'mkdir'].map((op) => [op, async () => { throw Object.assign(new Error(`${op} attempted`), { code: 'EWRITE' }); }]));

test('startup exports the native model without changing native IDs', async (t) => {
  assert.equal(typeof prepareClaudeProvenance, 'function');
  const w = world(t);
  const prepared = await prepare(claude('SessionStart', { model: 'm', scratchpad_dir: w.scratch }), { CLAUDE_ENV_FILE: w.envFile, ...nativeEnv });
  assert.deepEqual(prepared.values, { TASKS_AGENT: 'claude-code/m', TASKS_MODEL: 'm' });
  assert.deepEqual(prepared.diagnostics, []);
  assert.equal(readFileSync(w.state, 'utf8'), 'm');
  assert.equal(statSync(w.state).mode & 0o777, 0o600);
  assert.doesNotMatch(readFileSync(w.envFile, 'utf8'), /SESSION/);
  for (const shell of SHELLS) {
    const shellEnv = sourced(w, { shell });
    assert.deepEqual([shellEnv.agent, shellEnv.model, shellEnv.stderr], ['claude-code/m', 'm', ''], shell);
    assert.equal(shellEnv.session, nativeEnv.CLAUDE_CODE_SESSION_ID);
    assert.equal(shellEnv.tasksSession, nativeEnv.TASKS_SESSION);
  }
});

test('startup appends one stanza and preserves existing env-file content', async (t) => {
  const w = world(t);
  writeFileSync(w.envFile, 'export OTHER=1\n');
  await prepare(claude('SessionStart', { model: 'm', scratchpad_dir: w.scratch }), { CLAUDE_ENV_FILE: w.envFile });
  const text = readFileSync(w.envFile, 'utf8');
  assert.ok(text.startsWith('export OTHER=1\n'));
  assert.equal(text.split('\n').filter(Boolean).length, 3, text);
  assert.equal(sourced(w).model, 'm');
});

test('startup starts its stanza on a new line when the env file lacks a final newline', async (t) => {
  const w = world(t);
  writeFileSync(w.envFile, 'export OTHER=1');
  await prepare(claude('SessionStart', { model: 'm', scratchpad_dir: w.scratch }), { CLAUDE_ENV_FILE: w.envFile });
  const text = readFileSync(w.envFile, 'utf8');
  assert.ok(text.startsWith('export OTHER=1\nTASKS_MODEL=;'), text);
  assert.equal(sourced(w).model, 'm');
  // A terminated or empty file gets no blank line.
  for (const before of ['', 'export OTHER=1\n']) {
    writeFileSync(w.envFile, before);
    await prepare(claude('SessionStart', { model: 'm', scratchpad_dir: w.scratch }), { CLAUDE_ENV_FILE: w.envFile });
    assert.ok(readFileSync(w.envFile, 'utf8').startsWith(`${before}TASKS_MODEL=;`), JSON.stringify(before));
  }
});

test('a model switch updates the state and the next command follows, without touching the env file', async (t) => {
  const w = world(t);
  await prepare(claude('SessionStart', { model: 'a', scratchpad_dir: w.scratch }), { CLAUDE_ENV_FILE: w.envFile });
  const before = readFileSync(w.envFile, 'utf8');
  const switched = await prepare(claude('PostModelSwitch', { from_model: 'a', to_model: 'b', scratchpad_dir: w.scratch }), { CLAUDE_ENV_FILE: w.envFile });
  assert.deepEqual(switched, { values: { TASKS_AGENT: 'claude-code/b', TASKS_MODEL: 'b' }, diagnostics: [] });
  assert.equal(readFileSync(w.envFile, 'utf8'), before);
  assert.equal(readFileSync(w.state, 'utf8'), 'b');
  assert.deepEqual([sourced(w).agent, sourced(w).model], ['claude-code/b', 'b']);
});

test('a missing or invalid model removes the state and exports the bare harness', async (t) => {
  const w = world(t);
  for (const over of [{}, { model: 'has space' }, { model: 'at@sign' }, { model: '' }]) {
    writeFileSync(w.state, 'stale');
    const r = await prepare(claude('SessionStart', { ...over, scratchpad_dir: w.scratch }), { CLAUDE_ENV_FILE: w.envFile });
    assert.deepEqual(r.values, BARE, JSON.stringify(over));
    assert.equal(existsSync(w.state), false, JSON.stringify(over));
    assert.deepEqual([sourced(w).agent, sourced(w).model], ['claude-code', '']);
  }
  for (const over of [{ from_model: 'a' }, { from_model: 'a', to_model: 'bad model' }]) {
    writeFileSync(w.state, 'a');
    const r = await prepare(claude('PostModelSwitch', { ...over, scratchpad_dir: w.scratch }), {});
    assert.deepEqual(r.values, BARE);
    assert.equal(existsSync(w.state), false);
  }
});

test('a missing or invalid scratchpad writes no state anywhere', async (t) => {
  const w = world(t);
  writeFileSync(w.state, 'stale');
  const none = await prepare(claude('SessionStart', { model: 'm' }), { CLAUDE_ENV_FILE: w.envFile });
  assert.deepEqual(none.values, { TASKS_AGENT: 'claude-code/m', TASKS_MODEL: 'm' });
  assert.deepEqual([sourced(w).agent, sourced(w).model], ['claude-code', '']);
  const relative = await prepare(claude('SessionStart', { model: 'm', scratchpad_dir: 'relative/dir' }), { CLAUDE_ENV_FILE: w.envFile });
  assert.deepEqual(relative.diagnostics, ['PROVENANCE_INVALID_PATH: SessionStart scratchpad']);
  const switched = await prepare(claude('PostModelSwitch', { to_model: 'b' }), {});
  assert.deepEqual(switched.diagnostics, []);
  assert.equal(readFileSync(w.state, 'utf8'), 'stale');
  assert.deepEqual(readdirSync(w.base).sort(), ['env.sh', 'home', 'scratch']);
});

test('no env file means no persistent write is attempted', async (t) => {
  const w = world(t);
  writeFileSync(w.state, 'stale');
  for (const env of [{}, { CLAUDE_ENV_FILE: '' }, { CLAUDE_ENV_FILE: 'relative.sh' }]) {
    const r = await prepare(claude('SessionStart', { model: 'm', scratchpad_dir: w.scratch }), env, { ...fsp, ...noWrites });
    assert.deepEqual(r.values, { TASKS_AGENT: 'claude-code/m', TASKS_MODEL: 'm' });
    assert.deepEqual(r.diagnostics, env.CLAUDE_ENV_FILE === 'relative.sh' ? ['PROVENANCE_INVALID_PATH: SessionStart env-file'] : []);
    assert.equal(existsSync(w.envFile), false);
    assert.equal(readFileSync(w.state, 'utf8'), 'stale');
  }
});

test('unreadable or corrupt state reads as the bare harness with a bounded diagnostic', async (t) => {
  const w = world(t);
  await prepare(claude('SessionStart', { model: 'm', scratchpad_dir: w.scratch }), { CLAUDE_ENV_FILE: w.envFile });
  for (const shell of SHELLS) {
    for (const [content, mode] of [['has space', 0o600], ['m\nsecond', 0o600], ['', 0o600], [Buffer.from([0xff, 0xfe]), 0o600], ['at@sign', 0o600], ['m', 0o000]]) {
      writeFileSync(w.state, content); chmodSync(w.state, mode);
      const seen = sourced(w, { shell });
      assert.deepEqual([seen.agent, seen.model], ['claude-code', ''], `${shell} ${JSON.stringify(String(content))} ${mode}`);
      assert.equal(seen.stderr, 'relay: tasks-model state is unreadable or invalid; model cleared\n', shell);
      chmodSync(w.state, 0o600);
    }
    rmSync(w.state);
    const absent = sourced(w, { shell });
    assert.deepEqual([absent.agent, absent.model, absent.stderr], ['claude-code', '', ''], shell);
    writeFileSync(w.state, 'm');
  }
});

test('failed switch write claims no delivery', async (t) => {
  const w = world(t);
  await prepare(claude('SessionStart', { model: 'a', scratchpad_dir: w.scratch }), { CLAUDE_ENV_FILE: w.envFile });
  const replace = await prepare(claude('PostModelSwitch', { to_model: 'b', scratchpad_dir: w.scratch }), {}, failing('rename', 'EACCES'));
  assert.deepEqual(replace.diagnostics, ['PROVENANCE_WRITE_FAILED: PostModelSwitch state-replace EACCES']);
  // Known advisory limit: the old state stayed readable, so commands keep the old model.
  assert.equal(sourced(w).model, 'a');
  assert.deepEqual(readdirSync(w.scratch), ['tasks-model'], 'no temporary state is left behind');
  const remove = await prepare(claude('PostModelSwitch', { scratchpad_dir: w.scratch }), {}, failing('unlink', 'EPERM'));
  assert.deepEqual(remove.diagnostics, ['PROVENANCE_WRITE_FAILED: PostModelSwitch state-remove EPERM']);
  const append = await prepare(claude('SessionStart', { model: 'c', scratchpad_dir: w.scratch }), { CLAUDE_ENV_FILE: w.envFile }, failing('appendFile', 'ENOSPC'));
  assert.deepEqual(append.diagnostics, ['PROVENANCE_WRITE_FAILED: SessionStart env-append ENOSPC']);
  for (const d of [...replace.diagnostics, ...remove.diagnostics, ...append.diagnostics]) assert.doesNotMatch(d, /scratch|tasks-model|env\.sh|\bb\b|\bc\b/);
  // A real unwritable scratchpad is advisory too; a later successful switch repairs the state.
  chmodSync(w.scratch, 0o500);
  const locked = await prepare(claude('PostModelSwitch', { to_model: 'd', scratchpad_dir: w.scratch }), {});
  assert.match(locked.diagnostics[0], /^PROVENANCE_WRITE_FAILED: PostModelSwitch state-replace E[A-Z]+$/);
  chmodSync(w.scratch, 0o700);
  assert.deepEqual((await prepare(claude('PostModelSwitch', { to_model: 'e', scratchpad_dir: w.scratch }), {})).diagnostics, []);
  assert.equal(sourced(w).model, 'e');
});

test('the state is replaced through a private temporary file', async (t) => {
  const w = world(t), calls = [];
  const io = { ...fsp,
    writeFile: async (p, data, opts) => { calls.push(['writeFile', p, opts?.mode]); return fsp.writeFile(p, data, opts); },
    rename: async (a, b) => { calls.push(['rename', a, b]); return fsp.rename(a, b); } };
  await prepare(claude('PostModelSwitch', { to_model: 'b', scratchpad_dir: w.scratch }), {}, io);
  assert.equal(calls.length, 2);
  const [[, temp, mode], [, from, to]] = calls;
  assert.notEqual(temp, w.state); assert.equal(from, temp); assert.equal(to, w.state); assert.equal(mode, 0o600);
  assert.equal(statSync(w.state).mode & 0o777, 0o600);
});

test('repeat starts append a stanza each and the latest model wins', async (t) => {
  const w = world(t);
  await prepare(claude('SessionStart', { model: 'm1', scratchpad_dir: w.scratch }), { CLAUDE_ENV_FILE: w.envFile });
  await prepare(claude('SessionStart', { model: 'm2', scratchpad_dir: w.scratch, source: 'resume' }), { CLAUDE_ENV_FILE: w.envFile });
  assert.equal(readFileSync(w.envFile, 'utf8').match(/^export TASKS_AGENT=/gm).length, 2);
  assert.equal(sourced(w).model, 'm2');
});

test('two sessions keep separate state', async (t) => {
  const a = world(t, 'a'), b = world(t, 'b');
  await prepare(claude('SessionStart', { model: 'ma', scratchpad_dir: a.scratch }), { CLAUDE_ENV_FILE: a.envFile });
  await prepare(claude('SessionStart', { session_id: 'other', model: 'mb', scratchpad_dir: b.scratch }), { CLAUDE_ENV_FILE: b.envFile });
  await prepare(claude('PostModelSwitch', { to_model: 'ma2', scratchpad_dir: a.scratch }), {});
  assert.deepEqual([sourced(a).model, sourced(b).model], ['ma2', 'mb']);
});

test('hostile paths and model text stay data', async (t) => {
  const w = world(t, 'it\'s $(touch PWN1) `touch PWN2` "q"\nline');
  const model = '$(touch${IFS}PWN3);\'"`touch${IFS}PWN4`';
  const r = await prepare(claude('SessionStart', { model, scratchpad_dir: w.scratch }), { CLAUDE_ENV_FILE: w.envFile });
  assert.deepEqual(r.values, { TASKS_AGENT: `claude-code/${model}`, TASKS_MODEL: model });
  for (const shell of SHELLS) {
    const seen = sourced(w, { shell });
    assert.deepEqual([seen.agent, seen.model, seen.stderr], [`claude-code/${model}`, model, ''], shell);
  }
  for (const marker of ['PWN1', 'PWN2', 'PWN3', 'PWN4']) assert.equal(existsSync(join(w.base, marker)), false, marker);
});

test('events from other harnesses produce no values or effects', async (t) => {
  const w = world(t);
  const codex = normalizeHookEvent('codex', 'SessionStart', JSON.stringify({ session_id: 's', cwd: '/repo', model: 'gpt' }), { invokingCwd: '/repo' });
  assert.deepEqual(await prepare(codex, { CLAUDE_ENV_FILE: w.envFile }), { values: null, diagnostics: [] });
  assert.equal(existsSync(w.envFile), false);
});

test('other Claude events carry the bare harness and have no effects', async (t) => {
  const w = world(t);
  writeFileSync(w.state, 'a');
  for (const [nativeEvent, over] of [['PreToolUse', { tool_name: 'Bash', tool_input: { command: 'x' } }], ['Stop', {}], ['SubagentStart', { agent_id: 'child', agent_type: 'general' }]]) {
    const r = await prepare(claude(nativeEvent, over), { CLAUDE_ENV_FILE: w.envFile, TASKS_MODEL: 'inherited', TASKS_AGENT: 'claude-code/inherited' });
    assert.deepEqual(r, { values: BARE, diagnostics: [] }, nativeEvent);
  }
  assert.equal(existsSync(w.envFile), false);
  assert.equal(readFileSync(w.state, 'utf8'), 'a');
});

test('a differing-model Claude child inherits the parent stamp, which is not child evidence', async (t) => {
  // The env file is session-wide: a subagent running another model sources the parent's exports.
  // relay-d519ef owns child-bound provenance; nothing here labels the inherited stamp verified.
  const w = world(t);
  const parent = await prepare(claude('SessionStart', { model: 'parent-model', scratchpad_dir: w.scratch }), { CLAUDE_ENV_FILE: w.envFile });
  const child = await prepare(claude('SubagentStart', { agent_id: 'child', agent_type: 'general', model: 'child-model' }), { CLAUDE_ENV_FILE: w.envFile });
  assert.deepEqual(child.values, BARE);
  assert.equal(sourced(w).model, 'parent-model');
  for (const values of [parent.values, child.values]) assert.deepEqual(Object.keys(values ?? {}), ['TASKS_AGENT', 'TASKS_MODEL']);
});
