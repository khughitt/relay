import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSubscribers } from '../src/subscribers.js';
import { bindingsFor, planHooks, selectBindings } from '../src/install/hooks.js';
import { parseQualification, qualificationRows, qualifyBinding, qualifyInstall } from '../src/install/qualification.js';
import { planClaudeCode } from '../src/install/claude-code.js';
import { planCodex } from '../src/install/codex.js';
import { pairDigests, relayPairs } from '../src/install/pair.js';
import { COMMIT, DIGEST, passedChecks, qualificationFor, registryRoutes } from './helpers/qualification.js';
import { relayCopy } from './helpers/relay-copy.js';

const subscribers = (...entries) => validateSubscribers({ schema: 2, subscribers: entries });
const subscriber = (over) => ({ name: 'g', role: 'guard', kinds: null, harnesses: ['claude-code', 'codex'], tools: null, nativeEvents: null, argv: ['ops-guard'], timeoutMs: 1000, ...over });
const target = (over = {}) => ({ harness: 'claude-code', version: '2.1.322', mode: 'interactive', platform: process.platform, relayCommit: COMMIT, configDigest: DIGEST, ...over });
const doc = (routes, over = {}) => qualificationFor({ harness: 'claude-code', version: '2.1.322', routes, ...over });
const rowOf = (routes, over) => qualificationRows(parseQualification(JSON.stringify(doc(routes, over))))[0];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('a HookQualification document is strict: statuses, evidence, owners and not-applicable rules', () => {
  const stop = { event: 'Stop', role: 'guard', outerMs: 600000 };
  assert.equal(parseQualification(JSON.stringify(doc([stop]))).rows.length, 1);
  const bad = (mutate) => { const value = doc([stop]); mutate(value, value.rows[0]); return JSON.stringify(value); };
  for (const [name, text] of [
    ['not JSON', '{'],
    ['schema', bad((d) => { d.schema = 2; })],
    ['unknown field', bad((d) => { d.extra = true; })],
    ['short commit', bad((d) => { d.relayCommit = 'abc1234'; })],
    ['digest', bad((d) => { d.configDigest = 'x'; })],
    ['empty mode', bad((d) => { d.sessionMode = ''; })],
    ['unknown event', bad((_, r) => { r.event = 'Nope'; })],
    ['role', bad((_, r) => { r.role = 'writer'; })],
    ['outerMs', bad((_, r) => { r.outerMs = 1500; })],
    ['missing check', bad((_, r) => { delete r.cleanup; })],
    ['status', bad((_, r) => { r.decode.status = 'ok'; })],
    ['passed without evidence', bad((_, r) => { r.decode.evidence = []; })],
    ['unknown without owner', bad((_, r) => { r.liveDelivery = { status: 'unknown', evidence: ['not probed'] }; })],
    ['unknown without reason', bad((_, r) => { r.liveDelivery = { status: 'unknown', evidence: [], owner: 'relay-123abc' }; })],
    ['owner shape', bad((_, r) => { r.liveDelivery = { status: 'unknown', evidence: ['not probed'], owner: 'someone' }; })],
    ['retry not-applicable on a Stop guard', bad((_, r) => { r.retryFlag = { status: 'not-applicable', evidence: [] }; })],
    ['policy not-applicable on a guard', bad((_, r) => { r.policyEquivalence = { status: 'not-applicable', evidence: [] }; })],
    ['context limit', bad((_, r) => { r.contextLimit = 0; })],
    ['duplicate row', bad((d) => { d.rows.push(d.rows[0]); })],
  ]) assert.throws(() => parseQualification(text), { code: 'INVALID_QUALIFICATION' }, name);
  const owned = doc([stop]); owned.rows[0].liveDelivery = { status: 'unknown', evidence: ['fresh-session probe not yet run'], owner: 'relay-123abc' };
  assert.equal(parseQualification(JSON.stringify(owned)).rows[0].liveDelivery.owner, 'relay-123abc');
  const session = { event: 'SessionStart', role: 'registry', outerMs: 600000 };
  assert.equal(parseQualification(JSON.stringify(doc([session]))).rows[0].retryFlag.status, 'not-applicable', 'retry is exempt off Stop');
});

