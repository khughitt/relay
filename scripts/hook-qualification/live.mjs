// @ts-check
// Shared live-harness driver for qualification probes. Real harnesses use private homes, a loopback
// stub model, bounded waits and owned cleanup; this module never reads or changes live host hooks.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STUB = join(fileURLToPath(new URL('.', import.meta.url)), 'stub-model.mjs');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
function requireThat(ok, message) { if (!ok) throw new Error(message); }

export function liveEnvironment({ home, port, path = '/usr/bin:/bin', terminal = false }) {
  return {
    PATH: path, HOME: home, ...(terminal ? { TERM: 'xterm-256color' } : {}), LANG: 'C.UTF-8',
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    XDG_STATE_HOME: join(home, '.local/state'), XDG_CONFIG_HOME: join(home, '.config'),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: 'sk-ant-stub-0000000000000000',
    DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1',
  };
}

export async function startStubModel({ runDir, replies, stubModule = STUB, readyTimeoutMs = 5000 }) {
  const root = resolve(runDir), requests = join(root, 'requests');
  mkdirSync(requests, { recursive: true, mode: 0o700 });
  const script = join(root, 'script.json');
  writeFileSync(script, `${JSON.stringify(replies, null, 2)}\n`, { mode: 0o600 });
  const child = spawn(process.execPath, [stubModule, '0', requests, script], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { PATH: '/usr/bin:/bin', HOME: root, LANG: 'C.UTF-8' },
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })));
  let stopResolved;
  const stopped = new Promise((done) => { stopResolved = done; });
  const ready = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`stub did not listen: ${stderr || stdout}`)), readyTimeoutMs);
    child.stdout.on('data', () => {
      const match = /listening (\d+)/.exec(stdout);
      if (match) { clearTimeout(timer); resolveReady(Number(match[1])); }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`stub exited ${code}: ${stderr}`)); });
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) { stopResolved(); return stopped; }
    child.kill('SIGTERM');
    await Promise.race([exited, delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    stopResolved();
    return stopped;
  };
  try {
    return { port: await ready, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

function harnessPath(value) {
  if (value) return realpathSync(value);
  const found = spawnSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent' } });
  requireThat(found.status === 0 && found.stdout.trim(), 'claude is not on PATH; pass --claude PATH');
  return realpathSync(found.stdout.trim());
}

/** Run one startup session and one resumed session against a private Claude Code home. */
export async function runClaudeTurns({ runDir, mode, claude, label, replies, sleep = 0,
  firstPrompt = 'selection first', resumePrompt = 'selection resumed',
  firstAnswer = 'selection first turn done', resumedAnswer = 'selection resumed turn done',
  model = 'claude-haiku-5-5', timeoutMs = 120000 }) {
  requireThat(typeof label === 'string' && label.length > 0, 'runClaudeTurns needs a caller-supplied label');
  requireThat(Array.isArray(replies) && replies.length > 0, 'runClaudeTurns needs a caller-supplied stub reply program');
  const root = resolve(runDir), home = join(root, 'home'), work = join(root, 'work');
  const executable = harnessPath(claude);
  const stub = await startStubModel({ runDir: root, replies });
  const active = new Set();
  let aborted = null, tmuxCleanup = null;
  const abort = (signal) => {
    aborted ??= new Error(`live probe interrupted by ${signal}`);
    for (const child of active) child.kill('SIGKILL');
    if (tmuxCleanup) tmuxCleanup();
    void stub.stop();
  };
  const onInt = () => abort('SIGINT'), onTerm = () => abort('SIGTERM');
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);

  async function run(command, args, { cwd = work, env, timeout = timeoutMs } = {}) {
    requireThat(!aborted, aborted?.message);
    const child = spawn(command, args, { cwd, env, timeout, killSignal: 'SIGKILL' });
    active.add(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; requireThat(Buffer.byteLength(stdout) < 16 * 1024 * 1024, 'harness output exceeded 16 MiB'); });
    child.stderr.on('data', (chunk) => { stderr += chunk; requireThat(Buffer.byteLength(stderr) < 16 * 1024 * 1024, 'harness error output exceeded 16 MiB'); });
    const result = await new Promise((resolveResult, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolveResult({ code, signal, stdout, stderr }));
    });
    active.delete(child);
    requireThat(!aborted, aborted?.message);
    return result;
  }

  try {
    const configuration = { hasCompletedOnboarding: true, theme: 'dark', numStartups: 5,
      customApiKeyResponses: { approved: ['tub-0000000000000000'], rejected: [] },
      projects: { [work]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } };
    writeFileSync(join(home, '.claude/.claude.json'), JSON.stringify(configuration), { mode: 0o600 });
    writeFileSync(join(home, '.claude.json'), JSON.stringify(configuration), { mode: 0o600 });
    const env = liveEnvironment({ home, port: stub.port, terminal: mode === 'interactive' });
    const driver = (message) => writeFileSync(join(root, 'driver.log'), `${new Date().toISOString()} ${message}\n`, { flag: 'a', mode: 0o600 });
    const version = await run(executable, ['--version'], { env, timeout: 10000 });
    requireThat(version.code === 0, `claude --version failed: ${version.stderr}`);
    writeFileSync(join(root, 'claude-version.txt'), version.stdout, { mode: 0o600 });
    const common = ['--setting-sources', 'user', '--model', model];

    if (mode === 'print') {
      const printTurn = async (number, prompt, resume) => {
        const args = ['-p', ...common, ...(resume ? ['--resume', resume] : []), '--output-format', 'json',
          '--debug', 'hooks', '--debug-file', join(root, `debug-${number}.log`), prompt];
        const result = await run(executable, args, { env });
        writeFileSync(join(root, `result-${number}.json`), result.stdout, { mode: 0o600 });
        writeFileSync(join(root, `stderr-${number}.log`), result.stderr, { mode: 0o600 });
        driver(`print turn ${number} rc=${result.code ?? result.signal}`);
        requireThat(result.code === 0, `print turn ${number} failed; see stderr-${number}.log`);
        const output = JSON.parse(result.stdout);
        requireThat(typeof output.session_id === 'string', `print turn ${number} returned no session id`);
        return output.session_id;
      };
      const session = await printTurn(1, firstPrompt, null);
      await printTurn(2, resumePrompt, session);
    } else if (mode === 'interactive') {
      const socketDir = mkdtempSync(join(tmpdir(), 'rqs-')), socket = join(socketDir, 'tmux.sock'), session = label.replace(/[^A-Za-z0-9_-]/g, '-');
      const tmuxEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root, LANG: 'C.UTF-8' };
      const tmux = (args, timeout = 10000) => run('tmux', ['-S', socket, ...args], { cwd: root, env: tmuxEnv, timeout });
      tmuxCleanup = () => { spawnSync('tmux', ['-S', socket, 'kill-server'], { env: tmuxEnv }); };
      try {
        const pane = async () => (await tmux(['capture-pane', '-p', '-t', session])).stdout;
        const waitFor = async (description, predicate, limit = 60000) => {
          const deadline = Date.now() + limit;
          while (!aborted && Date.now() < deadline) {
            if (await predicate()) { driver(`ok: ${description}`); return; }
            await delay(250);
          }
          writeFileSync(join(root, `pane-timeout-${Date.now()}.txt`), await pane(), { mode: 0o600 });
          throw aborted ?? new Error(`timed out waiting for ${description}`);
        };
        const submit = async (text) => {
          await tmux(['send-keys', '-t', session, '-l', text]); await delay(400); await tmux(['send-keys', '-t', session, 'Enter']);
        };
        const round = async (prompt, answer, resume, number) => {
          const args = [common, '--permission-mode', 'default', ...(resume ? ['--resume', resume] : []),
            '--debug', 'hooks', '--debug-file', join(root, `debug-${number}.log`)].flat();
          const command = ['env', '-i', ...Object.entries(env).map(([key, value]) => `${key}=${value}`), executable, ...args].map(quote).join(' ');
          const started = await tmux(['new-session', '-d', '-s', session, '-x', '200', '-y', '50', '-c', work, command]);
          requireThat(started.code === 0, `tmux new-session failed: ${started.stderr}`);
          await waitFor('prompt ready', async () => (await pane()).includes('for shortcuts'));
          await submit(prompt);
          await waitFor('turn reply', async () => (await pane()).includes(answer));
          await delay(Math.round(sleep * 1000) + 4000);
          await submit('/exit');
          await waitFor('session exit', async () => (await tmux(['has-session', '-t', session])).code !== 0);
        };
        await round(firstPrompt, firstAnswer, null, 1);
        const projects = readdirSync(join(home, '.claude/projects'), { recursive: true, withFileTypes: true });
        const transcripts = projects.filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.jsonl$/.test(entry.name));
        requireThat(transcripts.length === 1, `expected one interactive transcript, found ${transcripts.length}`);
        await round(resumePrompt, resumedAnswer, transcripts[0].name.slice(0, -6), 2);
      } finally {
        tmuxCleanup(); tmuxCleanup = null;
        rmSync(socketDir, { recursive: true, force: true });
      }
    } else {
      throw new Error(`unknown mode ${mode}`);
    }
    driver('done');
    return { runDir: root, mode, label, claude: executable, version: readFileSync(join(root, 'claude-version.txt'), 'utf8').trim() };
  } finally {
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
    if (tmuxCleanup) tmuxCleanup();
    for (const child of active) child.kill('SIGKILL');
    await stub.stop();
  }
}
