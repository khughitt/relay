// Bounded, resumable native observation of Codex tool-call processes. No installed configuration is edited.
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,copyFileSync,symlinkSync} from 'node:fs';
import {setTimeout as pause} from 'node:timers/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {verifyNativeBinary,probeEnvironment,startPrivateServer} from '../../tools/codex-question/private-server.mjs';
import {connectRpc} from '../../src/serve/codex/rpc.js';
import {turnFields} from '../../src/adapters/codex-rollout.js';
import {startScriptedProvider,responseCreated,functionCall,customToolCall,assistantMessage,completed} from '../../tools/codex-question/provider.mjs';
import * as cases from './cases.mjs';

const digest=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>"'"+x.replaceAll("'","'\\''")+"'";
const save=(p,x)=>writeFileSync(p,JSON.stringify(x,null,2)+'\n',{mode:0o600,flag:'wx'});
const fail=x=>{throw Error(x);};
export function assertPrivateProvider({baseUrl,requiresAuth}) {
 const u=new URL(baseUrl);
 if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.pathname!=='/v1'||requiresAuth!==false)fail('private-provider-required');
}
export function receiptSelection(receipts,identity,ids) {
 for(const r of receipts){
  if(JSON.stringify(r.identity)!==JSON.stringify(identity))fail('receipt-identity-mismatch');
  if(r.status==='failed')fail('failed-attempt-requires-disposition');
 }
 return ids.filter(id=>!receipts.some(r=>r.id===id&&['passed','observed','unsupported','recorded'].includes(r.status)));
}
function toml(object,prefix=[]) {
 let text=prefix.length?'['+prefix.map(x=>JSON.stringify(x)).join('.')+']\n':'';
 for(const [k,v] of Object.entries(object))if(v===null)fail('toml-null');else if(typeof v!=='object'||Array.isArray(v))text+=JSON.stringify(k)+' = '+JSON.stringify(v)+'\n';
 for(const [k,v] of Object.entries(object))if(v&&typeof v==='object'&&!Array.isArray(v))text+='\n'+toml(v,[...prefix,k]);
 return text;
}
function privatePolicy(input,dir) {
 const config={},map=[];let i=0;
 for(const [k,v] of Object.entries(input.keys))if(v.explicit)config[k]=v.value;
 const profile=structuredClone(input.permissions);
 function remap(node){const out={};for(const [k,v] of Object.entries(node)){
  let target=k;
  if(k.startsWith('/')||k.startsWith('~')){target=join(dir,'grants',String(i++));mkdirSync(target,{recursive:true,mode:0o700});map.push({source:k,fixture:target,role:typeof v==='object'?'subtree':v});}
  out[target]=v&&typeof v==='object'&&!Array.isArray(v)?remap(v):v;
 }return out;}
 config.permissions=remap(profile);config.features=input.features;
 config.shell_environment_policy=input.shell_environment_policy;
 return {config,map};
}
async function terminal({argv,cwd,env,out,done,signal,inputs=[],dir,timeout=85}) {
 const script=inputs.length?join(dir,'input-script.json'):null;if(script)save(script,inputs);
 const child=spawn('/usr/bin/python3',[fileURLToPath(new URL('./pty.py',import.meta.url)),...(script?['--input-script',script]:[])],{cwd,env:{...env,TERM:'xterm-256color',COLORTERM:'truecolor'},stdio:['pipe','pipe','pipe']});
 let output='',errors='';const abort=()=>child.kill('SIGTERM');signal?.addEventListener('abort',abort,{once:true});
 child.stdout.on('data',b=>{output+=b;if(output.length>65536)abort();});child.stderr.on('data',b=>{errors+=b;if(errors.length>65536)abort();});
 child.stdin.end(JSON.stringify({argv,cwd,output:out,done,timeout}));
 try {const code=await new Promise((yes,no)=>{child.once('error',no);child.once('close',yes);});if(code!==0)fail('pty-driver-failed:'+errors.slice(0,1000));return JSON.parse(output);}
 finally{signal?.removeEventListener('abort',abort);}
}
function files(root,suffix){if(!existsSync(root))return [];return readdirSync(root,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(join(root,x.name),suffix):x.name.endsWith(suffix)?[join(root,x.name)]:[]);}

/** `cross-turn-shell`'s first call leaves a shell waiting on its terminal; the next turn writes to it. */
const SESSION_ID=/session[ _]?id\D{0,4}(\d+)/i;

/** One scripted function call per lane, each held delayMs. A request's lane is its last
 * "Run [<prefix> ]probe step N." user text (`N`, or `<prefix>N` for a worker or inner session). A
 * step is a shell command string, or {tool, args} where args may be a function of the latest exec
 * session id. Requests without the needed tool get a plain reply. `final` names the lane whose
 * completed call writes `turn-done`. */
