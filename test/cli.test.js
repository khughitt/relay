import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tempState,localObservation } from './helpers/fixture.js';
import { applyEvent } from '../src/bus/transaction.js';
import { normalizeEvent } from '../src/adapters/index.js';
const cli = new URL('../bin/relay.js',import.meta.url);
const run=(p,args)=>spawnSync(process.execPath,[cli.pathname,...args],{encoding:'utf8',env:{...process.env,RELAY_STATE_DIR:p.stateDir,XDG_CONFIG_HOME:p.configHome??join(p.stateDir,'config')}});
test('absent snapshot CLI has exact JSON and creates no directory',async t=>{
  const base=await tempState(t),p={stateDir:join(base.stateDir,'absent')};const r=run(p,['list','--json']);
  assert.equal(r.status,0);assert.equal(r.stdout,'{"snapshot":null,"liveness":{}}\n');assert.equal(r.stderr,'');assert.deepEqual(await fs.readdir(base.stateDir),[]);
});
test('list errors are a single JSON envelope; unknown and null schemas are errors',async t=>{
  const p=await tempState(t);
  for(const [content,code] of [['{broken','CORRUPT_STATE'],['{"schema":2}','INVALID_SCHEMA'],['null','INVALID_SCHEMA']]) {
    await fs.writeFile(p.agentsPath,content,{mode:0o600});const r=run(p,['list','--json']);assert.equal(r.status,1);assert.equal(r.stderr,'');
    assert.equal(JSON.parse(r.stdout).error.code,code);assert.equal(r.stdout.trim().split('\n').length,1);
    if(code==='CORRUPT_STATE')assert.equal(r.stdout,'{"error":{"code":"CORRUPT_STATE","message":"cannot read registry JSON"}}\n');
  }
});
test('CLI listing retains dead unknown live, reap removes only dead',async t=>{
  const p=await tempState(t),opts=localObservation(p);
  const e=id=>normalizeEvent('codex','SessionStart',JSON.stringify({session_id:id,cwd:'/repo'}));
  await applyEvent(e('live'),opts);await applyEvent(e('unknown'),{...opts,resolveAgentPid:()=>null});const result=await applyEvent(e('dead'),opts);
  const h=result.snapshot.agents['codex:dead'].process;h.start=String(BigInt(h.start)+1n);await fs.writeFile(p.agentsPath,JSON.stringify(result.snapshot));
  const before=await fs.readFile(p.agentsPath,'utf8'),listed=run(p,['list','--json']);assert.equal(listed.status,0);
  assert.deepEqual(Object.values(JSON.parse(listed.stdout).liveness).map(v=>v.status),['alive','unknown','dead']);assert.equal(await fs.readFile(p.agentsPath,'utf8'),before);
  const reaped=run(p,['reap']);assert.equal(reaped.status,0);assert.equal(reaped.stdout,'Reaped 1 agent(s).\n');assert.match(reaped.stderr,/PROCESS_UNAVAILABLE/);
  const again=run(p,['reap']);assert.equal(again.stdout,'Reaped 0 agent(s).\n');
});
test('usage: help, list --json, reap [--outer-ms N], hook --harness NAME [--outer-ms N] EVENT', async t => {
  const p=await tempState(t);assert.equal(run(p,['--help']).status,0);assert.match(run(p,['--help']).stdout,/hook --harness NAME/);
  for(const args of [[],['list'],['list','--json','extra'],['reap','extra'],['reap','--outer-ms'],['reap','--outer-ms','abc'],['--help','extra'],['unknown'],
    ['hook'],['hook','PreToolUse'],['hook','--harness','claude-code'],['hook','--harness','claude-code','PreToolUse','extra'],['hook','--harness','claude-code','--outer-ms','abc','PreToolUse'],['hook','--harness','claude-code','--outer-ms','100','PreToolUse']]) {
    const r=run(p,args);assert.equal(r.status,1,args.join(' '));assert.match(r.stderr||r.stdout,/USAGE/,args.join(' '));
    if(!(args[0]==='list'&&args.includes('--json')))assert.equal(r.stdout,'',args.join(' ')); // list --json reports on stdout by design
  }
  const r=run(p,['install']);assert.equal(r.status,1);assert.match(r.stderr,/FEATURE_UNAVAILABLE/);
});
const fixture=new URL('./fixtures/subscriber.js',import.meta.url).pathname;
const hookRun=(p,args,input,opts={})=>spawnSync(process.execPath,[cli.pathname,'hook',...args],{encoding:'utf8',input,env:{...process.env,RELAY_STATE_DIR:p.stateDir,XDG_CONFIG_HOME:p.configHome},...opts});
async function configure(p,subscribers){const dir=join(p.configHome,'relay');await fs.mkdir(dir,{recursive:true,mode:0o700});await fs.writeFile(join(dir,'subscribers.json'),JSON.stringify({schema:1,subscribers}),{mode:0o600});}
// State and config live beside each other under the temp root; relay creates the 0700 state directory itself.
const layout=(base)=>({stateDir:join(base.stateDir,'state'),configHome:join(base.stateDir,'config')});
const body=JSON.stringify({session_id:'sess',cwd:process.cwd(),tool_name:'Bash',tool_input:{command:'ls'}});
test('hook denial through the real CLI is JSON on stdout, reason on stderr, exit 2',async t=>{
  const base=await tempState(t),p=layout(base);
  await configure(p,[{name:'g',role:'guard',kinds:['before-tool'],harnesses:['claude-code','codex'],argv:[process.execPath,fixture,'deny'],timeoutMs:2000}]);
  const r=hookRun(p,['--harness','codex','PreToolUse'],body);
  assert.equal(r.status,2);assert.equal(r.stdout,'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"denied by fixture"}}\n');assert.equal(r.stderr,'denied by fixture\n');
  const ok=hookRun(p,['--harness','codex','UserPromptSubmit'],JSON.stringify({session_id:'sess',cwd:process.cwd()}));assert.deepEqual([ok.status,ok.stdout,ok.stderr],[0,'','']);
  const reap=run(p,['reap']);assert.equal(reap.status,0);assert.equal(reap.stdout,'Reaped 0 agent(s).\n');
});
test('survival limitation: the internal deadline refuses; an outer kill, missing node or startup error cannot',async t=>{
  const base=await tempState(t),p=layout(base);
  await configure(p,[{name:'g',role:'guard',kinds:['before-tool'],harnesses:['claude-code'],argv:[process.execPath,fixture,'hang'],timeoutMs:300}]);
  const started=performance.now(),r=hookRun(p,['--harness','claude-code','--outer-ms','1500','PreToolUse'],body);
  assert.equal(r.status,2);assert.match(r.stdout,/relay refused: GUARD_FAILED: guard g timeout/);assert.ok(performance.now()-started<1500,'refused inside the outer timeout');
  // The harness's own timeout discards everything relay would have said: no refusal exists.
  const killed=hookRun(p,['--harness','claude-code','PreToolUse'],body,{timeout:200,killSignal:'SIGKILL'});
  assert.equal(killed.signal,'SIGKILL');assert.equal(killed.stdout,'');
  // A missing runtime fails before relay exists; the harness sees a spawn error, not a refusal.
  const missing=spawnSync('/nonexistent/node',[cli.pathname,'hook','--harness','claude-code','PreToolUse'],{encoding:'utf8',input:body});
  assert.equal(missing.error.code,'ENOENT');assert.ok(!missing.stdout);
  // A startup usage error exits 1 with no native refusal.
  const usage=hookRun(p,['--harness','claude-code','--outer-ms','x','PreToolUse'],body);assert.equal(usage.status,1);assert.equal(usage.stdout,'');
});
test('the CLI returns inside the outer timeout while another writer holds the lock',async t=>{
  const base=await tempState(t),p=layout(base);
  // Hold the registry lock from this process so publication waits until its bound.
  const {withLock}=await import('../src/bus/lock.js');const {paths}=await import('../src/bus/paths.js');
  const lockPath=paths({RELAY_STATE_DIR:p.stateDir}).lockPath;let release;const held=new Promise(r=>{release=r;});
  const holder=withLock(lockPath,async()=>{await held;},{deadline:performance.now()+20000});await new Promise(r=>setTimeout(r,100));
  const started=performance.now(),r=hookRun(p,['--harness','codex','--outer-ms','1000','PreToolUse'],body,{timeout:5000});
  release();await holder;
  assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/registry: (LOCK_TIMEOUT|DEADLINE_EXCEEDED)/);assert.ok(performance.now()-started<1000,'exited inside the outer timeout');
});
import { main } from '../bin/relay.js';
test('post-publication cleanup failure exits nonzero and states publication completed',async()=>{
  let out='',err='';const code=await main(['reap'],{stdout:{write:(s,cb)=>{out+=s;cb?.();}},stderr:{write:(s,cb)=>{err+=s;cb?.();}},reap:async()=>({result:{reaped:['codex:dead'],changed:true,diagnostics:[{code:'LOCK_CLEANUP_FAILED',message:'publication completed; lock cleanup failed'}]},diagnostics:[]})});
  assert.equal(code,1);assert.equal(out,'Reaped 1 agent(s).\n');assert.match(err,/publication completed/);assert.equal(err.includes('rolled back'),false);
});
