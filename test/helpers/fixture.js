import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../../src/bus/paths.js';
export async function tempState(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'relay-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  return paths({ RELAY_STATE_DIR: stateDir });
}
export async function tempPaths(t) {
  const root = await mkdtemp(join(tmpdir(), 'relay-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return paths({ RELAY_STATE_DIR: join(root, 'state'), XDG_CONFIG_HOME: join(root, 'config') });
}
export async function writeSubscribers(p, subscribers, { text } = {}) {
  await mkdir(p.configDir, { recursive: true, mode: 0o700 });
  await writeFile(p.subscribersPath, text ?? `${JSON.stringify({ schema: 1, subscribers }, null, 2)}\n`, { mode: 0o600 });
}
export const localObservation = (p) => ({ paths: p, resolveAgentPid: () => process.pid,
  gitContext: async () => ({ remote: null, repoRoot: null }) });
