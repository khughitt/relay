import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lib = new URL('../tools/codex-subagent-capture/lib.sh', import.meta.url).pathname;
test('the capture hook records CODEX_* names but only the id values, never a credential', async t => {
  const out = await mkdtemp(join(tmpdir(), 'relay-capture-hook-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await writeFile(join(out, 'auth.json'), '{}');
  const setup = spawnSync('bash', ['-c', `. ${JSON.stringify(lib)} && capture_home "$1"`, 'setup', out],
    { env: { ...process.env, CODEX_AUTH: join(out, 'auth.json') }, encoding: 'utf8' });
  assert.equal(setup.status, 0, setup.stderr);
  const hook = spawnSync(join(out, 'hook.sh'), ['PreToolUse', join(out, 'log')], { input: '{"session_id":"r"}', encoding: 'utf8',
    env: { PATH: process.env.PATH, CODEX_THREAD_ID: 'thread-1', CODEX_API_KEY: 'sk-secret-value', CODEX_HOME: '/home/user/.codex' } });
  assert.equal(hook.status, 0, hook.stderr);
  const [name] = (await readdir(join(out, 'log'))).filter(file => file.endsWith('-PreToolUse.json'));
  const text = await readFile(join(out, 'log', name), 'utf8');
  assert.equal(text.includes('sk-secret-value'), false);
  assert.deepEqual(JSON.parse(text).env, { CODEX_THREAD_ID: 'thread-1', CODEX_HOME: '/home/user/.codex', CODEX_API_KEY: '<redacted>' });
});
