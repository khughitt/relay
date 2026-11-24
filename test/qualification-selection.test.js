import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandWords } from '../scripts/hook-qualification/hook-settings.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const selection = join(root, 'scripts/hook-qualification/selection.mjs');
const childEnv = (home) => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
const scratch = (t) => { const dir = mkdtempSync(join(tmpdir(), 'relay-selection-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2)); };
const invoke = (dir, args) => spawnSync(process.execPath, [selection, ...args], { encoding: 'utf8', env: childEnv(dir) });

test('prepare replaces every command while preserving groups, matchers and timeouts', (t) => {
  // Break caught: a recorder that drops matcher or timeout structure no longer tests the frozen selection.
  const dir = scratch(t);
  const settings = { model: 'not-loaded', hooks: {
    SessionStart: [{ matcher: 'startup|resume', hooks: [{ type: 'command', command: '/bin/one' }, { type: 'command', timeout: 600, command: "'/path with spaces/two' --flag" }] }],
    Stop: [{ hooks: [{ type: 'command', command: '/bin/three' }] }, { matcher: '*', hooks: [{ type: 'command', timeout: 5, command: '/bin/four' }] }],
  } };
  const source = join(dir, 'source.json');
  const before = JSON.stringify(settings, null, 2);
  writeFileSync(source, before);
  const runDir = join(dir, 'run');
  const result = invoke(dir, ['prepare', '--settings', source, '--output', runDir, '--side', 'baseline', '--sleep', '8']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(source, 'utf8'), before, 'the frozen input is not edited');
  const prepared = readJson(join(runDir, 'home/.claude/settings.json'));
  assert.deepEqual(Object.keys(prepared), ['hooks'], 'settings outside the hook table are not loaded into the scratch home');
  assert.equal(prepared.hooks.SessionStart[0].matcher, 'startup|resume');
  assert.equal(prepared.hooks.SessionStart[0].hooks[1].timeout, 600);
  assert.equal(prepared.hooks.Stop[1].matcher, '*');
  assert.equal(prepared.hooks.Stop[1].hooks[0].timeout, 5);
  const commands = [...prepared.hooks.SessionStart[0].hooks, ...prepared.hooks.Stop.flatMap((group) => group.hooks)].map((hook) => hook.command);
  assert.equal(commands.length, 4);
  for (const command of commands) {
    const words = commandWords(command);
    assert.equal(words[1].endsWith('selection.mjs'), true);
    assert.equal(words[2], 'record');
    assert.equal(words.at(-1), '8');
  }
  const expected = readJson(join(runDir, 'expected-entries.json'));
  assert.deepEqual(expected.SessionStart.map(({ index, matcher, timeout, command }) => ({ index, matcher, timeout, command })), [
    { index: 0, matcher: 'startup|resume', timeout: undefined, command: '/bin/one' },
    { index: 1, matcher: 'startup|resume', timeout: 600, command: "'/path with spaces/two' --flag" },
  ]);
  assert.deepEqual(expected.Stop.map(({ index, command }) => ({ index, command })), [
    { index: 0, command: '/bin/three' }, { index: 1, command: '/bin/four' },
  ]);
});

function verdictRun(t, name, { sleep = 0, timeoutEvidence = true } = {}) {
  const dir = join(scratch(t), name);
  writeJson(join(dir, 'expected-entries.json'), {
    SessionStart: [{ index: 0, matcher: 'startup|resume', command: '/bin/start', timeout: null }],
    Stop: [
      { index: 0, command: '/bin/long', timeout: 600 },
      { index: 1, command: '/bin/default', timeout: null },
      { index: 2, command: '/bin/short', timeout: 5 },
    ],
  });
  const lines = [];
  let clock = 100;
  const record = (event, index, what) => { lines.push(`baseline ${event} ${index} ${1000 + index} ${what} ${clock += 1}`); };
  for (let turn = 0; turn < 2; turn++) {
    record('SessionStart', 0, 'start'); record('SessionStart', 0, 'end');
    for (const index of [0, 1, 2]) {
      record('Stop', index, 'start');
      if (!sleep || index !== 2) record('Stop', index, 'end');
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'selection.log'), `${lines.join('\n')}\n`);
  if (sleep) {
    const debug = `hooks baseline Stop 2 ${sleep}] ${timeoutEvidence ? `timed out after 5000ms (5032ms)` : 'finished with status 0'}\n`;
    writeFileSync(join(dir, 'debug-1.log'), debug);
    writeFileSync(join(dir, 'debug-2.log'), debug);
  }
  mkdirSync(join(dir, 'payloads'), { recursive: true });
  writeJson(join(dir, 'payloads/SessionStart-0-1.json'), { cwd: '/work', hook_event_name: 'SessionStart', session_id: 's', source: 'startup', transcript_path: '/t', model: 'm' });
  return dir;
}

test('the selection verdict requires every expected entry on startup, resume and both turns', (t) => {
  // Break caught: agreement between two sessions can hide an entry omitted by both.
  const run = verdictRun(t, 'plain');
  const result = invoke(dirname(run), ['verdict', run]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /SessionStart .*PASS/);
  assert.match(result.stdout, /Stop .*PASS/);
  assert.match(result.stdout, /model/);
  const log = readFileSync(join(run, 'selection.log'), 'utf8').split('\n').filter((line) => !(line.startsWith('baseline Stop 1 ') && line.includes(' end ')));
  writeFileSync(join(run, 'selection.log'), log.join('\n'));
  const missing = invoke(dirname(run), ['verdict', run]);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /Stop .*FAIL/);
});

test('the timing variant requires the configured short timeout to fire and long entries to finish', (t) => {
  // Break caught: a missing end log alone cannot prove the harness applied the 5 s timeout.
  const run = verdictRun(t, 'timing', { sleep: 8 });
  const result = invoke(dirname(run), ['verdict', '--sleep', '8', run]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /timed out after 5000ms/);
  const bad = verdictRun(t, 'timing-missing-evidence', { sleep: 8, timeoutEvidence: false });
  const refused = invoke(dirname(bad), ['verdict', '--sleep', '8', bad]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /Stop .*FAIL/);
});

const entry = (index, command, timeout) => ({ index, command, timeout });
function mappingRun(t, name, entries) {
  const dir = join(scratch(t), name);
  writeJson(join(dir, 'expected-entries.json'), { SessionStart: entries.map((e) => ({ ...e, matcher: 'startup|resume' })), Stop: entries });
  return dir;
}

test('the manifest mapping accounts for split baseline branches and candidate retained branches', (t) => {
  // Break caught: comparing mode totals alone misses a lost claude-sessionstart split or a retained native hook.
  const relay = "'/usr/bin/node' '/opt/relay/bin/relay.js' hook --harness claude-code --outer-ms 600000 --subscribers '/tmp/c.json' SessionStart";
  const baseline = mappingRun(t, 'baseline', [entry(0, '~/ops/claude-sessionstart'), entry(1, '~/lore/claude-profile'), entry(2, '~/ops/capture-notice'), entry(3, relay, 600)]);
  const candidate = mappingRun(t, 'candidate', [entry(0, relay, 600)]);
  const manifest = join(dirname(baseline), 'manifest.json');
  const manifestValue = { manifests: [{ event: 'SessionStart', branches: [
    ...['claude-sessionstart.halt', 'claude-sessionstart.stale', 'claude-sessionstart.index-repair'].map((name) => ({ name, role: 'native', migrates: true })),
    { name: 'claude-profile', role: 'native', migrates: true }, { name: 'capture-notice', role: 'native', migrates: true },
    { name: 'deployed-relay', role: 'deployed-relay' },
  ], replacementMap: [
    ...['claude-sessionstart.halt', 'claude-sessionstart.stale', 'claude-sessionstart.index-repair', 'claude-profile', 'capture-notice'].map((name) => ({ baseline: name, invocation: name, candidate: `candidate:${name}` })),
    { baseline: 'deployed-relay:familiar', invocation: 'familiar', candidate: 'candidate:familiar' },
  ] }] };
  writeJson(manifest, manifestValue);
  const args = ['map', manifest, baseline, candidate, 'SessionStart'];
  const result = invoke(dirname(baseline), args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /claude-sessionstart\.halt,claude-sessionstart\.stale,claude-sessionstart\.index-repair/);
  manifestValue.manifests[0].branches.splice(1, 1);
  writeJson(manifest, manifestValue);
  assert.equal(invoke(dirname(baseline), args).status, 1);

  const stopRelay = relay.replace('SessionStart', 'Stop');
  const baseStop = mappingRun(t, 'base-stop', [entry(0, '~/ops/claim-guard'), entry(1, '~/.local/bin/harness-state-refresh'), entry(2, stopRelay, 600), entry(3, '~/hq/turn-pause', 5)]);
  const candStop = mappingRun(t, 'cand-stop', [entry(0, stopRelay, 600), entry(1, '~/hq/turn-pause', 5)]);
  const stopManifest = join(dirname(baseStop), 'stop.json');
  writeJson(stopManifest, { manifests: [{ event: 'Stop', branches: [
    { name: 'claim-guard', role: 'native', migrates: true }, { name: 'harness-state-refresh', role: 'native', migrates: true },
    { name: 'deployed-relay', role: 'deployed-relay' }, { name: 'turn-pause', role: 'native', migrates: false },
  ] }] });
  assert.equal(invoke(dirname(baseStop), ['map', stopManifest, baseStop, candStop, 'Stop']).status, 0);
});
