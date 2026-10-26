#!/usr/bin/env node
// Print a capture's hook events as a markdown table with every id redacted to a stable
// label: R is the root session (R2, R3, … the roots a /new, /resume or /fork switched to),
// W1, W2, … the worker agent ids in order of appearance,
// T1, T2, … turn ids, P1, … the nearest codex process. Transcript paths become the label
// of the thread whose rollout they name, and a hook's CODEX_*_ID values the label of the
// thread they name. A switch case's switch-at file becomes a row of its own, between the
// events before and after the switch. Usage: summarize.mjs OUT_DIR
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
// A root is a session that sends events of its own (no agent_id), in order of appearance.
const roots = [...new Set(records.filter(({ payload: p }) => !p.agent_id).map(({ payload: p }) => p.session_id))];
const thread = id => { const n = roots.indexOf(id); return n < 0 ? label('W', id) : n ? `R${n + 1}` : 'R'; };
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
    Object.keys(env).filter(key => key !== 'CODEX_HOME').map(key => `env ${key}${/_ID$/.test(key) && env[key] ? `=${thread(env[key])}` : ''}`).join(', '),
  ].filter(Boolean).join('; ');
  return [index + 1, `${(Number(ns - start) / 1e9).toFixed(1)}`, event, p.turn_id ? label('T', p.turn_id) : '—',
    thread(p.session_id),
    p.agent_id ? `${thread(p.agent_id)} / \`${p.agent_type}\`` : 'absent',
    codex ? `${label('P', String(codex.pid))}${ancestry[1]?.comm === 'codex' ? '' : ' (not parent)'}` : 'none', notes];
});
const switchAt = existsSync(join(dir, 'switch-at')) ? BigInt(readFileSync(join(dir, 'switch-at'), 'utf8').trim()) : null;
const switchRow = switchAt === null ? null : ['—', (Number(switchAt - start) / 1e9).toFixed(1),
  `*switch: ${readFileSync(join(dir, 'case'), 'utf8').trim().replace(/^switch-/, '/')}*`, '', '', '', '', ''];
const before = switchAt === null ? rows.length : records.findIndex(({ ns }) => ns > switchAt);
if (switchRow) rows.splice(before < 0 ? rows.length : before, 0, switchRow);
console.log('| # | s | Event | Turn | `session_id` | `agent_id` / `agent_type` | codex | Notes |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const row of rows) console.log(`| ${row.join(' | ')} |`);