export function createLaneScript({lanes,dir,final,delayMs=2000}) {
 const issued=new Set(),ended=new Set();let session=null;
 return Array.from({length:48},(_,index)=>r=>{
  save(join(dir,`request-${index}.json`),r);
  const marks=r.userTexts.flatMap(t=>[...t.matchAll(/Run (?:(\w+) )?probe step (\d+)\./g)].map(m=>`${m[1]??''}${m[2]}`));
  const lane=marks.at(-1)??null;
  const reply=text=>[responseCreated('probe'+index),assistantMessage('end'+index,text),completed('probe'+index)];
  const output=lane===null?undefined:r.functionCallOutputs.find(x=>x.callId===`probe-call-${lane}`);
  if(output&&!ended.has(lane)){
   ended.add(lane);session=SESSION_ID.exec(output.output)?.[1]??session;
   writeFileSync(join(dir,`turn-${lane}-done`),'done');if(lane===final)writeFileSync(join(dir,'turn-done'),'done');
   return reply('Probe step complete.');
  }
  if(lane===null||!Object.hasOwn(lanes,lane)||issued.has(lane)||output)return reply('Private probe');
  const step=lanes[lane],wanted=typeof step==='string'?null:step.tool;
  const tool=wanted?r.toolNames.find(x=>x.name===wanted):r.toolNames.find(x=>x.name==='exec_command')??r.toolNames.find(x=>x.name==='shell_command');
  // Code mode: a shell step runs through the custom `exec` tool's nested exec_command.
  const code=!tool&&typeof step==='string'?(r.additionalTools??[]).find(x=>x.name==='exec'&&x.type==='custom'):undefined;
  if(code){
   issued.add(lane);save(join(dir,`tools-${lane}.json`),r.additionalTools);
   return {delayMs,events:[responseCreated('probe'+index),customToolCall(`probe-call-${lane}`,'exec',`await tools.exec_command(${JSON.stringify({cmd:step,max_output_tokens:2000})});`,code.namespace??undefined),completed('probe'+index)]};
  }
  if(!tool){if(r.toolNames.length||r.additionalTools?.length)save(join(dir,`undrivable-${lane}.json`),{step:lane,undrivable:`no-${wanted??'shell'}-tool`,tools:r.toolNames,additionalTools:r.additionalTools});return reply('Private probe');}
  if(typeof step!=='string'&&typeof step.args==='function'&&session===null){save(join(dir,`undrivable-${lane}.json`),{step:lane,undrivable:'no-session-id'});return reply('Private probe');}
  issued.add(lane);save(join(dir,`tools-${lane}.json`),r.toolNames);
  const args=typeof step==='string'?(tool.name==='exec_command'?{cmd:step,max_output_tokens:2000}:{command:step}):typeof step.args==='function'?step.args(session):step.args;
  return {delayMs,events:[responseCreated('probe'+index),functionCall(`probe-call-${lane}`,tool.name,args,tool.namespace??undefined),completed('probe'+index)]};
 });
}
/** Task 1's form: one numbered step per turn. */
export const createShapeScript=({commands,dir,delayMs=2000})=>createLaneScript({lanes:Object.fromEntries(commands.map((c,i)=>[String(i+1),c])),dir,final:String(commands.length),delayMs});

const TURN_MS=30000;
function stepsFor(def,project) {
 const dump=(point,step)=>`/usr/bin/python3 ${quote(join(project,'dump.py'))} ${point} ${step}`;
 const started=join(project,'receipts',`${def.point}.started`);
 switch(def.point){
  case 'call':return {commands:[dump('call',1)]};
  case 'second-call':return {commands:[dump('second-call',1),dump('second-call',2)],tuiInputs:[{afterMs:15000,text:'Run probe step 2.'}]};
  // The marker separates an orphan killed with its call from one that never started.
  case 'orphan-after-parent-exit':return {commands:[`(echo started > ${quote(started)}; sleep 3; exec ${dump(def.point,1)}) </dev/null >/dev/null 2>&1 &`]};
  case 'orphan-setsid':return {commands:[`/usr/bin/setsid /bin/sh -c ${quote(`echo started > ${quote(started)}; sleep 3; exec ${dump(def.point,1)}`)} </dev/null >/dev/null 2>&1 &`]};
  case 'cross-turn-shell':return {commands:[{tool:'exec_command',args:{cmd:`read -r line; exec ${dump(def.point,2)}`,tty:true,yield_time_ms:1000,max_output_tokens:2000}},{tool:'write_stdin',args:session=>({session_id:Number(session),chars:'\n',yield_time_ms:3000,max_output_tokens:2000})}]};
  case 'user-escape':return {commands:[dump('call',1)],tuiInputs:[{afterMs:15000,text:'!'+dump('user-escape',1)}],tuiDone:join(project,'receipts','user-escape-1.done')};
  default:fail('unknown-point');
 }
}
function naming(marker) {
 const found=[];
 for(const name of readdirSync('/proc')){
  if(!/^\d+$/.test(name)||Number(name)===process.pid)continue;
  let argv;try{argv=readFileSync(`/proc/${name}/cmdline`,'utf8')}catch{continue}
  if(argv.includes(marker))found.push({pid:Number(name),argv:argv.split('\0').filter(Boolean).slice(0,8).map(a=>a.slice(0,300))});
 }
 return found;
}
/** Every process still naming this case's directory is fixture-owned (the TUI leaves a managed
 * app-server daemon behind): TERM, then KILL. Only one alive after KILL is a survivor. */
