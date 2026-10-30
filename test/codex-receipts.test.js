import test from 'node:test';
import assert from 'node:assert/strict';
import {statSync,appendFileSync} from 'node:fs';
import {tempStore,record} from './helpers/codex-store.js';
const mod=await import('../src/serve/codex/receipts.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
test('aggregate reader budget refuses another file without losing valid existing evidence',async t=>{
 const f=tempStore(t),line=record('response_item',{type:'function_call',call_id:'a',name:'request_user_input'}),a=f.day(['d'],'a',[line]),b=f.day(['d'],'b',[line]);
 assert.equal(typeof mod.createReceiptReaders,'function');const readers=mod.createReceiptReaders({home:f.root,maxBytes:statSync(a).size+1});t.after(()=>readers.close());
 assert.equal((await readers.get(a).read()).state,'ok');assert.equal((await readers.get(b).read()).state,'unknown');assert.equal((await readers.get(a).read()).calls.get('a').name,'request_user_input');
});
test('budget exhaustion after growth is sticky unknown rather than cached receipt',async t=>{
 const f=tempStore(t),a=f.day(['d'],'a',[record('response_item',{type:'function_call',call_id:'a',name:'request_user_input'})]);
 assert.equal(typeof mod.createReceiptReaders,'function');const readers=mod.createReceiptReaders({home:f.root,maxBytes:statSync(a).size+4});t.after(()=>readers.close());const held=readers.get(a);assert.equal((await held.read()).state,'ok');
 appendFileSync(a,'12345');assert.equal((await held.read()).state,'unknown');assert.equal((await held.read()).state,'unknown');
});
