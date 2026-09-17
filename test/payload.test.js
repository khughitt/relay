import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import { normalizeEvent } from '../src/adapters/index.js';
import { readNativeInput } from '../src/adapters/payload.js';
test('Bash input normalizes without persisting native extras', () => {
  const e = normalizeEvent('codex', 'PreToolUse', JSON.stringify({ session_id: 's:1', cwd: '/repo', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo ok' }, prompt: 'PRIVATE' }));
  assert.equal(e.agentId, 'codex:s:1'); assert.equal(e.kind, 'before-tool');
  assert.equal(e.tool.command, 'echo ok'); assert.equal(Object.hasOwn(e, 'prompt'), false);
});
import { adapterFor } from '../src/adapters/index.js';
const rows = {
  'claude-code': [['SessionStart','session-start','idle'], ['UserPromptSubmit','prompt','working'], ['PreToolUse','before-tool','working'], ['Notification:idle_prompt','needs-input','needs-input'], ['Notification:permission_prompt','needs-approval','needs-approval'], ['Stop','turn-end','done'], ['StopFailure','turn-error','error'], ['SessionEnd','session-end',null]],
  codex: [['SessionStart','session-start','idle'], ['UserPromptSubmit','prompt','working'], ['PreToolUse','before-tool','working'], ['PermissionRequest','needs-approval','needs-approval'], ['Stop','turn-end','done'], ['SessionEnd','session-end',null]],
  opencode: [['init','session-start','idle'], ['session.busy','activity','working'], ['permission.pending','needs-approval','needs-approval'], ['session.error','turn-error','error'], ['session.idle','idle','idle'], ['dispose','session-end',null]]
};
const raw = (over = {}) => JSON.stringify({ session_id: 's', cwd: '/repo', ...over });
test('all twenty mappings have literal kind and level expectations', () => {
  for (const [harness, expected] of Object.entries(rows)) {
    const adapter = adapterFor(harness);
    assert.equal(Object.keys(adapter.events).length, expected.length);
    assert.ok(Object.isFrozen(adapter.events));
    for (const fn of ['stateForEvent','reduceState','resolveAgentPid']) assert.equal(typeof adapter[fn], 'function');
    for (const [event, kind, level] of expected) {
      const e = normalizeEvent(harness, event, raw({ tool_name: 'Bash', tool_input: {} }));
      assert.equal(e.kind, kind); assert.equal(adapter.stateForEvent(event), level);
      assert.ok(Object.isFrozen(adapter.events[event]));
    }
    for (const event of ['Interrupt','PostToolUse','toString',undefined]) assert.throws(() => adapter.stateForEvent(event), { code: 'UNSUPPORTED_EVENT' });
  }
  assert.throws(() => adapterFor('cursor'), { code: 'UNSUPPORTED_HARNESS' });
});
test('validation rejects malformed payloads and never supplies cwd', () => {
  for (const body of ['', '{', 'null', '[]', '{}', raw({ session_id: ' ' }), raw({ cwd: undefined }), raw({ cwd: 'relative' }), raw({ hook_event_name: 'Stop' }), raw({ stop_hook_active: 1 }), Buffer.from([0xff])]) {
    assert.throws(() => normalizeEvent('codex', 'SessionStart', body), { code: 'INVALID_INPUT' });
  }
  for (const tool_input of [null, [], 'command', 1]) assert.throws(() => normalizeEvent('codex', 'PreToolUse', raw({ tool_name:'Bash',tool_input })), { code:'INVALID_INPUT' });
  assert.throws(() => normalizeEvent('codex', 'PreToolUse', raw({tool_name:' ',tool_input:{}})), { code:'INVALID_INPUT' });
  assert.equal(normalizeEvent('claude-code','Notification:idle_prompt',raw({hook_event_name:'Notification'})).kind,'needs-input');
  assert.equal(normalizeEvent('codex','Stop',raw({stop_hook_active:false})).stopHookActive,false);
});
test('only canonical Bash command is shell source', () => {
  for (const harness of ['claude-code','codex']) {
    for (const [name,input,command] of [['Bash',{command:'echo ok'},'echo ok'],['apply_patch',{command:'*** PRIVATE'},null],['exec',{cmd:'echo ok'},null],['Bash',{cmd:'echo ok'},null],['Bash',{command:[]},null]]) {
      assert.equal(normalizeEvent(harness,'PreToolUse',raw({tool_name:name,tool_input:input})).tool.command,command);
    }
  }
  assert.equal(normalizeEvent('codex','Stop',raw({tool_name:'Bash',tool_input:{command:'private'}})).tool,null);
});
test('stdin counts bytes, requires EOF and removes all owned listeners', async () => {
  const max = 4 * 1024 * 1024;
  const bytes = Buffer.alloc(max, 97); bytes.write('é', max - 2);
  const stream = Readable.from([bytes.subarray(0,max-1), bytes.subarray(max-1)]);
  assert.deepEqual(await readNativeInput(stream),bytes);
  for (const event of ['data','end','error','close']) assert.equal(stream.listenerCount(event),0);
  await assert.rejects(readNativeInput(Readable.from([bytes,Buffer.from('é')])),{code:'INPUT_TOO_LARGE'});
  const open = new PassThrough(); const pending = readNativeInput(open,{deadline:performance.now()+15}); open.write('{}');
  await assert.rejects(pending,{code:'INPUT_TIMEOUT'}); assert.equal(open.listenerCount('data'),0); open.destroy();
  const broken = new PassThrough(); const result = readNativeInput(broken); broken.destroy(new Error('private'));
  await assert.rejects(result,{code:'INVALID_INPUT'});
  const closed = new PassThrough(); const incomplete = readNativeInput(closed); closed.destroy();
  await assert.rejects(incomplete,{code:'INVALID_INPUT'});
  await assert.rejects(readNativeInput(new PassThrough(),{clock:()=>1,deadline:1}),{code:'INPUT_TIMEOUT'});
});
test('resolvers skip self and use nearest matching terminal candidate', () => {
  for (const [harness,comm] of [['claude-code','claude'],['codex','codex'],['opencode','opencode']]) {
    const resolver = adapterFor(harness).resolveAgentPid;
    assert.equal(resolver({ancestors:()=>[{pid:5,comm,tty:true}]}),null);
    assert.equal(resolver({ancestors:()=>[{pid:5,comm,tty:true},{pid:4,comm,tty:null},{pid:3,comm,tty:true},{pid:2,comm,tty:true}]}),3);
  }
});
test('Claude and Codex reducers preserve every explicit level including removal',()=>{
  for(const harness of ['claude-code','codex'])for(const level of ['idle','working','needs-input','needs-approval','done','error',null])assert.equal(adapterFor(harness).reduceState(level,'error'),level);
});
test('input rejects expired data and EOF before the timeout callback runs',async()=>{
  for(const [deadline,expired] of [[10,10],[10000,5000]]) {
    for(const lateData of [false,true]) {
      let now=0;const stream=new PassThrough();
      const pending=readNativeInput(stream,{clock:()=>now,deadline});
      let rejected=false;pending.catch(()=>{rejected=true;});
      if(!lateData)stream.write('{}');
      now=expired;
      if(lateData)stream.write('{}');else stream.end();
      if(lateData){await Promise.resolve();assert.equal(rejected,true,'expired data must reject before the timer callback');}
      await assert.rejects(pending,{code:'INPUT_TIMEOUT'});
      for(const event of ['data','end','error','close'])assert.equal(stream.listenerCount(event),0);
      stream.destroy();
    }
  }
});
