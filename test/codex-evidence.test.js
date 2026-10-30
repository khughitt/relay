import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {serveConfig} from '../src/serve/config.js';
const mod=await import('../src/serve/codex/evidence.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const vars={RELAY_CODEX_BIN:'/pinned/codex',RELAY_CODEX_HOME:'/private/home',RELAY_CODEX_SOCKET:'/private/socket',RELAY_CODEX_EVIDENCE:'/private/evidence.json'};
const cfg={bin:vars.RELAY_CODEX_BIN,home:vars.RELAY_CODEX_HOME,socket:vars.RELAY_CODEX_SOCKET,evidence:vars.RELAY_CODEX_EVIDENCE};
test('Codex configuration is absent by default and all four absolute opt-in paths are required',()=>{
 assert.equal(serveConfig({}).codex,null);assert.deepEqual(serveConfig(vars).codex,cfg);for(const k of Object.keys(vars)){const missing={...vars};delete missing[k];assert.throws(()=>serveConfig(missing),{code:'INVALID_CONFIG'});assert.throws(()=>serveConfig({...vars,[k]:'relative'}),{code:'INVALID_CONFIG'});assert.throws(()=>serveConfig({...vars,[k]:''}),{code:'INVALID_CONFIG'});assert.throws(()=>serveConfig({...vars,[k]:'/bad\0path'}),{code:'INVALID_CONFIG'});}
});
test('initialized server must match the exact pinned version token and configured home',()=>{
 assert.equal(typeof mod.validateInitialize,'function');const good={userAgent:'controller/0.166.0 (Linux) unknown (relay; 1)',codexHome:'/private/home'};assert.doesNotThrow(()=>mod.validateInitialize(good,cfg));for(const v of ['0.165.0','0.167.0','0.166.0-extra','x0.166.0','0.166.00','0.167.0/0.166.0'])assert.throws(()=>mod.validateInitialize({...good,userAgent:'relay/'+v+' (Linux)'},cfg));assert.throws(()=>mod.validateInitialize({...good,codexHome:'/other'},cfg));
});
test('evidence refuses wrong version, altered pins, malformed/symlink files and incorrect executable without executing it',async t=>{
 assert.equal(typeof mod.validateEvidence,'function');const dir=await fs.mkdtemp(join(tmpdir(),'relay-evidence-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const evidence=join(dir,'e.json'),bin=join(dir,'codex');await fs.writeFile(bin,'#!/bin/sh\necho secret > NEVER_EXECUTED\n',{mode:0o700});const valid=await fs.readFile(new URL('../docs/evidence/codex-question-0.166.0.json',import.meta.url),'utf8');
 for(const text of [valid.replace('0.166.0','0.167.0'),valid.replace(/6f5d309666a47ab9346518f61469b2b009d43881a7907287f8d448574def7075/,'0'.repeat(64)),'not json',valid]){await fs.writeFile(evidence,text,{mode:0o600});await assert.rejects(mod.validateEvidence({...cfg,evidence,bin}),/CODEX_/);}
 await fs.rm(evidence);await fs.symlink(bin,evidence);await assert.rejects(mod.validateEvidence({...cfg,evidence,bin}),/CODEX_/);assert.deepEqual((await fs.readdir(dir)).sort(),['codex','e.json']);
});
test('pinned evidence admits only the accepted active-waiting detected residual',{skip:!process.env.RELAY_CODEX_TEST_BIN},async()=>{
 assert.equal(typeof mod.validateEvidence,'function');assert.deepEqual(await mod.validateEvidence({...cfg,evidence:resolve('docs/evidence/codex-question-0.166.0.json'),bin:process.env.RELAY_CODEX_TEST_BIN}),{version:'0.166.0',blockingBuiltinImpliesPlan:true,gate7Passed:false});
});
