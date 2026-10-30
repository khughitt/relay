// @ts-check
import { connectUnixWebSocket } from './transport.js';
/** @param {string} code @returns {never} */
const fail = code => { throw Error(code); };
/** @param {unknown} v @returns {v is Record<string,any>} */
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A bounded client; unrelated notifications are discarded, never buffered or logged. */
export class Rpc {
  /** @param {import('./transport.js').Wire|null} wire @param {(message:any)=>unknown} onMessage @param {AbortSignal} signal @param {number} [timeout] @param {(code:string)=>void} [onFailure] */
  constructor(wire,onMessage,signal,timeout=15000,onFailure=()=>{}) {
    this.wire=wire;this.onMessage=onMessage;this.signal=signal;this.timeout=timeout;this.serial=0;this.unmatched=0;this.onFailure=onFailure;
    /** @type {Map<number,{resolve:(value:any)=>void,reject:(error:Error)=>void,timer:NodeJS.Timeout}>} */ this.pending=new Map();
    /** @type {Error|null} */ this.error=null;
    this.onAbort=()=>this.stop('interrupted');signal.addEventListener('abort',this.onAbort,{once:true});if(signal.aborted)this.onAbort();
  }
  /** @param {string} text */
  receive(text) {
    if(this.error)return;
    try {
      if(Buffer.byteLength(text)>8*1024*1024)fail('inbound-limit');
      const m=JSON.parse(text);
      if(!object(m)||(m.method!==undefined&&typeof m.method!=='string')||(m.id!==undefined&&typeof m.id!=='string'&&!Number.isSafeInteger(m.id)))fail('invalid-message');
      if(m.method==='account/chatgptAuthTokens/refresh')fail('refresh-request');
      if(!m.method) {
        if(m.id===undefined||Object.hasOwn(m,'result')===Object.hasOwn(m,'error'))fail('invalid-message');
        const p=this.pending.get(m.id);if(!p){if(++this.unmatched>256)fail('unmatched-limit');return;}
        this.pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(Error('rpc-error'));else p.resolve(m.result);return;
      }
      if(['item/tool/requestUserInput','serverRequest/resolved','turn/completed','thread/started','thread/status/changed'].includes(m.method)) {
        Promise.resolve(this.onMessage(m)).catch(()=>this.stop('message-handler-failed'));
      }
    } catch { this.stop('invalid-message'); }
  }
  /** @param {string} code */
  stop(code) {
    if(this.error)return;this.error=Error(code);
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(this.error);}this.pending.clear();
    void this.wire?.close();try{this.onFailure(code);}catch{}
  }
  /** @param {unknown} message @param {(()=>void)|undefined} [beforeWrite] */
  async send(message,beforeWrite) {
    if(this.error)throw this.error;if(!this.wire)throw Error('not-connected');
    await this.wire.sendText(JSON.stringify(message),()=>{if(this.error)throw this.error;beforeWrite?.();});
  }
  /** @param {string} method @param {unknown} params @param {(()=>void)|undefined} [beforeWrite] */
  call(method,params,beforeWrite) {
    if(this.error)return Promise.reject(this.error);if(this.pending.size>=32)return Promise.reject(Error('rpc-limit'));
    const id=++this.serial;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('rpc-deadline'));},this.timeout);
      this.pending.set(id,{resolve,reject,timer});
      this.send({id,method,params},beforeWrite).catch(e=>{clearTimeout(timer);this.pending.delete(id);reject(e);});
    });
  }
  async close(){this.signal.removeEventListener('abort',this.onAbort);this.stop('closed');await this.wire?.close();}
}
/** @param {{socketPath:string,signal:AbortSignal,onMessage:(message:any)=>unknown,onFailure?:(code:string)=>void}} options */
export async function connectRpc({socketPath,signal,onMessage,onFailure}) {
  const rpc=new Rpc(null,onMessage,signal,15000,onFailure);
  try {
    rpc.wire=await connectUnixWebSocket({socketPath,signal,onText:text=>rpc.receive(text),onFailure:code=>rpc.stop(code)});
    if(rpc.error)throw rpc.error;return rpc;
  }catch(e){await rpc.close();throw e;}
}
