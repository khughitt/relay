import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { validateSubscribers, loadSubscribers, loadSubscribersFrom, matchSubscribers, matchReconcile, budgetFor, checkBudget, RECONCILE } from '../src/subscribers.js';
import { adapterFor } from '../src/adapters/index.js';
import { normalizeHookEvent } from '../src/adapters/hook-event.js';
import { tempPaths, writeSubscribers } from './helpers/fixture.js';

const guard = (over = {}) => ({ name: 'guard', role: 'guard', kinds: ['before-tool'], harnesses: ['claude-code', 'codex'], tools: ['Bash'], argv: ['true'], timeoutMs: 100, ...over });
const observer = (over = {}) => ({ name: 'observer', role: 'observer', registry: 'snapshot', kinds: ['before-tool', RECONCILE], argv: ['true'], timeoutMs: 100, ...over });
const event = (harness = 'claude-code', native = 'PreToolUse', tool = { tool_name: 'Bash', tool_input: { command: 'ls' } }) =>
  normalizeHookEvent(harness, native, JSON.stringify({ session_id: 's', cwd: '/repo', ...tool }), { invokingCwd: '/invoking' });

test('validateSubscribers normalizes entries and rejects every malformed field', () => {
  const config = validateSubscribers({ schema: 2, subscribers: [guard(), observer()] });
  assert.deepEqual(config.subscribers[1], { ...observer(), harnesses: null, tools: null, nativeEvents: null, privateFields: [] });
  assert.deepEqual(config.subscribers[0], { ...guard(), nativeEvents: null });
  assert.deepEqual(validateSubscribers({ schema: 2, subscribers: [] }), { schema: 2, subscribers: [] });
  assert.throws(() => validateSubscribers({ schema: 1, subscribers: [] }), { code: 'INVALID_CONFIG', message: /schema 1 .*schema 2/ });
  const bad = [
    null, [], { schema: 3, subscribers: [] }, { schema: 2 }, { schema: 2, subscribers: {} }, { schema: 2, subscribers: [], typo: true },
    { schema: 2, subscribers: [guard(), guard()] },
    { schema: 2, subscribers: [guard({ name: 'Guard' })] }, { schema: 2, subscribers: [guard({ name: '-x' })] }, { schema: 2, subscribers: [guard({ name: 'a'.repeat(65) })] },
    { schema: 2, subscribers: [guard({ role: 'watcher' })] },
    { schema: 2, subscribers: [guard({ kinds: [] })] }, { schema: 2, subscribers: [guard({ kinds: ['before-tool', 'before-tool'] })] }, { schema: 2, subscribers: [guard({ kinds: ['tool'] })] },
    { schema: 2, subscribers: [guard({ kinds: [RECONCILE], tools: null })] },
    { schema: 2, subscribers: [guard({ harnesses: null })] }, { schema: 2, subscribers: [guard({ harnesses: [] })] }, { schema: 2, subscribers: [guard({ harnesses: ['vim'] })] },
    { schema: 2, subscribers: [guard({ harnesses: ['opencode'] })] },
    { schema: 2, subscribers: [guard({ kinds: ['session-start'], tools: null })] },
    { schema: 2, subscribers: [guard({ kinds: ['needs-approval'], tools: null })] },
    { schema: 2, subscribers: [guard({ kinds: ['prompt', 'before-tool'] })] },
    { schema: 2, subscribers: [guard({ tools: [] })] }, { schema: 2, subscribers: [guard({ tools: [''] })] }, { schema: 2, subscribers: [guard({ tools: ['Bash', 'Bash'] })] },
    { schema: 2, subscribers: [guard({ argv: [] })] }, { schema: 2, subscribers: [guard({ argv: ['/usr/bin/python3'] })] }, { schema: 2, subscribers: [guard({ argv: ['bin/guard'] })] }, { schema: 2, subscribers: [guard({ argv: ['.'] })] }, { schema: 2, subscribers: [guard({ argv: ['..'] })] }, { schema: 2, subscribers: [guard({ argv: [''] })] }, { schema: 2, subscribers: [guard({ argv: ['a\0b'] })] }, { schema: 2, subscribers: [guard({ argv: ['true', 1] })] },
    { schema: 2, subscribers: [guard({ timeoutMs: 0 })] }, { schema: 2, subscribers: [guard({ timeoutMs: 1.5 })] }, { schema: 2, subscribers: [guard({ timeoutMs: 60001 })] },
    { schema: 2, subscribers: [guard({ shell: true })] },
  ];
  for (const value of bad) assert.throws(() => validateSubscribers(value), { code: 'INVALID_CONFIG' }, JSON.stringify(value));
  validateSubscribers({ schema: 2, subscribers: [guard({ kinds: ['prompt', 'before-tool', 'turn-end'], tools: null })] });
  assert.deepEqual(validateSubscribers({ schema: 2, subscribers: [guard({ argv: ['python3', '/abs/hooks/relay-guard', '; $(x)'] })] }).subscribers[0].argv, ['python3', '/abs/hooks/relay-guard', '; $(x)'], 'later arguments stay literal');
  validateSubscribers({ schema: 2, subscribers: [observer({ kinds: ['needs-approval', 'idle', RECONCILE], harnesses: ['opencode'] })] });
});

