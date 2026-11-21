// Private native observation cases and their judgment; never runtime policy.
// Task 1 observes how Codex 0.169.0 lays out a tool call's processes, to choose the
// resolver's call-binding rule. A case is `observed` or `incomplete`; it never passes or fails.
import {createProcessOps} from '../../src/bus/proc.js';

// orphan-setsid (beyond the plan's points) escapes a process-group kill, as background work does, so the adopter shows.
const DRIVERS={
 'app-server':{sandboxed:['call','second-call','orphan-after-parent-exit','orphan-setsid','cross-turn-shell'],unsandboxed:['call','orphan-after-parent-exit','orphan-setsid']},
 exec:{sandboxed:['call','orphan-after-parent-exit','orphan-setsid'],unsandboxed:['call','orphan-after-parent-exit','orphan-setsid']},
 // The TUI's commands run under a detached managed app-server daemon, so a setsid orphan's adopter
 // shows whether that daemon is a subreaper even though pty.py is one.
 tui:{sandboxed:['call','second-call','user-escape'],unsandboxed:['orphan-setsid']},
};
export const shapeCases=Object.entries(DRIVERS).flatMap(([driver,modes])=>Object.entries(modes).flatMap(([mode,points])=>
 points.map(point=>({id:`${driver}-${mode}-${point}`,driver,point,sandboxed:mode==='sandboxed'}))));

/** Dumps each point must produce, as `step` numbers. */
const ORPHANS=['orphan-after-parent-exit','orphan-setsid'];
const EXPECTED={call:[1],'second-call':[1,2],'orphan-after-parent-exit':[1],'orphan-setsid':[1],'cross-turn-shell':[2],'user-escape':[1]};
/** The orphan may die with its parent; that is an observation once the driver waited this long. */
export const ORPHAN_WAIT_MS=8000;
export const MARGIN_MS=1500;

/** The resolver's own start interval (src/bus/proc.js startedAtMs) from a dump's uptime triple. */
export function startInterval(row,uptime){
 const reads=[uptime.wallBeforeMs,uptime.wallAfterMs];
 return createProcessOps({platform:'linux',readText:()=>uptime.uptimeText,now:()=>reads.shift()}).startedAtMs({starttime:String(row.start)});
}

/** @returns {{status:'observed'|'incomplete',reason?:string,outcome?:string,dumps:object[]}} */
export function judgeShape(def,o){
 const incomplete=(reason,dumps=[])=>({status:'incomplete',reason,dumps});
 if(!o?.complete)return incomplete('driver-incomplete');
 if(o.cleanup?.survivors?.length!==0)return incomplete('survivors');
 if(!o.contexts?.length)return incomplete('no-turn-context');
 if(o.contexts.some(c=>(c.fileSystem==='restricted')!==def.sandboxed))return incomplete('sandbox-mismatch');
 const dumps=[];
 for(const step of EXPECTED[def.point]){
  const point=def.point==='user-escape'&&step===1?['call','user-escape']:[def.point];
  for(const p of point){
   const found=(o.dumps??[]).filter(d=>d.point===p&&d.step===step);
   if(found.length===0&&ORPHANS.includes(p)&&o.orphanWaitMs>=ORPHAN_WAIT_MS)return {status:'observed',outcome:o.orphanStarted?'orphan-killed-before-dump':'orphan-never-started',dumps};
   if(found.length!==1)return incomplete(`dump-count-${p}-${step}`,dumps);
   const d=found[0];
   if(!Array.isArray(d.chain)||d.chain.length===0)return incomplete('missing-chain',dumps);
   if(d.clkTck!==100)return incomplete('clock-ticks',dumps);
   dumps.push(measure(d,o.contexts));
  }
 }
 for(const d of dumps){
  if(d.nearest===null)continue;
  if(['call','second-call'].includes(d.point)&&!(d.margins.freshMs>=MARGIN_MS))return incomplete('fresh-margin-short',dumps);
  if(d.point==='cross-turn-shell'&&!(d.margins.shellLeadMs>=MARGIN_MS))return incomplete('shell-lead-margin-short',dumps);
 }
 return {status:'observed',dumps};
}

/** Adds the nearest `codex` (as the resolver finds it), its call process and the named margins. */
export function measure(d,contexts){
 const nearest=d.chain.findIndex((row,i)=>i>0&&row.comm==='codex');
 if(nearest<1)return {...d,nearest:null,callIndex:null,margins:{}};
 const call=startInterval(d.chain[nearest-1],d.uptime),self=startInterval(d,d.uptime);
 const turns=contexts.filter(c=>c.at<=d.uptime.wallBeforeMs),turn=turns.at(-1);
 const margins={};
 if(turn){
  if(d.point==='cross-turn-shell'){margins.shellLeadMs=turn.at-call.hi;margins.childLagMs=self.lo-turn.at;}
  else margins.freshMs=call.lo-turn.at;
 }
 return {...d,nearest,callIndex:nearest-1,callInterval:call,turnAt:turn?.at??null,margins};
}

