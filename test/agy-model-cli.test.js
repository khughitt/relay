import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agyStore, encodeGeneration } from './helpers/agy-store.js';
import { tempStore, threadAt, sessionMeta, turnContext } from './helpers/codex-store.js';
import { dayOf } from '../src/adapters/codex-rollout.js';

const BIN = fileURLToPath(new URL('../bin/relay.js', import.meta.url));
const NO_SQLITE = fileURLToPath(new URL('./helpers/no-sqlite.mjs', import.meta.url));
const LINUX = process.platform === 'linux' ? false : 'harness-named parent processes are checked on Linux';
const conversation = '45d5430e-0906-4123-8123-0123456789ab';
const trajectory = 'trajectory';

function cleanEnv(t, { appData, id, metadata, codexHome, thread } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-agy-model-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { PATH: process.env.PATH, HOME: home, TZ: 'UTC',
    ANTIGRAVITY_CONVERSATION_ID: id, ANTIGRAVITY_TRAJECTORY_ID: trajectory,
    ANTIGRAVITY_APP_DATA_DIR: appData, ANTIGRAVITY_SOURCE_METADATA: metadata,
    CODEX_HOME: codexHome, CODEX_THREAD_ID: thread, RELAY_NODE: process.execPath, RELAY_BIN: BIN };
}

/** Keep a harness-named process alive while the real CLI inspects its ancestry. */
function harnessParent(t, harness) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-model-parent-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parent = path.join(dir, harness);
  // Node 22 warns on SQLite import; suppress only that warning in fixture children.
  fs.writeFileSync(parent, '#!/bin/sh\n"$RELAY_NODE" --disable-warning=ExperimentalWarning "$@"\nexit $?\n', { mode: 0o700 });
  return parent;
}

function fixture(t, { model = 'gemini-4-argon', label = 'Gemini 4 Argon (High)' } = {}) {
  const { appData, database } = agyStore(t, { conversation, rows: [
    encodeGeneration({ model, label: label ?? undefined, lastStep: 1, cascade: conversation, trajectory }),
    encodeGeneration({ model: 'later-model', lastStep: 4, cascade: conversation, trajectory }),
  ] });
  return { database, env: cleanEnv(t, { appData, id: conversation,
    metadata: JSON.stringify({ tool: { conversationId: conversation, stepIndex: 3 } }) }) };
}

const run = (parent, args, env, noSqlite = false) => spawnSync(parent,
  [...(noSqlite ? ['--import', NO_SQLITE] : []), env.RELAY_BIN, ...args], { encoding: 'utf8', env });

test('agy pretty and JSON bind to the issuing generation and expose the shared answer', { skip: LINUX }, (t) => {
  const { env, database } = fixture(t), parent = harnessParent(t, 'agy');
  for (const format of [[], ['--pretty']]) {
    const result = run(parent, ['model', '--harness', 'agy', ...format], env);
    assert.deepEqual([result.status, result.stdout, result.stderr], [0, 'agy/gemini-4-argon@high\n', '']);
  }
  const json = run(parent, ['model', '--harness', 'agy', '--json'], env);
  assert.deepEqual([json.status, json.stderr], [0, '']);
  const answer = JSON.parse(json.stdout);
  assert.deepEqual(Object.keys(answer), ['verified', 'agent', 'harness', 'model', 'effort', 'effortReason', 'reason', 'source']);
  assert.deepEqual(answer, { verified: true, agent: 'agy/gemini-4-argon@high', harness: 'agy',
    model: 'gemini-4-argon', effort: 'high', effortReason: null, reason: null,
    source: { conversation, step: 3, generation: 0, database, label: 'Gemini 4 Argon (High)' } });
});

test('agy subagent model is verified while absent effort is explicit', { skip: LINUX }, (t) => {
  const { env } = fixture(t, { model: 'gemini-3.8-flash-tiered', label: null });
  const result = run(harnessParent(t, 'agy'), ['model', '--harness', 'agy', '--pretty'], env);
  assert.deepEqual([result.status, result.stdout], [0, 'agy/gemini-3.8-flash-tiered\n']);
  assert.equal(result.stderr, `relay: effort not recorded: generation 0 of conversation ${conversation} carries no effort label\n`);
});

test('no agy conversation prints a bare stamp and an explicit unverified reason', (t) => {
  const env = cleanEnv(t);
  const result = spawnSync(process.execPath, [BIN, 'model', '--harness', 'agy', '--pretty'], { encoding: 'utf8', env });
  assert.deepEqual([result.status, result.stdout], [0, 'agy\n']);
  assert.equal(result.stderr, 'relay: model unverified (no-conversation): ANTIGRAVITY_CONVERSATION_ID is not set; only an agy tool call carries it\n');
});

test('unavailable SQLite fails only the agy model route with the existing JSON error envelope', { skip: LINUX }, (t) => {
  const { env } = fixture(t);
  const agy = run(harnessParent(t, 'agy'), ['model', '--harness', 'agy', '--json'], env, true);
  assert.deepEqual([agy.status, agy.stdout], [1, '']);
  const failure = JSON.parse(agy.stderr);
  assert.deepEqual(Object.keys(failure), ['error']);
  assert.deepEqual(Object.keys(failure.error), ['kind', 'detail']);
  assert.equal(failure.error.kind, 'model_failed');
  assert.match(failure.error.detail, /^UNSUPPORTED_RUNTIME:/);

  const store = tempStore(t), thread = threadAt(Date.now() - 60_000);
  store.day(dayOf(thread, 'UTC'), thread, [sessionMeta(thread), turnContext('gpt-6-astra', new Date(Date.now() - 30_000).toISOString())]);
  const codex = run(harnessParent(t, 'codex'), ['model', '--harness', 'codex', '--json'], cleanEnv(t, { codexHome: store.root, thread }), true);
  assert.deepEqual([codex.status, codex.stderr], [0, '']);
  assert.equal(JSON.parse(codex.stdout).agent, 'codex/gpt-6-astra@high');
});

test('unassessed model harnesses remain usage errors', (t) => {
  const result = spawnSync(process.execPath, [BIN, 'model', '--harness', 'opencode'], { encoding: 'utf8', env: cleanEnv(t) });
  assert.deepEqual([result.status, result.stdout], [2, '']);
});
