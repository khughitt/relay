// @ts-check
import {lstatSync} from 'node:fs';
import {join} from 'node:path';
import {openRolloutRecord} from './record.js';
const unknown=()=>({state:'unknown',calls:new Map(),outputs:new Map(),turnEnds:new Map(),abortsWithoutTurn:0});
/** A service-wide budget also covers readers retained after unsubscribe.
 * @param {{home:string,maxBytes?:number,maxReaders?:number}} options */
export function createReceiptReaders({home,maxBytes=64*1024*1024,maxReaders=16}) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024||!Number.isSafeInteger(maxReaders)||maxReaders<1||maxReaders>16)throw Error('CODEX_READER_BOUNDS');
  /** @type {Map<string,any>} */ const readers=new Map();
  const refused={read:async()=>unknown(),close:async()=>{},charge:0};
  /** @param {string} path */
  function get(path) {
    const cached=readers.get(path);if(cached)return cached;
    if(readers.size>=maxReaders)return refused;
    /** @type {ReturnType<typeof openRolloutRecord>|null} */ let raw=null;
    let charge=0;
    const disable=()=>{const before=raw;raw=null;charge=0;void before?.close();return unknown();};
    const reader={get charge(){return charge;},async read(){
      if(!raw)return unknown();
      try{
        charge=Math.max(charge,lstatSync(path).size);
        if([...readers.values()].reduce((sum,r)=>sum+r.charge,0)>maxBytes)return disable();
        const snapshot=await raw.read();return snapshot.state==='ok'?snapshot:disable();
      }catch{return disable();}
    },async close(){const before=raw;raw=null;charge=0;await before?.close();}};
    readers.set(path,reader);
    try{charge=lstatSync(path).size;if([...readers.values()].reduce((sum,r)=>sum+r.charge,0)>maxBytes)disable();else raw=openRolloutRecord({path,sessionsDir:join(home,'sessions'),uid:/** @type {number} */ (process.getuid?.())});}catch{disable();}
    return reader;
  }
  return {get,async prune(/** @type {Set<string>} */ paths){for(const [path,r] of readers)if(!paths.has(path)){await r.close();readers.delete(path);}},async close(){for(const r of readers.values())await r.close();readers.clear();}};
}
