import test from 'node:test';
import assert from 'node:assert/strict';
import { planHooks, shellQuote, timeoutSeconds } from '../src/install/hooks.js';

const relay = '/opt/relay/bin/relay';
const base = '{\n  // keep this comment\n  "hooks": {\n    "SessionStart": [{"hooks":[{"type":"command","command":"~/d/familiar/bin/familiar hook --agent codex SessionStart"}]}],\n    "PreToolUse": [{"matcher":"*","hooks":[{"type":"command","command":"\'/old relay/bin/relay\' hook --harness codex --outer-ms 30000 PreToolUse"}]}]\n  },\n  "statusLine": {"type":"command","command":"ops"}\n}';

test('planner replaces stale relay hooks, retires both familiar shapes, and preserves JSONC', () => {
  assert.throws(() => planHooks({ text: base, harness: 'codex', relayBin: relay }), /familiar/);
  const text = planHooks({ text: base, harness: 'codex', relayBin: relay, retireFamiliar: true });
  assert.match(text, /keep this comment/); assert.match(text, /"statusLine": \{"type":"command","command":"ops"\}/);
  assert.match(text, new RegExp(shellQuote(relay).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text, /--outer-ms 600000 PreToolUse/);
  assert.equal(text.includes('familiar hook'), false);
});

test('planner rejects duplicate relay writers and recognizes quoted trailing familiar agent', () => {
  const text = '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"\'/x/familiar\' hook SessionStart --agent codex"}]},{"hooks":[{"type":"command","command":"\'/a/relay\' hook --harness codex SessionStart"}]},{"hooks":[{"type":"command","command":"\'/b/relay\' hook --harness codex --outer-ms 1000 SessionStart"}]}]}}';
  assert.throws(() => planHooks({ text, harness: 'codex', relayBin: relay, retireFamiliar: true }), /duplicate relay/);
});

test('Claude retains both Notification matchers', () => {
  const text = planHooks({ text: '{"hooks":{}}', harness: 'claude-code', relayBin: relay });
  const notifications = JSON.parse(text).hooks.Notification;
  assert.deepEqual(notifications.map(entry => entry.matcher), ['idle_prompt', 'permission_prompt']);
});

test('every installed relay entry carries the explicit outer timeout in whole seconds', () => {
  for (const harness of ['claude-code', 'codex']) {
    const hooks = JSON.parse(planHooks({ text: '{"hooks":{}}', harness, relayBin: relay })).hooks;
    for (const [key, entries] of Object.entries(hooks)) for (const entry of entries) {
      const [hook] = entry.hooks;
      const outerMs = Number(hook.command.match(/--outer-ms (\d+) /)[1]);
      assert.equal(hook.timeout, outerMs / 1000, `${harness} ${key}`);
      assert.deepEqual(Object.keys(hook), ['type', 'command', 'timeout']);
    }
    assert.equal(hooks.SessionEnd[0].hooks[0].timeout, harness === 'codex' ? 3 : 60);
    assert.equal(hooks.PreToolUse[0].hooks[0].timeout, 600);
  }
});

test('planner replaces a relay entry whose timeout drifted from its command', () => {
  const text = '{"hooks":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"\'/x/relay\' hook --harness codex --outer-ms 600000 PreToolUse","timeout":30}]}]}}';
  const [entry] = JSON.parse(planHooks({ text, harness: 'codex', relayBin: relay })).hooks.PreToolUse;
  assert.equal(entry.hooks[0].timeout, 600);
  assert.match(entry.hooks[0].command, /--outer-ms 600000 PreToolUse$/);
});

test('an installed timeout is the outer budget in positive whole seconds', () => {
  assert.equal(timeoutSeconds(3000), 3);
  for (const bad of [2500, 0, -1000, 1000.5, '1000']) assert.throws(() => timeoutSeconds(bad), /whole seconds/);
});
