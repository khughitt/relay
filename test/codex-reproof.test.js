import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
const helpers=await import('../tools/codex-question/private-server.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const provider=await import('../tools/codex-question/provider.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
async function root(t){const dir=await mkdtemp(join(tmpdir(),'relay-reproof-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir}
test('private child environment names only owned homes and explicit safe variables',async t=>{
 assert.equal(typeof helpers.probeEnvironment,'function');const dir=await root(t),env=helpers.probeEnvironment(dir);assert.deepEqual(Object.keys(env).sort(),['CODEX_HOME','GIT_CONFIG_GLOBAL','GIT_CONFIG_NOSYSTEM','HOME','PATH','USER','XDG_CACHE_HOME','XDG_CONFIG_HOME','XDG_RUNTIME_DIR','XDG_STATE_HOME']);assert.equal(env.HOME,join(dir,'home'));assert.equal(env.CODEX_HOME,join(dir,'home','.codex'));assert.equal(env.GIT_CONFIG_GLOBAL,'/dev/null');
});
test('private server early exit reaps its process and retains bounded safe output',{timeout:5000},async t=>{
 assert.equal(typeof helpers.startPrivateServer,'function');const dir=await root(t),bin=join(dir,'early-exit');await writeFile(bin,'#!/usr/bin/env node\nconsole.log(JSON.stringify(Object.keys(process.env).sort()));\n',{mode:0o700});let failure;try{await helpers.startPrivateServer({codex:bin,privateDir:join(dir,'private'),configToml:''})}catch(e){failure=e}
 assert.ok(failure);assert.deepEqual(failure.cleanup.survivors,[]);const keys=JSON.parse((await readFile(join(dir,'private','server.stdout'),'utf8')).trim());assert.ok(!keys.includes('GH_TOKEN'));for(const p of failure.cleanup.socketCandidates)assert.equal(p.absent,true);
});
test('scripted provider enforces its request boundary and observes actual function output',async t=>{
 assert.equal(typeof provider.startScriptedProvider,'function');const p=await provider.startScriptedProvider({script:[()=>[provider.completed('answer')]]});t.after(()=>p.close());
 const r=await fetch(p.baseUrl+'/responses',{method:'POST',body:JSON.stringify({tools:[],input:[{type:'function_call_output',call_id:'call',output:'{"answers":{}}'}]})});assert.equal(r.status,200);await r.text();assert.deepEqual(p.requests[0].functionCallOutputs,[{callId:'call',output:'{"answers":{}}'}]);
 const bad=await fetch(p.baseUrl+'/else',{method:'POST',body:'{}'});assert.equal(bad.status,404);
});
test('reproof CLI rejects missing or altered archives without executing a candidate',async t=>{
 const dir=await root(t),bin=join(dir,'candidate'),old=join(dir,'old.tar.gz'),next=join(dir,'next.tar.gz'),out=join(dir,'out');await writeFile(bin,'#!/usr/bin/env node\nrequire("node:fs").writeFileSync("NEVER_EXECUTED","bad");\n',{mode:0o700});await writeFile(old,'bad');await writeFile(next,'bad');
 const child=spawn(process.execPath,['tools/codex-question/reprove.mjs','--baseline-source',old,'--source',next,'--bin',bin,'--binary-sha256','0'.repeat(64),'--out',out],{cwd:process.cwd(),env:{PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:dir,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',b=>text+=b);child.stderr.on('data',b=>text+=b);const code=await new Promise(r=>child.once('exit',r));assert.equal(code,1);assert.match(text,/source-archive-pin/);assert.ok(!(await readdir(dir)).includes('NEVER_EXECUTED'));assert.ok(!(await readdir(dir)).includes('out'));
});
test('native pilot rejects an unpinned executable before version execution or server launch',async t=>{
 const {runNativePilot}=await import('../tools/codex-question/native-pilot.mjs');const dir=await root(t),bin=join(dir,'never');await writeFile(bin,'#!/usr/bin/env node\nrequire("node:fs").writeFileSync("NEVER_EXECUTED","bad");\n',{mode:0o700});
 const result=await runNativePilot({out:join(dir,'pilot'),codex:bin,codeRoot:process.cwd(),expected:{sha256:'0'.repeat(64),size:1},version:'0.166.0'});assert.equal(result.status,'failed');assert.deepEqual(result.cleanup.ownedPids,[]);assert.deepEqual(result.assertions,[{name:'exact binary',passed:false}]);assert.ok(!(await readdir(dir)).includes('NEVER_EXECUTED'));
});
test('protocol evidence rejects a changed terminal enum rather than inheriting old pins',async()=>{
 const m=await import('../tools/codex-question/protocol-proof.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});assert.equal(typeof m.proveProtocol,'function');
 const valid={'v2/TurnStatus.ts':'export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";','v2/ThreadUnsubscribeStatus.ts':'export type ThreadUnsubscribeStatus = "notLoaded" | "notSubscribed" | "unsubscribed";','v2/ThreadUnsubscribeParams.ts':'export type ThreadUnsubscribeParams = { threadId: string };','v2/ThreadUnsubscribeResponse.ts':'export type ThreadUnsubscribeResponse = { status: ThreadUnsubscribeStatus };'};
 assert.equal(m.proveProtocol(valid).status,'passed');assert.equal(m.proveProtocol({...valid,'v2/TurnStatus.ts':valid['v2/TurnStatus.ts'].replace('"failed"','"differentTerminal"')}).status,'failed');assert.equal(m.proveProtocol({}).status,'failed');
});
test('TUI override census rejects a production override and an empty source tree',async t=>{
 assert.equal(existsSync(new URL('../tools/codex-question/tui-census.py',import.meta.url)),true,'repeatable census checker required');
 const {execFileSync,spawnSync}=await import('node:child_process'),{mkdir}=await import('node:fs/promises');const dir=await root(t),prefix=join(dir,'codex-rust-v0.166.0','codex-rs','tui','src');await mkdir(join(prefix,'app'),{recursive:true});await writeFile(join(prefix,'app.rs'),'#[cfg(test)]\nmod tests;\n');await writeFile(join(prefix,'app','tests.rs'),'fn test_override(){ let cfg="thread_unload_delay_secs = 0"; }');
 const env={PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:dir,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},archive=join(dir,'source.tar.gz');
 async function run(){execFileSync('tar',['-czf',archive,'codex-rust-v0.166.0'],{cwd:dir,env});const p=spawnSync('python3',['tools/codex-question/tui-census.py',archive,'0.166.0'],{env,encoding:'utf8'});return {exit:p.status,value:JSON.parse(p.stdout)}}
 let p=await run();assert.equal(p.exit,0);assert.equal(p.value.status,'passed');await writeFile(join(prefix,'real.rs'),'fn production(){ let cfg="thread_unload_delay_secs = 1"; }');p=await run();assert.equal(p.exit,1);assert.equal(p.value.status,'failed');await rm(join(dir,'codex-rust-v0.166.0'),{recursive:true});await mkdir(join(dir,'codex-rust-v0.166.0'));p=await run();assert.equal(p.exit,1);assert.equal(p.value.status,'failed');
});
