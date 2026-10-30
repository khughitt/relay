// @ts-check
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
const MiB=1024*1024;
/** @param {string} code @returns {never} */
function reject(code){throw new Error(code)}
/** @param {Buffer} bytes */
const utf8=bytes=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{reject('utf8-invalid')}};
/** @typedef {{peerLimitBytes:number,sendText:(text:string,beforeWrite?:()=>void)=>Promise<void>,close:()=>Promise<void>}} Wire */
/** @param {{socketPath:string,signal?:AbortSignal,onText:(text:string)=>void,onFailure?:(code:string)=>void,maxIncomingBytes?:number}} options @returns {Promise<Wire>} */
export function connectUnixWebSocket({socketPath,signal,onText,onFailure,maxIncomingBytes=8*MiB}) {
 if(!Number.isSafeInteger(maxIncomingBytes)||maxIncomingBytes<1||maxIncomingBytes>8*MiB) return Promise.reject(new Error('invalid-incoming-limit'));
 if(signal?.aborted)return Promise.reject(new Error('interrupted'));
 return new Promise((resolve,rejectConnect)=>{
  const key=randomBytes(16).toString('base64'),expected=createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const socket=net.createConnection({path:socketPath});let buffer=Buffer.alloc(0),ready=false,failed=false,closing=false,peerLimitBytes=0;
  /** @type {Buffer[]} */ let fragments=[]; let fragmentBytes=0,fragmentOpen=false;
  /** @type {NodeJS.Timeout|undefined} */ let partialTimer;
  /** @type {NodeJS.Timeout|undefined} */ let closeTimer;
  /** @type {Promise<void>|undefined} */ let closePromise;
  /** @type {(()=>void)|undefined} */ let resolveClose;
  let pendingBytes=0;/** @type {Set<(error:Error)=>void>} */ const writes=new Set();let writeChain=Promise.resolve();
  const handshakeTimer=setTimeout(()=>fail('upgrade-deadline'),15000);
  const aborted=()=>fail('interrupted');signal?.addEventListener('abort',aborted,{once:true});
  function clearTimers(){clearTimeout(handshakeTimer);clearTimeout(partialTimer);clearTimeout(closeTimer)}
  /** @param {string} code */
  function fail(code){
   if(failed)return;failed=true;clearTimers();signal?.removeEventListener('abort',aborted);
   buffer=Buffer.alloc(0);fragments=[];fragmentBytes=0;
   for(const w of writes)w(new Error(code));writes.clear();
   socket.destroy();rejectConnect(new Error(code));
   try{onFailure?.(code)}catch{}
   resolveClose?.();
  }
  /** @param {Buffer} payload @param {number} op */
  function encode(payload,op){
   const n=payload.length,extra=n<126?0:n<=65535?2:8,header=Buffer.alloc(2+extra+4);
   header[0]=128|op;header[1]=128|(extra===0?n:extra===2?126:127);
   if(extra===2)header.writeUInt16BE(n,2);if(extra===8)header.writeBigUInt64BE(BigInt(n),2);
   const mask=randomBytes(4);mask.copy(header,2+extra);const bytes=Buffer.alloc(n);
   for(let i=0;i<n;i++)bytes[i]=payload[i]^mask[i%4];return Buffer.concat([header,bytes]);
  }
  /** @param {Buffer} payload @param {number} op @param {(()=>void)|undefined} [beforeWrite] @returns {Promise<void>} */
  function write(payload,op,beforeWrite){
   if(failed||socket.destroyed)return Promise.reject(new Error('closed'));
   if(pendingBytes+payload.length>MiB)return Promise.reject(new Error('outbound-buffer-limit'));
   pendingBytes+=payload.length;
   const run=writeChain.then(()=>new Promise((res,rej)=>{
    if(failed||socket.destroyed){rej(new Error('closed'));return}
    try{beforeWrite?.()}catch(e){rej(e);return}
    const bytes=encode(payload,op);let callbackDone=false,drained=true,done=false;
    /** @param {Error|null} [error] */ const finish=error=>{if(done)return;if(!error&&(!callbackDone||!drained))return;done=true;writes.delete(cancel);socket.removeListener('drain',drain);error?rej(error):res(undefined)};
    /** @param {Error} error */ const cancel=error=>finish(error),drain=()=>{drained=true;finish()};writes.add(cancel);
    try{drained=socket.write(bytes,error=>{callbackDone=true;finish(error?new Error('socket-write'):null)});if(!drained)socket.once('drain',drain)}catch{finish(new Error('capture-or-write-failed'));fail('capture-or-write-failed')}
   }));
   const result=run.finally(()=>{pendingBytes-=payload.length}).then(()=>{});writeChain=result.catch(()=>{});return result;
  }
  function close(){
   if(closePromise)return closePromise;
   closing=true;closePromise=new Promise(r=>resolveClose=r);
   if(failed||socket.destroyed){resolveClose?.();return closePromise}
   closeTimer=setTimeout(()=>{socket.destroy();resolveClose?.()},2000);
   write(Buffer.from([3,232]),8).catch(()=>{socket.destroy();resolveClose?.()});return closePromise;
  }
  function upgrade(){
   const end=buffer.indexOf('\r\n\r\n');
   if(end<0){if(buffer.length>16384)reject('upgrade-limit');return false}
   if(end+4>16384)reject('upgrade-limit');
   const lines=buffer.subarray(0,end).toString('latin1').split('\r\n');
   if(!/^HTTP\/1\.1 101(?: |$)/.test(lines.shift()??''))reject('upgrade-invalid');
   const headers=new Map();
   for(const line of lines){const match=/^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\r\n]*)$/.exec(line);if(!match)reject('upgrade-invalid');
    const name=match[1].toLowerCase();if(headers.has(name))reject('upgrade-invalid');headers.set(name,match[2].trim());}
   /** @param {string} name */ const tokens=name=>(headers.get(name)??'').toLowerCase().split(',').map((/** @type {string} */ s)=>s.trim());
   if(!tokens('upgrade').includes('websocket')||!tokens('connection').includes('upgrade')||headers.get('sec-websocket-accept')!==expected||headers.has('sec-websocket-extensions')||headers.has('sec-websocket-protocol'))reject('upgrade-invalid');
   const limit=headers.get('x-codex-websocket-max-unfragmented-message-bytes');
   if(!/^[1-9][0-9]*$/.test(limit??''))reject('peer-limit-invalid');peerLimitBytes=Number(limit);
   if(!Number.isSafeInteger(peerLimitBytes))reject('peer-limit-invalid');
   buffer=buffer.subarray(end+4);clearTimeout(handshakeTimer);ready=true;
   resolve({get peerLimitBytes(){return peerLimitBytes},sendText(text,beforeWrite){
    if(closing||failed)return Promise.reject(new Error('closed'));
    if(typeof text!=='string')return Promise.reject(new Error('text-required'));
    if(Buffer.byteLength(text)>Math.min(MiB,peerLimitBytes))return Promise.reject(new Error('outbound-limit'));
    return write(Buffer.from(text),1,beforeWrite);
   },close});return true;
  }
  function receiveFrames(){
   while(buffer.length>=2&&!failed){
    const first=buffer[0],op=first&15,fin=!!(first&128),tag=buffer[1]&127,control=op>=8;
    if(first&112||buffer[1]&128||![0,1,2,8,9,10].includes(op))reject('frame-invalid');
    if(control&&(!fin||tag>125))reject('frame-invalid');
    const extra=tag===126?2:tag===127?8:0,off=2+extra;if(buffer.length<off)return;
    let n=tag;
    if(extra===2){n=buffer.readUInt16BE(2);if(n<126)reject('frame-invalid')}
    if(extra===8){const big=buffer.readBigUInt64BE(2);if(big>BigInt(maxIncomingBytes))reject('inbound-limit');n=Number(big);if(n<=65535)reject('frame-invalid')}
    if(!control&&(n>maxIncomingBytes||fragmentBytes+n>maxIncomingBytes))reject('inbound-limit');
    if(op===2)reject('binary-unsupported');
    if(!control&&((op===0&&!fragmentOpen)||(op===1&&fragmentOpen)))reject('frame-invalid');
    if(buffer.length<off+n)return;
    const payload=buffer.subarray(off,off+n);buffer=buffer.subarray(off+n);
    if(op===9){write(payload,10).catch(()=>fail('socket-write'));continue}
    if(op===10)continue;
    if(op===8){
     if(n===1)reject('close-invalid');
     if(n>=2){const code=payload.readUInt16BE(0);if(!((code>=1000&&code<=1014&&![1004,1005,1006].includes(code))||(code>=3000&&code<=4999)))reject('close-invalid');utf8(payload.subarray(2));}
     if(closing){socket.end();return}
     closing=true;write(payload,8).then(()=>{socket.end();fail('peer-closed')},()=>fail('socket-write'));return;
    }
    if(op===1&&!fin)fragmentOpen=true;
    if(fragmentOpen){if(fragments.length>=1024)reject('fragment-limit');fragments.push(Buffer.from(payload));fragmentBytes+=n;if(!fin)continue;
     const text=utf8(Buffer.concat(fragments,fragmentBytes));fragments=[];fragmentBytes=0;fragmentOpen=false;onText(text);
    }else onText(utf8(payload));
   }
   if(buffer.length===0)buffer=Buffer.alloc(0);
  }
  function updatePartialDeadline(){
   const partial=ready&&(buffer.length>0||fragmentOpen);
   if(partial&&!partialTimer)partialTimer=setTimeout(()=>fail('frame-deadline'),15000);
   if(!partial){clearTimeout(partialTimer);partialTimer=undefined}
  }
  socket.once('connect',()=>{
   const request=Buffer.from(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
   try{socket.write(request)}catch{fail('capture-or-write-failed')}
  });
  socket.on('data',chunk=>{
   if(failed)return;
   try{buffer=Buffer.concat([buffer,chunk]);if(!ready&&!upgrade())return;receiveFrames();updatePartialDeadline()}
   catch(caught){const error=/** @type {Error} */ (caught);fail(['upgrade-limit','upgrade-invalid','peer-limit-invalid','frame-invalid','fragment-limit','inbound-limit','binary-unsupported','utf8-invalid','close-invalid'].includes(error.message)?error.message:'message-handler-failed')}
  });
  socket.on('error',()=>fail('socket-error'));
  socket.on('end',()=>{if(!closing&&!failed)fail(!ready?'upgrade-truncated':buffer.length||fragmentOpen?'frame-truncated':'peer-closed')});
  socket.on('close',()=>{clearTimers();signal?.removeEventListener('abort',aborted);if(!closing&&!failed)fail('socket-closed');resolveClose?.()});
 });
}
