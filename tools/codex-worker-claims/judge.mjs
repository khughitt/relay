#!/usr/bin/env node
// Judge a codex-worker-claims run from command results, tasks' claims and relay's rows,
// never from the transcript. Each scripted command ends `2>&1; echo exit=$?`, so its
// PostToolUse result carries tasks' error JSON (tasks writes errors to stderr) and its exit
// code. Exit 0 pass, 1 fail, 2 invalid run (the model skipped or altered a command).
// Usage: judge.mjs OUT_DIR [--sandboxed]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const [dir, mode] = process.argv.slice(2);
if (!dir) throw new Error('usage: judge.mjs OUT_DIR [--sandboxed]');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const ids = Object.fromEntries(readFileSync(join(dir, 'ids'), 'utf8').trim().split('\n').map(line => line.split('=')));
const log = join(dir, 'log');
const records = readdirSync(log).filter(name => /^\d+-[A-Za-z]+\.json$/.test(name)).sort().map(name => {
  const copy = suffix => { const path = join(log, name.replace(/\.json$/, suffix)); return existsSync(path) ? read(path) : null; };
  return { ...read(join(log, name)), after: copy('.agents.json'), claims: copy('.claims.json')?.claims ?? null };
});
const invalid = message => { console.log(`INVALID: ${message}`); process.exit(2); };
const failures = [], fail = message => failures.push(message);
// Claims seen while the run was live, per task id.
const claimsOf = id => records.flatMap(r => (r.claims ?? []).filter(c => c.id === id));
const holders = id => claimsOf(id).map(c => c.session);
const isBy = (record, by) => by === 'worker' ? typeof record.payload.agent_id === 'string' : !Object.hasOwn(record.payload, 'agent_id');
// The result of the one command `by` ran containing `text`: exit code and tasks' error, if any.
function result(by, text) {
  const pre = records.filter(r => r.event === 'PreToolUse' && r.payload.tool_name === 'Bash' && isBy(r, by)
    && String(r.payload.tool_input?.command ?? '').includes(text));
  if (pre.length !== 1) invalid(`${by} ran "${text}" ${pre.length} times`);
  const post = records.find(r => r.event === 'PostToolUse' && r.payload.tool_use_id === pre[0].payload.tool_use_id);
  if (!post) { fail(`no result captured for ${by} "${text}"`); return null; }
  const out = post.payload.tool_response;
  if (typeof out !== 'string') { fail(`${by} "${text}": tool_response is ${typeof out}, expected text`); return null; }
  const exit = /^exit=(\d+)$/m.exec(out);
  if (!exit) invalid(`${by} "${text}" did not report its exit code`);
  let error = null;
  const line = out.split('\n').find(l => l.startsWith('{"error"'));
  if (line) { try { error = JSON.parse(line).error; } catch { fail(`${by} "${text}": unparsable error ${line}`); } }
  return { exit: Number(exit[1]), error, out, pre: pre[0] };
}
const succeeds = (by, text) => {
  const r = result(by, text);
  if (r && (r.exit !== 0 || r.error)) fail(`${by} "${text}" failed: exit ${r.exit}, ${r.error?.kind ?? r.out.trim()}`);
  return r;
};
const refuses = (by, text, kind, detail = null) => {
  const r = result(by, text);
  if (!r) return;
  if (r.exit === 0 || r.error?.kind !== kind) fail(`${by} "${text}": exit ${r.exit}, kind ${r.error?.kind ?? 'none'} (${r.out.trim()}), expected refusal ${kind}`);
  else if (detail && !detail.test(r.error.detail ?? '')) fail(`${by} "${text}": ${kind} for another reason: ${r.error.detail}`);
};
const A = read(join(dir, 'A.json')), B = read(join(dir, 'B.json'));
const markers = task => (task.task.notes ?? []).filter(n => /^(started|resumed|done|dropped|parked)/.test(n.text));

if (mode === '--sandboxed') {
  // The sandbox hides the session process behind a pid-1 helper: tasks must refuse with its
  // PID-namespace diagnostic, nothing else.
  refuses('controller', `tasks start ${ids.A}`, 'config',
    /^relay identity: the nearest codex ancestor is pid 1 with no parent, so this command runs in a PID namespace/);
  if (holders(ids.A).length) fail(`A was claimed under the sandbox by ${holders(ids.A).join(', ')}`);
  if (A.task.status !== 'todo') fail(`A status ${A.task.status}`);
} else {
  const acquired = { A: succeeds('controller', `tasks start ${ids.A}`), B: succeeds('worker', `tasks start ${ids.B}`) };
  for (const verb of ['start', 'park', 'done']) {
    refuses('worker', `tasks ${verb} ${ids.A}`, 'claimed');
    refuses('controller', `tasks ${verb} ${ids.B}`, 'claimed');
  }
  const start = records.find(r => r.event === 'SessionStart'), sub = records.find(r => r.event === 'SubagentStart');
  if (!start || !sub) invalid('no SessionStart or SubagentStart captured');
  const R = `codex:${start.payload.session_id}`, W = `codex:${sub.payload.agent_id}`;
  const rows = id => records.map(r => r.after?.agents?.[id]).filter(Boolean);
  const [rootRow] = rows(R), [workerRow] = rows(W);
  if (!rootRow || !workerRow) fail('the registry never held both the root and the worker row');
  else {
    if (workerRow.scope !== 'worker' || workerRow.root !== R) fail(`worker row scope ${workerRow.scope}, root ${workerRow.root}`);
    if (rootRow.process === null) fail('the root row has no process handle');
    else if (!isDeepStrictEqual(workerRow.process, rootRow.process)) fail('root and worker rows do not share a handle');
  }
  for (const [name, task, owner] of [['A', A, R], ['B', B, W]]) {
    if (task.task.status !== 'doing') fail(`${name} status ${task.task.status}`);
    const seen = holders(ids[name]);
    if (!seen.length) fail(`${name} was never claimed while the run was live`);
    else if (seen.some(session => session !== owner)) fail(`${name} held by ${[...new Set(seen)].join(', ')}, expected only ${owner}`);
    // The owner's row was in the registry when its start ran (the copy its PreToolUse left),
    // and the claim holds that row's process: tasks' native CODEX_THREAD_ID fallback names
    // the same session but records no pid. A renamed codex executable hides the boundary from
    // both, leaving a handle-less row and pid-less claims, so the handle is required.
    const at = acquired[name]?.pre.after?.agents?.[owner];
    if (!at) fail(`${name}: no ${owner} row when its start ran`);
    else if (!Number.isInteger(at.process?.pid)) fail(`${name}: ${owner} row had no process handle when its start ran`);
    else if (claimsOf(ids[name]).some(c => c.pid !== at.process.pid)) fail(`${name} claimed without the relay row's process (pid ${at.process.pid})`);
    const lifecycle = markers(task);
    if (lifecycle.length !== 1 || lifecycle[0].text !== 'started') fail(`${name} lifecycle notes ${JSON.stringify(lifecycle.map(n => n.text))}`);
    else if (lifecycle[0].harness_session !== owner) fail(`${name} started by ${lifecycle[0].harness_session}, expected ${owner}`);
  }
}
for (const message of failures) console.log(`FAIL: ${message}`);
console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
process.exit(failures.length ? 1 : 0);
