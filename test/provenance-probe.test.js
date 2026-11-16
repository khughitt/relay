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

// Task 4: one judge per spec qualification item (spec r10, "Native qualification before cutover").
const SHIM='/case/shim';
const verifiedAnswer=(model,thread='t-parent',nearest='codex')=>({verified:true,agent:`codex/${model}@low`,harness:'codex',model,effort:'low',effortReason:null,reason:null,source:{thread,nearest,rollout:'/r'}});
const unverifiedAnswer=(reason,nearest)=>({verified:false,agent:'codex',harness:'codex',model:null,effort:null,effortReason:null,reason,source:{thread:'t-parent',...(nearest===undefined?{}:{nearest})}});
const helperChain=(ppid=1)=>[{pid:9,ppid,start:3000,comm:'python3',exe:'/usr/bin/python3',argv:['python3'],pidNamespace:'pid:[1]',isNamespaceInit:false},{pid:1,ppid:0,start:1000,comm:'codex',exe:'/codex',argv:['codex-linux-sandbox'],pidNamespace:'pid:[1]',isNamespaceInit:true}];
const itemObs=(over={})=>({complete:true,cleanup:{survivors:[]},contexts:[{at:turnAt,model:'mock-model',fileSystem:'restricted'},{at:turnAt+10000,model:'model-b',fileSystem:'restricted'}],answers:{},dumps:[],shim:{dir:SHIM,relay:`${SHIM}/relay`,tasks:`${SHIM}/tasks`},tasks:null,...over});
const item=id=>cases.qualificationItems.find(x=>x.id===id);

test('qualification items cover the spec items 1-9',()=>{
  assert.deepEqual([...new Set(cases.qualificationItems.map(x=>x.item))].sort(),[1,2,3,4,5,6,7,8,9]);
  for(const d of cases.qualificationItems)assert.equal(typeof d.tasks,'boolean',d.id);
  assert.deepEqual(cases.qualificationItems.filter(x=>x.tasks).map(x=>x.item).sort(),[1,4,4,5,7,9]);
});

test('item 1 passes only on a verified answer with the session model and nearest codex',()=>{
  const d=item('item-1-app-server');
  assert.equal(cases.judgeItem(d,itemObs({answers:{call:verifiedAnswer('mock-model')}})).status,'passed');
  assert.equal(cases.judgeItem(d,itemObs({answers:{call:unverifiedAnswer('earlier-turn','codex')}})).status,'failed');
  assert.equal(cases.judgeItem(d,itemObs({answers:{call:verifiedAnswer('mock-model','t','claude-code')}})).status,'failed');
  assert.equal(cases.judgeItem(d,itemObs()).status,'incomplete');
  assert.equal(cases.judgeItem(d,itemObs({cleanup:{survivors:[3]},answers:{call:verifiedAnswer('mock-model')}})).status,'incomplete');
});

test('item 4 without confirmed reparenting is incomplete',()=>{
  const d=item('item-4');
  const underCodex=[{pid:9,ppid:8,comm:'python3'},{pid:8,ppid:7,comm:'sh'},{pid:7,ppid:6,comm:'codex'}];
  const r=cases.judgeItem(d,itemObs({contexts:[{at:turnAt,model:'mock-model',fileSystem:null}],answers:{job:unverifiedAnswer('not-under-codex',null)},dumps:[{point:'job',step:1,chain:underCodex,clkTck:100,uptime:{}}]}));
  assert.equal(r.status,'incomplete');assert.match(r.reason,/reparent/);
  const reparented=[{pid:9,ppid:8,comm:'python3'},{pid:8,ppid:1540,comm:'sh'},{pid:1540,ppid:1,comm:'systemd'}];
  const ok=cases.judgeItem(d,itemObs({contexts:[{at:turnAt,model:'mock-model',fileSystem:null}],answers:{job:unverifiedAnswer('not-under-codex',null)},dumps:[{point:'job',step:1,chain:reparented,clkTck:100,uptime:{}}]}));
  assert.deepEqual([ok.status,ok.reason,ok.relaySide],['incomplete','tasks-pending','passed']);
});

test('a verified newer model in item 7 or 9 fails',()=>{
  for(const id of ['item-7','item-9']){
    const r=cases.judgeItem(item(id),itemObs({answers:{late:verifiedAnswer('model-b')},dumps:[{point:'late',step:2,chain:helperChain(),clkTck:100,uptime:{wallBeforeMs:turnAt+20000,uptimeText:'100.00 0.00',wallAfterMs:turnAt+20000}}]}));
    assert.equal(r.status,'failed',id);
  }
});

