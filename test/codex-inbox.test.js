import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {openInbox} from '../src/serve/inbox.js';
import {expectAnswers} from '../src/routes/index.js';
import {validateEntry} from '../src/interaction/lifecycle.js';
import {tempState} from './helpers/fixture.js';
import {answerMessage,deferMessage,NOW,HANDLE} from './helpers/interaction.js';
import {codexQuestion,owner,blue,red} from './helpers/codex-question.js';
async function setup(t){const p=await tempState(t);let now=NOW;const open=()=>openInbox({stateDir:p.stateDir,expectAnswers,clock:()=>now});const {inbox}=await open();await inbox.setPresence('away');assert.equal(typeof inbox.codexAsk,'function');return {p,inbox,open,advance:ms=>now+=ms};}
async function ask(inbox,q=codexQuestion()){const r=await inbox.codexAsk(q,owner);assert.equal(r.error,null);return q;}
const save=(i,q,body={})=>i.answer(q.id,answerMessage(q,{values:{q1:{type:'choice',optionIds:['o1']}},...body}));
test('Codex owner is durable, never a hook waiter, and immutable on replay',async t=>{
 const {inbox,open}=await setup(t),q=await ask(inbox);assert.equal('waiter' in inbox.get(q.id).route,false);assert.equal((await inbox.handed(q.id,HANDLE)).error.code,'NOT_WAITER');await assert.rejects(inbox.ask(q,{handback:true,waiter:HANDLE}),{code:'UNSUPPORTED_ROUTE'});await assert.rejects(inbox.confirm({harness:'codex',callId:q.body.native.callId,observed:{}}),{code:'UNSUPPORTED_ROUTE'});
 assert.equal((await inbox.codexAsk(q,{...owner,generationBinding:{...owner.generationBinding,pid:4243}})).error.code,'OWNER_CONFLICT');assert.equal((await open()).rejected.length,0);assert.deepEqual((await open()).inbox.get(q.id).route.connector,owner);
});
for(const [label,answers,terminal,want] of [['matching without terminal',blue,false,'unconfirmed'],['matching and terminal',blue,true,'consumed'],['mismatch',red,true,'unconfirmed'],['native unanswered',{answers:{'color-id':{answers:[]}}},true,'unconfirmed']])test('Codex handed receipt: '+label,async t=>{
 const {inbox,open}=await setup(t),q=await ask(inbox);await save(inbox,q);await inbox.codexHanded(q.id,owner);const r=await inbox.codexObserve(q.id,owner,{answers,terminal});assert.equal(r.entry.state,want);assert.deepEqual(r.entry.observed,answers);validateEntry(r.entry);const opened=await open();assert.deepEqual(opened.rejected,[]);assert.deepEqual(opened.inbox.get(q.id).observed,answers);
});
test('later exact terminal confirms stored matching output after the confirmation window and durable restart',async t=>{
 const {inbox,open,advance}=await setup(t),q=await ask(inbox);await save(inbox,q);await inbox.codexHanded(q.id,owner);await inbox.codexObserve(q.id,owner,{answers:blue,terminal:false});advance(65000);const next=(await open()).inbox;assert.equal(next.get(q.id).state,'unconfirmed');await next.codexObserve(q.id,owner,{answers:null,terminal:true});assert.equal(next.get(q.id).state,'unconfirmed');const r=await next.codexObserve(q.id,owner,{answers:blue,terminal:true});assert.equal(r.entry.state,'consumed');validateEntry(r.entry);
});
for(const stage of ['pending','answered','handed'])test('replacement settles only Codex lifecycle at '+stage,async t=>{
 const {inbox,open}=await setup(t),q=await ask(inbox);if(stage!=='pending')await save(inbox,q);if(stage==='handed')await inbox.codexHanded(q.id,owner);const r=await inbox.codexGone(q.id,owner,'replacement');assert.equal(r.entry.state,{pending:'withdrawn',answered:'undeliverable',handed:'unconfirmed'}[stage]);if(stage==='pending')assert.equal(r.entry.withdrawal.reason,'asker-gone');assert.equal(r.entry.observed,null);assert.equal((await open()).rejected.length,0);validateEntry(r.entry);
});
test('native answer first withdraws pending; a saved unhanded answer is retained undeliverable',async t=>{
 for(const saved of [false,true]){const {inbox,open}=await setup(t),q=await ask(inbox);if(saved)await save(inbox,q);const r=await inbox.codexObserve(q.id,owner,{answers:red,terminal:false});assert.equal(r.entry.state,saved?'undeliverable':'withdrawn');if(!saved)assert.equal(r.entry.withdrawal.reason,'answered-elsewhere');assert.deepEqual(r.entry.observed,red);assert.equal((await open()).rejected.length,0);}
});
test('defer/retry/history stays released and all retained entries are available internally',async t=>{
 const {inbox,open}=await setup(t),q=await ask(inbox),m=deferMessage(q);await inbox.defer(q.id,m);await inbox.codexObserve(q.id,owner,{answers:{answers:{'color-id':{answers:[]}}},terminal:true});assert.equal(inbox.get(q.id).state,'released');assert.equal(inbox.list().length,0);assert.equal(inbox.retained().length,1);assert.equal((await inbox.defer(q.id,m)).error.code,'RELEASED');assert.equal((await open()).rejected.length,0);
});
test('decline receipt is exact root equality and never matches per-question empty arrays',async t=>{
 const {inbox}=await setup(t),q=await ask(inbox);await save(inbox,q,{outcome:'declined',values:{}});await inbox.codexHanded(q.id,owner);await inbox.codexObserve(q.id,owner,{answers:{answers:{'color-id':{answers:[]}}},terminal:true});assert.equal(inbox.get(q.id).state,'unconfirmed');
});
test('Codex operations reject wrong owner, malformed output and forged durable route',async t=>{
 const {inbox,p,open}=await setup(t),q=await ask(inbox);await save(inbox,q);assert.equal((await inbox.codexHanded(q.id,{...owner,tuple:{...owner.tuple,itemId:'other'}})).error.code,'NOT_OWNER');await assert.rejects(inbox.codexObserve(q.id,owner,{answers:{answers:{'color-id':{answers:[42]}}},terminal:true}));
 const path=join(p.stateDir,'inbox','entries',q.id+'.json');const original=inbox.get(q.id),forged={...original,route:{...original.route,waiter:HANDLE}};assert.throws(()=>validateEntry(forged));
});

test('durable Codex consumed state requires actual matching native value and terminal evidence',async t=>{
 const {inbox}=await setup(t),q=await ask(inbox);await save(inbox,q);await inbox.codexHanded(q.id,owner);await inbox.codexObserve(q.id,owner,{answers:blue,terminal:true});const e=inbox.get(q.id);
 assert.throws(()=>validateEntry({...e,observed:red,observations:e.observations.map(x=>({...x,answers:red}))}));assert.throws(()=>validateEntry({...e,route:{...e.route,terminal:false}}));
});
