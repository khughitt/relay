import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {peer,frame,until} from './codex-wire.js';
import {tempState} from './fixture.js';
import {openInbox} from '../../src/serve/inbox.js';
import {expectAnswers} from '../../src/routes/index.js';
import {params,owner} from './codex-question.js';
export {until};
export const waiting={type:'active',activeFlags:['waitingOnUserInput']};
export const line=(type,payload)=>JSON.stringify({type,payload})+'\n';
export async function serverFixture(t,{replay=true,status=waiting,source='user',ephemeral=false,presence='away'}={}){
 const state=await tempState(t),home=join(state.stateDir,'home'),sessions=join(home,'sessions'),path=join(sessions,'rollout.jsonl');
 await mkdir(sessions,{recursive:true,mode:0o700});await writeFile(path,line('response_item',{type:'function_call',call_id:'call',name:'request_user_input'}),{mode:0o600});
 const {inbox}=await openInbox({stateDir:state.stateDir,expectAnswers});await inbox.setPresence(presence);
 const p=await peer(t),sent=[],logs=[],metadata={id:'thread',cwd:'/repo',ephemeral,threadSource:source,path,status};let cursor=0,fail;
 const push=m=>p.socket.write(frame(JSON.stringify(m)));
 const handler={async handle(m){
  if(m.method==='initialize')return {userAgent:'fixture/0.165.0 (test)',codexHome:home};
  if(m.method==='thread/loaded/list')return {data:['thread'],nextCursor:null};
  if(m.method==='thread/read')return {thread:structuredClone(metadata)};
  if(m.method==='thread/resume'){if(replay)push({id:91,method:'item/tool/requestUserInput',params});return {thread:structuredClone(metadata),collaborationMode:{mode:'plan'}};}
  if(m.method==='thread/unsubscribe')return {status:'unsubscribed'};
  throw Error('unexpected fixture RPC '+m.method);
 }};
 const timer=setInterval(()=>{while(cursor<p.received.length){const f=p.received[cursor++];if(f.op!==1)continue;const m=JSON.parse(f.payload.toString());sent.push(m);if(m.method&&m.id!==undefined)Promise.resolve(handler.handle(m)).then(result=>push({id:m.id,result}),e=>{fail=e;push({id:m.id,error:{code:-32000,message:'fixture'}})});}},1);
 t.after(()=>{clearInterval(timer);if(fail)throw fail;});
 const config={home,bin:'/fixture/codex',socket:p.path,evidence:'/fixture/evidence'},rows={schema:2,agents:{'codex:thread':{id:'codex:thread',sessionId:'thread',harness:'codex',process:owner.generationBinding,cwd:'/repo',project:null}}};
 return {state,home,path,inbox,push,sent,logs,metadata,handler,rows,
  append:payload=>appendFile(path,payload),
  options:{config,inbox,readAgents:async()=>rows,processOps:{probe:()=>({status:'alive'})},identity:async()=>owner.generationBinding,log:s=>logs.push(s),pollMs:20,replayMs:50,provenanceMs:100},
  count:method=>sent.filter(m=>m.method===method).length};
}
