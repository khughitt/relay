import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchHook } from '../src/dispatch.js';
import { parseNoticeReply, combineContext } from '../src/dispatch-failure.js';
import { adapterFor } from '../src/adapters/index.js';
import { relayError } from '../src/protocol.js';
import { tempPaths, writeSubscribers } from './helpers/fixture.js';

const fixture = new URL('./fixtures/subscriber.js', import.meta.url).pathname;
const argv = (mode, ...rest) => ['node', fixture, mode, ...rest];
const CWD = realpathSync(mkdtempSync(join(tmpdir(), 'relay-notice-')));
test.after(() => rmSync(CWD, { recursive: true, force: true }));
const local = { resolveSessionPid: () => process.pid, gitContext: async () => ({ remote: null, repoRoot: null }) };
const env = { PATH: process.env.PATH, HOME: CWD };
const notice = (name, mode, over = {}) => ({ name, role: 'notice', kinds: ['session-start'], harnesses: ['claude-code', 'codex'], argv: argv(mode, ...(over.extra ?? [])), timeoutMs: 2000, ...over, extra: undefined });
const strip = (s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
const absent = async (path) => access(path).then(() => false, () => true);
async function hook(p, { harness = 'claude-code', nativeEvent = 'SessionStart', body, deps = {} } = {}) {
  const payload = body ?? (harness === 'agy' ? JSON.stringify({ conversationId: 'c1', workspacePaths: [CWD] }) : JSON.stringify({ session_id: 'sess', cwd: CWD, prompt: 'PRIVATE_PROMPT' }));
  return dispatchHook({ harness, nativeEvent, input: Readable.from([Buffer.from(payload)]), outerMs: 60000 }, { paths: p, env, applyOptions: local, ...deps });
}

test('notice replies are exactly {} or one nonempty context; anything else is refused', () => {
  assert.deepEqual(parseNoticeReply('{}'), {});
  assert.deepEqual(parseNoticeReply('{"context":"hello"}'), { context: 'hello' });
  for (const bad of ['', 'garbage', '[]', 'null', '{"context":""}', '{"context":"  "}', '{"context":7}', '{"decision":"allow"}', '{"context":"x","extra":1}', JSON.stringify({ context: 'x'.repeat(10001) })]) {
    assert.throws(() => parseNoticeReply(bad), { code: 'INVALID_REPLY' }, bad);
  }
});

test('context combines guards then notices in order; a notice that does not fit is dropped whole', () => {
  assert.equal(combineContext(['g'], ['n'.repeat(9998), 'dropped'], { limit: 10000 }).context.length, 10000);
  assert.deepEqual(combineContext(['g'], ['n'.repeat(9998), 'dropped'], { limit: 10000 }).dropped, [1]);
  assert.deepEqual(combineContext(['a', 'b'], ['c', 'd'], { limit: 10000 }), { context: 'a\nb\nc\nd', dropped: [] });
  assert.deepEqual(combineContext([], ['x'.repeat(10001), 'small'], { limit: 10000 }), { context: 'small', dropped: [0] });
  assert.deepEqual(combineContext([], [], { limit: 10000 }), { dropped: [] });
  // Limits count JavaScript string length (UTF-16 code units), as the native ceilings do.
  assert.equal(combineContext([], ['é'.repeat(10000)], { limit: 10000 }).context.length, 10000);
  assert.deepEqual(combineContext([], ['😀'.repeat(5000), 'z'], { limit: 10000 }).dropped, [1]);
  assert.throws(() => combineContext(['g'.repeat(10001)], [], { limit: 10000 }), { code: 'UNSUPPORTED_REPLY' });
});

test('SessionStart notices reach Claude Code and Codex as additionalContext and agy as injectSteps', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [strip(notice('first', 'notice', { extra: ['first'] })), strip(notice('empty', 'notice-empty')), strip(notice('second', 'notice', { extra: ['second'] }))]);
  for (const harness of ['claude-code', 'codex']) {
    const r = await hook(p, { harness });
    assert.equal(r.exitCode, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'notice from first\nnotice from second' } });
  }
  await writeSubscribers(p, [strip(notice('agy', 'notice', { harnesses: ['agy'], extra: ['agy'] }))]);
  const agy = await hook(p, { harness: 'agy' });
  assert.equal(agy.exitCode, 0);
  assert.deepEqual(JSON.parse(agy.stdout), { injectSteps: [{ systemMessage: { systemMessage: 'notice from agy' } }] });
  assert.deepEqual(adapterFor('agy').encodeReply('PreInvocation', { decision: 'allow', context: 'pre' }), { stdout: `${JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: 'pre' } }] })}\n`, stderr: '', exitCode: 0 });
});

