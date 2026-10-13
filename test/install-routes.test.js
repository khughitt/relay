import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateSubscribers } from '../src/subscribers.js';
import { parseEvidence } from '../src/install/capabilities.js';
import { routeBindings, planRouteHooks } from '../src/install/hooks.js';
import { planClaudeCode } from '../src/install/claude-code.js';

const record = (routes) => JSON.stringify({ schema: 1, harness: 'claude-code', version: '2.1.296', probes: [], ...(routes ? { routes } : {}) });
const row = (name, passed = true) => ({ name, passed, note: 'probe' });
const all = ['answer-hook-terminal', 'answer-hook-deny-stops', 'answer-release-native', 'answer-receipt-observed', 'answer-hook-under-denial'].map((n) => row(n));

test('evidence routes are optional, named from the closed set, and unique', () => {
  assert.deepEqual(parseEvidence(record()).routes ?? [], []);
  assert.equal(parseEvidence(record(all)).routes.length, 5);
  for (const bad of [null, {}, [null], [row('made-up')], [row('answer-hook-terminal'), row('answer-hook-terminal')], [{ name: 'answer-hook-terminal', passed: 'yes', note: '' }], [{ ...row('answer-hook-terminal'), note: 1 }], [{ ...row('answer-hook-terminal'), extra: 1 }]]) {
    const text = JSON.stringify({ schema: 1, harness: 'claude-code', version: '2.1.296', probes: [], routes: bad });
    assert.throws(() => parseEvidence(text), { code: 'INVALID_EVIDENCE' }, JSON.stringify(bad));
  }
});
test('route evidence must be for the installed version', () => {
  const ev = parseEvidence(record(all));
  assert.throws(() => routeBindings('claude-code', ev, '2.1.300'), { code: 'UNSUPPORTED_BINDING', message: /2\.1\.296.*2\.1\.300/ });
  assert.throws(() => routeBindings('claude-code', ev, undefined), { code: 'UNSUPPORTED_BINDING' });
  const wrongHarness = parseEvidence(JSON.stringify({ ...ev, harness: 'codex' }));
  assert.throws(() => routeBindings('claude-code', wrongHarness, '2.1.296'), { code: 'UNSUPPORTED_BINDING' });
  assert.equal(routeBindings('claude-code', ev, '2.1.296').length, 2);
});
test('route bindings follow the evidence', () => {
  const ev = (rows) => parseEvidence(record(rows));
  const bind = (h, e) => routeBindings(h, e, '2.1.296');
  assert.deepEqual(bind('claude-code', ev(all)), [
    { event: 'PreToolUse', matcher: 'AskUserQuestion', outerMs: 86400000, handback: true },
    { event: 'PostToolUse', matcher: 'AskUserQuestion', outerMs: 10000 }]);
  const noRelease = all.map((r) => r.name === 'answer-release-native' ? { ...r, passed: false } : r);
  assert.equal(bind('claude-code', ev(noRelease))[0].handback, false);
  const noReceipt = all.filter((r) => r.name !== 'answer-receipt-observed');
  assert.equal(bind('claude-code', ev(noReceipt)).length, 1);
  for (const missing of ['answer-hook-terminal', 'answer-hook-deny-stops']) {
    assert.throws(() => bind('claude-code', ev(all.filter((r) => r.name !== missing))), { code: 'UNSUPPORTED_BINDING', message: new RegExp(missing) });
    assert.throws(() => bind('claude-code', ev(all.map((r) => r.name === missing ? { ...r, passed: false } : r))), { code: 'UNSUPPORTED_BINDING' });
  }
  assert.equal(bind('claude-code', ev(all.filter((r) => r.name !== 'answer-release-native')))[0].handback, false);
  assert.equal(bind('claude-code', ev(all.map((r) => r.name === 'answer-receipt-observed' ? { ...r, passed: false } : r))).length, 1);
  assert.deepEqual(bind('claude-code', ev(all.filter((r) => r.name !== 'answer-hook-under-denial'))), bind('claude-code', ev(all)));
  assert.throws(() => bind('claude-code', null), { code: 'UNSUPPORTED_BINDING' });
  assert.throws(() => bind('codex', ev(all)), { code: 'UNSUPPORTED_BINDING' });
});
test('replanning without P2 removes the confirmation hook it installed before', () => {
  const args = { harness: 'claude-code', relayBin: '/r/bin/relay.js', nodeBin: '/n/node' };
  const full = routeBindings('claude-code', parseEvidence(record(all)), '2.1.296');
  const once = planRouteHooks({ ...args, text: '{"hooks":{}}', rows: full });
  assert.equal(JSON.parse(once).hooks.PostToolUse.length, 1);
  const theirs = { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: '/x/their-post', timeout: 5 }] };
  const mixed = JSON.stringify({ hooks: { ...JSON.parse(once).hooks, PostToolUse: [...JSON.parse(once).hooks.PostToolUse, theirs] } });
  const again = planRouteHooks({ ...args, text: mixed, rows: full.filter((r) => r.event === 'PreToolUse') });
  assert.deepEqual(JSON.parse(again).hooks.PostToolUse, [theirs]);
  assert.equal(JSON.parse(again).hooks.PreToolUse.length, 1);
  assert.equal(planRouteHooks({ ...args, text: '{"hooks":{}}', rows: [] }), '{"hooks":{}}'); // nothing owned, nothing requested: untouched
  const cleared = JSON.parse(planRouteHooks({ ...args, text: mixed, rows: [] }));
  assert.deepEqual(cleared.hooks.PreToolUse, []);
  assert.deepEqual(cleared.hooks.PostToolUse, [theirs]);
});
test('planRouteHooks writes and replaces only relay ask entries, idempotently', () => {
  const rows = routeBindings('claude-code', parseEvidence(record(all)), '2.1.296');
  const theirs = { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: '/x/other-hook', timeout: 5 }] };
  const text = JSON.stringify({ hooks: { PreToolUse: [theirs] } });
  const once = planRouteHooks({ text, harness: 'claude-code', relayBin: '/r/bin/relay.js', nodeBin: '/n/node', rows });
  const parsed = JSON.parse(once);
  assert.deepEqual(parsed.hooks.PreToolUse[0], theirs);
  assert.deepEqual(parsed.hooks.PreToolUse[1], { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: "'/n/node' '/r/bin/relay.js' ask --harness claude-code --handback PreToolUse", timeout: 86400 }] });
  assert.deepEqual(parsed.hooks.PostToolUse[0].hooks[0], { type: 'command', command: "'/n/node' '/r/bin/relay.js' ask --harness claude-code PostToolUse", timeout: 10 });
  assert.equal(planRouteHooks({ text: once, harness: 'claude-code', relayBin: '/r/bin/relay.js', nodeBin: '/n/node', rows }), once);
  const without = planRouteHooks({ text: once, harness: 'claude-code', relayBin: '/r/bin/relay.js', nodeBin: '/n/node', rows: [{ ...rows[0], handback: false }] });
  assert.equal(JSON.parse(without).hooks.PreToolUse[1].hooks[0].command, "'/n/node' '/r/bin/relay.js' ask --harness claude-code PreToolUse");
});
test('planClaudeCode adds the route only with withAsk', () => {
  const base = { target: '/t/settings.json', text: '{}', relayBin: '/r/bin/relay.js', nodeBin: '/n/node', subscribersPath: '/c/subscribers.json',
    subscribers: validateSubscribers({ schema: 1, subscribers: [] }), evidence: parseEvidence(record(all)) };
  assert.doesNotMatch(planClaudeCode(base).changes[0].after, / ask --harness/);
  assert.match(planClaudeCode({ ...base, withAsk: true, installedVersion: '2.1.296' }).changes[0].after, / ask --harness claude-code --handback PreToolUse/);
  assert.throws(() => planClaudeCode({ ...base, withAsk: true, installedVersion: '2.2.0' }), { code: 'UNSUPPORTED_BINDING' });
  assert.throws(() => planClaudeCode({ ...base, withAsk: true }), { code: 'UNSUPPORTED_BINDING' });
  const installed = planClaudeCode({ ...base, withAsk: true, installedVersion: '2.1.296' }).changes[0].after;
  assert.deepEqual(planClaudeCode({ ...base, text: installed, withAsk: true, installedVersion: '2.1.296' }).changes, []);
  const noReceipt = parseEvidence(record(all.filter((r) => r.name !== 'answer-receipt-observed')));
  const downgraded = planClaudeCode({ ...base, text: installed, evidence: noReceipt, withAsk: true, installedVersion: '2.1.296' }).changes[0].after;
  assert.deepEqual(JSON.parse(downgraded).hooks.PostToolUse, []);
  // Without --with ask an install declares no route, so the route it installed before goes
  // and the dispatch hooks are exactly a plain install's.
  const removed = JSON.parse(planClaudeCode({ ...base, text: installed, evidence: null }).changes[0].after).hooks;
  assert.deepEqual(removed.PreToolUse, JSON.parse(planClaudeCode(base).changes[0].after).hooks.PreToolUse);
  assert.deepEqual(removed.PostToolUse, []);
});

