import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {serverFixture,until,line,waiting} from './helpers/codex-server.js';
import {params,owner,blue} from './helpers/codex-question.js';
import {answerMessage} from './helpers/interaction.js';
import {toQuestion} from '../src/routes/codex.js';
import {connectRpc} from '../src/serve/codex/rpc.js';
import {openCodexConnector} from '../src/serve/codex/connector.js';
async function start(t,f){const c=await openCodexConnector(f.options);t.after(()=>c.close());return c;}
const responses=f=>f.sent.filter(m=>m.result);
for(const phase of ['queued write','resume replay','provenance'])test(`registry disappears during ${phase}: no unadmitted subscription remains`,async t=>{
 const f=await serverFixture(t),handle=f.handler.handle;
 if(phase==='queued write')f.options.connect=async opts=>{const rpc=await connectRpc(opts),call=rpc.call.bind(rpc);rpc.call=(method,p,before)=>{if(method==='thread/resume')delete f.rows.agents['codex:thread'];return call(method,p,before)};return rpc};
 if(phase==='resume replay')f.handler.handle=async m=>{if(m.method==='thread/resume')delete f.rows.agents['codex:thread'];return handle(m)};
 if(phase==='provenance')await fs.writeFile(f.path,'');
 await start(t,f);
 if(phase==='provenance'){await until(()=>f.count('thread/resume')===1);delete f.rows.agents['codex:thread'];await f.append(line('response_item',{type:'function_call',call_id:'call',name:'request_user_input'}));}
 await until(()=>f.logs.includes('CODEX_JOIN_RACED')||f.count('thread/unsubscribe')>0);await pause(80);
 assert.equal(f.count('thread/resume'),phase==='queued write'?0:1);if(phase!=='queued write')assert.equal(f.count('thread/unsubscribe'),1);
 assert.equal(f.inbox.retained().length,0);assert.equal(responses(f).length,0);
});
test('registry disappearance alone preserves an already admitted question',async t=>{
 const f=await serverFixture(t);await start(t,f);await until(()=>f.inbox.retained().length===1);delete f.rows.agents['codex:thread'];await pause(80);
 assert.equal(f.count('thread/unsubscribe'),0);assert.equal(f.inbox.retained()[0].state,'pending');
});
test('exact terminal during first durable admission survives native idle and write completion',async t=>{
 let release,started=false;const blocked=new Promise(r=>release=r);t.after(()=>release());
 const io={...fs,async rename(from,to){if(!started&&to.includes('/entries/')&&to.endsWith('.json')){started=true;await blocked}return fs.rename(from,to)}};
 const f=await serverFixture(t,{io});await start(t,f);await until(()=>started);
 await f.append(line('response_item',{type:'function_call_output',call_id:'call',output:'aborted by user after 0.1s'})+line('event_msg',{type:'turn_aborted',turn_id:'turn'}));
 f.metadata.status={type:'idle'};f.push({method:'thread/status/changed',params:{threadId:'thread',status:{type:'idle'}}});f.push({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'interrupted'}}});await pause(25);release();
 await until(()=>f.inbox.retained()[0]?.state==='withdrawn');assert.equal(f.inbox.retained()[0].route.terminal,true);assert.equal(f.inbox.retained()[0].withdrawal.reason,'asker-gone');assert.equal(responses(f).length,0);await until(()=>f.count('thread/unsubscribe')===1);
});
for(const initiallyWaiting of [true,false])test(`receipt-only recovery (${initiallyWaiting?'waiting':'idle'}) preserves another active thread and admits a new episode`,async t=>{
 let now=Date.now();const f=await serverFixture(t,{clock:()=>now,status:initiallyWaiting?waiting:{type:'idle'}}),q=toQuestion(params,{id:randomUUID(),now,agentId:'codex:thread',cwd:'/repo'}),bound={...owner,rolloutPath:f.path};
 await f.inbox.codexAsk(q,bound);await f.inbox.answer(q.id,answerMessage(q,{values:{q1:{type:'choice',optionIds:['o1']}}}));await f.inbox.codexHanded(q.id,bound);now+=65000;await f.inbox.sweep();assert.equal(f.inbox.retained()[0].state,'unconfirmed');
 const other={...params,threadId:'other',itemId:'other-call'};f.rows.agents['codex:other']={...f.rows.agents['codex:thread'],id:'codex:other',sessionId:'other'};
 await f.append(line('response_item',{type:'function_call',call_id:'other-call',name:'request_user_input'}));const handle=f.handler.handle;let replay=params;
 f.handler.handle=async m=>{
  if(m.method==='thread/loaded/list')return {data:['thread','other'],nextCursor:null};
  if(m.params?.threadId==='other'){
   if(m.method==='thread/read')return {thread:{...f.metadata,id:'other',status:waiting}};
   if(m.method==='thread/resume'){f.push({id:92,method:'item/tool/requestUserInput',params:other});return {thread:{...f.metadata,id:'other',status:waiting},collaborationMode:{mode:'plan'}};}
  }
  if(m.method==='thread/resume'){f.push({id:91,method:'item/tool/requestUserInput',params:replay});return {thread:{...f.metadata},collaborationMode:{mode:'plan'}};}
  return handle(m);
 };
 await start(t,f);await until(()=>f.inbox.retained().some(e=>e.route.connector.tuple.threadId==='other'));await pause(120);
 assert.equal(f.sent.filter(m=>m.method==='thread/resume'&&m.params.threadId==='thread').length,0);assert.equal(f.count('initialize'),1);assert.equal(f.logs.includes('CODEX_CONNECTION'),false);assert.equal(responses(f).length,0);
 f.metadata.status={type:'idle'};f.push({method:'thread/status/changed',params:{threadId:'thread',status:{type:'idle'}}});await pause(30);
 replay={...params,turnId:'new-turn',itemId:'new-call'};await f.append(line('response_item',{type:'function_call',call_id:'new-call',name:'request_user_input'}));f.metadata.status=waiting;f.push({method:'thread/status/changed',params:{threadId:'thread',status:waiting}});
 await until(()=>f.inbox.retained().some(e=>e.route.connector.tuple.itemId==='new-call'));assert.equal(f.inbox.retained().find(e=>e.id===q.id).state,'unconfirmed');assert.equal(f.count('initialize'),1);
 // Receipt for the retired owner is read-only and still needs its original terminal.
 await f.append(line('response_item',{type:'function_call_output',call_id:'call',output:JSON.stringify(blue)}));await pause(40);assert.equal(f.inbox.retained().find(e=>e.id===q.id).state,'unconfirmed');
});
test('asynchronous registry read keeps the final waiting guard at the actual resume write',async t=>{
 const f=await serverFixture(t);let armed=false,started=false,release;const blocked=new Promise(r=>release=r);t.after(()=>release());const read=f.options.readAgents;
 f.options.readAgents=async()=>{if(armed){started=true;await blocked}return read()};
 f.options.connect=async opts=>{const rpc=await connectRpc(opts),call=rpc.call.bind(rpc);rpc.call=(method,p,before)=>{if(method==='thread/resume')armed=true;return call(method,p,before)};return rpc};
 await start(t,f);await until(()=>started);f.push({method:'thread/status/changed',params:{threadId:'thread',status:{type:'idle'}}});await pause(20);release();await until(()=>f.logs.includes('CODEX_JOIN_RACED'));
 assert.equal(f.count('thread/resume'),0);assert.equal(f.inbox.retained().length,0);
});
test('same-process reconnect never resumes an admitted question that became receipt-only',async t=>{
 let now=Date.now();const f=await serverFixture(t,{clock:()=>now});await start(t,f);await until(()=>f.inbox.retained().length===1);const e=f.inbox.retained()[0];
 await f.inbox.answer(e.id,answerMessage(e.question,{values:{q1:{type:'choice',optionIds:['o1']}}}));await until(()=>responses(f).length===1);now+=65000;await f.inbox.sweep();assert.equal(f.inbox.retained()[0].state,'unconfirmed');
 f.p.socket.destroy();await until(()=>f.count('initialize')===2,3000);await until(()=>f.count('thread/loaded/list')>3);await pause(100);
 assert.equal(f.count('thread/resume'),1);assert.equal(responses(f).length,1);assert.equal(f.inbox.retained()[0].state,'unconfirmed');
});
test('join retired by its RPC deadline never resumes after registry preparation completes',async t=>{
 const f=await serverFixture(t);let armed=false,started=false,release;const blocked=new Promise(r=>release=r);t.after(()=>release());const read=f.options.readAgents;
 f.options.readAgents=async()=>{if(armed){started=true;await blocked}return read()};
 f.options.connect=async opts=>{const rpc=await connectRpc(opts),call=rpc.call.bind(rpc);rpc.call=(method,p,before)=>{if(method==='thread/resume'){armed=true;rpc.timeout=100}return call(method,p,before)};return rpc};
 await start(t,f);await until(()=>started);await until(()=>f.logs.includes('CODEX_JOIN_RACED'));release();await until(()=>f.count('thread/unsubscribe')===1);
 assert.equal(f.count('thread/resume'),0);assert.equal(f.inbox.retained().length,0);assert.equal(responses(f).length,0);
});