test('failed notices fail open with metadata diagnostics and keep the remaining context', async (t) => {
  const p = await tempPaths(t);
  const marker = 'relay-test-notice-hang';
  await writeSubscribers(p, [strip(notice('ok', 'notice', { extra: ['ok'] })), strip(notice('garbage', 'garbage')), strip(notice('deny', 'notice-deny')),
    strip(notice('crash', 'crash')), strip(notice('blank', 'notice-blank')), strip(notice('extra', 'notice-extra')), strip(notice('slow', 'hang', { extra: [marker], timeoutMs: 200 })),
    strip(notice('big', 'notice-long', { extra: ['10000'] })), strip(notice('tail', 'notice', { extra: ['tail'] }))]);
  const r = await hook(p);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, 'notice from ok\nnotice from tail');
  for (const name of ['garbage', 'deny', 'crash', 'blank', 'extra', 'slow']) assert.match(r.stderr, new RegExp(`^NOTICE_FAILED: ${name} SessionStart \\w+`, 'm'), name);
  assert.match(r.stderr, /^NOTICE_DROPPED: big SessionStart/m);
  assert.equal(r.stderr.includes('fixture crashed'), false, 'notice stderr is never forwarded');
  assert.equal(r.stderr.includes('PRIVATE_PROMPT'), false);
});

test('a guard denial skips notices; a publication failure keeps their context', async (t) => {
  const p = await tempPaths(t), file = join(CWD, 'notice-ran');
  await writeSubscribers(p, [{ name: 'g', role: 'guard', kinds: ['prompt'], harnesses: ['claude-code'], argv: argv('deny'), timeoutMs: 2000 },
    { name: 'n', role: 'notice', kinds: ['prompt'], harnesses: ['claude-code'], argv: argv('record', file), timeoutMs: 2000 }]);
  const denied = await hook(p, { nativeEvent: 'UserPromptSubmit' });
  assert.equal(denied.exitCode, 2); assert.ok(await absent(file), 'notices do not run after a denial');
  await writeSubscribers(p, [strip(notice('n', 'notice', { extra: ['n'] }))]);
  const failed = await hook(p, { deps: { apply: async () => { throw relayError('IO_ERROR', 'no storage'); } } });
  assert.equal(failed.exitCode, 0, 'context is only read on exit 0, so a publication failure keeps exit 0 when there is context');
  assert.equal(JSON.parse(failed.stdout).hookSpecificOutput.additionalContext, 'notice from n');
  assert.match(failed.stderr, /^registry: IO_ERROR/m);
});

test('private input echoed to stderr or malformed stdout never reaches diagnostics', async (t) => {
  const p = await tempPaths(t);
  const secret = 'PRIVATE_PROMPT';
  await writeSubscribers(p, [{ name: 'g', role: 'guard', kinds: ['prompt'], harnesses: ['claude-code'], argv: argv('echo-private'), timeoutMs: 2000 }]);
  const guardEcho = await hook(p, { nativeEvent: 'UserPromptSubmit' });
  assert.equal(guardEcho.exitCode, 2); assert.equal((guardEcho.stdout + guardEcho.stderr).includes(secret), false);
  await writeSubscribers(p, [{ name: 'g', role: 'guard', kinds: ['prompt'], harnesses: ['claude-code'], argv: argv('echo-private-field'), timeoutMs: 2000 }]);
  const fieldEcho = await hook(p, { nativeEvent: 'UserPromptSubmit' });
  assert.equal(fieldEcho.exitCode, 2); assert.equal((fieldEcho.stdout + fieldEcho.stderr).includes(secret), false, 'an unexpected reply field name is not echoed');
  await writeSubscribers(p, [strip(notice('n', 'echo-private', { kinds: ['prompt'] }))]);
  const noticeEcho = await hook(p, { nativeEvent: 'UserPromptSubmit' });
  assert.equal(noticeEcho.exitCode, 0); assert.equal((noticeEcho.stdout + noticeEcho.stderr).includes(secret), false);
  await writeSubscribers(p, [{ name: 'counter', role: 'observer', registry: 'occurrence', kinds: ['prompt'], harnesses: ['claude-code'], privateFields: [{ nativeEvent: 'UserPromptSubmit', fields: ['prompt'] }], argv: argv('echo-private'), timeoutMs: 2000 },
    { name: 'plain', role: 'observer', registry: 'occurrence', kinds: ['prompt'], argv: argv('noisy'), timeoutMs: 2000 }]);
  const observerEcho = await hook(p, { nativeEvent: 'UserPromptSubmit' });
  assert.equal(observerEcho.stderr.includes(secret), false, 'a private-field observer stderr is suppressed');
  assert.match(observerEcho.stderr, /^plain: observer noise$/m, 'an ordinary observer keeps its stderr');
});
