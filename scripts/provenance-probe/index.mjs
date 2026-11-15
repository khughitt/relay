// Bounded, resumable native TUI qualification. No installed configuration is edited.
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {verifyNativeBinary,probeEnvironment} from '../../tools/codex-question/private-server.mjs';
import {startScriptedProvider,responseCreated,functionCall,assistantMessage,completed} from '../../tools/codex-question/provider.mjs';
import {pilotCases,judgeCase} from './cases.mjs';

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
 return ids.filter(id=>!receipts.some(r=>r.id===id&&r.status==='passed'));
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
async function terminal({argv,cwd,env,out,done,signal,timeout=89}) {
 const child=spawn('/usr/bin/python3',[fileURLToPath(new URL('./pty.py',import.meta.url))],{cwd,env:{...env,TERM:'xterm-256color',COLORTERM:'truecolor'},stdio:['pipe','pipe','pipe']});
 let output='',errors='';const abort=()=>child.kill('SIGTERM');signal?.addEventListener('abort',abort,{once:true});
 child.stdout.on('data',b=>{output+=b;if(output.length>65536)abort();});child.stderr.on('data',b=>{errors+=b;if(errors.length>65536)abort();});
 child.stdin.end(JSON.stringify({argv,cwd,output:out,done,timeout}));
 try {const code=await new Promise((yes,no)=>{child.once('error',no);child.once('close',yes);});if(code!==0)fail('pty-driver-failed:'+errors.slice(0,1000));return JSON.parse(output);}
 finally{signal?.removeEventListener('abort',abort);}
}
function files(root,suffix){if(!existsSync(root))return [];return readdirSync(root,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(join(root,x.name),suffix):x.name.endsWith(suffix)?[join(root,x.name)]:[]);}

export function createProbeScript({command,dir}) {
 let issued=false,finished=false;
 return Array.from({length:8},(_,index)=>r=>{
  save(join(dir,`request-${index}.json`),r);
  const tool=r.toolNames.find(x=>x.name==='exec_command')??r.toolNames.find(x=>x.name==='shell_command');
  if(tool&&!issued){
   issued=true;save(join(dir,'tools.json'),r.toolNames);
   return [responseCreated('probe1'),functionCall('probe-call',tool.name,tool.name==='exec_command'?{cmd:command,max_output_tokens:2000}:{command},tool.namespace??undefined),completed('probe1')];
  }
  if(r.functionCallOutputs.some(x=>x.callId==='probe-call')&&!finished){
   finished=true;save(join(dir,'tool-results.json'),r);writeFileSync(join(dir,'turn-done'),'done');
  }
  return [responseCreated('probe'+index),assistantMessage('end'+index,tool?'Probe complete.':'Private probe'),completed('probe'+index)];
 });
}