// Task 4: native qualification, one case per spec r10 item (Qualification, "Native qualification
// before cutover"). `tasks` marks a case whose verdict also needs the tasks-ab4fcf build's records.
// spawn_agent accepts only catalog model names; the worker still uses the private scripted provider.
export const EXPECTED_MODEL='mock-model', SWITCHED_MODEL='model-b', WORKER_MODEL='gpt-6-astra', INNER_MODEL='inner-model';
export const qualificationItems=[
 {id:'item-1-app-server',item:1,driver:'app-server',sandboxed:true,tasks:false},
 {id:'item-1-tui',item:1,driver:'tui',sandboxed:true,tasks:false},
 // Review Focus 3: a relay without source.nearest must degrade through tasks to bare codex with a warning.
 {id:'item-1-base-relay',item:1,driver:'app-server',sandboxed:true,tasks:true,variant:'base-relay'},
 {id:'item-2',item:2,driver:'app-server',sandboxed:true,tasks:false},
 {id:'item-3',item:3,driver:'app-server',sandboxed:true,tasks:false},
 {id:'item-4',item:4,driver:'app-server',sandboxed:false,tasks:true},
 {id:'item-4-sandboxed',item:4,driver:'app-server',sandboxed:true,tasks:true,variant:'sandbox-limit'},
 {id:'item-5',item:5,driver:'app-server',sandboxed:true,tasks:true},
 {id:'item-6',item:6,driver:'app-server',sandboxed:false,tasks:false},
 {id:'item-7',item:7,driver:'app-server',sandboxed:true,tasks:true},
 {id:'item-8',item:8,driver:'tui',sandboxed:true,tasks:false},
 {id:'item-9',item:9,driver:'app-server',sandboxed:true,tasks:true},
 {id:'item-9-tui',item:9,driver:'tui',sandboxed:true,tasks:false,variant:'cross-check'},
];
const result=(status,reason,extra={})=>({status,...(reason===undefined?{}:{reason}),...extra});
const dumpOf=(o,point)=>(o.dumps??[]).find(d=>d.point===point);
const verifiedAs=(a,model)=>a?.verified===true&&a.model===model&&a.source?.nearest==='codex';

