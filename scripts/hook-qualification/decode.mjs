// @ts-check
// Rebuild and decode the exact synthetic inputs timed by run.mjs for latency-support evidence.
//
//   node decode.mjs --candidate CHECKOUT --workload FILE MANIFEST_SET...
//
// A manifest's fixture is resolved relative to its set file, exactly as the runner resolves it.
// The JSON report keeps decoded status objects (including invalid fields) intact for the row evidence.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildTimedInput } from './run.mjs';

function requireThat(ok, message) { if (!ok) throw new Error(message); }

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    candidate: { type: 'string' }, workload: { type: 'string' },
  } });
  requireThat(values.candidate && values.workload && positionals.length > 0,
    'usage: node decode.mjs --candidate CHECKOUT --workload FILE (MANIFEST_SET[=ORIGINAL_FIXTURE])...');
  const candidate = resolve(values.candidate);
  const workload = JSON.parse(readFileSync(resolve(values.workload), 'utf8'));
  const payloadBytes = workload.qualification.payloadBytes;
  requireThat(Number.isSafeInteger(payloadBytes) && payloadBytes > 0, 'the workload needs a positive qualification.payloadBytes');
  const { normalizeHookEvent } = await import(pathToFileURL(join(candidate, 'src/adapters/hook-event.js')).href);
  const results = [];
  let failed = false;
  for (const argument of positionals) {
    const separator = argument.indexOf('=');
    const file = resolve(separator < 0 ? argument : argument.slice(0, separator));
    const originalFixture = separator < 0 ? null : argument.slice(separator + 1);
    requireThat(originalFixture === null || originalFixture.length > 0, `${argument}: the original fixture path is empty`);
    const set = JSON.parse(readFileSync(file, 'utf8'));
    const manifests = set.manifests ?? [set];
    requireThat(Array.isArray(manifests) && manifests.length > 0, `${file}: the manifest set names no routes`);
    for (const manifest of manifests) {
      const fixture = originalFixture === null ? resolve(dirname(file), manifest.fixture) : resolve(originalFixture);
      const built = buildTimedInput(manifest, { fixture, payloadBytes });
      const result = {
        host: manifest.host ?? set.host, event: manifest.event, cwd: built.cwd,
        bytes: Buffer.byteLength(built.input), padField: built.padField, paddedBytes: built.paddedBytes,
      };
      try {
        const event = normalizeHookEvent(manifest.harness, manifest.event, built.input, { invokingCwd: built.cwd });
        result.decoded = { kind: event.kind, cwd: event.cwd, identity: event.identity, facts: event.facts, private: event.private };
      } catch (error) {
        failed = true;
        result.decoded = { error: { code: error.code ?? null, message: error.message } };
      }
      results.push(result);
    }
  }
  process.stdout.write(`${JSON.stringify({ schema: 1, results }, null, 2)}\n`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { process.stderr.write(`decode.mjs: ${error.message}\n`); process.exitCode = 2; }
}