test('qualifyBinding refuses a Stop guard without exact-event retry proof and any identity mismatch', () => {
  const stop = { event: 'Stop', role: 'guard', outerMs: 600000 };
  assert.deepEqual(qualifyBinding(rowOf([stop]), target()), { event: 'Stop', role: 'guard', outerMs: 600000, contextLimit: null });
  const value = doc([stop]); value.rows[0].retryFlag = { status: 'unknown', evidence: ['retry after refusal not probed'], owner: 'relay-123abc' };
  const stopWithoutRetry = qualificationRows(parseQualification(JSON.stringify(value)))[0];
  assert.throws(() => qualifyBinding(stopWithoutRetry, target()), { code: 'UNQUALIFIED_ROUTE', message: /Stop.*retryFlag is unknown.*relay-123abc/ });
  const subagent = { event: 'SubagentStop', role: 'guard', outerMs: 600000 };
  const codexRow = qualificationRows(parseQualification(JSON.stringify(qualificationFor({ harness: 'codex', version: '0.167.2', routes: [subagent] }))))[0];
  assert.equal(codexRow.retryFlag.status, 'passed', 'SubagentStop needs its own retry proof, not Stop\'s');
  for (const [field, over] of [['version', { version: '2.1.323' }], ['sessionMode', { mode: 'headless' }], ['platform', { platform: 'darwin-other' }],
    ['relayCommit', { relayCommit: 'c'.repeat(40) }], ['configDigest', { configDigest: 'd'.repeat(64) }], ['harness', { harness: 'codex' }]]) {
    assert.throws(() => qualifyBinding(rowOf([stop]), target(over)), { code: 'UNQUALIFIED_ROUTE', message: new RegExp(field) }, field);
  }
  const oneHost = doc([stop]); oneHost.rows[0].latency.evidence = ['host=host-a p95 within bound'];
  assert.throws(() => qualifyBinding(qualificationRows(parseQualification(JSON.stringify(oneHost)))[0], target()), { code: 'UNQUALIFIED_ROUTE', message: /latency.*two hosts/ });
});

test('a notice needs context proof at relay\'s own context limit', () => {
  const notice = { event: 'SessionStart', role: 'notice', outerMs: 600000 };
  assert.throws(() => qualifyBinding(rowOf([notice]), target()), { code: 'UNQUALIFIED_ROUTE', message: /contextLimit/ });
  assert.throws(() => qualifyBinding(rowOf([{ ...notice, contextLimit: 4000 }]), target()), { code: 'UNQUALIFIED_ROUTE', message: /4000.*10000/ });
  assert.equal(qualifyBinding(rowOf([{ ...notice, contextLimit: 10000 }]), target()).contextLimit, 10000);
  const observer = { event: 'SessionStart', role: 'observer', outerMs: 600000 };
  assert.equal(qualifyBinding(rowOf([observer]), target()).contextLimit, null, 'an observer has no context channel');
});

test('selected events install alone: SessionStart qualifies while Stop and SubagentStop stay unqualified', () => {
  const config = subscribers(subscriber({ kinds: ['turn-end', 'child-stop'], harnesses: ['codex'] }), subscriber({ name: 'n', role: 'notice', kinds: ['session-start'], argv: ['notice'] }));
  const selected = selectBindings('codex', ['SessionStart']);
  const qualification = parseQualification(JSON.stringify(qualificationFor({ harness: 'codex', version: '0.167.2',
    routes: [{ event: 'SessionStart', role: 'notice', outerMs: 600000, contextLimit: 10000 }] })));
  const codexTarget = target({ harness: 'codex', version: '0.167.2' });
  const selectedPlan = qualifyInstall({ harness: 'codex', subscribers: config, bindings: selected, qualification, target: codexTarget });
  assert.equal(selectedPlan.events.join(','), 'SessionStart');
  assert.throws(() => qualifyInstall({ harness: 'codex', subscribers: config, bindings: bindingsFor('codex'), qualification, target: codexTarget }),
    { code: 'UNQUALIFIED_ROUTE', message: /no qualification row \(codex,SubagentStart,registry,600000\)/ });
  assert.throws(() => qualifyInstall({ harness: 'codex', subscribers: config, bindings: selected, qualification: null, target: codexTarget }),
    { code: 'UNQUALIFIED_ROUTE', message: /--qualification/ });
  assert.throws(() => selectBindings('codex', ['Nope']), { code: 'INVALID_CONFIG', message: /Nope/ });
  assert.throws(() => selectBindings('codex', ['Stop', 'Stop']), { code: 'INVALID_CONFIG', message: /once/ });
});

