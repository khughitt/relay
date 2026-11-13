import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adapterFor, normalizeEvent } from '../src/adapters/index.js';
import { appDataDirFromPayload } from '../src/adapters/agy.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/agy/${name}.json`, import.meta.url), 'utf8'));
const run = (event, body) => normalizeEvent('agy', event, JSON.stringify(body));

test('agy translates each event', () => {
  for (const event of ['SessionStart', 'PreToolUse', 'Stop']) {
    const f = fixture(event), e = run(event, f);
    assert.equal(e.agentId, `agy:${f.conversationId}`);
    assert.equal(e.sessionId, f.conversationId);
    assert.equal(e.cwd, f.workspacePaths[0]);
  }
  const pre = run('PreToolUse', fixture('PreToolUse'));
  assert.equal(pre.kind, 'before-tool');
  assert.equal(pre.tool.name, 'Bash');
  assert.equal(pre.tool.command, fixture('PreToolUse').toolCall.args.CommandLine);
  assert.equal(run('Stop', { ...fixture('Stop'), executionNum: 0 }).stopHookActive, false);
  assert.equal(run('Stop', { ...fixture('Stop'), executionNum: 1 }).stopHookActive, true);
  assert.equal(Object.hasOwn(run('Stop', (({ executionNum, ...r }) => r)(fixture('Stop'))), 'stopHookActive'), false);
  assert.equal(run('SessionStart', { ...fixture('SessionStart'), lastUserInput: '' }).kind, 'session-start');
});

test('agy non-shell tools keep their name and args', () => {
  const e = run('PreToolUse', { ...fixture('PreToolUse'), toolCall: { name: 'view_file', args: { AbsolutePath: '/x' } } });
  assert.equal(e.tool.name, 'view_file');
  assert.equal(e.tool.input.AbsolutePath, '/x');
  assert.equal(e.tool.command, null);
});

test('agy run_command without CommandLine', () => {
  for (const args of [{}, { CommandLine: 5 }, undefined]) {
    const e = run('PreToolUse', { ...fixture('PreToolUse'), toolCall: { name: 'run_command', args } });
    assert.equal(e.tool.command, null);
  }
});

test('agy payload refusals', () => {
  const bad = (event, body) => assert.throws(() => normalizeEvent('agy', event, typeof body === 'string' ? body : JSON.stringify(body)), { code: 'INVALID_INPUT' });
  bad('Stop', 'null'); bad('Stop', '[]');
  const stop = fixture('Stop'), pre = fixture('PreToolUse');
  const without = (o, k) => { const c = { ...o }; delete c[k]; return c; };
  bad('Stop', without(stop, 'conversationId')); bad('Stop', { ...stop, conversationId: 5 });
  bad('Stop', without(stop, 'workspacePaths'));
  for (const workspacePaths of [[], ['relative'], ['/a\u0000b']]) bad('Stop', { ...stop, workspacePaths });
  for (const executionNum of [-1, 1.5, '0']) bad('Stop', { ...stop, executionNum });
  bad('PreToolUse', without(pre, 'toolCall')); bad('PreToolUse', { ...pre, toolCall: null }); bad('PreToolUse', { ...pre, toolCall: 'x' });
});

test('agy translation does not mutate input', () => {
  const adapter = adapterFor('agy');
  for (const event of ['SessionStart', 'PreToolUse', 'Stop']) {
    const f = fixture(event), before = structuredClone(f);
    adapter.nativeFields(f, event);
    assert.deepEqual(f, before);
  }
});

test('agy replies', () => {
  const { encodeReply } = adapterFor('agy');
  assert.deepEqual(encodeReply('PreToolUse', { decision: 'deny', reason: 'no' }), { stdout: '{"decision":"deny","reason":"no"}\n', stderr: 'no\n', exitCode: 0 });
  for (const event of ['SessionStart', 'PreToolUse', 'Stop']) assert.deepEqual(encodeReply(event, { decision: 'allow' }), { stdout: '', stderr: '', exitCode: 0 });
  // A Stop denial holds the turn with decision continue on exit 0; SessionStart and PreInvocation inject context.
  assert.deepEqual(encodeReply('Stop', { decision: 'deny', reason: 'held claim' }), { stdout: '{"decision":"continue","reason":"held claim"}\n', stderr: 'held claim\n', exitCode: 0 });
  for (const event of ['SessionStart', 'PreInvocation']) assert.deepEqual(encodeReply(event, { decision: 'allow', context: 'c' }), { stdout: '{"injectSteps":[{"systemMessage":{"systemMessage":"c"}}]}\n', stderr: '', exitCode: 0 });
  for (const event of ['SessionStart', 'PreInvocation']) assert.throws(() => encodeReply(event, { decision: 'deny', reason: 'no' }), { code: 'UNSUPPORTED_REPLY' });
  for (const event of ['PreToolUse', 'Stop']) assert.throws(() => encodeReply(event, { decision: 'allow', context: 'c' }), { code: 'UNSUPPORTED_REPLY' });
});