test('loadSubscribers: absent is empty, unsafe or corrupt is INVALID_CONFIG', async (t) => {
  const p = await tempPaths(t);
  assert.deepEqual(await loadSubscribers(p), { schema: 2, subscribers: [] });
  await writeSubscribers(p, [guard()]);
  assert.equal((await loadSubscribers(p)).subscribers[0].name, 'guard');
  await chmod(p.subscribersPath, 0o644);
  await assert.rejects(loadSubscribers(p), { code: 'INVALID_CONFIG' });
  await chmod(p.subscribersPath, 0o600); await chmod(p.configDir, 0o755);
  await assert.rejects(loadSubscribers(p), { code: 'INVALID_CONFIG' });
  await chmod(p.configDir, 0o700);
  await writeSubscribers(p, [], { text: '{ broken' });
  await assert.rejects(loadSubscribers(p), { code: 'INVALID_CONFIG' });
  await writeSubscribers(p, [], { text: '{"schema":2,"subscribers":[{"name":"x"}]}' });
  await assert.rejects(loadSubscribers(p), { code: 'INVALID_CONFIG' });
});

test('loadSubscribersFrom reads an explicit file and treats absence as INVALID_CONFIG', async (t) => {
  const p = await tempPaths(t);
  await assert.rejects(loadSubscribersFrom(p.subscribersPath), { code: 'INVALID_CONFIG', message: /does not exist/ });
  assert.deepEqual(await loadSubscribers(p), { schema: 2, subscribers: [] });
  await writeSubscribers(p, [guard()]);
  const config = await loadSubscribersFrom(p.subscribersPath);
  assert.equal(config.subscribers[0].name, 'guard');
  for (const bad of ['relative/subscribers.json', '', null, 7]) await assert.rejects(loadSubscribersFrom(bad), { code: 'INVALID_CONFIG', message: /absolute/ });
});

test('loadSubscribersFrom applies the runtime privacy checks and names them', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [guard()]);
  await chmod(p.subscribersPath, 0o644);
  await assert.rejects(loadSubscribersFrom(p.subscribersPath), { code: 'INVALID_CONFIG', message: /0600 regular file in a 0700 directory/ });
  await chmod(p.subscribersPath, 0o600); await chmod(p.configDir, 0o755);
  await assert.rejects(loadSubscribersFrom(p.subscribersPath), { code: 'INVALID_CONFIG' });
  await chmod(p.configDir, 0o700);
  const link = join(p.configDir, 'link.json'); await symlink(p.subscribersPath, link);
  await assert.rejects(loadSubscribersFrom(link), { code: 'INVALID_CONFIG' });
  await writeSubscribers(p, [], { text: '{broken' });
  await assert.rejects(loadSubscribersFrom(p.subscribersPath), { code: 'INVALID_CONFIG', message: /JSON/ });
});

