import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneDead } from '../src/bus/prune.js';
import { createProcessOps } from '../src/bus/proc.js';
test('pruning forwards complete handles, retains unknown, and never mutates input',()=>{
  const agents={live:{process:{pid:1,start:'1'}},dead:{process:{pid:2,start:'2'}},unknown:{process:null}};
  const seen=[];const result=pruneDead(agents,{probe:h=>{seen.push(h);return {status:h===null?'unknown':h.pid===1?'alive':'dead',reason:'fixture'};}});
  assert.deepEqual(Object.keys(result.agents),['live','unknown']);assert.deepEqual(result.reaped,['dead']);assert.deepEqual(seen,Object.values(agents).map(a=>a.process));assert.equal(Object.keys(agents).length,3);
});
test('real local process reuse is pruned while live and unavailable proofs remain',()=>{
  const ops=createProcessOps(),h=ops.handleOf(process.pid);
  const result=pruneDead({live:{process:h},dead:{process:{...h,start:String(BigInt(h.start)+1n)}},unknown:{process:null}},{probe:ops.probe});
  assert.deepEqual(Object.keys(result.agents),['live','unknown']);
});
