import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayOf } from '../src/adapters/codex-rollout.js';
import { tempStore, threadAt, sessionMeta, turnContext } from './helpers/codex-store.js';

const BIN = fileURLToPath(new URL('../bin/relay.js', import.meta.url));
const LINUX = process.platform === 'linux' ? false : 'a codex-named parent and PID namespaces are checked on Linux';
// The suite may itself run inside a Codex tool call or with RELAY_FORMAT set: start clean.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CODEX_') && k !== 'RELAY_FORMAT'));
/** An executable named `codex` that runs relay as its child, so relay's nearest harness is Codex. */
function codexParent(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-codex-parent-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parent = path.join(dir, 'codex');
  fs.writeFileSync(parent, '#!/bin/sh\n"$RELAY_NODE" "$RELAY_BIN" "$@"\nexit $?\n', { mode: 0o700 });
  return parent;
}
/** A store whose thread's last turn ran gpt-6-astra and was recorded 30 s ago. */
function liveStore(t) {
  const store = tempStore(t), thread = threadAt(Date.now() - 60_000);
  store.day(dayOf(thread, 'UTC'), thread, [sessionMeta(thread), turnContext('gpt-6-astra', new Date(Date.now() - 30_000).toISOString())]);
  return { thread, env: { ...cleanEnv(), TZ: 'UTC', CODEX_HOME: store.root, CODEX_THREAD_ID: thread, RELAY_NODE: process.execPath, RELAY_BIN: BIN } };
}
const direct = (args, env) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env });

test('verified, as JSON and as the pretty agent line', { skip: LINUX }, (t) => {
  const { env, thread } = liveStore(t), parent = codexParent(t);
  const json = spawnSync(parent, ['model', '--harness', 'codex', '--json'], { encoding: 'utf8', env });
  assert.equal(json.status, 0, json.stderr); assert.equal(json.stderr, '');
  const answer = JSON.parse(json.stdout);
  assert.deepEqual(Object.keys(answer), ['verified', 'agent', 'harness', 'model', 'effort', 'thread', 'rollout', 'reason']);
  assert.deepEqual([answer.verified, answer.agent, answer.model, answer.effort, answer.thread, answer.reason], [true, 'codex/gpt-6-astra', 'gpt-6-astra', 'high', thread, null]);
  const pretty = spawnSync(parent, ['model', '--harness', 'codex', '--pretty'], { encoding: 'utf8', env: { ...env, RELAY_FORMAT: 'json' } });
  assert.deepEqual([pretty.status, pretty.stdout, pretty.stderr], [0, 'codex/gpt-6-astra\n', '']);
  const plain = spawnSync(parent, ['model', '--harness', 'codex'], { encoding: 'utf8', env });
  assert.equal(plain.stdout, 'codex/gpt-6-astra\n');
});
test('unverified: bare codex on stdout, the reason on stderr, exit 0', () => {
  const pretty = direct(['model', '--harness', 'codex'], cleanEnv());
  assert.equal(pretty.status, 0); assert.equal(pretty.stdout, 'codex\n');
  assert.equal(pretty.stderr, 'relay: model unverified (no-thread): CODEX_THREAD_ID is not set; only a Codex tool call carries it\n');
  const json = direct(['model', '--harness', 'codex', '--json'], cleanEnv());
  assert.deepEqual([json.status, json.stderr], [0, '']);
  assert.deepEqual(JSON.parse(json.stdout), { verified: false, agent: 'codex', harness: 'codex', model: null, effort: null, thread: null, rollout: null, reason: 'no-thread' });
});
test('a failure is exit 1 with the model_failed envelope', () => {
  const r = direct(['model', '--harness', 'codex', '--json'], { ...cleanEnv(), CODEX_THREAD_ID: 'bogus' });
  assert.deepEqual([r.status, r.stdout], [1, '']);
  assert.equal(r.stderr, '{"error":{"kind":"model_failed","detail":"INVALID_INPUT: CODEX_THREAD_ID is not a lowercase UUIDv7"}}\n');
});
test('usage errors exit 2; help exits 0', () => {
  for (const args of [['model'], ['model', '--harness', 'claude-code'], ['model', '--harness', 'codex', 'extra'], ['model', '--harness']])
    assert.equal(direct(args, cleanEnv()).status, 2, args.join(' '));
  const help = direct(['model', '--help'], cleanEnv());
  assert.equal(help.status, 0); assert.match(help.stdout, /^Usage: relay model --harness codex/);
});
test('in a PID namespace whose pid 1 is codex, the real process helper verifies', { skip: LINUX }, (t) => {
  const { env } = liveStore(t), parent = codexParent(t);
  const r = spawnSync('unshare', ['--user', '--map-root-user', '--pid', '--fork', '--mount-proc', parent, 'model', '--harness', 'codex', '--json'], { encoding: 'utf8', env });
  assert.equal(r.error, undefined, `unshare must be runnable: ${r.error}`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).agent, 'codex/gpt-6-astra');
});
