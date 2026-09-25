import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identityProof, runHeads } from '../tools/darwin-probe/stages/d7-guard.mjs';
import { pluginOutcome, PINNED } from '../tools/darwin-probe/stages/d7b-opencode.mjs';
import { argSummary, stripCapture } from '../tools/darwin-probe/stages/d9-ambient.mjs';

test('an agent is proven only through its own session\'s hook', () => {
  const parse = (line) => { const [pid, start, comm] = line.split(' '); return { pid: Number(pid), starttime: start, comm }; };
  const inv = (agent_id, pid, start) => ({ agent_id, resolved: pid, ancestors: [{ pid: 99 }, { pid }], captures: [{ pid, forms: { row: { ww: `${pid} ${start} claude` } } }] });
  const A = inv('claude-code:A', 10, '111'), B = inv('claude-code:B', 20, '222');
  assert.deepEqual(identityProof({ 'claude-code:A': { process: { pid: 10, start: '111' } } }, [A, B], parse, 'claude-code'), { agents: 1, matched: 1, ok: true });
  // Agent A carrying session B's handle is not proven by B's evidence.
  assert.equal(identityProof({ 'claude-code:A': { process: { pid: 20, start: '222' } } }, [A, B], parse, 'claude-code').ok, false);
  assert.equal(identityProof({ 'claude-code:A': { process: { pid: 10, start: '999' } } }, [A], parse, 'claude-code').ok, false);
  assert.equal(identityProof({ 'claude-code:A': { process: { pid: 10, start: '111' } } }, [{ ...A, captures: [{ pid: 10, forms: { row: { ww: '10 111 node' } } }] }], parse, 'claude-code').ok, false);
  assert.equal(identityProof({ 'claude-code:A': { process: null } }, [A], parse, 'claude-code').ok, false);
  assert.equal(identityProof({}, [A], parse, 'claude-code').ok, false);
});
test('OpenCode plugin outcomes at the pinned version', () => {
  const p = '/x/plugin';
  assert.equal(PINNED, '2.0.15');
  assert.equal(pluginOutcome(`message="configured plugin path must be a directory" target=${p}/plugin.js`, p), 'rejected-file');
  assert.equal(pluginOutcome(`msg="loading plugin" id=${p}\nmessage="failed to load plugin" target=${p}`, p), 'load-failed');
  assert.equal(pluginOutcome(`msg="loading plugin" id=${p}`, p), 'loaded');
  assert.equal(pluginOutcome('', p), 'none');
});
test('ambient arguments keep only what recognition needs', () => {
  assert.deepEqual(argSummary(['/Users/u/.local/bin/claude', '-p', 'secret', 'project', 'details']), { argv0_name: 'claude', role: 'other', count: 5 });
  assert.deepEqual(argSummary(['2.1.282', 'daemon', 'run']), { argv0_name: '2.1.282', role: 'daemon', count: 3 });
  const c = stripCapture({ pid: 1, label: 'x', truncated: false, forms: { args: { relay: 'claude -p secret project details', columns: 'claude -p secret project details', ww: 'claude -p secret project details', relay_len: 31, ww_len: 31, truncated: false, relay_is_prefix: true }, comm: { relay: 'claude', ww: 'claude' } } });
  assert.equal(JSON.stringify(c).includes('secret'), false);
  assert.deepEqual(c.forms.args, { relay_len: 31, ww_len: 31, truncated: false, relay_is_prefix: true });
});
test('each live harness run is logged with its exit and the head of its output', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  assert.deepEqual(runHeads(d), []);
  const put = (rel, text) => { mkdirSync(join(d, rel, '..'), { recursive: true }); writeFileSync(join(d, rel), text); };
  put('runs/preflight/replay.stderr', 'replay noise');
  put('runs/20260925T120000/results.json', '{}');
  put('runs/20260925T120000/allow/exit', '1\n'); put('runs/20260925T120000/allow/seconds', '38.2\n');
  put('runs/20260925T120000/allow/stderr', Array.from({ length: 100 }, (_, i) => `err ${i}`).join('\n'));
  put('runs/20260925T120000/allow/transcript.jsonl', '{"type":"x"}\n');
  mkdirSync(join(d, 'runs/20260925T120000/allow/workspace'));
  put('runs/20260925T120000/deny/exit', 'timeout\n');
  const [allow, deny, ...rest] = runHeads(d);
  assert.equal(rest.length, 0);
  assert.match(allow, /^run 20260925T120000\/allow: exit 1 after 38\.2 s\n/);
  assert.match(allow, /--- stderr\nerr 0\n/);
  assert.ok(allow.includes('err 39') && !allow.includes('err 40'), allow);
  assert.match(allow, /--- stdout\n\{"type":"x"\}/);
  assert.match(deny, /^run 20260925T120000\/deny: exit timeout after \? s\n--- stderr\n\n--- stdout\n$/);
  assert.equal(runHeads(d).join('').includes('replay noise'), false);
});
test('an output head is also cut to a byte budget', () => {
  const d = mkdtempSync(join(tmpdir(), 'dp-'));
  try {
    mkdirSync(join(d, 'runs/a/allow'), { recursive: true }); writeFileSync(join(d, 'runs/a/allow/stderr'), 'x'.repeat(10000));
    const [entry] = runHeads(d);
    assert.ok(entry.length < 4200, String(entry.length));
  } finally { rmSync(d, { recursive: true, force: true }); }
});