test('item 9 without adoption evidence is unsupported',()=>{
  const d=item('item-9'),answers={late:unverifiedAnswer('earlier-turn','codex')};
  assert.equal(cases.judgeItem(d,itemObs({answers})).status,'unsupported');
  assert.equal(cases.judgeItem(d,itemObs({answers,dumps:[{point:'late',step:2,chain:helperChain(5),clkTck:100,uptime:{}}]})).status,'unsupported');
  assert.equal(cases.judgeItem(d,itemObs({answers:{late:unverifiedAnswer('not-under-codex',null)},dumps:[{point:'late',step:2,chain:helperChain(),clkTck:100,uptime:{}}]})).status,'unsupported');
});

test('a tasks case without the fixture shim is incomplete',()=>{
  const tasks={add:{agent:'codex/mock-model@low',warnings:[]},done:{model:'mock-model',warnings:[]}};
  const d=item('item-5');
  assert.equal(cases.judgeItem(d,itemObs({tasks})).status,'passed');
  for(const shim of [{dir:SHIM,relay:`${SHIM}/relay`,tasks:'/usr/bin/tasks'},{dir:SHIM,relay:'/usr/bin/relay',tasks:`${SHIM}/tasks`},null])
    assert.equal(cases.judgeItem(d,itemObs({tasks,shim})).status,'incomplete',JSON.stringify(shim));
  assert.equal(cases.judgeItem(d,itemObs({tasks:{...tasks,add:{agent:'codex',warnings:['model unverified: earlier-turn']}}})).status,'failed');
});

test('item 3 without a worker is unsupported and a parent model fails',()=>{
  const d=item('item-3');
  assert.equal(cases.judgeItem(d,itemObs({answers:{call:verifiedAnswer('mock-model')},undrivable:[{step:'worker',undrivable:'no-worker'}]})).status,'unsupported');
  assert.equal(cases.judgeItem(d,itemObs({answers:{worker:verifiedAnswer(cases.WORKER_MODEL,'t-worker')}})).status,'passed');
  assert.equal(cases.judgeItem(d,itemObs({answers:{worker:verifiedAnswer('mock-model','t-worker')}})).status,'failed');
  assert.equal(cases.judgeItem(d,itemObs({answers:{worker:verifiedAnswer(cases.WORKER_MODEL,'t-parent')},parentThread:'t-parent'})).status,'failed');
});

test('items 2 and 6 verify the switched and inner models; item 8 is recorded',()=>{
  assert.equal(cases.judgeItem(item('item-2'),itemObs({answers:{late:verifiedAnswer('model-b')}})).status,'passed');
  assert.equal(cases.judgeItem(item('item-2'),itemObs({answers:{late:verifiedAnswer('mock-model')}})).status,'failed');
  const inner=itemObs({answers:{inner:verifiedAnswer('inner-model','t-inner')},parentThread:'t-parent',contexts:[{at:turnAt,model:'mock-model',fileSystem:null}]});
  assert.equal(cases.judgeItem(item('item-6'),inner).status,'passed');
  assert.equal(cases.judgeItem(item('item-6'),{...inner,answers:{inner:verifiedAnswer('inner-model','t-parent')}}).status,'failed');
  const escape=cases.judgeItem(item('item-8'),itemObs({answers:{escape:unverifiedAnswer('earlier-turn','codex')}}));
  assert.deepEqual([escape.status,escape.recorded.reason],['passed','earlier-turn']);
  assert.equal(cases.judgeItem(item('item-8'),itemObs()).status,'incomplete');
});

test('a code-mode worker gets its shell step through the custom exec tool',async t=>{
  const dir=await root(t),script=probe.createLaneScript({lanes:{worker1:'worker-command'},dir,final:'worker1',delayMs:0});
  const {startScriptedProvider}=await import('../tools/codex-question/provider.mjs');
  const p=await startScriptedProvider({script});t.after(()=>p.close());
  const user=text=>({type:'message',role:'user',content:[{type:'input_text',text}]});
  const tools={type:'additional_tools',tools:[{type:'namespace',name:'functions',tools:[{type:'custom',name:'exec'}]}]};
  async function send(body){const r=await fetch(p.baseUrl+'/responses',{method:'POST',body:JSON.stringify(body)});assert.equal(r.status,200);return r.text();}
  const call=await send({tools:[],input:[tools,user('Run worker probe step 1.')]});
  assert.match(call,/"type":"custom_tool_call"/);assert.match(call,/await tools\.exec_command\(/);assert.match(call,/worker-command/);
  await send({tools:[],input:[tools,user('Run worker probe step 1.'),{type:'custom_tool_call_output',call_id:'probe-call-worker1',output:'Script completed'}]});
  assert.equal(await readFile(join(dir,'turn-done'),'utf8'),'done');
  assert.deepEqual(p.requests[0].additionalTools,[{name:'exec',type:'custom',namespace:'functions'}]);
});
