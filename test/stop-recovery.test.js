import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dispatchHook } from '../src/dispatch.js';
import { readRecoveryInput, failureReply } from '../src/dispatch-failure.js';
import { adapterFor } from '../src/adapters/index.js';
import { tempPaths, writeSubscribers } from './helpers/fixture.js';

const fixture = new URL('./fixtures/subscriber.js', import.meta.url).pathname;
const cli = new URL('../bin/relay.js', import.meta.url).pathname;
const CWD = realpathSync(mkdtempSync(join(tmpdir(), 'relay-stop-')));
test.after(() => rmSync(CWD, { recursive: true, force: true }));
const local = { resolveSessionPid: () => process.pid, gitContext: async () => ({ remote: null, repoRoot: null }) };
const env = { PATH: process.env.PATH, HOME: CWD };
const block = (reason) => `${JSON.stringify({ decision: 'block', reason })}\n`;
const decoders = [['claude-code', 'Stop', 'turn-end', {}], ['codex', 'Stop', 'turn-end', {}], ['codex', 'SubagentStop', 'child-stop', { agent_id: 'worker' }]];
const retries = { first: undefined, true: true, false: false, string: 'true' };
const body = (extra, retry, over = {}) => JSON.stringify({ session_id: 'sess', cwd: CWD, ...extra, ...(retry === undefined ? {} : { stop_hook_active: retry }), ...over });
const guard = (harness, kind, over = {}) => ({ name: 'g', role: 'guard', kinds: [kind], harnesses: [harness], argv: ['node', fixture, 'allow'], timeoutMs: 1000, ...over });
const fake = (result) => async () => ({ status: 'exited', exitCode: 0, signal: null, stdout: '{"decision":"allow"}', stderr: '', cleanup: 'complete', ...result });

// Each failure stage: how to provoke it (config, payload or runner) for one decoder.
const stages = {
  load: { text: '{ broken' },
  schema: { text: '{"schema":1,"subscribers":[]}' },
  budget: { guard: { timeoutMs: 60000 }, outerMs: 5000 },
  'input-other-field': { over: { session_id: 7 } },
  'root-discovery': { over: { cwd: join(CWD, 'missing-dir') } },
  resolution: { guard: { argv: ['relay-no-such-guard'] } },
  spawn: { run: fake({ status: 'spawn-failed', exitCode: null, stdout: '' }) },
  nonzero: { run: fake({ exitCode: 3, stdout: '' }) },
  'invalid-reply': { run: fake({ stdout: 'garbage' }) },
  overflow: { run: fake({ status: 'output-exceeded', exitCode: null }) },
  timeout: { run: fake({ status: 'timeout', exitCode: null, stdout: '' }) },
  cleanup: { run: fake({ cleanup: 'failed' }) },
};

