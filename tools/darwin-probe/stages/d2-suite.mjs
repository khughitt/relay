import { cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export function parseTap(text) {
  const n = (k) => Number(new RegExp(`^# ${k} (\\d+)$`, 'm').exec(text)?.[1] ?? NaN);
  const failures = [...text.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), todo: n('todo'), failures };
}
export async function run(ctx) {
  // The clone's one runtime dependency comes from D1's installed package, checked against the lock.
  const lock = JSON.parse(readFileSync(join(ctx.clone, 'package-lock.json'), 'utf8')).packages['node_modules/jsonc-parser'].version;
  const from = join(ctx.consumer, 'node_modules/relay/node_modules/jsonc-parser');
  const have = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')).version;
  if (have !== lock) return { status: 'error', reason: `jsonc-parser ${have} does not match the lock's ${lock}`, observations: {} };
  cpSync(from, join(ctx.clone, 'node_modules/jsonc-parser'), { recursive: true });
  const files = ['test/*.test.js', 'integrations/opencode/*.test.mjs'];
  const r = await ctx.t.run('/bin/sh', ['-c', `exec node --test --test-reporter=tap ${files.join(' ')}`], { cwd: ctx.clone, env: ctx.env, timeoutMs: 900000 });
  ctx.log(r.stdout); ctx.log(r.stderr);
  const summary = parseTap(r.stdout);
  return { status: 'ran', observations: { exit: r.exit, summary: { tests: summary.tests, pass: summary.pass, fail: summary.fail, skipped: summary.skipped, todo: summary.todo }, failures: summary.failures } };
}
