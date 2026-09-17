import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import * as fs from 'node:fs/promises';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { dispatchHook, reconcile } from '../src/dispatch.js';
import { withLock } from '../src/bus/lock.js';
import { createProcessOps } from '../src/bus/proc.js';
import { readSnapshot, applyEvent } from '../src/bus/transaction.js';
import { normalizeEvent } from '../src/adapters/index.js';
import { relayError } from '../src/protocol.js';
import { RECONCILE } from '../src/subscribers.js';
import { tempPaths, writeSubscribers } from './helpers/fixture.js';

const fixture = new URL('./fixtures/subscriber.js', import.meta.url).pathname;
const argv = (mode, ...rest) => [process.execPath, fixture, mode, ...rest];
const guard = (name, mode, over = {}) => ({ name, role: 'guard', kinds: ['before-tool'], harnesses: ['claude-code', 'codex'], argv: argv(mode, ...(over.file ? [over.file] : [])), timeoutMs: 3000, ...over, file: undefined });
const observer = (name, mode, over = {}) => ({ name, role: 'observer', kinds: ['before-tool'], argv: argv(mode, ...(over.file ? [over.file] : [])), timeoutMs: 3000, ...over, file: undefined });
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

test('guard envelope serialization failures refuse without invoking the guard', async (t) => {
  const p = await tempPaths(t), file = join(p.stateDir, '..', 'guard-ran');
  await writeSubscribers(p, [strip(guard('deep', 'record', { file }))]);
  const nested = `${'['.repeat(10000)}0${']'.repeat(10000)}`;
  const body = `{"session_id":"sess","cwd":"/repo","tool_name":"Bash","tool_input":{"nested":${nested}}}`;
  const r = await hook(p, { body });
  assert.equal(r.exitCode, 2);
  assert.match(r.stdout, /relay refused: GUARD_FAILED: guard deep input serialization failed/);
  assert.ok(await absent(file));
  assert.ok(await absent(p.agentsPath));
});

test('a rejected guard invocation does not outrank a later denial', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [guard('broken', 'allow'), guard('deny', 'deny')].map(strip));
  let calls = 0;
  const run = async () => {
    if (++calls === 1) throw new Error('runner rejected');
    return { status: 'exited', exitCode: 0, signal: null, stdout: '{"decision":"deny","reason":"denied by fixture"}', stderr: '' };
  };
  const r = await hook(p, { deps: { run } });
  assert.equal(calls, 2);
  assert.equal(r.stdout, `${denyOut}"denied by fixture"}}\n`);
  assert.ok(await absent(p.agentsPath));
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
  let pending;
  r = await hook(p, { outerMs: 1500, deps: { apply: (...args) => (pending = applyEvent(...args)) } });
  release(); await holder; await Promise.allSettled([pending]);
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

test('observers get sanitized metadata after publication and cannot touch the reply', async (t) => {
  const p = await tempPaths(t), file = join(p.stateDir, '..', 'observed.json');
  process.env.RELAY_TEST_MARKER = 'hook-environment'; t.after(() => { delete process.env.RELAY_TEST_MARKER; });
  await writeSubscribers(p, [strip(observer('rec', 'record', { file })), strip(observer('noisy', 'noisy')), strip(observer('env', 'env', { file: join(p.stateDir, '..', 'env') }))]);
  const r = await hook(p);
  assert.equal(r.stdout, ''); assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, 'noisy: observer noise\n');
  const seen = JSON.parse(await readFile(file, 'utf8')), snapshot = await readSnapshot({ paths: p });
  assert.deepEqual(seen, { schema: 1, type: 'event', subscriber: 'rec',
    event: { schema: 1, kind: 'before-tool', harness: 'claude-code', nativeEvent: 'PreToolUse', agentId: 'claude-code:sess', sessionId: 'sess', cwd: '/repo', tool: { name: 'Bash' } },
    registry: { generation: snapshot.generation, revision: 1 }, changed: true, reaped: [] });
  assert.equal(JSON.stringify(seen).includes('PRIVATE_COMMAND'), false);
  assert.equal(JSON.stringify(seen).includes('hook-environment'), false);
  assert.equal(await readFile(join(p.stateDir, '..', 'env'), 'utf8'), 'hook-environment');
});

test('a slow observer never delays a denial and observers run only within their budget', async (t) => {
  const p = await tempPaths(t), file = join(p.stateDir, '..', 'after.json');
  await writeSubscribers(p, [strip(observer('slow', 'slow', { argv: argv('slow', '4000'), timeoutMs: 5000 })), strip(guard('g', 'deny'))]);
  let started = performance.now(); let r = await hook(p);
  assert.equal(r.exitCode, 2); assert.ok(performance.now() - started < 2000, 'the denial returned before the observer could run');
  await writeSubscribers(p, [strip(observer('hang', 'hang', { timeoutMs: 150 })), strip(observer('quick', 'slow', { argv: argv('slow', '10'), timeoutMs: 150 })), strip(observer('after', 'record', { file, timeoutMs: 100 }))]);
  started = performance.now(); r = await hook(p, { outerMs: 1500 }); // subscribersMs 400 = 150 + 150 + 100
  assert.equal(r.exitCode, 0); assert.match(r.stderr, /SUBSCRIBER_FAILED: hang timeout/);
  assert.ok(performance.now() - started < 1500);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).subscriber, 'after', 'a later observer that fits still runs');
  // A publication that fulfills after its deadline is rejected and no observer runs.
  await writeSubscribers(p, [strip(observer('never', 'record', { file: join(p.stateDir, '..', 'never'), timeoutMs: 100 }))]);
  let now = 0;
  const published = { snapshot: { schema: 1, generation: '00000000-0000-4000-8000-000000000000', revision: 1, agents: {} }, changed: true, reaped: [], diagnostics: [] };
  r = await hook(p, { outerMs: 1500, deps: { clock: () => now, apply: async () => { now = 1300; return published; } } });
  assert.match(r.stderr, /registry: DEADLINE_EXCEEDED: registry publication did not finish before the deadline/);
  assert.match(r.stderr, /SUBSCRIBER_SKIPPED: never skipped after registry failure/);
  assert.ok(await absent(join(p.stateDir, '..', 'never')));
});