const PRIOR = { node: '/prior/node', relay: '/prior/relay/bin/relay.js', subscribers: '/prior/config/subscribers.json' };
const NEXT = { node: '/next/node', relay: '/next/relay/bin/relay.js', subscribers: '/next/config/subscribers.json' };
function claudeSettings() {
  const prior = JSON.parse(planHooks({ text: '{"hooks":{}}', harness: 'claude-code', relayBin: PRIOR.relay, nodeBin: PRIOR.node, subscribersPath: PRIOR.subscribers }));
  prior.hooks.PreToolUse.push({ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: '/opt/native/ask-hook' }] },
    { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: `'${PRIOR.node}' '${PRIOR.relay}' ask --harness claude-code --handback PreToolUse`, timeout: 86400 }] },
    { matcher: '*', hooks: [{ type: 'command', command: '/usr/local/bin/ops-guard' }] });
  return `${JSON.stringify(prior, null, 2)}\n`;
}

test('a selected-event plan changes only that event and byte-preserves ask, native and unselected relay lines', () => {
  const text = claudeSettings(), config = subscribers(subscriber({ kinds: ['before-tool'] }));
  const qualification = parseQualification(JSON.stringify(doc(registryRoutes(selectBindings('claude-code', ['SessionStart'])))));
  const plan = (over) => planClaudeCode({ target: '/settings.json', text, relayBin: NEXT.relay, nodeBin: NEXT.node, subscribersPath: NEXT.subscribers,
    subscribers: config, events: ['SessionStart'], qualification, identity: target(), ...over });
  const artifact = plan(), before = JSON.parse(text).hooks, after = JSON.parse(artifact.changes[0].after).hooks;
  assert.deepEqual(Object.keys(artifact).sort(), ['changes', 'evidence', 'harness', 'schema'], 'the artifact keeps the previous release\'s format');
  for (const event of Object.keys(before).filter((e) => e !== 'SessionStart')) assert.deepEqual(after[event], before[event], event);
  const askEntriesBefore = before.PreToolUse.filter((e) => e.matcher === 'AskUserQuestion'), askEntriesAfter = after.PreToolUse.filter((e) => e.matcher === 'AskUserQuestion');
  assert.deepEqual(askEntriesAfter, askEntriesBefore);
  assert.ok(after.PreToolUse.some((e) => e.hooks[0].command === '/usr/local/bin/ops-guard'), 'a native policy line stays though its basename is a subscriber');
  assert.match(after.SessionStart[0].hooks[0].command, new RegExp(`^'${NEXT.node}' '${NEXT.relay}' hook --harness claude-code .*--subscribers '${NEXT.subscribers}' SessionStart$`));
  assert.deepEqual(relayPairs({ harness: 'claude-code', text: artifact.changes[0].after }).map((p) => [p.relay, p.events.includes('SessionStart')]),
    [[NEXT.relay, true], [PRIOR.relay, false]], 'pairs in first-seen order: SessionStart leads the settings');
  assert.throws(() => plan({ qualification: null }), { code: 'UNQUALIFIED_ROUTE' });
  assert.throws(() => plan({ events: undefined, subscribers: subscribers() }), { code: 'UNQUALIFIED_ROUTE', message: /no qualification row \(claude-code,UserPromptSubmit,registry/ }, 'omitted events must all qualify');
  assert.throws(() => plan({ subscribersPath: PRIOR.subscribers }), { code: 'PAIR_NOT_RETAINED', message: /prior/ }, 'a new relay never takes over the prior config path');
});

test('the Codex planner gates its bindings the same way', () => {
  const qualification = parseQualification(JSON.stringify(qualificationFor({ harness: 'codex', version: '0.167.2', routes: registryRoutes(bindingsFor('codex')) })));
  const artifact = planCodex({ target: '/codex/hooks.json', text: '{"hooks":{}}', relayBin: NEXT.relay, nodeBin: NEXT.node, subscribersPath: NEXT.subscribers,
    subscribers: subscribers(), qualification, identity: target({ harness: 'codex', version: '0.167.2' }) });
  assert.equal(Object.keys(JSON.parse(artifact.changes[0].after).hooks).length, bindingsFor('codex').length);
  assert.throws(() => planCodex({ target: '/codex/hooks.json', text: '{"hooks":{}}', relayBin: NEXT.relay, nodeBin: NEXT.node, subscribersPath: NEXT.subscribers,
    subscribers: subscribers(), qualification, identity: target({ harness: 'codex', version: '0.168.0' }) }), { code: 'UNQUALIFIED_ROUTE', message: /0\.168\.0/ });
});

test('the shipped qualification fixture is a valid contract with owned gaps', () => {
  const fixture = readFileSync(new URL('./fixtures/hook-qualification.json', import.meta.url), 'utf8');
  const parsed = parseQualification(fixture), rows = qualificationRows(parsed);
  assert.equal(parsed.harness, 'agy');
  assert.ok(rows.length >= 1);
  for (const row of rows) {
    assert.throws(() => qualifyBinding(row, { harness: 'agy', version: parsed.version, mode: parsed.sessionMode, platform: parsed.platform,
      relayCommit: parsed.relayCommit, configDigest: parsed.configDigest }), { code: 'UNQUALIFIED_ROUTE', message: /owner/ });
  }
  assert.deepEqual(passedChecks('agy', { event: 'SessionStart', role: 'notice' }).retryFlag, { status: 'not-applicable', evidence: [] });
});

// Two separately versioned relay installations, laid out as npm installs one: the prior pair
// stays runnable and restorable while the new pair is cut over, partially, beside it.
async function configAt(dir, value = { schema: 2, subscribers: [] }) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'subscribers.json'); await writeFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  return file;
}

