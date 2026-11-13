#!/usr/bin/env node
// Scripted subscriber for dispatch tests. argv[2] selects the behavior; argv[3] is an optional file path (for hang, the required test marker). It reads stdin to EOF first, as a real subscriber must.
import { writeFileSync } from 'node:fs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = Buffer.concat(chunks).toString('utf8');
const [mode, file] = process.argv.slice(2);
const out = (value) => process.stdout.write(JSON.stringify(value));
switch (mode) {
  case 'allow': out({ decision: 'allow' }); break;
  case 'deny': out({ decision: 'deny', reason: 'denied by fixture' }); break;
  case 'deny-context': out({ decision: 'deny', reason: 'denied by fixture', context: 'dropped' }); break;
  case 'context': out({ decision: 'allow', context: `context from ${file ?? 'fixture'}` }); break;
  case 'big-context': out({ decision: 'allow', context: 'x'.repeat(20000) }); break;
  case 'huge-field': out({ decision: 'allow', ['x'.repeat(60000)]: 1 }); break;
  case 'big': process.stdout.write('x'.repeat(70000)); break;
  case 'garbage': process.stdout.write('not json'); break;
  case 'extra-field': out({ decision: 'allow', extra: 1 }); break;
  case 'unreasoned': out({ decision: 'deny' }); break;
  case 'crash': process.stderr.write('fixture crashed\n'); process.exit(3); break;
  // A hang must carry a survivors.js marker (argv[3]) so the test that spawned it can find and reap it.
  case 'hang': if (!file?.startsWith('relay-test-')) process.exit(9); setInterval(() => {}, 60000); break;
  case 'slow': await new Promise((resolve) => setTimeout(resolve, Number(file))); out({ decision: 'allow' }); break;
  case 'record': writeFileSync(file, input); out({ decision: 'allow' }); break;
  case 'env': writeFileSync(file, process.env.RELAY_TEST_MARKER ?? ''); out({ decision: 'allow' }); break;
  case 'argv': writeFileSync(file, JSON.stringify({ argv: process.argv.slice(4), cwd: process.cwd(), path: process.env.PATH })); out({ decision: 'allow' }); break;
  case 'notice': out({ context: `notice from ${file ?? 'fixture'}` }); break;
  case 'notice-empty': out({}); break;
  case 'notice-long': out({ context: 'n'.repeat(Number(file)) }); break;
  case 'notice-deny': out({ decision: 'deny', reason: 'a notice cannot deny' }); break;
  case 'notice-extra': out({ context: 'x', extra: 1 }); break;
  case 'notice-blank': out({ context: '' }); break;
  // Echoes its private input to stderr and replies with malformed stdout carrying it too.
  case 'echo-private': process.stderr.write(`ECHO ${input}\n`); process.stdout.write(`not json ${input}`); break;
  case 'echo-private-field': process.stderr.write(`ECHO ${input}\n`); out({ decision: 'allow', [`leak ${input.slice(0, 40)}`]: 1 }); break;
  case 'noisy': process.stderr.write('observer noise\n'); out({ decision: 'deny', reason: 'observer output must be ignored' }); break;
  default: process.exit(9);
}