test('observers are skipped, not run, after a registry failure', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [strip(observer('o', 'record', { file: join(p.stateDir, '..', 'never') }))]);
  const r = await hook(p, { deps: { apply: async () => { throw relayError('IO_ERROR', 'no storage'); } } });
  assert.equal(r.exitCode, 1); assert.match(r.stderr, /registry: IO_ERROR: no storage\nSUBSCRIBER_SKIPPED: o skipped after registry failure\n/);
  assert.ok(await absent(join(p.stateDir, '..', 'never')));
});

test('Codex SessionEnd fits its one-second default and OpenCode events observe only', async (t) => {
  const p = await tempPaths(t), file = join(p.stateDir, '..', 'end.json');
  await writeSubscribers(p, [strip(observer('end', 'record', { kinds: ['session-end'], file, timeoutMs: 250 }))]);
  await applyEvent(normalizeEvent('codex', 'SessionStart', JSON.stringify({ session_id: 'sess', cwd: '/repo' })), { paths: p, ...local });
  const started = performance.now(), r = await hook(p, { harness: 'codex', nativeEvent: 'SessionEnd', body: JSON.stringify({ session_id: 'sess', cwd: '/repo' }) });
  assert.deepEqual(r, { stdout: '', stderr: '', exitCode: 0 }); assert.ok(performance.now() - started < 1000);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).changed, true);
  await writeSubscribers(p, [strip(observer('end', 'allow', { kinds: ['session-end'], timeoutMs: 300 }))]);
  assert.match((await hook(p, { harness: 'codex', nativeEvent: 'SessionEnd', body: '{"session_id":"sess","cwd":"/repo"}' })).stderr, /^INVALID_CONFIG: subscribers for codex session-end need 300 ms but 267 ms fit inside 1000 ms/);
  const oc = await hook(p, { harness: 'opencode', nativeEvent: 'session.busy', body: '{"session_id":"opencode:42","cwd":"/repo"}' });
  assert.deepEqual(oc, { stdout: '', stderr: '', exitCode: 0 });
  assert.equal((await readSnapshot({ paths: p })).agents['opencode:opencode:42'].state, 'working');
});

test('reconcile prunes, then notifies reconcile observers even when nothing changed', async (t) => {
  const p = await tempPaths(t), file = join(p.stateDir, '..', 'reconcile.json');
  await writeSubscribers(p, [strip(observer('r', 'record', { kinds: [RECONCILE], file, timeoutMs: 500 })), strip(observer('never', 'record', { kinds: ['session-end'], file: join(p.stateDir, '..', 'never') }))]);
  let { result, diagnostics } = await reconcile({}, { paths: p });
  assert.equal(result.snapshot, null); assert.deepEqual(diagnostics, []);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { schema: 1, type: 'reconcile', subscriber: 'r', event: null, registry: { generation: null, revision: null }, changed: false, reaped: [] });
  await hook(p);
  ({ result } = await reconcile({ outerMs: 2000 }, { paths: p }));
  assert.equal(result.changed, false);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).registry, { generation: result.snapshot.generation, revision: 1 });
  assert.ok(await absent(join(p.stateDir, '..', 'never')));
  await writeSubscribers(p, [strip(observer('r', 'allow', { kinds: [RECONCILE], timeoutMs: 60000 }))]);
  await assert.rejects(reconcile({}, { paths: p }), { code: 'INVALID_CONFIG' });
  await writeSubscribers(p, [], { text: 'nope' });
  await assert.rejects(reconcile({}, { paths: p }), { code: 'INVALID_CONFIG' });
  await writeSubscribers(p, []); // valid again, so the injected slow reap is actually reached
  await assert.rejects(reconcile({ outerMs: 500 }, { paths: p, loadConfig: slow({ schema: 1, subscribers: [] }, 650) }), { code: 'DEADLINE_EXCEEDED' });
  await assert.rejects(reconcile({ outerMs: 500 }, { paths: p, reap: slow(published, 650) }), { code: 'DEADLINE_EXCEEDED' });
  await new Promise((resolve) => setTimeout(resolve, 700));
});

test('reconcile rejects a reap that fulfills after its deadline without notifying observers', async (t) => {
  const p = await tempPaths(t), file = join(p.stateDir, '..', 'late-reap.json');
  await writeSubscribers(p, [strip(observer('late', 'record', { kinds: [RECONCILE], file, timeoutMs: 100 }))]);
  let now = 0;
  await assert.rejects(reconcile({ outerMs: 1500 }, { paths: p, clock: () => now, reap: async () => { now = 550; return published; } }), { code: 'DEADLINE_EXCEEDED' });
  assert.ok(await absent(file));
});
