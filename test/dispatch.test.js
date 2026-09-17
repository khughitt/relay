import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import * as fs from 'node:fs/promises';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { dispatchHook } from '../src/dispatch.js';
import { withLock } from '../src/bus/lock.js';
import { createProcessOps } from '../src/bus/proc.js';
import { readSnapshot, applyEvent } from '../src/bus/transaction.js';
import { normalizeEvent } from '../src/adapters/index.js';
import { relayError } from '../src/protocol.js';
import { tempPaths, writeSubscribers } from './helpers/fixture.js';

const fixture = new URL('./fixtures/subscriber.js', import.meta.url).pathname;
const argv = (mode, ...rest) => [process.execPath, fixture, mode, ...rest];
const guard = (name, mode, over = {}) => ({ name, role: 'guard', kinds: ['before-tool'], harnesses: ['claude-code', 'codex'], argv: argv(mode, ...(over.file ? [over.file] : [])), timeoutMs: 3000, ...over, file: undefined });
const strip = (s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
const payload = (over = {}) => JSON.stringify({ session_id: 'sess', cwd: '/repo', tool_name: 'Bash', tool_input: { command: 'echo PRIVATE_COMMAND' }, ...over });
const local = { resolveAgentPid: () => process.pid, gitContext: async () => ({ remote: null, repoRoot: null }) };
async function hook(p, { harness = 'claude-code', nativeEvent = 'PreToolUse', body = payload(), outerMs, deps = {} } = {}) {
  return dispatchHook({ harness, nativeEvent, input: Readable.from([Buffer.from(body)]), outerMs }, { paths: p, applyOptions: local, ...deps });
}
const denyOut = '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":';
const absent = async (path) => access(path).then(() => false, () => true);
const published = { snapshot: { schema: 1, generation: '00000000-0000-4000-8000-000000000000', revision: 1, agents: {} }, changed: true, reaped: [], diagnostics: [] };
const slow = (value, ms) => () => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test('no subscribers: the event publishes and the reply is an empty allow', async (t) => {
  const p = await tempPaths(t);
  const r = await hook(p);
  assert.deepEqual(r, { stdout: '', stderr: '', exitCode: 0 });
  const snapshot = await readSnapshot({ paths: p });
  assert.equal(snapshot.agents['claude-code:sess'].state, 'working');
  assert.equal((await readFile(p.agentsPath, 'utf8')).includes('PRIVATE_COMMAND'), false);
});

test('guards run in order before any registry work and the first denial wins', async (t) => {
  const p = await tempPaths(t), files = ['a', 'b', 'c'].map((n) => join(p.stateDir, '..', `${n}.json`));
  await writeSubscribers(p, [strip(guard('a', 'record', { file: files[0] })), guard('b', 'deny'), strip(guard('c', 'record', { file: files[2] })), guard('d', 'context')].map(strip));
  const started = performance.now(), r = await hook(p);
  assert.equal(r.exitCode, 2); assert.equal(r.stdout, `${denyOut}"denied by fixture"}}\n`); assert.equal(r.stderr, 'denied by fixture\n');
  assert.ok(await absent(p.agentsPath), 'a denial never touches the registry');
  assert.ok(await absent(p.lockPath));
  const seen = JSON.parse(await readFile(files[0], 'utf8'));
  assert.deepEqual(Object.keys(seen).sort(), ['event', 'schema', 'subscriber', 'type']);
  assert.equal(seen.subscriber, 'a'); assert.equal(seen.type, 'event');
  assert.deepEqual(seen.event.tool, { name: 'Bash', input: { command: 'echo PRIVATE_COMMAND' }, command: 'echo PRIVATE_COMMAND' });
  assert.equal((await readFile(files[2], 'utf8')).length > 0, true, 'guards after a denial still run');
  assert.ok(performance.now() - started < 3000);
});

test('allow replies concatenate context in configuration order and honor the channel', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [guard('one', 'context', { argv: argv('context', 'one') }), guard('two', 'allow'), guard('three', 'context', { argv: argv('context', 'three') })].map(strip));
  const r = await hook(p);
  assert.deepEqual(r, { stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"context from one\\ncontext from three"}}\n', stderr: '', exitCode: 0 });
  await writeSubscribers(p, [strip(guard('prompt', 'context', { kinds: ['prompt'], argv: argv('context', 'p') }))]);
  const prompt = await hook(p, { nativeEvent: 'UserPromptSubmit', body: JSON.stringify({ session_id: 'sess', cwd: '/repo' }) });
  assert.equal(prompt.stdout, '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"context from p"}}\n');
  await writeSubscribers(p, [strip(guard('stop', 'context', { kinds: ['turn-end'] }))]);
  const stop = await hook(p, { nativeEvent: 'Stop', body: JSON.stringify({ session_id: 'sess', cwd: '/repo', stop_hook_active: true }) });
  assert.equal(stop.exitCode, 2); assert.match(stop.stdout, /^\{"decision":"block","reason":"relay refused: UNSUPPORTED_REPLY: /);
});

test('every guard failure relay survives is a native refusal', async (t) => {
  const p = await tempPaths(t);
  const cases = [['hang', 'GUARD_FAILED', { timeoutMs: 300 }], ['crash', 'GUARD_FAILED'], ['garbage', 'INVALID_REPLY'], ['extra-field', 'INVALID_REPLY'],
    ['unreasoned', 'INVALID_REPLY'], ['big-context', 'INVALID_REPLY'], ['big', 'GUARD_FAILED'], ['missing', 'GUARD_FAILED', { argv: ['/nonexistent/guard'] }]];
  for (const [mode, code, over = {}] of cases) {
    await writeSubscribers(p, [strip(guard('g', mode, over))]);
    const r = await hook(p);
    assert.equal(r.exitCode, 2, mode); assert.ok(r.stdout.startsWith(`${denyOut}"relay refused: ${code}: `), `${mode}: ${r.stdout}`);
    assert.equal(r.stderr, `${JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason}\n`);
    assert.ok(await absent(p.agentsPath), mode);
  }
  await writeSubscribers(p, [strip(guard('g', 'deny-context'))]);
  const r = await hook(p); assert.equal(r.stdout, `${denyOut}"denied by fixture"}}\n`);
});

test('mixed allow and deny with an erroring guard still refuses with the denial reason', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [guard('a', 'allow'), guard('b', 'crash'), guard('c', 'deny')].map(strip));
  const r = await hook(p); assert.equal(r.stdout, `${denyOut}"denied by fixture"}}\n`);
  await writeSubscribers(p, [guard('a', 'allow'), guard('b', 'crash')].map(strip));
  assert.match((await hook(p)).stdout, /relay refused: GUARD_FAILED: guard b exited 3/);
});

