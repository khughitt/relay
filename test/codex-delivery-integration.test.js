import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {openCodexConnector} from '../src/serve/codex/connector.js';
import {connectRpc} from '../src/serve/codex/rpc.js';
import {openInbox} from '../src/serve/inbox.js';
import {expectAnswers} from '../src/routes/index.js';
import {serverFixture,until,line} from './helpers/codex-server.js';
import {answerMessage,deferMessage} from './helpers/interaction.js';
import {params,blue,owner,codexQuestion} from './helpers/codex-question.js';
import {toQuestion} from '../src/routes/codex.js';
import {randomUUID} from 'node:crypto';
async function start(t,f){const c=await openCodexConnector(f.options);t.after(()=>c.close());await until(()=>f.inbox.retained().length===1);return c;}
const output=value=>line('response_item',{type:'function_call_output',call_id:'call',output:JSON.stringify(value)});
const end=()=>({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});
async function answer(f){const e=f.inbox.retained()[0],a=answerMessage(e.question,{values:{q1:{type:'choice',optionIds:['o1']}}});await f.inbox.answer(e.id,a);return a;}
test('durable handed precedes the sole wire response, then exact terminal/output consumes',async t=>{
 const f=await serverFixture(t);await start(t,f);await answer(f);await until(()=>f.sent.some(m=>m.id===91&&m.result));
 assert.equal(f.inbox.retained()[0].state,'handed');assert.deepEqual(f.sent.find(m=>m.id===91&&m.result).result,blue);
 await f.append(output(blue)+line('event_msg',{type:'task_complete',turn_id:'turn'}));f.metadata.status={type:'idle'};f.push(end());
 await until(()=>f.inbox.retained()[0].state==='consumed');assert.equal(f.sent.filter(m=>m.id===91&&m.result).length,1);await until(()=>f.count('thread/unsubscribe')===1);
});
test('late matching rollout after unsubscribe needs the exact protocol terminal',async t=>{
 const f=await serverFixture(t);await start(t,f);await answer(f);await until(()=>f.sent.some(m=>m.id===91&&m.result));
 f.metadata.status={type:'idle'};f.push({method:'thread/status/changed',params:{threadId:'thread',status:{type:'idle'}}});await until(()=>f.count('thread/unsubscribe')===1);
 await f.append(output(blue)+line('event_msg',{type:'task_complete',turn_id:'turn'}));await until(()=>f.inbox.retained()[0].state==='unconfirmed');
 assert.equal(f.inbox.retained()[0].route.terminal,false);assert.equal(f.count('thread/resume'),1);
 // A terminal already in flight is still exact ownership evidence after local release.
 f.push(end());await until(()=>f.inbox.retained()[0].state==='consumed');assert.equal(f.count('thread/resume'),1);
});
test('native first withdraws the question without sending a relay answer',async t=>{
 const f=await serverFixture(t);await start(t,f);await f.append(output(blue));await until(()=>f.inbox.retained()[0].state==='withdrawn');
 assert.equal(f.inbox.retained()[0].withdrawal.reason,'answered-elsewhere');assert.equal(f.sent.filter(m=>m.result).length,0);
});
test('defer sends nothing and later exact native observation updates released history',async t=>{
 const f=await serverFixture(t);await start(t,f);const e=f.inbox.retained()[0];await f.inbox.defer(e.id,deferMessage(e.question));
 await f.append(output(blue)+line('event_msg',{type:'task_complete',turn_id:'turn'}));f.metadata.status={type:'idle'};f.push(end());
 await until(()=>f.inbox.retained()[0].observed!==null);assert.equal(f.inbox.retained()[0].state,'released');assert.deepEqual(f.inbox.retained()[0].observed,blue);assert.equal(f.sent.filter(m=>m.result).length,0);
});
test('resolution during a queued response prevents the actual wire write',async t=>{
 const f=await serverFixture(t);let release;const blocked=new Promise(r=>release=r);let queued=false;
 f.options.connect=async options=>{const rpc=await connectRpc(options),send=rpc.send.bind(rpc);rpc.send=async(m,before)=>{if(m?.result){queued=true;await blocked}return send(m,before)};return rpc};
 await start(t,f);await answer(f);await until(()=>queued);assert.equal(f.inbox.retained()[0].state,'handed');
 f.push({method:'serverRequest/resolved',params:{threadId:'thread',requestId:91}});await pause(20);release();await pause(50);
 assert.equal(f.sent.filter(m=>m.result).length,0);
});
for(const secret of [true,false])test(`changed ${secret?'secret':'ordinary'} replay revokes a queued answer at receipt`,async t=>{
 const f=await serverFixture(t);let release;const blocked=new Promise(r=>release=r);let queued=false;
 f.options.connect=async options=>{const rpc=await connectRpc(options),send=rpc.send.bind(rpc);rpc.send=async(m,before)=>{if(m?.result){queued=true;await blocked}return send(m,before)};return rpc};
 await start(t,f);await answer(f);await until(()=>queued);
 f.push({id:92,method:'item/tool/requestUserInput',params:{...params,questions:[{...params.questions[0],isSecret:secret,question:'CHANGED PRIVATE QUESTION'}]}});await pause(20);release();await pause(50);assert.equal(f.sent.filter(m=>m.result).length,0);assert.ok(!JSON.stringify(f.inbox.retained()).includes('CHANGED PRIVATE'));
});
test('matching replay during writer lag keeps one immutable inbox identity',async t=>{
 const f=await serverFixture(t);await import('node:fs/promises').then(fs=>fs.writeFile(f.path,''));const c=await openCodexConnector(f.options);t.after(()=>c.close());
 await until(()=>f.count('thread/resume')===1);f.push({id:92,method:'item/tool/requestUserInput',params});
 await f.append(line('response_item',{type:'function_call',call_id:'call',name:'request_user_input'}));await until(()=>f.inbox.retained().length===1);await pause(60);assert.equal(f.inbox.retained().length,1);assert.equal(f.logs.length,0);
});
test('private durable rollout binding survives reload for receipt without resubscribing',async t=>{
 const f=await serverFixture(t),q=codexQuestion({createdAt:Date.now()}),bound={...owner,rolloutPath:f.path};
 await f.inbox.codexAsk(q,bound);const loaded=await openInbox({stateDir:f.state.stateDir,expectAnswers});assert.equal(loaded.rejected.length,0);assert.equal(loaded.inbox.retained()[0].route.connector.rolloutPath,f.path);
});
test('receipt after the confirmation deadline consumes from a fresh read without a join',async t=>{
 let now=Date.now();const f=await serverFixture(t,{clock:()=>now});await start(t,f);await answer(f);await until(()=>f.sent.some(m=>m.result));
 f.metadata.status={type:'idle'};f.push(end());await until(()=>f.count('thread/unsubscribe')===1);
 now+=65000;await f.inbox.sweep();assert.equal(f.inbox.retained()[0].state,'unconfirmed');
 await f.append(output(blue)+line('event_msg',{type:'task_complete',turn_id:'turn'}));await until(()=>f.inbox.retained()[0].state==='consumed');assert.equal(f.count('thread/resume'),1);
});
for(const [name,actual,declined,want] of [
 ['mismatch',{answers:{'color-id':{answers:['Red']}}},false,'unconfirmed'],
 ['empty-map value equality',{answers:{}},true,'consumed'],
 ['native unanswered array',{answers:{'color-id':{answers:[]}}},true,'unconfirmed']
])test(`${name} preserves full native values and exact receipt semantics`,async t=>{
 const f=await serverFixture(t);await start(t,f);const q=f.inbox.retained()[0].question;
 if(declined)await f.inbox.answer(q.id,answerMessage(q,{outcome:'declined',values:{}}));else await answer(f);
 await until(()=>f.sent.some(m=>m.result));await f.append(output(actual)+line('event_msg',{type:'task_complete',turn_id:'turn'}));f.metadata.status={type:'idle'};f.push(end());
 await until(()=>f.inbox.retained()[0].state===want);assert.deepEqual(f.inbox.retained()[0].observed,actual);
});
for(const handed of [false,true])test(`structural non-answer ${handed?'after':'before'} handoff is never consumed`,async t=>{
 const f=await serverFixture(t);await start(t,f);if(handed){await answer(f);await until(()=>f.sent.some(m=>m.result))}
 await f.append(line('response_item',{type:'function_call_output',call_id:'call',output:'arbitrary native non-answer'})+line('event_msg',{type:'turn_aborted',turn_id:'turn'}));f.metadata.status={type:'idle'};f.push({...end(),params:{threadId:'thread',turn:{id:'turn',status:'interrupted'}}});
 await until(()=>f.inbox.retained()[0].state===(handed?'unconfirmed':'withdrawn'));assert.equal(f.inbox.retained()[0].observed,null);
});
test('an old turn terminal cannot revoke a new turn request',async t=>{
 const f=await serverFixture(t),oldParams={...params,turnId:'old',itemId:'old-call'},q=toQuestion(oldParams,{id:randomUUID(),now:Date.now(),agentId:'codex:thread',cwd:'/repo'});
 await f.inbox.codexAsk(q,{...owner,tuple:{threadId:'thread',turnId:'old',itemId:'old-call'}});await f.inbox.defer(q.id,deferMessage(q));
 const c=await openCodexConnector(f.options);t.after(()=>c.close());await until(()=>f.inbox.retained().length===2);
 f.push({method:'turn/completed',params:{threadId:'thread',turn:{id:'old',status:'completed'}}});await pause(30);
 const current=f.inbox.retained().find(e=>e.id!==q.id);await f.inbox.answer(current.id,answerMessage(current.question,{values:{q1:{type:'choice',optionIds:['o1']}}}));
 await until(()=>f.sent.some(m=>m.result));assert.equal(f.count('thread/unsubscribe'),0);
});
test('wrong replay cannot inherit a durable saved answer',async t=>{
 const f=await serverFixture(t),q=toQuestion({...params,turnId:'old',itemId:'old-call'},{id:randomUUID(),now:Date.now(),agentId:'codex:thread',cwd:'/repo'});
 await f.inbox.codexAsk(q,{...owner,tuple:{threadId:'thread',turnId:'old',itemId:'old-call'}});await f.inbox.answer(q.id,answerMessage(q));
 const c=await openCodexConnector(f.options);t.after(()=>c.close());await until(()=>f.logs.includes('CODEX_JOIN_RACED'));assert.equal(f.sent.filter(m=>m.result).length,0);assert.equal(f.inbox.retained().length,1);assert.equal(f.inbox.retained()[0].id,q.id);
});
test('socket loss alone does not settle an unanswered question',async t=>{
 const f=await serverFixture(t);await start(t,f);f.push({method:'serverRequest/resolved',params:{threadId:'thread',requestId:999}});f.p.socket.destroy();await pause(60);assert.equal(f.inbox.retained()[0].state,'pending');
});
test('persisted owner-bound terminal settles structural no-answer after reload',async t=>{
 const f=await serverFixture(t,{status:{type:'idle'}}),q=toQuestion(params,{id:randomUUID(),now:Date.now(),agentId:'codex:thread',cwd:'/repo'}),bound={...owner,rolloutPath:f.path};
 await f.inbox.codexAsk(q,bound);await f.inbox.codexObserve(q.id,bound,{answers:null,terminal:true});
 await f.append(line('response_item',{type:'function_call_output',call_id:'call',output:'native non-answer'})+line('event_msg',{type:'turn_aborted',turn_id:'turn'}));
 const {inbox}=await openInbox({stateDir:f.state.stateDir,expectAnswers});const c=await openCodexConnector({...f.options,inbox});t.after(()=>c.close());await until(()=>inbox.retained()[0].state==='withdrawn');assert.equal(f.count('thread/resume'),0);
});
