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
function measure(d,contexts){
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
