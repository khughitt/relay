import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {frame,peer,until} from './helpers/codex-wire.js';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const mod = await import('../src/serve/codex/transport.js').catch(e => { if(e.code==='ERR_MODULE_NOT_FOUND') return {}; throw e; });
const pause = () => new Promise(resolve => setImmediate(resolve));
async function client(t,p,opts={}) {
 const texts=[],errors=[];let failed;const failure=new Promise(r=>failed=r);
 const wire=await mod.connectUnixWebSocket({socketPath:p.path,onText:x=>texts.push(x),onFailure:x=>{errors.push(x);failed(x)},...opts});
 t.after(()=>wire.close());return {wire,texts,errors,failure};
}

for(const [name,opts,code] of [
 ['zero peer limit',{peerLimit:'0'},'peer-limit-invalid'],['negative peer limit',{peerLimit:'-1'},'peer-limit-invalid'],
 ['missing peer limit',{peerLimit:null},'peer-limit-invalid'],['unsafe peer limit',{peerLimit:'9007199254740992'},'peer-limit-invalid'],
 ['noninteger peer limit',{peerLimit:'1.5'},'peer-limit-invalid'],['duplicate peer limit',{headers:['x-codex-websocket-max-unfragmented-message-bytes: 16']},'upgrade-invalid'],
 ['incorrect accept',{badAccept:true},'upgrade-invalid'],['non-upgrade status',{status:'200 OK'},'upgrade-invalid'],
 ['unsolicited extension',{headers:['Sec-WebSocket-Extensions: permessage-deflate']},'upgrade-invalid'],
 ['unsolicited protocol',{headers:['Sec-WebSocket-Protocol: unexpected']},'upgrade-invalid'],
 ['duplicate accept',{headers:['Sec-WebSocket-Accept: duplicate']},'upgrade-invalid'],
 ['oversized headers',{headers:['X-Padding: '+'x'.repeat(16384)]},'upgrade-limit']
])test(`rejects ${name}`,{timeout:3000},async t=>{const p=await peer(t,opts);await assert.rejects(mod.connectUnixWebSocket({socketPath:p.path,onText(){},onFailure(){}}),new RegExp(code));});
test('accepts coalesced first frame and sends masked complete text', {timeout:3000},async t=>{
 const p=await peer(t,{tail:frame('first')}),c=await client(t,p);await until(()=>c.texts.length===1);assert.deepEqual(c.texts,['first']);
 await c.wire.sendText('hello');await c.wire.sendText('again');await until(()=>p.received.length===2);
 assert.deepEqual(p.received.map(x=>[x.op,x.fin,x.masked,x.payload.toString()]),[[1,true,true,'hello'],[1,true,true,'again']]);
 assert.notEqual(p.received[0].mask,p.received[1].mask);
});
test('lower peer ceiling rejects a whole outbound message before write',{timeout:3000},async t=>{
 const p=await peer(t,{peerLimit:'16'}),c=await client(t,p);assert.equal(c.wire.peerLimitBytes,16);
 await assert.rejects(c.wire.sendText('x'.repeat(17)),/outbound-limit/);assert.equal(p.received.length,0);
});
for(const n of [125,126,65535,65536])test(`accepts text length ${n} with canonical framing`,{timeout:3000},async t=>{
 const p=await peer(t),c=await client(t,p);p.socket.write(frame('x'.repeat(n)));await until(()=>c.texts.length);assert.equal(c.texts[0].length,n);
 await c.wire.sendText('y'.repeat(n));await until(()=>p.received.length);assert.equal(p.received[0].payload.length,n);assert.equal(p.received[0].masked,true);
});
test('fragmented UTF-8 survives split headers and interleaved ping',{timeout:3000},async t=>{
 const p=await peer(t),c=await client(t,p);const bytes=Buffer.from('A€B');
 const data=Buffer.concat([frame(bytes.subarray(0,2),{fin:false}),frame('ping',{op:9}),frame(bytes.subarray(2),{op:0})]);
 for(const b of data){p.socket.write(Buffer.from([b]));await pause();}
 await until(()=>c.texts.length&&p.received.length);assert.deepEqual(c.texts,['A€B']);assert.equal(p.received[0].op,10);assert.equal(p.received[0].masked,true);assert.equal(p.received[0].payload.toString(),'ping');
});
const huge=Buffer.alloc(10);huge[0]=129;huge[1]=127;huge.writeBigUInt64BE(9007199254740992n,2);
for(const [name,data,code] of [
 ['masked server frame',frame('bad',{mask:true}),'frame-invalid'],['RSV bit',frame('bad',{rsv:64}),'frame-invalid'],
 ['reserved opcode',frame('',{op:3}),'frame-invalid'],['binary application frame',frame('bad',{op:2}),'binary-unsupported'],
 ['orphan continuation',frame('bad',{op:0}),'frame-invalid'],['nested message',Buffer.concat([frame('a',{fin:false}),frame('b')]),'frame-invalid'],
 ['fragmented control',frame('x',{op:9,fin:false}),'frame-invalid'],['oversized control',frame('x'.repeat(126),{op:9}),'frame-invalid'],
 ['noncanonical length',frame('x',{lengthBytes:2}),'frame-invalid'],['unsafe length',huge,'inbound-limit'],
 ['invalid text UTF-8',frame(Buffer.from([0xc0,0xaf])),'utf8-invalid'],['invalid close code',frame(Buffer.from([3,237]),{op:8}),'close-invalid'],
 ['one-byte close',frame(Buffer.from([3]),{op:8}),'close-invalid'],['invalid close UTF-8',frame(Buffer.from([3,232,255]),{op:8}),'utf8-invalid'],
 ['aggregate fragmented limit',Buffer.concat([frame('x'.repeat(32),{fin:false}),frame('y',{op:0})]),'inbound-limit']
])test(`fails visibly on ${name}`,{timeout:3000},async t=>{
 const p=await peer(t),c=await client(t,p,{maxIncomingBytes:32});p.socket.write(data);assert.equal(await c.failure,code);assert.equal(c.texts.length,0);assert.equal(c.errors.length,1);
});
test('announced incoming length is rejected before its payload arrives',{timeout:3000},async t=>{
 const p=await peer(t),c=await client(t,p);const header=Buffer.alloc(10);header[0]=129;header[1]=127;header.writeBigUInt64BE(8388609n,2);
 p.socket.write(header);assert.equal(await c.failure,'inbound-limit');
});
test('EOF in partial frame fails visibly',{timeout:3000},async t=>{
 const p=await peer(t),c=await client(t,p);p.socket.end(Buffer.from([129,5,97]));assert.equal(await c.failure,'frame-truncated');
});
test('abort during upgrade rejects and closes the owned socket',{timeout:3000},async t=>{
 const p=await peer(t,{hang:true}),abort=new AbortController();const pending=mod.connectUnixWebSocket({socketPath:p.path,signal:abort.signal,onText(){},onFailure(){}});
 await until(()=>p.request);abort.abort();await assert.rejects(pending,/interrupted/);await until(()=>p.socket.destroyed);
});
test('local close is idempotent and sends a masked close handshake',{timeout:3000},async t=>{
 const p=await peer(t),c=await client(t,p);await Promise.all([c.wire.close(),c.wire.close()]);assert.equal(p.received.filter(x=>x.op===8).length,1);assert.equal(p.received[0].masked,true);assert.equal(c.errors.length,0);
});
test('unfinished upgrade has a fixed deadline',{timeout:3000},async t=>{
 const p=await peer(t,{hang:true});t.mock.timers.enable({apis:['setTimeout']});
 const pending=mod.connectUnixWebSocket({socketPath:p.path,onText(){},onFailure(){}});
 const checked=assert.rejects(pending,/upgrade-deadline/);
 for(let i=0;i<100&&!p.request;i++)await pause();assert.ok(p.request);
 t.mock.timers.tick(15000);await checked;
});
test('unfinished fragmented message cannot extend its deadline with ping',{timeout:3000},async t=>{
 const p=await peer(t),c=await client(t,p);t.mock.timers.enable({apis:['setTimeout']});
 p.socket.write(frame('a',{fin:false}));for(let i=0;i<10;i++)await pause();
 t.mock.timers.tick(14000);p.socket.write(frame('ping',{op:9}));for(let i=0;i<10;i++)await pause();
 t.mock.timers.tick(1000);assert.equal(await c.failure,'frame-deadline');
});
for(const payload of ['', 'x'])test('bounds fragment bookkeeping for '+(payload?'tiny':'empty')+' continuations',{timeout:3000},async t=>{
 const p=await peer(t),c=await client(t,p);p.socket.write(Buffer.concat([frame('{',{fin:false}),...Array.from({length:1024},()=>frame(payload,{op:0,fin:false}))]));await until(()=>c.errors.length);assert.equal(c.errors[0],'fragment-limit');assert.deepEqual(c.texts,[]);await c.wire.close();
});

