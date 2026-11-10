import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { main } from '../bin/relay.js';
import { whoami } from '../src/identity/whoami.js';
import { whoamiCase } from './helpers/whoami-cases.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/whoami.json', import.meta.url), 'utf8'));
const named = name => cases.find(item => item.name === name);
async function run(args, resolve) {
  let stdout = '', stderr = '';
  const out = new Writable({ write(chunk, encoding, done) { stdout += chunk; done(); } });
  const err = new Writable({ write(chunk, encoding, done) { stderr += chunk; done(); } });
  const code = await main(['whoami', ...args], { whoami: resolve, stdout: out, stderr: err });
  return { code, stdout, stderr };
}
const real = item => () => whoami(whoamiCase(item.inputs).options);

test('json resolved preserves the result', async () => {
  const result = await real(named('nearest harness hint agrees'))();
  const r = await run(['--json'], async () => result);
  assert.equal(r.code, 0);
  assert.equal(result.status, 'resolved');
  assert.equal(r.stdout, `${JSON.stringify(result)}\n`);
  assert.equal(r.stderr, '');
});

test('json failed writes stdout evidence and stderr envelope', async () => {
  const evidence = { native: {}, nativeSource: 'decoded', nativeSession: true };
  const r = await run(['--json'], async () => { throw Object.assign(new Error('cannot read ancestry'), { code: 'PROCESS_UNREADABLE', ...evidence }); });
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.stdout), { schema: 1, status: 'failed', code: 'PROCESS_UNREADABLE', message: 'cannot read ancestry', ...evidence });
  assert.deepEqual(JSON.parse(r.stderr), { error: { kind: 'whoami_failed', detail: 'PROCESS_UNREADABLE: cannot read ancestry' } });
});

test('pretty lines and ordinary native-matching agent ids', async () => {
  for (const [name, expected] of [
    ['nearest harness hint agrees', /^resolved claude-code:c1 \(claude-code, .*\)\n$/],
    ['outside to init', /^outside\n$/],
    ['empty registry', /^unresolved codex NOT_REGISTERED: .*\n$/],
  ]) {
    const r = await run(['--pretty'], real(named(name)));
    assert.equal(r.code, 0, name);
    assert.match(r.stdout, expected, name);
    assert.equal(r.stderr, '');
  }
});

test('usage errors reject arguments without resolving', async () => {
  for (const args of [['extra'], ['--bogus']]) {
    const r = await run([...args, '--json'], () => { assert.fail('must not resolve'); });
    assert.equal(r.code, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /whoami takes no arguments/);
  }
});

test('human output contains no input control characters for every status', async () => {
  const controlled = structuredClone(named('nearest harness hint agrees'));
  controlled.inputs.environ.CLAUDE_CODE_SESSION_ID = 'c1\tx';
  for (const agent of Object.values(controlled.inputs.snapshot.agents)) {
    agent.sessionId = 'c1\tx'; agent.id = 'claude-code:c1\tx'; agent.project = 'project\u0085name';
  }
  const resolved = await run(['--pretty'], real(controlled));
  assert.equal(resolved.code, 0);
  assert.match(resolved.stdout, /^resolved \[control characters\] \(claude-code, \[control characters\]\)\n$/);
  const outputs = [resolved, await run(['--pretty'], real(named('outside to init'))),
    await run(['--pretty'], async () => ({ status: 'unresolved', harness: 'codex\t', code: 'CODE\t', message: 'message\t' })),
    await run(['--pretty'], async () => { throw Object.assign(new Error('message\t'), { code: 'CODE\t' }); }),
    await run(['--json'], async () => { throw Object.assign(new Error('message\t'), { code: 'CODE\t' }); })];
  for (const r of outputs) {
    assert.doesNotMatch(r.stderr.replace(/\n$/, ''), /\p{Cc}/u);
    if (r.stdout && !r.stdout.startsWith('{')) assert.doesNotMatch(r.stdout.replace(/\n$/, ''), /\p{Cc}/u);
  }
  assert.equal(outputs[3].stdout, '');
  assert.equal(outputs[3].stderr, 'relay: [control characters]: [control characters]\n');
});

