import { createProcessOps } from '../src/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { tempState } from './helpers/fixture.js';
import { openInbox } from '../src/serve/inbox.js';
import { serveSocket } from '../src/serve/socket.js';
import { connectSocket } from '../src/serve/client.js';
import { checkSocketPath, SOCKET_PATH_LIMITS } from '../src/serve/socket-path.js';
import { runServe, servePaths } from '../src/serve/serve.js';
import { expectAnswers } from '../src/routes/index.js';
import { runAsk } from '../src/routes/ask.js';
import { runPresence } from '../src/cli/desk.js';

const LIMIT = SOCKET_PATH_LIMITS[/** @type {'linux'|'darwin'} */ (process.platform)];
// A state directory under the test's own temp root whose serve.sock is exactly `bytes` long.
async function stateDirFor(t, bytes) {
  const { stateDir: root } = await tempState(t);
  const pad = bytes - Buffer.byteLength(join(root, 'x', 'serve.sock'));
  assert.ok(pad >= 0, `temp root ${root} is too long for a ${bytes}-byte socket path`);
  const stateDir = join(root, `${'p'.repeat(pad)}x`);
  await fs.mkdir(stateDir, { mode: 0o700 });
  assert.equal(Buffer.byteLength(servePaths(stateDir).socketPath), bytes);
  return stateDir;
}
async function inboxFor(stateDir) {
  const { inbox } = await openInbox({ stateDir, expectAnswers });
  return inbox;
}
const tooLong = (socketPath, limit = LIMIT) => ({ code: 'INVALID_CONFIG', message: new RegExp(
  `${socketPath.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')} is ${Buffer.byteLength(socketPath)} bytes.*${limit}-byte.*RELAY_STATE_DIR or XDG_STATE_HOME`) });

test('the limit is sun_path less its NUL, counted in UTF-8 bytes', () => {
  assert.deepEqual(SOCKET_PATH_LIMITS, { linux: 107, darwin: 103 });
  const at = `/${'a'.repeat(106)}`, over = `/${'a'.repeat(107)}`;
  assert.equal(checkSocketPath(at, 'linux'), at);
  assert.throws(() => checkSocketPath(over, 'linux'), tooLong(over, 107));
  // 51 two-byte characters plus the slash are 103 bytes but 52 characters.
  const wide = `/${'é'.repeat(51)}`;
  assert.equal(checkSocketPath(wide, 'darwin'), wide);
  assert.throws(() => checkSocketPath(`${wide}a`, 'darwin'), tooLong(`${wide}a`, 103));
  assert.throws(() => checkSocketPath(at, 'win32'), { code: 'INVALID_CONFIG', message: /win32/ });
});

test('serve binds and a client connects at the limit', async (t) => {
  const stateDir = await stateDirFor(t, LIMIT), { socketPath } = servePaths(stateDir);
  const server = await serveSocket({ inbox: await inboxFor(stateDir), socketPath, processOps: createProcessOps(), reattachMs: 60000, log: () => {} });
  t.after(() => server.close());
  assert.equal((await fs.stat(socketPath)).mode & 0o777, 0o600);
  const client = await connectSocket(socketPath); t.after(() => client.close());
  assert.equal((await client.request('presence.get')).ok, true);
});

test('serveSocket refuses a path over the limit before binding anything', async (t) => {
  // Two bytes over is where Node 22 used to bind a truncated path; check that file never appears.
  for (const over of [1, 2]) {
    const stateDir = await stateDirFor(t, LIMIT + over), { socketPath } = servePaths(stateDir);
    const inbox = await inboxFor(stateDir), before = await fs.readdir(stateDir);
    await assert.rejects(serveSocket({ inbox, socketPath, processOps: createProcessOps(), reattachMs: 60000, log: () => {} }), tooLong(socketPath));
    assert.deepEqual(await fs.readdir(stateDir), before);
    await assert.rejects(fs.lstat(socketPath.slice(0, LIMIT + 1)), { code: 'ENOENT' });
  }
});

test('relay serve refuses an over-long socket path before taking its lock or opening the inbox', async (t) => {
  const stateDir = await stateDirFor(t, LIMIT + 1), { socketPath } = servePaths(stateDir);
  await assert.rejects(runServe({ env: { HOME: stateDir, RELAY_STATE_DIR: stateDir }, log: () => {} }), tooLong(socketPath));
  assert.deepEqual(await fs.readdir(stateDir), []);
});

test('clients refuse one byte over the limit instead of reporting serve as down', async (t) => {
  const stateDir = await stateDirFor(t, LIMIT + 1), { socketPath } = servePaths(stateDir);
  await assert.rejects(connectSocket(socketPath), tooLong(socketPath));
  await assert.rejects(runPresence({ mode: undefined, socketPath }), tooLong(socketPath));
  const payload = JSON.stringify({ session_id: 's-test', transcript_path: '/tmp/t.jsonl', cwd: '/tmp', hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion', tool_use_id: 'toolu_test', tool_input: { questions: [{ question: 'Which shape?', header: 'Shape', multiSelect: false,
      options: [{ label: 'Circle', description: 'Round' }, { label: 'Square', description: 'Four sides' }] }] } });
  const r = await runAsk({ nativeEvent: 'PreToolUse', stdin: Readable.from([payload]), socketPath });
  assert.deepEqual({ stdout: r.stdout, exitCode: r.exitCode }, { stdout: '', exitCode: 0 });
  assert.match(r.stderr, /^relay ask: INVALID_CONFIG: service socket path .* bytes, over the \d+-byte/);
});
