import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempState } from './helpers/fixture.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('opencode install plans the plugin by its real path when the checkout path has spaces', async t => {
  const base = await tempState(t);
  const root = join(base.stateDir, 'relay checkout (wip)');
  for (const entry of ['bin', 'src', 'integrations', 'node_modules', 'package.json'])
    await fs.cp(join(ROOT, entry), join(root, entry), { recursive: true });
  const subscribers = join(base.stateDir, 'subscribers.json');
  await fs.writeFile(subscribers, JSON.stringify({ schema: 1, subscribers: [] }), { mode: 0o600 });
  const r = spawnSync(process.execPath, [join(root, 'bin', 'relay.js'), 'install', '--json',
    '--harness', 'opencode', '--config-dir', base.stateDir, '--subscribers', subscribers], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const artifact = JSON.parse(r.stdout);
  const plugin = join(root, 'integrations', 'opencode', 'plugin.js');
  assert.equal(artifact.changes.length, 1);
  assert.ok(artifact.changes[0].after.includes(plugin), artifact.changes[0].after);
  assert.equal(artifact.changes[0].after.includes('%'), false, artifact.changes[0].after);
  assert.ok(existsSync(plugin));
});