test('matching honors kind, harness and tool filters in configuration order', () => {
  const config = validateSubscribers({ schema: 2, subscribers: [
    observer({ name: 'all' }), guard({ name: 'bash' }), guard({ name: 'codex-only', harnesses: ['codex'] }),
    guard({ name: 'edit', tools: ['Edit'] }), observer({ name: 'prompts', kinds: ['prompt'] }), observer({ name: 'reap', kinds: [RECONCILE] }) ] });
  const names = (e) => matchSubscribers(config, e).map((s) => s.name);
  assert.deepEqual(names(event()), ['all', 'bash']);
  assert.deepEqual(names(event('codex')), ['all', 'bash', 'codex-only']);
  assert.deepEqual(names(event('codex', 'PreToolUse', { tool_name: 'Edit', tool_input: {} })), ['all', 'edit']);
  assert.deepEqual(names(event('claude-code', 'UserPromptSubmit', {})), ['prompts']);
  assert.deepEqual(names(event('opencode', 'session.busy', {})), []);
  assert.deepEqual(matchReconcile(config).map((s) => s.name), ['all', 'reap']);
});

test('budgetFor derives the profile from the outer timeout and enforces documented caps', () => {
  assert.deepEqual(budgetFor({ harness: 'codex', nativeEvent: 'SessionEnd' }), { outerMs: 1000, totalMs: 900, inputMs: 200, registryMs: 333, reserveMs: 100, marginMs: 100, subscribersMs: 267 });
  assert.deepEqual(budgetFor({ harness: 'claude-code', nativeEvent: 'SessionEnd' }), { outerMs: 1500, totalMs: 1350, inputMs: 300, registryMs: 500, reserveMs: 150, marginMs: 150, subscribersMs: 400 });
  assert.deepEqual(budgetFor({ harness: 'claude-code', nativeEvent: 'UserPromptSubmit' }), { outerMs: 30000, totalMs: 27000, inputMs: 5000, registryMs: 10000, reserveMs: 1000, marginMs: 3000, subscribersMs: 11000 });
  assert.deepEqual(budgetFor({ harness: 'claude-code', nativeEvent: 'PreToolUse' }), { outerMs: 600000, totalMs: 55000, inputMs: 5000, registryMs: 12000, reserveMs: 1000, marginMs: 5000, subscribersMs: 37000 });
  assert.equal(budgetFor({ harness: 'codex', nativeEvent: 'PreToolUse', outerMs: 60000 }).totalMs, 55000);
  assert.equal(budgetFor({ harness: 'opencode', nativeEvent: 'session.busy' }).outerMs, 5000);
  assert.equal(budgetFor({ outerMs: 30000 }).subscribersMs, 11000);
  assert.equal(budgetFor({ harness: 'codex', nativeEvent: 'SessionEnd', outerMs: 3000 }).outerMs, 3000);
  assert.throws(() => budgetFor({ harness: 'codex', nativeEvent: 'SessionEnd', outerMs: 3001 }), { code: 'USAGE' });
  assert.throws(() => budgetFor({ harness: 'claude-code', nativeEvent: 'SessionEnd', outerMs: 60001 }), { code: 'USAGE' });
  for (const outerMs of [499, 0, -1, 1.5, '1000', NaN]) assert.throws(() => budgetFor({ harness: 'codex', nativeEvent: 'PreToolUse', outerMs }), { code: 'USAGE' });
  assert.throws(() => budgetFor({}), { code: 'USAGE' });
  assert.throws(() => budgetFor({ harness: 'codex', nativeEvent: 'Interrupt' }), { code: 'UNSUPPORTED_EVENT' });
});

