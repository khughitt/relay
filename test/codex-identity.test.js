import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import * as fs from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createProcessOps} from '../src/bus/proc.js';
import promises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
const mod=await import('../src/serve/codex/identity.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
async function fixture(t){
 assert.equal(typeof mod.daemonIdentity,'function');const home=await fs.mkdtemp(join(tmpdir(),'relay-daemon-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));await fs.mkdir(join(home,'app-server-daemon'),{mode:0o700});const socket=join(home,'server.sock'),ops=createProcessOps(),handle=ops.handleOf(process.pid);const server=net.createServer();await new Promise((r,j)=>server.once('error',j).listen(socket,r));await fs.chmod(socket,0o600);t.after(()=>new Promise(r=>server.close(r)));
 const pidFile=join(home,'app-server-daemon','daemon.pid'),record={pid:process.pid,processStartTime:execFileSync('/usr/bin/ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:home,USER:'fixture',LC_ALL:'C'}}).trim(),processIdentity:{bootId:handle.bootId,startTicks:Number(handle.start)}};const put=async value=>fs.writeFile(pidFile,JSON.stringify(value),{mode:0o600});await put(record);return {home,socket,ops,handle,record,put,pidFile,server,config:{home,socket,bin:process.execPath,evidence:join(home,'e.json')}};
}
test('owned listener, real process birth and native-format metadata qualify through proc association',async t=>{
 const f=await fixture(t);assert.deepEqual(await mod.daemonIdentity(f.config,f.ops),f.handle);await new Promise(r=>f.server.close(r));await new Promise((r,j)=>f.server.once('error',j).listen(f.socket,r));await fs.chmod(f.socket,0o600);assert.deepEqual(await mod.daemonIdentity(f.config,f.ops),f.handle);
});
test('missing, ambiguous, symlinked, malformed and mismatched PID metadata stay unknown',async t=>{
 const f=await fixture(t);for(const record of [{}, {...f.record,pid:0},{...f.record,processIdentity:{bootId:'wrong',startTicks:Number(f.handle.start)}},{...f.record,processIdentity:{bootId:f.handle.bootId,startTicks:Number(f.handle.start)+1}}]){await f.put(record);assert.equal(await mod.daemonIdentity(f.config,f.ops),null);}
 await f.put(f.record);const other=join(f.home,'app-server-daemon','app-server.pid');await fs.writeFile(other,JSON.stringify(f.record),{mode:0o600});assert.equal(await mod.daemonIdentity(f.config,f.ops),null);await fs.rm(other);await fs.rm(f.pidFile);assert.equal(await mod.daemonIdentity(f.config,f.ops),null);await fs.symlink(f.config.bin,f.pidFile);assert.equal(await mod.daemonIdentity(f.config,f.ops),null);
});
test('unqualified process, executable or endpoint never yields replacement/send authority',async t=>{
 const f=await fixture(t);for(const status of ['unknown','dead'])assert.equal(await mod.daemonIdentity(f.config,{...f.ops,probe:()=>({status})}),null);assert.equal(await mod.daemonIdentity({...f.config,bin:join(f.home,'other')},f.ops),null);const alias=join(f.home,'alias');await fs.symlink(f.socket,alias);assert.equal(await mod.daemonIdentity({...f.config,socket:alias},f.ops),null);await fs.chmod(f.socket,0o666);assert.equal(await mod.daemonIdentity(f.config,f.ops),null);
});
test('valid process A metadata cannot qualify the physical listener owned only by process B',async t=>{
 const f=await fixture(t),other=join(f.home,'other.sock');const script="import net from 'node:net';import fs from 'node:fs';const s=net.createServer();s.listen(process.argv[1],()=>{fs.chmodSync(process.argv[1],0o600);process.stdout.write('ready\\n')});process.on('SIGTERM',()=>s.close(()=>process.exit(0)));";
 const child=spawn(process.execPath,['--input-type=module','-e',script,other],{env:{PATH:process.env.PATH,HOME:f.home,USER:'fixture',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:['ignore','pipe','pipe']});const ended=once(child,'exit');t.after(async()=>{if(child.exitCode===null)child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);try{await ended;}finally{clearTimeout(timer);}});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture-ready-timeout')),3000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',reject);});assert.equal(await mod.daemonIdentity({...f.config,socket:other},f.ops),null);
 const h=f.ops.handleOf(child.pid);await f.put({...f.record,pid:child.pid,processStartTime:execFileSync('/usr/bin/ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:f.home,USER:'fixture',LC_ALL:'C'}}).trim(),processIdentity:{bootId:h.bootId,startTicks:Number(h.start)}});assert.deepEqual(await mod.daemonIdentity({...f.config,socket:other},f.ops),h);assert.notDeepEqual(h,f.handle);
});

test('invalid UTF-8 metadata is unknown even when its birth fields would otherwise match',async t=>{
 const f=await fixture(t),text=JSON.stringify(f.record);
 // Corrupt a non-authoritative string too; native serde must still reject the JSON bytes.
 const at=text.indexOf('processStartTime')+'processStartTime'.length+3;const corrupt=Buffer.from(text);corrupt[at]=255;await fs.writeFile(f.pidFile,corrupt);assert.equal(await mod.daemonIdentity(f.config,f.ops),null);
});

test('owned0644 PID metadata qualifies without weakening socket privacy',async t=>{
 const f=await fixture(t);await fs.chmod(f.pidFile,0o644);
 assert.deepEqual(await mod.daemonIdentity(f.config,f.ops),f.handle);
 await fs.chmod(f.socket,0o644);assert.equal(await mod.daemonIdentity(f.config,f.ops),null);
});
test('group or other writable PID metadata refuses',async t=>{
 const f=await fixture(t);
 for(const mode of [0o664,0o666]){await fs.chmod(f.pidFile,mode);assert.equal(await mod.daemonIdentity(f.config,f.ops),null);}
 await fs.chmod(f.pidFile,0o644);assert.deepEqual(await mod.daemonIdentity(f.config,f.ops),f.handle);
});
test('foreign PID-record ownership refuses even with otherwise valid0644 metadata',async t=>{
 const f=await fixture(t);await fs.chmod(f.pidFile,0o644);
 const original=promises.lstat,open=promises.open;
 // An unprivileged test cannot chown a file; replace only the OS ownership observation.
 const foreign=s=>new Proxy(s,{get:(s,key)=>key==='uid'?process.getuid()+1:Reflect.get(s,key)});
 const mocked=t.mock.method(promises,'lstat',async(path,...args)=>{const s=await original(path,...args);return path===f.pidFile?foreign(s):s;});
 const opened=t.mock.method(promises,'open',async(path,...args)=>{const fd=await open(path,...args);if(path===f.pidFile){const stat=fd.stat.bind(fd);fd.stat=async(...args)=>foreign(await stat(...args));}return fd;});
 syncBuiltinESMExports();try{assert.equal(await mod.daemonIdentity(f.config,f.ops),null);}finally{mocked.mock.restore();opened.mock.restore();syncBuiltinESMExports();}
 assert.deepEqual(await mod.daemonIdentity(f.config,f.ops),f.handle);
});
test('a symlink to valid0644 PID metadata refuses',async t=>{
 const f=await fixture(t),target=join(f.home,'record.json');await fs.rename(f.pidFile,target);await fs.chmod(target,0o644);await fs.symlink(target,f.pidFile);
 assert.equal(await mod.daemonIdentity(f.config,f.ops),null);
});
test('PID metadata changed during the actual file read refuses',async t=>{
 const f=await fixture(t);await fs.chmod(f.pidFile,0o644);const original=promises.open;let changed=false;
 const mocked=t.mock.method(promises,'open',async(path,...args)=>{
  const fd=await original(path,...args);
  if(path===f.pidFile){const read=fd.read.bind(fd);fd.read=async(...args)=>{if(!changed){changed=true;await fs.writeFile(f.pidFile,JSON.stringify({...f.record,processStartTime:'X'+f.record.processStartTime.slice(1)}));}return read(...args);};}
  return fd;
 });
 syncBuiltinESMExports();try{const identity=await mod.daemonIdentity(f.config,f.ops);assert.equal(changed,true);assert.equal(identity,null);}finally{mocked.mock.restore();syncBuiltinESMExports();}
});
test('PID-record size bound still refuses oversized valid JSON',async t=>{
 const f=await fixture(t);await fs.chmod(f.pidFile,0o644);await f.put({...f.record,padding:'x'.repeat(16384)});
 assert.equal(await mod.daemonIdentity(f.config,f.ops),null);
});
