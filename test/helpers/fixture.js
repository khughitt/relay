import { paths } from '../../src/index.js';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Where the tests' subscribers are found: a directory holding only `node`, and the system
// directories. Nothing comes from the inherited PATH.
const nodeDir = mkdtempSync(join(tmpdir(), 'relay-node-'));
process.on('exit', () => rmSync(nodeDir, { recursive: true, force: true }));
symlinkSync(process.execPath, join(nodeDir, 'node'));
export const TEST_SEARCH_PATH = [nodeDir, '/usr/bin', '/bin'];
export const subscriberConfig = (subscribers, searchPath = TEST_SEARCH_PATH) => ({ schema: 3, searchPath, subscribers });
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
export async function writeSubscribers(p, subscribers, { text, searchPath } = {}) {
  await mkdir(p.configDir, { recursive: true, mode: 0o700 });
  await writeFile(p.subscribersPath, text ?? `${JSON.stringify(subscriberConfig(subscribers, searchPath), null, 2)}\n`, { mode: 0o600 });
}
export const localObservation = (p) => ({ paths: p, resolveSessionPid: () => process.pid,
  gitContext: async () => ({ remote: null, repoRoot: null }) });