for(const revoke of ['resolved','superseded','readdressed'])test('queued guarded answer never reaches wire after '+revoke,{timeout:3000},async t=>{
 const {Rpc}=await import('../src/serve/codex/rpc.js'),{createRequestDelivery}=await import('../src/serve/codex/delivery.js');const p=await peer(t),abort=new AbortController();let rpc,release,queued=false,observed=false;
 const original=net.Socket.prototype.write;
 t.mock.method(net.Socket.prototype,'write',function(chunk,...args){
  if(Buffer.isBuffer(chunk)&&(chunk[0]&15)===10&&(chunk[1]&128)&&!release){const callback=args.at(-1);release=()=>callback();return original.call(this,chunk,...args.slice(0,-1),()=>{})}
  return original.call(this,chunk,...args);
 });
 const guard=createRequestDelivery({send:(m,beforeWrite)=>rpc.send(m,beforeWrite),onSuperseded:async()=>{}}),tuple={threadId:'t',turnId:'v',itemId:'c'},q={id:77,method:'item/tool/requestUserInput',params:{...tuple,isBlocking:true,questions:[{id:'q',isOther:false,isSecret:false,options:[{label:'Blue'}]}]}};
 const wire=await mod.connectUnixWebSocket({socketPath:p.path,signal:abort.signal,onText:text=>rpc.receive(text),onFailure:code=>rpc?.stop(code)});t.after(()=>wire.close());
 const sendText=wire.sendText;wire.sendText=(...args)=>{if(args[0].includes('"id":77'))queued=true;return sendText(...args)};
 rpc=new Rpc(wire,m=>{if(m.method==='serverRequest/resolved')guard.resolved(tuple);else if(m.method==='item/tool/requestUserInput')void guard.observe(m).catch(()=>{});observed=true},abort.signal);t.after(()=>{guard.close();rpc.stop('test-complete')});
 await guard.observe(q);await guard.admit(tuple,true);p.socket.write(frame('hold',{op:9}));await until(()=>!!release);
 const answer=guard.sendAnswer(tuple,{answers:{q:{answers:['Blue']}}}),checked=assert.rejects(answer,/revoked/);await until(()=>queued);
 p.socket.write(frame(JSON.stringify(revoke==='resolved'?{method:'serverRequest/resolved',params:{threadId:'t',requestId:77}}:{...q,id:78,params:{...q.params,...(revoke==='superseded'?{itemId:'new'}:{})}})));await until(()=>observed);release();await checked;await pause();assert.equal(p.received.filter(x=>x.op===1).length,0);
});
