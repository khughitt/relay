import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';

const probe=await import('../scripts/provenance-probe/index.mjs').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;
});
const cases=await import('../scripts/provenance-probe/cases.mjs').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;
});
async function root(t){const p=await mkdtemp(join(tmpdir(),'relay-provenance-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;}

test('wrong executable pin starts no process',async t=>{
  assert.equal(typeof probe.runProvenanceProbe,'function');
  const dir=await root(t),bin=join(dir,'candidate');
  await writeFile(bin,'#!/bin/sh\ntouch "'+join(dir,'executed')+'"\n',{mode:0o700});
  const result=await probe.runProvenanceProbe({codex:bin,expected:{version:'0.169.0',size:1,sha256:'0'.repeat(64)},codeRoot:process.cwd(),out:join(dir,'out'),phase:'pilot',caseIds:[],resume:false});
  assert.equal(result.status,'failed');assert.deepEqual(result.cleanup.ownedPids,[]);
  await assert.rejects(readFile(join(dir,'executed')),{code:'ENOENT'});
});

test('only the loopback unauthenticated provider is admitted',()=>{
  assert.equal(typeof probe.assertPrivateProvider,'function');
  assert.doesNotThrow(()=>probe.assertPrivateProvider({baseUrl:'http://127.0.0.1:1234/v1',requiresAuth:false}));
  for(const p of [{baseUrl:'https://api.openai.com/v1',requiresAuth:false},{baseUrl:'http://127.0.0.1:1234/v1',requiresAuth:true},{baseUrl:'http://user:pw@127.0.0.1:1/v1',requiresAuth:false}])assert.throws(()=>probe.assertPrivateProvider(p));
});

test('resume refuses any changed evidence identity and never erases a failed attempt',async t=>{
  assert.equal(typeof probe.receiptSelection,'function');
  const dir=await root(t),identity={binary:'a',mode:'interactive-tui',policy:'b',rules:'c',relay:'d'};
  await writeFile(join(dir,'receipt.json'),JSON.stringify({identity,id:'one',status:'failed'}));
  assert.deepEqual(probe.receiptSelection([{identity,id:'one',status:'passed'}],identity,['one','two']),['two']);
  assert.deepEqual(probe.receiptSelection([{identity,id:'one',status:'observed'},{identity,id:'two',status:'incomplete'}],identity,['one','two']),['two']);
  assert.throws(()=>probe.receiptSelection([{identity,id:'one',status:'failed'}],identity,['one']),/failed-attempt/);
  for(const key of Object.keys(identity))assert.throws(()=>probe.receiptSelection([{identity,id:'one',status:'passed'}],{...identity,[key]:'changed'},['one']),/identity/);
});

test('PTY timeout reaps the native process group',{timeout:6000},async t=>{
  const dir=await root(t),out=join(dir,'tui.raw'),pidFile=join(dir,'pid');
  const spec={argv:['/bin/sh','-c','echo $$ > "$1"; sleep 60 & wait','fixture',pidFile],cwd:dir,output:out,timeout:0.3};
  const child=spawn('python3',['scripts/provenance-probe/pty.py'],{cwd:process.cwd(),env:{PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:dir,TERM:'xterm-256color',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(JSON.stringify(spec));
  const code=await new Promise(r=>child.once('close',r));
  assert.equal(code,0,stderr);const result=JSON.parse(stdout);assert.equal(result.reason,'deadline');assert.deepEqual(result.cleanup.survivors,[]);
  const pid=Number((await readFile(pidFile,'utf8')).trim());assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});

const turnAt=Date.parse('2026-11-16T10:00:00.000Z');
// One dump whose call process (index 1, under codex at index 2) started freshMs after turnAt.
function dumpAt({point='call',step=1,callLoMs,uptimeMs=100000}){
  const wall=turnAt+20000,ticks=Math.round((uptimeMs-(wall-callLoMs-11))/10);
  const row=(pid,comm)=>({pid,ppid:pid+1,start:ticks,comm,exe:'/usr/bin/'+comm,argv:[comm],pidNamespace:'pid:[1]'});
  return {point,step,pid:10,ppid:11,start:ticks,comm:'python3',exe:'/usr/bin/python3',argv:['python3'],pidNamespace:'pid:[1]',isNamespaceInit:false,subreaper:null,
    chain:[row(10,'python3'),row(11,'bash'),row(12,'codex')],env:{CODEX_THREAD_ID:'t'},clkTck:100,uptime:{wallBeforeMs:wall,uptimeText:(uptimeMs/1000).toFixed(2)+' 0.00',wallAfterMs:wall}};
}
const contexts=at=>at.map(x=>({at:x,model:'mock-model',fileSystem:'restricted'}));

test('rewrite cases are gone',()=>{
  assert.equal(cases.judgeCase,undefined);assert.equal(cases.pilotCases,undefined);
  assert.ok(Array.isArray(cases.shapeCases)&&cases.shapeCases.length>0);
  for(const c of cases.shapeCases)assert.doesNotMatch(c.id,/prefix|deny/);
  const ids=cases.shapeCases.map(c=>c.id);
  for(const id of ['app-server-sandboxed-call','app-server-sandboxed-second-call','app-server-sandboxed-orphan-after-parent-exit','app-server-sandboxed-cross-turn-shell',
    'exec-sandboxed-call','exec-sandboxed-orphan-after-parent-exit','tui-sandboxed-call','tui-sandboxed-second-call','tui-sandboxed-user-escape',
    'app-server-unsandboxed-call','app-server-unsandboxed-orphan-after-parent-exit','exec-unsandboxed-call','exec-unsandboxed-orphan-after-parent-exit',
    'app-server-sandboxed-orphan-setsid','app-server-unsandboxed-orphan-setsid','exec-sandboxed-orphan-setsid','exec-unsandboxed-orphan-setsid','tui-unsandboxed-orphan-setsid'])assert.ok(ids.includes(id),id);
  assert.equal(ids.length,18);assert.deepEqual(ids.filter(id=>id.startsWith('tui-unsandboxed')),['tui-unsandboxed-orphan-setsid']);
});

test('shape receipt without a chain is incomplete',()=>{
  const def=cases.shapeCases.find(c=>c.id==='exec-sandboxed-call');
  const good={complete:true,cleanup:{survivors:[]},contexts:contexts([turnAt]),dumps:[dumpAt({callLoMs:turnAt+3000})]};
  assert.equal(cases.judgeShape(def,good).status,'observed');
  for(const dumps of [[],[{...good.dumps[0],chain:[]}],[{...good.dumps[0],chain:undefined}]])
    assert.equal(cases.judgeShape(def,{...good,dumps}).status,'incomplete');
  assert.equal(cases.judgeShape(def,{...good,cleanup:{survivors:[5]}}).status,'incomplete');
  assert.equal(cases.judgeShape(def,{...good,dumps:[{...good.dumps[0],clkTck:250}]}).reason,'clock-ticks');
  const orphan=cases.shapeCases.find(c=>c.id==='exec-sandboxed-orphan-after-parent-exit');
  assert.equal(cases.judgeShape(orphan,{...good,dumps:[],orphanWaitMs:8000,orphanStarted:true}).outcome,'orphan-killed-before-dump');
  assert.equal(cases.judgeShape(orphan,{...good,dumps:[],orphanWaitMs:8000,orphanStarted:false}).outcome,'orphan-never-started');
  assert.equal(cases.judgeShape(orphan,{...good,dumps:[],orphanWaitMs:7000}).status,'incomplete');
  assert.equal(cases.judgeShape(def,{...good,contexts:contexts([turnAt]).map(c=>({...c,fileSystem:'unrestricted'}))}).status,'incomplete');
});

test('a fresh-call margin under 1500 ms is incomplete',()=>{
  const def=cases.shapeCases.find(c=>c.id==='app-server-sandboxed-call');
  const at=ms=>({complete:true,cleanup:{survivors:[]},contexts:contexts([turnAt]),dumps:[dumpAt({callLoMs:turnAt+ms})]});
  const ok=cases.judgeShape(def,at(1600));assert.equal(ok.status,'observed');assert.ok(ok.dumps[0].margins.freshMs>=1500);
  const short=cases.judgeShape(def,at(1400));assert.equal(short.status,'incomplete');assert.match(short.reason,/fresh/);
});

test('an old shell less than 1500 ms before turn B is incomplete',()=>{
  const def=cases.shapeCases.find(c=>c.id==='app-server-sandboxed-cross-turn-shell');
  const turnB=turnAt+10000;
  const make=leadMs=>{const d=dumpAt({point:'cross-turn-shell',step:2,callLoMs:turnB-leadMs-30});return {complete:true,cleanup:{survivors:[]},contexts:contexts([turnAt,turnB]),dumps:[d]};};
  const ok=cases.judgeShape(def,make(2000));assert.equal(ok.status,'observed',ok.reason);assert.ok(ok.dumps[0].margins.shellLeadMs>=1500);
  const short=cases.judgeShape(def,make(1000));assert.equal(short.status,'incomplete');assert.match(short.reason,/shell-lead/);
});

test('margins are computed from the startedAtMs interval',async()=>{
  const {createProcessOps}=await import('../src/bus/proc.js');
  const uptime={wallBeforeMs:1_700_000_050_000,uptimeText:'12345.67 99.00',wallAfterMs:1_700_000_050_004};
  const reads=[uptime.wallBeforeMs,uptime.wallAfterMs];
  const expected=createProcessOps({platform:'linux',readText:p=>{assert.equal(p,'/proc/uptime');return uptime.uptimeText;},now:()=>reads.shift()}).startedAtMs({starttime:'1000000'});
  assert.deepEqual(cases.startInterval({start:1000000},uptime),expected);
  assert.deepEqual(expected,{lo:1_700_000_050_000-(12345670-10000000)-11,hi:1_700_000_050_004-(12345670-10000000)+11});
});

test('input script sends text after its delay',{timeout:8000},async t=>{
  const dir=await root(t),out=join(dir,'tui.raw'),line=join(dir,'line'),script=join(dir,'input.json');
  await writeFile(script,JSON.stringify([{afterMs:400,text:'hello probe'}]));
  const spec={argv:['/bin/sh','-c','read -r x; printf %s "$x" > "$1"','fixture',line],cwd:dir,output:out,timeout:5};
  const child=spawn('python3',['scripts/provenance-probe/pty.py','--input-script',script],{cwd:process.cwd(),env:{PATH:'/usr/bin:/bin',HOME:dir,TERM:'xterm-256color'},stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(JSON.stringify(spec));
  const code=await new Promise(r=>child.once('close',r));
  assert.equal(code,0,stderr);const result=JSON.parse(stdout);
  assert.equal(await readFile(line,'utf8'),'hello probe');assert.ok(result.durationMs>=400,String(result.durationMs));
  assert.deepEqual(result.inputs.map(x=>x.afterMs),[400]);
});

test('delayMs holds the response',async t=>{
  const {startScriptedProvider,responseCreated,completed}=await import('../tools/codex-question/provider.mjs');
  const p=await startScriptedProvider({script:[()=>({delayMs:300,events:[responseCreated('a'),completed('a')]}),()=>[responseCreated('b'),completed('b')]]});t.after(()=>p.close());
  const post=async()=>{const t0=performance.now();const r=await fetch(p.baseUrl+'/responses',{method:'POST',body:JSON.stringify({tools:[],input:[{type:'message',role:'user',content:[{type:'input_text',text:'Run probe step 1.'}]}]})});assert.equal(r.status,200);await r.text();return performance.now()-t0;};
  assert.ok(await post()>=290);assert.ok(await post()<290);
  assert.deepEqual(p.requests[0].userTexts,['Run probe step 1.']);
});

test('the shape script issues one call per numbered step and ignores housekeeping',async t=>{
  const dir=await root(t),script=probe.createShapeScript({commands:['first-command','second-command'],dir,delayMs:0});
  const {startScriptedProvider}=await import('../tools/codex-question/provider.mjs');
  const p=await startScriptedProvider({script});t.after(()=>p.close());
  const user=text=>({type:'message',role:'user',content:[{type:'input_text',text}]});
  async function send(body){const r=await fetch(p.baseUrl+'/responses',{method:'POST',body:JSON.stringify(body)});assert.equal(r.status,200);return r.text();}
  const tools=[{type:'function',name:'exec_command'}];
  assert.doesNotMatch(await send({tools:[],input:[user('Run probe step 1.')]}),/function_call/);
  assert.match(await send({tools,input:[user('Run probe step 1.')]}),/first-command/);
  assert.doesNotMatch(await send({tools,input:[user('Run probe step 1.'),{type:'function_call_output',call_id:'probe-call-1',output:'ok'}]}),/function_call/);
  assert.match(await send({tools,input:[user('Run probe step 1.'),user('Run probe step 2.')]}),/second-command/);
  await send({tools,input:[user('Run probe step 2.'),{type:'function_call_output',call_id:'probe-call-2',output:'ok'}]});
  assert.equal(await readFile(join(dir,'turn-done'),'utf8'),'done');
  assert.equal(await readFile(join(dir,'turn-1-done'),'utf8'),'done');
});
