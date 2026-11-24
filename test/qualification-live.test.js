import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const selection = join(root, 'scripts/hook-qualification/selection.mjs');
const scratch = (t) => { const dir = mkdtempSync(join(tmpdir(), 'relay-live-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
const childEnv = (home) => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

test('the shared local stub serves scripted replies and captures requests without credentials', async (t) => {
  // Break caught: a live probe that skips the stub server or drops request evidence cannot be repeated safely.
  const runDir = scratch(t);
  const { startStubModel } = await import(pathToFileURL(join(root, 'scripts/hook-qualification/live.mjs')).href);
  const stub = await startStubModel({ runDir, replies: [{ text: 'first local reply' }, { text: 'second local reply' }] });
  t.after(() => stub.stop());
  assert.ok(stub.port > 0);
  const post = async () => {
    const response = await fetch(`http://127.0.0.1:${stub.port}/v1/messages`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'stub', stream: false, tools: [{ name: 'Bash' }] }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.equal((await post()).content[0].text, 'first local reply');
  assert.equal((await post()).content[0].text, 'second local reply');
  await stub.stop();
  assert.ok(readdirSync(join(runDir, 'requests')).filter((file) => file.includes('POST_v1_messages')).length >= 2);
});

test('selection run shares the print-mode driver and emits verdict-compatible recorder evidence', (t) => {
  // Break caught: a second selection-only session driver can drift from the reusable live-probe path.
  const dir = scratch(t);
  const fake = join(dir, 'fake-claude.mjs');
  writeFileSync(fake, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
if (process.argv.includes('--version')) { console.log('9.9.9-fake'); process.exit(0); }
const settings = JSON.parse(readFileSync(join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8'));
for (const event of ['SessionStart', 'Stop']) {
  for (const group of settings.hooks[event] ?? []) for (const hook of group.hooks) {
    const payload = JSON.stringify({ session_id: 'fake-session', hook_event_name: event, source: 'startup', cwd: process.cwd() });
    const result = spawnSync('/bin/sh', ['-c', hook.command], { input: payload, env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: 'utf8' });
    if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
  }
}
process.stdout.write(JSON.stringify({ session_id: 'fake-session' }));
`, { mode: 0o755 });
  const settings = join(dir, 'source.json');
  writeFileSync(settings, JSON.stringify({ hooks: {
    SessionStart: [{ matcher: 'startup|resume', hooks: [{ type: 'command', command: '/bin/native-start', timeout: 600 }] }],
    Stop: [{ hooks: [{ type: 'command', command: '/bin/native-stop', timeout: 600 }] }],
  } }));
  const runDir = join(dir, 'run');
  const env = childEnv(dir);
  const run = spawnSync(process.execPath, [selection, 'run', '--settings', settings, '--output', runDir,
    '--side', 'baseline', '--mode', 'print', '--claude', fake], { encoding: 'utf8', env, timeout: 30000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(readFileSync(join(runDir, 'claude-version.txt'), 'utf8').trim(), '9.9.9-fake');
  const verdict = spawnSync(process.execPath, [selection, 'verdict', runDir], { encoding: 'utf8', env });
  assert.equal(verdict.status, 0, verdict.stderr || verdict.stdout);
  assert.match(verdict.stdout, /SessionStart .*PASS/);
  assert.match(verdict.stdout, /Stop .*PASS/);
});
