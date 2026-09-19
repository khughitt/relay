import test from 'node:test';
import assert from 'node:assert/strict';
import { planHooks, shellQuote, timeoutSeconds } from '../src/install/hooks.js';

const relay = '/opt/relay/bin/relay';
const subscribers = '/home/me/.config/relay/subscribers.json';
const base = '{\n  // keep this comment\n  "hooks": {\n    "SessionStart": [{"hooks":[{"type":"command","command":"~/d/familiar/bin/familiar hook --agent codex SessionStart"}]}],\n    "PreToolUse": [{"matcher":"*","hooks":[{"type":"command","command":"\'/old relay/bin/relay\' hook --harness codex --outer-ms 30000 PreToolUse"}]}]\n  },\n  "statusLine": {"type":"command","command":"ops"}\n}';

test('planner replaces stale relay hooks, retires both familiar shapes, and preserves JSONC', () => {
  assert.throws(() => planHooks({ text: base, harness: 'codex', relayBin: relay, subscribersPath: subscribers }), /familiar/);
  const text = planHooks({ text: base, harness: 'codex', relayBin: relay, subscribersPath: subscribers, retireFamiliar: true });
  assert.match(text, /keep this comment/); assert.match(text, /"statusLine": \{"type":"command","command":"ops"\}/);
  assert.match(text, new RegExp(shellQuote(relay).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text, /--outer-ms 600000 --subscribers '\/home\/me\/\.config\/relay\/subscribers\.json' PreToolUse/);
  assert.equal(text.includes('familiar hook'), false);
});

test('planner rejects duplicate relay writers and recognizes quoted trailing familiar agent', () => {
  const text = '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"\'/x/familiar\' hook SessionStart --agent codex"}]},{"hooks":[{"type":"command","command":"\'/a/relay\' hook --harness codex SessionStart"}]},{"hooks":[{"type":"command","command":"\'/b/relay\' hook --harness codex --outer-ms 1000 SessionStart"}]}]}}';
  assert.throws(() => planHooks({ text, harness: 'codex', relayBin: relay, subscribersPath: subscribers, retireFamiliar: true }), /duplicate relay/);
});

test('Claude retains both Notification matchers', () => {
  const text = planHooks({ text: '{"hooks":{}}', harness: 'claude-code', relayBin: relay, subscribersPath: subscribers });
  const notifications = JSON.parse(text).hooks.Notification;
  assert.deepEqual(notifications.map(entry => entry.matcher), ['idle_prompt', 'permission_prompt']);
});

test('every installed relay entry carries the explicit outer timeout in whole seconds', () => {
  for (const harness of ['claude-code', 'codex']) {
    const hooks = JSON.parse(planHooks({ text: '{"hooks":{}}', harness, relayBin: relay, subscribersPath: subscribers })).hooks;
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
  const [entry] = JSON.parse(planHooks({ text, harness: 'codex', relayBin: relay, subscribersPath: subscribers })).hooks.PreToolUse;
  assert.equal(entry.hooks[0].timeout, 600);
  assert.match(entry.hooks[0].command, /--outer-ms 600000 --subscribers '[^']*' PreToolUse$/);
});

test('an installed timeout is the outer budget in positive whole seconds', () => {
  assert.equal(timeoutSeconds(3000), 3);
  for (const bad of [2500, 0, -1000, 1000.5, '1000']) assert.throws(() => timeoutSeconds(bad), /whole seconds/);
});

test('every relay entry names the subscriber file after the outer budget', () => {
  for (const harness of ['claude-code', 'codex']) {
    const hooks = JSON.parse(planHooks({ text: '{"hooks":{}}', harness, relayBin: relay, subscribersPath: subscribers })).hooks;
    for (const entries of Object.values(hooks)) for (const entry of entries) {
      assert.match(entry.hooks[0].command, new RegExp(`^'/opt/relay/bin/relay' hook --harness ${harness} --outer-ms \\d+ --subscribers '/home/me/\\.config/relay/subscribers\\.json' \\S+$`));
    }
  }
  assert.throws(() => planHooks({ text: '{"hooks":{}}', harness: 'codex', relayBin: relay, subscribersPath: 'relative.json' }), /absolute/);
  assert.throws(() => planHooks({ text: '{"hooks":{}}', harness: 'codex', relayBin: relay }), /absolute/);
});

test('relay entries from before the flag, and with it, are owned and replaced', () => {
  const text = '{"hooks":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"/x/relay hook --harness codex PreToolUse"}]}],"Stop":[{"hooks":[{"type":"command","command":"\'/x/relay\' hook --harness codex --outer-ms 600000 --subscribers \'/old/subscribers.json\' Stop","timeout":600}]}]}}';
  const hooks = JSON.parse(planHooks({ text, harness: 'codex', relayBin: relay, subscribersPath: subscribers })).hooks;
  assert.equal(hooks.PreToolUse.length, 1); assert.match(hooks.PreToolUse[0].hooks[0].command, /--subscribers '\/home\/me\/\.config\/relay\/subscribers\.json' PreToolUse$/);
  assert.equal(hooks.Stop.length, 1); assert.match(hooks.Stop[0].hooks[0].command, /--subscribers '\/home\/me\/\.config\/relay\/subscribers\.json' Stop$/);
});

test('a second install recognizes its own entries when the paths contain apostrophes', () => {
  const quirky = "/tmp/team's config/subscribers.json", bin = "/opt/o'relay/bin/relay";
  const once = planHooks({ text: '{"hooks":{}}', harness: 'codex', relayBin: bin, subscribersPath: quirky });
  assert.match(JSON.parse(once).hooks.PreToolUse[0].hooks[0].command, /--subscribers '\/tmp\/team'\\''s config\/subscribers\.json' PreToolUse/);
  const twice = planHooks({ text: once, harness: 'codex', relayBin: bin, subscribersPath: quirky });
  assert.equal(twice, once);
  for (const entries of Object.values(JSON.parse(twice).hooks)) assert.equal(entries.length, 1);
  const moved = JSON.parse(planHooks({ text: once, harness: 'codex', relayBin: relay, subscribersPath: subscribers })).hooks;
  assert.equal(moved.PreToolUse.length, 1); assert.match(moved.PreToolUse[0].hooks[0].command, /^'\/opt\/relay\/bin\/relay' hook/);
});