async function reap(marker) {
 const reaped=naming(marker),signal=(list,s)=>{for(const x of list)try{process.kill(x.pid,s)}catch{}};
 if(reaped.length){signal(reaped,'SIGTERM');for(let i=0;i<30&&naming(marker).length;i++)await pause(100);signal(naming(marker),'SIGKILL');await pause(500);}
 return {reaped,survivors:naming(marker).map(x=>x.pid)};
}
async function waitFor(path,ms,signal){const end=Date.now()+ms;while(!existsSync(path)&&Date.now()<end){signal.throwIfAborted();await pause(100);}return existsSync(path);}

async function driveExec({codex,cwd,env,dir,signal}) {
 const child=spawn(codex,['exec','--skip-git-repo-check','Run probe step 1.'],{cwd,env,stdio:['ignore','pipe','pipe'],detached:true});
 let bytes=0;for(const [stream,label] of [[child.stdout,'exec.stdout'],[child.stderr,'exec.stderr']])stream.on('data',b=>{bytes+=b.length;if(bytes<=1024*1024)writeFileSync(join(dir,label),b,{flag:'a',mode:0o600});});
 const kill=s=>{try{process.kill(-child.pid,s)}catch{}};const onAbort=()=>kill('SIGKILL');signal.addEventListener('abort',onAbort,{once:true});
 try{const code=await new Promise((yes,no)=>{child.once('error',no);child.once('close',yes);});return {code,ownedPids:[child.pid]};}
 finally{signal.removeEventListener('abort',onAbort);kill('SIGKILL');}
}
/** `turns` is a count or a list of {model?} (a per-turn model override). */
async function driveAppServer({codex,dir,project,configToml,turns,signal,afterTurns,env}) {
 const completions=[];let server,rpc;
 const plan=typeof turns==='number'?Array.from({length:turns},()=>({})):turns;
 try{
  server=await startPrivateServer({codex,privateDir:dir,configToml,signal,env});
  rpc=await connectRpc({socketPath:server.socketPath,signal,onMessage:m=>{if(m.method==='turn/completed')completions.push(m.params);}});
  await rpc.call('initialize',{clientInfo:{name:'relay-provenance-shape-probe',version:'1'},capabilities:{experimentalApi:true}});await rpc.send({method:'initialized'});
  const thread=(await rpc.call('thread/start',{model:'mock-model',cwd:project})).thread.id;
  const mine=()=>completions.filter(c=>c?.threadId===thread);
  for(let k=1;k<=plan.length;k++){
   // Turn B starts well after turn A's shell, so a cross-turn shell's lead is measurable.
   if(k>1)await pause(2500,undefined,{signal});
   await rpc.call('turn/start',{threadId:thread,input:[{type:'text',text:`Run probe step ${k}.`,text_elements:[]}],...(plan[k-1].model?{model:plan[k-1].model}:{})});
   const end=Date.now()+TURN_MS;while(mine().length<k){signal.throwIfAborted();if(Date.now()>end)fail('turn-timeout');await pause(50);}
  }
  await afterTurns(signal);
  return {thread,completed:mine().map(c=>c?.turn?.status),ownedPids:[server.pid]};
 }finally{await rpc?.close().catch(()=>{});if(server)await server.stop();}
}

