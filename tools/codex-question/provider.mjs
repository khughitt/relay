import http from 'node:http';
export const responseCreated = id => ({type:'response.created',response:{id}});
export const functionCall = (callId,name,args,namespace) => ({type:'response.output_item.done',item:{type:'function_call',call_id:callId,name,arguments:typeof args==='string'?args:JSON.stringify(args),...(namespace===undefined?{}:{namespace})}});
export const assistantMessage = (id,text) => ({type:'response.output_item.done',item:{type:'message',role:'assistant',id,content:[{type:'output_text',text}]}});
export const completed = id => ({type:'response.completed',response:{id,usage:{input_tokens:0,input_tokens_details:null,output_tokens:0,output_tokens_details:null,total_tokens:0}}});

export async function startScriptedProvider({script,signal,maxBodyBytes=8*1024*1024}) {
 const requests=[]; let step=0, failure, closing;
 const server=http.createServer(async(req,res)=>{
  const path=req.url, index=requests.length;
  const refuse=(status,code)=>{requests.push({index,path,refused:code});req.resume();res.writeHead(status).end(code)};
  if(req.method!=='POST'||path!=='/v1/responses')return refuse(404,'path');
  if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')return refuse(415,'content-encoding');
  const chunks=[];let size=0;
  try {
   for await(const chunk of req) {size+=chunk.length;if(size>maxBodyBytes){refuse(413,'body-limit');return}chunks.push(chunk)}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return refuse(400,'json')}
   if(!body||!Array.isArray(body.tools??[])||!Array.isArray(body.input??[]))return refuse(400,'shape');
   if((body.tools??[]).some(t=>t?.namespace!=null&&typeof t.namespace!=='string'))return refuse(400,'shape');
   if((body.tools??[]).some(t=>t?.type==='namespace'&&(typeof t.name!=='string'||!Array.isArray(t.tools)||t.tools.some(c=>typeof c?.name!=='string'))))return refuse(400,'shape');
   const toolNames=(body.tools??[]).flatMap(t=>t?.type==='namespace'?t.tools.map(c=>({name:c.name,namespace:t.name})):typeof t?.name==='string'?[{name:t.name,namespace:t.namespace??null}]:[]);
   const r={index,path,toolNames,inputTypes:(body.input??[]).map(i=>i?.type).filter(t=>typeof t==='string'),functionCallOutputs:(body.input??[]).filter(i=>i?.type==='function_call_output'&&typeof i.call_id==='string'&&typeof i.output==='string').map(i=>({callId:i.call_id,output:i.output}))};
   requests.push(r);
   if(step>=script.length){failure=new Error('script-exhausted');res.writeHead(500).end('script-exhausted');return}
   const events=await script[step++](r);
   res.writeHead(200,{'content-type':'text/event-stream'});
   for(const event of events)res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
   res.end();
  }catch {failure??=new Error('provider-error');if(!res.headersSent)res.writeHead(500);res.end('provider-error')}
 });
 const stop=()=>closing??=new Promise(resolve=>{server.close(resolve);server.closeAllConnections()});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 signal?.addEventListener('abort',stop,{once:true});
 const port=server.address().port;
 if(signal?.aborted)await stop();
 return {baseUrl:`http://127.0.0.1:${port}/v1`,requests,async close(){signal?.removeEventListener('abort',stop);await stop();if(failure)throw failure}};
}
