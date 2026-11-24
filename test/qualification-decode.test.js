import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const decoder = join(root, 'scripts/hook-qualification/decode.mjs');
const workload = join(root, 'scripts/hook-qualification/workload.json');
const stopPayload = JSON.parse(readFileSync(join(root, 'test/fixtures/hook-events/claude-code.Stop.input.json'), 'utf8'));

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-decode-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const childEnv = (home) => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

function manifestAt(dir, payload, padField = []) {
  mkdirSync(join(dir, 'fixture', 'cwd'), { recursive: true });
  const file = join(dir, 'route-manifest.json');
  writeFileSync(file, JSON.stringify({ schema: 1, host: 'host-a', manifests: [{ harness: 'claude-code', event: payload.hook_event_name, fixture: 'fixture', payload, padField }] }));
  return file;
}

test('the runner exports one timed-input builder with the original cwd and padding', async () => {
  // Break caught: a copied decoder builder can drift from the payload the runner actually times.
  const { buildTimedInput } = await import(pathToFileURL(join(root, 'scripts/hook-qualification/run.mjs')).href);
  assert.equal(typeof buildTimedInput, 'function');
  const base = '{"cwd":"/f/cwd","hook_event_name":"Stop","prompt":""}';
  const built = buildTimedInput({ payload: { hook_event_name: 'Stop' }, padField: ['prompt'] }, { fixture: '/f', payloadBytes: Buffer.byteLength(base) + 4 });
  assert.equal(built.cwd, '/f/cwd');
  assert.equal(built.input, '{"cwd":"/f/cwd","hook_event_name":"Stop","prompt":"xxxx"}');
  assert.equal(built.paddedBytes, 4);
  const explicit = buildTimedInput({ payload: { cwd: '/chosen', hook_event_name: 'Stop' } }, { fixture: '/f', payloadBytes: 1024 });
  assert.deepEqual(explicit, { cwd: '/chosen', input: '{"cwd":"/chosen","hook_event_name":"Stop"}', padField: [], paddedBytes: 0 });
});

test('decode.mjs rebuilds and normalizes the exact timed Stop payload', (t) => {
  // Break caught: decoding a placeholder cwd or a differently padded input produces the wrong row evidence.
  const dir = scratch(t);
  const payload = Object.fromEntries(Object.entries(stopPayload).filter(([key]) => key !== 'cwd'));
  const file = manifestAt(dir, payload, ['session_crons', 0, 'prompt']);
  const run = spawnSync(process.execPath, [decoder, '--candidate', root, '--workload', workload, file], { encoding: 'utf8', env: childEnv(dir) });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.schema, 1);
  assert.equal(report.results.length, 1);
  const result = report.results[0];
  assert.equal(result.host, 'host-a');
  assert.equal(result.event, 'Stop');
  const expectedCwd = join(dir, 'fixture', 'cwd');
  const expectedPadding = 1024 - Buffer.byteLength(JSON.stringify({ cwd: expectedCwd, ...payload,
    session_crons: [{ ...payload.session_crons[0], prompt: '' }] }));
  assert.ok(expectedPadding > 0);
  assert.equal(result.cwd, expectedCwd);
  assert.equal(result.bytes, 1024);
  assert.deepEqual(result.padField, ['session_crons', 0, 'prompt']);
  assert.equal(result.paddedBytes, expectedPadding);
  assert.equal(result.decoded.kind, 'turn-end');
  assert.equal(result.decoded.cwd, result.cwd);
  assert.deepEqual(result.decoded.identity, { status: 'valid', value: { agentId: 'claude-code:sess', sessionId: 'sess' } });
  assert.deepEqual(result.decoded.facts.stopHookActive, { status: 'valid', value: false });
  assert.equal(result.decoded.private.backgroundTasks.value.length, 2);
  assert.equal(result.decoded.private.sessionCrons.value[0].prompt.length, expectedPadding);
});

test('decode.mjs accepts the original prepared fixture when an archived manifest moved', (t) => {
  // Break caught: resolving only beside the copied manifest cannot reproduce the bytes timed at the original path.
  const dir = scratch(t);
  const payload = Object.fromEntries(Object.entries(stopPayload).filter(([key]) => key !== 'cwd'));
  const file = manifestAt(dir, payload);
  const original = join(dir, 'original-fixture');
  mkdirSync(join(original, 'cwd'), { recursive: true });
  const run = spawnSync(process.execPath, [decoder, '--candidate', root, '--workload', workload, `${file}=${original}`], { encoding: 'utf8', env: childEnv(dir) });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(JSON.parse(run.stdout).results[0].cwd, join(original, 'cwd'));
});

test('decode.mjs reports an invalid padded SessionStart scratchpad directory without hiding it', (t) => {
  // Break caught: treating the deliberately invalid padded field as valid misstates the benchmark's decode path.
  const dir = scratch(t);
  const payload = { session_id: 'sess', hook_event_name: 'SessionStart', source: 'startup', model: 'claude-opus-5-5', transcript_path: '/home/u/s.jsonl', scratchpad_dir: '/scratch/sess' };
  const file = manifestAt(dir, payload, ['scratchpad_dir']);
  const run = spawnSync(process.execPath, [decoder, '--candidate', root, '--workload', workload, file], { encoding: 'utf8', env: childEnv(dir) });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout).results[0];
  assert.equal(result.decoded.kind, 'session-start');
  assert.equal(result.decoded.private.scratchpadDir.status, 'invalid');
  assert.equal(result.decoded.private.transcriptPath.status, 'valid');
  assert.equal(result.decoded.facts.model.status, 'valid');
});
