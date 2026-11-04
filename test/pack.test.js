import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,writeFile,rm,mkdir,copyFile,readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname,resolve,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));
function packEntry(output){
  const entries=Object.values(output);
  assert.equal(entries.length,1,'npm pack must return exactly one entry');
  return entries[0];
}
function gfmSlug(heading){
  return heading
    .trim()
    .replace(/`([^`]*)`/g,'$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g,'$1')
    .toLowerCase()
    .replace(/[^\w\s-]/g,'')
    .replace(/\s+/g,'-');
}
function extractSlugs(markdown){
  const slugs=new Set();
  const counts=new Map();
  let inFence=false;
  for(const line of markdown.split(/\r?\n/)){
    if(/^(`{3,}|~{3,})/.test(line.trim())){inFence=!inFence;continue;}
    if(inFence)continue;
    const m=/^#{1,6}\s+(.+?)\s*#*$/.exec(line);
    if(!m)continue;
    const base=gfmSlug(m[1]);
    const seen=counts.get(base)??0;
    counts.set(base,seen+1);
    slugs.add(seen===0?base:`${base}-${seen}`);
  }
  return slugs;
}
function extractLinks(markdown){
  const stripped=markdown.replace(/^(`{3,}|~{3,})[\s\S]*?^\1/gm,'');
  const targets=[];
  for(const m of stripped.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g))targets.push(m[1]);
  for(const m of stripped.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm))targets.push(m[1]);
  return targets;
}
test('packEntry reads both npm JSON shapes and rejects zero or multiple entries',()=>{
  const entry={filename:'relay.tgz',files:[{path:'bin/relay.js'}]};
  assert.equal(packEntry([entry]),entry);
  assert.equal(packEntry({relay:entry}),entry);
  for(const output of [[],{},[entry,entry],{relay:entry,other:entry}])
    assert.throws(()=>packEntry(output),/exactly one entry/);
});
test('package dry run and installed tarball expose only the documented runtime',{timeout:30000},async t=>{
  const temp=await mkdtemp(join(tmpdir(),'relay-pack-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const env={PATH:process.env.PATH,HOME:temp,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',npm_config_cache:join(temp,'cache'),RELAY_STATE_DIR:join(temp,'state'),XDG_CONFIG_HOME:join(temp,'config')};
  const run=(cmd,args,cwd=root)=>exec(cmd,args,{cwd,env,timeout:20000,maxBuffer:4*1024*1024});
  const dry=packEntry(JSON.parse((await run('npm',['pack','--dry-run','--json'])).stdout));const names=dry.files.map(f=>f.path);
  for(const name of [
    'bin/relay.js',
    'src/index.js',
    'integrations/opencode/plugin.js',
    'test/fixtures/handles.json',
    'test/fixtures/ancestry.json',
    'docs/api.md',
    'docs/registry.md',
    'docs/adapters.md',
    'docs/questions.md',
    'docs/runbooks/registry-lock-repair.md',
    'schemas/interaction/message.schema.json',
    'docs/runbooks/inbox-service.md',
    'docs/evidence/codex-question-0.166.0.json',
    'LICENSE'
  ])assert.ok(names.includes(name),name);
  for(const forbidden of [
    'docs/test-execution-policy.md',
    'docs/runbooks/darwin-probe.md',
    'docs/runbooks/release.md',
    'docs/runbooks/hook-install-rollback.md',
    'docs/runbooks/answer-route-probes.md',
    'docs/runbooks/codex-question-reproof.md',
    'integrations/opencode/window.test.mjs'
  ])assert.ok(!names.includes(forbidden),`unexpected packaged file: ${forbidden}`);
  for(const name of names)assert.ok(!/\.test\.|lock-worker|^tasks\/|^\.superpowers\/|^docs\/(?:specs|plans|notes|reports)\/|agents\.json|subscribers\.json/.test(name),name);
  const pack=packEntry(JSON.parse((await run('npm',['pack','--json','--pack-destination',temp])).stdout));
  const consumer=join(temp,'consumer');await mkdir(consumer);await writeFile(join(consumer,'package.json'),'{"private":true,"type":"module"}');
  // jsonc-parser is a plain dependency now; an offline install takes it from a tarball of the local copy.
  // --ignore-scripts: its own prepack calls rimraf.
  const dep=packEntry(JSON.parse((await run('npm',['pack','--json','--ignore-scripts','--pack-destination',temp,join(root,'node_modules/jsonc-parser')])).stdout));
  await run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',join(temp,pack.filename),join(temp,dep.filename)],consumer);
  await copyFile(join(root,'test/fixtures/consumer-smoke.mjs'),join(consumer,'consumer-smoke.mjs'));
  const smoked=await run(process.execPath,['consumer-smoke.mjs'],consumer);assert.match(smoked.stdout,/installed package verified/);
});
test('public Markdown relative links and #fragment anchors resolve',{timeout:20000},async t=>{
  const temp=await mkdtemp(join(tmpdir(),'relay-links-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const env={PATH:process.env.PATH,HOME:temp,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',npm_config_cache:join(temp,'cache')};
  const tracked=new Set((await exec('git',['ls-files','-z'],{cwd:root,env,maxBuffer:16*1024*1024})).stdout.split('\0').filter(Boolean));
  const packed=new Set(packEntry(JSON.parse((await exec('npm',['pack','--dry-run','--json','--ignore-scripts'],{cwd:root,env,timeout:20000,maxBuffer:4*1024*1024})).stdout)).files.map(f=>f.path));
  const mdFiles=[...tracked].filter(f=>f==='README.md'||f==='AGENTS.md'||f==='tools/README.md'||/^docs\/[^/]+\.md$/.test(f)||/^docs\/runbooks\/[^/]+\.md$/.test(f));
  assert.ok(mdFiles.length>=14,`expected at least 14 public Markdown files, got ${mdFiles.length}`);
  const slugCache=new Map();
  const slugsFor=async relPath=>{
    if(!slugCache.has(relPath))slugCache.set(relPath,extractSlugs(await readFile(join(root,relPath),'utf8')));
    return slugCache.get(relPath);
  };
  for(const src of mdFiles){
    const content=await readFile(join(root,src),'utf8');
    for(const rawTarget of extractLinks(content)){
      if(/^(?:https?:|mailto:)/i.test(rawTarget))continue;
      const [pathPart,fragment]=rawTarget.split('#',2);
      const targetRel=pathPart?relative(root,resolve(dirname(join(root,src)),pathPart)):src;
      assert.ok(tracked.has(targetRel)&&existsSync(join(root,targetRel)),`${src} links to missing or untracked target ${rawTarget} (${targetRel})`);
      if(packed.has(src)){
        assert.ok(packed.has(targetRel),`shipped ${src} links to unshipped target ${rawTarget} (${targetRel})`);
      }
      if(fragment!==undefined&&targetRel.endsWith('.md')){
        const slugs=await slugsFor(targetRel);
        assert.ok(slugs.has(fragment.toLowerCase()),`${src} links to missing #${fragment} in ${targetRel}`);
      }
    }
  }
});
// A git dependency is packed from a clone, which has no node_modules: what it bundles must be tracked.
test('a package packed from tracked files alone carries every dependency it bundles',{timeout:60000},async t=>{
  const temp=await mkdtemp(join(tmpdir(),'relay-clone-pack-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const env={PATH:process.env.PATH,HOME:temp,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',npm_config_cache:join(temp,'cache')},clone=join(temp,'clone');
  const tracked=(await exec('git',['ls-files','-z'],{cwd:root,env,maxBuffer:16*1024*1024})).stdout.split('\0').filter(Boolean);
  for(const file of tracked){if(!existsSync(join(root,file)))continue;await mkdir(dirname(join(clone,file)),{recursive:true});await copyFile(join(root,file),join(clone,file));}
  const listing=async cwd=>packEntry(JSON.parse((await exec('npm',['pack','--dry-run','--json','--ignore-scripts'],{cwd,env,timeout:20000,maxBuffer:4*1024*1024})).stdout)).files.map(f=>f.path).sort();
  const cloned=await listing(clone),rooted=await listing(root);
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')),bundled=pkg.bundledDependencies??pkg.bundleDependencies??[];
  for(const name of bundled)assert.ok(cloned.includes(`node_modules/${name}/package.json`),`bundled ${name} is missing from a package built from a clone`);
  assert.equal(typeof pkg.dependencies['jsonc-parser'],'string');
  assert.deepEqual(cloned,rooted);
});
