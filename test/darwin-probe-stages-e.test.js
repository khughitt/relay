import test from 'node:test';
import assert from 'node:assert/strict';
import { pluginOutcome, PINNED } from '../tools/darwin-probe/stages/d7b-opencode.mjs';
import { argSummary, stripCapture } from '../tools/darwin-probe/stages/d9-ambient.mjs';

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
