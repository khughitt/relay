#!/usr/bin/env node
import { realpathSync, readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listAgents } from '../src/index.js';
import { dispatchHook, reconcile } from '../src/dispatch.js';
import { relayError } from '../src/protocol.js';
const HELP = 'Usage: relay --help | list --json | reap [--outer-ms N] | hook --harness NAME [--outer-ms N] [--subscribers FILE] EVENT | install --harness NAME --subscribers FILE [--target FILE|--config-dir DIR] [--evidence FILE] [--retire familiar] [--artifact FILE --apply] | rollback --artifact FILE\n';
const usage = (message) => relayError('USAGE', message);
// Strict flag parsing: --harness NAME (hook only), --outer-ms N, --subscribers FILE, then exactly one EVENT for hook.
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
const flags = args => {
  const out = {}; for (let i = 0; i < args.length; i++) {
    const key = args[i]; if (!key.startsWith('--') || Object.hasOwn(out, key)) throw usage('invalid or repeated installer flag');
    if (key === '--apply') { out[key] = true; continue; }
    const value = args[++i]; if (!value || value.startsWith('--')) throw usage(`${key} requires a value`); out[key] = value;
  } return out;
};
export async function main(args, { list = listAgents, reap = reconcile, hook = dispatchHook, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  const json = args[0] === 'list' && args.includes('--json');
  try {
    if (args.length === 1 && args[0] === '--help') { await emit(stdout, HELP); return 0; }
    if (args.length === 2 && args[0] === 'list' && args[1] === '--json') { await emit(stdout, `${JSON.stringify(await list())}\n`); return 0; }
    if (args[0] === 'reap') {
      const { result, diagnostics } = await reap(parse(args.slice(1), { harness: false }));
      await emit(stdout, `Reaped ${result.reaped.length} agent(s).\n`);
      await emit(stderr, [...result.diagnostics.map((d) => `${d.code}: ${d.message}`), ...diagnostics].map((l) => `${l}\n`).join(''));
      return result.diagnostics.some((d) => ['LOCK_CLEANUP_FAILED', 'LOCK_OWNERSHIP_LOST'].includes(d.code)) ? 1 : 0;
    }
    if (args[0] === 'hook') {
      const request = parse(args.slice(1), { harness: true });
      const r = await hook({ ...request, input: stdin });
      await emit(stdout, r.stdout); await emit(stderr, r.stderr);
      return r.exitCode;
    }
    if (args[0] === 'install') {
      const f = flags(args.slice(1)), harness = f['--harness'];
      if (!harness || !f['--subscribers'] || f['--retire'] && f['--retire'] !== 'familiar' || f['--apply'] && !f['--artifact']) throw usage('install requires --harness, --subscribers, and --artifact with --apply');
      if (!['claude-code', 'codex', 'opencode'].includes(harness)
        || harness === 'opencode' && (!f['--config-dir'] || f['--target'])
        || harness !== 'opencode' && (!f['--target'] || f['--config-dir'])) throw usage('install target does not match harness');
      const { validateSubscribers } = await import('../src/subscribers.js'), subscribers = validateSubscribers(JSON.parse(readFileSync(f['--subscribers'], 'utf8')));
      const evidence = f['--evidence'] ? (await import('../src/install/capabilities.js')).parseEvidence(readFileSync(f['--evidence'], 'utf8')) : null;
      const relayBin = realpathSync(process.argv[1]); let artifact;
      if (harness === 'claude-code') artifact = (await import('../src/install/claude-code.js')).planClaudeCode({ target: f['--target'], text: readFileSync(f['--target'], 'utf8'), relayBin, subscribers, evidence, retireFamiliar: f['--retire'] });
      else if (harness === 'codex') artifact = (await import('../src/install/codex.js')).planCodex({ target: f['--target'], text: readFileSync(f['--target'], 'utf8'), relayBin, subscribers, evidence, retireFamiliar: f['--retire'] });
      else { const dir = f['--config-dir'], read = name => { const path = join(dir, name); return existsSync(path) ? readFileSync(path, 'utf8') : null; }; artifact = (await import('../src/install/opencode.js')).planOpenCode({ configDir: dir, json: read('opencode.json'), jsonc: read('opencode.jsonc'), relayPlugin: new URL('../integrations/opencode/plugin.js', import.meta.url).pathname, subscribers }); }
      if (f['--apply']) (await import('../src/install/atomic.js')).applyArtifact(f['--artifact'], artifact);
      await emit(stdout, `${JSON.stringify(artifact)}\n`); return 0;
    }
    if (args[0] === 'rollback') {
      const f = flags(args.slice(1)); if (!f['--artifact'] || Object.keys(f).length !== 1) throw usage('rollback requires only --artifact FILE');
      (await import('../src/install/atomic.js')).rollbackArtifact(JSON.parse(readFileSync(f['--artifact'], 'utf8'))); return 0;
    }
    throw usage('expected --help, list --json, reap, or hook');
  } catch (error) {
    const code = error.code ?? 'IO_ERROR', message = error.code ? error.message : 'registry operation failed';
    if (json) await emit(stdout, `${JSON.stringify({ error: { code, message } })}\n`);
    else await emit(stderr, `${code}: ${message}\n`);
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exit(await main(process.argv.slice(2)));
