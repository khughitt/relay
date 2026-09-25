import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { withLock } from '../src/bus/lock.js';
import { DEADLINE_CUT, createProcessOps } from '../src/bus/proc.js';
import { tempState } from './helpers/fixture.js';
test('serializes concurrent writers and releases callback errors', async (t) => {
  const { lockPath } = await tempState(t), order = [];
  await Promise.all([1,2,3,4,5].map(n => withLock(lockPath, async () => {
    order.push(n); await new Promise(r => setTimeout(r, 2)); order.push(n);
  })));
  for (let i = 0; i < order.length; i += 2) assert.equal(order[i],order[i+1]);
  await assert.rejects(withLock(lockPath, () => { throw new Error('boom'); }), /boom/);
  assert.equal((await withLock(lockPath, () => 42)).value,42);
});
test('an old live owner keeps its critical section', async (t) => {
  const { lockPath } = await tempState(t);
  let signalEntered, release;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const holder = withLock(lockPath, async () => { signalEntered(); await held; });
  try {
    await Promise.race([entered,holder]);
    await fs.utimes(lockPath,new Date(0),new Date(0));
    let fakeNow = 0, enteredSecond = false;
    await assert.rejects(withLock(lockPath, () => { enteredSecond = true; }, {
      clock: () => fakeNow, deadline:50, sleep:async ms => { fakeNow += ms; }
    }),{code:'LOCK_TIMEOUT'});
    assert.equal(enteredSecond,false);
  } finally { release(); assert.equal((await holder).cleanupError,null); }
});
const ops = () => createProcessOps();
const token = (holder = ops().handleOf(process.pid)) => ({schema:1,nonce:randomUUID(),holder});
const writeToken = (path,value) => fs.writeFile(path,JSON.stringify(value),{mode:0o600});
const fakeWait = () => { let time = 0; return {clock:()=>time,deadline:50,sleep:async ms=>{time+=ms;}}; };
const deadToken = () => { const t = token(); t.holder.start = String(BigInt(t.holder.start)+1n); return t; };
test('complete private tokens carry fresh qualified owner and nonce', async t => {
  const p = await tempState(t); const seen = [];
  for (let i=0;i<2;i++) await withLock(p.lockPath,async()=>{
    const value = JSON.parse(await fs.readFile(p.lockPath,'utf8')); seen.push(value);
    assert.equal(value.schema,1); assert.equal(value.holder.pid,process.pid);
    assert.equal(ops().probe(value.holder).status,'alive');
    assert.equal((await fs.stat(p.lockPath)).mode & 0o777,0o600);
  },{io:{...fs,link:async(from,to)=>{
    assert.ok(JSON.parse(await fs.readFile(from,'utf8')).nonce);
    assert.equal((await fs.stat(from)).mode & 0o777,0o600); await fs.link(from,to);
  }}});
  assert.notEqual(seen[0].nonce,seen[1].nonce); assert.deepEqual(await fs.readdir(p.stateDir),[]);
});
test('dead and boot-mismatched main owners recover with eight nonoverlapping racers', async t => {
  const p = await tempState(t);
  for (const owner of [deadToken(),{...token(),holder:{...token().holder,bootId:randomUUID()}}]) {
    if (owner.holder.platform === 'darwin' && owner.holder.bootId !== null) continue;
    await writeToken(p.lockPath,owner); let inside=0, count=0;
    await Promise.all(Array.from({length:8},()=>withLock(p.lockPath,async()=>{
      assert.equal(++inside,1); await new Promise(r=>setTimeout(r,2)); count++; inside--;
    })));
    assert.equal(count,8);
  }
});
test('unknown main proof waits and reports identity unavailable', async t => {
  const p = await tempState(t), owner=token(); owner.holder.host='foreign-host';
  await writeToken(p.lockPath,owner);
  await assert.rejects(withLock(p.lockPath,()=>assert.fail('entered'),fakeWait()),{code:'LOCK_IDENTITY_UNKNOWN'});
  assert.deepEqual(JSON.parse(await fs.readFile(p.lockPath)),owner);
});
test('a probe the deadline cut short leaves the last completed owner verdict standing', async t => {
  // Mac regression (relay-6e9410): ps killed at the deadline turned a live owner into
  // LOCK_IDENTITY_UNKNOWN. Owner probes land at t=0, 20 and 40 of a 50 ms deadline.
  const alive = { status: 'alive', reason: 'qualified process matches' }, cut = { status: 'unknown', reason: DEADLINE_CUT };
  const foreign = { status: 'unknown', reason: 'foreign host' };
  for (const [verdicts, code] of [[[alive, alive, cut], 'LOCK_TIMEOUT'], [[alive, foreign, cut], 'LOCK_IDENTITY_UNKNOWN'],
    [[alive, alive, foreign], 'LOCK_IDENTITY_UNKNOWN']]) {
    const p = await tempState(t), owner = token(); await writeToken(p.lockPath,owner);
    const real = ops(), wait = fakeWait(); let calls = 0;
    const probe = (h,o) => calls++ === 0 ? real.probe(h,o) : verdicts[Math.min(calls-2,verdicts.length-1)];
    await assert.rejects(withLock(p.lockPath,()=>assert.fail('entered'),{...wait,processOps:{...real,probe}}),{code});
    assert.equal(calls,4);
    assert.deepEqual(JSON.parse(await fs.readFile(p.lockPath)),owner);
  }
});
test('old live or unknown guard is never stolen; dead and malformed guards require repair', async t => {
  const p = await tempState(t); await writeToken(p.lockPath,deadToken());
  for (const status of ['alive','unknown','dead','malformed']) {
    const guard = status==='dead' ? deadToken() : token();
    if(status==='unknown')guard.holder.host='foreign';
    await fs.writeFile(p.reclaimPath,status==='malformed'?'':JSON.stringify(guard),{mode:0o600});
    await fs.utimes(p.reclaimPath,new Date(0),new Date(0));
    await assert.rejects(withLock(p.lockPath,()=>assert.fail('entered'),fakeWait()),{
      code:status==='alive'?'LOCK_TIMEOUT':status==='unknown'?'LOCK_IDENTITY_UNKNOWN':'LOCK_REPAIR_REQUIRED'
    });
  }
});
test('empty old-format and malformed main tokens require explicit repair', async t => {
  const p = await tempState(t);
  for (const content of ['', '1:2:old', 'garbage', '{}', JSON.stringify({...token(),schema:2})]) {
    await fs.writeFile(p.lockPath,content,{mode:0o600});
    await assert.rejects(withLock(p.lockPath,()=>assert.fail('entered')),{code:'LOCK_REPAIR_REQUIRED'});
    assert.equal(await fs.readFile(p.lockPath,'utf8'),content);
  }
});
test('unavailable writer proof cannot acquire', async t => {
  const p=await tempState(t);
  for(const handle of [null,{...token().holder,bootId:null}]) {
    if(handle?.platform==='darwin')continue;
    await assert.rejects(withLock(p.lockPath,()=>assert.fail(),{processOps:{handleOf:()=>handle,probe:()=>({status:'alive'})}}),{code:'LOCK_IDENTITY_UNKNOWN'});
  }
  assert.deepEqual(await fs.readdir(p.stateDir),[]);
});
test('expiry after successful acquisition releases without entering callback', async t => {
  const p=await tempState(t);let time=0;
  await assert.rejects(withLock(p.lockPath,()=>assert.fail('entered'),{clock:()=>time,deadline:10,
    io:{...fs,link:async(a,b)=>{await fs.link(a,b);time=10;}}}),{code:'LOCK_TIMEOUT'});
  assert.deepEqual(await fs.readdir(p.stateDir),[]);
});
test('cleanup failure preserves successful value and both errors on callback failure', async t => {
  const p=await tempState(t); const io={...fs,unlink:async path=>{if(path===p.lockPath)throw Object.assign(new Error('denied'),{code:'EACCES'});return fs.unlink(path);}};
  const result=await withLock(p.lockPath,()=>42,{io});assert.equal(result.value,42);assert.equal(result.cleanupError.code,'LOCK_CLEANUP_FAILED');
  await fs.unlink(p.lockPath);
  await assert.rejects(withLock(p.lockPath,()=>{throw new Error('callback failure');},{io}),error=>{
    assert.ok(error instanceof AggregateError);assert.equal(error.errors[0].message,'callback failure');assert.equal(error.errors[1].code,'LOCK_CLEANUP_FAILED');return true;
  });
});
test('ownership change is reported without deleting replacement', async t=>{
  const p=await tempState(t),replacement=token();
  const result=await withLock(p.lockPath,()=>writeToken(p.lockPath,replacement));
  assert.equal(result.cleanupError.code,'LOCK_OWNERSHIP_LOST');assert.deepEqual(JSON.parse(await fs.readFile(p.lockPath)),replacement);
});
test('guard cleanup failure is visible before callback entry',async t=>{
  const p=await tempState(t);await writeToken(p.lockPath,deadToken());
  await assert.rejects(withLock(p.lockPath,()=>assert.fail('entered'),{io:{...fs,unlink:async path=>{
    if(path===p.reclaimPath)throw Object.assign(new Error('denied'),{code:'EACCES'});await fs.unlink(path);
  }}}),{code:'LOCK_CLEANUP_FAILED'});
});
test('EEXIST followed by vanished main or guard is a retry, read errors are not absence',async t=>{
  for(const guardRace of [false,true]) {
    const p=await tempState(t);await writeToken(p.lockPath,deadToken());if(guardRace)await writeToken(p.reclaimPath,token());
    let removed=false;const raced=guardRace?p.reclaimPath:p.lockPath;
    await withLock(p.lockPath,()=>{}, {io:{...fs,link:async(a,b)=>{
      try{await fs.link(a,b);}catch(error){if(b===raced&&!removed){removed=true;await fs.unlink(b);}throw error;}
    }}});assert.equal(removed,true);
  }
  const p=await tempState(t);await writeToken(p.lockPath,token());
  await assert.rejects(withLock(p.lockPath,()=>assert.fail(),{io:{...fs,readFile:async()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});}}}),{code:'IO_ERROR'});
});
test('under guard reread leaves changed live owner alone and missing main is already free',async t=>{
  for(const replacement of [null,token()]) {
    const p=await tempState(t);await writeToken(p.lockPath,deadToken());let replaced=false;
    const attempt=withLock(p.lockPath,()=>{}, {...fakeWait(),io:{...fs,link:async(a,b)=>{
      await fs.link(a,b);if(b===p.reclaimPath&&!replaced){replaced=true;await fs.unlink(p.lockPath);if(replacement)await writeToken(p.lockPath,replacement);}
    }}});
    if(replacement){await assert.rejects(attempt,{code:'LOCK_TIMEOUT'});assert.deepEqual(JSON.parse(await fs.readFile(p.lockPath)),replacement);}
    else assert.equal((await attempt).cleanupError,null);
  }
});
test('token write/link/private cleanup failures propagate without entering',async t=>{
  for(const operation of ['writeFile','link','privateCleanup']) {
    const p=await tempState(t),fail=()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});};
    const io={...fs};
    if(operation==='privateCleanup')io.unlink=async path=>path.includes('.tmp.')?fail():fs.unlink(path);
    else io[operation]=async()=>fail();
    await assert.rejects(withLock(p.lockPath,()=>assert.fail('entered'),{io}),{code:operation==='privateCleanup'?'LOCK_CLEANUP_FAILED':'IO_ERROR'});
    await assert.rejects(fs.lstat(p.lockPath),{code:'ENOENT'});
  }
});
test('falsy callback exceptions reject and survive simultaneous cleanup failure',async t=>{
  const p=await tempState(t);
  for(const thrown of [null,undefined,false,0,'']) {
    for(const cleanupFails of [false,true]) {
      const io={...fs,unlink:async path=>{
        if(cleanupFails&&path===p.lockPath)throw Object.assign(new Error('denied'),{code:'EACCES'});
        return fs.unlink(path);
      }};
      let caught=false;
      try { await withLock(p.lockPath,()=>{throw thrown;},{io}); }
      catch(error) {
        caught=true;
        if(cleanupFails){assert.ok(error instanceof AggregateError);assert.equal(error.errors[0],thrown);assert.equal(error.errors[1].code,'LOCK_CLEANUP_FAILED');}
        else assert.equal(error,thrown);
      }
      assert.equal(caught,true,'every thrown value must reject');
      if(cleanupFails)await fs.unlink(p.lockPath);
      else await assert.rejects(fs.lstat(p.lockPath),{code:'ENOENT'});
    }
  }
});