test('environment unreadable through the CLI retains decoded native evidence', async () => {
  const { options } = whoamiCase(named('nearest harness hint agrees').inputs);
  options.env = { CODEX_THREAD_ID: 'thread' };
  options.readRaw = () => { throw new Error('unreadable'); };
  const r = await run(['--json'], () => whoami(options));
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'failed');
  assert.equal(JSON.parse(r.stdout).code, 'ENVIRONMENT_UNREADABLE');
  assert.equal(JSON.parse(r.stdout).nativeSource, 'decoded');
  assert.equal(JSON.parse(r.stdout).nativeSession, true);
  assert.deepEqual(JSON.parse(r.stdout).native.CODEX_THREAD_ID, { state: 'present', value: 'thread' });
  assert.equal(JSON.parse(r.stderr).error.kind, 'whoami_failed');
});

test('outside ignores corrupt registry', { skip: process.platform !== 'linux' ? 'setsid ancestry probe requires Linux' : false }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-whoami-'));
  writeFileSync(join(dir, 'agents.json'), 'corrupt');
  const output = join(dir, 'stdout'), receipt = join(dir, 'receipt.json'), pidFile = join(dir, 'pid');
  const cleanup = () => {
    if (!existsSync(pidFile) || existsSync(receipt)) return;
    try { process.kill(-Number(readFileSync(pidFile, 'utf8')), 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const stop = () => { cleanup(); process.exit(1); };
  process.once('exit', cleanup);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  t.after(() => {
    cleanup();
    process.off('exit', cleanup); process.off('SIGTERM', stop); process.off('SIGINT', stop);
    rmSync(dir, { recursive: true, force: true });
  });
  // The detached probe records the ancestry after setsid's parent has exited.
  const script = `
    import { writeFileSync, openSync, closeSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    import { createProcessOps } from ${JSON.stringify(new URL('../src/bus/proc.js', import.meta.url).href)};
    import { harnessWalk } from ${JSON.stringify(new URL('../src/identity/walk.js', import.meta.url).href)};
    writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
    setTimeout(() => {
      const processOps = createProcessOps(), chain = [], original = processOps.recordOf;
      processOps.recordOf = pid => { const row = original(pid); chain.push(row); return row; };
      const walk = harnessWalk({ processOps });
      const fd = openSync(${JSON.stringify(output)}, 'w');
      const result = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(new URL('../bin/relay.js', import.meta.url).pathname)}, 'whoami', '--json'], {
        env: { PATH: process.env.PATH, HOME: process.env.HOME, RELAY_STATE_DIR: process.env.RELAY_STATE_DIR },
        stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', timeout: 5000,
      });
      closeSync(fd);
      writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ walk, chain, code: result.status, stderr: result.stderr }));
    }, 50);
  `;
  const launch = spawnSync('setsid', ['-f', process.execPath, '--input-type=module', '-e', script], {
    env: { PATH: process.env.PATH, HOME: dir, RELAY_STATE_DIR: dir }, stdio: 'ignore', timeout: 5000,
  });
  assert.equal(launch.status, 0);
  const deadline = Date.now() + 7000;
  while (!existsSync(receipt) && Date.now() < deadline) await setTimeout(20);
  assert.ok(existsSync(receipt), 'detached probe must finish');
  const result = JSON.parse(readFileSync(receipt, 'utf8'));
  if (result.walk.kind === 'boundary') {
    assert.ok(result.walk.harness, 'skip requires recorded harness boundary');
    t.skip(`recorded chain contains ${result.walk.harness}: ${JSON.stringify(result.chain)}`); return;
  }
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).status, 'outside');
});
