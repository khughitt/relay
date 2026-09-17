import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tempState,localObservation } from './helpers/fixture.js';
import { applyEvent } from '../src/bus/transaction.js';
import { normalizeEvent } from '../src/adapters/index.js';
const cli = new URL('../bin/relay.js',import.meta.url);
const run=(p,args)=>spawnSync(process.execPath,[cli.pathname,...args],{encoding:'utf8',env:{...process.env,RELAY_STATE_DIR:p.stateDir,XDG_CONFIG_HOME:join(p.stateDir,'config')}});
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
test('only help list-json and reap are available, other args fail',async t=>{
  const p=await tempState(t);assert.equal(run(p,['--help']).status,0);
  for(const args of [[],['list'],['list','--json','extra'],['reap','extra'],['--help','extra'],['unknown']]) {
    const r=run(p,args);assert.equal(r.status,1);assert.match(r.stderr||r.stdout,/USAGE/);
  }
  for(const cmd of ['hook','install']){const r=run(p,[cmd]);assert.equal(r.status,1);assert.match(r.stderr,/FEATURE_UNAVAILABLE/);}
});
import { main } from '../bin/relay.js';
test('post-publication cleanup failure exits nonzero and states publication completed',async()=>{
  let out='',err='';const code=await main(['reap'],{stdout:{write:s=>{out+=s;}},stderr:{write:s=>{err+=s;}},reap:async()=>({reaped:['codex:dead'],changed:true,diagnostics:[{code:'LOCK_CLEANUP_FAILED',message:'publication completed; lock cleanup failed'}]})});
  assert.equal(code,1);assert.equal(out,'Reaped 1 agent(s).\n');assert.match(err,/publication completed/);assert.equal(err.includes('rolled back'),false);
});
