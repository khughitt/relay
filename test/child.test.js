import test from 'node:test';
import assert from 'node:assert/strict';
import { runChild, OUTPUT_LIMIT } from '../src/child.js';
import { processMarker, noneMarked, reapMarked } from './helpers/survivors.js';

const fixture = new URL('./fixtures/subscriber.js', import.meta.url).pathname;
const argv = (mode, ...rest) => [process.execPath, fixture, mode, ...rest];
const far = () => performance.now() + 10000;

test('a finished child returns its exit code and capped streams', async () => {
  const ok = await runChild(argv('allow'), '{}', { deadline: far(), timeoutMs: 5000 });
  assert.deepEqual(ok, { status: 'exited', exitCode: 0, signal: null, stdout: '{"decision":"allow"}', stderr: '' });
  const crashed = await runChild(argv('crash'), '{}', { deadline: far(), timeoutMs: 5000 });
  assert.equal(crashed.status, 'exited'); assert.equal(crashed.exitCode, 3); assert.equal(crashed.stderr, 'fixture crashed\n');
  const big = await runChild(argv('big'), '{}', { deadline: far(), timeoutMs: 5000 });
  assert.equal(big.status, 'output-exceeded'); assert.ok(big.stdout.length <= OUTPUT_LIMIT);
  assert.equal(OUTPUT_LIMIT, 65536);
});

test('timeouts and deadlines kill the child; spawn failures are reported, not thrown', async (t) => {
  const started = performance.now(), marker = processMarker();
  t.after(() => reapMarked(marker));
  const hung = await runChild(argv('hang', marker), '{}', { deadline: far(), timeoutMs: 200 });
  assert.equal(hung.status, 'timeout'); assert.equal(hung.signal, 'SIGKILL'); assert.ok(performance.now() - started < 2000);
  await noneMarked(marker);
  const late = await runChild(argv('allow'), '{}', { deadline: performance.now() + 50, timeoutMs: 5000 });
  assert.ok(['exited', 'timeout'].includes(late.status)); assert.ok(performance.now() - started < 3000);
  const expired = await runChild(argv('allow'), '{}', { deadline: performance.now() - 1, timeoutMs: 5000 });
  assert.deepEqual(expired, { status: 'timeout', exitCode: null, signal: null, stdout: '', stderr: '' });
  const missing = await runChild(['/nonexistent/relay-subscriber'], '{}', { deadline: far(), timeoutMs: 1000 });
  assert.equal(missing.status, 'spawn-failed'); assert.equal(missing.error.code, 'ENOENT');
});

test('the child inherits the environment and receives stdin verbatim', async (t) => {
  const { mkdtemp, rm, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'relay-child-')); t.after(() => rm(dir, { recursive: true, force: true }));
  process.env.RELAY_TEST_MARKER = 'inherited-marker'; t.after(() => { delete process.env.RELAY_TEST_MARKER; });
  const env = await runChild(argv('env', join(dir, 'env')), '{}', { deadline: far(), timeoutMs: 5000 });
  assert.equal(env.exitCode, 0); assert.equal(await readFile(join(dir, 'env'), 'utf8'), 'inherited-marker');
  await runChild(argv('record', join(dir, 'in')), '{"schema":1,"marker":"PRIVATE"}', { deadline: far(), timeoutMs: 5000 });
  assert.equal(await readFile(join(dir, 'in'), 'utf8'), '{"schema":1,"marker":"PRIVATE"}');
});
