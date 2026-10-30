// @ts-check
import {createHash} from 'node:crypto';
import {openSync,closeSync,readSync,lstatSync,fstatSync,realpathSync,constants} from 'node:fs';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {setTimeout as pause} from 'node:timers/promises';
const baselines=new WeakMap(),orders=new WeakMap();
/** @param {string} code @returns {never} */
function fail(code){throw Object.assign(new Error(code),{code})}
/** @param {string} root @param {string} path */
const under=(root,path)=>{const r=relative(root,path);return r!==''&&r!=='..'&&!r.startsWith('../')&&!isAbsolute(r)};
/** @param {import("node:fs").Stats} a @param {import("node:fs").Stats} b */
const same=(a,b)=>(/** @type {const} */ (['dev','ino','uid','mode'])).every(k=>a[k]===b[k]);
/** @param {{path:string,sessionsDir:string,uid:number,maxLineBytes?:number,maxReadBytes?:number}} options */
export function openRolloutRecord({path,sessionsDir,uid,maxLineBytes=1024*1024,maxReadBytes=64*1024*1024}) {
 path=resolve(path);sessionsDir=realpathSync(sessionsDir);
 if(!under(sessionsDir,path)||!under(sessionsDir,resolve(realpathSync(dirname(path)),/** @type {string} */ (path.split('/').at(-1)))))fail('path-outside-sessions');
 if(!path.endsWith('.jsonl'))fail('compressed');
 const initial=lstatSync(path);if(initial.isSymbolicLink())fail('symlink');if(!initial.isFile())fail('not-regular');if(initial.uid!==uid)fail('owner');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 const identity=fstatSync(fd);if(!same(initial,identity)){closeSync(fd);fail('identity-changed')}
 /** @type {{calls:Map<string,{name:string,namespace:string|null}>,outputs:Map<string,string>,turnEnds:Map<string,string>,abortsWithoutTurn:number,state:string,code?:string}} */ const result={calls:new Map(),outputs:new Map(),turnEnds:new Map(),abortsWithoutTurn:0,state:'ok'};
 const seenAborts=new Map(),otherOutputs=new Map(),order={outputs:new Map(),ends:new Map()};baselines.set(result,seenAborts);orders.set(result,order);let sequence=0;
 let offset=0,tail=Buffer.alloc(0),closed=false,previousSize=identity.size;
 /** @param {string} code */ const unknown=code=>{result.state='unknown';result.code=code;tail=Buffer.alloc(0);return result};
 /** @param {Buffer} line */
 function accept(line) {
  const position=++sequence;let entry;try{entry=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line))}catch{fail('malformed-line')}
  if(!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.type!=='string')fail('malformed-line');
  const p=entry.payload;
  if(entry.type==='response_item'&&['function_call','function_call_output'].includes(p?.type)) {
   if(typeof p.call_id!=='string'||!p.call_id)fail('malformed-line');
   if(p.type==='function_call') {
    if(typeof p.name!=='string'||(p.namespace!=null&&typeof p.namespace!=='string'))fail('malformed-line');
    const value={name:p.name,namespace:p.namespace??null};
    if(result.calls.has(p.call_id))fail('malformed-line');
    result.calls.set(p.call_id,value);if(!seenAborts.has(p.call_id))seenAborts.set(p.call_id,result.abortsWithoutTurn);
   } else {
    const call=result.calls.get(p.call_id);
    if(!call||!Object.hasOwn(p,'output'))fail('malformed-line');
    if(call.name==='request_user_input'&&call.namespace===null) {
     if(typeof p.output!=='string')fail('malformed-line');
     if(result.outputs.has(p.call_id)&&result.outputs.get(p.call_id)!==p.output)fail('malformed-line');
     result.outputs.set(p.call_id,p.output);if(!order.outputs.has(p.call_id))order.outputs.set(p.call_id,position);
    }else {
     // Short outputs are guessable: fingerprints stay private and memory-only.
     const fingerprint=createHash('sha256').update(JSON.stringify(p.output),'utf8').digest('hex');
     if(otherOutputs.has(p.call_id)&&otherOutputs.get(p.call_id)!==fingerprint)fail('malformed-line');
     otherOutputs.set(p.call_id,fingerprint);
    }
   }
  }else if(entry.type==='event_msg'&&['task_complete','turn_aborted'].includes(p?.type)) {
   if(typeof p.turn_id==='string'&&p.turn_id){const kind=p.type==='task_complete'?'complete':'aborted';if(result.turnEnds.has(p.turn_id)&&result.turnEnds.get(p.turn_id)!==kind)fail('malformed-line');result.turnEnds.set(p.turn_id,kind);if(!order.ends.has(p.turn_id))order.ends.set(p.turn_id,position);}
   else if(p.type==='turn_aborted')result.abortsWithoutTurn++;
   else fail('malformed-line');
  }
 }
 return {
  get state(){return result.state},
  async read() {
   if(result.state!=='ok')return result;
   try {
    if(closed)return unknown('identity-changed');
    const current=lstatSync(path),held=fstatSync(fd);
    if(current.isSymbolicLink()||!same(identity,current)||!same(identity,held))return unknown('identity-changed');
    if(held.size<offset||held.size<previousSize)return unknown('shrunk');
    previousSize=held.size;
    if(held.size>maxReadBytes)return unknown('read-limit');
    while(offset<held.size) {
     const buffer=Buffer.alloc(Math.min(65536,held.size-offset));
     const n=readSync(fd,buffer,0,buffer.length,offset);if(n===0)return unknown('shrunk');offset+=n;
     const data=Buffer.concat([tail,buffer.subarray(0,n)]);let from=0,next;
     while((next=data.indexOf(10,from))!==-1) {if(next-from>maxLineBytes)return unknown('line-limit');accept(data.subarray(from,next));from=next+1}
     tail=Buffer.from(data.subarray(from));if(tail.length>maxLineBytes)return unknown('line-limit');
    }
    if(!same(identity,lstatSync(path))||fstatSync(fd).size<offset)return unknown('identity-changed');
    return result;
   }catch(caught){const e=/** @type {NodeJS.ErrnoException} */ (caught);return unknown(['line-limit','malformed-line'].includes(e.code??'')?/** @type {string} */ (e.code):'identity-changed')}
  },
  async close(){if(!closed){closed=true;closeSync(fd)}}
 };
}
/** @param {{read:()=>Promise<{state:string,calls:Map<string,{name:string,namespace:string|null}>}>}} record @param {string} itemId @param {{waitMs?:number,pollMs?:number,signal?:AbortSignal,now?:()=>number,sleep?:(ms:number)=>Promise<unknown>}} [options] */
export async function findProvenance(record,itemId,{waitMs=5000,pollMs=100,signal,now=performance.now.bind(performance),sleep}={}) {
 if(!Number.isFinite(waitMs)||waitMs<0||waitMs>5000||!Number.isFinite(pollMs)||pollMs<1||pollMs>100)fail('provenance-limit');
 const deadline=now()+waitMs;
 for(;;) {
  signal?.throwIfAborted();const r=await record.read();signal?.throwIfAborted();if(r.state!=='ok')return 'unknown';
  const c=r.calls.get(itemId);if(c)return c.name==='request_user_input'&&c.namespace===null?'built-in':'other';
  const left=deadline-now();if(left<=0)return 'unidentified';
  const ms=Math.min(pollMs,left);if(sleep)await sleep(ms);else await pause(ms,undefined,{signal});
 }
}
/** @param {unknown} text */
export function parseAnswers(text) {
 if(typeof text!=='string')return null;

 let value;try{value=JSON.parse(text)}catch{return null}
 /** @param {unknown} v @returns {v is Record<string,any>} */
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 if(!object(value)||Object.keys(value).length!==1||!object(value.answers)||Object.values(value.answers).some(v=>!object(v)||Object.keys(v).length!==1||!Array.isArray(v.answers)||v.answers.some((/** @type {unknown} */ a)=>typeof a!=='string')))return null;
 return value;
}
/** @param {any} record @param {string} itemId @param {unknown} savedAnswers */
export function matchReceipt(record,itemId,savedAnswers) {
 if(record.state!=='ok')return 'unknown';if(!record.outputs.has(itemId))return 'absent';
 const value=parseAnswers(record.outputs.get(itemId));if(value===null)return 'unknown';
 return isDeepStrictEqual(value,savedAnswers)?'consumed':'mismatch';
}
/** @param {any} record @param {any} tuple @param {{request?:any,terminal?:any}} [proof] */
export function callSettled(record,tuple,{request,terminal}={}) {
 const {threadId,turnId,itemId}=tuple;
 if(record.state!=='ok')return 'unknown';
 if(record.outputs.has(itemId)) {
  const output=record.outputs.get(itemId);
  if(parseAnswers(output)!==null)return 'answered';
  const call=record.calls.get(itemId),order=orders.get(record);
  const observed=typeof threadId==='string'&&threadId.length>0&&request?.method==='item/tool/requestUserInput'&&['threadId','turnId','itemId'].every(k=>typeof tuple[k]==='string'&&tuple[k].length>0&&request.params?.[k]===tuple[k]);
  const ended=terminal?.method==='turn/completed'&&terminal.params?.threadId===threadId&&terminal.params?.turn?.id===turnId&&['completed','interrupted','failed'].includes(terminal.params?.turn?.status);
  return call?.name==='request_user_input'&&call.namespace===null&&typeof output==='string'&&observed&&ended&&order?.ends.get(turnId)>order?.outputs.get(itemId)?'no-answer':'unknown';
 }
 if(record.turnEnds.has(turnId))return 'gone';
 return record.abortsWithoutTurn>(baselines.get(record)?.get(itemId)??0)?'unknown':'pending';
}
