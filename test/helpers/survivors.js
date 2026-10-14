// Finds the processes one test spawned, so a fixture that outlives its test fails that test
// instead of leaking. A marker is an extra argv word the fixture ignores; it is unique to the
// test, so concurrent suite runs never see each other's children.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { until } from './wait.js';

export const processMarker = () => `relay-test-${randomUUID()}`;

// Pids of live processes whose command line carries marker. `ps -axo` reads alike on Linux and
// macOS; a zombie shows no arguments, so an exited child awaiting its parent is not counted.
export function markedPids(marker) {
  return execFileSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8' }).split('\n')
    .filter((line) => line.includes(marker)).map((line) => Number.parseInt(line.trim(), 10));
}

// Waits until no process carries marker; fails naming the survivors.
export async function noneMarked(marker, { timeoutMs = 2000 } = {}) {
  try { await until(() => markedPids(marker).length === 0, { timeoutMs, what: `processes carrying ${marker} to exit` }); }
  catch (error) { throw new Error(`${error.message}; survivors: ${markedPids(marker).join(', ')}`); }
}

// Kills every process still carrying marker, then waits until they are gone.
export async function reapMarked(marker) {
  for (const pid of markedPids(marker)) {
    try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await noneMarked(marker);
}
