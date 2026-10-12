import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.match(runCli(p, ['inbox']).stderr, /list, show, answer, defer, withdraw/);
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