/** The relay side of an item: the resolver's answer and the process evidence. */
function relaySide(def,o){
 const a=o.answers??{};
 switch(def.item){
  case 1:
   if(!a.call)return result('incomplete','no-answer');
   if(def.variant==='base-relay')return result('passed');
   return verifiedAs(a.call,o.expectModel??EXPECTED_MODEL)?result('passed'):result('failed',a.call.verified?'wrong-model-or-nearest':`unverified-${a.call.reason}`);
  case 2:
   if(!a.late)return result('incomplete','no-answer');
   return verifiedAs(a.late,SWITCHED_MODEL)?result('passed'):result('failed',a.late.verified?'stale-model':`unverified-${a.late.reason}`);
  case 3: {
   if(!a.worker)return o.undrivable?.length?result('unsupported',o.undrivable.map(x=>x.undrivable).join(',')):result('incomplete','no-worker-answer');
   const parent=o.parentThread??a.call?.source?.thread;
   if(!verifiedAs(a.worker,WORKER_MODEL))return result('failed',a.worker.verified?'parent-or-wrong-model':`unverified-${a.worker.reason}`);
   return a.worker.source.thread===parent?result('failed','parent-thread'):result('passed');
  }
  case 4: {
   const d=dumpOf(o,'job');
   if(def.variant==='sandbox-limit')return result('passed',undefined,{recorded:{answer:a.job??null,dumped:!!d,started:o.jobStarted??null}});
   if(!d||!Array.isArray(d.chain)||d.chain.some(r=>r.comm==='codex'))return result('incomplete','reparenting-unconfirmed');
   if(!a.job)return result('incomplete','no-answer');
   return a.job.verified===false&&a.job.source?.nearest===null?result('passed'):result('failed',a.job.verified?'verified-reparented':`nearest-${a.job.source?.nearest}`);
  }
  case 5: return result('passed');
  case 6:
   if(!a.inner)return result('incomplete','no-answer');
   if(!verifiedAs(a.inner,INNER_MODEL))return result('failed',a.inner.verified?'outer-or-wrong-model':`unverified-${a.inner.reason}`);
   return a.inner.source.thread===(o.parentThread??null)?result('failed','outer-thread'):result('passed');
  case 7: {
   if(!a.late)return result('incomplete','no-answer');
   if(a.late.verified)return result('failed','verified-newer-model');
   if(a.late.reason!=='earlier-turn'||a.late.source?.nearest!=='codex')return result('failed',`unverified-${a.late.reason}`);
   const d=dumpOf(o,'late');if(!d)return result('incomplete','no-dump');
   const m=measure({...d,point:'cross-turn-shell'},o.contexts);
   return m.margins.shellLeadMs>=MARGIN_MS?result('passed',undefined,{margins:m.margins}):result('incomplete','shell-lead-margin-short',{margins:m.margins});
  }
  case 8: return a.escape?result('passed',undefined,{recorded:{verified:a.escape.verified,reason:a.escape.reason,model:a.escape.model,nearest:a.escape.source?.nearest??null}}):result('incomplete','no-answer');
  case 9: {
   if(a.late?.verified)return result('failed','verified-newer-model');
   const d=dumpOf(o,'late');
   if(!d)return result('unsupported','adopted-child-not-observed');
   const adopter=d.chain?.[1];
   if(d.ppid!==1||adopter?.comm!=='codex'||!adopter.isNamespaceInit)return result('unsupported','no-adoption-evidence');
   if(!a.late)return result('incomplete','no-answer');
   if(a.late.source?.nearest!=='codex')return result('unsupported',`nearest-${a.late.source?.nearest}`);
   if(!['earlier-turn','unbound-call'].includes(a.late.reason))return result('failed',`unverified-${a.late.reason}`);
   const lag=startInterval(d,d.uptime).lo-(o.contexts.filter(c=>c.at<=d.uptime.wallBeforeMs).at(-1)?.at??Infinity);
   return lag>=MARGIN_MS?result('passed',undefined,{margins:{childLagMs:lag}}):result('incomplete','child-lag-margin-short',{margins:{childLagMs:lag}});
  }
  default: return result('incomplete','unknown-item');
 }
}
/** The tasks side: what the tasks-ab4fcf build recorded (spec binding interface items 4-7). */
function tasksSide(def,t){
 const add=t.add??{},done=t.done??{},warned=re=>(add.warnings??[]).some(w=>re.test(w));
 const bare=add.agent==='codex'&&!done.model;
 if(def.variant==='sandbox-limit')return result('passed',undefined,{recorded:t});
 if(!t.add)return result('incomplete','tasks-not-run');
 switch(def.item){
  case 1: return add.agent==='codex'&&(add.warnings??[]).length>0?result('passed'):result('failed','base-relay-not-degraded');
  case 4: return bare&&warned(/no-harness/)?result('passed'):result('failed','tasks-not-bare-no-harness');
  case 5: return add.agent===`codex/${EXPECTED_MODEL}@low`&&done.model===EXPECTED_MODEL?result('passed'):result('failed','tasks-stamp-mismatch');
  case 7: return bare&&warned(/^model unverified: earlier-turn$/)?result('passed'):result('failed','tasks-not-bare-earlier-turn');
  case 9: return bare&&warned(/^model unverified: (earlier-turn|unbound-call)$/)?result('passed'):result('failed',add.agent===`codex/${SWITCHED_MODEL}@low`?'tasks-recorded-newer-model':'tasks-not-bare');
  default: return result('incomplete','no-tasks-judge');
 }
}
/** @returns {{status:'passed'|'failed'|'unsupported'|'incomplete',reason?:string,relaySide?:string}} */
export function judgeItem(def,o){
 if(!o?.complete)return result('incomplete','driver-incomplete');
 if(o.cleanup?.survivors?.length!==0)return result('incomplete','survivors');
 if(!o.contexts?.length)return result('incomplete','no-turn-context');
 if(o.contexts.some(c=>(c.fileSystem==='restricted')!==def.sandboxed))return result('incomplete','sandbox-mismatch');
 const relay=relaySide(def,o);
 if(relay.status!=='passed'||!def.tasks)return relay;
 // The relay side's evidence (margins, recorded values) stays on every tasks outcome.
 const {status:_s,reason:_r,...evidence}=relay,carry={relaySide:'passed',...evidence};
 if(!o.tasks)return {...result('incomplete','tasks-pending'),...carry};
 const shim=o.shim,inShim=p=>typeof p==='string'&&typeof shim?.dir==='string'&&p.startsWith(shim.dir+'/');
 if(!inShim(shim?.relay)||!inShim(shim?.tasks))return {...result('incomplete','no-fixture-shim'),...carry};
 const t=tasksSide(def,o.tasks);
 return {...t,...carry,...(t.recorded?{recorded:t.recorded}:{})};
}
