// relay's declared command table equals its rows in tools/cli.toml; the binary follows
// the CLI vocabulary except where `hook` speaks the harness protocol.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../src/commands.js';
import { tempState } from './helpers/fixture.js';
import { serveCli, askCli, entryForCli, runCli } from './helpers/cli-interaction.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'relay.js');
const key = (row) => JSON.stringify(row);
const normalize = (names) => [...names.filter((n) => n.startsWith('--')), ...names.filter((n) => !n.startsWith('--'))];

function liveRows() {
  const rows = new Set();
  for (const cmd of COMMANDS) {
    rows.add(key(['command', cmd.path, cmd.summary]));
    (cmd.args ?? []).forEach((a, i) => rows.add(key(['arg', cmd.path, i, a.name, a.value, a.values ?? [], a.required, a.variadic ?? false])));
    for (const o of cmd.options ?? []) {
      const flag = o.value === 'none';
      rows.add(key(['option', cmd.path, normalize(o.names), o.value, o.values ?? [], flag ? (o.default === 'true' ? 'true' : null) : (o.default ?? null), flag ? null : (o.arity ?? '1'), o.repeatable ?? false, o.required ?? false]));
    }
  }
  return rows;
}

function tableRows() {
  const text = execFileSync('python3', [path.join(ROOT, 'tools', 'cli_surface.py'), 'rows', 'relay', path.join(ROOT, 'tools', 'cli.toml')], { encoding: 'utf8' });
  return new Set(text.trim().split('\n').map((line) => key(JSON.parse(line))));
}

// Every spawn gets its own registry: `hook` publishes to RELAY_STATE_DIR even with no subscribers.
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-state-'));
after(() => fs.rmSync(STATE, { recursive: true, force: true }));
const run = (args, env = {}, input) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, RELAY_STATE_DIR: STATE, ...env }, input });

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const subscribers = path.join(dir, 'subscribers.json'); fs.writeFileSync(subscribers, '{"schema":1,"subscribers":[]}\n', { mode: 0o600 });
  const target = path.join(dir, 'hooks.json'); fs.writeFileSync(target, '{"hooks":{}}\n');
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nprintf "%s\\n" "2.1.296 (Claude Code)"\n', { mode: 0o700 });
  const evidence = path.join(dir, 'evidence.json');
  fs.writeFileSync(evidence, JSON.stringify({ schema: 1, harness: 'claude-code', version: '2.1.296', probes: [],
    routes: ['answer-hook-terminal', 'answer-hook-deny-stops', 'answer-release-native', 'answer-receipt-observed', 'answer-hook-under-denial']
      .map((name) => ({ name, passed: true, note: 'fixture' })) }));
  return { dir, subscribers, target, bin, evidence };
}

test('declared surface equals tools/cli.toml', () => {
  const live = liveRows(), table = tableRows();
  assert.deepEqual({ parserOnly: [...live].filter((r) => !table.has(r)), tableOnly: [...table].filter((r) => !live.has(r)) }, { parserOnly: [], tableOnly: [] });
});

test('help on root and every command, protocol commands included; help routing; version', () => {
  for (const cmd of [{ path: [] }, ...COMMANDS]) {
    for (const flag of ['--help', '-h']) {
      const r = run([...cmd.path, flag]);
      assert.deepEqual({ path: cmd.path, flag, status: r.status, err: r.stderr, empty: r.stdout === '' }, { path: cmd.path, flag, status: 0, err: '', empty: false });
    }
    if (cmd.path.length) assert.equal(run(['help', ...cmd.path]).stdout, run([...cmd.path, '--help']).stdout);
  }
  for (const flag of ['--version', '-V']) { const v = run([flag]); assert.equal(v.status, 0); assert.match(v.stdout, /^relay \d/); }
});