test('the documented example configuration fits every mapped harness/event and reconciliation', () => {
  const familiar = ['familiar', 'observe'];
  const example = validateSubscribers({ schema: 2, subscribers: [
    { name: 'ops-guard', role: 'guard', kinds: ['before-tool'], harnesses: ['claude-code', 'codex'], tools: ['Bash'], argv: ['relay-guard'], timeoutMs: 4000 },
    { name: 'familiar', role: 'observer', harnesses: ['claude-code', 'codex'], registry: 'snapshot', kinds: ['session-start', 'prompt', 'before-tool', 'idle', 'needs-input', 'needs-approval', 'turn-end', 'turn-error', 'child-start', 'child-stop', RECONCILE], argv: familiar, timeoutMs: 2000 },
    { name: 'familiar-opencode', role: 'observer', registry: 'snapshot', harnesses: ['opencode'], kinds: ['session-start', 'activity', 'idle', 'needs-approval', 'turn-error', 'session-end'], argv: familiar, timeoutMs: 80 },
    { name: 'familiar-teardown', role: 'observer', registry: 'snapshot', harnesses: ['claude-code', 'codex'], kinds: ['session-end'], argv: familiar, timeoutMs: 200 } ] });
  // OpenCode's fixed 5 s lifetime admits at most 84 ms of subscriber timeout once startup, discovery and cleanup are reserved.
  const opencode = (timeoutMs) => validateSubscribers({ schema: 2, subscribers: [{ name: 'o', role: 'observer', registry: 'snapshot', harnesses: ['opencode'], kinds: ['session-start'], argv: ['familiar'], timeoutMs }] });
  assert.equal(checkBudget(opencode(84), budgetFor({ harness: 'opencode', nativeEvent: 'init' }), { harness: 'opencode', kind: 'session-start' }).length, 1);
  assert.throws(() => checkBudget(opencode(85), budgetFor({ harness: 'opencode', nativeEvent: 'init' }), { harness: 'opencode', kind: 'session-start' }), { code: 'INVALID_CONFIG' });
  // SessionEnd's native caps leave less than one subscriber's startup, discovery and cleanup reserves.
  for (const [harness, outerMs] of [['claude-code', 1500], ['codex', 3000]]) {
    assert.throws(() => checkBudget(example, budgetFor({ harness, nativeEvent: 'SessionEnd', outerMs }), { harness, kind: 'session-end', nativeEvent: 'SessionEnd' }), { code: 'INVALID_CONFIG' });
  }
  assert.deepEqual(checkBudget(example, budgetFor({ harness: 'claude-code', nativeEvent: 'SessionEnd', outerMs: 60000 }), { harness: 'claude-code', kind: 'session-end', nativeEvent: 'SessionEnd' }).map((s) => s.name), ['familiar-teardown']);
  for (const harness of ['claude-code', 'codex', 'opencode']) {
    for (const nativeEvent of Object.keys(adapterFor(harness).events).filter((name) => name !== 'SessionEnd')) {
      const { kind } = adapterFor(harness).hookEvents[nativeEvent];
      const matched = checkBudget(example, budgetFor({ harness, nativeEvent }), { harness, kind, nativeEvent });
      assert.ok(matched.length > 0, `${harness} ${nativeEvent} has an observer`);
    }
  }
  assert.deepEqual(checkBudget(example, budgetFor({ outerMs: 30000 }), { kind: RECONCILE }).map((s) => s.name), ['familiar']);
});

