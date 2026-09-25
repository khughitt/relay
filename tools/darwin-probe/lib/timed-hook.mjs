// timed-hook.mjs — runs relay hook steps from under a constructed parent and records timing
// and the registry before and after each step.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const planPath = process.argv[2], plan = JSON.parse(readFileSync(planPath, 'utf8'));
const relay = await import(pathToFileURL(join(plan.clone, 'src/index.js')).href);
const paths = relay.paths(process.env), readSnapshot = () => relay.readSnapshot({ paths });
for (const step of plan.steps) {
  const before = await readSnapshot(), started = performance.now();
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(plan.clone, 'bin/relay.js'), 'hook', '--harness', plan.harness,
      '--outer-ms', String(step.outerMs), '--subscribers', plan.subscribers, step.event], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.once('close', (exit) => resolve({ exit, stdout, stderr }));
    // A hook that fails before reading its input closes stdin; its exit and stderr are the evidence.
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') stderr += `stdin: ${error.message}\n`; });
    child.stdin.end(JSON.stringify(step.payload));
  });
  const ms = performance.now() - started, after = await readSnapshot();
  writeFileSync(step.out, JSON.stringify({ ms, ...r, before, after }));
}
writeFileSync(join(dirname(planPath), 'done'), '');