test('usage errors exit 2 with stderr only', () => {
  for (const args of [['bogus'], ['bogus', '--help'], ['reap', '--bogus'], ['install'], ['hook'], ['help', 'bogus'], ['--json', 'list', '--pretty']]) {
    const r = run(args);
    assert.deepEqual({ args, status: r.status, out: r.stdout }, { args, status: 2, out: '' });
    assert.ok(r.stderr.trim().split('\n').length <= 2, r.stderr);
  }
});

test('enum baselines cover every enum row', (t) => {
  const { subscribers, target, bin, evidence } = fixture(t);
  const env = { PATH: `${bin}:${process.env.PATH}`, CODEX_THREAD_ID: '' };
  const payload = JSON.stringify({ session_id: 's1', hook_event_name: 'SessionStart', cwd: os.tmpdir() });
  const baselines = [
    [['install'], '--harness', ['install', '--harness', 'codex', '--subscribers', subscribers, '--target', target]],
    [['install'], '--retire', ['install', '--harness', 'codex', '--subscribers', subscribers, '--target', target, '--retire', 'familiar']],
    [['hook'], '--harness', ['hook', '--harness', 'claude-code', '--subscribers', subscribers, 'SessionStart']],
    [['ask'], '--harness', ['ask', '--harness', 'claude-code', 'PostToolUse']],
    [['install'], '--with', ['install', '--harness', 'claude-code', '--subscribers', subscribers, '--target', target, '--evidence', evidence, '--with', 'ask']],
    [['model'], '--harness', ['model', '--harness', 'codex']],
  ];
  const table = [...tableRows()].map((r) => JSON.parse(r)).filter((r) => r[0] === 'option' && r[3] === 'enum').map((r) => `${r[1].join(' ')} ${r[2][0]}`).sort();
  assert.deepEqual(baselines.map(([p, b]) => `${p.join(' ')} ${b}`).sort(), table, 'every enum row needs a baseline');
  for (const [, binding, argv] of baselines) {
    const ok = run(argv, env, payload);
    assert.equal(ok.status, 0, `${argv.join(' ')}: ${ok.stderr}`);
    const bad = [...argv]; bad[bad.indexOf(binding) + 1] = '__not_in_set__';
    const r = run(bad, env, payload);
    assert.equal(r.status, 2, bad.join(' ')); assert.ok(r.stderr.includes(binding) && r.stderr.includes('__not_in_set__'), r.stderr);
  }
});

test('global routing, output rows, precedence, json failure', (t) => {
  const { dir, subscribers, target } = fixture(t);
  assert.equal(typeof JSON.parse(run(['--json', 'list']).stdout), 'object');
  assert.equal(typeof JSON.parse(run(['list', '--json']).stdout), 'object');
  assert.throws(() => JSON.parse(run(['list']).stdout));
  assert.equal(typeof JSON.parse(run(['list'], { RELAY_FORMAT: 'json' }).stdout), 'object');
  assert.throws(() => JSON.parse(run(['--pretty', 'list'], { RELAY_FORMAT: 'json' }).stdout));
  // install: output = "json" → JSON unflagged; RELAY_FORMAT=pretty gives text; --json under it JSON
  const plan = ['install', '--harness', 'codex', '--subscribers', subscribers, '--target', target];
  assert.equal(typeof JSON.parse(run(plan).stdout), 'object');
  assert.throws(() => JSON.parse(run(plan, { RELAY_FORMAT: 'pretty' }).stdout));
  assert.equal(typeof JSON.parse(run(['--json', ...plan], { RELAY_FORMAT: 'pretty' }).stdout), 'object');
  // rollback: output = "none" → empty stdout with and without --json
  const artifact = path.join(dir, 'artifact.json'); fs.writeFileSync(artifact, run(plan).stdout);
  for (const args of [['rollback', '--artifact', artifact], ['--json', 'rollback', '--artifact', artifact]]) {
    const r = run(args); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, '');
  }
  const r = run(['--json', 'rollback', '--artifact', path.join(dir, 'missing.json')]);
  assert.equal(r.status, 1); assert.equal(r.stdout, '');
  const err = JSON.parse(r.stderr).error;
  assert.equal(typeof err.kind, 'string'); assert.equal(typeof err.detail, 'string');
});

