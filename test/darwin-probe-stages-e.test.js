import test from 'node:test';
import assert from 'node:assert/strict';
import { identityProof } from '../tools/darwin-probe/stages/d7-guard.mjs';
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
