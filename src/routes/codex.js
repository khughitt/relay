// @ts-check
import {relayError} from '../protocol.js';
import {validateMessage,checkAnswer} from '../interaction/message.js';
export {parseAnswers} from '../serve/codex/record.js';
export const EXPIRY_MS=23*3600*1000;
/** @param {import('../types.js').CodexTuple} tuple */
export const callId=({threadId,turnId,itemId})=>JSON.stringify([threadId,turnId,itemId]);
/** @param {any} params @param {{id:string,now:number,agentId:string,cwd:string,project?:string|null}} options @returns {import('../types.js').QuestionMessage} */
export function toQuestion(params,{id,now,agentId,cwd,project=null}) {
  const qs=params?.questions;
  if(!params||['threadId','turnId','itemId'].some(k=>typeof params[k]!=='string'||!params[k])||params.isBlocking!==true||!Array.isArray(qs)||qs.length<1||qs.length>4||new Set(qs.map(q=>q?.id)).size!==qs.length)throw relayError('UNSUPPORTED_FORM','unsupported Codex question');
  const items=qs.map((q,i)=>{
    if(typeof q?.id!=='string'||!q.id||q.id.length>256||q.isSecret!==false||typeof q.isOther!=='boolean'||!Array.isArray(q.options)||new Set(q.options.map((/** @type {any} */ o)=>o?.label)).size!==q.options.length)throw relayError('UNSUPPORTED_FORM','unsupported Codex question');
    return {id:`q${i+1}`,header:q.header,prompt:q.question,type:'single',options:q.options.map((/** @type {any} */ o,/** @type {number} */ j)=>({id:`o${j+1}`,label:o?.label,description:o?.description??null})),recommended:null,allowOther:q.isOther,maxLength:null};
  });
  return /** @type {import('../types.js').QuestionMessage} */ (validateMessage({schema:1,id,kind:'question',correlationId:id,from:{kind:'agent',agentId},to:{kind:'user'},createdAt:now,context:{project,cwd,taskId:null},body:{class:'clarification',expiresAt:now+EXPIRY_MS,native:{harness:'codex',sessionId:params.threadId,callId:callId(params)},artifact:null,supersedes:null,items}}));
}
/** @param {import('../types.js').QuestionMessage} question @param {import('../types.js').Answer} answer @param {import('../types.js').CodexOwner['items']} items @returns {import('../types.js').CodexAnswers} */
export function nativeAnswers(question,answer,items) {
  checkAnswer(question.body,answer);
  if(items.length!==question.body.items.length||items.some((m,i)=>m.relayId!==question.body.items[i].id||typeof m.nativeId!=='string'||!m.nativeId)||new Set(items.map(m=>m.nativeId)).size!==items.length)throw relayError('INVALID_INPUT','invalid Codex question mapping');
  if(answer.outcome==='declined')return {answers:{}};
  return {answers:Object.fromEntries(items.map((m,i)=>{
    const item=question.body.items[i],v=answer.values[m.relayId];
    const text=v.type==='choice'?item.options.find(o=>o.id===v.optionIds[0])?.label:v.type==='other'?v.text:null;
    if(typeof text!=='string')throw relayError('INVALID_ANSWER','unsupported Codex response');
    return [m.nativeId,{answers:[text]}];
  }))};
}