async function observe({codex,def,input,dir,rewrite,signal}) {
 mkdirSync(dir,{recursive:true,mode:0o700});const env=probeEnvironment(dir);
 for(const p of [env.HOME,env.CODEX_HOME,env.XDG_RUNTIME_DIR])mkdirSync(p,{recursive:true,mode:0o700});
 const project=join(dir,'project');mkdirSync(project,{mode:0o700});
 const blocked=join(dir,'blocked');mkdirSync(blocked,{mode:0o700});
 const sentinel=join(def.scenario==='sandbox'?blocked:project,'sentinel');
 const command='/usr/bin/touch '+quote(sentinel),payloadFile=join(dir,'hook-input.jsonl');
 const hook=join(dir,'fixture-hook.cjs');
 writeFileSync(hook,`const fs=require('node:fs');let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const p=JSON.parse(s);fs.appendFileSync(${JSON.stringify(payloadFile)},JSON.stringify({role:process.argv[2],payload:p})+'\\n');let r={};if(process.argv[2]==='deny')r={hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'fixture-deny'}};if(process.argv[2]==='rewrite'&&p.tool_name==='Bash')r={hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow',updatedInput:{...p.tool_input,command:"export TASKS_AGENT='codex/mock-model'\\nexport TASKS_MODEL='mock-model'\\n"+p.tool_input.command}}};console.log(JSON.stringify(r));});\n`,{mode:0o600});
 const handler=role=>({type:'command',command:quote(process.execPath)+' '+quote(hook)+' '+role,timeout:5});
 const handlers=[handler(rewrite?'rewrite':'observe')];if(def.gate==='deny')handlers.push(handler('deny'));
 const hooks={hooks:{PreToolUse:[{matcher:'Bash',hooks:handlers}],PermissionRequest:[{matcher:'Bash',hooks:[handler('permission')]}]}};
 save(join(env.CODEX_HOME,'hooks.json'),hooks);
 const rules=def.scenario==='prefix-allow'?'prefix_rule(pattern=["/usr/bin/touch"], decision="allow")\n':def.scenario==='prefix-prompt'?'prefix_rule(pattern=["/usr/bin/touch"], decision="prompt")\n':'';
 mkdirSync(join(env.CODEX_HOME,'rules'),{mode:0o700});writeFileSync(join(env.CODEX_HOME,'rules','default.rules'),rules,{mode:0o600});
 let provider;const done=join(dir,'turn-done');
 try {
  provider=await startScriptedProvider({signal,script:createProbeScript({command,dir})});
  assertPrivateProvider({baseUrl:provider.baseUrl,requiresAuth:false});
  const projected=privatePolicy(input,dir);
  const config={...projected.config,model:'mock-model',model_provider:'relay_scripted',model_reasoning_effort:'low',cli_auth_credentials_store:'file',projects:{[project]:{trust_level:'trusted'}},model_providers:{relay_scripted:{name:'private scripted',base_url:provider.baseUrl,wire_api:'responses',request_max_retries:0,stream_max_retries:0,supports_websockets:false,requires_openai_auth:false}},tui:{screen_reader_detection_done:true,show_tooltips:false}};
  const text=toml(config);writeFileSync(join(env.CODEX_HOME,'config.toml'),text,{mode:0o600});
  save(join(dir,'input-identities.json'),{mode:'interactive-tui',policy:input,projection:config,pathRoles:projected.map,rules,hookDefinitions:hooks,configSha256:digest(text),rulesSha256:digest(rules)});
  const result=await terminal({argv:[codex,'--no-alt-screen','--dangerously-bypass-hook-trust','Run the fixed private probe.'],cwd:project,env,out:join(dir,'tui.raw'),done,signal});
  const rows=existsSync(payloadFile)?readFileSync(payloadFile,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
  const native=rows.find(x=>x.role!=='permission')?.payload;
  const rollouts=files(join(env.CODEX_HOME,'sessions'),'.jsonl');
  const records=rollouts.flatMap(p=>readFileSync(p,'utf8').split('\n').filter(Boolean).map(x=>({file:p,row:JSON.parse(x)})));
  const sessions=records.filter(x=>x.row.type==='session_meta').map(x=>x.row.payload);
  const contexts=records.filter(x=>x.row.type==='turn_context').map(x=>x.row.payload);
  const output=provider.requests.flatMap(r=>r.functionCallOutputs??[]).map(x=>x.output).join('\n');
  const effect=existsSync(sentinel),denialSeen=output.includes('fixture-deny');
  const prompts=rows.filter(x=>x.role==='permission').length;
  const effective=contexts.find(x=>x.approval_policy!==undefined&&x.sandbox_policy!==undefined);
  const observed={mode:'interactive-tui',complete:result.reason==='turn-complete'&&existsSync(done)&&!!effective,hookSeen:!!native,denialSeen,sentinel:effect,prompts,decision:effect?'permit':output?'refuse':'unknown',boundary:effective?{approval:effective.approval_policy,sandbox:effective.sandbox_policy}:null,cleanup:result.cleanup,terminal:result,native,output,rollouts,sessions,contexts};
  // Compare the effective boundary structurally; paths differ only by paired fixture role.
  observed.boundary=JSON.stringify(observed.boundary).replaceAll(dir,'<case>');
  save(join(dir,'observation.json'),observed);return observed;
 }finally{if(provider){save(join(dir,'provider-requests.json'),provider.requests);await provider.close();}}
}

export async function runProvenanceProbe({codex,expected,codeRoot,out,phase,caseIds=[],resume=false,signal}) {
 const result={status:'failed',cases:[],representation:{},cleanup:{ownedPids:[],survivors:[]}};
 const stop=new AbortController(),outer=setTimeout(()=>stop.abort(Error('slice-deadline')),600000);
 const abort=()=>stop.abort(signal?.reason??Error('interrupted'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 try {
  const env=probeEnvironment(join(out,'admission'));
  for(const p of [env.HOME,env.CODEX_HOME])mkdirSync(p,{recursive:true,mode:0o700});
  const binary=await verifyNativeBinary({codex,expected,env});
  stop.signal.throwIfAborted();
  const policyBytes=readFileSync(join(dirname(out),'policy-inputs.json'));
  const policies=JSON.parse(policyBytes),relay=execFileSync('git',['rev-parse','HEAD'],{cwd:codeRoot,env,encoding:'utf8'}).trim();
  const identity={binary,mode:'interactive-tui',policy:digest(policyBytes),rules:'synthetic-touch-v1',relay,runner:['./index.mjs','./cases.mjs','./pty.py','../../tools/codex-question/provider.mjs','../../tools/codex-question/private-server.mjs'].map(p=>digest(readFileSync(fileURLToPath(new URL(p,import.meta.url)))))};
  if(!['pilot','matrix'].includes(phase))fail('phase');
  if(phase==='matrix')fail('matrix-requires-complete-pilot-and-case-expansion');
  mkdirSync(out,{recursive:true,mode:0o700});
  const receipts=files(out,'receipt.json').map(p=>JSON.parse(readFileSync(p,'utf8')));
  if(receipts.length&&!resume)fail('resume-required');
  const ids=caseIds.length?caseIds:pilotCases.map(x=>x.id);
  if(ids.some(id=>!pilotCases.some(x=>x.id===id)))fail('unknown-case');
  const pending=receiptSelection(receipts,identity,ids);
  for(const id of pending.slice(0,6)){
   stop.signal.throwIfAborted();const def=pilotCases.find(x=>x.id===id),caseDir=join(out,id+'-'+randomUUID());mkdirSync(caseDir,{mode:0o700});
   const started=Date.now(),deadline=setTimeout(()=>stop.abort(Error('case-deadline')),90000);
   let original,rewritten,verdict;
   try {
    original=await observe({codex,def,input:policies[def.policy],dir:join(caseDir,'original'),rewrite:false,signal:stop.signal});
    if(!original.complete)verdict={status:'incomplete',reason:'original-tui-case-incomplete'};
    else {rewritten=await observe({codex,def,input:policies[def.policy],dir:join(caseDir,'rewritten'),rewrite:true,signal:stop.signal});verdict=judgeCase(def,{original,rewritten});}
   }catch(e){verdict={status:'incomplete',reason:e.message};}
   finally{clearTimeout(deadline);}
   const receipt={identity,id,...verdict,durationMs:Date.now()-started,original,rewritten};save(join(caseDir,'receipt.json'),receipt);result.cases.push(receipt);
   for(const o of [original,rewritten])if(o){result.cleanup.ownedPids.push(...o.cleanup.ownedPids);result.cleanup.survivors.push(...o.cleanup.survivors);}
   if(verdict.status!=='passed'){result.status=verdict.status;result.reason=verdict.reason;return result;}
  }
  result.status=pending.length>6?'incomplete':'passed';
 }catch(e){result.reason=e.message;}
 finally{clearTimeout(outer);signal?.removeEventListener('abort',abort);}
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),opts={caseIds:[],resume:false};
 try{for(let i=0;i<args.length;i++){const key=args[i];if(key==='--resume')opts.resume=true;else if(key==='--case')opts.caseIds.push(args[++i]);else if(['--bin','--version','--sha256','--size','--code-root','--out','--phase'].includes(key))opts[key.slice(2)]=args[++i];else fail('unknown-option');}
  if(!opts.bin||!opts.out||!opts['code-root']||!opts.version||!opts.sha256||!opts.size)fail('missing-option');
  const controller=new AbortController(),interrupt=()=>controller.abort(Error('interrupted'));for(const s of ['SIGINT','SIGTERM'])process.once(s,interrupt);
  const result=await runProvenanceProbe({codex:opts.bin,expected:{version:opts.version,sha256:opts.sha256,size:Number(opts.size)},codeRoot:opts['code-root'],out:opts.out,phase:opts.phase,caseIds:opts.caseIds,resume:opts.resume,signal:controller.signal});
  for(const s of ['SIGINT','SIGTERM'])process.removeListener(s,interrupt);
  if(existsSync(opts.out))save(join(opts.out,'slice-'+randomUUID()+'.json'),result);
  console.log(JSON.stringify({status:result.status,reason:result.reason,cases:result.cases.map(x=>({id:x.id,status:x.status,reason:x.reason})),cleanup:result.cleanup}));process.exitCode=result.status==='passed'?0:result.status==='incomplete'?3:1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
