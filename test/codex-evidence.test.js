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
 assert.equal(typeof mod.validateInitialize,'function');const good={userAgent:'controller/0.165.0 (Linux) unknown (relay; 1)',codexHome:'/private/home'};assert.doesNotThrow(()=>mod.validateInitialize(good,cfg));for(const v of ['0.166.0','0.165.0-extra','x0.165.0','0.165.00','0.166.0/0.165.0'])assert.throws(()=>mod.validateInitialize({...good,userAgent:'relay/'+v+' (Linux)'},cfg));assert.throws(()=>mod.validateInitialize({...good,codexHome:'/other'},cfg));
});
test('evidence refuses wrong version, altered pins, malformed/symlink files and incorrect executable without executing it',async t=>{
 assert.equal(typeof mod.validateEvidence,'function');const dir=await fs.mkdtemp(join(tmpdir(),'relay-evidence-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const evidence=join(dir,'e.json'),bin=join(dir,'codex');await fs.writeFile(bin,'#!/bin/sh\necho secret > NEVER_EXECUTED\n',{mode:0o700});const valid=await fs.readFile(new URL('../docs/evidence/codex-question-0.165.0.json',import.meta.url),'utf8');
 for(const text of [valid.replace('0.165.0','0.166.0'),valid.replace(/d7b21f2f9ca15e6550e105f1140b8312bb36d4563119478bf8748ebab81e6d4b/,'0'.repeat(64)),'not json',valid]){await fs.writeFile(evidence,text,{mode:0o600});await assert.rejects(mod.validateEvidence({...cfg,evidence,bin}),/CODEX_/);}
 await fs.rm(evidence);await fs.symlink(bin,evidence);await assert.rejects(mod.validateEvidence({...cfg,evidence,bin}),/CODEX_/);assert.deepEqual((await fs.readdir(dir)).sort(),['codex','e.json']);
});
test('pinned evidence and actual binary still refuse connection without selective atomic native subscription',{skip:!process.env.RELAY_CODEX_TEST_BIN},async()=>{
 assert.equal(typeof mod.validateEvidence,'function');await assert.rejects(mod.validateEvidence({...cfg,evidence:resolve('docs/evidence/codex-question-0.165.0.json'),bin:process.env.RELAY_CODEX_TEST_BIN}),{message:'CODEX_NO_ATOMIC_SUBSCRIPTION'});
});
