import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {sha256} from './source-proof.mjs';
export const PROTOCOL_FILES=['v2/TurnStatus.ts','v2/ThreadUnsubscribeParams.ts','v2/ThreadUnsubscribeResponse.ts','v2/ThreadUnsubscribeStatus.ts'];
export function proveProtocol(files){
 const text=name=>{const s=files['v2/'+name+'.ts'];if(typeof s!=='string'||Buffer.byteLength(s)>65536)throw Error('protocol-file');return s};
 const enumIs=(name,values)=>{const m=new RegExp('export type '+name+' = ([^;]+);').exec(text(name));return m&&JSON.stringify((m[1].match(/"[A-Za-z]+"/g)??[]).map(s=>JSON.parse(s)).sort())===JSON.stringify([...values].sort())};
 let passed=false;try{passed=enumIs('TurnStatus',['completed','interrupted','failed','inProgress'])&&enumIs('ThreadUnsubscribeStatus',['notLoaded','notSubscribed','unsubscribed'])&&/threadId:\s*string/.test(text('ThreadUnsubscribeParams'))&&/status:\s*ThreadUnsubscribeStatus/.test(text('ThreadUnsubscribeResponse'))}catch{}
 return {status:passed?'passed':'failed',files:PROTOCOL_FILES};
}
export function generateProtocol({bin,out,env}){
 mkdirSync(out,{mode:0o700});const output=execFileSync(bin,['app-server','generate-ts','--experimental','--out',out],{env,timeout:30000,maxBuffer:1024*1024});writeFileSync(join(out,'generation.log'),output,{mode:0o600});
 const files=Object.fromEntries(PROTOCOL_FILES.map(f=>[f,readFileSync(join(out,f),'utf8')]));const proof=proveProtocol(files);writeFileSync(join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600});if(proof.status!=='passed')throw Error('protocol-invariant-failed');
 return PROTOCOL_FILES.map(file=>({file:'protocol-0.166.0/'+file,sha256:sha256(files[file])}));
}
