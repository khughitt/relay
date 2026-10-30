import {questionMessage,NOW} from './interaction.js';
export const tuple={threadId:'thread',turnId:'turn',itemId:'call'};
export const params={...tuple,isBlocking:true,questions:[{id:'color-id',header:'Color',question:'Choose a color',isSecret:false,isOther:true,options:[{label:'Blue',description:'Cool'},{label:'Red',description:'Warm'}]}]};
export const owner={kind:'codex',tuple,generationBinding:{platform:'linux',host:'host',bootId:'00000000-0000-4000-8000-000000000000',pid:4242,start:'100'},items:[{relayId:'q1',nativeId:'color-id'}]};
export const blue={answers:{'color-id':{answers:['Blue']}}};
export const red={answers:{'color-id':{answers:['Red']}}};
export function codexQuestion(patch={}) {return questionMessage({createdAt:NOW,from:{kind:'agent',agentId:'codex:thread'},body:{native:{harness:'codex',sessionId:'thread',callId:JSON.stringify(['thread','turn','call'])},items:[{id:'q1',header:'Color',prompt:'Choose a color',type:'single',options:[{id:'o1',label:'Blue',description:'Cool'},{id:'o2',label:'Red',description:'Warm'}],recommended:null,allowOther:true,maxLength:null}]},...patch});}