test('an expired deadline refuses before running the remaining guards', async (t) => {
  const p = await tempPaths(t), never = join(p.stateDir, '..', 'never');
  await writeSubscribers(p, [strip(guard('slow', 'slow', { argv: argv('slow', '400'), timeoutMs: 150 })), strip(guard('never', 'record', { file: never, timeoutMs: 100 }))]);
  const late = await hook(p, { outerMs: 1000, deps: { clock: (() => { let n = 0; return () => (n += 400); })() } });
  assert.equal(late.exitCode, 2); assert.match(late.stdout, /relay refused: (DEADLINE_EXCEEDED|INPUT_TIMEOUT)/);
  assert.ok(await absent(never), 'no guard started after the deadline');
  const r = await hook(p, { outerMs: 1000 });
  assert.equal(r.exitCode, 2); assert.match(r.stdout, /GUARD_FAILED: guard slow timeout/);
  assert.equal(await absent(never), false);
});

test('Stop denial continues the turn and guards see stopHookActive', async (t) => {
  const p = await tempPaths(t), file = join(p.stateDir, '..', 'stop.json');
  await writeSubscribers(p, [strip(guard('see', 'record', { kinds: ['turn-end'], file })), strip(guard('stop', 'deny', { kinds: ['turn-end'] }))]);
  const r = await hook(p, { harness: 'codex', nativeEvent: 'Stop', body: JSON.stringify({ session_id: 'sess', cwd: '/repo', stop_hook_active: true }) });
  assert.deepEqual(r, { stdout: '{"decision":"block","reason":"denied by fixture"}\n', stderr: 'denied by fixture\n', exitCode: 2 });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).event.stopHookActive, true);
  await writeSubscribers(p, [strip(guard('stop', 'deny-context', { kinds: ['turn-end'] }))]);
  const kept = await hook(p, { harness: 'claude-code', nativeEvent: 'Stop', body: JSON.stringify({ session_id: 'sess', cwd: '/repo' }) });
  assert.deepEqual(kept, { stdout: '{"decision":"block","reason":"denied by fixture"}\n', stderr: 'denied by fixture\n', exitCode: 2 });
});

