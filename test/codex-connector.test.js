import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {serverFixture,until,line,waiting} from './helpers/codex-server.js';
import {params} from './helpers/codex-question.js';
import {connectRpc} from '../src/serve/codex/rpc.js';
const mod=await import('../src/serve/codex/connector.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
async function start(t,f){assert.equal(typeof mod.openCodexConnector,'function');const c=await mod.openCodexConnector(f.options);t.after(()=>c.close());return c;}
test('waiting native thread admits one immutable question through real RPC and store',async t=>{
 const f=await serverFixture(t);await start(t,f);await until(()=>f.inbox.retained().length===1);
 const [e]=f.inbox.retained();assert.equal(e.state,'pending');assert.equal(e.question.body.native.callId,'["thread","turn","call"]');
 assert.equal(f.count('thread/resume'),1);assert.deepEqual(f.sent.find(m=>m.method==='thread/resume').params,{threadId:'thread',excludeTurns:true});
 assert.equal(f.count('turn/start'),0);assert.equal(f.logs.length,0);
});
test('raced join unsubscribes, emits only a code and never retries the waiting episode',async t=>{
 const f=await serverFixture(t,{replay:false});await start(t,f);await until(()=>f.logs.includes('CODEX_JOIN_RACED')&&f.count('thread/unsubscribe')===1);
 assert.equal(f.inbox.retained().length,0);assert.equal(f.count('thread/unsubscribe'),1);await pause(120);assert.equal(f.count('thread/resume'),1);
 assert.deepEqual(f.logs,['CODEX_JOIN_RACED']);
});
for(const [name,opts] of [['idle',{status:{type:'idle'}}],['title helper',{source:'thread_title',ephemeral:true}],['system helper',{source:'system',ephemeral:true}],['here',{presence:'here'}]])test(`${name} never joins or retains a question`,async t=>{
 const f=await serverFixture(t,opts);await start(t,f);await until(()=>f.count('thread/loaded/list')>1);assert.equal(f.count('thread/resume'),0);assert.equal(f.inbox.retained().length,0);
});
test('unselected auto-attach releases immediately and never persists its content',async t=>{
 const f=await serverFixture(t,{presence:'here'});await start(t,f);await until(()=>f.count('initialize'));
 f.push({method:'thread/started',params:{thread:{id:'foreign',preview:'PRIVATE AUTO CONTENT',ephemeral:false,status:waiting}}});
 await until(()=>f.sent.some(m=>m.method==='thread/unsubscribe'&&m.params.threadId==='foreign'));
 assert.equal(f.inbox.retained().length,0);assert.ok(!JSON.stringify(f.logs).includes('PRIVATE'));assert.equal(f.count('thread/resume'),0);
});
test('unknown process liveness cannot authorize a waiting join',async t=>{
 const f=await serverFixture(t);f.options.processOps.probe=()=>({status:'unknown'});await start(t,f);await until(()=>f.count('thread/loaded/list')>1);assert.equal(f.count('thread/resume'),0);
});
test('idle status releases an admitted subscription even while its registry row lives',async t=>{
 const f=await serverFixture(t);await start(t,f);await until(()=>f.inbox.retained().length===1);
 f.metadata.status={type:'idle'};f.push({method:'thread/status/changed',params:{threadId:'thread',status:{type:'idle'}}});
 await until(()=>f.count('thread/unsubscribe')===1);assert.equal(f.inbox.retained()[0].state,'pending');assert.equal(f.count('thread/resume'),1);
});
test('provenance waits for the earlier call write and expiry stays native',async t=>{
 const f=await serverFixture(t);await import('node:fs/promises').then(fs=>fs.writeFile(f.path,''));await start(t,f);
 await until(()=>f.count('thread/resume')===1);assert.equal(f.inbox.retained().length,0);
 await f.append(line('response_item',{type:'function_call',call_id:'call',name:'request_user_input'}));await until(()=>f.inbox.retained().length===1);
});
test('ineligible supersession revokes the old question without retaining secret content',async t=>{
 const f=await serverFixture(t);await start(t,f);await until(()=>f.inbox.retained().length===1);
 f.push({id:92,method:'item/tool/requestUserInput',params:{...params,itemId:'new',questions:[{...params.questions[0],isSecret:true,question:'PRIVATE SECRET'}]}});
 await until(()=>f.inbox.retained()[0].state==='withdrawn');assert.equal(f.inbox.retained().length,1);assert.ok(!JSON.stringify(f.inbox.retained()).includes('PRIVATE SECRET'));
});
test('provenance expiry never publishes or retries an unidentified request',async t=>{
 const f=await serverFixture(t);await import('node:fs/promises').then(fs=>fs.writeFile(f.path,''));f.options.provenanceMs=0;await start(t,f);
 await until(()=>f.count('thread/unsubscribe')===1);await pause(70);assert.equal(f.inbox.retained().length,0);assert.equal(f.count('thread/resume'),1);
});
test('incomplete loaded pages authorize no joins',async t=>{
 const f=await serverFixture(t),handle=f.handler.handle;f.handler.handle=m=>m.method==='thread/loaded/list'?{data:['thread'],nextCursor:'repeated'}:handle(m);
 await start(t,f);await until(()=>f.logs.length>0);assert.equal(f.count('thread/resume'),0);assert.equal(f.inbox.retained().length,0);
});
test('registry loss during metadata read prevents resume',async t=>{
 const f=await serverFixture(t),handle=f.handler.handle;f.handler.handle=async m=>{const r=await handle(m);if(m.method==='thread/read')delete f.rows.agents['codex:thread'];return r};
 await start(t,f);await until(()=>f.count('thread/loaded/list')>1);assert.equal(f.count('thread/resume'),0);
});
test('process death before the actual resume write prevents that frame',async t=>{
 const f=await serverFixture(t);f.options.connect=async opts=>{const rpc=await connectRpc(opts),call=rpc.call.bind(rpc);rpc.call=(method,params,before)=>{if(method==='thread/resume')f.options.processOps.probe=()=>({status:'dead'});return call(method,params,before)};return rpc};
 await start(t,f);await until(()=>f.logs.includes('CODEX_JOIN_RACED'));assert.equal(f.count('thread/resume'),0);assert.equal(f.inbox.retained().length,0);
});
test('late waiting status admits a thread that was initially idle',async t=>{
 const f=await serverFixture(t,{status:{type:'idle'}});await start(t,f);await until(()=>f.count('thread/loaded/list')>1);assert.equal(f.count('thread/resume'),0);
 f.metadata.status=waiting;f.push({method:'thread/status/changed',params:{threadId:'thread',status:waiting}});await until(()=>f.inbox.retained().length===1);assert.equal(f.count('thread/resume'),1);
});
test('helper exclusion does not exclude a non-ephemeral title-sourced thread',async t=>{
 const f=await serverFixture(t,{source:'thread_title',ephemeral:false});await start(t,f);await until(()=>f.inbox.retained().length===1);assert.equal(f.count('thread/resume'),1);
});
