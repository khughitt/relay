import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,appendFileSync,lstatSync,existsSync,unlinkSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
const fail=code=>{throw Error(code)},digest=x=>createHash('sha256').update(x).digest('hex');
export function probeEnvironment(privateDir) {
 const home=join(privateDir,'home');
 return {PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:home,CODEX_HOME:join(home,'.codex'),XDG_CONFIG_HOME:join(home,'config'),XDG_STATE_HOME:join(home,'state'),XDG_CACHE_HOME:join(home,'cache'),XDG_RUNTIME_DIR:join(privateDir,'run'),USER:'relay-probe',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
}
export function scriptedConfig({baseUrl,features={},mcp=null}) {
 return `model = "mock-model"\nmodel_provider = "relay_scripted"\napproval_policy = "on-request"\nsandbox_mode = "read-only"\napprovals_reviewer = "user"\ncli_auth_credentials_store = "file"\n[model_providers.relay_scripted]\nname = "relay scripted"\nbase_url = ${JSON.stringify(baseUrl)}\nwire_api = "responses"\nrequest_max_retries = 0\nstream_max_retries = 0\nsupports_websockets = false\nrequires_openai_auth = false\n`+
  (Object.keys(features).length?'[features]\n'+Object.entries(features).map(([k,v])=>{if(!/^[a-z_]+$/.test(k)||typeof v!=='boolean')fail('feature-shape');return `${k} = ${v}\n`}).join(''):'')+
  (mcp?'[mcp_servers.relay_fixture]\ndefault_tools_approval_mode = "prompt"\ncommand = '+JSON.stringify(mcp.command)+'\nargs = '+JSON.stringify(mcp.args)+'\n':'');
}
export async function startPrivateServer({codex,privateDir,configToml,signal}) {
 const env=probeEnvironment(privateDir);for(const dir of [privateDir,env.HOME,env.CODEX_HOME,env.XDG_RUNTIME_DIR])mkdirSync(dir,{recursive:true,mode:0o700});
 writeFileSync(join(env.CODEX_HOME,'config.toml'),configToml,{mode:0o600});
 const socketPath=join(privateDir,'run','app.sock'),namespacePath=join(realpathSync('/tmp'),'codex-daemon-'+process.geteuid());
 const physical=join(namespacePath,digest(Buffer.from(socketPath))),candidates=[physical,physical+'.lock'];
 for(const path of candidates)if(lstatSync(path,{throwIfNoEntry:false}))fail('socket-candidate-preexisting');
 const child=spawn(codex,['app-server','--listen','unix://'+socketPath],{cwd:privateDir,env,stdio:['ignore','pipe','pipe'],detached:true});
 const cleanup={ownedPids:child.pid?[child.pid]:[],survivors:[],socketCandidates:[]};let exited=false,spawnError,outputBytes=0,closing;
 const closed=new Promise(r=>{child.once('error',e=>{spawnError=e;exited=true;r()});child.once('close',()=>{exited=true;r()})});
 for(const [stream,label] of [[child.stdout,'server.stdout'],[child.stderr,'server.stderr']])stream.on('data',data=>{outputBytes+=data.length;if(outputBytes<=1024*1024)appendFileSync(join(privateDir,label),data,{mode:0o600});else {spawnError=Error('server-output-limit');void stop()}});
 async function stop() {
  if(closing)return closing;
  closing=(async()=>{
   signal?.removeEventListener('abort',onAbort);
   const kill=s=>{try{process.kill(-child.pid,s)}catch(e){if(e.code!=='ESRCH')throw e}};
   if(child.pid){kill('SIGTERM');let timer;await Promise.race([closed,new Promise(r=>timer=setTimeout(r,2000))]);clearTimeout(timer);kill('SIGKILL');let hardTimer;const exitedInTime=await Promise.race([closed.then(()=>true),new Promise(r=>hardTimer=setTimeout(()=>r(false),2000))]);clearTimeout(hardTimer);if(!exitedInTime){child.stdout.destroy();child.stderr.destroy();cleanup.unresolved=['server-close',...candidates];throw Object.assign(Error('server-close-timeout'),{cleanup})}}
   if(child.pid){try{process.kill(child.pid,0);cleanup.survivors.push(child.pid)}catch(e){if(e.code!=='ESRCH')throw e}}
   for(const path of candidates){const s=lstatSync(path,{throwIfNoEntry:false});if(s){if(s.uid!==process.geteuid()||s.isSymbolicLink()||!(path===physical?s.isSocket():s.isFile()))fail('socket-cleanup-ownership');unlinkSync(path)}cleanup.socketCandidates.push({path,absent:!existsSync(path)})}
   if(lstatSync(socketPath,{throwIfNoEntry:false})){const s=lstatSync(socketPath);if(!s.isSymbolicLink()||s.uid!==process.geteuid())fail('alias-cleanup-ownership');unlinkSync(socketPath)}
   if(cleanup.survivors.length)fail('server-survived');
  })();return closing;
 }
 const onAbort=()=>{void stop().catch(()=>{})};signal?.addEventListener('abort',onAbort,{once:true});
 try {
  const deadline=Date.now()+15000;
  while(!lstatSync(socketPath,{throwIfNoEntry:false})){if(signal?.aborted)fail('interrupted');if(spawnError)throw spawnError;if(exited)fail('server-exited');if(Date.now()>deadline)fail('server-start-timeout');await pause(20)}
  const target=lstatSync(physical);
  if(realpathSync(socketPath)!==physical||!target.isSocket()||target.uid!==process.geteuid()||(target.mode&0o777)!==0o600)fail('socket-identity');
  return {socketPath:physical,aliasPath:socketPath,pid:child.pid,cleanup,stop};
 }catch(e){try{await stop()}catch(cleanupError){cleanup.error=cleanupError.message;cleanup.unresolved??=['server-cleanup'];throw Object.assign(cleanupError,{cleanup})}throw Object.assign(e,{cleanup})}
}
