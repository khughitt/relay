#!/usr/bin/env node
// Judge a `run --relay` capture. Worker rows exist with scope worker and their root, share
// the root's handle and never move the root row; the root's SessionEnd publication removes
// the root and its workers; reap after the process exits leaves nothing. Only events relay
// handled (wrapped hooks, which leave a .reply file) carry a registry copy; PostToolUse is
// logged only and is skipped. Exit 0 pass, 1 fail, 2 invalid run (no worker event).
// Usage: judge-registry.mjs OUT_DIR
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const dir = process.argv[2];
if (!dir) throw new Error('usage: judge-registry.mjs OUT_DIR');
const log = join(dir, 'log'), read = path => JSON.parse(readFileSync(path, 'utf8'));
const records = readdirSync(log).filter(name => /^\d+-[A-Za-z]+\.json$/.test(name)).sort().map(name => {
  const base = join(log, name.replace(/\.json$/, ''));
  return { name, ...read(join(log, name)), wrapped: existsSync(`${base}.reply`),
    after: existsSync(`${base}.agents.json`) ? read(`${base}.agents.json`) : null };
});
const failures = [], fail = message => failures.push(message);
const handled = records.filter(record => record.wrapped);
const workerEvents = handled.filter(record => typeof record.payload.agent_id === 'string');
if (!workerEvents.length) { console.log('INVALID: no worker event reached relay'); process.exit(2); }
const rooted = (rows, rootId) => Object.values(rows).filter(row => row.id === rootId || row.root === rootId).map(row => row.id);
let previousRoot = null, ended = false;
for (const record of handled) {
  if (record.after === null) { fail(`${record.name}: no registry copy after a relay event`); continue; }
  const rootId = `codex:${record.payload.session_id}`, rows = record.after.agents, root = rows[rootId] ?? null;
  if (typeof record.payload.agent_id === 'string') {
    const row = rows[`codex:${record.payload.agent_id}`];
    if (!row) fail(`${record.name}: no worker row`);
    else {
      if (row.scope !== 'worker' || row.root !== rootId) fail(`${record.name}: worker row scope ${row.scope}, root ${row.root}`);
      if (root && !isDeepStrictEqual(row.process, root.process)) fail(`${record.name}: worker and root handles differ`);
    }
    if (!isDeepStrictEqual(root, previousRoot)) fail(`${record.name}: a worker event changed the root row`);
  }
  if (record.event === 'SessionEnd') {
    ended = true;
    const left = rooted(rows, rootId);
    if (left.length) fail(`${record.name}: SessionEnd left ${left.join(', ')}`);
  }
  previousRoot = root;
}
if (!ended) fail('no SessionEnd publication captured');
const final = existsSync(join(dir, 'final-agents.json')) ? read(join(dir, 'final-agents.json')) : undefined;
if (final === undefined) fail('no final-agents.json (reap result)');
else if (final !== null && Object.keys(final.agents).length) fail(`rows left after reap: ${Object.keys(final.agents).join(', ')}`);
for (const message of failures) console.log(`FAIL: ${message}`);
console.log(failures.length ? `FAIL (${failures.length})` : `PASS: ${workerEvents.length} worker events, SessionEnd removed the session's rows, reap left none`);
process.exit(failures.length ? 1 : 0);