// A command row with no `output` follows the CLI default (pretty) with the flag/RELAY_FORMAT
// able to flip it; under --json every one of them must still emit exactly one JSON value on
// stdout, the same as a command whose row declares `output = "json"`. Protocol rows (`hook`)
// keep their own reply shape and are excluded, as are rows that already declare an `output`
// (`install`, `rollback`) — those are covered by the precedence test above.
test('every command without a declared output row emits one JSON value under --json', { timeout: 30000 }, async (t) => {
  const p = await tempState(t); await serveCli(t, p);
  assert.equal(runCli(p, ['presence', 'away']).status, 0);
  const hook = askCli(t, p), { id } = await entryForCli(p);
  const args = { 'inbox show': [id], 'inbox answer': [id, 'q1=o1'], 'inbox defer': [id], model: ['--harness', 'codex'] };
  const candidates = COMMANDS.filter((cmd) => !cmd.protocol && !cmd.output && cmd.path.join(' ') !== 'inbox withdraw')
    .sort((a, b) => Number(a.path.join(' ') === 'inbox answer') - Number(b.path.join(' ') === 'inbox answer'));
  assert.ok(candidates.length > 0, 'expected at least one plain command row');
  for (const cmd of candidates) {
    const r = runCli(p, ['--json', ...cmd.path, ...(args[cmd.path.join(' ')] ?? [])], undefined, { CODEX_THREAD_ID: '' });
    assert.equal(r.status, 0, `${cmd.path.join(' ')}: ${r.stderr}`);
    assert.doesNotThrow(() => JSON.parse(r.stdout), `${cmd.path.join(' ')} stdout was not one JSON value: ${JSON.stringify(r.stdout)}`);
  }
  assert.equal((await hook.exited).code, 0);
  const withdrawn = runCli(p, ['--json', 'inbox', 'withdraw', id]);
  assert.equal(withdrawn.status, 1, withdrawn.stderr);
  assert.equal(withdrawn.stdout, '');
  assert.match(JSON.parse(withdrawn.stderr).error.detail, /^ANSWERED/);
});

// Protocol rows speak the harness's hook protocol: stdout is the reply and the exit code is
// the harness's. RELAY_FORMAT selects relay's own output format, which they never print, so a
// value outside json|pretty must not turn a hook into an exit-2 usage error (Claude Code
// blocks the tool on a PreToolUse exit 2).
test('protocol rows ignore RELAY_FORMAT', (t) => {
  const { subscribers } = fixture(t);
  const pre = JSON.stringify({ session_id: 's', cwd: '/tmp', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
  const ask = JSON.stringify({ session_id: 's', cwd: '/tmp', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'toolu_fmt',
    tool_input: { questions: [{ question: 'Which?', header: 'Pick', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }] } });
  const cases = {
    hook: [['hook', '--harness', 'claude-code', '--subscribers', subscribers, 'PreToolUse'], pre],
    ask: [['ask', '--harness', 'claude-code', '--handback', 'PreToolUse'], ask],
  };
  assert.deepEqual(COMMANDS.filter((cmd) => cmd.protocol).map((cmd) => cmd.path.join(' ')).sort(), Object.keys(cases).sort());
  for (const [name, [args, input]] of Object.entries(cases)) {
    const plain = run(args, {}, input), odd = run(args, { RELAY_FORMAT: 'yaml' }, input);
    assert.equal(plain.status, 0, `${name}: ${plain.stderr}`);
    assert.deepEqual([odd.status, odd.stdout], [plain.status, plain.stdout], `${name}: ${odd.stderr}`);
    assert.doesNotMatch(odd.stderr, /RELAY_FORMAT/, name);
  }
});
