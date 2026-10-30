// @ts-check
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {readOwned,sameFile} from './files.js';
export const VERSION='0.165.0';
// This digest binds the reviewed source/protocol/native pins as one immutable artifact.
const EVIDENCE_SHA256='c829cabdbe68bf9562c6afcb95a840e4588f8780248a789574ee93ae1d2c9ddf';
/** @param {import('../../types.js').CodexConfig} config @returns {Promise<{version:string,blockingBuiltinImpliesPlan:boolean,gate7Passed:boolean}>} */
export async function validateEvidence(config) {
  try {
    const {bytes}=await readOwned(config.evidence,64*1024);
    if(createHash('sha256').update(bytes).digest('hex')!==EVIDENCE_SHA256)throw Error('CODEX_EVIDENCE');
    const proof=JSON.parse(bytes.toString('utf8'));
    if(proof.version!==VERSION||proof.privateMatrixControlsComplete!==true||proof.blockingBuiltinImpliesPlan!==true)throw Error('CODEX_EVIDENCE');
    const before=await fs.lstat(config.bin);
    if(!before.isFile()||before.isSymbolicLink()||![0,process.getuid?.()].includes(before.uid)||(before.mode&0o022)||(before.mode&0o111)===0||before.size!==proof.executable.size)throw Error('CODEX_BINARY');
    const fd=await fs.open(config.bin,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {
      if(!sameFile(before,await fd.stat()))throw Error('CODEX_BINARY');
      const hash=createHash('sha256');for await(const chunk of fd.createReadStream({autoClose:false,highWaterMark:65536}))hash.update(chunk);
      if(hash.digest('hex')!==proof.executable.sha256||!sameFile(before,await fd.stat())||!sameFile(before,await fs.lstat(config.bin)))throw Error('CODEX_BINARY');
    }finally{await fd.close();}
    if(proof.protocolPrerequisitesComplete!==true||proof.subscriptionCapability?.loadedOnlyJoin!==true||proof.subscriptionCapability?.optOutAutomaticAttachment!==true)throw Error('CODEX_NO_ATOMIC_SUBSCRIPTION');
    return {version:VERSION,blockingBuiltinImpliesPlan:true,gate7Passed:false};
  }catch(caught){if(caught instanceof Error&&caught.message==='CODEX_NO_ATOMIC_SUBSCRIPTION')throw caught;throw Error('CODEX_EVIDENCE_OR_BINARY');}
}
/** @param {any} value @param {import('../../types.js').CodexConfig} config */
export function validateInitialize(value,config) {
  if(typeof value?.userAgent!=='string'||!/^[^/\s]+\/0\.165\.0(?: \(|$)/.test(value.userAgent)||value.codexHome!==config.home)throw Error('CODEX_DAEMON_VERSION_OR_HOME');
}
