import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/serve/codex/delivery.js').catch(()=>({}));
const tuple={threadId:'thread',turnId:'turn',itemId:'first'};
const q={id:'color',header:'Color',question:'Choose',isSecret:false,isOther:true,options:[{label:'Blue',description:'Blue choice'}]};
const request=(itemId='first',extra={})=>({id:1,method:'item/tool/requestUserInput',params:{...tuple,itemId,isBlocking:true,questions:[q],...extra}});
const answer={answers:{color:{answers:['Blue']}}};
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:()=>resolve()}};
function guard(options={}) {assert.equal(typeof module.createRequestDelivery,'function');const sent=[],events=[];return {sent,events,g:module.createRequestDelivery({send:async m=>{sent.push(m);events.push('send')},onSuperseded:async t=>events.push('revoke:'+t.itemId),...options})}}
async function active(g,r=request()){await g.observe(r);assert.equal(await g.admit(r.params,true),true)}
test('same-turn successor revokes old delivery before queued preparation and filtering',async()=>{
 for(const extra of [{},{questions:[{...q,id:'mcp_tool_call_approval_x'}]},{questions:[{...q,isSecret:true}]},{questions:[{...q,id:'skill-prompt'}]}]) {
  const gate=deferred(),events=[];const {g,sent}=guard({onSuperseded:async t=>{events.push('withdraw:'+t.itemId);await gate.promise;events.push('withdrawn')}});await active(g);
  const second=request('second',extra),observed=g.observe(second),old=g.sendAnswer(tuple,answer);await assert.rejects(old,/revoked/);
  let admitted=false;const admission=g.admit(second.params,false).then(x=>{admitted=true;return x});await Promise.resolve();assert.equal(admitted,false);gate.resolve();await observed;assert.equal(await admission,false);assert.deepEqual(events,['withdraw:first','withdrawn']);assert.deepEqual(sent,[]);g.close();
 }
});
test('last pre-send ownership recheck blocks a queued old answer',async()=>{
 const {g,sent}=guard();await active(g);const pending=g.sendAnswer(tuple,answer);const r=request('second');await g.observe(r);await assert.rejects(pending,/revoked/);await g.admit(r.params,true);await g.sendAnswer(r.params,answer);assert.equal(sent.length,1);g.close();
});
test('same tuple replay only updates address while changed immutable data revokes',async()=>{
 const {g,sent}=guard();await active(g);const replay={...request(),id:99};await g.observe(replay);await g.sendAnswer(tuple,answer);assert.equal(sent[0].id,99);
 await assert.rejects(g.observe(request('first',{questions:[{...q,question:'Changed'}]})),/conflict/);await assert.rejects(g.sendAnswer(tuple,answer),/revoked/);g.close();
});
test('other thread or turn does not supersede and resolved only retires matching tuple',async()=>{
 const {g,sent}=guard();await active(g);for(const extra of [{turnId:'else'},{threadId:'else'}])await active(g,request('second',extra));
 g.resolved({...tuple,itemId:'else'});await g.sendAnswer(tuple,answer);assert.equal(sent.length,1);g.resolved(tuple);await assert.rejects(g.sendAnswer(tuple,answer),/revoked/);g.close();
});
test('failed supersession keeps both tuples revoked and never admits successor',async()=>{
 const {g,sent}=guard({onSuperseded:async()=>{throw Error('withdraw-failed')}});await active(g);const next=request('second');await assert.rejects(g.observe(next),/withdraw-failed/);await assert.rejects(g.admit(next.params,true),/revoked/);await assert.rejects(g.sendAnswer(tuple,answer),/revoked/);assert.deepEqual(sent,[]);g.close();
});
test('closed connection cannot send, admit or resurrect by replay',async()=>{
 const {g,sent}=guard();await active(g);g.close();await assert.rejects(g.sendAnswer(tuple,answer),/revoked/);await assert.rejects(g.observe({...request(),id:7}),/closed/);await assert.rejects(g.admit(tuple,true),/revoked/);assert.deepEqual(sent,[]);
 const fresh=guard();await active(fresh.g,{...request(),id:'new-connection'});await fresh.g.sendAnswer(tuple,answer);assert.equal(fresh.sent[0].id,'new-connection');fresh.g.close();
});
test('malformed request tuples fail before changing live ownership',async()=>{
 const {g,sent}=guard();await active(g);
 for(const r of [request(''),request('second',{turnId:''}),{...request(),id:null},{...request(),id:1.5},{...request(),method:'other'}])await assert.rejects(g.observe(r),/request/);
 await g.sendAnswer(tuple,answer);assert.equal(sent.length,1);g.close();
});
test('answers validate complete native map and one string per question before sending',async()=>{
 const {g,sent}=guard();await active(g);
 for(const body of [null,{},[],{answers:[]},{answers:{unknown:{answers:['Blue']}}},{answers:{color:{answers:[42]}}},{answers:{color:{answers:[]}}},{answers:{color:{answers:['Blue','Blue']}}},{answers:{color:'Blue'}},{answers:{color:{answers:['Blue'],extra:true}}},{answers:{color:{answers:['Blue']}},extra:true}])await assert.rejects(g.sendAnswer(tuple,body),/answer/);
 assert.deepEqual(sent,[]);for(const body of [answer,{answers:{color:{answers:['Other custom']}}},{answers:{}}])await g.sendAnswer(tuple,body);assert.equal(sent.length,3);g.close();
});
test('choice-only, multi-item and unsupported secret/nonblocking forms are enforced',async()=>{
 const {g,sent}=guard();await active(g,request('first',{questions:[{...q,isOther:false},{...q,id:'second',isOther:false}]}));
 await assert.rejects(g.sendAnswer(tuple,answer),/answer/);await assert.rejects(g.sendAnswer(tuple,{answers:{color:{answers:['custom']},second:{answers:['Blue']}}}),/answer/);
 await g.sendAnswer(tuple,{answers:{color:{answers:['Blue']},second:{answers:['Blue']}}});assert.equal(sent.length,1);g.close();
 for(const extra of [{isBlocking:false},{questions:[{...q,isSecret:true}]},{questions:[{...q,options:null}]},{questions:[{...q,options:[]}]},{questions:[q,q]}]){
  const f=guard();await assert.rejects((async()=>{await active(f.g,request('first',extra));await f.g.sendAnswer(tuple,answer)})(),/unsupported/);assert.deepEqual(f.sent,[]);f.g.close();
 }
});
test('duplicate option labels refuse admission before broader form checks',async()=>{
 const {g,sent}=guard();await g.observe(request('first',{questions:[{...q,options:[{label:'Blue'},{label:'Blue'}]}]}));await assert.rejects(g.admit(tuple,true),/unsupported/);assert.deepEqual(sent,[]);g.close();
});

test('native-only decision cannot be re-admitted by a changed replay',async()=>{
 const {g,sent}=guard();await g.observe(request());assert.equal(await g.admit(tuple,false),false);
 await g.observe(request('first',{questions:[{...q,question:'PRIVATE changed unsupported payload'}]}));assert.equal(await g.admit(tuple,true),false);await assert.rejects(g.sendAnswer(tuple,answer),/revoked/);assert.deepEqual(sent,[]);g.close();
});
test('request bookkeeping has a finite connection bound and oversized projection cannot retain send authority',async()=>{
 const {g}=guard();for(let i=0;i<4096;i++){const r=request('call'+i,{turnId:'turn'+i});await g.observe(r);await g.admit(r.params,false);}await assert.rejects(g.observe(request('extra',{turnId:'extra'})),/request-limit/);g.close();
 const h=guard();await active(h.g);await assert.rejects(h.g.observe(request('new',{questions:[{...q,question:'x'.repeat(1024*1024)}]})),/request-limit/);await assert.rejects(h.g.sendAnswer(tuple,answer),/revoked/);h.g.close();
});