test('agy events and state', () => {
  const agy = adapterFor('agy');
  assert.deepEqual(Object.entries(agy.events).map(([k, v]) => [k, v.kind, v.level]),
    [['SessionStart', 'session-start', 'idle'], ['PreToolUse', 'before-tool', 'working'], ['Stop', 'turn-end', 'done']]);
  assert.deepEqual(agy.replies, { PreToolUse: { refuse: true, context: false }, Stop: { refuse: true, context: false },
    SessionStart: { refuse: false, context: true }, PreInvocation: { refuse: false, context: true } });
  for (const event of ['PreInvocation', 'PostToolUse']) assert.throws(() => agy.stateForEvent(event), { code: 'UNSUPPORTED_EVENT' });
  assert.equal(agy.reduceState('done', 'working'), 'done');
});

test('agy process identity uses the agy comm', () => {
  const agy = adapterFor('agy');
  assert.equal(agy.isHarness({ pid: 1, comm: 'agy', tty: null }, { executableOf: () => '' }), true);
  assert.equal(agy.isHarness({ pid: 1, comm: 'codex', tty: null }, { executableOf: () => '' }), false);
});

test('appDataDirFromPayload extracts app-data dir from valid artifactDirectoryPath and rejects invalid paths', () => {
  const f = { ...fixture('SessionStart'), artifactDirectoryPath: `/home/user/.gemini/antigravity-cli/brain/${fixture('SessionStart').conversationId}` };
  assert.equal(appDataDirFromPayload(JSON.stringify(f), f.conversationId), '/home/user/.gemini/antigravity-cli');
  assert.equal(appDataDirFromPayload(Buffer.from(JSON.stringify(f)), f.conversationId), '/home/user/.gemini/antigravity-cli');

  // Missing, relative, NUL byte, parent !== 'brain', basename !== sessionId, invalid JSON
  const withoutArtifact = { ...f };
  delete withoutArtifact.artifactDirectoryPath;
  assert.equal(appDataDirFromPayload(JSON.stringify(withoutArtifact), f.conversationId), undefined);
  assert.equal(appDataDirFromPayload(JSON.stringify({ ...f, artifactDirectoryPath: `relative/brain/${f.conversationId}` }), f.conversationId), undefined);
  assert.equal(appDataDirFromPayload(JSON.stringify({ ...f, artifactDirectoryPath: `/home/user\0/.gemini/brain/${f.conversationId}` }), f.conversationId), undefined);
  assert.equal(appDataDirFromPayload(JSON.stringify({ ...f, artifactDirectoryPath: `/home/user/.gemini/other/${f.conversationId}` }), f.conversationId), undefined);
  assert.equal(appDataDirFromPayload(JSON.stringify(f), '00000000-0000-4000-8000-000000000000'), undefined);
  assert.equal(appDataDirFromPayload('not-json', f.conversationId), undefined);
  assert.equal(appDataDirFromPayload('null', f.conversationId), undefined);
});

test('agy hook events stay the three qualified decoders; PreInvocation has no guessed decoder', async () => {
  const { normalizeHookEvent } = await import('../src/adapters/hook-event.js');
  assert.deepEqual(Object.keys(adapterFor('agy').hookEvents).sort(), ['PreToolUse', 'SessionStart', 'Stop']);
  assert.throws(() => normalizeHookEvent('agy', 'PreInvocation', JSON.stringify({ conversationId: 'c', workspacePaths: ['/repo'] }), { invokingCwd: '/invoking' }), { code: 'UNSUPPORTED_EVENT' });
  const stop = normalizeHookEvent('agy', 'Stop', JSON.stringify({ conversationId: 'c', workspacePaths: ['/repo'], executionNum: -1, terminationReason: 'USER_CANCELED' }), { invokingCwd: '/invoking' });
  assert.deepEqual(stop.facts.executionNum, { status: 'invalid' });
  assert.throws(() => normalizeEvent('agy', 'Stop', JSON.stringify({ conversationId: 'c', workspacePaths: ['/repo'], executionNum: -1 })), { code: 'INVALID_INPUT' }, 'released registry normalization is unchanged');
});
