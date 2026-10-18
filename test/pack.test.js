import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,writeFile,rm,mkdir,copyFile,readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));
test('package dry run and installed tarball expose only the documented runtime',{timeout:30000},async t=>{
  const temp=await mkdtemp(join(tmpdir(),'relay-pack-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const env={...process.env,npm_config_cache:join(temp,'cache'),RELAY_STATE_DIR:join(temp,'state'),XDG_CONFIG_HOME:join(temp,'config')};
  const run=(cmd,args,cwd=root)=>exec(cmd,args,{cwd,env,timeout:20000,maxBuffer:4*1024*1024});
  const dry=JSON.parse((await run('npm',['pack','--dry-run','--json'])).stdout)[0];const names=dry.files.map(f=>f.path);
  for(const name of ['bin/relay.js','src/index.js','integrations/opencode/plugin.js','test/fixtures/handles.json','test/fixtures/ancestry.json','docs/api.md','docs/runbooks/registry-lock-repair.md','schemas/interaction/message.schema.json','docs/runbooks/inbox-service.md','LICENSE'])assert.ok(names.includes(name),name);
  for(const name of names)assert.ok(!/\.test\.|lock-worker|^tasks\/|^\.superpowers\/|agents\.json|subscribers\.json/.test(name),name);
  const pack=JSON.parse((await run('npm',['pack','--json','--pack-destination',temp])).stdout)[0];
  const consumer=join(temp,'consumer');await mkdir(consumer);await writeFile(join(consumer,'package.json'),'{"private":true,"type":"module"}');
  // jsonc-parser is a plain dependency now; an offline install takes it from a tarball of the local copy.
  // --ignore-scripts: its own prepack calls rimraf.
  const dep=JSON.parse((await run('npm',['pack','--json','--ignore-scripts','--pack-destination',temp,join(root,'node_modules/jsonc-parser')])).stdout)[0];
  await run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',join(temp,pack.filename),join(temp,dep.filename)],consumer);
  await copyFile(join(root,'test/fixtures/consumer-smoke.mjs'),join(consumer,'consumer-smoke.mjs'));
  const smoked=await run(process.execPath,['consumer-smoke.mjs'],consumer);assert.match(smoked.stdout,/installed package verified/);
});
// A git dependency is packed from a clone, which has no node_modules: what it bundles must be tracked.
test('a package packed from tracked files alone carries every dependency it bundles',{timeout:60000},async t=>{
  const temp=await mkdtemp(join(tmpdir(),'relay-clone-pack-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const env={...process.env,npm_config_cache:join(temp,'cache')},clone=join(temp,'clone');
  const tracked=(await exec('git',['ls-files','-z'],{cwd:root,maxBuffer:16*1024*1024})).stdout.split('\0').filter(Boolean);
  for(const file of tracked){if(!existsSync(join(root,file)))continue;await mkdir(dirname(join(clone,file)),{recursive:true});await copyFile(join(root,file),join(clone,file));}
  const listing=async cwd=>JSON.parse((await exec('npm',['pack','--dry-run','--json','--ignore-scripts'],{cwd,env,timeout:20000,maxBuffer:4*1024*1024})).stdout)[0].files.map(f=>f.path).sort();
  const cloned=await listing(clone),rooted=await listing(root);
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')),bundled=pkg.bundledDependencies??pkg.bundleDependencies??[];
  for(const name of bundled)assert.ok(cloned.includes(`node_modules/${name}/package.json`),`bundled ${name} is missing from a package built from a clone`);
  assert.equal(typeof pkg.dependencies['jsonc-parser'],'string');
  assert.deepEqual(cloned,rooted);
});
