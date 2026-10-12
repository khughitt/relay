#!/usr/bin/env node
// Live probes for the Claude terminal question route (spec §2 P1-P3, §11). Usage:
//   node tools/answer-probe/run.mjs --out DIR [--only NAME]
// Each scenario starts an interactive Claude session in a private tmux server with a scratch
// --settings file, records hook events and pane captures under DIR/<scenario>/, and prints a
// summary. Verdicts are written by the person or agent reading the summary (runbook).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const name = args[i], value = args[i + 1];
  if (!['--out', '--only'].includes(name) || Object.hasOwn(options, name)) throw new Error(`invalid or repeated flag ${JSON.stringify(name)}`);
  if (!value?.trim() || value.startsWith('-')) throw new Error(`${name} requires a non-empty value`);
  options[name] = value;
}
const only = options['--only'];
const hook = fileURLToPath(new URL('./hook.mjs', import.meta.url)), node = process.execPath;
const SOCKET = 'relay-probe';
const tmux = (...a) => execFileSync('tmux', ['-L', SOCKET, ...a], { encoding: 'utf8' });
const owned = new Set();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
const track = () => {
  const result = spawnSync('tmux', ['-L', SOCKET, 'list-panes', '-a', '-F', '#{pane_pid}'], { encoding: 'utf8' });
  if (result.status === 0) for (const pid of result.stdout.trim().split('\n')) owned.add(Number(pid));
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
  let changed;
  do { changed = false; for (const [pid, parent] of rows) if (owned.has(parent) && !owned.has(pid)) { owned.add(pid); changed = true; } } while (changed);
};
const cleanup = () => {
  track();
  spawnSync('tmux', ['-L', SOCKET, 'kill-server'], { stdio: 'ignore' });
  for (const pid of owned) if (alive(pid)) { try { process.kill(pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  for (const pid of owned) if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROMPT = 'Use the AskUserQuestion tool to ask me exactly one question: which shape do I prefer, with the two options Circle and Square. After I answer, reply with exactly CHOSEN=<the label I chose> and nothing else.';
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const entry = (mode, seconds, log, timeout = 86400) => ({ type: 'command', command: [node, hook, mode, seconds, log].map(quote).join(' '), timeout });
const scenarios = {
  // answer-hook-terminal and P2 (hook-supplied answer).
  'hook-answer': (log) => ({ PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('answer', 30, log)] }], PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('post-log', 0, log, 10)] }] }),
  // answer-hook-deny-stops.
  'deny': (log) => ({ PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('deny', 5, log)] }], PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('post-log', 0, log, 10)] }] }),
  // P1 and P2 (native answer after a release).
  'release': (log) => ({ PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('release', 120, log)] }], PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('post-log', 0, log, 10)] }] }),
  // P3: a fast deny beside a blocking hook.
  'under-denial': (log) => ({ PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('deny', 0, log), entry('answer', 120, log)] }], PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [entry('post-log', 0, log, 10)] }] }),
};
const capture = (name) => tmux('capture-pane', '-p', '-t', name, '-S', '-200');
async function until(check, ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) { track(); if (check()) return true; await sleep(1000); }
  return false;
}
async function waitFor(name, pattern, ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) { track(); const pane = capture(name); if (pattern.test(pane)) return pane; await sleep(1000); }
  return null;
}
const events = (log) => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
if (only !== undefined && !Object.hasOwn(scenarios, only)) throw new Error(`unknown scenario ${only}`);
const out = resolve(options['--out'] ?? mkdtempSync(join(tmpdir(), 'answer-probe-')));
if (spawnSync('tmux', ['-L', SOCKET, 'list-sessions'], { stdio: 'ignore' }).status === 0) throw new Error('relay-probe tmux server already exists; refusing to reuse it');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup(); process.exit(130); });
process.on('exit', cleanup);
const version = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim().split(/\s+/)[0];
const summary = { version, out, scenarios: {} };
mkdirSync(out, { recursive: true, mode: 0o700 });
const save = (file, value) => writeFileSync(file, value, { mode: 0o600 });
for (const [name, settingsFor] of Object.entries(scenarios)) {
  if (only !== undefined && only !== name) continue;
  const dir = join(out, name), ws = join(dir, 'ws'), log = join(dir, 'hook.log');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  mkdirSync(ws, { mode: 0o700 });
  save(join(dir, 'settings.json'), JSON.stringify({ hooks: settingsFor(log) }, null, 2));
  const started = Date.now();
  tmux('new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', ws, `exec claude --settings ${quote(join(dir, 'settings.json'))} ${quote(PROMPT)}`);
  if (await waitFor(name, /Yes, I trust|trust this folder/i, 15000)) tmux('send-keys', '-t', name, 'Enter');
  save(join(dir, 'startup-pane.txt'), capture(name));
  if (!await until(() => events(log).some((e) => e.event === 'fired'), 60000)) {
    save(join(dir, 'pane.txt'), capture(name));
    throw new Error(`${name}: hook never fired; inspect startup-pane.txt and pane.txt for readiness, trust or auth`);
  }
  const keys = [];
  let nativeAt = null;
  if (name === 'release') {
    // The prompt itself names Circle and Square, so wait for the hook's release first, then for
    // the native option list: "2. Square" appears only there. Try the key sequences in turn until
    // PostToolUse fires, and record every key sent.
    const answered = () => events(log).some((e) => e.event === 'fired' && e.hook === 'PostToolUse');
    if (await until(() => events(log).some((e) => e.event === 'return'), 200000)) {
      for (const attempt of [['Down', 'Enter'], ['2'], ['Enter']]) {
        if (answered() || !await waitFor(name, /\b2\.\s+Square/, 20000)) break;
        nativeAt ??= Date.now();
        save(join(dir, 'native-pane.txt'), capture(name));
        for (const key of attempt) { tmux('send-keys', '-t', name, key); keys.push(key); await sleep(500); }
        if (await waitFor(name, /Submit|Review your answers/i, 3000)) { tmux('send-keys', '-t', name, 'Enter'); keys.push('Enter'); }
        await until(answered, 10000);
      }
    }
  }
  const finished = await waitFor(name, /CHOSEN=(?:Circle|Square)\b/, name === 'deny' ? 60000 : 260000);
  await sleep(name === 'deny' ? 60000 : 5000); // deny: watch for a re-ask
  const pane = capture(name);
  save(join(dir, 'pane.txt'), pane);
  summary.scenarios[name] = { startedAt: started, finishedAt: Date.now(), nativeAt, chosen: /CHOSEN=(Circle|Square)\b/.exec(finished ?? pane)?.[1] ?? null, keys, events: events(log) };
  track();
  tmux('kill-session', '-t', name);
  save(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
}
cleanup();
await sleep(500);
summary.cleanup = { pids: [...owned], survivors: [...owned].filter(alive), tmuxRunning: spawnSync('tmux', ['-L', SOCKET, 'list-sessions'], { stdio: 'ignore' }).status === 0 };
save(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
