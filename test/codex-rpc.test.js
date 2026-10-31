import test from 'node:test';
import assert from 'node:assert/strict';
import {inspect} from 'node:util';
import {connectRpc,Rpc} from '../src/serve/codex/rpc.js';
import {frame,peer,until} from './helpers/codex-wire.js';
async function setup(t,onMessage=()=>{}) {
 const p=await peer(t),a=new AbortController(),rpc=await connectRpc({socketPath:p.path,signal:a.signal,onMessage});t.after(()=>rpc.close());return {p,rpc,a};
}
test('RPC routes correlated replies and discards unrelated content without retaining a transcript',async t=>{
 const {p,rpc}=await setup(t),call=rpc.call('thread/list',{limit:100});await until(()=>p.received.length);
 const req=JSON.parse(p.received[0].payload);assert.deepEqual(req,{id:1,method:'thread/list',params:{limit:100}});
 p.socket.write(frame(JSON.stringify({method:'unrelated/event',params:{secret:'PRIVATE-UNRELATED'}})));
 p.socket.write(frame(JSON.stringify({id:req.id,result:{data:['thread']}})));assert.deepEqual(await call,{data:['thread']});assert.ok(!inspect(rpc,{depth:4}).includes('PRIVATE-UNRELATED'));
});
for(const m of [{method:'account/chatgptAuthTokens/refresh',id:8},{id:1,result:{},error:{message:'PRIVATE'}},null])test('invalid RPC envelope disconnects and refuses pending/new calls: '+JSON.stringify(m),async t=>{
 const {p,rpc}=await setup(t),call=rpc.call('thread/read',{threadId:'t'}),rejected=assert.rejects(call,/invalid-message/);await until(()=>p.received.length);
 p.socket.write(frame(JSON.stringify(m)));await rejected;await assert.rejects(rpc.call('thread/read',{}),/invalid-message/);await until(()=>p.socket.destroyed);
});
test('notification handler failure closes the connection rather than keeping subscriptions alive',async t=>{
 const {p,rpc}=await setup(t,()=>{throw Error('PRIVATE handler failure')});p.socket.write(frame(JSON.stringify({method:'turn/completed',params:{threadId:'t',turn:{id:'v',status:'completed'}}})));await until(()=>rpc.error!==null);await until(()=>p.socket.destroyed);assert.ok(!inspect(rpc.error).includes('PRIVATE'));
});
test('RPC bounds pending calls and abort rejects every outstanding request',async t=>{
 const {rpc,a}=await setup(t),pending=[];for(let i=0;i<32;i++)pending.push(assert.rejects(rpc.call('thread/read',{threadId:'t'}),/interrupted/));await assert.rejects(rpc.call('thread/read',{}),/rpc-limit/);a.abort();await Promise.all(pending);
});
test('RPC request deadline rejects only its bounded pending operation',async t=>{
 const a=new AbortController(),{rpc}=await setup(t);const fast=new Rpc(rpc.wire,()=>{},a.signal,10);t.after(()=>fast.close());await assert.rejects(fast.call('thread/read',{}),/rpc-deadline/);assert.equal(fast.pending.size,0);
});
for(const phase of ['preparation','queue'])test(`expired RPC cannot write after asynchronous ${phase}`,async t=>{
 const {p,rpc}=await setup(t);rpc.timeout=30;let release,started=false;const blocked=new Promise(r=>release=r);t.after(()=>release());
 const prepare=async()=>{started=true;await blocked;return ()=>{}};
 const holding=phase==='queue'?rpc.send({method:'hold'},prepare):null;
 const expired=rpc.call('thread/resume',{threadId:'retired'},phase==='preparation'?prepare:undefined),rejected=assert.rejects(expired,/rpc-deadline/);
 await until(()=>started);await rejected;release();await holding;await rpc.send({method:'after'});await until(()=>p.received.some(f=>JSON.parse(f.payload).method==='after'));
 assert.equal(p.received.filter(f=>JSON.parse(f.payload).method==='thread/resume').length,0);
});