async function observe({codex,def,input,dir,signal}) {
 mkdirSync(dir,{recursive:true,mode:0o700});const env=probeEnvironment(dir);
 for(const p of [env.HOME,env.CODEX_HOME,env.XDG_RUNTIME_DIR])mkdirSync(p,{recursive:true,mode:0o700});
 const project=join(dir,'project');mkdirSync(join(project,'receipts'),{recursive:true,mode:0o700});
 copyFileSync(fileURLToPath(new URL('./dump.py',import.meta.url)),join(project,'dump.py'));
 const steps=stepsFor(def,project),done=join(dir,'turn-done'),orphanDone=join(project,'receipts',`${def.point}-1.done`),orphan=def.point.startsWith('orphan-');
 let provider;const observed={driver:def.driver,point:def.point,sandboxed:def.sandboxed,complete:false,cleanup:{ownedPids:[],survivors:[]}};
 try {
  provider=await startScriptedProvider({signal,script:createShapeScript({commands:steps.commands,dir})});
  assertPrivateProvider({baseUrl:provider.baseUrl,requiresAuth:false});
  const base=def.sandboxed?privatePolicy(input,dir):{config:{approval_policy:'never',sandbox_mode:'danger-full-access',features:input.features,shell_environment_policy:input.shell_environment_policy},map:[]};
  const config={...base.config,model:'mock-model',model_provider:'relay_scripted',model_reasoning_effort:'low',cli_auth_credentials_store:'file',projects:{[project]:{trust_level:'trusted'}},model_providers:{relay_scripted:{name:'private scripted',base_url:provider.baseUrl,wire_api:'responses',request_max_retries:0,stream_max_retries:0,supports_websockets:false,requires_openai_auth:false}},tui:{screen_reader_detection_done:true,show_tooltips:false}};
  const text=toml(config);writeFileSync(join(env.CODEX_HOME,'config.toml'),text,{mode:0o600});
  save(join(dir,'input-identities.json'),{driver:def.driver,policy:input,projection:config,pathRoles:base.map,configSha256:digest(text)});
  let finishedAt;
  if(def.driver==='tui'){
   const inputs=steps.tuiInputs??[];const r=await terminal({argv:[codex,'--no-alt-screen','Run probe step 1.'],cwd:project,env,out:join(dir,'tui.raw'),done:steps.tuiDone??done,inputs,dir,signal});
   observed.terminal=r;observed.cleanup.ownedPids.push(...r.cleanup.ownedPids);observed.cleanup.survivors.push(...r.cleanup.survivors);
   observed.complete=r.reason==='turn-complete'&&r.inputs.length===inputs.length;
   if(orphan){finishedAt=Date.now();await waitFor(orphanDone,cases.ORPHAN_WAIT_MS,signal);observed.orphanWaitMs=Date.now()-finishedAt;}
  }else if(def.driver==='exec'){
   const r=await driveExec({codex,cwd:project,env,dir,signal});finishedAt=Date.now();observed.exec=r;observed.cleanup.ownedPids.push(...r.ownedPids);
   observed.complete=r.code===0&&existsSync(done);
   if(orphan){await waitFor(orphanDone,cases.ORPHAN_WAIT_MS,signal);observed.orphanWaitMs=Date.now()-finishedAt;}
  }else{
   const r=await driveAppServer({codex,dir,project,configToml:text,turns:steps.commands.length,signal,afterTurns:async s=>{
    finishedAt=Date.now();if(orphan){await waitFor(orphanDone,cases.ORPHAN_WAIT_MS,s);observed.orphanWaitMs=Date.now()-finishedAt;}}});
   observed.appServer=r;observed.cleanup.ownedPids.push(...r.ownedPids);observed.complete=r.completed.every(x=>x==='completed')&&existsSync(done);
  }
 }catch(e){observed.error=e.message;observed.complete=false;}
 finally{
  if(provider){save(join(dir,'provider-requests.json'),provider.requests);await provider.close().catch(e=>{observed.providerError=e.message});}
  const r=await reap(dir);observed.cleanup.reaped=r.reaped;observed.cleanup.survivors.push(...r.survivors);
 }
 const rollouts=files(join(env.CODEX_HOME,'sessions'),'.jsonl');
 const rows=rollouts.flatMap(p=>readFileSync(p,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x)));
 observed.rollouts=rollouts;observed.sessions=rows.filter(x=>x.type==='session_meta').map(x=>({id:x.payload?.id,source:x.payload?.source,cliVersion:x.payload?.cli_version}));
 observed.contexts=rows.filter(x=>x.type==='turn_context').map(x=>({...turnFields(x),timestamp:x.timestamp,approval:x.payload?.approval_policy,profile:x.payload?.permission_profile?.type??null,fileSystem:x.payload?.permission_profile?.file_system?.type??null,sandboxPolicy:x.payload?.sandbox_policy??null}));
 observed.dumps=files(join(project,'receipts'),'.json').map(p=>JSON.parse(readFileSync(p,'utf8')));
 observed.orphanStarted=orphan?existsSync(join(project,'receipts',`${def.point}.started`)):null;
 observed.undrivable=files(dir,'.json').filter(p=>/\/undrivable-\d+\.json$/.test(p)).map(p=>({file:p.slice(dir.length+1),...JSON.parse(readFileSync(p,'utf8'))}));
 save(join(dir,'observation.json'),observed);return observed;
}

/** The relay call label each tasks item files its scratch task at. */
const TASKS_LABEL={1:'call',4:'job',5:'call',7:'late',9:'late'};

/** What tasks wrote at one label: add's id, exit and warnings, the record's `agent`, and the
 * completion's exit, warnings and the record's `model`. A label whose add never ran gives nulls. */
