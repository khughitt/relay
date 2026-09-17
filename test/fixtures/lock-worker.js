import { readFile, writeFile } from 'node:fs/promises';
import { withLock } from '../../src/bus/lock.js';
import { applyEvent } from '../../src/bus/transaction.js';
import { normalizeEvent } from '../../src/adapters/index.js';
import { paths } from '../../src/bus/paths.js';
const [mode,stateDir,iterations='3'] = process.argv.slice(2);
const p=paths({RELAY_STATE_DIR:stateDir});
process.send({type:'ready'});
process.once('message',async()=>{
  try {
    if(mode==='hold-main'||mode==='hold-guard') {
      const path=mode==='hold-main'?p.lockPath:p.reclaimPath;
      await withLock(path,async()=>{process.send({type:'entered'});await new Promise(resolve=>process.once('message',resolve));});
    } else if(mode==='registry') {
      await applyEvent(normalizeEvent('codex','SessionStart',JSON.stringify({session_id:String(process.pid),cwd:'/repo'})),{
        paths:p,resolveAgentPid:()=>process.pid,gitContext:async()=>({remote:null,repoRoot:null}),
      });
      process.send({type:'written'});
      await new Promise(resolve=>process.once('message',resolve));
    } else {
      for(let i=0;i<Number(iterations);i++)await withLock(p.lockPath,async()=>{
        const path=`${stateDir}/counter`;const current=Number(await readFile(path,'utf8'));
        await new Promise(resolve=>setTimeout(resolve,5));await writeFile(path,String(current+1));
      });
    }
    process.send({type:'done'});process.disconnect();
  } catch(error) { process.send({type:'error',code:error.code??'UNEXPECTED'});process.disconnect();process.exitCode=1; }
});
