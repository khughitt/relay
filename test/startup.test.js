import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../bin/relay.js', import.meta.url).pathname;
const recorder = new URL('./fixtures/module-recorder.mjs', import.meta.url).href;

// The hook path is on every relayed tool call, so it loads the dispatch path and nothing else:
// no inbox service, question routes, desk, installer, interaction store or whoami.
test('relay hook loads only the dispatch path', async (t) => {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'relay-startup-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, 'config'), log = join(root, 'modules.log');
  await mkdir(config, { mode: 0o700 });
  await writeFile(join(config, 'subscribers.json'), '{"schema":2,"subscribers":[]}\n', { mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: root, RELAY_STATE_DIR: join(root, 'state'), RELAY_MODULE_LOG: log };
  const r = spawnSync(process.execPath, ['--import', recorder, cli, 'hook', '--harness', 'claude-code', '--subscribers', join(config, 'subscribers.json'), 'Notification:idle_prompt'],
    { encoding: 'utf8', env, input: JSON.stringify({ session_id: 's', cwd: root }) });
  assert.ok([0, 1].includes(r.status), r.stderr);
  const loaded = (await readFile(log, 'utf8')).split('\n').filter((url) => url.includes('/src/'));
  assert.ok(loaded.some((url) => url.endsWith('/src/dispatch.js')), 'the dispatch path is loaded');
  for (const unrelated of ['/src/serve/', '/src/routes/', '/src/cli/', '/src/install/', '/src/interaction/', '/src/identity/whoami.js', '/src/index.js']) {
    assert.equal(loaded.some((url) => url.includes(unrelated)), false, `relay hook must not load ${unrelated}`);
  }
});

// Amendment 1: when the subscriber file lists a subscriber for this harness, relay hook starts the
// supervisor before it loads the dispatch modules, so the two startups overlap.
async function hookRun(t, subscribers, event = 'PreToolUse') {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'relay-early-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, 'config'), log = join(root, 'modules.log');
  await mkdir(config, { mode: 0o700 });
  await writeFile(join(config, 'subscribers.json'), JSON.stringify({ schema: 2, subscribers }), { mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: root, RELAY_STATE_DIR: join(root, 'state'), RELAY_MODULE_LOG: log };
  const spawnRecorder = new URL('./fixtures/spawn-recorder.cjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath, ['--require', spawnRecorder, '--import', recorder, cli, 'hook', '--harness', 'claude-code', '--outer-ms', '20000', '--subscribers', join(config, 'subscribers.json'), event],
    { encoding: 'utf8', env, input: JSON.stringify({ session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command: 'ls' } }) });
  return { r, root, lines: (await readFile(log, 'utf8')).split('\n').filter(Boolean) };
}
const observer = (kinds) => ({ name: 'o', role: 'observer', registry: 'occurrence', kinds, harnesses: ['claude-code'], argv: ['true'], timeoutMs: 1000 });

test('relay hook starts the supervisor before it loads the dispatch modules', async (t) => {
  const { r, lines } = await hookRun(t, [observer(['before-tool'])]);
  assert.equal(r.status, 0, r.stderr);
  const spawned = lines.findIndex((line) => line.startsWith('SPAWN ') && line.includes('supervisor-process.js'));
  const dispatch = lines.findIndex((line) => line.endsWith('/src/dispatch.js'));
  assert.ok(spawned >= 0 && dispatch >= 0, lines.join('\n'));
  assert.ok(spawned < dispatch, 'the supervisor spawn precedes loading the dispatch module');
  assert.equal(lines.filter((line) => line.startsWith('SPAWN ') && line.includes('supervisor-process.js')).length, 1, 'the dispatch adopts the early supervisor rather than starting another');
});

test('an early supervisor is closed unused, with no record, when the dispatch admits nothing', async (t) => {
  const { r, root, lines } = await hookRun(t, [observer(['after-tool'])]);
  assert.equal(r.status, 0, r.stderr);
  const spawn = lines.find((line) => line.startsWith('SPAWN ') && line.includes('supervisor-process.js'));
  assert.ok(spawn, 'a subscriber for this harness starts one speculatively');
  const pid = Number(spawn.split(' ')[1]);
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  assert.equal(alive, false, 'the unused supervisor has exited when the reply returns');
  assert.deepEqual(await readdir(join(root, 'state', 'children')).catch(() => []), []);
  const none = await hookRun(t, [{ ...observer(['before-tool']), harnesses: ['codex'] }]);
  assert.equal(none.lines.some((line) => line.includes('supervisor-process.js')), false, 'no subscriber for this harness starts none');
});