export function collectTasks(receipts,label,show){
 const read=n=>existsSync(join(receipts,n))?readFileSync(join(receipts,n),'utf8'):null;
 const json=n=>{const t=read(n);if(t===null||!t.trim())return null;try{return JSON.parse(t);}catch{return {unparsed:t.slice(0,2000)};}};
 const code=n=>{const t=read(n);return t===null?null:Number(t.trim());};
 const add=json(`tasks-add-${label}.json`),fin=json(`tasks-done-${label}.json`);
 if(code(`tasks-add-${label}.exit`)===null)return {label,add:null,done:null};
 const record=typeof add?.id==='string'?show(add.id):null;
 return {label,
  add:{exit:code(`tasks-add-${label}.exit`),id:add?.id??null,agent:record?.agent??null,warnings:add?.warnings??[],...(add?.id?{}:{stdout:add,stderr:read(`tasks-add-${label}.err`)})},
  done:fin||code(`tasks-done-${label}.exit`)!==null?{exit:code(`tasks-done-${label}.exit`),model:record?.model??null,status:record?.status??null,warnings:fin?.warnings??[],...(fin?.error?{error:fin.error}:{})}:null};
}

/** Task 4: the commands one qualification item runs. Answers land in receipts/answer-<label>.json.
 * With `tasks`, a tasks item also files and completes one scratch task right after its relay call,
 * in the same process, so tasks resolves through the same call (receipts/tasks-{add,done}-<label>). */
export function itemPlan(def,{project,codexBin,tasks=false}) {
 const r=join(project,'receipts'),file=n=>quote(join(r,n));
 const dump=(point,step)=>`/usr/bin/python3 ${quote(join(project,'dump.py'))} ${point} ${step}`;
 const tk=label=>{
  const t=`TASKS_OWNER=probe tasks -C ${quote(join(project,'scratch-tasks'))}`,out=(verb,ext)=>file(`tasks-${verb}-${label}.${ext}`);
  return `${t} add ${quote('probe '+label)} >${out('add','json')} 2>${out('add','err')}; echo $? >${out('add','exit')}; `
   +`id=$(/usr/bin/python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" ${out('add','json')} 2>/dev/null) && `
   +`${t} done "$id" probe >${out('done','json')} 2>${out('done','err')}; echo $? >${out('done','exit')}`;
 };
 const relay=label=>`relay model --harness codex --json >${file(`answer-${label}.json`)} 2>/dev/null; echo $? >${file(`answer-${label}.exit`)}${tasks&&def.tasks?'; '+tk(label):''}`;
 const which=`command -v relay >${file('which-relay')}; command -v tasks >${file('which-tasks')}`;
 // The last receipt a label writes: its tasks completion when tasks runs, otherwise relay's exit.
 const exit=label=>join(r,tasks&&def.tasks?`tasks-done-${label}.exit`:`answer-${label}.exit`);
 const write={tool:'write_stdin',args:session=>({session_id:Number(session),chars:'\n',yield_time_ms:5000,max_output_tokens:2000})};
 const tty=cmd=>({tool:'exec_command',args:{cmd,tty:true,yield_time_ms:1000,max_output_tokens:2000}});
 const late9=tty(`${which}; /bin/sh -c ${quote(`read -r go; ( sleep 1; ${dump('late-before',2)}; ${relay('late')}; exec ${dump('late',2)} ) </dev/null >/dev/null 2>&1 & exit 0`)}; sleep 30`);
 switch(def.item){
  case 1: return {turns:[{}],final:'1',lanes:{1:`${which}; ${dump('call',1)}; ${relay('call')}`}};
  case 2: return {turns:[{},{model:cases.SWITCHED_MODEL}],final:'2',lanes:{1:`${which}; ${relay('early')}`,2:`${dump('late',2)}; ${relay('late')}`}};
  case 3: return {turns:[{}],final:'1',waitFor:[exit('worker')],waitMs:40000,lanes:{1:{tool:'spawn_agent',args:{message:'Run worker probe step 1.',model:cases.WORKER_MODEL}},worker1:`${which}; ${dump('worker',1)}; ${relay('worker')}`}};
  // The job sleeps so it is reparented before it dumps its ancestry and asks relay.
  case 4: return {turns:[{}],final:'1',waitFor:[exit('job')],waitMs:20000,lanes:{1:`${which}; TASKS_MODEL=poisoned-model /usr/bin/setsid /bin/sh -c ${quote(`echo started >${file('job.started')}; sleep 3; ${dump('job',1)}; ${relay('job')}`)} </dev/null >/dev/null 2>&1 &`}};
  case 5: return {turns:[{}],final:'1',waitFor:[exit('call')],waitMs:10000,lanes:{1:`${which}; ${dump('call',1)}; ${relay('call')}`}};
  case 6: return {turns:[{}],final:'1',waitFor:[exit('inner'),join(r,'inner-exec.exit')],waitMs:40000,lanes:{
   1:{tool:'exec_command',args:{cmd:`${which}; ${quote(codexBin)} exec --skip-git-repo-check -m ${cases.INNER_MODEL} 'Run inner probe step 1.' </dev/null >${file('inner-exec.out')} 2>&1; echo $? >${file('inner-exec.exit')}`,yield_time_ms:30000,max_output_tokens:2000}},
   inner1:`${dump('inner',1)}; ${relay('inner')}`}};
  case 7: return {turns:[{},{}],final:'2',waitFor:[exit('late')],waitMs:20000,lanes:{1:tty(`${which}; read -r line; ${dump('late',2)}; ${relay('late')}`),2:write}};
  case 8: return {turns:[{}],final:'1',lanes:{1:`${which}; ${dump('call',1)}`},tuiInputs:[{afterMs:15000,text:`!${dump('escape',1)}; ${relay('escape')}`}],tuiDone:exit('escape')};
  // The nested turn-A shell exits after forking, so its child is adopted by the sandbox's pid 1
  // while the top-level shell (the helper's direct child) keeps the namespace alive. The child
  // dumps a forked process's ancestry before its relay call and its own after it.
  case 9: return def.driver==='tui'
   ?{turns:[{},{}],final:'2',lanes:{1:late9,2:write},tuiInputs:[{afterMs:15000,text:'Run probe step 2.'}],tuiDone:join(r,'late-2.done')}
   :{turns:[{},{model:cases.SWITCHED_MODEL}],final:'2',waitFor:[join(r,'late-2.done')],waitMs:15000,lanes:{1:late9,2:write}};
  default: fail('unknown-item');
 }
}