test('checkBudget sums the worst match ignoring tool filters', () => {
  const config = validateSubscribers({ schema: 2, subscribers: [guard({ timeoutMs: 200 }), guard({ name: 'edit', tools: ['Edit'], timeoutMs: 150 }), observer({ timeoutMs: 100 })] });
  // need: 250 startup + 500 discovery + (200 + 500) + (150 + 500) + (100 + 500) = 2700 ms
  const budget = budgetFor({ outerMs: 20000 });
  assert.deepEqual(checkBudget(config, budget, { harness: 'codex', kind: 'before-tool' }).map((s) => s.name), ['guard', 'edit', 'observer']);
  assert.throws(() => checkBudget(config, budgetFor({ harness: 'codex', nativeEvent: 'SessionEnd' }), { harness: 'codex', kind: 'before-tool' }), { code: 'INVALID_CONFIG' });
  assert.deepEqual(checkBudget(config, budgetFor({ harness: 'codex', nativeEvent: 'SessionEnd' }), { harness: 'codex', kind: 'session-end' }), []);
  assert.deepEqual(checkBudget(config, budgetFor({ outerMs: 8000 }), { kind: RECONCILE }).map((s) => s.name), ['observer']);
  assert.deepEqual(checkBudget(config, budgetFor({ outerMs: 500 }), { kind: 'session-end' }), [], 'nothing admitted reserves nothing');
  assert.throws(() => checkBudget(config, budgetFor({ outerMs: 500 }), { kind: RECONCILE }), { code: 'INVALID_CONFIG' });
});
test('Codex Stop and SubagentStop guards bind separately through hook kinds', () => {
  const config = validateSubscribers({ schema: 2, subscribers: [guard({ name: 'stop', kinds: ['turn-end'], harnesses: ['codex'], tools: null }),
    guard({ name: 'child', kinds: ['child-stop'], harnesses: ['codex'], tools: null })] });
  const stop = normalizeHookEvent('codex', 'Stop', JSON.stringify({ session_id: 's', cwd: '/repo' }), { invokingCwd: '/invoking' });
  const child = normalizeHookEvent('codex', 'SubagentStop', JSON.stringify({ session_id: 's', agent_id: 'w', cwd: '/repo' }), { invokingCwd: '/invoking' });
  assert.deepEqual(matchSubscribers(config, stop).map((s) => s.name), ['stop']);
  assert.deepEqual(matchSubscribers(config, child).map((s) => s.name), ['child']);
  assert.throws(() => validateSubscribers({ schema: 2, subscribers: [guard({ kinds: ['child-stop'], harnesses: ['claude-code'], tools: null })] }), { code: 'INVALID_CONFIG', message: /claude-code child-stop has no refusal channel/ });
});

test('schema 2 roles: notices need a context channel, observers declare registry use, and only observers select private fields', () => {
  const notice = (over = {}) => ({ name: 'notice', role: 'notice', kinds: ['prompt'], harnesses: ['claude-code'], argv: ['true'], timeoutMs: 100, ...over });
  const counter = (over = {}) => observer({ name: 'counter', registry: 'occurrence', kinds: ['after-tool', 'tool-error'], harnesses: ['claude-code'], tools: ['Bash'],
    privateFields: [{ nativeEvent: 'PostToolUse', fields: ['command', 'durationMs'] }], ...over });
  const config = validateSubscribers({ schema: 2, subscribers: [notice(), counter()] });
  assert.deepEqual(config.subscribers[0], { ...notice(), tools: null, nativeEvents: null });
  assert.deepEqual(config.subscribers[1].privateFields, [{ nativeEvent: 'PostToolUse', fields: ['command', 'durationMs'] }]);
  const bad = [
    notice({ harnesses: undefined }), notice({ kinds: ['session-end'] }), notice({ kinds: ['turn-end'] }), notice({ registry: 'occurrence' }),
    notice({ privateFields: [] }), guard({ registry: 'snapshot' }), guard({ privateFields: [{ nativeEvent: 'PreToolUse', fields: ['command'] }] }),
    observer({ registry: undefined }), observer({ registry: 'both' }),
    counter({ privateFields: [{ nativeEvent: 'PostToolUse', fields: ['*'] }] }),
    counter({ privateFields: [{ nativeEvent: 'PostToolUse', fields: ['command', 'command'] }] }),
    counter({ privateFields: [{ nativeEvent: 'PostToolUse', fields: [] }] }),
    counter({ privateFields: [{ nativeEvent: 'PostToolUse', fields: ['prompt'] }] }),
    counter({ privateFields: [{ nativeEvent: 'PostToolUseFailure', fields: ['toolResult'] }] }),
    counter({ privateFields: [{ nativeEvent: 'UserPromptSubmit', fields: ['prompt'] }] }),
    counter({ privateFields: [{ nativeEvent: 'PostToolUse', fields: ['command'] }, { nativeEvent: 'PostToolUse', fields: ['durationMs'] }] }),
    counter({ privateFields: [{ nativeEvent: 'PostToolUse', fields: ['command'], extra: 1 }] }),
    counter({ privateFields: 'command' }),
    observer({ detach: true }),
    observer({ kinds: ['session-start'], tools: ['Bash'] }),
    guard({ nativeEvents: ['PostToolUse'] }), guard({ nativeEvents: [] }), guard({ nativeEvents: ['PreToolUse', 'PreToolUse'] }),
  ];
  for (const value of bad) assert.throws(() => validateSubscribers({ schema: 2, subscribers: [value] }), { code: 'INVALID_CONFIG' }, JSON.stringify(value));
  validateSubscribers({ schema: 2, subscribers: [observer({ kinds: ['before-tool', 'after-tool', 'tool-error'], tools: ['Bash'] })] });
});

