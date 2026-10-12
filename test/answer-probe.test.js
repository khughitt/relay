import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