async function observeItem({codex,def,input,dir,signal,shim}) {
 mkdirSync(dir,{recursive:true,mode:0o700});
 const project=join(dir,'project'),receipts=join(project,'receipts'),shimDir=join(dir,'shim');
 for(const p of [receipts,join(project,'state'),shimDir])mkdirSync(p,{recursive:true,mode:0o700});
 symlinkSync(def.variant==='base-relay'?shim.baseRelay:shim.relay,join(shimDir,'relay'));
 if(shim.tasks)symlinkSync(shim.tasks,join(shimDir,'tasks'));
 const fixture={PATH:`${shimDir}:${dirname(process.execPath)}:/usr/bin:/bin`,XDG_STATE_HOME:join(project,'state')};
 const env={...probeEnvironment(dir),...fixture};
 for(const p of [env.HOME,env.CODEX_HOME,env.XDG_RUNTIME_DIR])mkdirSync(p,{recursive:true,mode:0o700});
 copyFileSync(fileURLToPath(new URL('./dump.py',import.meta.url)),join(project,'dump.py'));
 const tasks=!!(def.tasks&&shim.tasks),scratch=join(project,'scratch-tasks');
 // tasks reads its registry under the private HOME; nothing registered on the host is touched.
 const tasksEnv={PATH:fixture.PATH,HOME:env.HOME,XDG_STATE_HOME:fixture.XDG_STATE_HOME,TASKS_OWNER:'probe'};
 const plan=itemPlan(def,{project,codexBin:codex,tasks}),done=join(dir,'turn-done');
 let provider;const observed={item:def.item,driver:def.driver,sandboxed:def.sandboxed,complete:false,cleanup:{ownedPids:[],survivors:[]},expectModel:cases.EXPECTED_MODEL,tasks:null};
 const waits=async s=>{const t0=Date.now();for(const f of plan.waitFor??[])await waitFor(f,Math.max(0,(plan.waitMs??0)-(Date.now()-t0)),s);};
 try {
  if(tasks){mkdirSync(scratch,{mode:0o700});save(join(dir,'tasks-init.json'),JSON.parse(execFileSync(shim.tasks,['init','--prefix','scr'],{cwd:scratch,env:tasksEnv,encoding:'utf8'})));}
  provider=await startScriptedProvider({signal,script:createLaneScript({lanes:plan.lanes,dir,final:plan.final})});
  assertPrivateProvider({baseUrl:provider.baseUrl,requiresAuth:false});
  const base=def.sandboxed?privatePolicy(input,dir):{config:{approval_policy:'never',sandbox_mode:'danger-full-access',features:input.features,shell_environment_policy:input.shell_environment_policy},map:[]};
  const config={...base.config,model:cases.EXPECTED_MODEL,model_provider:'relay_scripted',model_reasoning_effort:'low',cli_auth_credentials_store:'file',projects:{[project]:{trust_level:'trusted'}},model_providers:{relay_scripted:{name:'private scripted',base_url:provider.baseUrl,wire_api:'responses',request_max_retries:0,stream_max_retries:0,supports_websockets:false,requires_openai_auth:false}},tui:{screen_reader_detection_done:true,show_tooltips:false}};
  const text=toml(config);writeFileSync(join(env.CODEX_HOME,'config.toml'),text,{mode:0o600});
  save(join(dir,'input-identities.json'),{item:def.id,policy:input,projection:config,pathRoles:base.map,configSha256:digest(text),fixture,shim});
  if(def.driver==='tui'){
   const inputs=plan.tuiInputs??[];const r=await terminal({argv:[codex,'--no-alt-screen','Run probe step 1.'],cwd:project,env,out:join(dir,'tui.raw'),done:plan.tuiDone??done,inputs,dir,signal});
   observed.terminal=r;observed.cleanup.ownedPids.push(...r.cleanup.ownedPids);observed.cleanup.survivors.push(...r.cleanup.survivors);
   observed.complete=r.reason==='turn-complete'&&r.inputs.length===inputs.length;
  }else{
   const r=await driveAppServer({codex,dir,project,configToml:text,turns:plan.turns,signal,env:fixture,afterTurns:waits});
   observed.appServer=r;observed.parentThread=r.thread;observed.cleanup.ownedPids.push(...r.ownedPids);
   observed.complete=r.completed.length===plan.turns.length&&r.completed.every(x=>x==='completed')&&existsSync(done);
  }
 }catch(e){observed.error=e.message;observed.complete=false;}
 finally{
  if(provider){save(join(dir,'provider-requests.json'),provider.requests);await provider.close().catch(e=>{observed.providerError=e.message});}
  const r=await reap(dir);observed.cleanup.reaped=r.reaped;observed.cleanup.survivors.push(...r.survivors);
 }
 const env2=probeEnvironment(dir),rollouts=files(join(env2.CODEX_HOME,'sessions'),'.jsonl');
 const rows=rollouts.flatMap(p=>readFileSync(p,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x)));
 observed.rollouts=rollouts;observed.sessions=rows.filter(x=>x.type==='session_meta').map(x=>({id:x.payload?.id,source:x.payload?.source,cliVersion:x.payload?.cli_version}));
 observed.contexts=rows.filter(x=>x.type==='turn_context').map(x=>({...turnFields(x),timestamp:x.timestamp,approval:x.payload?.approval_policy,profile:x.payload?.permission_profile?.type??null,fileSystem:x.payload?.permission_profile?.file_system?.type??null}));
 observed.dumps=files(receipts,'.json').filter(p=>!/\/(answer|tasks)-[^/]+$/.test(p)).map(p=>JSON.parse(readFileSync(p,'utf8')));
 observed.answers={};
 for(const p of files(receipts,'.json').filter(p=>/\/answer-[^/]+\.json$/.test(p))){
  const label=p.match(/answer-([^/]+)\.json$/)[1],text=readFileSync(p,'utf8');
  try{observed.answers[label]=JSON.parse(text);}catch{observed.answers[label]={unparsed:text.slice(0,2000)};}
  const ex=join(receipts,`answer-${label}.exit`);observed.answers[label].exitCode=existsSync(ex)?Number(readFileSync(ex,'utf8').trim()):null;
 }
 const read=n=>existsSync(join(receipts,n))?readFileSync(join(receipts,n),'utf8').trim()||null:null;
 observed.shim={dir:shimDir,relay:read('which-relay'),tasks:read('which-tasks')};
 if(tasks){
  const show=id=>JSON.parse(execFileSync(shim.tasks,['-C',scratch,'show',id],{cwd:scratch,env:tasksEnv,encoding:'utf8'})).task;
  try{observed.tasks={...collectTasks(receipts,TASKS_LABEL[def.item],show),registry:join(env.HOME,'.config','tasks','projects.toml'),scratch};}
  catch(e){observed.tasks=null;observed.tasksError=e.message;}
 }
 observed.jobStarted=existsSync(join(receipts,'job.started'));
 observed.innerExit=read('inner-exec.exit');
 observed.undrivable=files(dir,'.json').filter(p=>/\/undrivable-[^/]+\.json$/.test(p)).map(p=>JSON.parse(readFileSync(p,'utf8')));
 save(join(dir,'observation.json'),observed);return observed;
}

