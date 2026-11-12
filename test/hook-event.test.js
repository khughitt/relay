import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeHookEvent, registryEventFor, projectEnvelope, HOOK_KINDS } from '../src/adapters/hook-event.js';
import { adapterFor, normalizeEvent } from '../src/adapters/index.js';
import { validateEvent } from '../src/protocol.js';
import { validateSubscribers } from '../src/subscribers.js';
import * as relay from '../src/index.js';

const fixtureDir = new URL('./fixtures/hook-events/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, fixtureDir), 'utf8'));
const manifest = read('manifest.json');
const opts = { invokingCwd: manifest.invokingCwd };
const raw = (name) => readFileSync(new URL(name, fixtureDir));
const V = (value) => ({ status: 'valid', value }), M = { status: 'missing' }, I = { status: 'invalid' };
const fixture = (harness, nativeEvent, variant = null) => {
  const entry = manifest.fixtures.find((f) => f.harness === harness && f.nativeEvent === nativeEvent && f.variant === variant);
  assert.ok(entry, `${harness} ${nativeEvent} ${variant}`);
  return { entry, input: JSON.parse(raw(entry.input).toString('utf8')), expected: read(entry.expected) };
};
const claude = (nativeEvent, over = {}) => normalizeHookEvent('claude-code', nativeEvent, JSON.stringify({ session_id: 's', cwd: '/repo', ...over }), opts);

test('the fixture manifest pairs every configured native event and cites frozen sources', () => {
  for (const harness of ['claude-code', 'codex', 'agy']) {
    for (const nativeEvent of Object.keys(adapterFor(harness).hookEvents)) {
      assert.ok(manifest.fixtures.some((f) => f.harness === harness && f.nativeEvent === nativeEvent && f.variant === null), `${harness} ${nativeEvent} has a fixture pair`);
    }
  }
  for (const f of manifest.fixtures) {
    assert.ok(f.sources.length > 0, f.input);
    for (const s of f.sources) assert.match(s.revision, /^[0-9a-f]{40}$/, `${f.input} cites an exact revision`);
  }
});

test('every fixture normalizes to its expected hook event and registry effect', () => {
  for (const f of manifest.fixtures) {
    const { hookEvent, registry } = read(f.expected);
    const event = normalizeHookEvent(f.harness, f.nativeEvent, raw(f.input), opts);
    assert.deepEqual(event, hookEvent, f.input);
    assert.ok(HOOK_KINDS.includes(event.kind), f.input);
    if (typeof registry === 'string') assert.throws(() => registryEventFor(event), { code: registry }, f.input);
    else assert.deepEqual(registryEventFor(event), registry, f.input);
  }
});

test('registry events keep the released normalizeEvent results exactly', () => {
  for (const f of manifest.fixtures) {
    const { registry } = read(f.expected);
    if (registry === null || typeof registry === 'string') continue;
    const released = normalizeEvent(f.harness, f.nativeEvent, raw(f.input));
    assert.deepEqual(registryEventFor(normalizeHookEvent(f.harness, f.nativeEvent, raw(f.input), opts)), released, f.input);
    assert.deepEqual(validateEvent(released), released);
  }
});

test('metadata events have no registry effect and Codex child events keep their worker projection', () => {
  const { input } = fixture('claude-code', 'PostToolUse');
  assert.equal(registryEventFor(normalizeHookEvent('claude-code', 'PostToolUse', JSON.stringify(input), opts)), null);
  for (const nativeEvent of ['PostToolUseFailure', 'SubagentStart', 'SubagentStop', 'PostModelSwitch', 'PreCompact', 'PostCompact']) {
    assert.equal(adapterFor('claude-code').hookEvents[nativeEvent].registry, false, nativeEvent);
  }
  for (const nativeEvent of ['SubagentStart', 'SubagentStop']) {
    const { input: codexInput } = fixture('codex', nativeEvent);
    const event = registryEventFor(normalizeHookEvent('codex', nativeEvent, JSON.stringify(codexInput), opts));
    assert.equal(validateEvent(event).kind, adapterFor('codex').events[nativeEvent].kind);
  }
});

test('released adapter registry tables are unchanged by hook kinds', () => {
  assert.equal(adapterFor('codex').events.SubagentStart.kind, 'session-start');
  assert.equal(adapterFor('codex').events.SubagentStop.kind, 'turn-end');
  assert.equal(Object.hasOwn(adapterFor('claude-code').events, 'PostToolUse'), false);
  assert.throws(() => adapterFor('claude-code').stateForEvent('PostToolUse'), { code: 'UNSUPPORTED_EVENT' });
});

test('agy cancellation stays representable with invalid identity and retry facts', () => {
  const { input } = fixture('agy', 'Stop', 'canceled-invalid-identity');
  const canceled = normalizeHookEvent('agy', 'Stop', JSON.stringify(input), opts);
  assert.deepEqual(canceled.identity, { status: 'invalid' });
  assert.deepEqual(canceled.facts.terminationReason, { status: 'valid', value: 'USER_CANCELED' });
  assert.deepEqual(canceled.facts.executionNum, I);
  assert.equal(canceled.cwd, '/invoking');
  assert.throws(() => registryEventFor(canceled), { code: 'INVALID_INPUT' });
});

test('unsupported or unusable events refuse rather than inventing decoders or identities', () => {
  assert.throws(() => normalizeHookEvent('agy', 'PreInvocation', JSON.stringify({ conversationId: 'c', workspacePaths: ['/repo'] }), opts), { code: 'UNSUPPORTED_EVENT' });
  assert.throws(() => normalizeHookEvent('codex', 'Interrupt', JSON.stringify({ session_id: 's', cwd: '/repo' }), opts), { code: 'UNSUPPORTED_EVENT' });
  assert.throws(() => normalizeHookEvent('claude-code', 'SessionStart', JSON.stringify({ cwd: '/repo' }), opts), { code: 'INVALID_INPUT' });
  assert.throws(() => normalizeHookEvent('claude-code', 'SessionStart', JSON.stringify({ session_id: 's', cwd: 'relative' }), opts), { code: 'INVALID_INPUT' });
  assert.throws(() => normalizeHookEvent('agy', 'PreToolUse', JSON.stringify({ toolCall: { name: 'view_file' } }), opts), { code: 'INVALID_INPUT' });
  assert.throws(() => claude('Stop', { hook_event_name: 'SessionStart' }), { code: 'INVALID_INPUT' });
  assert.throws(() => normalizeHookEvent('codex', 'SubagentStart', JSON.stringify({ session_id: 's', cwd: '/repo' }), opts), { code: 'INVALID_INPUT' });
  for (const body of ['[]', 'not json', '"text"']) assert.throws(() => normalizeHookEvent('claude-code', 'SessionStart', body, opts), { code: 'INVALID_INPUT' });
  assert.throws(() => normalizeHookEvent('claude-code', 'SessionStart', Buffer.alloc(4 * 1024 * 1024 + 1, 0x20), opts), { code: 'INPUT_TOO_LARGE' });
  assert.throws(() => normalizeHookEvent('agy', 'Stop', JSON.stringify({ terminationReason: 'ERROR' }), { invokingCwd: 'relative' }), { code: 'USAGE' });
});

test('before-tool name and input are required; their invalidity is not a Fact', () => {
  assert.throws(() => claude('PreToolUse', { tool_name: ' ', tool_input: {} }), { code: 'INVALID_INPUT' });
  assert.throws(() => claude('PreToolUse', { tool_name: 'Bash', tool_input: [] }), { code: 'INVALID_INPUT' });
  assert.throws(() => claude('PreToolUse', { tool_name: 'x'.repeat(257), tool_input: {} }), { code: 'INVALID_INPUT' });
  let deep = {};
  for (let i = 0; i < 64; i++) deep = { d: deep };
  assert.throws(() => claude('PreToolUse', { tool_name: 'Bash', tool_input: deep }), { code: 'INVALID_INPUT' });
  assert.equal(claude('PreToolUse', { tool_name: 'x'.repeat(256), tool_input: {} }).tool.name.status, 'valid');
});

test('optional post-tool fields stay explicit Facts at their bounds', () => {
  const post = (over) => claude('PostToolUse', { tool_name: 'Bash', tool_use_id: 't', tool_input: { command: 'ls' }, ...over }).private;
  let nested = 1;
  for (let i = 0; i < 64; i++) nested = [nested];
  assert.equal(post({ tool_input: { a: nested } }).toolInput.status, 'invalid', 'depth over 64');
  let edge = 1;
  for (let i = 0; i < 63; i++) edge = [edge];
  assert.equal(post({ tool_input: edge.length ? { a: edge } : {} }).toolInput.status, 'valid', 'depth 64');
  assert.equal(post({ tool_input: { a: Array.from({ length: 65535 }, () => 0) } }).toolInput.status, 'invalid', 'more than 65,536 nodes');
  assert.equal(post({ tool_input: { a: Array.from({ length: 65534 }, () => 0) } }).toolInput.status, 'valid', 'exactly 65,536 nodes');
  assert.equal(post({ tool_input: { a: 'x'.repeat(1024 * 1024) } }).toolInput.status, 'invalid', 'over 1 MiB serialized');
  assert.deepEqual(post({ tool_input: { command: 'x'.repeat(256 * 1024) } }).command, V('x'.repeat(256 * 1024)));
  assert.deepEqual(post({ tool_input: { command: 'x'.repeat(256 * 1024 + 1) } }).command, I);
  assert.deepEqual(post({ tool_input: { command: 7 } }).command, I);
  assert.deepEqual(post({ tool_input: {} }).command, M);
  for (const duration_ms of [-1, 'fast', Number.MAX_SAFE_INTEGER + 2, true]) assert.deepEqual(post({ duration_ms }).durationMs, I, String(duration_ms));
  assert.deepEqual(post({ duration_ms: 0 }).durationMs, V(0));
  assert.deepEqual(post({ duration_ms: 1.5 }).durationMs, V(1.5));
  assert.deepEqual(post({}).toolResult, M);
  for (const tool_response of ['plain text', '[1]', 7, ['x'], '{"task_name":' + '"x'.repeat(1024 * 1024) + '"}']) assert.deepEqual(post({ tool_response }).toolResult, I);
  assert.deepEqual(post({ tool_response: { task_name: 't'.repeat(1025), scheduledFor: -1, id: 'i' } }).toolResult, V({ taskName: I, scheduledForMs: I, id: V('i') }));
  const failed = claude('PostToolUseFailure', { tool_name: 'Bash', tool_input: {}, error: 'e'.repeat(16 * 1024 + 1) }).private.failure;
  assert.deepEqual(failed, V({ error: I, isInterrupt: M }));
  assert.equal(Object.hasOwn(post({}), 'failure'), false, 'failure applies only to tool errors');
});

test('Claude Stop lists, prompts, paths and small strings enforce their bounds', () => {
  const stop = (over) => claude('Stop', over).private;
  assert.equal(stop({ background_tasks: Array.from({ length: 1024 }, () => ({ type: 'shell', status: 'done' })) }).backgroundTasks.status, 'valid');
  assert.deepEqual(stop({ background_tasks: Array.from({ length: 1025 }, () => ({ type: 'shell', status: 'done' })) }).backgroundTasks, I);
  assert.deepEqual(stop({ background_tasks: [{ type: 'x'.repeat(257), status: 'done' }] }).backgroundTasks, I);
  assert.deepEqual(stop({ background_tasks: [{ type: 'shell' }] }).backgroundTasks, I);
  assert.deepEqual(stop({ background_tasks: [{ type: 'mystery', status: 'odd' }] }).backgroundTasks, V([{ type: 'mystery', status: 'odd' }]));
  assert.deepEqual(stop({ session_crons: [{ id: 1, prompt: 'p' }] }).sessionCrons, I, 'invalid cron id');
  assert.deepEqual(stop({ session_crons: [{ id: 'c' }] }).sessionCrons, I, 'cron without prompt');
  assert.deepEqual(stop({ session_crons: Array.from({ length: 129 }, (_, i) => ({ id: `c${i}`, prompt: 'p' })) }).sessionCrons, I);
  assert.deepEqual(stop({ session_crons: [{ id: 'c', prompt: 'p'.repeat(8193) }] }).sessionCrons, I);
  assert.deepEqual(stop({ session_crons: Array.from({ length: 128 }, (_, i) => ({ id: `c${i}`, prompt: 'p'.repeat(8192) })) }).sessionCrons, I, 'over 1 MiB total');
  assert.deepEqual(stop({ session_crons: 'none' }).sessionCrons, I);
  assert.deepEqual(stop({}).sessionCrons, M);
  assert.equal(registryEventFor(claude('Stop', { background_tasks: [{ type: 'shell' }] })).background, null, 'unreadable background stays null in the registry event');
  assert.deepEqual(claude('UserPromptSubmit', { prompt: 'p'.repeat(1024 * 1024 + 1) }).private.prompt, I);
  assert.deepEqual(claude('UserPromptSubmit', {}).private.prompt, M);
  const start = (over) => claude('SessionStart', over);
  assert.deepEqual(start({ transcript_path: 'relative.jsonl' }).private.transcriptPath, I);
  assert.deepEqual(start({ transcript_path: `/${'p'.repeat(8192)}` }).private.transcriptPath, I);
  assert.deepEqual(start({ scratchpad_dir: '/a\0b' }).private.scratchpadDir, I);
  assert.deepEqual(start({ model: 'm'.repeat(4097) }).facts.model, I);
  assert.deepEqual(start({ model: 'm'.repeat(4096) }).facts.model, V('m'.repeat(4096)));
  assert.deepEqual(claude('SubagentStart', { agent_id: 'a'.repeat(1025), agent_type: 7 }).facts, { childId: I, agentType: I });
  assert.deepEqual(claude('SubagentStop', { agent_id: 'a', agent_type: '' }).facts.agentType, V(''), 'empty summarizer type is valid');
  assert.deepEqual(claude('Stop', { stop_hook_active: 'true' }).facts.stopHookActive, I);
  assert.throws(() => registryEventFor(claude('Stop', { stop_hook_active: 'true' })), { code: 'INVALID_INPUT' });
  assert.deepEqual(claude('PreCompact', { trigger: ['auto'] }).facts.compactionTrigger, I);
});

test('facts and private fields appear only on their applicable events', () => {
  const prompt = claude('UserPromptSubmit', { prompt: 'p', stop_hook_active: true, model: 'm', tool_input: { command: 'x' } });
  assert.deepEqual(prompt.facts, {});
  assert.deepEqual(Object.keys(prompt.private), ['prompt']);
  assert.equal(prompt.tool, null);
  assert.deepEqual(Object.keys(claude('Stop', {}).private).sort(), ['backgroundTasks', 'sessionCrons']);
  const codexStop = normalizeHookEvent('codex', 'Stop', JSON.stringify({ session_id: 's', cwd: '/repo', background_tasks: [] }), opts);
  assert.deepEqual(codexStop.private, {}, 'Claude-only Stop lists are not Codex fields');
});

test('Codex text tool responses decode before projection and no other result text is copied', () => {
  const { input, expected } = fixture('codex', 'PostToolUse');
  const event = normalizeHookEvent('codex', 'PostToolUse', JSON.stringify(input), opts);
  assert.deepEqual(event.private.toolResult, expected.hookEvent.private.toolResult);
  assert.equal(JSON.stringify(event).includes('not copied'), false);
});

test('agy preserves every own-termination string across absent and invalid retry and identity facts', () => {
  for (const terminationReason of ['ERROR', 'USER_CANCELED', 'MAX_INVOCATIONS', 'MAX_FORCED_INVOCATIONS', 'MAX_TOKEN_BUDGET_EXCEEDED', 'TERMINAL_CUSTOM_HOOK']) {
    for (const executionNum of [undefined, null, '1', true, -1, 1.5]) {
      for (const conversationId of [undefined, '', 7, 'conv-1']) {
        const body = { terminationReason, ...(executionNum === undefined ? {} : { executionNum }), ...(conversationId === undefined ? {} : { conversationId }) };
        const event = normalizeHookEvent('agy', 'Stop', JSON.stringify(body), opts);
        const label = JSON.stringify(body);
        assert.deepEqual(event.facts.terminationReason, V(terminationReason), label);
        assert.deepEqual(event.facts.executionNum, executionNum === undefined ? M : I, label);
        assert.deepEqual(event.identity, conversationId === undefined ? M : conversationId === 'conv-1' ? V({ agentId: 'agy:conv-1', sessionId: 'conv-1' }) : I, label);
        assert.equal(event.cwd, '/invoking', label);
      }
    }
  }
  const idle = (fullyIdle, executionNum) => normalizeHookEvent('agy', 'Stop', JSON.stringify({ conversationId: 'c', workspacePaths: ['/repo'], terminationReason: 'NO_TOOL_CALL', executionNum, fullyIdle }), opts).facts;
  assert.deepEqual(idle(false, 0), { terminationReason: V('NO_TOOL_CALL'), executionNum: V(0), fullyIdle: V(false) });
  assert.deepEqual(idle(true, 3), { terminationReason: V('NO_TOOL_CALL'), executionNum: V(3), fullyIdle: V(true) });
  assert.deepEqual(idle('yes', 0).fullyIdle, I);
  assert.deepEqual(normalizeHookEvent('agy', 'Stop', JSON.stringify({ terminationReason: 'x'.repeat(4097) }), opts).facts.terminationReason, I);
});

test('envelopes carry private fields only to guards and explicitly selecting observers', () => {
  const config = validateSubscribers({ schema: 2, subscribers: [
    { name: 'guard', role: 'guard', kinds: ['before-tool'], harnesses: ['claude-code'], argv: ['/usr/bin/true'], timeoutMs: 100 },
    { name: 'ordinary', role: 'observer', registry: 'occurrence', kinds: ['after-tool'], argv: ['/usr/bin/true'], timeoutMs: 100 },
    { name: 'counter', role: 'observer', registry: 'occurrence', kinds: ['after-tool', 'tool-error'], harnesses: ['claude-code'], tools: ['Bash'],
      privateFields: [{ nativeEvent: 'PostToolUse', fields: ['command', 'durationMs'] }, { nativeEvent: 'PostToolUseFailure', fields: ['command', 'durationMs'] }], argv: ['/usr/bin/true'], timeoutMs: 100 },
  ] });
  const [guard, ordinary, counterSub] = config.subscribers;
  const { input } = fixture('claude-code', 'PostToolUse', 'bash-counter');
  const post = normalizeHookEvent('claude-code', 'PostToolUse', JSON.stringify(input), opts);
  const access = { status: 'not-requested' };
  const ordinaryEnvelope = projectEnvelope(post, ordinary, access);
  assert.deepEqual(ordinaryEnvelope, { schema: 2, type: 'event', subscriber: 'ordinary', event: { ...post, private: {} }, registry: access });
  const counter = projectEnvelope(post, counterSub, access);
  assert.deepEqual(counter.event.private, { command: V('just test-one test/child.test.js'), durationMs: V(4200) });
  assert.deepEqual(counter.event.private.command, { status: 'valid', value: 'just test-one test/child.test.js' });
  assert.equal(counter.event.cwd, '/repo');
  const { input: preInput } = fixture('claude-code', 'PreToolUse');
  const pre = normalizeHookEvent('claude-code', 'PreToolUse', JSON.stringify(preInput), opts);
  assert.deepEqual(projectEnvelope(pre, guard, access).event.private, pre.private);
  const ready = { status: 'ready', generation: '00000000-0000-4000-8000-000000000000', revision: 3 };
  assert.deepEqual(projectEnvelope(post, ordinary, ready).registry, ready);
});

test('the package root exports the hook event contract', () => {
  for (const name of ['normalizeHookEvent', 'registryEventFor', 'projectEnvelope']) assert.equal(typeof relay[name], 'function', name);
});
