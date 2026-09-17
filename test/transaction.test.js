import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeEvent } from '../src/adapters/index.js';
import { applyEvent,reapRegistry,readSnapshot,listAgents } from '../src/bus/transaction.js';
import { createProcessOps } from '../src/bus/proc.js';
import { paths } from '../src/bus/paths.js';
import { withLock } from '../src/bus/lock.js';
import { tempState,localObservation } from './helpers/fixture.js';
const event=(h='codex',native='SessionStart',session='test')=>normalizeEvent(h,native,JSON.stringify({session_id:session,cwd:'/repo',tool_name:'Bash',tool_input:{command:'echo PRIVATE_MARKER'}}));
test('registry stores identity/state, never the command payload',async t=>{
  const p=await tempState(t),e=event('claude-code','PreToolUse');const result=await applyEvent(e,localObservation(p));
  assert.equal(result.snapshot.agents[e.agentId].state,'working');const before=await fs.readFile(p.agentsPath,'utf8');assert.equal(before.includes('PRIVATE_MARKER'),false);
  const reaped=await reapRegistry({paths:p});assert.equal(reaped.changed,false);assert.equal(await fs.readFile(p.agentsPath,'utf8'),before);
});
test('every observed upsert increments; exact removal no-op and generation recreation',async t=>{
  const p=await tempState(t),opts={...localObservation(p),now:()=>123};
  const first=await applyEvent(event(),opts);assert.equal(first.snapshot.revision,1);assert.equal(first.snapshot.agents['codex:test'].updatedAt,123);
  const second=await applyEvent(event(),opts);assert.equal(second.snapshot.revision,2);assert.equal(second.snapshot.generation,first.snapshot.generation);
  await applyEvent(event('claude-code'),opts);
  const removed=await applyEvent(event('codex','SessionEnd'),{paths:p,gitContext:()=>assert.fail(),resolveAgentPid:()=>assert.fail()});
  assert.deepEqual(Object.keys(removed.snapshot.agents),['claude-code:test']);assert.equal(removed.snapshot.revision,4);
  const bytes=await fs.readFile(p.agentsPath,'utf8');const no=await applyEvent(event('codex','SessionEnd'),opts);assert.equal(no.changed,false);assert.equal(await fs.readFile(p.agentsPath,'utf8'),bytes);
  await fs.unlink(p.agentsPath);const recreated=await applyEvent(event(),opts);assert.equal(recreated.snapshot.revision,1);assert.notEqual(recreated.snapshot.generation,first.snapshot.generation);
});
test('missing listing is readonly and removal/reap never fabricate snapshots',async t=>{
  const base=await tempState(t),p=paths({RELAY_STATE_DIR:join(base.stateDir,'absent')});
  assert.deepEqual(await listAgents({paths:p}),{snapshot:null,liveness:{}});assert.deepEqual(await fs.readdir(base.stateDir),[]);
  for(const result of [await reapRegistry({paths:p}),await applyEvent(event('codex','SessionEnd'),{paths:p})]){assert.equal(result.snapshot,null);assert.equal(result.changed,false);}
  assert.deepEqual(await fs.readdir(p.stateDir),[]);
});
test('corrupt unknown invalid and null state are never overwritten',async t=>{
  const p=await tempState(t);
  for(const text of ['{ broken','{"schema":2}','null','[]','{}']) {
    await fs.writeFile(p.agentsPath,text,{mode:0o600});
    await assert.rejects(applyEvent(event(),localObservation(p)));
    assert.equal(await fs.readFile(p.agentsPath,'utf8'),text);
  }
});
test('unknown optional fields strip on publication; revision overflow aborts',async t=>{
  const p=await tempState(t);let result=await applyEvent(event(),localObservation(p));
  const altered={...result.snapshot,private:'MARKER'};altered.agents['codex:test'].private='MARKER';altered.agents['codex:test'].process.private='MARKER';
  await fs.writeFile(p.agentsPath,JSON.stringify(altered));assert.equal(JSON.stringify(await readSnapshot({paths:p})).includes('MARKER'),false);
  result=await applyEvent(event(),localObservation(p));assert.equal(JSON.stringify(result).includes('MARKER'),false);
  result.snapshot.revision=Number.MAX_SAFE_INTEGER;await fs.writeFile(p.agentsPath,JSON.stringify(result.snapshot));
  await assert.rejects(applyEvent(event(),localObservation(p)),{code:'INVALID_SCHEMA'});assert.equal((await readSnapshot({paths:p})).revision,Number.MAX_SAFE_INTEGER);
});
test('headless or unavailable agent proof is admitted; resumed session refreshes proof',async t=>{
  const p=await tempState(t);
  for(const resolver of [()=>null,()=>{throw Object.assign(new Error('denied'),{code:'PROCESS_UNREADABLE'});},()=>{throw Object.assign(new Error('failed'),{code:'PROCESS_UNAVAILABLE'});}]) {
    const r=await applyEvent(event(),{...localObservation(p),resolveAgentPid:resolver});assert.equal(r.snapshot.agents['codex:test'].process,null);assert.ok(r.diagnostics.some(d=>d.code==='PROCESS_UNAVAILABLE'));
  }
  const r=await applyEvent(event(),localObservation(p));assert.equal(r.snapshot.agents['codex:test'].process.pid,process.pid);
  const ops=createProcessOps(), real=ops.handleOf(process.pid);
  const injected={...ops,handleOf:pid=>pid===42?{...real,pid:42,bootId:null}:ops.handleOf(pid)};
  if(real.platform==='linux'){const result=await applyEvent(event(),{...localObservation(p),resolveAgentPid:()=>42,processOps:injected});assert.equal(result.snapshot.agents['codex:test'].process.bootId,null);}
});
test('Git and unexpected process errors abort before lock or state creation',async t=>{
  const p=await tempState(t);
  await assert.rejects(applyEvent(event(),{...localObservation(p),gitContext:()=>{throw Object.assign(new Error('git failed'),{code:'GIT_ERROR'});}}),{code:'GIT_ERROR'});
  await assert.rejects(applyEvent(event(),{...localObservation(p),resolveAgentPid:()=>{throw new Error('unexpected');}}),/unexpected/);
  await assert.rejects(applyEvent({...event(),kind:'turn-end'},localObservation(p)),{code:'INVALID_SCHEMA'});
  assert.deepEqual(await fs.readdir(p.stateDir),[]);
});
test('read/list never prune and explicit reap removes only confirmed dead',async t=>{
  const p=await tempState(t),opts=localObservation(p);
  await applyEvent(event('codex','SessionStart','live'),opts);await applyEvent(event('codex','SessionStart','unknown'),{...opts,resolveAgentPid:()=>null});
  const r=await applyEvent(event('codex','SessionStart','dead'),opts);r.snapshot.agents['codex:dead'].process.start=String(BigInt(r.snapshot.agents['codex:dead'].process.start)+1n);
  await fs.writeFile(p.agentsPath,JSON.stringify(r.snapshot));const bytes=await fs.readFile(p.agentsPath,'utf8');
  const listed=await listAgents({paths:p});assert.deepEqual(Object.values(listed.liveness).map(v=>v.status),['alive','unknown','dead']);assert.equal(await fs.readFile(p.agentsPath,'utf8'),bytes);
  const reaped=await reapRegistry({paths:p});assert.deepEqual(reaped.reaped,['codex:dead']);assert.equal(reaped.snapshot.revision,4);assert.ok(reaped.diagnostics.some(d=>d.agentId==='codex:unknown'));
});
test('OpenCode reduction sees latest state after contention',async t=>{
  const p=await tempState(t),opts=localObservation(p);await applyEvent(event('opencode','init'),opts);
  let entered,release;const ready=new Promise(r=>{entered=r;});const held=new Promise(r=>{release=r;});
  const holder=withLock(p.lockPath,async()=>{entered();await held;const s=await readSnapshot({paths:p});s.agents['opencode:test'].state='error';await fs.writeFile(p.agentsPath,JSON.stringify(s));});
  await ready;const pending=applyEvent(event('opencode','session.idle'),opts);release();await holder;
  assert.equal((await pending).snapshot.agents['opencode:test'].state,'error');
  await applyEvent(event('opencode','session.busy'),opts);assert.equal((await applyEvent(event('opencode','session.idle'),opts)).snapshot.agents['opencode:test'].state,'done');
});
test('committed snapshot remains honestly visible after cleanup failure',async t=>{
  const p=await tempState(t),result=await applyEvent(event(),{...localObservation(p),io:{...fs,unlink:async path=>{
    if(path===p.lockPath)throw Object.assign(new Error('denied'),{code:'EACCES'});await fs.unlink(path);
  }}});
  assert.equal(result.changed,true);assert.equal(result.snapshot.revision,1);assert.deepEqual(await readSnapshot({paths:p}),result.snapshot);
  assert.ok(result.diagnostics.some(d=>d.code==='LOCK_CLEANUP_FAILED'&&d.message.includes('publication completed')));
});
