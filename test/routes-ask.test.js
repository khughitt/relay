import test from 'node:test';
import * as fs from 'node:fs/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openInbox } from '../src/serve/inbox.js';
import { serveSocket } from '../src/serve/socket.js';
import { createProcessOps } from '../src/bus/proc.js';
import { expectAnswers } from '../src/routes/index.js';
import { Readable } from 'node:stream';
import { runAsk } from '../src/routes/ask.js';
import assert from 'node:assert/strict';
import { tempState } from './helpers/fixture.js';
import { spawnLines } from './helpers/spawn-lines.js';
import { connectSocket } from '../src/serve/client.js';
import { uuid } from './helpers/interaction.js';

const worker = new URL('./fixtures/serve-worker.js', import.meta.url).pathname;
const hook = new URL('./fixtures/ask-hook.js', import.meta.url).pathname;
const pre = (patch = {}) => JSON.stringify({ session_id: 's-test', transcript_path: '/tmp/t.jsonl', cwd: '/tmp', hook_event_name: 'PreToolUse',
  tool_name: 'AskUserQuestion', tool_use_id: 'toolu_test', tool_input: { questions: [{ question: 'Which shape?', header: 'Shape', multiSelect: false,
    options: [{ label: 'Circle', description: 'Round' }, { label: 'Square', description: 'Four sides' }] }] }, ...patch });
const postFixture = JSON.parse(await readFile(new URL('./fixtures/claude-askuserquestion-post.json', import.meta.url), 'utf8'));
const post = (answers) => JSON.stringify({ ...postFixture, session_id: 's-test', tool_use_id: 'toolu_test',
  tool_response: { ...postFixture.tool_response, answers } });
async function service(t, p, env = {}) {
  const w = spawnLines(t, worker, [], { env: { RELAY_STATE_DIR: p.stateDir, ...env } });
  const ready = await w.next((m) => m.type === 'ready');
  const client = await connectSocket(ready.socketPath); t.after(() => client.close());
  return { w, client };
}
const runHook = (t, p, event, input, flags = []) => spawnLines(t, hook, [event, ...flags], { env: { RELAY_STATE_DIR: p.stateDir }, input });
async function entryFor(client, ms = 10000) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    const found = (await client.request('list', { since: 0 })).entries.find((e) => e.question?.body.native?.callId === 'toolu_test');
    if (found) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('no entry');
}
const answer = (e) => ({ schema: 1, id: uuid(), kind: 'answer', correlationId: e.id, from: { kind: 'user' }, to: e.question.from, createdAt: Date.now(), context: e.question.context,
  body: { answerId: uuid(), surface: 'cli', outcome: 'answered', artifactRevision: null, values: { q1: { type: 'choice', optionIds: ['o2'] } } } });
const msg = (e, kind, body) => ({ ...answer(e), kind, body });

