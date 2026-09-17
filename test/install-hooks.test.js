import test from 'node:test';
import assert from 'node:assert/strict';
import { planHooks, shellQuote } from '../src/install/hooks.js';

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
