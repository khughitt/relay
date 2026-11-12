import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGroupLeader, OUTPUT_LIMIT } from '../src/child.js';
import { processMarker, noneMarked, reapMarked } from './helpers/survivors.js';

const fixture = new URL('./fixtures/subscriber.js', import.meta.url).pathname;
const argv = (mode, ...rest) => [process.execPath, fixture, mode, ...rest];
const far = () => performance.now() + 10000;
const env = { PATH: process.env.PATH, HOME: tmpdir() };
const run = (args, input, options) => runGroupLeader(args, input, { env, cwd: '/', ...options }).done;
const strip = ({ timings, ...rest }) => rest;

test('a finished child returns its exit code and capped streams once its group is gone', async () => {
  const ok = await run(argv('allow'), '{}', { deadline: far(), timeoutMs: 5000 });
  assert.deepEqual(strip(ok), { status: 'exited', exitCode: 0, signal: null, stdout: '{"decision":"allow"}', stderr: '', cleanup: 'complete' });
  assert.equal(typeof ok.timings.runMs, 'number'); assert.equal(typeof ok.timings.cleanupMs, 'number');
  const crashed = await run(argv('crash'), '{}', { deadline: far(), timeoutMs: 5000 });
  assert.equal(crashed.status, 'exited'); assert.equal(crashed.exitCode, 3); assert.equal(crashed.stderr, 'fixture crashed\n');
  const big = await run(argv('big'), '{}', { deadline: far(), timeoutMs: 5000 });
  assert.equal(big.status, 'output-exceeded'); assert.ok(big.stdout.length <= OUTPUT_LIMIT); assert.equal(big.cleanup, 'complete');
  assert.equal(OUTPUT_LIMIT, 65536);
});

test('timeouts and deadlines end the group; spawn failures are reported, not thrown', async (t) => {
  const started = performance.now(), marker = processMarker();
  t.after(() => reapMarked(marker));
  const hung = await run(argv('hang', marker), '{}', { deadline: far(), timeoutMs: 200 });
  assert.equal(hung.status, 'timeout'); assert.equal(hung.cleanup, 'complete'); assert.ok(performance.now() - started < 2000);
  await noneMarked(marker);
  const late = await run(argv('allow'), '{}', { deadline: performance.now() + 50, timeoutMs: 5000 });
  assert.ok(['exited', 'timeout'].includes(late.status));
  const expired = await run(argv('allow'), '{}', { deadline: performance.now() - 1, timeoutMs: 5000 });
  assert.equal(expired.status, 'timeout'); assert.equal(expired.cleanup, 'complete');
  const missing = await run(['/nonexistent/relay-subscriber'], '{}', { deadline: far(), timeoutMs: 1000 });
  assert.equal(missing.status, 'spawn-failed'); assert.equal(missing.error.code, 'ENOENT'); assert.equal(missing.cleanup, 'complete');
});

test('the child gets exactly the given environment and receives stdin verbatim', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-child-')); t.after(() => rm(dir, { recursive: true, force: true }));
  process.env.RELAY_TEST_MARKER = 'leaked-marker'; t.after(() => { delete process.env.RELAY_TEST_MARKER; });
  const result = await run(argv('env', join(dir, 'env')), '{}', { deadline: far(), timeoutMs: 5000 });
  assert.equal(result.exitCode, 0); assert.equal(await readFile(join(dir, 'env'), 'utf8'), '', 'nothing from the parent environment leaks');
  await run(argv('record', join(dir, 'in')), '{"schema":2,"marker":"PRIVATE"}', { deadline: far(), timeoutMs: 5000 });
  assert.equal(await readFile(join(dir, 'in'), 'utf8'), '{"schema":2,"marker":"PRIVATE"}');
});
