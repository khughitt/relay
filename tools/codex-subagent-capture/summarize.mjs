#!/usr/bin/env node
// Print a capture's hook events as a markdown table with every id redacted to a stable
// label: R is the root session, W1, W2, … the worker agent ids in order of appearance,
// T1, T2, … turn ids, P1, … the nearest codex process. Transcript paths become the label
// of the thread whose rollout they name. Usage: summarize.mjs OUT_DIR
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: summarize.mjs OUT_DIR');
const log = join(dir, 'log');
const files = readdirSync(log).filter(name => /^\d+-[A-Za-z]+\.json$/.test(name)).sort();
const records = files.map(name => ({ ns: BigInt(name.split('-')[0]), ...JSON.parse(readFileSync(join(log, name), 'utf8')) }));
if (!records.length) throw new Error(`no hook records in ${log}`);

const labels = new Map(), counters = { W: 0, T: 0, P: 0 };
/** @param {string} kind @param {string} id */
const label = (kind, id) => {
  const key = `${kind}:${id}`;
  if (!labels.has(key)) labels.set(key, `${kind}${++counters[kind]}`);
  return labels.get(key);
};
const root = records[0].payload.session_id;
const thread = id => id === root ? 'R' : label('W', id);
const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
const transcript = path => { const match = uuid.exec(path ?? ''); return match ? `${thread(match[1])}'s rollout` : null; };

const start = records[0].ns;
const rows = records.map(({ ns, event, payload: p, env, ancestry }, index) => {
  const codex = ancestry.find(row => row.comm === 'codex');
  const notes = [
    p.source && `source: ${p.source}`, p.reason && `reason: ${p.reason}`, p.tool_name && `tool: ${p.tool_name}`,
    'stop_hook_active' in p && `stop_hook_active: ${p.stop_hook_active}`,
    p.transcript_path && `transcript: ${transcript(p.transcript_path)}`,
    p.agent_transcript_path && `agent transcript: ${transcript(p.agent_transcript_path)}`,
    Object.keys(env).filter(key => key !== 'CODEX_HOME').map(key => `env ${key}`).join(', '),
  ].filter(Boolean).join('; ');
  return [index + 1, `${(Number(ns - start) / 1e9).toFixed(1)}`, event, p.turn_id ? label('T', p.turn_id) : '—',
    p.session_id === root ? 'R' : thread(p.session_id),
    p.agent_id ? `${thread(p.agent_id)} / \`${p.agent_type}\`` : 'absent',
    codex ? `${label('P', String(codex.pid))}${ancestry[1]?.comm === 'codex' ? '' : ' (not parent)'}` : 'none', notes];
});
console.log('| # | s | Event | Turn | `session_id` | `agent_id` / `agent_type` | codex | Notes |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const row of rows) console.log(`| ${row.join(' | ')} |`);
