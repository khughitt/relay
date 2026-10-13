import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('answer probe supplies Square for each question and logs the native receipt unchanged', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'answer-probe-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'hook.log');
  const input = { hook_event_name: 'PreToolUse', tool_use_id: 'toolu_test', tool_input: {
    questions: [{ question: 'Which shape?', options: [{ label: 'Circle' }, { label: 'Square' }], multiSelect: false },
      { question: 'And another?', options: [{ label: 'Square' }, { label: 'Circle' }], multiSelect: false }],
  } };
  const hook = (mode, value) => spawnSync(process.execPath, ['tools/answer-probe/hook.mjs', mode, '0', log], {
    input: JSON.stringify(value), encoding: 'utf8', timeout: 5000,
  });
  const result = hook('answer', input);
  assert.equal(result.status, 0, result.stderr);
  const updatedInput = { ...input.tool_input, answers: { 'Which shape?': 'Square', 'And another?': 'Square' } };
  assert.deepEqual(JSON.parse(result.stdout), { hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput,
  } });
  const receipt = hook('post-log', { ...input, hook_event_name: 'PostToolUse', tool_response: { answers: updatedInput.answers } });
  assert.equal(receipt.status, 0, receipt.stderr);
  assert.equal(receipt.stdout, '');
  const events = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map((event) => event.event), ['fired', 'return', 'fired']);
  assert.deepEqual(events[2].toolResponse, { answers: { 'Which shape?': 'Square', 'And another?': 'Square' } });
  assert.equal(events[2].toolUseId, 'toolu_test');
  assert.equal(events[2].hook, 'PostToolUse');
});

test('malformed paid-probe argv refuses before external tools or output creation', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'answer-probe-argv-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'), marker = join(dir, 'called'), out = join(dir, 'out'), scratch = join(dir, 'scratch');
  mkdirSync(bin); mkdirSync(scratch);
  for (const tool of ['tmux', 'claude', 'ps']) writeFileSync(join(bin, tool), '#!/bin/sh\n: > "$PROBE_MARKER"\nexit 1\n', { mode: 0o700 });
  for (const args of [
    ['--only'], ['--only', ''], ['--out'], ['--out', ''], ['--only', '--out', out], ['--out', '-x'],
    ['--only', 'deny', '--only', 'release'], ['--out', out, '--out', out], ['--unknown', 'x'],
    ['--only', 'unknown-scenario'], ['--only=deny'], ['deny'], ['--out', out, '--unknown', 'x'], ['--only', '   '],
  ]) {
    rmSync(marker, { force: true }); rmSync(out, { recursive: true, force: true });
    const result = spawnSync(process.execPath, ['tools/answer-probe/run.mjs', ...args], {
      encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: bin, TMPDIR: scratch, PROBE_MARKER: marker },
    });
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(existsSync(marker), false, `external tool invoked for ${JSON.stringify(args)}`);
    assert.equal(existsSync(out), false, JSON.stringify(args));
    assert.deepEqual(readdirSync(scratch), [], JSON.stringify(args));
    assert.match(result.stderr, /invalid|requires|repeated|unknown scenario/);
  }
  // Stop valid invocations at the external preflight, before any Claude session.
  writeFileSync(join(bin, 'tmux'), '#!/bin/sh\n: > "$PROBE_MARKER"\nexit 0\n', { mode: 0o700 });
  for (const args of [[], ['--out', out], ...['hook-answer', 'deny', 'release', 'under-denial'].map((name) => ['--only', name, '--out', out])]) {
    rmSync(marker, { force: true });
    const result = spawnSync(process.execPath, ['tools/answer-probe/run.mjs', ...args], {
      encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: bin, TMPDIR: scratch, PROBE_MARKER: marker },
    });
    assert.equal(result.status, 1);
    assert.equal(existsSync(marker), true, JSON.stringify(args));
    assert.match(result.stderr, /tmux server already exists/);
  }
});
