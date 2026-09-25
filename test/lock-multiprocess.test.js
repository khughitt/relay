import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tempState } from './helpers/fixture.js';
import { createProcessOps } from '../src/bus/proc.js';
import { withLock } from '../src/bus/lock.js';
import { readSnapshot } from '../src/bus/transaction.js';
function worker(t,mode,p) {
  const child=fork(new URL('./fixtures/lock-worker.js',import.meta.url),[mode,p.stateDir],{stdio:['ignore','ignore','inherit','ipc']});
  const queued=[],waiting=[];
  child.on('message',m=>{const waiter=waiting.shift();if(waiter)waiter(m);else queued.push(m);});
  t.after(()=>{if(child.exitCode===null&&!child.killed)child.kill('SIGKILL');});
  return {child,next:()=>queued.length?Promise.resolve(queued.shift()):new Promise(resolve=>waiting.push(resolve)),exit:once(child,'exit')};
}
async function launch(t,mode,p,n=1) {
  const workers=Array.from({length:n},()=>worker(t,mode,p));
  for(const w of workers){const m=await w.next();assert.equal(m.type,'ready',JSON.stringify(m));}
  for(const w of workers)w.child.send('start');return workers;
}
const dead = () => {const h=createProcessOps().handleOf(process.pid);return {schema:1,nonce:randomUUID(),holder:{...h,start:String(BigInt(h.start)+1n)}};};
test('eight real processes retain all counter updates, including dead main reclamation',{timeout:30000},async t=>{
  for(const seed of [false,true]) {
    const p=await tempState(t);await fs.writeFile(`${p.stateDir}/counter`,'0',{mode:0o600});
    if(seed)await fs.writeFile(p.lockPath,JSON.stringify(dead()),{mode:0o600});
    const workers=await launch(t,'increment',p,8);
    for(const w of workers){const m=await w.next();assert.equal(m.type,'done',JSON.stringify(m));assert.equal((await w.exit)[0],0);}
    assert.equal(await fs.readFile(`${p.stateDir}/counter`,'utf8'),'24');
  }
});
test('concurrent real registry writers retain every still-live process',{timeout:30000},async t=>{
  const p=await tempState(t),workers=await launch(t,'registry',p,8);
  for(const w of workers){const m=await w.next();assert.equal(m.type,'written',JSON.stringify(m));}
  const snapshot=await readSnapshot({paths:p});assert.equal(snapshot.revision,8);assert.equal(Object.keys(snapshot.agents).length,8);
  for(const w of workers){w.child.send('release');const m=await w.next();assert.equal(m.type,'done',JSON.stringify(m));await w.exit;}
});
test('killed main owner recovers; killed guard requires repair without snapshot changes',{timeout:30000},async t=>{
  for(const mode of ['hold-main','hold-guard']) {
    const p=await tempState(t);await fs.writeFile(p.agentsPath,'preserve',{mode:0o600});
    if(mode==='hold-guard')await fs.writeFile(p.lockPath,JSON.stringify(dead()),{mode:0o600});
    const [w]=await launch(t,mode,p);const m=await w.next();assert.equal(m.type,'entered',JSON.stringify(m));w.child.kill('SIGKILL');await w.exit;
    if(mode==='hold-main')assert.equal((await withLock(p.lockPath,()=>42)).value,42);
    else await assert.rejects(withLock(p.lockPath,()=>assert.fail()),{code:'LOCK_REPAIR_REQUIRED'});
    assert.equal(await fs.readFile(p.agentsPath,'utf8'),'preserve');
  }
});
test('real processes refuse empty main and abandoned empty guard without updates',{timeout:30000},async t=>{
  for(const guard of [false,true]) {
    const p=await tempState(t);await fs.writeFile(`${p.stateDir}/counter`,'0',{mode:0o600});
    await fs.writeFile(p.lockPath,guard?JSON.stringify(dead()):'',{mode:0o600});
    if(guard)await fs.writeFile(p.reclaimPath,'',{mode:0o600});
    const workers=await launch(t,'increment',p,3);
    for(const w of workers){assert.deepEqual(await w.next(),{type:'error',code:'LOCK_REPAIR_REQUIRED'});assert.equal((await w.exit)[0],1);}
    assert.equal(await fs.readFile(`${p.stateDir}/counter`,'utf8'),'0');
  }
});