test('nativeEvents intersects kind and harness selection', () => {
  const config = validateSubscribers({ schema: 2, subscribers: [
    observer({ name: 'idle-only', kinds: ['needs-input', 'needs-approval'], harnesses: ['claude-code'], nativeEvents: ['Notification:idle_prompt'] }),
    observer({ name: 'all-notifications', kinds: ['needs-input', 'needs-approval'], harnesses: ['claude-code'] }) ] });
  const idle = event('claude-code', 'Notification:idle_prompt', {});
  const permission = event('claude-code', 'Notification:permission_prompt', {});
  assert.deepEqual(matchSubscribers(config, idle).map((s) => s.name), ['idle-only', 'all-notifications']);
  assert.deepEqual(matchSubscribers(config, permission).map((s) => s.name), ['all-notifications']);
  const budget = budgetFor({ harness: 'claude-code', nativeEvent: 'Notification:permission_prompt' });
  assert.deepEqual(checkBudget(config, budget, { harness: 'claude-code', kind: 'needs-approval', nativeEvent: 'Notification:permission_prompt' }).map((s) => s.name), ['all-notifications']);
});

test('budgetFor admits hook-only events and keeps unknown events unsupported', () => {
  assert.equal(budgetFor({ harness: 'claude-code', nativeEvent: 'PostToolUse' }).outerMs, 600000);
  assert.throws(() => budgetFor({ harness: 'agy', nativeEvent: 'PreInvocation' }), { code: 'UNSUPPORTED_EVENT' });
});

test('agy turn-end guards now load (Stop holds with continue); a session-start guard is rejected', () => {
  validateSubscribers({ schema: 2, subscribers: [guard({ kinds: ['turn-end'], harnesses: ['agy'], tools: null })] });
  assert.throws(() => validateSubscribers({ schema: 2, subscribers: [guard({ kinds: ['session-start'], harnesses: ['agy'], tools: null })] }), (e) => e.code === 'INVALID_CONFIG' && e.message.includes('agy session-start has no refusal channel'));
  validateSubscribers({ schema: 2, subscribers: [guard({ kinds: ['before-tool'], harnesses: ['agy'] })] });
});
test('agy budget follows the 30 s outer timeout and an explicit outer timeout', () => {
  const b = budgetFor({ harness: 'agy', nativeEvent: 'PreToolUse' });
  assert.equal(b.outerMs, 30000); assert.equal(b.subscribersMs, 11000);
  assert.equal(budgetFor({ harness: 'agy', nativeEvent: 'PreToolUse', outerMs: 60000 }).subscribersMs, 37000);
});
