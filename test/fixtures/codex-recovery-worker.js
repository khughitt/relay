import {readFile} from 'node:fs/promises';
import {openInbox} from '../../src/serve/inbox.js';
import {openCodexConnector} from '../../src/serve/codex/connector.js';
import {expectAnswers} from '../../src/routes/index.js';
import {connectRpc} from '../../src/serve/codex/rpc.js';
import {answerMessage} from '../helpers/interaction.js';
const saved=JSON.parse(await readFile(process.argv[2],'utf8')),stop=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>stop.abort());
const {inbox,rejected}=await openInbox({stateDir:saved.stateDir,expectAnswers,onCommit:entry=>{if(saved.crashAt==='receipt'&&entry.state==='consumed')process.send?.({phase:'receipt',entry})}});
const connect=async options=>{const rpc=await connectRpc(options),send=rpc.send.bind(rpc);rpc.send=async(m,before)=>{
 if(m?.result&&saved.crashAt==='handed'){process.send?.({phase:'handed',entry:inbox.retained()[0]});await new Promise(resolve=>stop.signal.addEventListener('abort',resolve,{once:true}));throw Error('stopped');}
 await send(m,before);if(m?.result){process.send?.({phase:'wire',entry:inbox.retained()[0]});if(saved.crashAt==='wire')await new Promise(resolve=>stop.signal.addEventListener('abort',resolve,{once:true}));}
};return rpc};
const connector=await openCodexConnector({config:saved.config,inbox,processOps:{probe:()=>({status:'alive'})},identity:async()=>saved.handle,readAgents:async()=>saved.rows,signal:stop.signal,pollMs:20,replayMs:100,connect,log:()=>{}});
const timer=setTimeout(()=>stop.abort(),5000);let interval;
try{
 let answering=false;const result=await new Promise(resolve=>{
  const abort=()=>resolve(null);stop.signal.addEventListener('abort',abort,{once:true});
  interval=setInterval(()=>{const entry=inbox.retained()[0];if(saved.autoAnswer&&entry?.state==='pending'&&!answering){answering=true;const a=answerMessage(entry.question,{answerId:saved.answerId,values:{q1:{type:'choice',optionIds:['o1']}}});void inbox.answer(entry.id,a).catch(()=>stop.abort());}if(!saved.crashAt&&entry?.state===(saved.want??'consumed')){stop.signal.removeEventListener('abort',abort);resolve(entry);}},10);
 });
 if(!result||rejected.length)process.exitCode=1;
 process.send?.({entry:result,rejected:rejected.length});
}finally{clearTimeout(timer);clearInterval(interval);stop.abort();await connector.close();process.disconnect?.();}
