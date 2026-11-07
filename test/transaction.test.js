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
import { agyStore, encodeTrajectoryMetadata } from './helpers/agy-store.js';
import { DatabaseSync } from 'node:sqlite';
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
  const removed=await applyEvent(event('codex','SessionEnd'),{paths:p,gitContext:()=>assert.fail(),resolveSessionPid:()=>assert.fail()});
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
  for(const text of ['{ broken','{"schema":3}','null','[]','{}']) {
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
    const r=await applyEvent(event(),{...localObservation(p),resolveSessionPid:resolver});assert.equal(r.snapshot.agents['codex:test'].process,null);assert.ok(r.diagnostics.some(d=>d.code==='PROCESS_UNAVAILABLE'));
  }
  const r=await applyEvent(event(),localObservation(p));assert.equal(r.snapshot.agents['codex:test'].process.pid,process.pid);
  const ops=createProcessOps(), real=ops.handleOf(process.pid);
  const injected={...ops,handleOf:pid=>pid===42?{...real,pid:42,bootId:null}:ops.handleOf(pid)};
  if(real.platform==='linux'){const result=await applyEvent(event(),{...localObservation(p),resolveSessionPid:()=>42,processOps:injected});assert.equal(result.snapshot.agents['codex:test'].process.bootId,null);}
});
test('Git and unexpected process errors abort before lock or state creation',async t=>{
  const p=await tempState(t);
  await assert.rejects(applyEvent(event(),{...localObservation(p),gitContext:()=>{throw Object.assign(new Error('git failed'),{code:'GIT_ERROR'});}}),{code:'GIT_ERROR'});
  await assert.rejects(applyEvent(event(),{...localObservation(p),resolveSessionPid:()=>{throw new Error('unexpected');}}),/unexpected/);
  await assert.rejects(applyEvent({...event(),kind:'turn-end'},localObservation(p)),{code:'INVALID_SCHEMA'});
  assert.deepEqual(await fs.readdir(p.stateDir),[]);
});
test('read/list never prune and explicit reap removes only confirmed dead',async t=>{
  const p=await tempState(t),opts=localObservation(p);
  await applyEvent(event('codex','SessionStart','live'),opts);await applyEvent(event('codex','SessionStart','unknown'),{...opts,resolveSessionPid:()=>null});
  const r=await applyEvent(event('codex','SessionStart','dead'),{...opts,resolveSessionPid:()=>process.ppid});r.snapshot.agents['codex:dead'].process.start=String(BigInt(r.snapshot.agents['codex:dead'].process.start)+1n);
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
const v1=(agents)=>JSON.stringify({schema:1,generation:'12345678-1234-4234-8234-123456789abc',revision:7,agents});
const row=(id,pid)=>({id,harness:'claude-code',sessionId:id.slice('claude-code:'.length),scope:'session',
  process:{platform:'linux',host:'h',bootId:null,pid,start:'1'},cwd:'/repo',repoRoot:null,remote:null,projectKey:'/repo',project:'repo',state:'idle',updatedAt:0});
test('a schema-1 registry is refused by reads and left untouched',async t=>{
  const p=await tempState(t),text=v1({'claude-code:outer':row('claude-code:outer',42)});await fs.writeFile(p.agentsPath,text,{mode:0o600});
  for(const read of [()=>readSnapshot({paths:p}),()=>listAgents({paths:p})])await assert.rejects(read(),{code:'REGISTRY_SUPERSEDED'});
  assert.equal(await fs.readFile(p.agentsPath,'utf8'),text);
});
test('reap supersedes a contaminated schema-1 registry: empty, fresh generation, every id reported',async t=>{
  const p=await tempState(t);
  await fs.writeFile(p.agentsPath,v1({'claude-code:outer':row('claude-code:outer',42),'claude-code:nested':row('claude-code:nested',42)}),{mode:0o600});
  const r=await reapRegistry({paths:p});
  assert.equal(r.changed,true);assert.equal(r.snapshot.schema,2);assert.equal(r.snapshot.revision,1);
  assert.notEqual(r.snapshot.generation,'12345678-1234-4234-8234-123456789abc');assert.deepEqual(r.snapshot.agents,{});
  assert.deepEqual(r.diagnostics.filter(d=>d.code==='REGISTRY_SUPERSEDED').map(d=>d.agentId).sort(),['claude-code:nested','claude-code:outer']);
  assert.deepEqual(await readSnapshot({paths:p}),r.snapshot);
});
test('an event supersedes a schema-1 registry and publishes only itself',async t=>{
  const p=await tempState(t);await fs.writeFile(p.agentsPath,v1({'claude-code:nested':row('claude-code:nested',42)}),{mode:0o600});
  const r=await applyEvent(event(),localObservation(p));
  assert.deepEqual(Object.keys(r.snapshot.agents),['codex:test']);assert.equal(r.snapshot.schema,2);
  assert.ok(r.diagnostics.some(d=>d.code==='REGISTRY_SUPERSEDED'&&d.agentId==='claude-code:nested'));
});
test('a SessionEnd supersedes a schema-1 registry even though it removes nothing',async t=>{
  const p=await tempState(t);await fs.writeFile(p.agentsPath,v1({'claude-code:nested':row('claude-code:nested',42)}),{mode:0o600});
  const r=await applyEvent(event('codex','SessionEnd'),{paths:p});
  assert.equal(r.changed,true);assert.deepEqual(r.snapshot.agents,{});assert.equal((await readSnapshot({paths:p})).schema,2);
});
test('a schema-1 file with no usable agents object is still superseded',async t=>{
  const p=await tempState(t);
  for(const text of ['{"schema":1}','{"schema":1,"agents":[]}','{"schema":1,"agents":null}']){
    await fs.writeFile(p.agentsPath,text,{mode:0o600});const r=await reapRegistry({paths:p});
    assert.deepEqual(r.diagnostics.filter(d=>d.code==='REGISTRY_SUPERSEDED'),[{code:'REGISTRY_SUPERSEDED',message:'replaced a schema-1 registry with no agents'}]);
    assert.equal((await readSnapshot({paths:p})).schema,2);
  }
});
const chainOps=(chains)=>({
  ancestors:(pid)=>chains[pid],
  executableOf:(pid)=>{throw new Error(`exe of ${pid} must not be read`);},
  argvOf:()=>['claude'],
  handleOf:(pid)=>({platform:'linux',host:'h',bootId:'12345678-1234-1234-8234-123456789abc',pid,start:String(pid)}),
  probe:()=>({status:'alive',reason:'test'}),
  recordOf:()=>null});
const observe=(p,ops)=>({paths:p,processOps:ops,gitContext:async()=>({remote:null,repoRoot:null})});
const claudeEvent=(session)=>normalizeEvent('claude-code','SessionStart',JSON.stringify({session_id:session,cwd:'/repo'}));
// outer: hook 101 under claude 100 (tty). nested: hook 201 under claude 200 (no tty) under claude 100.
const nested={101:[{pid:101,comm:'node',tty:null},{pid:100,comm:'claude',tty:true}],
  201:[{pid:201,comm:'node',tty:null},{pid:200,comm:'claude',tty:null},{pid:150,comm:'zsh',tty:null},{pid:100,comm:'claude',tty:true}]};
test('a nested headless session publishes its own process, beside its parent',async t=>{
  const p=await tempState(t),ops=chainOps(nested);
  await applyEvent(claudeEvent('outer'),{...observe(p,ops),resolveSessionPid:(a)=>a.resolveSessionPid({startPid:101,ancestors:ops.ancestors,executableOf:ops.executableOf,argvOf:ops.argvOf})});
  const r=await applyEvent(claudeEvent('nested'),{...observe(p,ops),resolveSessionPid:(a)=>a.resolveSessionPid({startPid:201,ancestors:ops.ancestors,executableOf:ops.executableOf,argvOf:ops.argvOf})});
  assert.equal(r.snapshot.agents['claude-code:outer'].process.pid,100);
  assert.equal(r.snapshot.agents['claude-code:nested'].process.pid,200);
});
test('a contaminated schema-1 registry recovers: reap, then the outer event, leaves one correct row',async t=>{
  const p=await tempState(t),ops=chainOps(nested),borrowed={platform:'linux',host:'h',bootId:null,pid:100,start:'100'};
  const agent=(session)=>({id:`claude-code:${session}`,harness:'claude-code',sessionId:session,scope:'session',process:borrowed,
    cwd:'/repo',repoRoot:null,remote:null,projectKey:'/repo',project:'repo',state:'idle',updatedAt:0});
  const contaminated=JSON.stringify({schema:1,generation:'12345678-1234-4234-8234-123456789abc',revision:9,
    agents:{'claude-code:outer':agent('outer'),'claude-code:nested':agent('nested')}});
  for(const first of ['reap','event']){
    await fs.writeFile(p.agentsPath,contaminated,{mode:0o600});
    if(first==='reap')await reapRegistry({paths:p,processOps:ops});
    const r=await applyEvent(claudeEvent('outer'),{...observe(p,ops),resolveSessionPid:(a)=>a.resolveSessionPid({startPid:101,ancestors:ops.ancestors,executableOf:ops.executableOf,argvOf:ops.argvOf})});
    assert.deepEqual(Object.keys(r.snapshot.agents),['claude-code:outer'],first);
    assert.equal(r.snapshot.agents['claude-code:outer'].process.pid,100,first);
  }
});

const R = '0199f000-0000-7000-8000-000000000001', W1 = '0199f000-0000-7000-8000-000000000002', C = '0199f000-0000-7000-8000-0000000000c1';
const codex = (native, fields = {}) => normalizeEvent('codex', native, JSON.stringify({ session_id: R, cwd: '/repo', ...fields }));
const tool = { tool_name: 'Bash', tool_input: { command: 'true' } };
const worker = (native, fields = {}) => codex(native, { ...fields, agent_id: W1, agent_type: 'default' });
const seed = async (p, handleFor) => {
  const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/registry-workers.json', import.meta.url), 'utf8'));
  for (const agent of Object.values(fixture.agents)) agent.process = handleFor(agent);
  await fs.writeFile(p.agentsPath, JSON.stringify(fixture), { mode: 0o600 });
  return fixture;
};
test('a background worker never moves its root row', async t => {
  const p = await tempState(t), o = localObservation(p);
  for (const native of ['SessionStart', 'UserPromptSubmit', 'Stop']) await applyEvent(codex(native), o);
  const started = await applyEvent(worker('SubagentStart'), o);
  assert.equal(started.snapshot.agents[`codex:${W1}`].state, 'working');
  await applyEvent(worker('PreToolUse', tool), o);
  const { snapshot } = await applyEvent(worker('SubagentStop', { stop_hook_active: false }), o);
  const root = snapshot.agents[`codex:${R}`], row = snapshot.agents[`codex:${W1}`];
  assert.equal(root.state, 'done');
  assert.deepEqual([row.scope, row.root, row.sessionId, row.state], ['worker', `codex:${R}`, W1, 'done']);
  assert.deepEqual(row.process, root.process);
  assert.equal(Object.hasOwn(root, 'root'), false);
});
test('a later worker turn reopens its row without a start event', async t => {
  const p = await tempState(t), o = localObservation(p);
  await applyEvent(worker('SubagentStart'), o);
  await applyEvent(worker('SubagentStop', { stop_hook_active: false }), o);
  const { snapshot } = await applyEvent(worker('PreToolUse', tool), o);
  assert.equal(snapshot.agents[`codex:${W1}`].state, 'working');
});
test('a worker seen before its root still names it, and leaves with it', async t => {
  const p = await tempState(t), o = localObservation(p);
  const first = await applyEvent(worker('PreToolUse', tool), o);
  assert.deepEqual(Object.keys(first.snapshot.agents), [`codex:${W1}`]);
  assert.equal(first.snapshot.agents[`codex:${W1}`].root, `codex:${R}`);
  const ended = await applyEvent(codex('SessionEnd'), { paths: p });
  assert.deepEqual(ended.snapshot.agents, {});
});
test('a root SessionEnd removes the root and its workers, nested included, in one revision', async t => {
  const p = await tempState(t), live = createProcessOps().handleOf(process.pid);
  const fixture = await seed(p, () => live);
  const ended = await applyEvent(normalizeEvent('codex', 'SessionEnd', JSON.stringify({ session_id: R, cwd: '/home/user/project' })), { paths: p });
  assert.deepEqual(Object.keys(ended.snapshot.agents), [`claude-code:${C}`]);
  assert.equal(ended.snapshot.revision, fixture.revision + 1);
});
test('a root SessionEnd removes its workers when its own row is already gone', async t => {
  const p = await tempState(t), live = createProcessOps().handleOf(process.pid);
  const fixture = await seed(p, () => live);
  delete fixture.agents[`codex:${R}`];
  await fs.writeFile(p.agentsPath, JSON.stringify(fixture), { mode: 0o600 });
  const ended = await applyEvent(codex('SessionEnd'), { paths: p });
  assert.deepEqual(Object.keys(ended.snapshot.agents), [`claude-code:${C}`]);
});
test('a dead codex process takes its root and every worker with it', async t => {
  const p = await tempState(t), live = createProcessOps().handleOf(process.pid);
  const dead = { ...live, start: String(BigInt(live.start) + 1n) };
  await seed(p, agent => agent.harness === 'codex' ? dead : live);
  const reaped = await reapRegistry({ paths: p });
  assert.deepEqual(reaped.reaped.sort(), [`codex:${R}`, `codex:${W1}`, 'codex:0199f000-0000-7000-8000-000000000003']);
  assert.deepEqual(Object.keys(reaped.snapshot.agents), [`claude-code:${C}`]);
});

const R2 = '0199f000-0000-7000-8000-000000000004';
const W2 = '0199f000-0000-7000-8000-000000000005', W3 = '0199f000-0000-7000-8000-000000000006';
const proof = {platform:'linux',host:'h',bootId:'12345678-1234-1234-8234-123456789abc',pid:100,start:'1'};
const codexOptions = (p, handle = proof) => ({...observe(p,{...chainOps({}),handleOf:pid=>pid===100?handle:{...proof,pid}}),resolveSessionPid:()=>100});
const secondRoot = native => codex(native,{session_id:R2});

test('a proven new root retires the old root and done workers but retains unfinished workers', async t => {
  const p=await tempState(t), o=codexOptions(p);
  await applyEvent(codex('SessionStart'),o);
  await applyEvent(worker('SubagentStart'),o);
  await applyEvent(codex('SubagentStop',{agent_id:W2,stop_hook_active:false}),o);
  await applyEvent(codex('PermissionRequest',{agent_id:W3,...tool}),o);
  const before=(await applyEvent(claudeEvent(C),o)).snapshot;
  const after=(await applyEvent(secondRoot('SessionStart'),o)).snapshot;
  assert.equal(after.agents[`codex:${R}`],undefined);
  assert.equal(after.agents[`codex:${W2}`],undefined);
  for(const id of [`codex:${W1}`,`codex:${W3}`,`claude-code:${C}`]) assert.deepEqual(after.agents[id],before.agents[id]);
  assert.equal(after.agents[`codex:${R2}`].scope,'session');
  assert.equal(after.revision,before.revision+1);assert.equal(after.generation,before.generation);
});
test('a worker SubagentStart never retires a root or its done workers',async t=>{
  const p=await tempState(t),o=codexOptions(p);
  await applyEvent(codex('SessionStart'),o);
  const before=(await applyEvent(codex('SubagentStop',{agent_id:W2,stop_hook_active:false}),o)).snapshot;
  const after=(await applyEvent(worker('SubagentStart'),o)).snapshot;
  assert.deepEqual(after.agents[`codex:${R}`],before.agents[`codex:${R}`]);
  assert.deepEqual(after.agents[`codex:${W2}`],before.agents[`codex:${W2}`]);
  assert.equal(after.agents[`codex:${W1}`].state,'working');
});
test('a replaced worker leaves on Stop and returns on a later tool event',async t=>{
  const p=await tempState(t),o=codexOptions(p);
  await applyEvent(codex('SessionStart'),o);await applyEvent(worker('SubagentStart'),o);
  const before=(await applyEvent(secondRoot('SessionStart'),o)).snapshot;
  const stopped=await applyEvent(worker('SubagentStop',{stop_hook_active:false}),o);
  assert.equal(stopped.snapshot.agents[`codex:${W1}`],undefined);
  assert.equal(stopped.snapshot.revision,before.revision+1);
  const bytes=await fs.readFile(p.agentsPath,'utf8');
  assert.equal((await applyEvent(worker('SubagentStop',{stop_hook_active:false}),o)).changed,false);
  assert.equal(await fs.readFile(p.agentsPath,'utf8'),bytes);
  const resumed=(await applyEvent(worker('PreToolUse',tool),o)).snapshot;
  assert.equal(resumed.agents[`codex:${W1}`].root,`codex:${R}`);
  assert.equal(resumed.agents[`codex:${W1}`].state,'working');
  assert.deepEqual(resumed.agents[`codex:${R2}`],before.agents[`codex:${R2}`]);
  const ended=(await applyEvent(codex('SessionEnd'),o)).snapshot;
  assert.deepEqual(Object.keys(ended.agents),[`codex:${R2}`]);
});
test('a worker without replacement evidence keeps ordinary upserts',async t=>{
  const p=await tempState(t),o=codexOptions(p);
  await applyEvent(worker('PreToolUse',tool),o);
  assert.equal((await applyEvent(worker('SubagentStop',{stop_hook_active:false}),o)).snapshot.agents[`codex:${W1}`].state,'done');
  await applyEvent(secondRoot('SessionStart'),o);await applyEvent(secondRoot('SessionEnd'),o);
  const after=(await applyEvent(worker('SubagentStop',{stop_hook_active:false}),o)).snapshot;
  assert.equal(after.agents[`codex:${W1}`].state,'done');
});
test('a missing start or missing handle never suppresses the active root',async t=>{
  for(const missing of ['start','handle']) {
    const p=await tempState(t),o=codexOptions(p);await applyEvent(codex('SessionStart'),o);
    if(missing==='handle')await applyEvent(secondRoot('SessionStart'),{...o,resolveSessionPid:()=>null});
    for(const native of ['UserPromptSubmit','PreToolUse']) {
      const after=(await applyEvent(codex(native,{session_id:R2,...tool}),o)).snapshot;
      assert.ok(after.agents[`codex:${R}`]);
      assert.deepEqual(after.agents[`codex:${R2}`].process,proof);
      assert.equal(after.agents[`codex:${R2}`].state,'working');
    }
  }
});
test('prompt first and late old-root events remain visible',async t=>{
  const p=await tempState(t),o=codexOptions(p);await applyEvent(codex('SessionStart'),o);
  assert.equal((await applyEvent(secondRoot('UserPromptSubmit'),o)).snapshot.agents[`codex:${R2}`].state,'working');
  const started=(await applyEvent(secondRoot('SessionStart'),o)).snapshot;
  assert.equal(started.agents[`codex:${R}`],undefined);assert.equal(started.agents[`codex:${R2}`].state,'idle');
  const late=(await applyEvent(codex('Stop'),o)).snapshot;
  assert.equal(late.agents[`codex:${R}`].state,'done');assert.deepEqual(late.agents[`codex:${R2}`],started.agents[`codex:${R2}`]);
  assert.equal((await applyEvent(worker('SubagentStop',{stop_hook_active:false}),o)).snapshot.agents[`codex:${W1}`].state,'done');
});
test('duplicate start and switch back retain the correct workers',async t=>{
  const p=await tempState(t),o=codexOptions(p);await applyEvent(codex('SessionStart'),o);
  await applyEvent(worker('SubagentStart'),o);await applyEvent(secondRoot('SessionStart'),o);
  const started=(await applyEvent(codex('SubagentStop',{session_id:R2,agent_id:W2,stop_hook_active:false}),o)).snapshot;
  const repeated=(await applyEvent(secondRoot('SessionStart'),o)).snapshot;
  assert.deepEqual(repeated.agents[`codex:${W2}`],started.agents[`codex:${W2}`]);
  const back=(await applyEvent(codex('SessionStart'),o)).snapshot;
  assert.equal(back.agents[`codex:${R2}`],undefined);assert.equal(back.agents[`codex:${W2}`],undefined);
  assert.deepEqual(back.agents[`codex:${W1}`],started.agents[`codex:${W1}`]);
});
test('replacement needs full process proof',async t=>{
  const cases=[
    [proof,proof,true],[{...proof,platform:'darwin',bootId:null},{...proof,platform:'darwin',bootId:null},true],
    [proof,{...proof,platform:'darwin',bootId:null},false],[proof,{...proof,host:'other'},false],
    [proof,{...proof,bootId:'22345678-1234-1234-8234-123456789abc'},false],
    [proof,{...proof,pid:101},false],[proof,{...proof,start:'2'},false],
    [{...proof,bootId:null},{...proof,bootId:null},false],[proof,null,false],[null,proof,false],
    [{...proof,bootId:null},proof,false],[proof,{...proof,bootId:null},false]
  ];
  for(const [oldHandle,newHandle,replaces]of cases){
    const p=await tempState(t);await applyEvent(codex('SessionStart'),codexOptions(p,oldHandle));
    const after=(await applyEvent(secondRoot('SessionStart'),codexOptions(p,newHandle))).snapshot;
    assert.equal(Object.hasOwn(after.agents,`codex:${R}`),!replaces,JSON.stringify([oldHandle,newHandle]));
  }
});
test('replacement uses the latest locked snapshot',async t=>{
  const p=await tempState(t),o=codexOptions(p);await applyEvent(codex('SessionStart'),o);
  let enter,release;const entered=new Promise(r=>{enter=r;}),held=new Promise(r=>{release=r;});
  const holder=withLock(p.lockPath,async()=>{enter();await held;const s=await readSnapshot({paths:p});
    s.agents[`codex:${W2}`]={...s.agents[`codex:${R}`],id:`codex:${W2}`,sessionId:W2,scope:'worker',root:`codex:${R}`,state:'done'};
    s.revision=8;await fs.writeFile(p.agentsPath,JSON.stringify(s));});
  await entered;const pending=applyEvent(secondRoot('SessionStart'),o);release();await holder;
  const after=(await pending).snapshot;assert.deepEqual(Object.keys(after.agents),[`codex:${R2}`]);assert.equal(after.revision,9);
});

const S = '0199f000-0000-7000-8000-000000000090';
const claude = (native, fields = {}) => normalizeEvent('claude-code', native, JSON.stringify({ session_id: S, cwd: '/repo', ...fields }));
const shell = { id: 'b1', type: 'shell', status: 'running', description: 'd' };
const agent = { ...shell, id: 'a1', type: 'subagent' };
const bg = (list) => ({ background_tasks: list });
const claudeRow = (result) => result.snapshot.agents['claude-code:' + S];
test('a shell left running turns the idle prompt into idle', async t => {
  const opts = localObservation(await tempState(t));
  await applyEvent(claude('Stop', bg([shell])), opts);
  const row = claudeRow(await applyEvent(claude('Notification:idle_prompt'), opts));
  assert.equal(row.state, 'idle');
  assert.deepEqual(row.background, { agents: 0, other: 1 });
});
test('the idle prompt after the work finished is needs-input again', async t => {
  const opts = localObservation(await tempState(t));
  await applyEvent(claude('Stop', bg([shell])), opts);
  await applyEvent(claude('Stop', bg([{ ...shell, status: 'completed' }])), opts);
  const row = claudeRow(await applyEvent(claude('Notification:idle_prompt'), opts));
  assert.equal(row.state, 'needs-input');
  assert.deepEqual(row.background, { agents: 0, other: 0 });
});
test('an event that does not report carries the counts forward', async t => {
  const opts = localObservation(await tempState(t));
  await applyEvent(claude('Stop', bg([shell])), opts);
  const row = claudeRow(await applyEvent(claude('PreToolUse', { tool_name: 'Bash', tool_input: {} }), opts));
  assert.deepEqual(row.background, { agents: 0, other: 1 });
  assert.deepEqual((await readSnapshot(opts)).agents['claude-code:' + S].background, { agents: 0, other: 1 });
});
test('a Stop handing work to an agent stays working', async t => {
  const opts = localObservation(await tempState(t));
  assert.equal(claudeRow(await applyEvent(claude('Stop', bg([agent])), opts)).state, 'working');
});
test('agent and shell, then shell only, then the idle prompt', async t => {
  const opts = localObservation(await tempState(t));
  assert.equal(claudeRow(await applyEvent(claude('Stop', bg([agent, shell])), opts)).state, 'working');
  assert.equal(claudeRow(await applyEvent(claude('Stop', bg([shell])), opts)).state, 'done');
  assert.equal(claudeRow(await applyEvent(claude('Notification:idle_prompt'), opts)).state, 'idle');
});
test('an agent-only Stop then the idle prompt is needs-input', async t => {
  const opts = localObservation(await tempState(t));
  await applyEvent(claude('Stop', bg([agent])), opts);
  assert.equal(claudeRow(await applyEvent(claude('Notification:idle_prompt'), opts)).state, 'needs-input');
});
test('an unreadable report clears the counts', async t => {
  const opts = localObservation(await tempState(t));
  await applyEvent(claude('Stop', bg([shell])), opts);
  await applyEvent(claude('Stop', bg('x')), opts);
  const row = claudeRow(await applyEvent(claude('Notification:idle_prompt'), opts));
  assert.equal(row.state, 'needs-input');
  assert.equal(Object.hasOwn(row, 'background'), false);
  await applyEvent(claude('Stop', bg([agent])), opts);
  const cleared = claudeRow(await applyEvent(claude('Stop', bg('x')), opts));
  assert.equal(cleared.state, 'done');
  assert.equal(Object.hasOwn(cleared, 'background'), false);
});
test('failure and approval prompts ignore the counts and keep them', async t => {
  const opts = localObservation(await tempState(t));
  await applyEvent(claude('Stop', bg([agent, shell])), opts);
  const failed = claudeRow(await applyEvent(claude('StopFailure'), opts));
  assert.equal(failed.state, 'error');
  assert.deepEqual(failed.background, { agents: 1, other: 1 });
  const approval = claudeRow(await applyEvent(claude('Notification:permission_prompt'), opts));
  assert.equal(approval.state, 'needs-approval');
  assert.deepEqual(approval.background, { agents: 1, other: 1 });
});
test('a session row without a report has no background', async t => {
  const opts = localObservation(await tempState(t));
  assert.equal(Object.hasOwn(claudeRow(await applyEvent(claude('SessionStart'), opts)), 'background'), false);
});
test('agy PreToolUse publishes a session-scoped working row and Stop sets done',async t=>{
  const p=await tempState(t),fx=n=>fs.readFile(new URL(`./fixtures/agy/${n}.json`,import.meta.url),'utf8');
  const e=normalizeEvent('agy','PreToolUse',await fx('PreToolUse'));
  const r=await applyEvent(e,localObservation(p));const row=r.snapshot.agents[e.agentId];
  assert.ok(e.agentId.startsWith('agy:'));assert.equal(row.scope,'session');assert.equal(row.state,'working');
  assert.equal('root' in row,false);assert.equal('background' in row,false);
  const s=await applyEvent(normalizeEvent('agy','Stop',await fx('Stop')),localObservation(p));
  assert.equal(s.snapshot.agents[e.agentId].state,'done');
});

const AR1 = '0199f000-0000-7000-8000-000000000101';
const AR2 = '0199f000-0000-7000-8000-000000000102';
const AS1 = '0199f000-0000-7000-8000-000000000201';
const AS2 = '0199f000-0000-7000-8000-000000000202';
const agyEv = (native, conversationId = AR1) => normalizeEvent('agy', native, JSON.stringify({
  conversationId,
  workspacePaths: ['/repo'],
  ...(native === 'PreToolUse' ? { toolCall: { name: 'run_command', args: { CommandLine: 'true' } } } : {}),
  ...(native === 'Stop' ? { executionNum: 0, fullyIdle: false } : {}),
}));
const writeAgyMeta = (appData, conversationId, rootConversationId = conversationId, parentConversationId = undefined) => {
  const dbPath = join(appData, 'conversations', `${conversationId}.db`);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('pragma journal_mode = WAL; create table if not exists trajectory_metadata_blob (id text DEFAULT "main", data blob)');
    db.prepare('insert or replace into trajectory_metadata_blob (id, data) values (?, ?)').run(
      'main',
      encodeTrajectoryMetadata({ rootConversationId, parentConversationId }),
    );
  } finally {
    db.close();
  }
};

test('agy uncontended turns and active-peer PreToolUse never import sqlite', async t => {
  const p = await tempState(t);
  const noSqlite = () => { throw new Error('unexpected sqlite import'); };
  const o = { ...codexOptions(p), importSqlite: noSqlite };
  for (const native of ['SessionStart', 'PreToolUse', 'Stop']) {
    await applyEvent(agyEv(native, AR1), o);
  }
  assert.equal((await readSnapshot({ paths: p })).agents[`agy:${AR1}`].state, 'done');

  // When a peer on the same handle is 'idle' or 'working' (none in 'done'/'error'), PreToolUse skips sqlite too
  const p2 = await tempState(t);
  const { appData } = agyStore(t, {
    conversation: AR1,
    trajectoryMetadata: encodeTrajectoryMetadata({ rootConversationId: AR1 }),
  });
  writeAgyMeta(appData, AS1, AR1, AR1);
  await applyEvent(agyEv('PreToolUse', AR1), { ...codexOptions(p2), agyAppDataDir: appData });
  await applyEvent(agyEv('SessionStart', AS1), { ...codexOptions(p2), agyAppDataDir: appData });
  // Now AR1 is 'working' and AS1 is 'idle'; PreToolUse on either must not touch sqlite
  await applyEvent(agyEv('PreToolUse', AS1), { ...codexOptions(p2), agyAppDataDir: appData, importSqlite: noSqlite });
  await applyEvent(agyEv('PreToolUse', AR1), { ...codexOptions(p2), agyAppDataDir: appData, importSqlite: noSqlite });
  const snap = await readSnapshot({ paths: p2 });
  assert.equal(snap.agents[`agy:${AR1}`].state, 'working');
  assert.equal(snap.agents[`agy:${AS1}`].state, 'working');
});

test('agy root SessionStart retires superseded root on the same handle whether done or interrupted mid-turn', async t => {
  for (const priorState of ['Stop', 'PreToolUse', 'SessionStart']) {
    const p = await tempState(t);
    const { appData } = agyStore(t, {
      conversation: AR1,
      trajectoryMetadata: encodeTrajectoryMetadata({ rootConversationId: AR1 }),
    });
    writeAgyMeta(appData, AR2, AR2);
    const o = { ...codexOptions(p), agyAppDataDir: appData };
    await applyEvent(agyEv(priorState, AR1), o);
    // Another agy process and a claude-code row must survive
    const otherHandle = { ...proof, pid: 202, start: '2' };
    await applyEvent(agyEv('SessionStart', '0199f000-0000-7000-8000-000000000999'), { ...codexOptions(p, otherHandle), agyAppDataDir: appData });
    await applyEvent(claudeEvent(C), o);

    const after = (await applyEvent(agyEv('SessionStart', AR2), o)).snapshot;
    assert.equal(after.agents[`agy:${AR1}`], undefined, priorState);
    assert.equal(after.agents[`agy:${AR2}`].state, 'idle', priorState);
    assert.ok(after.agents['agy:0199f000-0000-7000-8000-000000000999'], priorState);
    assert.ok(after.agents[`claude-code:${C}`], priorState);
  }
});

test('agy subagent lifecycle, turn 2+ start, parallel subagents, and send_message resumption', async t => {
  const p = await tempState(t);
  const { appData } = agyStore(t, {
    conversation: AR1,
    trajectoryMetadata: encodeTrajectoryMetadata({ rootConversationId: AR1 }),
  });
  writeAgyMeta(appData, AS1, AR1, AR1);
  writeAgyMeta(appData, AS2, AR1, AR1);
  const o = { ...codexOptions(p), agyAppDataDir: appData };

  // Turn 1 finishes: AR1 is 'done'. Turn 2+ starts with subagent AS1 while AR1 is 'done' (or after Stop(fullyIdle: false))
  await applyEvent(agyEv('SessionStart', AR1), o);
  await applyEvent(agyEv('Stop', AR1), o);
  assert.equal((await readSnapshot({ paths: p })).agents[`agy:${AR1}`].state, 'done');

  // Subagent AS1 starts and works while AR1 is 'done': AR1 is NOT retired
  await applyEvent(agyEv('SessionStart', AS1), o);
  let snap = (await applyEvent(agyEv('PreToolUse', AS1), o)).snapshot;
  assert.equal(snap.agents[`agy:${AR1}`].state, 'done');
  assert.equal(snap.agents[`agy:${AS1}`].state, 'working');

  // Parallel subagent AS2 starts and works concurrently; AR1 also works and fires Stop(fullyIdle: false)
  await applyEvent(agyEv('PreToolUse', AR1), o);
  await applyEvent(agyEv('SessionStart', AS2), o);
  await applyEvent(agyEv('PreToolUse', AS2), o);
  snap = (await applyEvent(agyEv('Stop', AR1), o)).snapshot;
  assert.equal(snap.agents[`agy:${AR1}`].state, 'done');
  assert.equal(snap.agents[`agy:${AS1}`].state, 'working');
  assert.equal(snap.agents[`agy:${AS2}`].state, 'working');

  // AS1 finishes (Stop): AS1 is removed immediately while AR1 and AS2 remain
  const s1Stopped = await applyEvent(agyEv('Stop', AS1), o);
  assert.equal(s1Stopped.changed, true);
  assert.equal(s1Stopped.snapshot.agents[`agy:${AS1}`], undefined);
  assert.ok(s1Stopped.snapshot.agents[`agy:${AR1}`]);
  assert.equal(s1Stopped.snapshot.agents[`agy:${AS2}`].state, 'working');

  // Duplicate Stop on already-removed AS1 is a no-op
  const dupStop = await applyEvent(agyEv('Stop', AS1), o);
  assert.equal(dupStop.changed, false);

  // AS2 finishes (Stop): AS2 is removed while AR1 remains
  snap = (await applyEvent(agyEv('Stop', AS2), o)).snapshot;
  assert.deepEqual(Object.keys(snap.agents), [`agy:${AR1}`]);

  // Resumed subagent AS1 via send_message (PreToolUse): re-upserts as 'working' without retiring AR1, then Stop removes it again
  snap = (await applyEvent(agyEv('PreToolUse', AS1), o)).snapshot;
  assert.equal(snap.agents[`agy:${AR1}`].state, 'done');
  assert.equal(snap.agents[`agy:${AS1}`].state, 'working');
  snap = (await applyEvent(agyEv('Stop', AS1), o)).snapshot;
  assert.deepEqual(Object.keys(snap.agents), [`agy:${AR1}`]);
});

test('agy non-waking child and overlapping roots', async t => {
  const p = await tempState(t);
  const { appData } = agyStore(t, {
    conversation: AR1,
    trajectoryMetadata: encodeTrajectoryMetadata({ rootConversationId: AR1 }),
  });
  writeAgyMeta(appData, AR2, AR2);
  writeAgyMeta(appData, AS1, AR1, AR1);
  const o = { ...codexOptions(p), agyAppDataDir: appData };

  // Non-waking child: AR1 is 'done', AS1 runs PreToolUse then Stop -> AR1 stays 'done', AS1 removed
  await applyEvent(agyEv('Stop', AR1), o);
  await applyEvent(agyEv('PreToolUse', AS1), o);
  let snap = (await applyEvent(agyEv('Stop', AS1), o)).snapshot;
  assert.deepEqual(Object.keys(snap.agents), [`agy:${AR1}`]);
  assert.equal(snap.agents[`agy:${AR1}`].state, 'done');

  // Overlapping roots: AR1 and AR2 both 'working' -> PreToolUse on AR1 keeps 'working' AR2
  await applyEvent(agyEv('PreToolUse', AR1), o);
  await applyEvent(agyEv('PreToolUse', AR2), o);
  snap = (await applyEvent(agyEv('PreToolUse', AR1), o)).snapshot;
  assert.equal(snap.agents[`agy:${AR1}`].state, 'working');
  assert.equal(snap.agents[`agy:${AR2}`].state, 'working');

  // Once AR1 is 'done', AR2's PreToolUse retires 'done' AR1
  await applyEvent(agyEv('Stop', AR1), o);
  snap = (await applyEvent(agyEv('PreToolUse', AR2), o)).snapshot;
  assert.deepEqual(Object.keys(snap.agents), [`agy:${AR2}`]);
});

test('agy root SessionStart enforces MAX_PEER_CLASSIFICATIONS = 4 on active peers and deletes finished peers without opening their DBs', async t => {
  const p = await tempState(t);
  const { appData } = agyStore(t, {
    conversation: AR1,
    trajectoryMetadata: encodeTrajectoryMetadata({ rootConversationId: AR1 }),
  });
  const done1 = '0199f000-0000-7000-8000-000000000301';
  const done2 = '0199f000-0000-7000-8000-000000000302';
  const workRoot1 = '0199f000-0000-7000-8000-000000000401';
  const workSub1 = '0199f000-0000-7000-8000-000000000402';
  const workRoot2 = '0199f000-0000-7000-8000-000000000403';
  const workSub2 = '0199f000-0000-7000-8000-000000000404';
  const workRoot3 = '0199f000-0000-7000-8000-000000000405';

  // Do NOT create DBs for done1, done2, or workRoot3 (5th active peer) — they must never be opened!
  writeAgyMeta(appData, workRoot1, workRoot1);
  writeAgyMeta(appData, workSub1, AR1, AR1);
  writeAgyMeta(appData, workRoot2, workRoot2);
  writeAgyMeta(appData, workSub2, AR1, AR1);

  const makeRow = (id, state) => ({
    id: `agy:${id}`, harness: 'agy', sessionId: id, scope: 'session',
    process: proof, cwd: '/repo', repoRoot: null, remote: null,
    projectKey: '/repo', project: 'repo', state, updatedAt: 1,
  });
  await fs.writeFile(p.agentsPath, JSON.stringify({
    schema: 2,
    generation: '12345678-1234-4234-8234-123456789abc',
    revision: 1,
    agents: {
      [`agy:${done1}`]: makeRow(done1, 'done'),
      [`agy:${done2}`]: makeRow(done2, 'error'),
      [`agy:${workRoot1}`]: makeRow(workRoot1, 'working'),
      [`agy:${workSub1}`]: makeRow(workSub1, 'working'),
      [`agy:${workRoot2}`]: makeRow(workRoot2, 'idle'),
      [`agy:${workSub2}`]: makeRow(workSub2, 'idle'),
      [`agy:${workRoot3}`]: makeRow(workRoot3, 'working'),
    },
  }), { mode: 0o600 });

  let opened = 0;
  const importSqlite = async () => ({
    DatabaseSync: class extends DatabaseSync {
      constructor(file, options) {
        opened++;
        super(file, options);
      }
    },
  });

  const res = await applyEvent(agyEv('SessionStart', AR1), {
    ...codexOptions(p),
    agyAppDataDir: appData,
    importSqlite,
  });
  // 1 (self AR1) + 4 (first 4 active peers) = 5 DB opens
  assert.equal(opened, 5);
  assert.deepEqual(Object.keys(res.snapshot.agents).sort(), [
    `agy:${AR1}`,
    `agy:${workSub1}`,
    `agy:${workSub2}`,
    `agy:${workRoot3}`,
  ].sort());
  assert.deepEqual(res.diagnostics.filter(d => d.code === 'AGY_CLASSIFICATION_UNAVAILABLE'), [{
    code: 'AGY_CLASSIFICATION_UNAVAILABLE',
    message: 'peer classification cap (4) reached',
    agentId: `agy:${workRoot3}`,
  }]);
});

test('agy unknown classification emits diagnostic, retires nothing, and upserts normally', async t => {
  const p = await tempState(t);
  const { appData } = agyStore(t, {
    conversation: AR1,
    trajectoryMetadata: encodeTrajectoryMetadata({ rootConversationId: AR1 }),
  });
  const o = { ...codexOptions(p), agyAppDataDir: appData };
  await applyEvent(agyEv('Stop', AR1), o);

  // AS1 has no DB file -> unknown classification on SessionStart and Stop; retires nothing and Stop upserts 'done' instead of deleting
  const sStart = await applyEvent(agyEv('SessionStart', AS1), o);
  assert.ok(sStart.diagnostics.some(d => d.code === 'AGY_CLASSIFICATION_UNAVAILABLE' && d.agentId === `agy:${AS1}`));
  assert.ok(sStart.snapshot.agents[`agy:${AR1}`]);
  assert.equal(sStart.snapshot.agents[`agy:${AS1}`].state, 'idle');

  const sStop = await applyEvent(agyEv('Stop', AS1), o);
  assert.ok(sStop.diagnostics.some(d => d.code === 'AGY_CLASSIFICATION_UNAVAILABLE' && d.agentId === `agy:${AS1}`));
  assert.ok(sStop.snapshot.agents[`agy:${AR1}`]);
  assert.equal(sStop.snapshot.agents[`agy:${AS1}`].state, 'done');

  // Now AR1 (known root) fires PreToolUse and retires 'done' AS1
  const afterRoot = await applyEvent(agyEv('PreToolUse', AR1), o);
  assert.deepEqual(Object.keys(afterRoot.snapshot.agents), [`agy:${AR1}`]);
});

test('resolveAgyAppDataDir follows agyAppDataDir -> ANTIGRAVITY_APP_DATA_DIR -> HOME fallback order', async t => {
  const p = await tempState(t);
  const { appData } = agyStore(t, {
    conversation: AR1,
    trajectoryMetadata: encodeTrajectoryMetadata({ rootConversationId: AR1 }),
  });
  writeAgyMeta(appData, AR2, AR2);

  // 1. env.ANTIGRAVITY_APP_DATA_DIR fallback
  await applyEvent(agyEv('Stop', AR1), codexOptions(p));
  let res = await applyEvent(agyEv('SessionStart', AR2), {
    ...codexOptions(p),
    env: { ANTIGRAVITY_APP_DATA_DIR: appData },
  });
  assert.deepEqual(Object.keys(res.snapshot.agents), [`agy:${AR2}`]);

  // 2. env.HOME fallback (<HOME>/.gemini/antigravity-cli)
  const fakeHome = join(p.stateDir, '..', 'fake-home');
  const homeAppData = join(fakeHome, '.gemini', 'antigravity-cli');
  await fs.mkdir(join(homeAppData, 'conversations'), { recursive: true });
  writeAgyMeta(homeAppData, AR1, AR1);
  writeAgyMeta(homeAppData, AR2, AR2);
  res = await applyEvent(agyEv('SessionStart', AR1), {
    ...codexOptions(p),
    env: { HOME: fakeHome },
  });
  assert.deepEqual(Object.keys(res.snapshot.agents), [`agy:${AR1}`]);
});
