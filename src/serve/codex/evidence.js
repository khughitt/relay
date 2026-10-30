// @ts-check
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {readOwned,sameFile} from './files.js';
export const VERSION='0.165.0';
// This digest binds the reviewed source/protocol/native pins as one immutable artifact.
const EVIDENCE_SHA256='a5d1098a998d5e1260d4e4b517c69f6b64f7fb4e77caaa28dc65b3444c38b9ac';
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
    if(proof.protocolPrerequisitesComplete!==true||proof.subscriptionCapability?.selection!=='active-waiting'||proof.subscriptionCapability?.detectedJoinResidual!==true||proof.subscriptionCapability?.nativeStatusBroadcast!==true||proof.subscriptionCapability?.pendingRequestReplay!==true)throw Error('CODEX_SUBSCRIPTION_EVIDENCE');
    return {version:VERSION,blockingBuiltinImpliesPlan:true,gate7Passed:false};
  }catch(caught){if(caught instanceof Error&&caught.message==='CODEX_SUBSCRIPTION_EVIDENCE')throw caught;throw Error('CODEX_EVIDENCE_OR_BINARY');}
}
/** @param {any} value @param {import('../../types.js').CodexConfig} config */
export function validateInitialize(value,config) {
  if(typeof value?.userAgent!=='string'||!/^[^/\s]+\/0\.165\.0(?: \(|$)/.test(value.userAgent)||value.codexHome!==config.home)throw Error('CODEX_DAEMON_VERSION_OR_HOME');
}
