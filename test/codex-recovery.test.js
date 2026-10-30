import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serverFixture,until,line} from './helpers/codex-server.js';
import {params,blue,owner} from './helpers/codex-question.js';
import {toQuestion} from '../src/routes/codex.js';
import {answerMessage} from './helpers/interaction.js';
import {openCodexConnector} from '../src/serve/codex/connector.js';
for(const state of ['answered','handed'])test(`fresh process recovers ${state} only through exact pending replay`,{timeout:7000},async t=>{
 const f=await serverFixture(t),q=toQuestion(params,{id:randomUUID(),now:Date.now(),agentId:'codex:thread',cwd:'/repo'}),bound={...owner,rolloutPath:f.path};
 await f.inbox.codexAsk(q,bound);const answer=answerMessage(q,{values:{q1:{type:'choice',optionIds:['o1']}}});await f.inbox.answer(q.id,answer);if(state==='handed')await f.inbox.codexHanded(q.id,bound);
 const file=join(f.state.stateDir,'worker.json');await writeFile(file,JSON.stringify({stateDir:f.state.stateDir,config:f.options.config,handle:owner.generationBinding,rows:f.rows}),{mode:0o600});
 const child=spawn(process.execPath,[new URL('./fixtures/codex-recovery-worker.js',import.meta.url).pathname,file],{env:{PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:f.state.stateDir,USER:'fixture',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:['ignore','pipe','pipe','ipc']});
 let stderr='';child.stderr.on('data',b=>{stderr+=b;if(stderr.length>8192)child.kill('SIGTERM')});child.stdout.resume();
 const ended=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));t.after(async()=>{if(child.exitCode===null)child.kill('SIGTERM');await ended;});
 const result=new Promise(resolve=>child.on('message',m=>{if(m.entry&&!m.phase)resolve(m)}));
 await until(()=>f.sent.some(m=>m.id===91&&m.result));assert.deepEqual(f.sent.find(m=>m.id===91&&m.result).result,blue);
 await f.append(line('response_item',{type:'function_call_output',call_id:'call',output:JSON.stringify(blue)})+line('event_msg',{type:'task_complete',turn_id:'turn'}));f.metadata.status={type:'idle'};f.push({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});
 const message=await result,exit=await ended;assert.equal(exit.code,0,stderr);assert.equal(message.rejected,0);assert.equal(message.entry.id,q.id);assert.equal(message.entry.answer.body.answerId,answer.body.answerId);assert.deepEqual(message.entry.observed,blue);assert.equal(f.sent.filter(m=>m.id===91&&m.result).length,1);
});
for(const boundary of ['handed','wire','receipt'])test(`actual crash at ${boundary} preserves durable identity and excludes unsafe replay`,{timeout:8000},async t=>{
 const f=await serverFixture(t),answerId=randomUUID(),file=join(f.state.stateDir,'crash-worker.json');
 const base={stateDir:f.state.stateDir,config:f.options.config,handle:owner.generationBinding,rows:f.rows,answerId};
 async function worker(extra){
  await writeFile(file,JSON.stringify({...base,...extra}),{mode:0o600});
  const child=spawn(process.execPath,[new URL('./fixtures/codex-recovery-worker.js',import.meta.url).pathname,file],{env:{PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:f.state.stateDir,USER:'fixture',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:['ignore','pipe','pipe','ipc']});child.stdout.resume();child.stderr.resume();
  const messages=[];child.on('message',m=>messages.push(m));const ended=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await ended;});return {child,messages,ended};
 }
 const first=await worker({crashAt:boundary,autoAnswer:true});
 if(boundary==='receipt'){
  await until(()=>first.messages.some(m=>m.phase==='wire'),3000);await f.append(line('response_item',{type:'function_call_output',call_id:'call',output:JSON.stringify(blue)})+line('event_msg',{type:'task_complete',turn_id:'turn'}));f.metadata.status={type:'idle'};f.push({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});
 }
 await until(()=>first.messages.some(m=>m.phase===boundary),3000);const saved=first.messages.find(m=>m.phase===boundary).entry;assert.equal(saved.answer.body.answerId,answerId);
 first.child.kill('SIGKILL');assert.equal((await first.ended).signal,'SIGKILL');
 if(boundary==='wire'){await f.append(line('response_item',{type:'function_call_output',call_id:'call',output:JSON.stringify(blue)})+line('event_msg',{type:'task_complete',turn_id:'turn'}));f.metadata.status={type:'idle'};}
 const second=await worker({want:boundary==='wire'?'unconfirmed':'consumed'});
 if(boundary==='handed'){
  await until(()=>f.sent.some(m=>m.id===91&&m.result));await f.append(line('response_item',{type:'function_call_output',call_id:'call',output:JSON.stringify(blue)})+line('event_msg',{type:'task_complete',turn_id:'turn'}));f.metadata.status={type:'idle'};f.push({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});
 }
 await until(()=>second.messages.some(m=>m.entry&&!m.phase),3000);const restored=second.messages.find(m=>m.entry&&!m.phase).entry;assert.equal((await second.ended).code,0);
 assert.equal(restored.id,saved.id);assert.equal(restored.answer.body.answerId,answerId);assert.equal(restored.state,boundary==='wire'?'unconfirmed':'consumed');assert.equal(f.sent.filter(m=>m.id===91&&m.result).length,1);
});
for(const [state,want] of [['pending','withdrawn'],['answered','undeliverable'],['handed','unconfirmed']])test(`fresh connector detects persisted daemon replacement for ${state}`,async t=>{
 const f=await serverFixture(t),q=toQuestion(params,{id:randomUUID(),now:Date.now(),agentId:'codex:thread',cwd:'/repo'}),bound={...owner,rolloutPath:f.path};await f.inbox.codexAsk(q,bound);
 if(state!=='pending')await f.inbox.answer(q.id,answerMessage(q));if(state==='handed')await f.inbox.codexHanded(q.id,bound);
 f.options.identity=async()=>({...owner.generationBinding,pid:4343,start:'200'});const c=await openCodexConnector(f.options);t.after(()=>c.close());await until(()=>f.inbox.retained()[0].state===want);
 assert.equal(f.inbox.retained()[0].observed,null);assert.equal(f.sent.filter(m=>m.result).length,0);
});
test('a replacement terminal with reused tuple cannot confirm the previous daemon output',async t=>{
 const f=await serverFixture(t),q=toQuestion(params,{id:randomUUID(),now:Date.now(),agentId:'codex:thread',cwd:'/repo'}),bound={...owner,rolloutPath:f.path};await f.inbox.codexAsk(q,bound);await f.inbox.answer(q.id,answerMessage(q,{values:{q1:{type:'choice',optionIds:['o1']}}}));await f.inbox.codexHanded(q.id,bound);
 await f.append(line('response_item',{type:'function_call_output',call_id:'call',output:JSON.stringify(blue)})+line('event_msg',{type:'task_complete',turn_id:'turn'}));
 f.options.identity=async()=>({...owner.generationBinding,pid:4343,start:'200'});const c=await openCodexConnector(f.options);t.after(()=>c.close());await until(()=>f.count('thread/loaded/list')>1);assert.equal(f.count('thread/resume'),0);
 f.push({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});await new Promise(r=>setTimeout(r,60));assert.equal(f.inbox.retained()[0].state,'unconfirmed');assert.equal(f.inbox.retained()[0].route.terminal,false);
});
