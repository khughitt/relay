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

test('one failed safety case cannot qualify the route',()=>{
  assert.equal(typeof cases.judgeCase,'function');
  const observation={mode:'interactive-tui',complete:true,hookSeen:true,denialSeen:true,sentinel:true,cleanup:{survivors:[]}};
  const result=cases.judgeCase({gate:'deny'},{original:observation,rewritten:observation});
  assert.equal(result.status,'failed');assert.match(result.reason,/denied-command-ran/);
});

test('server, partial and unobserved refusals cannot qualify a TUI case',()=>{
  assert.equal(typeof cases.judgeCase,'function');
  const good={mode:'interactive-tui',complete:true,hookSeen:true,denialSeen:true,sentinel:false,cleanup:{survivors:[]}};
  assert.equal(cases.judgeCase({gate:'deny'},{original:good,rewritten:good}).status,'passed');
  for(const patch of [{mode:'app-server'},{complete:false},{hookSeen:false},{denialSeen:false},{cleanup:{survivors:[123]}}]){
    assert.notEqual(cases.judgeCase({gate:'deny'},{original:good,rewritten:{...good,...patch}}).status,'passed');
  }
});

test('policy pairs preserve refusals, permits, prompts and resource boundaries',()=>{
  assert.equal(typeof cases.judgeCase,'function');
  const good={mode:'interactive-tui',complete:true,hookSeen:true,decision:'permit',prompts:0,sentinel:true,boundary:'sandboxed',cleanup:{survivors:[]}};
  assert.equal(cases.judgeCase({gate:'policy'},{original:good,rewritten:good}).status,'passed');
  for(const patch of [{decision:'refuse'},{prompts:1},{boundary:'unsandboxed'},{sentinel:false}]){
    assert.equal(cases.judgeCase({gate:'policy'},{original:good,rewritten:{...good,...patch}}).status,'failed');
  }
});

test('only the loopback unauthenticated provider is admitted',()=>{
  assert.equal(typeof probe.assertPrivateProvider,'function');
  assert.doesNotThrow(()=>probe.assertPrivateProvider({baseUrl:'http://127.0.0.1:1234/v1',requiresAuth:false}));
  for(const p of [{baseUrl:'https://api.openai.com/v1',requiresAuth:false},{baseUrl:'http://127.0.0.1:1234/v1',requiresAuth:true},{baseUrl:'http://user:pw@127.0.0.1:1/v1',requiresAuth:false}])assert.throws(()=>probe.assertPrivateProvider(p));
});

test('TUI housekeeping requests do not consume or repeat the fixed shell case',async t=>{
  assert.equal(typeof probe.createProbeScript,'function');
  const dir=await root(t),script=probe.createProbeScript({command:'fixture-command',dir});
  const {startScriptedProvider}=await import('../tools/codex-question/provider.mjs');
  const p=await startScriptedProvider({script});t.after(()=>p.close());
  async function send(body){const r=await fetch(p.baseUrl+'/responses',{method:'POST',body:JSON.stringify(body)});assert.equal(r.status,200);return r.text();}
  await send({tools:[],input:[]});
  const call=await send({tools:[{type:'function',name:'exec_command'}],input:[]});assert.match(call,/fixture-command/);
  await send({tools:[{type:'function',name:'exec_command'}],input:[{type:'function_call_output',call_id:'probe-call',output:'fixture result'}]});
  const extra=await send({tools:[],input:[]});assert.doesNotMatch(extra,/function_call/);
  assert.equal((await readFile(join(dir,'turn-done'),'utf8')),'done');
});

test('resume refuses any changed evidence identity and never erases a failed attempt',async t=>{
  assert.equal(typeof probe.receiptSelection,'function');
  const dir=await root(t),identity={binary:'a',mode:'interactive-tui',policy:'b',rules:'c',relay:'d'};
  await writeFile(join(dir,'receipt.json'),JSON.stringify({identity,id:'one',status:'failed'}));
  assert.deepEqual(probe.receiptSelection([{identity,id:'one',status:'passed'}],identity,['one','two']),['two']);
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