test('guard results survive missing storage, broken enrichment and lock exhaustion', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [strip(guard('g', 'allow'))]);
  const broken = { ...p, stateDir: p.subscribersPath, agentsPath: join(p.subscribersPath, 'agents.json'), lockPath: join(p.subscribersPath, 'agents.lock') };
  let r = await dispatchHook({ harness: 'claude-code', nativeEvent: 'PreToolUse', input: Readable.from([payload()]) }, { paths: broken, applyOptions: local });
  assert.equal(r.exitCode, 1); assert.equal(r.stdout, ''); assert.match(r.stderr, /^registry: IO_ERROR/);
  r = await hook(p, { deps: { apply: async () => { throw relayError('GIT_ERROR', 'git exploded'); } } });
  assert.equal(r.exitCode, 1); assert.match(r.stderr, /registry: GIT_ERROR/);
  await writeSubscribers(p, [strip(guard('g', 'deny'))]);
  r = await hook(p, { deps: { apply: async () => assert.fail('a denial never reaches the registry') } });
  assert.equal(r.exitCode, 2);
  await writeSubscribers(p, [strip(guard('g', 'allow', { timeoutMs: 300 }))]);
  let release; const held = new Promise((resolve) => { release = resolve; });
  const holder = withLock(p.lockPath, async () => { await held; }, { deadline: performance.now() + 20000 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  r = await hook(p, { outerMs: 1500 });
  release(); await holder;
  assert.equal(r.exitCode, 1); assert.match(r.stderr, /registry: (LOCK_TIMEOUT|DEADLINE_EXCEEDED)/); assert.equal(r.stdout, '');
});

test('a deadline during lock reclamation leaves the guard for operator repair', async (t) => {
  const p = await tempPaths(t), ops = createProcessOps(), mine = ops.handleOf(process.pid);
  await fs.mkdir(p.stateDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(p.lockPath, JSON.stringify({ schema: 1, nonce: randomUUID(), holder: { ...mine, start: String(BigInt(mine.start) + 1n) } }), { mode: 0o600 });
  let finishUnlink; const gate = new Promise((resolve) => { finishUnlink = resolve; });
  const io = { ...fs, unlink: async (path) => { if (path === p.lockPath) await gate; return fs.unlink(path); } };
  const r = await hook(p, { outerMs: 1000, deps: { applyOptions: { ...local, io } } });
  assert.equal(r.exitCode, 1); assert.match(r.stderr, /registry: DEADLINE_EXCEEDED/);
  assert.equal(await absent(p.reclaimPath), false, 'the reclaim guard is still held where relay would have exited');
  const other = { ...mine, start: String(BigInt(mine.start) + 2n) };
  const later = { ...ops, handleOf: () => other, probe: (h) => (isDeepStrictEqual(h, other) ? { status: 'alive', reason: 'test' } : { status: 'dead', reason: 'test' }) };
  await assert.rejects(applyEvent(normalizeEvent('claude-code', 'PreToolUse', payload()), { ...local, paths: p, processOps: later, deadline: performance.now() + 500 }), { code: 'LOCK_REPAIR_REQUIRED' });
  finishUnlink(); await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(await absent(p.reclaimPath));
});

test('path resolution failures are refusals, not startup errors', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [strip(guard('g', 'allow'))]);
  const env = { ...process.env, RELAY_STATE_DIR: 'relative' };
  let r = await dispatchHook({ harness: 'claude-code', nativeEvent: 'PreToolUse', input: Readable.from([payload()]) }, { env, applyOptions: local });
  assert.equal(r.exitCode, 2); assert.match(r.stdout, /relay refused: INVALID_INPUT: expected absolute directory/);
  r = await dispatchHook({ harness: 'claude-code', nativeEvent: 'SessionStart', input: Readable.from(['{"session_id":"s","cwd":"/repo"}']) }, { env, applyOptions: local });
  assert.deepEqual(r, { stdout: '', stderr: 'INVALID_INPUT: expected absolute directory\n', exitCode: 1 });
});

