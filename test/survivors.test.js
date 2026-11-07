import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { processMarker, markedPids, reapMarked } from './helpers/survivors.js';
import { until } from './helpers/wait.js';

const fixture = new URL('./fixtures/subscriber.js', import.meta.url).pathname;

test('a marked process is found and reaped even when COLUMNS would cut ps lines', async (t) => {
  const saved = process.env.COLUMNS; process.env.COLUMNS = '80';
  t.after(() => { if (saved === undefined) delete process.env.COLUMNS; else process.env.COLUMNS = saved; });
  const marker = processMarker();
  const child = spawn(process.execPath, [fixture, 'hang', marker], { stdio: ['pipe', 'ignore', 'ignore'] });
  t.after(() => child.kill('SIGKILL'));
  child.stdin.end();
  // The marker is the last word of a long command line, past column 80.
  assert.deepEqual(await until(() => markedPids(marker).length && markedPids(marker), { what: 'the marked child' }), [child.pid]);
  await reapMarked(marker);
  assert.deepEqual(markedPids(marker), []);
});

test('the hang fixture refuses to run without a test marker, so an unmarked hang cannot leak unseen', { timeout: 5000 }, async (t) => {
  const child = spawn(process.execPath, [fixture, 'hang'], { stdio: ['pipe', 'ignore', 'ignore'] });
  t.after(() => child.kill('SIGKILL'));
  child.stdin.end();
  const [code] = await once(child, 'exit');
  assert.equal(code, 9);
});
