import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync,unlinkSync,createReadStream,statSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {startPrivateServer,probeEnvironment,scriptedConfig} from './private-server.mjs';
import {connectRpc} from '../../src/serve/codex/rpc.js';
import {startScriptedProvider,responseCreated,functionCall,assistantMessage,completed} from './provider.mjs';
async function planTurn(rpc,threadId,presets){
 const plan=presets.filter(p=>p.mode==='plan');assert.equal(plan.length,1,'one Plan preset');
 return rpc.call('turn/start',{threadId,input:[{type:'text',text:'Ask the fixed probe question.',text_elements:[]}],collaborationMode:{mode:'plan',settings:{model:plan[0].model??'mock-model',reasoning_effort:plan[0].reasoning_effort??null,developer_instructions:null}}});
}
export async function runNativePilot({out,codex,codeRoot,expected,version}){
mkdirSync(out,{mode:0o700});const privateDir=join(out,'private'),env=probeEnvironment(privateDir);
const pending=new Map();
const {createProcessOps}=await import(pathToFileURL(join(codeRoot,'src/bus/proc.js')));
const {connectSocket}=await import(pathToFileURL(join(codeRoot,'src/serve/client.js')));
const stop=new AbortController(),timer=setTimeout(()=>stop.abort(Error('pilot-deadline')),90000);
const interrupted=()=>stop.abort(Error('interrupted'));for(const s of ['SIGINT','SIGTERM'])process.once(s,interrupted);
const result={status:'unknown',assertions:[],witnesses:[],cleanup:{ownedPids:[],survivors:[]}};
const check=(name,passed)=>{result.assertions.push({name,passed});assert.ok(passed,name)};
let provider,server,control,client,relay,relayEnded,metadataPath,relayError='';
async function until(fn,ms=15000){const deadline=performance.now()+ms;for(;;){stop.signal.throwIfAborted();const value=await fn();if(value)return value;if(performance.now()>deadline)throw Error('pilot-observation-missing');await pause(50,undefined,{signal:stop.signal})}}
async function request(op,fields){const r=await client.request(op,fields);assert.equal(r.ok,true,op);return r}
async function entry(id){return (await request('get',{id})).entry}
async function stopRelay(){if(!relay)return;relay.kill('SIGTERM');let timeout;const ended=await Promise.race([relayEnded,new Promise(resolve=>timeout=setTimeout(()=>resolve(null),7000))]);clearTimeout(timeout);if(!ended){relay.kill('SIGKILL');await relayEnded;throw Error('relay-cleanup-timeout')}assert.equal(ended.code,0,'relay graceful exit');}
try{
 const hash=createHash('sha256');for await(const b of createReadStream(codex))hash.update(b);
 check('exact binary',hash.digest('hex')===expected.sha256&&statSync(codex).size===expected.size);
 for(const dir of [privateDir,env.HOME,env.CODEX_HOME,env.XDG_RUNTIME_DIR])mkdirSync(dir,{recursive:true,mode:0o700});
 const got=execFileSync(codex,['--version'],{env,timeout:5000,encoding:'utf8',maxBuffer:16384}).trim();check('exact CLI version',got==='codex-cli '+version);
 const question={questions:[{id:'color',header:'Color',question:'Choose a color',options:[{label:'Blue',description:'Blue option'},{label:'Red',description:'Red option'}]}]};
 const ask=(id,call)=>()=>[responseCreated(id),functionCall(call,'request_user_input',question),completed(id)],done=id=>()=>[responseCreated(id),assistantMessage(id+'m','Done.'),completed(id)];
 provider=await startScriptedProvider({signal:stop.signal,script:[ask('p1','call_production_1'),done('p2'),ask('p3','call_production_2'),done('p4')]});
 server=await startPrivateServer({codex,privateDir,configToml:'thread_unload_delay_secs = 2\n'+scriptedConfig({baseUrl:provider.baseUrl}),signal:stop.signal});result.cleanup.ownedPids.push(server.pid);
 control=await connectRpc({socketPath:server.socketPath,signal:stop.signal,onMessage:m=>{if(m.method==='item/tool/requestUserInput'&&['call_production_1','call_production_2'].includes(m.params?.itemId))pending.set(m.params.itemId,{id:m.id,params:{threadId:m.params.threadId,turnId:m.params.turnId,itemId:m.params.itemId}})}});const initialized=await control.call('initialize',{clientInfo:{name:'relay-production-private-controller',version:'1'},capabilities:{experimentalApi:true}});check('exact private native home',initialized.codexHome===env.CODEX_HOME);await control.send({method:'initialized'});
 const native=await control.call('thread/start',{model:'mock-model',cwd:privateDir,approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'read-only',ephemeral:false,historyMode:'paginated',threadSource:'user'}),threadId=native.thread.id;
 const processOps=createProcessOps(),handle=processOps.handleOf(server.pid);check('native foreground process qualified',!!handle);
 const processStartTime=execFileSync('/usr/bin/ps',['-p',String(server.pid),'-o','lstart='],{env:probeEnvironment(privateDir),encoding:'utf8'}).trim();
 const metadataDir=join(env.CODEX_HOME,'app-server-daemon');mkdirSync(metadataDir,{mode:0o700});metadataPath=join(metadataDir,'app-server.pid');
 // pid_start.rs:272-296 writes/renames with ordinary creation permissions:0644 under umask022.
 const record={pid:server.pid,processStartTime,processIdentity:{bootId:handle.bootId,startTicks:Number(handle.start)}};writeFileSync(metadataPath,JSON.stringify(record),{mode:0o644});result.nativeIdentity=record;
 check('native PID metadata mode0644',(statSync(metadataPath).mode&0o777)===0o644);
 const stateDir=join(privateDir,'relay');mkdirSync(stateDir,{mode:0o700});
 const row={id:'codex:'+threadId,harness:'codex',sessionId:threadId,scope:'session',process:handle,cwd:privateDir,repoRoot:null,remote:null,projectKey:privateDir,project:'private pilot',state:'working',updatedAt:Date.now()};
 writeFileSync(join(stateDir,'agents.json'),JSON.stringify({schema:2,generation:randomUUID(),revision:1,agents:{[row.id]:row}}),{mode:0o600});
 // Explicit allowlist: no inherited credentials, host homes, git state or launcher override.
 const relayEnv={PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:env.HOME,USER:'relay-probe',XDG_CONFIG_HOME:env.XDG_CONFIG_HOME,XDG_STATE_HOME:env.XDG_STATE_HOME,XDG_CACHE_HOME:env.XDG_CACHE_HOME,XDG_RUNTIME_DIR:env.XDG_RUNTIME_DIR,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',RELAY_STATE_DIR:stateDir,RELAY_CODEX_BIN:codex,RELAY_CODEX_HOME:env.CODEX_HOME,RELAY_CODEX_SOCKET:server.socketPath,RELAY_CODEX_EVIDENCE:join(codeRoot,'docs/evidence/codex-question-'+version+'.json')};
 relay=spawn(process.execPath,[join(codeRoot,'bin/relay.js'),'serve'],{cwd:codeRoot,env:relayEnv,stdio:['ignore','pipe','pipe']});if(relay.pid)result.cleanup.ownedPids.push(relay.pid);relay.stdout.resume();relay.stderr.on('data',b=>{relayError+=b;if(relayError.length>65536)stop.abort(Error('relay-output-limit'))});relayEnded=new Promise(resolve=>{relay.once('exit',(code,signal)=>resolve({code,signal}));relay.once('error',()=>{stop.abort(Error('relay-spawn'));resolve({code:null,signal:'spawn-error'})})});
 const socket=join(stateDir,'serve.sock');await until(()=>existsSync(socket));client=await connectSocket(socket);await request('presence.set',{mode:'away'});
 const presets=(await control.call('collaborationMode/list',{})).data;
 await planTurn(control,threadId,presets);const firstNative=await until(()=>pending.get('call_production_1'));
 const first=await until(async()=>{const r=await request('list',{});return r.entries.find(e=>e.kind==='question'&&e.question.body.native.callId.includes('call_production_1'))});
 check('public projection hides owner and rollout binding',!first.route.connector&&!('terminal' in first.route));
 const answerId=randomUUID(),answer={schema:1,id:randomUUID(),kind:'answer',correlationId:first.id,from:{kind:'user'},to:first.question.from,createdAt:Date.now(),context:first.question.context,body:{answerId,surface:'phone',outcome:'answered',artifactRevision:null,values:{q1:{type:'choice',optionIds:['o1']}}}};
 await request('answer',{message:answer});const consumed=await until(async()=>{const e=await entry(first.id);return e.state==='consumed'&&e});
 check('outside saved answer is actually consumed',consumed.answer.body.answerId===answerId&&consumed.observed.answers.color.answers[0]==='Blue');
 const actualFirst=provider.requests.at(-1)?.functionCallOutputs.find(x=>x.callId==='call_production_1');check('model received exact first answer',actualFirst&&JSON.parse(actualFirst.output).answers.color.answers[0]==='Blue');
 result.witnesses.push({id:first.id,tuple:{threadId,turnId:firstNative.params.turnId,itemId:firstNative.params.itemId},state:consumed.state,observed:consumed.observed,provider:true});
 await planTurn(control,threadId,presets);const secondNative=await until(()=>pending.get('call_production_2'));
 const second=await until(async()=>{const r=await request('list',{});return r.entries.find(e=>e.kind==='question'&&e.question.body.native.callId.includes('call_production_2'))});check('re-ask has a fresh UUID',second.id!==first.id);
 await request('defer',{message:{schema:1,id:randomUUID(),kind:'defer',correlationId:second.id,from:{kind:'user'},to:second.question.from,createdAt:Date.now(),context:second.question.context,body:{surface:'phone'}}});check('defer remains native pending',provider.requests.length===3);
 await control.send({id:secondNative.id,result:{answers:{color:{answers:['Red']}}}});
 const released=await until(async()=>{const e=await entry(second.id);return e.state==='released'&&e.observed?.answers?.color?.answers?.[0]==='Red'&&e});
 check('native answer updates released history',released.answer===null);const actualSecond=provider.requests.at(-1)?.functionCallOutputs.find(x=>x.callId==='call_production_2');check('model received native deferred answer',actualSecond&&JSON.parse(actualSecond.output).answers.color.answers[0]==='Red');
 result.witnesses.push({id:second.id,tuple:{threadId,turnId:secondNative.params.turnId,itemId:secondNative.params.itemId},state:released.state,observed:released.observed,provider:true});
 const helper=await control.call('thread/start',{model:'mock-model',cwd:privateDir,ephemeral:true,threadSource:'system'});await control.call('thread/unsubscribe',{threadId:helper.thread.id});
 await until(async()=>{const r=await control.call('thread/loaded/list',{limit:100});return r.nextCursor===null&&!r.data.includes(helper.thread.id)},7000);check('unselected auto-attached helper released',true);
 check('no helper question retained',(await request('list',{since:0})).entries.filter(e=>e.kind==='question').length===2);check('no credentials/auth file',!existsSync(join(env.CODEX_HOME,'auth.json')));check('no scripted extra turns',provider.requests.length===4);
 result.status='passed';
}catch(e){result.status='failed';result.reason=e.code??e.message;if(e.cleanup){result.cleanup.serverStartup=e.cleanup;result.cleanup.ownedPids.push(...e.cleanup.ownedPids)}}
finally{
 client?.close();try{await stopRelay()}catch(e){result.status='failed';result.cleanup.relayError=e.message}
 const cleaned=await Promise.allSettled([control?.close(),server?.stop(),provider?.close()]);
 const failures=cleaned.filter(x=>x.status==='rejected');if(failures.length){result.status='failed';result.cleanup.errors=failures.map(x=>x.reason.message)}
 if(server){result.cleanup.survivors=server.cleanup.survivors;result.cleanup.socketCandidates=server.cleanup.socketCandidates;}if(metadataPath&&existsSync(metadataPath))unlinkSync(metadataPath);result.cleanup.metadataRemoved=!metadataPath||!existsSync(metadataPath);result.cleanup.providerClosed=!!provider;
 for(const pid of result.cleanup.ownedPids)try{process.kill(pid,0);result.cleanup.survivors.push(pid)}catch{}
 if(result.cleanup.survivors.length)result.status='failed';clearTimeout(timer);writeFileSync(join(out,'relay.stderr'),relayError,{mode:0o600});writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
}
for(const s of ['SIGINT','SIGTERM'])process.removeListener(s,interrupted);return result;
}
