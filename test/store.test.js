import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, writeJsonAtomic } from '../src/bus/store.js';
import { tempState } from './helpers/fixture.js';
test('atomic write round trips and leaves no temporary files', async t => {
  const p = await tempState(t); await writeJsonAtomic(p.agentsPath,{a:1});
  assert.deepEqual(await readJson(p.agentsPath),{a:1});
  assert.deepEqual(await fs.readdir(p.stateDir),['agents.json']);
});
test('missing is undefined internally and corrupt JSON is explicit', async t => {
  const p = await tempState(t); assert.equal(await readJson(p.agentsPath),undefined);
  await fs.writeFile(p.agentsPath,'{ broken',{mode:0o600});
  await assert.rejects(readJson(p.agentsPath),{code:'CORRUPT_STATE'});
});
test('state leaf and files reject unsafe modes, types, symlinks and wrong ownership',async t=>{
  const p=await tempState(t);await fs.chmod(p.stateDir,0o755);
  await assert.rejects(readJson(p.agentsPath),{code:'IO_ERROR'});await assert.rejects(writeJsonAtomic(p.agentsPath,{}),{code:'IO_ERROR'});
  assert.equal((await fs.stat(p.stateDir)).mode&0o777,0o755);await fs.chmod(p.stateDir,0o700);
  await fs.writeFile(p.agentsPath,'{}',{mode:0o644});await assert.rejects(readJson(p.agentsPath),{code:'IO_ERROR'});
  await fs.unlink(p.agentsPath);await fs.symlink('/dev/null',p.agentsPath);await assert.rejects(writeJsonAtomic(p.agentsPath,{}),{code:'IO_ERROR'});
  await fs.unlink(p.agentsPath);await fs.mkdir(p.agentsPath);await assert.rejects(readJson(p.agentsPath),{code:'IO_ERROR'});
  const info=await fs.lstat(p.stateDir);
  await assert.rejects(readJson(p.agentsPath,{io:{...fs,lstat:async()=>Object.assign(Object.create(info),{uid:process.getuid()+1})}}),{code:'IO_ERROR'});
  const linked=join(p.stateDir,'link');await fs.symlink(p.stateDir,linked);
  await assert.rejects(writeJsonAtomic(join(linked,'agents.json'),{}),{code:'IO_ERROR'});
});
test('new nested directory and snapshot are private; missing reads never create state',async t=>{
  const p=await tempState(t),path=join(p.stateDir,'nested','agents.json');
  assert.equal(await readJson(path),undefined);assert.deepEqual(await fs.readdir(p.stateDir),[]);
  await writeJsonAtomic(path,{});assert.equal((await fs.stat(join(p.stateDir,'nested'))).mode&0o777,0o700);assert.equal((await fs.stat(path)).mode&0o777,0o600);
});
test('pre-rename failure preserves original and reports temporary cleanup failures',async t=>{
  const p=await tempState(t);await writeJsonAtomic(p.agentsPath,{old:true});
  const fail=async()=>{throw Object.assign(new Error('failure'),{code:'EIO'});};
  await assert.rejects(writeJsonAtomic(p.agentsPath,{new:true},{io:{...fs,rename:fail}}),{code:'IO_ERROR'});
  assert.deepEqual(await readJson(p.agentsPath),{old:true});assert.deepEqual(await fs.readdir(p.stateDir),['agents.json']);
  await assert.rejects(writeJsonAtomic(p.agentsPath,{new:true},{io:{...fs,rename:fail,unlink:fail}}),error=>error instanceof AggregateError&&error.errors.length===2);
  assert.deepEqual(await readJson(p.agentsPath),{old:true});
});
test('failed partial temporary write is removed and does not replace snapshot',async t=>{
  const p=await tempState(t);await writeJsonAtomic(p.agentsPath,{old:true});
  await assert.rejects(writeJsonAtomic(p.agentsPath,{new:true},{io:{...fs,writeFile:async(path,data,options)=>{
    await fs.writeFile(path,'partial',options);throw Object.assign(new Error('disk full'),{code:'ENOSPC'});
  }}}),{code:'IO_ERROR'});
  assert.deepEqual(await readJson(p.agentsPath),{old:true});assert.deepEqual(await fs.readdir(p.stateDir),['agents.json']);
});