test('after a harness upgrade the stale route refuses with --with ask and goes without it', () => {
  const base = { target: '/t/settings.json', text: '{}', relayBin: '/r/bin/relay.js', nodeBin: '/n/node', subscribersPath: '/c/subscribers.json',
    subscribers: validateSubscribers({ schema: 1, subscribers: [] }), evidence: parseEvidence(record(all)) };
  const installed = planClaudeCode({ ...base, withAsk: true, installedVersion: '2.1.296' }).changes[0].after;
  assert.throws(() => planClaudeCode({ ...base, text: installed, withAsk: true, installedVersion: '2.1.300' }), { code: 'UNSUPPORTED_BINDING', message: /2\.1\.296.*2\.1\.300/ });
  const plain = planClaudeCode({ ...base, text: installed, installedVersion: '2.1.300' }).changes[0].after;
  assert.doesNotMatch(plain, / ask --harness/);
  assert.deepEqual(JSON.parse(plain).hooks.PreToolUse, JSON.parse(planClaudeCode(base).changes[0].after).hooks.PreToolUse);
});

test('a guard subscriber needs one evidence record holding both the dispatch probes and the route rows', async () => {
  const guard = { name: 'g', role: 'guard', kinds: ['before-tool'], harnesses: ['claude-code'], argv: ['/usr/bin/true'], timeoutMs: 1000 };
  const probes = ['refuse', 'context'].map((reply) => ({ event: 'PreToolUse', reply, outerMs: 600000, passed: true }));
  const base = { target: '/t/settings.json', text: '{}', relayBin: '/r/bin/relay.js', nodeBin: '/n/node', subscribersPath: '/c/subscribers.json',
    subscribers: validateSubscribers({ schema: 1, subscribers: [guard] }), withAsk: true, installedVersion: '2.1.296' };
  const routesOnly = parseEvidence(await readFile(new URL('../docs/evidence/claude-code-answer-routes.json', import.meta.url), 'utf8'));
  assert.throws(() => planClaudeCode({ ...base, evidence: routesOnly }),
    { code: 'UNSUPPORTED_BINDING', message: /claude-code,PreToolUse,refuse.*dispatch probes.*inbox-service/s });
  const combined = parseEvidence(JSON.stringify({ ...routesOnly, probes }));
  const after = JSON.parse(planClaudeCode({ ...base, evidence: combined }).changes[0].after).hooks;
  assert.ok(after.PreToolUse.some((r) => / hook --harness claude-code .* PreToolUse$/.test(r.hooks[0].command)));
  assert.ok(after.PreToolUse.some((r) => / ask --harness claude-code --handback PreToolUse$/.test(r.hooks[0].command)));
});

