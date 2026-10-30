// @ts-check
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
/** @param {import('node:fs').Stats} a @param {import('node:fs').Stats} b */
export const sameFile=(a,b)=>(/** @type {const} */ (['dev','ino','uid','mode','size','mtimeMs','ctimeMs'])).every(k=>a[k]===b[k]);
/** @param {string} path @param {number} maxBytes @param {boolean} [privateMode] */
export async function readOwned(path,maxBytes,privateMode=false) {
  const before=await fs.lstat(path);
  if(!before.isFile()||before.isSymbolicLink()||before.uid!==process.getuid?.()||before.size>maxBytes||(before.mode&0o022)||(privateMode&&(before.mode&0o777)!==0o600))throw Error('CODEX_FILE');
  const fd=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    if(!sameFile(before,await fd.stat()))throw Error('CODEX_FILE');
    const bytes=Buffer.alloc(before.size);let offset=0;
    while(offset<bytes.length){const {bytesRead}=await fd.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)throw Error('CODEX_FILE');offset+=bytesRead;}
    if(!sameFile(before,await fd.stat())||!sameFile(before,await fs.lstat(path)))throw Error('CODEX_FILE');
    return {bytes,stat:before};
  }finally{await fd.close();}
}
