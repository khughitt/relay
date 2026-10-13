import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { spawnLines } from './spawn-lines.js';

export const BIN = new URL('../../bin/relay.js', import.meta.url).pathname;
export function cliEnv(p, extra = {}) {
  const env = { ...process.env, RELAY_STATE_DIR: p.stateDir, XDG_CONFIG_HOME: join(p.stateDir, 'config') };
  for (const name of ['RELAY_FORMAT', 'RELAY_HTTP_PORT', 'RELAY_SERVE_HOST', 'RELAY_SERVE_LOGIN', 'RELAY_CLIENT_DIR']) env[name] = undefined;
  return { ...env, ...extra };
}
export const runCli = (p, args, input, extra = {}) => spawnSync(process.execPath, [BIN, ...args], {
  encoding: 'utf8', input, env: cliEnv(p, extra), timeout: 10000, killSignal: 'SIGKILL',
});
export async function serveCli(t, p) {
  const worker = spawnLines(t, BIN, ['serve'], { env: cliEnv(p) });
  for (let i = 0; i < 100; i++) {
    if (runCli(p, ['presence']).status === 0) return worker;
    if (worker.child.exitCode !== null) throw new Error(`relay serve exited: ${worker.stderr()}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`relay serve did not start: ${worker.stderr()}`);
}
export const preInput = (callId = 'toolu_cli') => JSON.stringify({
  session_id: 's', cwd: '/tmp', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: callId,
  tool_input: { questions: [{ question: 'Which?', header: 'Pick', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }] },
});
export const askCli = (t, p, flags = [], callId) => spawnLines(t, BIN, ['ask', '--harness', 'claude-code', ...flags, 'PreToolUse'], {
  env: cliEnv(p), input: preInput(callId),
});
export async function entryForCli(p, callId = 'toolu_cli') {
  for (let i = 0; i < 100; i++) {
    const r = runCli(p, ['--json', 'inbox', 'list']);
    assert.equal(r.status, 0, r.stderr);
    const entry = JSON.parse(r.stdout).entries.find((e) => e.question?.body.native.callId === callId);
    if (entry) return entry;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('no CLI question appeared');
}
