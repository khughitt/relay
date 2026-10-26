#!/usr/bin/env node
// Judge captured publications, not inferred terminal activity. Missing process proof and
// late root upserts may leave accepted duplicates; proven replacement must work immediately.
// Exit 0 pass, 1 registry/lifecycle failure, 2 incomplete switch evidence.
// Usage: judge-registry.mjs OUT_DIR
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const dir=process.argv[2];
if(!dir)throw new Error('usage: judge-registry.mjs OUT_DIR');
const log=join(dir,'log'),read=path=>JSON.parse(readFileSync(path,'utf8'));
const handled=readdirSync(log).filter(name=>/^\d+-[A-Za-z]+\.json$/.test(name)).sort().flatMap(name=>{
  const base=join(log,name.slice(0,-5));
  return existsSync(`${base}.reply`)?[{name,...read(join(log,name)),after:existsSync(`${base}.agents.json`)?read(`${base}.agents.json`):null}]:[];
});
const invalid=message=>{console.log(`INVALID: ${message}`);process.exit(2);};
const workerEvents=handled.filter(r=>typeof r.payload.agent_id==='string');
if(!workerEvents.length)invalid('no worker event reached relay');
const roots=[...new Set(handled.filter(r=>typeof r.payload.agent_id!=='string'&&r.event!=='SessionEnd').map(r=>`codex:${r.payload.session_id}`))];
const beforeQuitPath=join(dir,'before-quit-agents.json');
const switchCase=existsSync(join(dir,'case'))&&readFileSync(join(dir,'case'),'utf8').trim().startsWith('switch-');
if(switchCase&&roots.length<2)invalid('switch case has no second root evidence');
if(switchCase&&!existsSync(beforeQuitPath))invalid('switch case has no before-quit registry copy');
const sameProcess=(a,b)=>a!=null&&b!=null&&(a.platform!=='linux'||a.bootId!==null)
  &&a.platform===b.platform&&a.host===b.host&&a.bootId===b.bootId&&a.pid===b.pid&&a.start===b.start;
const failures=[],fail=message=>failures.push(message);
const handles=new Map(),starts=new Map(),retired=new Map(),lastRootEvent=new Map();
let previous={},beforeQuitRecord={},ended=false;
for(const [index,record]of handled.entries()){
  if(record.after===null){fail(`${record.name}: no registry copy after a relay event`);continue;}
  const rootId=`codex:${record.payload.session_id}`,rows=record.after.agents,root=rows[rootId]??null;
  if(typeof record.payload.agent_id==='string'){
    const workerId=`codex:${record.payload.agent_id}`,row=rows[workerId];
    const eventHandle=row?row.process:previous[workerId]?.process??handles.get(rootId);
    const replaced=!previous[rootId]&&Object.values(previous).some(a=>a.harness==='codex'&&a.scope==='session'&&sameProcess(a.process,eventHandle));
    if(record.event==='SubagentStop'&&replaced){if(row)fail(`${record.name}: completed replaced worker ${workerId} still published`);}
    else if(!row)fail(`${record.name}: no worker row`);
    if(row){
      if(row.scope!=='worker'||row.root!==rootId)fail(`${record.name}: worker row scope ${row.scope}, root ${row.root}`);
      if(root?.process&&row.process&&!isDeepStrictEqual(row.process,root.process))fail(`${record.name}: worker and root handles differ`);
    }
    if(!isDeepStrictEqual(root,previous[rootId]??null))fail(`${record.name}: a worker event changed the root row`);
  }else if(record.event==='SessionEnd'){
    ended=true;
    const left=Object.values(rows).filter(a=>a.id===rootId||a.root===rootId).map(a=>a.id);
    if(left.length)fail(`${record.name}: SessionEnd left ${left.join(', ')}`);
  }else{
    lastRootEvent.set(rootId,index);
    if(!root)fail(`${record.name}: no root row`);
    if(record.event==='SessionStart'){
      retired.delete(rootId);
      let matched=false;
      for(const [id,a]of Object.entries(previous)){
        if(a.harness!=='codex'||!sameProcess(a.process,root?.process)||id===rootId)continue;
        if(a.scope==='session'){
          matched=true;retired.set(id,index);
          if(rows[id])fail(`${record.name}: replaced root ${id} still published`);
        }else if(a.scope==='worker'&&a.root!==rootId){
          if(a.state==='done'){if(rows[id])fail(`${record.name}: completed worker ${id} still published`);}
          else if(!isDeepStrictEqual(rows[id],a))fail(`${record.name}: unfinished worker ${id} changed at replacement`);
        }
      }
      starts.set(rootId,{matched,index});
    }
  }
  for(const a of Object.values(rows))if(a.process)handles.set(a.id,a.process);
  previous=rows;
  if(record.event!=='SessionEnd')beforeQuitRecord={rows,index,starts:new Map(starts),retired:new Map(retired),lastRootEvent:new Map(lastRootEvent)};
}
if(!ended)fail('no SessionEnd publication captured');
if(existsSync(beforeQuitPath)){
  const rows=read(beforeQuitPath).agents;
  if(!isDeepStrictEqual(rows,beforeQuitRecord.rows))fail('before /quit, registry differs from the last non-end publication');
  for(const [i,id]of roots.entries()){
    if(!rows[id])continue;
    if((beforeQuitRecord.lastRootEvent?.get(id)??-1)>(beforeQuitRecord.retired?.get(id)??Infinity)){
      console.log(`ACCEPTED: root-recreated-after-replacement ${id}`);
    }else if(i>0&&roots.slice(0,i).some(old=>rows[old])){
      const start=beforeQuitRecord.starts?.get(id);
      if(!start)console.log(`ACCEPTED: replacement-not-proven-missing-start ${id}`);
      else if(!start.matched)console.log(`ACCEPTED: replacement-not-proven-process ${id}`);
    }
  }
}
const final=existsSync(join(dir,'final-agents.json'))?read(join(dir,'final-agents.json')):undefined;
if(final===undefined)fail('no final-agents.json (reap result)');
else if(final!==null&&Object.keys(final.agents).length)fail(`rows left after reap: ${Object.keys(final.agents).join(', ')}`);
for(const message of failures)console.log(`FAIL: ${message}`);
console.log(failures.length?`FAIL (${failures.length})`:`PASS: ${workerEvents.length} worker events, registry lifecycle checked, reap left none`);
process.exit(failures.length?1:0);
