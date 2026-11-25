import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relayError } from '../../src/protocol.js';
export const RELAY_BIN = fileURLToPath(new URL('../../bin/relay.js', import.meta.url));
export function spawnHook(harness, event, payload, { bin = RELAY_BIN, args, spawnFn = spawn, timeoutMs = 5000 } = {}) {
  const argv = args ?? ['hook', '--harness', harness, event];
  return new Promise((resolve,reject) => {
    let child;
    try { child = spawnFn(bin,argv,{shell:false,stdio:['pipe','ignore','pipe']}); }
    catch(cause) { reject(relayError('PROCESS_UNAVAILABLE',`cannot spawn ${harness} hook`,cause)); return; }
    let settled=false, bytes=0;
    const fail = (error) => {
      if (settled) return;
      settled=true; clearTimeout(timer);
      child.kill('SIGKILL'); child.stdin.destroy(); child.stderr.destroy();
      reject(error);
    };
    const timer=setTimeout(()=>fail(relayError('INPUT_TIMEOUT',`${harness} hook timed out`)),Math.min(5000,timeoutMs));
    child.stderr.on('data',chunk=>{
      bytes+=chunk.length;
      if(bytes>64*1024)fail(relayError('INPUT_TOO_LARGE',`${harness} hook stderr exceeds byte limit`));
    });
    child.once('error',cause=>fail(relayError('PROCESS_UNAVAILABLE',`cannot run ${harness} hook`,cause)));
    child.once('close',code=>{
      if(settled)return; settled=true; clearTimeout(timer);
      if(code!==0)reject(relayError('PROCESS_UNAVAILABLE',`${harness} hook exited ${code}`));
      else resolve();
    });
    child.stdin.on('error',cause=>{
      // Early exit commonly closes stdin; the exit status is the useful error.
      if(cause.code!=='EPIPE')fail(relayError('PROCESS_UNAVAILABLE',`cannot send ${harness} input`,cause));
    });
    try { child.stdin.end(JSON.stringify(payload)); }
    catch(cause) { fail(relayError('INVALID_INPUT',`cannot encode ${harness} input`,cause)); }
  });
}