test('every infrastructure failure blocks a first Stop and never blocks a validated retry', async (t) => {
  const p = await tempPaths(t);
  for (const [harness, nativeEvent, kind, extra] of decoders) {
    for (const [stage, how] of Object.entries(stages)) {
      if (how.text) await writeSubscribers(p, [], { text: how.text });
      else await writeSubscribers(p, [guard(harness, kind, how.guard)]);
      for (const [label, retry] of Object.entries(retries)) {
        const r = await dispatchHook({ harness, nativeEvent, input: Readable.from([Buffer.from(body(extra, retry, how.over))]), outerMs: how.outerMs ?? 20000, subscribersPath: p.subscribersPath },
          { paths: p, env, applyOptions: local, ...(how.run ? { run: how.run } : {}) });
        const where = `${harness} ${nativeEvent} ${stage} retry=${label}`;
        assert.ok(r.stderr.length > 0, `${where}: the failure is diagnosed`);
        assert.equal(r.stderr.includes('PRIVATE'), false, where);
        if (retry === true) assert.deepEqual([r.exitCode, r.stdout], [0, ''], `${where}: a validated retry never blocks again`);
        else { assert.equal(r.exitCode, 2, where); assert.match(r.stdout, /^\{"decision":"block","reason":"relay refused: /, where); }
      }
    }
  }
});

test('an explicit policy denial still refuses a retry, and outranks another guard\'s failure', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [guard('claude-code', 'turn-end', { name: 'broken', argv: ['relay-no-such-guard'] }), guard('claude-code', 'turn-end', { name: 'deny', argv: ['node', fixture, 'deny'] })]);
  for (const retry of [undefined, true]) {
    const r = await dispatchHook({ harness: 'claude-code', nativeEvent: 'Stop', input: Readable.from([Buffer.from(body({}, retry))]), outerMs: 20000, subscribersPath: p.subscribersPath }, { paths: p, env, applyOptions: local });
    assert.deepEqual([r.exitCode, r.stdout], [2, block('denied by fixture')], `retry=${retry}`);
  }
});

test('repeated Stops against a broken config: the first blocks, the native retry passes', async (t) => {
  const p = await tempPaths(t);
  await writeSubscribers(p, [], { text: '{ broken' });
  const brokenConfigFirstStop = await dispatchHook({ harness: 'claude-code', nativeEvent: 'Stop', input: Readable.from([body({}, undefined)]), subscribersPath: p.subscribersPath }, { paths: p, env, applyOptions: local });
  const brokenConfigTrueRetry = await dispatchHook({ harness: 'claude-code', nativeEvent: 'Stop', input: Readable.from([body({}, true)]), subscribersPath: p.subscribersPath }, { paths: p, env, applyOptions: local });
  assert.equal(brokenConfigFirstStop.exitCode, 2);
  assert.equal(brokenConfigTrueRetry.exitCode, 0);
  assert.match(brokenConfigTrueRetry.stderr, /INVALID_CONFIG/);
});

test('the recovery read is bounded, independent of configuration, and never coerces the retry flag', async () => {
  const read = (text) => readRecoveryInput(Readable.from([Buffer.from(text)]), { harness: 'claude-code', nativeEvent: 'Stop' });
  assert.deepEqual((await read(body({}, true))).retry, { status: 'valid', value: true });
  assert.deepEqual((await read(body({}, false))).retry, { status: 'valid', value: false });
  assert.deepEqual((await read(body({}, undefined))).retry, { status: 'missing' });
  for (const text of [body({}, 'true'), body({}, 1), 'not json', '[]', JSON.stringify({ stop_hook_active: true }).slice(0, -1)]) {
    assert.notEqual((await read(text)).retry.status, 'valid', text);
  }
  const bytes = await read(body({}, true));
  assert.equal(bytes.raw.toString('utf8'), body({}, true), 'the same bytes serve normal decoding');
  const stalled = new Readable({ read() {} });
  const started = performance.now(), slow = await readRecoveryInput(stalled, { harness: 'claude-code', nativeEvent: 'Stop' });
  assert.ok(performance.now() - started < 600, 'a stalled stdin ends at the fixed recovery bound');
  assert.equal(slow.raw, null); assert.notEqual(slow.retry.status, 'valid'); assert.equal(slow.errorCode, 'INPUT_TIMEOUT');
  const huge = await read(JSON.stringify({ stop_hook_active: true, pad: 'x'.repeat(4 * 1024 * 1024) }));
  assert.equal(huge.raw, null); assert.notEqual(huge.retry.status, 'valid');
});

test('failure replies follow each event\'s rule', () => {
  const claude = adapterFor('claude-code'), agy = adapterFor('agy');
  const error = Object.assign(new Error('broken'), { code: 'INVALID_CONFIG' });
  const valid = { status: 'valid', value: true };
  assert.equal(failureReply({ adapter: claude, harness: 'claude-code', nativeEvent: 'Stop', retry: valid, error, diagnostics: [] }).exitCode, 0);
  assert.equal(failureReply({ adapter: claude, harness: 'claude-code', nativeEvent: 'Stop', retry: { status: 'missing' }, error, diagnostics: [] }).exitCode, 2);
  assert.equal(failureReply({ adapter: claude, harness: 'claude-code', nativeEvent: 'PreToolUse', retry: valid, error, diagnostics: [] }).exitCode, 2, 'tools stay fail closed');
  assert.equal(failureReply({ adapter: claude, harness: 'claude-code', nativeEvent: 'UserPromptSubmit', retry: valid, error, diagnostics: [] }).exitCode, 2, 'prompts stay fail closed');
  const agyInfrastructure = failureReply({ adapter: agy, harness: 'agy', nativeEvent: 'Stop', retry: { status: 'missing' }, error, diagnostics: [] });
  assert.equal(agyInfrastructure.stdout, ''); assert.equal(agyInfrastructure.exitCode, 0);
  const agyExplicitDeny = failureReply({ adapter: agy, harness: 'agy', nativeEvent: 'Stop', explicitDenial: 'held claim', diagnostics: [] });
  assert.equal(agyExplicitDeny.stdout, '{"decision":"continue","reason":"held claim"}\n');
  assert.equal(failureReply({ adapter: agy, harness: 'agy', nativeEvent: 'PreToolUse', error, diagnostics: [] }).stdout.startsWith('{"decision":"deny"'), true);
});

test('agy Stop: infrastructure failure never continues; cancellation with invalid facts reaches the guard unchanged', async (t) => {
  const p = await tempPaths(t), file = join(CWD, 'agy-stop.json');
  await writeSubscribers(p, [{ name: 'claims', role: 'guard', kinds: ['turn-end'], harnesses: ['agy'], argv: ['node', fixture, 'record', file], timeoutMs: 2000 }]);
  const canceled = JSON.stringify({ conversationId: 7, executionNum: '1', terminationReason: 'USER_CANCELED' });
  const r = await dispatchHook({ harness: 'agy', nativeEvent: 'Stop', input: Readable.from([canceled]), outerMs: 20000, subscribersPath: p.subscribersPath }, { paths: p, env, applyOptions: local, invokingCwd: CWD });
  assert.equal(r.stdout, ''); assert.equal(r.exitCode, 0);
  const seen = JSON.parse(await readFile(file, 'utf8')).event;
  assert.deepEqual([seen.identity, seen.facts.executionNum, seen.facts.terminationReason], [{ status: 'invalid' }, { status: 'invalid' }, { status: 'valid', value: 'USER_CANCELED' }]);
  await writeSubscribers(p, [{ name: 'claims', role: 'guard', kinds: ['turn-end'], harnesses: ['agy'], argv: ['relay-no-such-guard'], timeoutMs: 2000 }]);
  const broken = await dispatchHook({ harness: 'agy', nativeEvent: 'Stop', input: Readable.from([JSON.stringify({ conversationId: 'c', workspacePaths: [CWD], executionNum: 0 })]), outerMs: 20000, subscribersPath: p.subscribersPath }, { paths: p, env, applyOptions: local, invokingCwd: CWD });
  assert.deepEqual([broken.stdout, broken.exitCode], ['', 0], 'an infrastructure failure on agy Stop never encodes continue');
  await writeSubscribers(p, [{ name: 'claims', role: 'guard', kinds: ['turn-end'], harnesses: ['agy'], argv: ['node', fixture, 'deny'], timeoutMs: 2000 }]);
  const denied = await dispatchHook({ harness: 'agy', nativeEvent: 'Stop', input: Readable.from([JSON.stringify({ conversationId: 'c', workspacePaths: [CWD], executionNum: 0 })]), outerMs: 20000, subscribersPath: p.subscribersPath }, { paths: p, env, applyOptions: local, invokingCwd: CWD });
  assert.deepEqual([denied.stdout, denied.exitCode], ['{"decision":"continue","reason":"denied by fixture"}\n', 0]);
});

test('a CLI option error on a known Stop event follows the Stop recovery rule', () => {
  const run = (retry) => spawnSync(process.execPath, [cli, 'hook', '--harness', 'claude-code', '--outer-ms', 'abc', 'Stop'], { encoding: 'utf8', input: body({}, retry), env });
  const first = run(undefined), retried = run(true);
  assert.equal(first.status, 2); assert.match(first.stdout, /^\{"decision":"block","reason":"relay refused: USAGE/);
  assert.equal(retried.status, 0); assert.equal(retried.stdout, ''); assert.match(retried.stderr, /USAGE/);
  const tool = spawnSync(process.execPath, [cli, 'hook', '--harness', 'claude-code', '--outer-ms', 'abc', 'PreToolUse'], { encoding: 'utf8', input: '{}', env });
  assert.equal(tool.status, 2); assert.equal(tool.stdout, '', 'other events keep the usage-error exit');
});
