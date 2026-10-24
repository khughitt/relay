import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { questionMessage, noticeMessage } from './helpers/interaction.js';
import { tempState } from './helpers/fixture.js';
import { runCli, serveCli, askCli, entryForCli, preInput } from './helpers/cli-interaction.js';

test('serve, presence, answer and confirmation through the real CLI', { timeout: 30000 }, async (t) => {
  const p = await tempState(t), service = await serveCli(t, p);
  assert.equal(runCli(p, ['presence']).stdout, 'here\n');
  const away = runCli(p, ['--json', 'presence', 'away']);
  assert.equal(away.status, 0, away.stderr);
  assert.equal(JSON.parse(away.stdout).presence.mode, 'away');
  const hook = askCli(t, p), entry = await entryForCli(p);
  const answer = runCli(p, ['inbox', 'answer', entry.id, 'q1=o2']);
  assert.equal(answer.status, 0, answer.stderr);
  assert.match(answer.stdout, /answer saved/);
  const line = await hook.next((m) => m.hookSpecificOutput);
  assert.deepEqual(line.hookSpecificOutput.updatedInput.answers, { 'Which?': 'B' });
  assert.equal((await hook.exited).code, 0);
  assert.equal(hook.stderr(), '');
  const show = runCli(p, ['inbox', 'show', entry.id, '--json']);
  assert.equal(show.status, 0, show.stderr);
  assert.equal(JSON.parse(show.stdout).entry.state, 'handed');
  assert.match(runCli(p, ['inbox', 'show', entry.id]).stdout, /handed to the agent/);
  const payload = JSON.parse(preInput());
  const post = runCli(p, ['ask', '--harness', 'claude-code', 'PostToolUse'], JSON.stringify({ ...payload,
    hook_event_name: 'PostToolUse', tool_response: { questions: payload.tool_input.questions, answers: { 'Which?': 'B' } } }));
  assert.deepEqual([post.status, post.stdout, post.stderr], [0, '', '']);
  const consumed = JSON.parse(runCli(p, ['--json', 'inbox', 'show', entry.id]).stdout).entry;
  assert.equal(consumed.state, 'consumed');
  assert.match(runCli(p, ['inbox', 'show', entry.id]).stdout, /the agent received it/);
  const changes = JSON.parse(runCli(p, ['inbox', 'list', '--since', '0', '--json']).stdout);
  assert.ok(changes.entries.some((e) => e.id === entry.id));
  const current = runCli(p, ['inbox', 'list', '--json', '--since', String(changes.seq)]);
  assert.equal(current.status, 0, current.stderr);
  assert.deepEqual(JSON.parse(current.stdout).entries, []);
  service.child.kill('SIGTERM');
  assert.equal((await service.exited).code, 0);
  const down = runCli(p, ['--json', 'presence']);
  assert.equal(down.status, 1);
  assert.match(JSON.parse(down.stderr).error.detail, /^SERVE_UNAVAILABLE/);
});

