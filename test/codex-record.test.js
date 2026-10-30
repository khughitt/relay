import test from 'node:test';
import {createHash} from 'node:crypto';
import {inspect} from 'node:util';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,appendFileSync,renameSync,symlinkSync,truncateSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const {openRolloutRecord,findProvenance,matchReceipt,callSettled}=await import('../src/serve/codex/record.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const row=(payload,type='response_item')=>JSON.stringify({timestamp:'2026-10-30T00:00:00Z',type,payload})+'\n';
const call=(id='c',extra={})=>row({type:'function_call',call_id:id,name:'request_user_input',arguments:'private args',...extra});
const answer={answers:{q:{answers:['Blue']}}};
const output=(id='c',value=answer)=>row({type:'function_call_output',call_id:id,output:JSON.stringify(value)});
const end=(turn='t',type='task_complete')=>row({type,...(turn?{turn_id:turn}:{})},'event_msg');
const tuple={itemId:'c',turnId:'t'};
function fixture(t,text='',limits={}) {
 assert.equal(typeof openRolloutRecord,'function','bounded reader required');
 const dir=mkdtempSync(join(tmpdir(),'rr-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const sessionsDir=join(dir,'sessions');mkdirSync(sessionsDir);const path=join(sessionsDir,'r.jsonl');writeFileSync(path,text);
 const options={path,sessionsDir,uid:process.getuid(),...limits};const record=openRolloutRecord(options);t.after(()=>record.close());
 return {dir,path,sessionsDir,record,options,append:s=>appendFileSync(path,s)};
}
test('accepts only a regular owned non-symlink .jsonl under sessionsDir',t=>{
 const f=fixture(t);assert.equal(f.record.state,'ok');
 for(const [path,code,uid] of [[join(f.dir,'outside.jsonl'),'path-outside-sessions'],[join(f.sessionsDir,'old.jsonl.zst'),'compressed'],[f.path,'owner',process.getuid()+1]])assert.throws(()=>openRolloutRecord({...f.options,path,uid:uid??process.getuid()}),e=>e.code===code);
 const link=join(f.sessionsDir,'link.jsonl');symlinkSync(f.path,link);assert.throws(()=>openRolloutRecord({...f.options,path:link}),e=>e.code==='symlink');
 const fifo=join(f.sessionsDir,'pipe.jsonl');const r=spawnSync('/usr/bin/mkfifo',[fifo],{env:{PATH:'/usr/bin:/bin',HOME:f.dir},encoding:'utf8'});assert.equal(r.status,0);assert.throws(()=>openRolloutRecord({...f.options,path:fifo}),e=>e.code==='not-regular');
 const outside=join(f.dir,'external');mkdirSync(outside);writeFileSync(join(outside,'escape.jsonl'),'');symlinkSync(outside,join(f.sessionsDir,'parent'));assert.throws(()=>openRolloutRecord({...f.options,path:join(f.sessionsDir,'parent','escape.jsonl')}),e=>e.code==='path-outside-sessions');
});
test('extracts function_call and function_call_output by call id and nothing else',async t=>{
 const f=fixture(t,call()+output()+row({type:'message',content:'private message'})+row({secret:'private'},'session_meta'));const r=await f.record.read();
 assert.deepEqual([...r.calls],[['c',{name:'request_user_input',namespace:null}]]);assert.deepEqual([...r.outputs],[['c',JSON.stringify(answer)]]);assert.ok(!JSON.stringify([...r.calls]).includes('private'));assert.deepEqual(Object.keys(r).sort(),['abortsWithoutTurn','calls','outputs','state','turnEnds']);
});
test('reads only appended bytes and holds a partial trailing line',async t=>{
 const line=output();const f=fixture(t,call()+line.slice(0,25));let r=await f.record.read();assert.equal(r.outputs.size,0);
 f.append(line.slice(25,-1));r=await f.record.read();assert.equal(r.outputs.size,0);f.append('\n');r=await f.record.read();assert.equal(r.outputs.size,1);
 f.append(end(null,'turn_aborted'));await f.record.read();assert.equal((await f.record.read()).abortsWithoutTurn,1);
});
test('identity change, shrink, oversized and malformed lines make state unknown',async t=>{
 for(const [mutate,code,limits] of [
  [f=>{renameSync(f.path,f.path+'.old');writeFileSync(f.path,call())},'identity-changed',{}],
  [f=>truncateSync(f.path,0),'shrunk',{}],
  [f=>f.append('x'.repeat(200)),'line-limit',{maxLineBytes:128}],
  [f=>f.append('oops\n'),'malformed-line',{}],
  [f=>f.append(output()),'read-limit',{maxReadBytes:Buffer.byteLength(call())+2}],
 ]){const f=fixture(t,call(),limits);await f.record.read();mutate(f);const r=await f.record.read();assert.equal(r.state,'unknown');assert.equal(r.code,code);assert.equal((await f.record.read()).code,code)}
});
test('findProvenance waits for a late call line and returns unidentified after the wait',async t=>{
 const f=fixture(t);let polls=0,clock=0;assert.equal(await findProvenance(f.record,'c',{waitMs:20,pollMs:10,now:()=>clock,sleep:async(ms)=>{clock+=ms;polls++;f.append(call())}}),'built-in');assert.equal(polls,1);
 assert.equal(await findProvenance(f.record,'missing',{waitMs:20,pollMs:10,now:()=>clock,sleep:async(ms)=>{clock+=ms;polls++}}),'unidentified');assert.equal(polls,3);
});
test('findProvenance returns other for a namespaced or differently named call',async t=>{
 const f=fixture(t,call('a',{namespace:'functions'})+call('b',{name:'noop'}));
 for(const id of ['a','b'])assert.equal(await findProvenance(f.record,id,{waitMs:0}),'other');
});
test('matchReceipt distinguishes consumed, mismatch, absent and unknown',async t=>{
 const f=fixture(t,call()+call('other')+output()+output('other',{answers:{q:{answers:['Red']}}}));const r=await f.record.read();
 assert.equal(matchReceipt(r,'c',answer),'consumed');assert.equal(matchReceipt(r,'other',answer),'mismatch');assert.equal(matchReceipt(r,'absent',answer),'absent');
 f.append('bad\n');await f.record.read();assert.equal(matchReceipt(r,'c',answer),'unknown');
});
test('callSettled is pending, not gone, when protocol completion precedes the turn-end line',async t=>{
 const f=fixture(t,call());let r=await f.record.read();assert.equal(callSettled(r,tuple),'pending');r=await f.record.read();assert.equal(callSettled(r,tuple),'pending');
 f.append(output());r=await f.record.read();assert.equal(callSettled(r,tuple),'answered');f.append(end());r=await f.record.read();assert.equal(callSettled(r,tuple),'answered');
});
test('callSettled is unknown after reader failure even with cached evidence',async t=>{
 for(const cached of [output(),end()]){const f=fixture(t,call()+cached);let r=await f.record.read();assert.notEqual(callSettled(r,tuple),'unknown');
 if(cached===output()){renameSync(f.path,f.path+'.old');writeFileSync(f.path,call()+cached)}else f.append('bad\n');
 r=await f.record.read();assert.equal(callSettled(r,tuple),'unknown');assert.equal(matchReceipt(r,'c',answer),'unknown');assert.equal(await findProvenance(f.record,'c',{waitMs:0}),'unknown')}
});
test('turn_complete is not a turn end',async t=>{const f=fixture(t,call()+end('t','turn_complete'));assert.equal(callSettled(await f.record.read(),tuple),'pending')});
test('callSettled is gone only after the matching turn-end line with no output',async t=>{
 const f=fixture(t,call()+end('different'));assert.equal(callSettled(await f.record.read(),tuple),'pending');f.append(end());assert.equal(callSettled(await f.record.read(),tuple),'gone');
 const g=fixture(t,call()+end(null,'turn_aborted'));assert.equal(callSettled(await g.record.read(),tuple),'unknown');
});
test('captured pilot lines parse to the same call, output and task_complete turn end',async t=>{
 const text=readFileSync(new URL('./fixtures/codex/rollout-captured-pilot.jsonl',import.meta.url),'utf8'),ids=JSON.parse(readFileSync(new URL('./fixtures/codex/rollout-captured-pilot-ids.json',import.meta.url)));
 const f=fixture(t,text),r=await f.record.read();assert.equal(await findProvenance(f.record,ids.itemId),'built-in');assert.equal(matchReceipt(r,ids.itemId,{answers:{q_color:{answers:['Blue']}}}),'consumed');assert.equal(r.turnEnds.get(ids.turnId),'complete');
 const rows=text.trim().split('\n').map(JSON.parse);const outputIndex=rows.findIndex(x=>x.payload?.type==='function_call_output'&&x.payload.call_id===ids.itemId),endIndex=rows.findIndex(x=>x.type==='event_msg'&&x.payload?.type==='task_complete'&&x.payload.turn_id===ids.turnId);assert.ok(outputIndex>=0&&endIndex>outputIndex);
});

// Synthetic private outputs; these are not native cancellation evidence.
const privateOutput=(id,value)=>row({type:'function_call_output',call_id:id,output:value});
test('all other output shapes leave no content or hash in snapshot',async t=>{
 const text=readFileSync(new URL('./fixtures/codex/rollout-other-output.jsonl',import.meta.url),'utf8');
 const f=fixture(t,text),r=await f.record.read();assert.equal(r.state,'ok');assert.equal(r.outputs.size,0);
 const visible=inspect(r,{depth:null,showHidden:true});
 for(const entry of text.trim().split('\n').map(JSON.parse).filter(e=>e.payload.type==='function_call_output')) {
  const encoded=JSON.stringify(entry.payload.output),hash=createHash('sha256').update(encoded).digest('hex');
  assert.ok(!visible.includes(hash));if(encoded.includes('PRIVATE'))assert.ok(!visible.includes('PRIVATE'));
 }
 assert.deepEqual(Reflect.ownKeys(r).sort(),['abortsWithoutTurn','calls','outputs','state','turnEnds']);
});
test('same other output repeats but conflicting content makes sticky unknown',async t=>{
 const f=fixture(t,call('o',{name:'shell'})+privateOutput('o','PRIVATE-one')+privateOutput('o','PRIVATE-one'));
 assert.equal((await f.record.read()).state,'ok');f.append(privateOutput('o','PRIVATE-two'));
 assert.equal((await f.record.read()).state,'unknown');f.append(output());assert.equal((await f.record.read()).state,'unknown');
});
test('output before call or missing output is unidentified and unknown',async t=>{
 for(const text of [output()+call(),row({type:'function_call_output',call_id:'c'})+call(),call('c',{name:'shell'})+row({type:'function_call_output',call_id:'c'})]) {
  const f=fixture(t,text),r=await f.record.read();assert.equal(r.state,'unknown');assert.equal(matchReceipt(r,'c',answer),'unknown');
 }
});
test('valid other history followed by built-in receipt stays usable on reopening from zero',async t=>{
 const text=call('o',{name:'view_image'})+privateOutput('o',[{type:'image',data:'PRIVATE-IMAGE'}])+call()+output()+end();
 const f=fixture(t,text);for(const record of [f.record,openRolloutRecord(f.options)]) {
  const r=await record.read();assert.equal(r.state,'ok');assert.equal(await findProvenance(record,'o',{waitMs:0}),'other');
  assert.equal(matchReceipt(r,'c',answer),'consumed');assert.deepEqual([...r.outputs],[['c',JSON.stringify(answer)]]);await record.close();
 }
 // Reopening must reject an orphan at byte zero, rather than using an old call table.
 writeFileSync(f.path,output());const reopened=openRolloutRecord(f.options);t.after(()=>reopened.close());assert.equal((await reopened.read()).state,'unknown');
});
const fullTuple={threadId:'thread',turnId:'t',itemId:'c'};
const proof=(extra={})=>({request:{method:'item/tool/requestUserInput',params:{...fullTuple}},terminal:{method:'turn/completed',params:{threadId:'thread',turn:{id:'t',status:'interrupted'}}},...extra});
test('source-shaped dropped channel settles without cause only with complete ordered proof',async t=>{
 const marker='request_user_input was cancelled before receiving a response',f=fixture(t,call()+privateOutput('c',marker));let r=await f.record.read();
 assert.equal(callSettled(r,fullTuple,proof()),'unknown');f.append(end());r=await f.record.read();
 assert.equal(callSettled(r,fullTuple,proof()),'no-answer');assert.equal(matchReceipt(r,'c',answer),'unknown');assert.equal(matchReceipt(r,'c',{answers:{}}),'unknown');
 for(const missing of [{request:null},{terminal:null},{terminal:{method:'serverRequest/resolved',params:{threadId:'thread',requestId:1}}},{request:{method:'item/tool/requestUserInput',params:{...fullTuple,itemId:'other'}}},{terminal:{method:'turn/completed',params:{threadId:'else',turn:{id:'t',status:'interrupted'}}}},{terminal:{method:'turn/completed',params:{threadId:'thread',turn:{id:'wrong',status:'interrupted'}}}},{terminal:{method:'turn/completed',params:{threadId:'thread',turn:{id:'t',status:'inProgress'}}}}])assert.equal(callSettled(r,fullTuple,proof(missing)),'unknown');
 f.append('bad\n');await f.record.read();assert.equal(callSettled(r,fullTuple,proof()),'unknown');
});
test('arbitrary non-answer text needs later barrier and never becomes an answer',async t=>{
 const f=fixture(t,call()+privateOutput('c','a non-answer message'));let r=await f.record.read();assert.equal(callSettled(r,fullTuple,proof()),'unknown');f.append(end('else'));r=await f.record.read();assert.equal(callSettled(r,fullTuple,proof()),'unknown');f.append(end());r=await f.record.read();assert.equal(callSettled(r,fullTuple,proof()),'no-answer');assert.equal(callSettled(r,fullTuple),'unknown');
});
test('earlier or partial barriers and repeated dispatch identity cannot settle a later output',async t=>{
 for(const text of [call()+end()+privateOutput('c','non-answer'),call()+end()+privateOutput('c','non-answer')+end(),call()+output()+end()+call()+output()]) {
  const f=fixture(t,text),r=await f.record.read();assert.equal(callSettled(r,fullTuple,proof()),'unknown');
 }
 const line=end(),f=fixture(t,call()+privateOutput('c','non-answer')+line.slice(0,-1));let r=await f.record.read();assert.equal(callSettled(r,fullTuple,proof()),'unknown');f.append('\n');r=await f.record.read();assert.equal(callSettled(r,fullTuple,proof()),'no-answer');
});
test('output duplicate cannot replace its first position and reopen reconstructs proof order',async t=>{
 const f=fixture(t,call()+privateOutput('c','non-answer')+end()+privateOutput('c','non-answer'));
 for(const record of [f.record,openRolloutRecord(f.options)]){const r=await record.read();assert.equal(callSettled(r,fullTuple,proof()),'no-answer');await record.close()}
});
test('non-answer strings and structured built-in outputs never count as answered',async t=>{
 for(const value of ['arbitrary','null','{}','[]','42','{"answers":[]}','{"answers":{"q":{"answers":[42]}}}',[{type:'input_text',text:'x'}]]) {
  const f=fixture(t,call()+privateOutput('c',value)+end()),r=await f.record.read();assert.equal(callSettled(r,tuple),'unknown');assert.notEqual(matchReceipt(r,'c',answer),'consumed');
 }
});
test('answer and source-shaped receiver-failure decline are value-only receipts',async t=>{
 for(const value of [answer,{answers:{}}]) {
  const f=fixture(t,call()+output('c',value)),r=await f.record.read();assert.equal(callSettled(r,tuple),'answered');assert.equal(matchReceipt(r,'c',value),'consumed');
  if(Object.keys(value.answers).length===0){assert.equal(matchReceipt(r,'c',answer),'mismatch');assert.deepEqual([...r.outputs],[['c','{"answers":{}}']]);}
 }
});
test('oversized irrelevant lines and files remain unknown across opens at custom and default bounds',async t=>{
 for(const [text,limits,code] of [
  [call('o',{name:'shell'})+privateOutput('o','PRIVATE'.repeat(60)),{maxLineBytes:256},'line-limit'],
  [call('o',{name:'shell'})+privateOutput('o','PRIVATE'.repeat(60)),{maxReadBytes:256},'read-limit'],
  [call('o',{name:'view_image'})+privateOutput('o','x'.repeat(1024*1024)),{},'line-limit'],
 ]) {
  const f=fixture(t,text,limits);for(const record of [f.record,openRolloutRecord(f.options)]) {const r=await record.read();assert.equal(r.state,'unknown');assert.equal(r.code,code);await record.close();}
 }
 const f=fixture(t);truncateSync(f.path,64*1024*1024+1);
 for(const record of [f.record,openRolloutRecord(f.options)]) {const r=await record.read();assert.equal(r.code,'read-limit');await record.close();}
});

test('captured native interruption needs joint proof and never consumes a saved answer',async t=>{
 const text=readFileSync(new URL('./fixtures/codex/rollout-captured-interrupt-unknown.jsonl',import.meta.url),'utf8');
 const rows=text.trim().split('\n').map(JSON.parse),itemId=rows.find(e=>e.payload.type==='function_call').payload.call_id,turnId=rows.find(e=>e.payload.type==='turn_aborted').payload.turn_id;
 const f=fixture(t,text),r=await f.record.read();assert.equal(r.state,'ok');assert.equal(r.outputs.get(itemId),'aborted by user after 0.1s');assert.equal(r.turnEnds.get(turnId),'aborted');assert.equal(callSettled(r,{itemId,turnId}),'unknown');const full={threadId:'captured-thread',turnId,itemId};const witnessed={request:{method:'item/tool/requestUserInput',params:full},terminal:{method:'turn/completed',params:{threadId:full.threadId,turn:{id:turnId,status:'interrupted'}}}};assert.equal(callSettled(r,full,witnessed),'no-answer');assert.equal(callSettled(r,{itemId,turnId},{cancellationOutput:'request_user_input was cancelled before receiving a response'}),'unknown');assert.equal(matchReceipt(r,itemId,answer),'unknown');assert.equal(matchReceipt(r,itemId,{answers:{}}),'unknown');
});

test('provenance wait is cancelled and slow reads consume its deadline',async t=>{
 const f=fixture(t),a=new AbortController();a.abort();await assert.rejects(findProvenance(f.record,'c',{signal:a.signal}),/abort|interrupted/i);
 let clock=0,reads=0;const slow={read:async()=>{reads++;clock+=200;return {state:'ok',calls:new Map()}}};assert.equal(await findProvenance(slow,'c',{waitMs:100,now:()=>clock}),'unidentified');assert.equal(reads,1);
 const b=new AbortController();await assert.rejects(findProvenance(f.record,'c',{signal:b.signal,sleep:async()=>b.abort()}),/abort|interrupted/i);
});
