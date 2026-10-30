import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {params,owner,blue} from './helpers/codex-question.js';
import {NOW,answerMessage} from './helpers/interaction.js';
const mod=await import('../src/routes/codex.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
function translated(p=params){assert.equal(typeof mod.toQuestion,'function');return mod.toQuestion(p,{id:randomUUID(),now:NOW,agentId:'codex:thread',cwd:'/workspace',project:'fixture'});}
test('Codex translates exact tuple/order/native question fields without exposing the native question mapping',()=>{
 const q=translated();assert.deepEqual(q.body.native,{harness:'codex',sessionId:'thread',callId:'["thread","turn","call"]'});assert.equal(q.body.expiresAt,NOW+23*3600*1000);assert.deepEqual(q.body.items,[{id:'q1',header:'Color',prompt:'Choose a color',type:'single',options:[{id:'o1',label:'Blue',description:'Cool'},{id:'o2',label:'Red',description:'Warm'}],recommended:null,allowOther:true,maxLength:null}]);assert.ok(!JSON.stringify(q).includes('color-id'));
});
test('Codex response mapping preserves exact native IDs and empty-root decline',()=>{
 const q=translated(),a=answerMessage(q,{values:{q1:{type:'choice',optionIds:['o1']}}});assert.deepEqual(mod.nativeAnswers(q,a.body,owner.items),blue);assert.deepEqual(mod.nativeAnswers(q,answerMessage(q,{outcome:'declined',values:{}}).body,owner.items),{answers:{}});assert.deepEqual(mod.nativeAnswers(q,answerMessage(q,{values:{q1:{type:'other',text:'Custom'}}}).body,owner.items),{answers:{'color-id':{answers:['Custom']}}});
 assert.throws(()=>mod.nativeAnswers(q,{...a.body,values:{q1:{type:'choice',optionIds:[]}}},owner.items));assert.throws(()=>mod.nativeAnswers(q,a.body,[{relayId:'q1',nativeId:'wrong'},{relayId:'q1',nativeId:'again'}]));
});
test('Codex translation refuses unsupported forms and public bounds without partial questions',()=>{
 const q=params.questions[0];for(const p of [{...params,isBlocking:false},{...params,questions:[{...q,isSecret:true}]},{...params,questions:[{...q,options:null}]},{...params,questions:[{...q,options:[]}]},{...params,questions:[q,q]},{...params,questions:[{...q,options:[q.options[0],q.options[0]]}]},{...params,questions:[{...q,header:'x'.repeat(17)}]},{...params,questions:[{...q,question:'x'.repeat(1001)}]},{...params,questions:[{...q,options:[{label:'x'.repeat(81)},q.options[1]]}]}])assert.throws(()=>translated(p));
});
test('multiple questions use stable IDs even when prompts are equal',()=>{
 const p={...params,questions:[params.questions[0],{...params.questions[0],id:'second'}]},q=translated(p),items=[...owner.items,{relayId:'q2',nativeId:'second'}];assert.deepEqual(q.body.items.map(i=>i.id),['q1','q2']);assert.deepEqual(mod.nativeAnswers(q,answerMessage(q,{values:{q1:{type:'choice',optionIds:['o1']},q2:{type:'choice',optionIds:['o2']}}}).body,items),{answers:{'color-id':{answers:['Blue']},second:{answers:['Red']}}});
});
