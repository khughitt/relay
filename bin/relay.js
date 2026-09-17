#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { listAgents } from '../src/index.js';
import { dispatchHook, reconcile } from '../src/dispatch.js';
import { relayError } from '../src/protocol.js';
const HELP = 'Usage: relay --help | list --json | reap [--outer-ms N] | hook --harness NAME [--outer-ms N] EVENT\nInstallation is not available.\n';
const usage = (message) => relayError('USAGE', message);
// Strict flag parsing: --harness NAME (hook only), --outer-ms N, then exactly one EVENT for hook.
function parse(args, { harness }) {
  const out = {}, rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--outer-ms' || (harness && args[i] === '--harness')) {
      const key = args[i] === '--harness' ? 'harness' : 'outerMs';
      if (i + 1 >= args.length || Object.hasOwn(out, key)) throw usage(`${args[i]} needs one value`);
      out[key] = args[i + 1]; i += 1;
    } else rest.push(args[i]);
  }
  if (Object.hasOwn(out, 'outerMs')) { if (!/^[1-9][0-9]*$/.test(out.outerMs)) throw usage('--outer-ms must be a positive integer'); out.outerMs = Number(out.outerMs); }
  if (harness) { if (!out.harness) throw usage('hook requires --harness NAME'); if (rest.length !== 1) throw usage('hook requires exactly one EVENT'); out.nativeEvent = rest[0]; }
  else if (rest.length) throw usage('reap takes only --outer-ms');
  return out;
}
// Every write is awaited so the reply is flushed before the explicit exit below; pipes are
// asynchronous on Darwin, and a pending filesystem operation would otherwise keep the
// process alive past the harness's outer timeout.
const emit = (stream, text) => new Promise((resolve) => (text ? stream.write(text, () => resolve()) : resolve()));
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
    if (args[0] === 'install') throw relayError('FEATURE_UNAVAILABLE', 'installation is not available before relay-baa816');
    throw usage('expected --help, list --json, reap, or hook');
  } catch (error) {
    const code = error.code ?? 'IO_ERROR', message = error.code ? error.message : 'registry operation failed';
    if (json) await emit(stdout, `${JSON.stringify({ error: { code, message } })}\n`);
    else await emit(stderr, `${code}: ${message}\n`);
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exit(await main(process.argv.slice(2)));
