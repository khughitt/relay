#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { listAgents,reapRegistry } from '../src/index.js';
import { relayError } from '../src/protocol.js';
const HELP = 'Usage: relay --help | list --json | reap\nR1 registry commands only. Hook dispatch and installation are not available.\n';
export async function main(args, { list = listAgents, reap = reapRegistry, stdout = process.stdout, stderr = process.stderr } = {}) {
  const json = args[0] === 'list' && args.includes('--json');
  try {
    if(args.length===1&&args[0]==='--help'){stdout.write(HELP);return 0;}
    if(args.length===2&&args[0]==='list'&&args[1]==='--json'){stdout.write(`${JSON.stringify(await list())}\n`);return 0;}
    if(args.length===1&&args[0]==='reap'){
      const result=await reap();
      stdout.write(`Reaped ${result.reaped.length} agent(s).\n`);
      for(const d of result.diagnostics)stderr.write(`${d.code}: ${d.message}\n`);
      return result.diagnostics.some(d=>['LOCK_CLEANUP_FAILED','LOCK_OWNERSHIP_LOST'].includes(d.code))?1:0;
    }
    if(['hook','install'].includes(args[0]))throw relayError('FEATURE_UNAVAILABLE','hook dispatch and installation are not available in R1');
    throw relayError('USAGE','expected --help, list --json, or reap');
  }catch(error){
    const code=error.code??'IO_ERROR';
    const message=error.code?error.message:'registry operation failed';
    if(json)stdout.write(`${JSON.stringify({error:{code,message}})}\n`);
    else stderr.write(`${code}: ${message}\n`);
    return 1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)process.exitCode=await main(process.argv.slice(2));