test('presence here: passes through at once, creates nothing', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  const h = runHook(t, p, 'PreToolUse', pre());
  assert.equal((await h.exited).code, 0); assert.equal(h.stderr(), '');
  assert.deepEqual((await client.request('list', { since: 0 })).entries, []);
});
test('service down: passes through with a diagnostic', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), h = runHook(t, p, 'PreToolUse', pre());
  assert.equal((await h.exited).code, 0); assert.match(h.stderr(), /SERVE_UNAVAILABLE/);
});
test('an out-of-schema question passes through with a diagnostic', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  await client.request('presence.set', { mode: 'away' });
  const bad = pre({ tool_input: { questions: [{ question: 'Q', header: 'x'.repeat(17), options: [{ label: 'A' }, { label: 'B' }] }] } });
  const h = runHook(t, p, 'PreToolUse', bad);
  assert.equal((await h.exited).code, 0); assert.match(h.stderr(), /INVALID_MESSAGE/);
});
test('away: answer, allow reply once, then PostToolUse confirms consumed', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  await client.request('presence.set', { mode: 'away' });
  const h = runHook(t, p, 'PreToolUse', pre()), e = await entryFor(client);
  assert.equal((await client.request('answer', { message: answer(e) })).ok, true);
  const reply = await h.next((m) => m.hookSpecificOutput);
  assert.deepEqual(reply.hookSpecificOutput.updatedInput.answers, { 'Which shape?': 'Square' });
  assert.equal((await h.exited).code, 0);
  assert.equal((await client.request('get', { id: e.id })).entry.state, 'handed');
  const c = runHook(t, p, 'PostToolUse', post({ 'Which shape?': 'Square' }));
  assert.equal((await c.exited).code, 0);
  assert.equal((await client.request('get', { id: e.id })).entry.state, 'consumed');
});
test('defer with --handback releases: no output', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  await client.request('presence.set', { mode: 'away' });
  const h = runHook(t, p, 'PreToolUse', pre(), ['--handback']), e = await entryFor(client);
  await client.request('defer', { message: msg(e, 'defer', { surface: 'cli' }) });
  assert.equal((await h.exited).code, 0); assert.equal(h.stderr(), '');
  await assert.rejects(h.next((m) => m.hookSpecificOutput, 200));
  assert.equal((await client.request('get', { id: e.id })).entry.state, 'released');
  const c = runHook(t, p, 'PostToolUse', post({ 'Which shape?': 'Circle' }));
  assert.equal((await c.exited).code, 0);
  const released = (await client.request('get', { id: e.id })).entry;
  assert.equal(released.state, 'released');
  assert.deepEqual(released.observed, { 'Which shape?': 'Circle' });
  assert.deepEqual(released.observations.map(({ surface, answers }) => ({ surface, answers })), [{ surface: 'terminal', answers: { 'Which shape?': 'Circle' } }]);
});
test('withdrawal denies with the reason', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  await client.request('presence.set', { mode: 'away' });
  const h = runHook(t, p, 'PreToolUse', pre()), e = await entryFor(client);
  await client.request('withdraw', { message: msg(e, 'withdrawal', { reason: 'user' }) });
  const reply = await h.next((m) => m.hookSpecificOutput);
  assert.deepEqual([reply.hookSpecificOutput.permissionDecision, reply.hookSpecificOutput.permissionDecisionReason], ['deny', 'question withdrawn by the user; do not wait for an answer']);
});
for (const handback of [true, false]) {
  test(`expiry seen after a service restart ${handback ? 'releases' : 'denies'}`, { timeout: 40000 }, async (t) => {
    const p = await tempState(t), a = await service(t, p);
    await a.client.request('presence.set', { mode: 'away' });
    const h = runHook(t, p, 'PreToolUse', pre(), handback ? ['--handback'] : []), e = await entryFor(a.client);
    a.w.child.kill('SIGKILL'); await a.w.exited;
    const b = await service(t, p, { CLOCK_OFFSET_MS: String(24 * 3600 * 1000) });
    assert.equal((await h.exited).code, 0);
    assert.equal(h.stderr(), '');
    if (!handback) assert.match((await h.next((m) => m.hookSpecificOutput)).hookSpecificOutput.permissionDecisionReason, /expired/);
    else {
      await assert.rejects(h.next((m) => m.hookSpecificOutput, 100));
      const c = runHook(t, p, 'PostToolUse', post({ 'Which shape?': 'Circle' }));
      assert.equal((await c.exited).code, 0);
      const expired = (await b.client.request('get', { id: e.id })).entry;
      assert.equal(expired.state, 'expired');
      assert.deepEqual(expired.observations.map(({ surface, answers }) => ({ surface, answers })), [{ surface: 'terminal', answers: { 'Which shape?': 'Circle' } }]);
    }
  });
}
test('a hook killed mid-wait withdraws its question', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  await client.request('presence.set', { mode: 'away' });
  const h = runHook(t, p, 'PreToolUse', pre()), e = await entryFor(client);
  h.child.kill('SIGKILL'); await h.exited;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await client.request('get', { id: e.id })).entry.withdrawal.reason, 'asker-gone');
});
for (const late of [false, true]) {
  test(`service crash between handed and its ack: the hook replies once after reattach (${late ? 'late' : 'early'})`, { timeout: 60000 }, async (t) => {
    const p = await tempState(t), a = await service(t, p, { CRASH_ON: 'handed' });
    await a.client.request('presence.set', { mode: 'away' });
    const h = runHook(t, p, 'PreToolUse', pre()), e = await entryFor(a.client);
    await a.client.request('answer', { message: answer(e) });
    await a.w.exited;
    const b = await service(t, p, { CLOCK_OFFSET_MS: late ? '61000' : '0' });
    const reply = await h.next((m) => m.hookSpecificOutput, 20000);
    assert.equal(reply.hookSpecificOutput.permissionDecision, 'allow');
    assert.equal((await h.exited).code, 0);
    await assert.rejects(h.next((m) => m.hookSpecificOutput, 200)); // exactly one reply
    assert.equal((await b.client.request('get', { id: e.id })).entry.state, late ? 'unconfirmed' : 'handed');
    const c = runHook(t, p, 'PostToolUse', post({ 'Which shape?': 'Square' }));
    assert.equal((await c.exited).code, 0);
    assert.equal((await b.client.request('get', { id: e.id })).entry.state, 'consumed');
  });
}


test('known registry project is normalized once and survives reconnect unchanged', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), a = await service(t, p);
  const registry = { schema: 2, generation: uuid(), revision: 1, agents: {
    'claude-code:s-test': { id: 'claude-code:s-test', harness: 'claude-code', sessionId: 's-test', scope: 'session', process: null,
      cwd: '/tmp', repoRoot: null, remote: null, projectKey: 'known-project', project: 'Project', state: 'working', updatedAt: Date.now() }
  } };
  const original = JSON.stringify(registry);
  await writeFile(p.agentsPath, original, { mode: 0o600 });
  await a.client.request('presence.set', { mode: 'away' });
  const h = runHook(t, p, 'PreToolUse', pre({ projectKey: 'spoof', secret: 'must not persist' })), e = await entryFor(a.client);
  assert.equal(e.question.context.project, 'known-project');
  assert.equal(await readFile(p.agentsPath, 'utf8'), original);
  a.w.child.kill('SIGKILL'); await a.w.exited;
  registry.agents['claude-code:s-test'].projectKey = 'changed-project';
  await writeFile(p.agentsPath, JSON.stringify(registry), { mode: 0o600 });
  const b = await service(t, p);
  await b.client.request('answer', { message: answer(e) });
  assert.equal((await h.next((m) => m.hookSpecificOutput)).hookSpecificOutput.permissionDecision, 'allow');
  assert.equal((await h.exited).code, 0);
  const saved = (await b.client.request('get', { id: e.id })).entry;
  assert.deepEqual(saved.question, e.question); assert.deepEqual(saved.route.waiter, e.route.waiter);
  assert.equal(JSON.stringify(saved).includes('must not persist'), false);
  assert.equal((await b.client.request('list', { since: 0 })).entries.length, 1);
});

