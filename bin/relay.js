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
  if (!nativeEvent || nativeEvent.startsWith('--') || (options.length !== 0 && (options.length !== 2 || options[0] !== '--outer-ms'))) {
    throw usage('hook requires [--outer-ms N] then exactly one EVENT');
  }
  return { harness: name, ...(options.length ? { outerMs: readOuter(options[1]) } : {}), nativeEvent };
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
