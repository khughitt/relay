// @ts-check
import {isDeepStrictEqual} from 'node:util';
import {validateHandle,relayError} from '../../protocol.js';
import {callId} from '../../routes/codex.js';
/** @param {unknown} v @returns {v is Record<string,any>} */
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
/** @param {Record<string,any>} v @param {string[]} names */
const exact=(v,names)=>Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
/** @param {unknown} value @param {import('../../types.js').QuestionMessage} question @returns {import('../../types.js').CodexOwner} */
export function validateOwner(value,question) {
  const invalid=()=>{throw relayError('INVALID_OWNER','invalid Codex owner');};
  if(!object(value)||!exact(value,['kind','tuple','generationBinding','items'])||value.kind!=='codex'||!object(value.tuple)||!exact(value.tuple,['threadId','turnId','itemId']))return invalid();
  if(Object.values(value.tuple).some(v=>typeof v!=='string'||v.length<1||v.length>256))return invalid();
  const handle=validateHandle(value.generationBinding);
  if(!isDeepStrictEqual(handle,value.generationBinding)||handle.platform==='linux'&&handle.bootId===null)return invalid();
  if(question.body.native?.harness!=='codex'||question.body.native.sessionId!==value.tuple.threadId||question.body.native.callId!==callId(/** @type {import('../../types.js').CodexTuple} */ (value.tuple)))return invalid();
  if(!Array.isArray(value.items)||value.items.length!==question.body.items.length||value.items.some((m,i)=>!object(m)||!exact(m,['relayId','nativeId'])||m.relayId!==question.body.items[i].id||typeof m.nativeId!=='string'||!m.nativeId||m.nativeId.length>256)||new Set(value.items.map(m=>m.nativeId)).size!==value.items.length)return invalid();
  return /** @type {import('../../types.js').CodexOwner} */ (structuredClone(value));
}
