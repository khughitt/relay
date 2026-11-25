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

test('probe driver moves down past No, exit to trust the workspace and preserves pane output on early exit', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'answer-probe-trust-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [label, promptLines, expectedKeys] of [
    ['cursor-on-no', [' ❯ No, exit', '   Yes, I trust this folder'], ['Down', 'Enter']],
    ['cursor-on-yes', ['   No, exit', ' ❯ Yes, I trust this folder'], ['Enter']],
  ]) {
    const sub = join(dir, label), bin = join(sub, 'bin'), home = join(sub, 'home'), scratch = join(sub, 'scratch'), out = join(sub, 'out');
    const calls = join(sub, 'tmux-calls.log'), state = join(sub, 'state');
    mkdirSync(bin, { recursive: true }); mkdirSync(home, { mode: 0o700 }); mkdirSync(scratch, { mode: 0o700 });
    writeFileSync(state, 'alive\n');
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\nprintf "%s\\n" "2.1.332 (Claude Code)"\n', { mode: 0o700 });
    writeFileSync(join(bin, 'ps'), '#!/bin/sh\nprintf "1 0\\n"\n', { mode: 0o700 });
    const paneBody = ` Accessing workspace:\\n\\n${promptLines.join('\\n')}\\n`;
    writeFileSync(join(bin, 'tmux'), `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
case "$*" in *remain-on-exit*) : > "${sub}/remain" ;; esac
shift 2 # -L relay-probe
case "$1" in
  list-sessions) exit 1 ;;
  new-session|list-panes|kill-session|kill-server|set-option) exit 0 ;;
  capture-pane)
    if [ "$(cat "${state}")" = "dead" ] && [ ! -f "${sub}/remain" ]; then
      printf 'no server running on /tmp/tmux-relay-probe\\n' >&2
      exit 1
    fi
    printf '${paneBody}'
    exit 0 ;;
  send-keys)
    case "$*" in *Enter) printf 'dead\\n' > "${state}" ;; esac
    exit 0 ;;
  display-message)
    if [ "$(cat "${state}")" = "dead" ]; then printf '1\\n'; else printf '0\\n'; fi
    exit 0 ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });
    const result = spawnSync(process.execPath, ['tools/answer-probe/run.mjs', '--only', 'deny', '--out', out], {
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, TMPDIR: scratch },
    });
    assert.equal(result.status, 1, label);
    assert.match(result.stderr, /deny: hook never fired/, `${label}: ${result.stderr}`);
    const logged = readFileSync(calls, 'utf8').trim().split('\n');
    assert.ok(logged.some((line) => line.includes('new-session') && line.includes('remain-on-exit')), `${label}: ${logged.join('\n')}`);
    const prefix = '-L relay-probe send-keys -t deny ';
    const keys = logged.filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));
    assert.deepEqual(keys, expectedKeys, label);
    assert.match(readFileSync(join(out, 'deny', 'pane.txt'), 'utf8'), /Yes, I trust this folder/, label);
  }
});