test('the committed Claude route evidence enables both bindings at its probed version', async () => {
  const evidence = parseEvidence(await readFile(new URL('../docs/evidence/claude-code-answer-routes.json', import.meta.url), 'utf8'));
  assert.equal(evidence.version, '2.1.296');
  assert.equal(evidence.routes.length, 5);
  assert.ok(evidence.routes.every((r) => r.passed));
  assert.deepEqual(routeBindings('claude-code', evidence, '2.1.296'), [
    { event: 'PreToolUse', matcher: 'AskUserQuestion', outerMs: 86400000, handback: true },
    { event: 'PostToolUse', matcher: 'AskUserQuestion', outerMs: 10000 }]);
});

test('route planning rejects malformed hooks before changing them', () => {
  const args = { harness: 'claude-code', relayBin: '/r/bin/relay.js', nodeBin: '/n/node', rows: [] };
  for (const text of ['{', 'null', '[]', '{"hooks":[]}', '{"hooks":null}']) {
    assert.throws(() => planRouteHooks({ ...args, text }), /malformed hooks JSONC/);
  }
  assert.throws(() => planRouteHooks({ ...args, text: '{"hooks":{"PostToolUse":{}}}' }), /hooks.PostToolUse must be an array/);
  for (const override of [{ nodeBin: 'node' }, { relayBin: 'relay.js' }]) {
    assert.throws(() => planRouteHooks({ ...args, ...override, text: '{}' }), /absolute/);
  }
});

test('duplicate owned route writers fail early rather than being silently repaired', () => {
  const args = { harness: 'claude-code', relayBin: '/r/bin/relay.js', nodeBin: '/n/node' };
  const rows = routeBindings('claude-code', parseEvidence(record(all)), '2.1.296');
  const hooks = JSON.parse(planRouteHooks({ ...args, text: '{}', rows })).hooks;
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const text = JSON.stringify({ hooks: { ...hooks, [event]: [...hooks[event], ...hooks[event]] } });
    for (const requested of [rows, []]) assert.throws(() => planRouteHooks({ ...args, text, rows: requested }), /duplicate relay ask writer/);
  }
});

test('route planning retains JSONC and other harness bindings when paths move', () => {
  const rows = routeBindings('claude-code', parseEvidence(record(all)), '2.1.296');
  const theirs = { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: "'/x/relay' ask --harness codex PreToolUse", timeout: 5 }] };
  const args = { harness: 'claude-code', relayBin: "/r/o'relay.js", nodeBin: "/n/o'node", rows };
  const once = planRouteHooks({ ...args, text: `{\n// keep comment\n"hooks":{"PreToolUse":[${JSON.stringify(theirs)}]},"other":true,\n}` });
  assert.match(once, /keep comment/);
  assert.equal(planRouteHooks({ ...args, text: once }), once);
  const moved = planRouteHooks({ ...args, text: once, relayBin: '/r/new-relay.js' });
  const cleared = planRouteHooks({ ...args, text: moved, rows: [] });
  assert.match(cleared, /keep comment/);
  assert.match(cleared, /"other":\s*true/);
  assert.match(cleared, /ask --harness codex PreToolUse/);
  assert.doesNotMatch(cleared, /ask --harness claude-code/);
});
