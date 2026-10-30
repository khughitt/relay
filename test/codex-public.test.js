import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {join} from 'node:path';
import {openInbox} from '../src/serve/inbox.js';
import {serveSocket} from '../src/serve/socket.js';
import {connectSocket} from '../src/serve/client.js';
import {serveHttp} from '../src/serve/http.js';
import {expectAnswers} from '../src/routes/index.js';
import {tempState} from './helpers/fixture.js';
import {answerMessage,NOW} from './helpers/interaction.js';
import {codexQuestion,owner,blue} from './helpers/codex-question.js';
function get(port,path){return new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port,path,agent:false},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>resolve(JSON.parse(s)));}).on('error',reject);});}
async function setup(t){const p=await tempState(t),{inbox}=await openInbox({stateDir:p.stateDir,clock:()=>NOW,expectAnswers});await inbox.setPresence('away');assert.equal(typeof inbox.codexAsk,'function');const q=codexQuestion();await inbox.codexAsk(q,owner);return {p,inbox,q};}
function privateFree(value){const s=JSON.stringify(value);for(const name of ['connector','generationBinding','nativeId','start','bootId'])assert.ok(!s.includes('"'+name+'"'),name);}
test('HTTP list/get preserve native arrays while omitting private Codex owner data',async t=>{
 const {inbox,q}=await setup(t);await inbox.answer(q.id,answerMessage(q,{values:{q1:{type:'choice',optionIds:['o1']}}}));await inbox.codexHanded(q.id,owner);await inbox.codexObserve(q.id,owner,{answers:blue,terminal:true});
 const web=await serveHttp({inbox,http:{port:0,serveHost:null,serveLogin:null,clientDir:null},readAgents:async()=>null,clock:()=>NOW,log:()=>{}});t.after(()=>web.close());
 const result=await get(web.port,'/v1/inbox/'+q.id);privateFree(result);assert.deepEqual(result.entry.observed,blue);const list=await get(web.port,'/v1/inbox?since=0');privateFree(list);assert.deepEqual(list.entries[0].observations[0].answers,blue);
});
test('socket cannot forge connector operations and get/list never expose private ownership',async t=>{
 const {p,inbox,q}=await setup(t),path=join(p.stateDir,'public.sock'),server=await serveSocket({inbox,socketPath:path,processOps:{probe:()=>({status:'unknown'})},log:()=>{}});t.after(()=>server.close());const client=await connectSocket(path);t.after(()=>client.close());
 privateFree(await client.request('get',{id:q.id}));privateFree(await client.request('list',{since:0}));
 const fake=await client.request('ask',{message:q,waiter:owner.generationBinding,handback:true});assert.equal(fake.ok,false);assert.equal(fake.error.code,'UNSUPPORTED_ROUTE');
 const confirm=await client.request('confirm',{harness:'codex',callId:q.body.native.callId,observed:{}});assert.equal(confirm.ok,false);assert.equal(confirm.error.code,'UNSUPPORTED_ROUTE');
 for(const op of ['codexAsk','codexHanded','codexGone','codexObserve'])assert.equal((await client.request(op,{})).error.code,'UNKNOWN_OP');
});
