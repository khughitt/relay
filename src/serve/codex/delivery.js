// @ts-check
import {isDeepStrictEqual} from 'node:util';
/** @param {string} code @returns {never} */
function fail(code){throw Error(code)}
/** @param {unknown} v @returns {v is Record<string,any>} */
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
/** @param {any} t */
const tupleOf=t=>{if(!object(t)||['threadId','turnId','itemId'].some(k=>typeof t[k]!=='string'||!t[k]))fail('request-tuple');return {threadId:t.threadId,turnId:t.turnId,itemId:t.itemId}};
/** @param {any} t */
const slot=t=>JSON.stringify([t.threadId,t.turnId]);
/** @param {any} t */
const key=t=>JSON.stringify([t.threadId,t.turnId,t.itemId]);
/** @param {Record<string,any>} params */
function supported(params) {
 const qs=params.questions;
 return params.isBlocking===true&&Array.isArray(qs)&&qs.length>0&&new Set(qs.map((/** @type {any} */ q)=>q?.id)).size===qs.length&&qs.every((/** @type {any} */ q)=>object(q)&&typeof q.id==='string'&&q.id.length>0&&q.isSecret===false&&typeof q.isOther==='boolean'&&Array.isArray(q.options)&&q.options.length>0&&new Set(q.options.map((/** @type {any} */ o)=>o?.label)).size===q.options.length&&q.options.every((/** @type {any} */ o)=>object(o)&&typeof o.label==='string'&&o.label.length>0));
}
/** @param {Record<string,any>} params @param {unknown} body */
function validate(params,body) {
 if(!supported(params))fail('unsupported-request');
 if(!object(body)||Object.keys(body).length!==1||!object(body.answers))fail('answer-shape');
 const ids=Object.keys(body.answers);if(ids.length===0)return;
 if(ids.length!==params.questions.length||ids.some(id=>!params.questions.some((/** @type {any} */ q)=>q.id===id)))fail('answer-ids');
 for(const q of params.questions) {
  const a=body.answers[q.id];if(!object(a)||Object.keys(a).length!==1||!Array.isArray(a.answers)||a.answers.length!==1||typeof a.answers[0]!=='string'||(!q.isOther&&!q.options.some((/** @type {any} */ o)=>o.label===a.answers[0])))fail('answer-value');
 }
}
/** @param {{send:(message:any,beforeWrite:()=>void)=>Promise<void>,onSuperseded:(tuple:any)=>Promise<unknown>}} options */
export function createRequestDelivery({send,onSuperseded}) {
 /** @type {Map<string,any>} */ const current=new Map();const retired=new Set();let chain=Promise.resolve(),closed=false;
 /** @param {()=>any} fn */
 const queue=fn=>{const work=chain.then(fn);chain=work.catch(()=>{});return work};
 /** @param {any} t */
 const owned=t=>{const entry=current.get(slot(t));if(closed||!entry||entry.revoked||key(entry.tuple)!==key(t))fail('revoked');return entry};
 return {
  /** @param {any} request */
  async observe(request) {
   const tuple=tupleOf(request?.params);
   if(request.method!=='item/tool/requestUserInput'||!(typeof request.id==='string'||Number.isSafeInteger(request.id)))fail('request-envelope');
   if(closed)fail('closed');
   const address=slot(tuple),id=key(tuple),old=current.get(address);
   if(old&&key(old.tuple)===id&&old.decided&&!old.admitted){old.rpcId=request.id;return chain;}
   const projected={questions:request.params.questions,isBlocking:request.params.isBlocking};
   if(Buffer.byteLength(JSON.stringify(projected))>1024*1024||(!old&&current.size>=4096)||retired.size>=4096){if(old)old.revoked=true;fail('request-limit');}
   const immutable=structuredClone(projected);
   if(retired.has(id))fail('revoked');
   if(old&&key(old.tuple)===id) {
    if(!isDeepStrictEqual(old.immutable,immutable)){old.revoked=true;retired.add(id);fail('request-replay-conflict')}
    old.rpcId=request.id;return chain;
   }
   if(old){old.revoked=true;retired.add(key(old.tuple))}
   const entry={tuple,immutable,rpcId:request.id,admitted:false,decided:false,ready:false,revoked:false};current.set(address,entry);
   return queue(async()=>{
    try{if(old)await onSuperseded({...old.tuple});if(!closed&&!entry.revoked)entry.ready=true}
    catch(e){entry.revoked=true;retired.add(id);throw e}
   });
  },
  /** @param {any} tuple @param {boolean} eligible */
  async admit(tuple,eligible) {
   tuple=tupleOf(tuple);await chain;const entry=owned(tuple);if(!entry.ready)fail('revoked');
   if(entry.decided&&!entry.admitted)return false;
   if(eligible&&!supported(entry.immutable))fail('unsupported-request');entry.admitted=eligible===true;entry.decided=true;if(!entry.admitted)entry.immutable=null;return entry.admitted;
  },
  /** @param {any} tuple */
  resolved(tuple) {tuple=tupleOf(tuple);const entry=current.get(slot(tuple));if(entry&&key(entry.tuple)===key(tuple)){entry.revoked=true;retired.add(key(tuple))}},
  /** @param {any} tuple @param {unknown} body */
  async sendAnswer(tuple,body) {
   tuple=tupleOf(tuple);const entry=owned(tuple);if(!entry.admitted)fail('revoked');validate(entry.immutable,body);const result=structuredClone(body);
   return queue(()=>{const rpcId=entry.rpcId;const beforeWrite=()=>{const now=owned(tuple);if(now!==entry||!now.admitted||!now.ready||now.rpcId!==rpcId)fail('revoked')};beforeWrite();return send({id:rpcId,result},beforeWrite)});
  },
  close() {closed=true;for(const entry of current.values())entry.revoked=true}
 };
}