for (const [name, event, input, code] of [
  ['malformed JSON', 'PreToolUse', '{', 'INVALID_INPUT'],
  ['unsupported event', 'Stop', pre(), 'INVALID_INPUT'],
  ['unsupported tool', 'PreToolUse', pre({ tool_name: 'Bash' }), 'INVALID_INPUT'],
  ['duplicate prompts', 'PreToolUse', pre({ tool_input: { questions: [JSON.parse(pre()).tool_input.questions[0], JSON.parse(pre()).tool_input.questions[0]] } }), 'INVALID_INPUT'],
  ['bad PostToolUse answers', 'PostToolUse', post({ 'Which shape?': 4 }), 'INVALID_INPUT'],
]) {
  test(`${name} safely passes through without creating an entry`, { timeout: 30000 }, async (t) => {
    const p = await tempState(t), { client } = await service(t, p);
    await client.request('presence.set', { mode: 'away' });
    const h = runHook(t, p, event, input);
    assert.equal((await h.exited).code, 0); assert.match(h.stderr(), new RegExp(code));
    await assert.rejects(h.next((m) => m.hookSpecificOutput, 100));
    assert.deepEqual((await client.request('list', { since: 0 })).entries, []);
  });
}

test('a failing native stream safely resolves with a diagnostic', async () => {
  const input = new Readable({ read() { this.destroy(new Error('read failed')); } });
  const result = await runAsk({ nativeEvent: 'PreToolUse', stdin: input, socketPath: '/unused' });
  assert.equal(result.stdout, ''); assert.equal(result.exitCode, 0); assert.match(result.stderr, /INVALID_INPUT/);
});

test('PostToolUse without a relayed entry quietly confirms nothing', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  const h = runHook(t, p, 'PostToolUse', post({ 'Which shape?': 'Square' }));
  assert.equal((await h.exited).code, 0); assert.equal(h.stderr(), '');
  assert.deepEqual((await client.request('list', { since: 0 })).entries, []);
});

test('a decline is handed and confirmed like an answer', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), { client } = await service(t, p);
  await client.request('presence.set', { mode: 'away' });
  const h = runHook(t, p, 'PreToolUse', pre()), e = await entryFor(client);
  const a = answer(e); a.body.outcome = 'declined'; a.body.values = {};
  await client.request('answer', { message: a });
  const reply = (await h.next((m) => m.hookSpecificOutput)).hookSpecificOutput;
  assert.deepEqual(reply.updatedInput.answers, { 'Which shape?': '(declined)' });
  assert.match(reply.additionalContext, /chose not to answer/);
  assert.equal((await h.exited).code, 0);
  const c = runHook(t, p, 'PostToolUse', post({ 'Which shape?': '(declined)' }));
  assert.equal((await c.exited).code, 0);
  assert.equal((await client.request('get', { id: e.id })).entry.state, 'consumed');
});


test('the hook cannot return stdout before the handed acknowledgement', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), socketPath = join(p.stateDir, 'serve.sock');
  let release, reached;
  const hit = new Promise((resolve) => { reached = resolve; });
  t.after(() => release?.());
  const io = { ...fs, rename: async (from, to) => {
    if (to.endsWith('.json') && JSON.parse(await readFile(from, 'utf8')).state === 'handed') {
      reached(); await new Promise((resolve) => { release = resolve; });
    }
    return fs.rename(from, to);
  } };
  const { inbox } = await openInbox({ stateDir: p.stateDir, expectAnswers, io });
  await inbox.setPresence('away');
  const server = await serveSocket({ inbox, socketPath, processOps: createProcessOps(), log: () => {} });
  t.after(() => server.close());
  const client = await connectSocket(socketPath); t.after(() => client.close());
  let finished = false;
  const running = runAsk({ nativeEvent: 'PreToolUse', stdin: Readable.from([pre()]), socketPath }).then((r) => { finished = true; return r; });
  const e = await entryFor(client);
  await client.request('answer', { message: answer(e) });
  await hit;
  try { await new Promise((resolve) => setTimeout(resolve, 50)); assert.equal(finished, false); }
  finally { release(); }
  assert.equal(JSON.parse((await running).stdout).hookSpecificOutput.permissionDecision, 'allow');
});