/** `mode` 'shape' runs Task 1's observation points; 'qualify' runs Task 4's items with the `shim`
 * targets {relay, baseRelay, tasks?, tasksRevision?}. */
export async function runProvenanceProbe({codex,expected,codeRoot,out,policy,caseIds=[],resume=false,signal,mode='shape',shim=null}) {
 const result={status:'failed',cases:[],cleanup:{ownedPids:[],survivors:[]}};
 const stop=new AbortController(),outer=setTimeout(()=>stop.abort(Error('slice-deadline')),600000);
 const abort=()=>stop.abort(signal?.reason??Error('interrupted'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 try {
  const env=probeEnvironment(join(out,'admission'));
  for(const p of [env.HOME,env.CODEX_HOME])mkdirSync(p,{recursive:true,mode:0o700});
  const binary=await verifyNativeBinary({codex,expected,env});
  stop.signal.throwIfAborted();
  if(!policy)fail('policy-required');
  const policyBytes=readFileSync(policy),policies=JSON.parse(policyBytes),relay=execFileSync('git',['rev-parse','HEAD'],{cwd:codeRoot,env,encoding:'utf8'}).trim();
  if(!['shape','qualify'].includes(mode))fail('mode');
  if(mode==='qualify'&&(!shim?.relay||!shim?.baseRelay))fail('shim-required');
  const defs=mode==='qualify'?cases.qualificationItems:cases.shapeCases,judge=mode==='qualify'?cases.judgeItem:cases.judgeShape,see=mode==='qualify'?observeItem:observe;
  const identity={binary,mode:mode==='qualify'?'qualification':'shape-observation',...(mode==='qualify'?{shim}:{}),policy:digest(policyBytes),relay,runner:['./index.mjs','./cases.mjs','./pty.py','./dump.py','../../tools/codex-question/provider.mjs','../../tools/codex-question/private-server.mjs'].map(p=>digest(readFileSync(fileURLToPath(new URL(p,import.meta.url)))))};
  const receipts=files(out,'receipt.json').map(p=>JSON.parse(readFileSync(p,'utf8')));
  if(receipts.length&&!resume)fail('resume-required');
  const ids=caseIds.length?caseIds:defs.map(x=>x.id);
  if(ids.some(id=>!defs.some(x=>x.id===id)))fail('unknown-case');
  const pending=receiptSelection(receipts,identity,ids);
  for(const id of pending.slice(0,6)){
   stop.signal.throwIfAborted();const def=defs.find(x=>x.id===id),caseDir=join(out,id+'-'+randomUUID());mkdirSync(caseDir,{mode:0o700});
   const one=new AbortController(),relayAbort=()=>one.abort(stop.signal.reason);stop.signal.addEventListener('abort',relayAbort,{once:true});
   const started=Date.now(),deadline=setTimeout(()=>one.abort(Error('case-deadline')),90000);
   let observation,verdict;
   try{observation=await see({codex,def,input:policies.personal,dir:caseDir,signal:one.signal,shim});verdict=judge(def,observation);}
   catch(e){verdict={status:'incomplete',reason:e.message,dumps:[]};}
   finally{clearTimeout(deadline);stop.signal.removeEventListener('abort',relayAbort);}
   if(one.signal.aborted&&['observed','passed'].includes(verdict.status))verdict={status:'incomplete',reason:one.signal.reason?.message??'aborted',dumps:verdict.dumps};
   const receipt={identity,id,driver:def.driver,point:def.point??null,item:def.item??null,sandboxed:def.sandboxed,...verdict,durationMs:Date.now()-started,observation};save(join(caseDir,'receipt.json'),receipt);
   result.cases.push(receipt);
   if(observation){result.cleanup.ownedPids.push(...observation.cleanup.ownedPids);result.cleanup.survivors.push(...observation.cleanup.survivors);}
   if(observation?.cleanup.survivors.length){result.status='incomplete';result.reason='survivors';return result;}
  }
  const settled=mode==='qualify'?['passed','failed','unsupported','recorded']:['observed'];
  result.status=pending.length<=6&&result.cases.every(x=>settled.includes(x.status))?(mode==='qualify'?'settled':'observed'):'incomplete';
 }catch(e){result.reason=e.message;}
 finally{clearTimeout(outer);signal?.removeEventListener('abort',abort);}
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),opts={caseIds:[],resume:false};
 try{for(let i=0;i<args.length;i++){const key=args[i];if(key==='--resume')opts.resume=true;else if(key==='--case')opts.caseIds.push(args[++i]);else if(['--bin','--version','--sha256','--size','--code-root','--out','--policy','--mode','--relay','--base-relay','--tasks','--tasks-revision'].includes(key))opts[key.slice(2)]=args[++i];else fail('unknown-option');}
  if(!opts.bin||!opts.out||!opts['code-root']||!opts.policy||!opts.version||!opts.sha256||!opts.size)fail('missing-option');
  const controller=new AbortController(),interrupt=()=>controller.abort(Error('interrupted'));for(const s of ['SIGINT','SIGTERM'])process.once(s,interrupt);
  const result=await runProvenanceProbe({codex:opts.bin,expected:{version:opts.version,sha256:opts.sha256,size:Number(opts.size)},codeRoot:opts['code-root'],out:opts.out,policy:opts.policy,mode:opts.mode??'shape',shim:opts.mode==='qualify'?{relay:opts.relay,baseRelay:opts['base-relay'],tasks:opts.tasks??null,tasksRevision:opts['tasks-revision']??null}:null,caseIds:opts.caseIds,resume:opts.resume,signal:controller.signal});
  for(const s of ['SIGINT','SIGTERM'])process.removeListener(s,interrupt);
  if(existsSync(opts.out))save(join(opts.out,'slice-'+randomUUID()+'.json'),result);
  console.log(JSON.stringify({status:result.status,reason:result.reason,cases:result.cases.map(x=>({id:x.id,status:x.status,reason:x.reason})),cleanup:result.cleanup}));process.exitCode=['observed','settled'].includes(result.status)?0:result.status==='incomplete'?3:1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
