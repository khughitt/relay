import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
