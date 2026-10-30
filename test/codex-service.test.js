import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import * as fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {runServe} from '../src/serve/serve.js';
import {connectSocket} from '../src/serve/client.js';
import {tempState} from './helpers/fixture.js';
import {until} from './helpers/codex-wire.js';
test('configured Codex refuses native initialization while ordinary inbox service remains available',async t=>{
 const p=await tempState(t),socket=join(p.stateDir,'daemon.sock'),logs=[];let attempts=0;
 const peer=net.createServer(s=>{attempts++;s.destroy();});await new Promise((r,j)=>peer.once('error',j).listen(socket,r));t.after(()=>new Promise(r=>peer.close(r)));
 const fake=join(p.stateDir,'codex');await fs.writeFile(fake,'wrong binary',{mode:0o700});const bin=process.env.RELAY_CODEX_TEST_BIN??fake;
 const abort=new AbortController();let ready;const started=new Promise(r=>ready=r);const running=runServe({env:{PATH:process.env.PATH,HOME:p.stateDir,RELAY_STATE_DIR:p.stateDir,RELAY_CODEX_BIN:bin,RELAY_CODEX_HOME:p.stateDir,RELAY_CODEX_SOCKET:socket,RELAY_CODEX_EVIDENCE:resolve('docs/evidence/codex-question-0.165.0.json')},signal:abort.signal,log:s=>logs.push(s),ready});t.after(async()=>{abort.abort();await running;});await Promise.race([started,running.then(()=>assert.fail('service stopped before ready'))]);
 await until(()=>logs.some(s=>process.env.RELAY_CODEX_TEST_BIN?s.includes('CODEX_CONNECTION'):s.includes('CODEX_DISABLED')&&s.includes('CODEX_EVIDENCE_OR_BINARY')));assert.equal(attempts,0);
 const client=await connectSocket(join(p.stateDir,'serve.sock'));t.after(()=>client.close());assert.equal((await client.request('presence.get')).ok,true);
});