test('slow configuration loading and publication end at the deadline', async (t) => {
  const p = await tempPaths(t), empty = { schema: 1, subscribers: [] };
  let started = performance.now();
  let r = await hook(p, { outerMs: 500, deps: { loadConfig: slow(empty, 650) } });
  assert.equal(r.exitCode, 2); assert.match(r.stdout, /relay refused: DEADLINE_EXCEEDED: subscriber configuration did not load before the deadline/);
  assert.ok(performance.now() - started < 500);
  r = await hook(p, { nativeEvent: 'Notification:idle_prompt', body: '{"session_id":"sess","cwd":"/repo"}', outerMs: 500, deps: { loadConfig: slow(empty, 650) } });
  assert.deepEqual(r, { stdout: '', stderr: 'DEADLINE_EXCEEDED: subscriber configuration did not load before the deadline\n', exitCode: 1 });
  started = performance.now();
  r = await hook(p, { outerMs: 500, deps: { apply: slow(published, 650) } });
  assert.deepEqual(r, { stdout: '', stderr: 'registry: DEADLINE_EXCEEDED: registry publication did not finish before the deadline\n', exitCode: 1 });
  assert.ok(performance.now() - started < 500);
  await new Promise((resolve) => setTimeout(resolve, 700));
});

test('configuration errors refuse on guard-capable events and report on the rest', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [], { text: '{ broken' });
  let r = await hook(p); assert.equal(r.exitCode, 2); assert.match(r.stdout, /relay refused: INVALID_CONFIG/);
  r = await hook(p, { nativeEvent: 'Notification:idle_prompt', body: JSON.stringify({ session_id: 'sess', cwd: '/repo' }) });
  assert.equal(r.exitCode, 1); assert.equal(r.stdout, ''); assert.match(r.stderr, /^INVALID_CONFIG: /);
  await writeSubscribers(p, [strip(guard('g', 'allow', { timeoutMs: 5000 }))]);
  r = await hook(p, { outerMs: 1000 }); assert.match(r.stdout, /relay refused: INVALID_CONFIG: subscribers for claude-code before-tool need 5000 ms/);
  r = await hook(p, { body: '{"session_id":"sess"}' }); assert.match(r.stdout, /relay refused: INVALID_INPUT/);
  r = await hook(p, { body: 'x'.repeat(5 * 1024 * 1024) }); assert.match(r.stdout, /relay refused: INPUT_TOO_LARGE/);
  r = await hook(p, { harness: 'codex', nativeEvent: 'Interrupt', body: '{}' }); assert.deepEqual(r, { stdout: '', stderr: 'UNSUPPORTED_EVENT: unsupported harness event\n', exitCode: 1 });
  r = await hook(p, { harness: 'codex', nativeEvent: 'SessionEnd', outerMs: 4000, body: '{}' }); assert.match(r.stderr, /^USAGE: codex SessionEnd allows at most 3000/); assert.equal(r.exitCode, 1);
  r = await hook(p, { harness: 'vim', body: '{}' }); assert.match(r.stderr, /^UNSUPPORTED_HARNESS/);
});

test('tool filters select guards and the tool input never leaks into stderr or stdout', async (t) => {
  const p = await tempPaths(t), file = join(p.stateDir, '..', 'edit.json');
  await writeSubscribers(p, [strip(guard('bash', 'deny', { tools: ['Bash'] })), strip(guard('edit', 'record', { tools: ['Edit'], file }))]);
  const r = await hook(p, { body: payload({ tool_name: 'Edit', tool_input: { file_path: '/x', secret: 'PRIVATE_INPUT' } }) });
  assert.equal(r.exitCode, 0); assert.equal((r.stdout + r.stderr).includes('PRIVATE_INPUT'), false);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).event.tool.input.secret, 'PRIVATE_INPUT');
  assert.equal((await readFile(p.agentsPath, 'utf8')).includes('PRIVATE_INPUT'), false);
});