test('rollback by the retained prior binary restores the exact prior pair after a partial cutover', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'relay-pair-')); t.after(() => rm(home, { recursive: true, force: true }));
  const commitA = '1'.repeat(40), commitB = '2'.repeat(40);
  const relayA = await relayCopy(join(home, '.local/share/relay/vA'), commitA), relayB = await relayCopy(join(home, '.local/share/relay/vB'), commitB);
  const configA = await configAt(join(home, '.config/relay/vA')), configB = await configAt(join(home, '.config/relay/vB'));
  const oldConfig = await configAt(join(home, '.config/relay/schema1'), { schema: 1, subscribers: [] });
  const bin = join(home, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'codex'), '#!/bin/sh\nprintf "%s\\n" "codex-cli 0.167.2"\n', { mode: 0o700 });
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home };
  const run = (relay, args) => spawnSync(process.execPath, [relay, ...args], { encoding: 'utf8', env, timeout: 20000, killSignal: 'SIGKILL' });
  const hooks = join(home, '.codex', 'hooks.json'); await mkdir(join(home, '.codex'));
  const original = planHooks({ text: '{"hooks":{}}\n', harness: 'codex', relayBin: relayA, nodeBin: process.execPath, subscribersPath: configA });
  await writeFile(hooks, original);
  const [prior] = relayPairs({ harness: 'codex', text: original }), previous = pairDigests(prior);
  assert.deepEqual([prior.relay, prior.subscribers, prior.node], [relayA, configA, process.execPath]);
  const configDigest = sha256(await readFile(configB));
  const qualification = join(home, 'qualification.json');
  await writeFile(qualification, JSON.stringify(qualificationFor({ harness: 'codex', version: '0.167.2', relayCommit: commitB, configDigest,
    routes: registryRoutes(selectBindings('codex', ['SessionStart'])) })));
  const install = (config, artifact, extra = []) => run(relayB, ['install', '--harness', 'codex', '--subscribers', config, '--target', hooks, '--node', process.execPath,
    '--qualification', qualification, '--session-mode', 'interactive', '--event', 'SessionStart', ...extra, '--artifact', artifact, '--apply']);

  const legacy = install(oldConfig, join(home, 'legacy.json'));
  assert.equal(legacy.status, 1); assert.match(legacy.stderr, /schema 1 is no longer read; migrate/, 'new binary with the old config is diagnosed');
  const shared = install(configA, join(home, 'shared.json'));
  assert.equal(shared.status, 1); assert.match(shared.stderr, /PAIR_NOT_RETAINED/, 'the prior config is never handed to the new binary');
  assert.equal(await readFile(hooks, 'utf8'), original);
  const unpinned = await relayCopy(join(home, '.local/share/relay/vC'), null);
  const unknown = run(unpinned, ['install', '--harness', 'codex', '--subscribers', configB, '--target', hooks, '--node', process.execPath,
    '--qualification', qualification, '--session-mode', 'interactive', '--event', 'SessionStart']);
  assert.equal(unknown.status, 1); assert.match(unknown.stderr, /UNQUALIFIED_ROUTE: .*relay commit/);
  const wrong = await relayCopy(join(home, '.local/share/relay/vD'), '3'.repeat(40));
  const mismatched = run(wrong, ['install', '--harness', 'codex', '--subscribers', configB, '--target', hooks, '--node', process.execPath,
    '--qualification', qualification, '--session-mode', 'interactive', '--event', 'SessionStart']);
  assert.equal(mismatched.status, 1); assert.match(mismatched.stderr, /UNQUALIFIED_ROUTE: .*relayCommit/);

  const cutover = join(home, 'cutover.json'), applied = install(configB, cutover);
  assert.equal(applied.status, 0, applied.stderr);
  const pairs = run(relayB, ['pairs', '--harness', 'codex', '--target', hooks]);
  assert.equal(pairs.status, 0, pairs.stderr);
  const listed = JSON.parse(pairs.stdout);
  assert.deepEqual(listed.map((p) => [p.relay, p.subscribers, p.events.includes('SessionStart')]), [[relayB, configB, true], [relayA, configA, false]], 'partial cutover: SessionStart alone moved');
  assert.deepEqual(listed[1], { ...previous, events: listed[1].events });

  const rollback = run(relayA, ['rollback', '--artifact', cutover]);
  assert.deepEqual([rollback.status, rollback.stdout, rollback.stderr], [0, '', '']);
  const restoredSettings = await readFile(hooks, 'utf8');
  assert.equal(restoredSettings, original);
  const [restored] = relayPairs({ harness: 'codex', text: restoredSettings }), rollbackResult = pairDigests(restored);
  assert.equal(rollbackResult.binaryDigest, previous.binaryDigest);
  assert.equal(rollbackResult.configDigest, previous.configDigest);
  assert.equal(rollbackResult.nodeDigest, previous.nodeDigest);
  const again = run(relayA, ['rollback', '--artifact', cutover]);
  assert.deepEqual([again.status, await readFile(hooks, 'utf8')], [0, original], 'an already-restored target is skipped');

  const second = join(home, 'second.json');
  assert.equal(install(configB, second).status, 0);
  await appendFile(hooks, ' ');
  const drifted = await readFile(hooks, 'utf8'), refused = run(relayA, ['rollback', '--artifact', second]);
  assert.equal(refused.status, 1); assert.match(refused.stderr, /TARGET_DRIFT/);
  assert.equal(await readFile(hooks, 'utf8'), drifted);

});
