import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../../src/bus/paths.js';
export async function tempState(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'relay-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  return paths({ RELAY_STATE_DIR: stateDir });
}
export const localObservation = (p) => ({ paths: p, resolveAgentPid: () => process.pid,
  gitContext: async () => ({ remote: null, repoRoot: null }) });
