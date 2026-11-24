// relay peer through the binary's own parser, with real process handles and registry reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { main } from '../bin/relay.js';
import { createProcessOps } from '../src/index.js';
import { tempState } from './helpers/fixture.js';
import { runCli, serveCli } from './helpers/cli-interaction.js';

const TASK = 'relay-1bf40b';
const process_ = createProcessOps().handleOf(process.pid);
const session = (id) => async () => ({ status: 'resolved', harness: id.split(':')[0], agent: { id, harness: id.split(':')[0], sessionId: id.split(':')[1], scope: 'session', process: process_, project: 'relay', cwd: '/w' } });
async function run(p, id, args, input = '') {
  let stdout = '', stderr = '';
  const sink = (add) => new Writable({ write(chunk, encoding, done) { add(String(chunk)); done(); } });
  const before = process.env.RELAY_STATE_DIR; process.env.RELAY_STATE_DIR = p.stateDir;
  try {
    const code = await main(['peer', ...args], { whoami: session(id), stdin: Readable.from([input]), stdout: sink((s) => { stdout += s; }), stderr: sink((s) => { stderr += s; }) });
    return { code, stdout, stderr };
  } finally { if (before === undefined) delete process.env.RELAY_STATE_DIR; else process.env.RELAY_STATE_DIR = before; }
}
const L = 'claude-code:lead', R = 'codex:reviewer';

test('open, join, send from standard input, wait and close', { timeout: 30000 }, async (t) => {
  const p = await tempState(t); await serveCli(t, p);
  assert.equal((await run(p, L, ['open', TASK])).code, 0);
  assert.equal((await run(p, R, ['join', TASK])).code, 0);
  assert.match((await run(p, L, ['wait', TASK, '--timeout-ms', '2000'])).stdout, /^codex:reviewer joined relay-1bf40b as reviewer\n$/);
  const sent = await run(p, L, ['send', TASK, '--file', '-'], 'Review spec abc.\n');
  assert.equal(sent.code, 0, sent.stderr);
  const got = await run(p, R, ['wait', TASK, '--timeout-ms', '2000', '--json']);
  assert.deepEqual([got.code, JSON.parse(got.stdout).text, JSON.parse(got.stdout).from], [0, 'Review spec abc.', { agentId: L, role: 'lead' }]);
  assert.equal((await run(p, R, ['wait', TASK, '--timeout-ms', '50'])).code, 5);
  assert.equal((await run(p, R, ['close', TASK, '--reason', 'done'])).code, 0);
  const ended = await run(p, L, ['wait', TASK, '--timeout-ms', '2000']);
  assert.deepEqual([ended.code, ended.stdout], [3, `closed on ${TASK} by codex:reviewer: done\n`]);
  assert.match((await run(p, L, ['show', TASK])).stdout, /closed by codex:reviewer: done\nlead claude-code:lead\nreviewer codex:reviewer\n$/);
});

test('usage errors exit 2 and a missing service is named', { timeout: 30000 }, async (t) => {
  const p = await tempState(t);
  for (const args of [[], ['open'], ['open', TASK, 'extra'], ['send', TASK], ['wait', TASK, '--timeout-ms', '0'], ['open', 'not a task'], ['send', TASK, '--from', 'user'], ['bogus', TASK]]) {
    const r = await run(p, L, args);
    assert.deepEqual([r.code, r.stdout], [2, ''], JSON.stringify(args));
    assert.notEqual(r.stderr, '');
  }
  const r = await run(p, L, ['open', TASK]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /SERVE_UNAVAILABLE: relay serve is not running/);
  const show = runCli(p, ['peer', 'show', TASK]);
  assert.equal(show.status, 1);
  assert.match(show.stderr, /SERVE_UNAVAILABLE/);
});
