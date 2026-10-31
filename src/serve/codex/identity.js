// @ts-check
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {readOwned,sameFile} from './files.js';
/** @param {string} path */
async function directory(path) {
  const s=await fs.lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o022))throw Error('CODEX_HOME');return s;
}
/** @param {string} path */
async function socketStat(path) {
  const s=await fs.lstat(path);if(!s.isSocket()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o600)throw Error('CODEX_SOCKET');return s;
}
/** @param {string} text @param {string} path */
function listener(text,path) {
  const rows=text.split('\n').flatMap(line=>{
    const m=/^[0-9a-f]+:\s+\S+\s+\S+\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9]+)(?:\s+(.+))?$/i.exec(line);
    return m&&m[5]===path&&m[1]==='00010000'&&m[2]==='0001'&&m[3]==='01'?[m[4]]:[];
  });
  return rows.length===1?rows[0]:null;
}
/** @param {import('../../types.js').CodexConfig} config @param {import('../../types.js').ProcessOps} processOps @returns {Promise<import('../../types.js').Handle|null>} */
export async function daemonIdentity(config,processOps) {
  if(process.platform!=='linux')return null;
  try {
    const deadline=performance.now()+1000,home=await directory(config.home),base=join(config.home,'app-server-daemon'),parent=await directory(base),socket=await socketStat(config.socket);
    const candidates=[];for(const name of ['app-server.pid','daemon.pid']){const path=join(base,name);try{await fs.lstat(path);candidates.push(path);}catch(e){if(/** @type {NodeJS.ErrnoException} */ (e).code!=='ENOENT')throw e;}}
    if(candidates.length!==1)return null;
    const path=candidates[0],saved=await readOwned(path,16*1024),record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(saved.bytes));
    if(!Number.isSafeInteger(record.pid)||record.pid<1||typeof record.processStartTime!=='string'||!record.processStartTime||!record.processIdentity)return null;
    const handle=processOps.handleOf(record.pid);
    if(!handle||handle.platform!=='linux'||!handle.bootId||handle.bootId!==record.processIdentity.bootId||!Number.isSafeInteger(record.processIdentity.startTicks)||handle.start!==String(record.processIdentity.startTicks)||processOps.probe(handle).status!=='alive'||await fs.realpath(processOps.executableOf(record.pid))!==await fs.realpath(config.bin))return null;
    const net=await fs.open('/proc/net/unix','r');let table;
    try {
      const b=Buffer.alloc(1024*1024+1);let used=0;
      while(used<b.length){if(performance.now()>=deadline)return null;const {bytesRead}=await net.read(b,used,b.length-used,null);if(!bytesRead)break;used+=bytesRead;}
      if(used>1024*1024)return null;table=b.subarray(0,used).toString();
    }finally{await net.close();}
    const inode=listener(table,config.socket);if(!inode)return null;
    const fds=await fs.readdir(`/proc/${record.pid}/fd`);if(fds.length>4096)return null;
    let owns=false;for(const fd of fds){if(performance.now()>=deadline)return null;try{if(await fs.readlink(`/proc/${record.pid}/fd/${fd}`)===`socket:[${inode}]`){owns=true;break;}}catch{}}
    if(!owns||performance.now()>=deadline||!isDeepStrictEqual(handle,processOps.handleOf(record.pid))||processOps.probe(handle).status!=='alive'||await fs.realpath(processOps.executableOf(record.pid))!==await fs.realpath(config.bin))return null;
    if(!sameFile(home,await fs.lstat(config.home))||!sameFile(parent,await fs.lstat(base))||!sameFile(socket,await socketStat(config.socket)))return null;
    const after=await readOwned(path,16*1024);if(!sameFile(saved.stat,after.stat)||!saved.bytes.equals(after.bytes))return null;
    return handle;
  }catch{return null;}
}
