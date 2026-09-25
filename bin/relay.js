#!/usr/bin/env node
import { realpathSync, readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listAgents } from '../src/index.js';
import { dispatchHook, reconcile } from '../src/dispatch.js';
import { relayError } from '../src/protocol.js';
import { HARNESSES, commandAt, stripGlobals, resolveMode, helpText, rootHelp } from '../src/commands.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const usage = (message) => relayError('USAGE', message);
const hasHelp = (args) => args.includes('--help') || args.includes('-h');

// Strict flag parsing: --harness NAME (hook only), --outer-ms N, --subscribers FILE, then exactly one EVENT for hook.
// Order rules are unchanged; names and values are now checked against the declared table.
function parse(args, { harness }) {
  const readOuter = (value) => {
    if (!/^[1-9][0-9]*$/.test(value ?? '')) throw usage('--outer-ms must be a positive integer');
    return Number(value);
  };
  if (!harness) {
    if (args.length === 0) return {};
    if (args.length !== 2 || args[0] !== '--outer-ms') throw usage('reap takes only --outer-ms N');
    return { outerMs: readOuter(args[1]) };
  }
  const [flag, name, ...tail] = args, nativeEvent = tail.at(-1), options = tail.slice(0, -1);
  if (flag !== '--harness' || !name || name.startsWith('--')) throw usage('hook requires --harness NAME first');
  if (!HARNESSES.includes(name)) throw usage(`--harness must be one of ${HARNESSES.join(', ')}, got ${JSON.stringify(name)}`);
  const order = () => usage('hook requires [--outer-ms N] [--subscribers FILE] then exactly one EVENT');
  if (!nativeEvent || nativeEvent.startsWith('--')) throw order();
  const request = { harness: name, nativeEvent };
  let i = 0;
  if (options[i] === '--outer-ms') { request.outerMs = readOuter(options[i + 1]); i += 2; }
  if (options[i] === '--subscribers') {
    const file = options[i + 1];
    if (!file || !isAbsolute(file)) throw usage('--subscribers requires an absolute path');
    request.subscribersPath = file; i += 2;
  }
  if (i !== options.length) throw order();
  return request;
}
// Every write is awaited so the reply is flushed before the explicit exit below; pipes are
// asynchronous on Darwin, and a pending filesystem operation would otherwise keep the
// process alive past the harness's outer timeout.
const emit = (stream, text) => new Promise((resolve) => (text ? stream.write(text, () => resolve()) : resolve()));
// Keyed flag parsing for install/rollback: any order, names and enum values checked against
// the command's declared options.
function flags(args, cmd) {
  const opts = cmd.options ?? [];
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    const opt = key.startsWith('--') ? opts.find((o) => o.names.includes(key)) : null;
    if (!opt || Object.hasOwn(out, key)) throw usage(`invalid or repeated ${cmd.path[0]} flag "${key}"`);
    if (opt.value === 'none') { out[key] = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw usage(`${key} requires a value`);
    if (opt.values && !opt.values.includes(value)) throw usage(`${key} must be one of ${opt.values.join(', ')}, got ${JSON.stringify(value)}`);
    out[key] = value;
  }
  return out;
}
export async function main(rawArgs, { list = listAgents, reap = reconcile, hook = dispatchHook, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  let mode = 'pretty', cmdName = null;
  try {
    const { argv, mode: flagMode } = stripGlobals(rawArgs, usage);

    if (argv.length === 1 && (argv[0] === '-V' || argv[0] === '--version')) { await emit(stdout, `relay ${version}\n`); return 0; }

    if (argv.length === 0) { await emit(stderr, `relay: a command is required\nRun 'relay --help' for help.\n`); return 2; }

    if (argv[0] === 'help') {
      const rest = argv.slice(1);
      if (rest.length === 0) { await emit(stdout, rootHelp()); return 0; }
      const target = rest.length === 1 ? commandAt(rest[0]) : null;
      if (!target) { await emit(stderr, `relay: unknown command "${rest.join(' ')}"\nRun 'relay --help' for help.\n`); return 2; }
      await emit(stdout, helpText(target)); return 0;
    }

    const cmd = commandAt(argv[0]);
    if (!cmd) {
      // --help/-h is only the root invocation when it IS the command position; an unknown
      // command word is never rescued by a --help that happens to follow it (`bogus --help`
      // is still an unknown command, not root help).
      if (argv[0] === '--help' || argv[0] === '-h') { await emit(stdout, rootHelp()); return 0; }
      await emit(stderr, `relay: unknown command "${argv[0]}"\nRun 'relay --help' for help.\n`);
      return 2;
    }
    cmdName = cmd.path[0];
    const rest = argv.slice(1);
    if (hasHelp(rest)) { await emit(stdout, helpText(cmd)); return 0; }

    const resolved = resolveMode(flagMode, process.env, cmd, usage);
    mode = resolved.mode;
    const { silent } = resolved;

    if (cmd.path[0] === 'list') {
      if (rest.length !== 0) throw usage('list takes no arguments');
      const r = await list();
      if (silent) return 0;
      if (mode === 'json') await emit(stdout, `${JSON.stringify(r)}\n`);
      else {
        const agents = Object.values(r.snapshot?.agents ?? {});
        await emit(stdout, agents.map((a) => `${a.id} ${a.harness} ${a.state}\n`).join(''));
      }
      return 0;
    }
    if (cmd.path[0] === 'reap') {
      const { result, diagnostics } = await reap(parse(rest, { harness: false }));
      if (!silent) {
        if (mode === 'json') await emit(stdout, `${JSON.stringify({ reaped: result.reaped.length })}\n`);
        else await emit(stdout, `Reaped ${result.reaped.length} agent(s).\n`);
      }
      await emit(stderr, [...result.diagnostics.map((d) => `${d.code}: ${d.message}`), ...diagnostics].map((l) => `${l}\n`).join(''));
      return result.diagnostics.some((d) => ['LOCK_CLEANUP_FAILED', 'LOCK_OWNERSHIP_LOST'].includes(d.code)) ? 1 : 0;
    }
    if (cmd.path[0] === 'hook') {
      // Protocol row: stdout is the harness reply, the exit code is the guard's. Untouched
      // beyond reading its option names from the table above.
      const request = parse(rest, { harness: true });
      const r = await hook({ ...request, input: stdin });
      await emit(stdout, r.stdout); await emit(stderr, r.stderr);
      return r.exitCode;
    }
    if (cmd.path[0] === 'install') {
      const f = flags(rest, cmd), harness = f['--harness'];
      if (!harness || !f['--subscribers'] || (f['--apply'] && !f['--artifact'])) throw usage('install requires --harness, --subscribers, and --artifact with --apply');
      if (harness === 'opencode' && (!f['--config-dir'] || f['--target'])
        || harness !== 'opencode' && (!f['--target'] || f['--config-dir'])) throw usage('install target does not match harness');
      const { loadSubscribersFrom } = await import('../src/subscribers.js');
      const subscribersPath = f['--subscribers'], subscribers = await loadSubscribersFrom(subscribersPath);
      const evidence = f['--evidence'] ? (await import('../src/install/capabilities.js')).parseEvidence(readFileSync(f['--evidence'], 'utf8')) : null;
      const relayBin = realpathSync(process.argv[1]); let artifact;
      if (harness === 'claude-code') artifact = (await import('../src/install/claude-code.js')).planClaudeCode({ target: f['--target'], text: readFileSync(f['--target'], 'utf8'), relayBin, nodeBin: process.execPath, subscribersPath, subscribers, evidence, retireFamiliar: f['--retire'] });
      else if (harness === 'codex') artifact = (await import('../src/install/codex.js')).planCodex({ target: f['--target'], text: readFileSync(f['--target'], 'utf8'), relayBin, nodeBin: process.execPath, subscribersPath, subscribers, evidence, retireFamiliar: f['--retire'] });
      else { const dir = f['--config-dir'], read = name => { const path = join(dir, name); return existsSync(path) ? readFileSync(path, 'utf8') : null; }; artifact = (await import('../src/install/opencode.js')).planOpenCode({ configDir: dir, json: read('opencode.json'), jsonc: read('opencode.jsonc'), relayPlugin: new URL('../integrations/opencode/plugin.js', import.meta.url).pathname, subscribers }); }
      if (f['--apply']) (await import('../src/install/atomic.js')).applyArtifact(f['--artifact'], artifact);
      if (!silent) {
        if (mode === 'json') await emit(stdout, `${JSON.stringify(artifact)}\n`);
        else await emit(stdout, `harness=${artifact.harness} changes=${artifact.changes.length}\n`);
      }
      return 0;
    }
    if (cmd.path[0] === 'rollback') {
      const f = flags(rest, cmd); if (!f['--artifact'] || Object.keys(f).length !== 1) throw usage('rollback requires only --artifact FILE');
      (await import('../src/install/atomic.js')).rollbackArtifact(JSON.parse(readFileSync(f['--artifact'], 'utf8')));
      return 0; // output = "none": nothing on success in any mode
    }
    throw usage(`unknown command "${cmd.path[0]}"`);
  } catch (error) {
    if (error.code === 'USAGE') { await emit(stderr, `relay: ${error.message}\n`); return 2; }
    const kind = `${cmdName ?? 'relay'}_failed`, detail = error.code ? `${error.code}: ${error.message}` : 'relay operation failed';
    if (mode === 'json') await emit(stderr, `${JSON.stringify({ error: { kind, detail } })}\n`);
    else await emit(stderr, `relay: ${detail}\n`);
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exit(await main(process.argv.slice(2)));