test('defer releases a handback question, decline answers, and withdraw denies', { timeout: 30000 }, async (t) => {
  const p = await tempState(t); await serveCli(t, p);
  assert.equal(runCli(p, ['presence', 'away']).status, 0);
  const released = askCli(t, p, ['--handback'], 'toolu_release'), releaseEntry = await entryForCli(p, 'toolu_release');
  assert.equal(runCli(p, ['inbox', 'defer', releaseEntry.id]).status, 0);
  assert.deepEqual(await released.exited, { code: 0, signal: null });
  assert.equal(JSON.parse(runCli(p, ['--json', 'inbox', 'show', releaseEntry.id]).stdout).entry.state, 'released');
  const declined = askCli(t, p, [], 'toolu_decline'), declineEntry = await entryForCli(p, 'toolu_decline');
  const result = runCli(p, ['inbox', 'answer', '--decline', declineEntry.id, '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).entry.answer.body.outcome, 'declined');
  assert.match((await declined.next((m) => m.hookSpecificOutput)).hookSpecificOutput.additionalContext, /chose not to answer/);
  assert.equal((await declined.exited).code, 0);
  const withdrawn = askCli(t, p, [], 'toolu_withdraw'), withdrawEntry = await entryForCli(p, 'toolu_withdraw');
  assert.equal(runCli(p, ['inbox', 'withdraw', withdrawEntry.id]).status, 0);
  assert.equal((await withdrawn.next((m) => m.hookSpecificOutput)).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal((await withdrawn.exited).code, 0);
});

test('SIGINT stops the service and a second service is refused', { timeout: 15000 }, async (t) => {
  const p = await tempState(t), service = await serveCli(t, p);
  const second = runCli(p, ['--json', 'serve']);
  assert.equal(second.status, 1, second.stderr);
  assert.match(JSON.parse(second.stderr).error.detail, /^SERVE_RUNNING/);
  service.child.kill('SIGINT');
  assert.deepEqual(await service.exited, { code: 0, signal: null });
  assert.equal(runCli(p, ['presence']).status, 1);
});

test('new command usage errors fail before connecting to a service', async (t) => {
  const p = await tempState(t);
  const cases = [
    ['inbox'], ['inbox', 'bogus'], ['inbox', 'bogus', '--help'], ['inbox', 'list', 'extra'], ['inbox', 'show'],
    ['inbox', 'show', 'id', 'extra'], ['inbox', 'defer', 'id', 'extra'], ['inbox', 'withdraw', 'id', 'extra'],
    ['inbox', 'answer'], ['inbox', 'answer', 'id', 'q1=o1', '--decline'], ['inbox', 'answer', 'id', '--decline', '--decline'],
    ['inbox', 'list', '--since'], ['inbox', 'list', '--since', '-1'], ['inbox', 'list', '--since', '1.5'],
    ['inbox', 'list', '--since', '9007199254740992'], ['inbox', 'list', '--since', '1e3'],
    ['inbox', 'list', '--since', '1', '--since', '2'], ['inbox', 'list', '--decline'], ['inbox', 'show', 'id', '--since', '0'],
    ['inbox', 'answer', 'id', '--bogus'], ['inbox', 'show', '-x'], ['serve', 'extra'], ['serve', '--bogus'],
    ['presence', 'gone'], ['presence', 'here', 'away'], ['presence', '--bogus'],
    ['ask'], ['ask', 'PreToolUse', '--harness', 'claude-code'], ['ask', '--harness', 'claude-code'],
    ['ask', '--harness', 'claude-code', 'Stop'], ['ask', '--harness', 'codex', 'PreToolUse'], ['ask', '--harness', 'opencode', 'PostToolUse'],
    ['ask', '--harness', 'invalid', 'PreToolUse'], ['ask', '--harness', 'claude-code', 'PreToolUse', '--handback'],
    ['ask', '--harness', 'claude-code', '--handback', '--handback', 'PreToolUse'],
    ['ask', '--harness', 'claude-code', '--bogus', 'PreToolUse'], ['ask', '--harness', 'claude-code', 'PreToolUse', 'PostToolUse'],
  ];
  for (const args of cases) {
    const r = runCli(p, args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.equal(r.stdout, '', args.join(' '));
    assert.match(r.stderr, /^relay: /, args.join(' '));
  }
  assert.match(runCli(p, ['inbox']).stderr, /list, ask, take, show, answer, defer, withdraw/);
  assert.match(runCli(p, ['ask', '--harness', 'codex', 'PreToolUse']).stderr, /the ask route exists only for claude-code/);
  assert.match(runCli(p, ['ask', '--harness', 'invalid', 'PreToolUse']).stderr,
    /--harness must be one of claude-code, codex, opencode, got "invalid"/);
});

test('ask preserves hook passthrough on missing service and malformed input', async (t) => {
  const p = await tempState(t);
  const down = runCli(p, ['ask', '--harness', 'claude-code', 'PreToolUse'], preInput());
  assert.deepEqual([down.status, down.stdout], [0, '']);
  assert.match(down.stderr, /SERVE_UNAVAILABLE/);
  const bad = runCli(p, ['ask', '--harness', 'claude-code', 'PreToolUse'], '{');
  assert.deepEqual([bad.status, bad.stdout], [0, '']);
  assert.match(bad.stderr, /INVALID_INPUT/);
});

test('ask configuration failures pass through while invalid argv still exits 2', async (t) => {
  const p = await tempState(t), env = { RELAY_STATE_DIR: 'relative-path' };
  for (const flags of [[], ['--json']]) {
    const r = runCli(p, [...flags, 'ask', '--harness', 'claude-code', 'PreToolUse'], preInput(), env);
    assert.deepEqual([r.status, r.stdout], [0, '']);
    assert.match(r.stderr, /^relay ask: INVALID_INPUT: expected absolute directory\n$/);
  }
  const invalid = runCli(p, ['ask', '--harness', 'claude-code', 'Stop'], preInput(), env);
  assert.equal(invalid.status, 2, invalid.stderr);
});

test('CLI subprocess fixtures isolate parent secrets and own their home', async (t) => {
  const { cliEnv } = await import('./helpers/cli-interaction.js');
  const { spawnSync } = await import('node:child_process');
  const { spawnLines } = await import('./helpers/spawn-lines.js');
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const p = await tempState(t);
  process.env.RELAY_TEST_PARENT_SECRET = 'synthetic-parent-only';
  t.after(() => { delete process.env.RELAY_TEST_PARENT_SECRET; });
  const code = 'console.log(JSON.stringify({secret: process.env.RELAY_TEST_PARENT_SECRET ?? null, home: process.env.HOME}))';
  const direct = spawnSync(process.execPath, ['-e', code], { env: cliEnv(p), encoding: 'utf8' });
  assert.equal(direct.status, 0, direct.stderr);
  assert.deepEqual(JSON.parse(direct.stdout), { secret: null, home: join(p.stateDir, 'home') });
  const fixture = join(p.stateDir, 'environment.mjs'); await writeFile(fixture, code);
  const child = spawnLines(t, fixture), row = await child.next(() => true);
  assert.equal(row.secret, null); assert.ok(row.home); assert.notEqual(row.home, process.env.HOME);
  await child.exited;
});

async function questionFile(p, patch = {}) {
  const now = Date.now(), q = questionMessage({ createdAt: now, ...patch,
    body: { native: null, expiresAt: now + 604800000, ...(patch.body ?? {}) } });
  const file = join(p.stateDir, `${q.id}.json`); await writeFile(file, JSON.stringify(q));
  return { q, file };
}
test('detached CLI ask survives its process and take is idempotent', async (t) => {
  const p = await tempState(t); await serveCli(t, p);
  for (const mode of ['here', 'away']) {
    runCli(p, ['presence', mode]); const { q, file } = await questionFile(p);
    const ask = runCli(p, ['inbox', 'ask', '--file', file, '--json']);
    assert.equal(ask.status, 0, ask.stderr);
    assert.equal(JSON.parse(ask.stdout).entry.state, 'pending');
    assert.equal(JSON.parse(runCli(p, ['inbox', 'show', q.id, '--json']).stdout).entry.state, 'pending');
    const answered = runCli(p, ['inbox', 'answer', q.id, 'q1=o2', '--surface', 'terminal', '--json']);
    assert.equal(answered.status, 0, answered.stderr);
    assert.equal(JSON.parse(answered.stdout).entry.answer.body.surface, 'terminal');
    const first = runCli(p, ['inbox', 'take', q.id, '--json']), again = runCli(p, ['--json', 'inbox', 'take', q.id]);
    assert.equal(first.status, 0, first.stderr); assert.equal(again.status, 0, again.stderr);
    assert.equal(JSON.parse(first.stdout).entry.state, 'consumed');
    assert.deepEqual(JSON.parse(first.stdout), JSON.parse(again.stdout));
    assert.match(runCli(p, ['inbox', 'take', q.id]).stdout, /the agent received it/);
  }
});
test('detached CLI surfaces, decline and withdrawal preserve sender direction', async (t) => {
  const p = await tempState(t); await serveCli(t, p);
  for (const decline of [false, true]) {
    const { q, file } = await questionFile(p); assert.equal(runCli(p, ['inbox', 'ask', '--file', file]).status, 0);
    const args = decline ? ['--decline', '--surface', 'terminal'] : ['q1=o1'];
    const r = runCli(p, ['inbox', 'answer', q.id, ...args, '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).entry.answer.body.surface, decline ? 'terminal' : 'cli');
    assert.equal(JSON.parse(r.stdout).entry.answer.body.outcome, decline ? 'declined' : 'answered');
  }
  for (const reason of ['user', 'asker']) {
    const { q, file } = await questionFile(p); runCli(p, ['inbox', 'ask', '--file', file]);
    const r = runCli(p, ['inbox', 'withdraw', q.id, ...(reason === 'asker' ? ['--reason', 'asker'] : []), '--json']);
    assert.equal(r.status, 0, r.stderr);
    const e = JSON.parse(r.stdout).entry, withdrawal = e.messages.at(-1).message;
    assert.equal(e.withdrawal.reason, reason);
    assert.deepEqual([withdrawal.from, withdrawal.to], reason === 'asker' ? [q.from, { kind: 'user' }] : [{ kind: 'user' }, q.from]);
    const take = runCli(p, ['inbox', 'take', q.id, '--json']);
    assert.equal(take.status, 1); assert.match(JSON.parse(take.stderr).error.detail, /^WITHDRAWN:/);
  }
});
test('ask-file local validation and service validation stay distinct', async (t) => {
  const p = await tempState(t), file = join(p.stateDir, 'question.json');
  const check = (code) => {
    const r = runCli(p, ['inbox', 'ask', '--file', file, '--json']);
    assert.equal(r.status, 1, r.stderr); assert.equal(r.stdout, '');
    const error = JSON.parse(r.stderr).error;
    assert.equal(error.kind, 'inbox-ask_failed'); assert.ok(error.detail.startsWith(`${code}:`), error.detail);
    return error;
  };
  const missing = check('ENOENT'); assert.ok(missing.detail.includes(file));
  assert.equal(missing.detail.split('ENOENT').length, 2);
  for (const input of ['{', JSON.stringify(noticeMessage()), JSON.stringify({})]) { await writeFile(file, input); check('INVALID_MESSAGE'); }
  const now = Date.now(), native = questionMessage({ createdAt: now });
  await writeFile(file, JSON.stringify(native)); check('UNSUPPORTED_ROUTE');
  const { q } = await questionFile(p);
  for (const extra of [{ typo: 'extra' }, { body: { ...q.body, expireAt: q.body.expiresAt } }, { from: { ...q.from, typo: 'extra' } }]) {
    await writeFile(file, JSON.stringify({ ...q, ...extra })); check('INVALID_MESSAGE');
  }
  const wrongParties = [{ ...q, from: { kind: 'user' } }, { ...q, to: q.from }];
  for (const message of wrongParties) { await writeFile(file, JSON.stringify(message)); check('SERVE_UNAVAILABLE'); }
  await serveCli(t, p);
  for (const message of wrongParties) { await writeFile(file, JSON.stringify(message)); check('INVALID_MESSAGE'); }
  assert.deepEqual(JSON.parse(runCli(p, ['inbox', 'list', '--json']).stdout).entries, []);
});
test('detached command usage fails before connecting', async (t) => {
  const p = await tempState(t);
  for (const args of [
    ['inbox', 'ask'], ['inbox', 'ask', '--file'], ['inbox', 'ask', '--file', 'a', '--file', 'b'],
    ['inbox', 'ask', 'id', '--file', 'a'], ['inbox', 'take'], ['inbox', 'take', 'id', 'extra'],
    ['inbox', 'answer', 'id', '--surface', 'phone'], ['inbox', 'answer', 'id', '--surface', 'desktop'],
    ['inbox', 'answer', 'id', '--surface', 'unknown'], ['inbox', 'answer', 'id', '--surface'],
    ['inbox', 'answer', 'id', '--surface', 'cli', '--surface', 'terminal'],
    ['inbox', 'withdraw', 'id', '--reason', 'asker-gone'], ['inbox', 'withdraw', 'id', '--reason'],
    ['inbox', 'withdraw', 'id', '--reason', 'asker', '--reason', 'user'],
    ['inbox', 'answer', 'id', 'q1=o1', '--decline'],
  ]) {
    const r = runCli(p, args); assert.equal(r.status, 2, `${args}: ${r.stderr}`); assert.equal(r.stdout, '');
  }
  assert.match(runCli(p, ['inbox']).stderr, /ask.*take/);
});
