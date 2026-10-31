import {readFileSync,writeFileSync,mkdirSync,existsSync,lstatSync,createReadStream} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ARCHIVES,ADDITIONAL_SOURCES,sha256,proveSourceInvariants} from './source-proof.mjs';
import {probeEnvironment} from './private-server.mjs';
import {generateProtocol} from './protocol-proof.mjs';
const VERSION='0.166.0',BASELINE='0.165.0',BASELINE_EVIDENCE='a5d1098a998d5e1260d4e4b517c69f6b64f7fb4e77caaa28dc65b3444c38b9ac';
const codeRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const write=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
function args(argv){
 const values={};for(let i=0;i<argv.length;i++){const k=argv[i];if(k==='--source-only'){if(values[k])throw Error('arguments');values[k]=true;continue}if(!['--baseline-source','--source','--bin','--binary-sha256','--out'].includes(k)||values[k]||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('arguments');values[k]=argv[++i]}
 for(const k of ['--baseline-source','--source','--bin','--binary-sha256','--out'])if(!values[k])throw Error('arguments');
 if(!/^[a-f0-9]{64}$/.test(values['--binary-sha256']))throw Error('arguments');return values;
}
async function hashFile(path,max){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>max)throw Error('input-file');const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return {sha256:h.digest('hex'),size:s.size}}
try {
 const a=args(process.argv.slice(2)),out=resolve(a['--out']),bin=resolve(a['--bin']);if(existsSync(out))throw Error('output-exists');
 const proofBytes=readFileSync(join(codeRoot,'docs/evidence/codex-question-0.165.0.json'));if(sha256(proofBytes)!==BASELINE_EVIDENCE)throw Error('baseline-evidence-pin');const baseline=JSON.parse(proofBytes);
 const archives={[BASELINE]:resolve(a['--baseline-source']),[VERSION]:resolve(a['--source'])};
 for(const v of [BASELINE,VERSION])if((await hashFile(archives[v],128*1024*1024)).sha256!==ARCHIVES[v])throw Error('source-archive-pin');
 const executable=await hashFile(bin,1024*1024*1024);if(executable.sha256!==a['--binary-sha256'])throw Error('binary-pin');
 mkdirSync(out,{mode:0o700});const env=probeEnvironment(join(out,'tool-home'));for(const p of [env.HOME,env.XDG_CONFIG_HOME,env.XDG_STATE_HOME,env.XDG_CACHE_HOME,env.XDG_RUNTIME_DIR])mkdirSync(p,{recursive:true,mode:0o700});
 const names=[...baseline.sources.map(s=>s.file),...ADDITIONAL_SOURCES],trees={};
 for(const v of [BASELINE,VERSION]){
  const root=join(out,'source-'+v);mkdirSync(root,{mode:0o700});
  execFileSync('tar',['-xzf',archives[v],'-C',root,'--strip-components=2','--no-same-owner','--no-same-permissions','--',...names.map(f=>'codex-rust-v'+v+'/codex-rs/'+f)],{env,maxBuffer:1024*1024,timeout:30000});
  trees[v]=Object.fromEntries(names.map(f=>{const p=join(root,f),s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.size>2*1024*1024)throw Error('source-file');return [f,readFileSync(p,'utf8')]}));
 }
 for(const pin of baseline.sources)if(sha256(trees[BASELINE][pin.file])!==pin.sha256)throw Error('baseline-source-pin');
 const comparison=baseline.sources.map(p=>({file:p.file,baselineSha256:p.sha256,sha256:sha256(trees[VERSION][p.file]),changed:p.sha256!==sha256(trees[VERSION][p.file])}));
 const diffs=[];for(const p of comparison.filter(p=>p.changed))try{execFileSync('diff',['-u','--label',BASELINE+'/'+p.file,'--label',VERSION+'/'+p.file,join(out,'source-'+BASELINE,p.file),join(out,'source-'+VERSION,p.file)],{env,maxBuffer:8*1024*1024,timeout:10000})}catch(e){if(e.status!==1)throw Error('source-diff');diffs.push(e.stdout.toString())}
 writeFileSync(join(out,'source-diff.patch'),diffs.join(''),{mode:0o600});write(join(out,'source-comparison.json'),{baseline:BASELINE,version:VERSION,files:comparison});
 const invariants=proveSourceInvariants(trees[VERSION],VERSION);write(join(out,'source-invariants.json'),invariants);if(invariants.status!=='passed')throw Error('source-invariant-failed');
 const census=JSON.parse(execFileSync('python3',[join(codeRoot,'tools/codex-question/tui-census.py'),archives[VERSION],VERSION],{env,encoding:'utf8',timeout:10000,maxBuffer:65536}));write(join(out,'tui-override-census.json'),census);if(census.status!=='passed')throw Error('source-invariant-failed');
 invariants.checks.push({id:'first-party-override-census',passed:true,files:census.matches.map(m=>m.file)});write(join(out,'source-invariants.json'),invariants);
 const pins={schema:1,version:VERSION,archive:{sha256:ARCHIVES[VERSION]},executable,sources:comparison.map(({file,sha256})=>({file,sha256})),additionalSources:ADDITIONAL_SOURCES.map(file=>({file,sha256:sha256(trees[VERSION][file])})),baseline:{version:BASELINE,evidenceSha256:BASELINE_EVIDENCE},invariantsSha256:sha256(JSON.stringify(invariants,null,2)+'\n'),facts:invariants.facts,stage:'source-only',gate7Passed:false};
 write(join(out,'source-pins.json'),pins);
 if(!a['--source-only']){
  mkdirSync(env.CODEX_HOME,{recursive:true,mode:0o700});
  const token=execFileSync(bin,['--version'],{env,encoding:'utf8',timeout:5000,maxBuffer:16384}).trim();if(token!=='codex-cli '+VERSION)throw Error('candidate-version');
  pins.protocol=generateProtocol({bin,out:join(out,'protocol-'+VERSION),env});
  const {runNativePilot}=await import('./native-pilot.mjs');const native=await runNativePilot({out:join(out,'native-pilot'),codex:bin,codeRoot,expected:executable,version:VERSION});if(native.status!=='passed')throw Error('native-pilot-failed');
  const evidence={...baseline,version:VERSION,scope:'0.166.0 source reproof and private native pilot; original0.165.0 matrix retained as baseline; Gate7 and integration unrun',executable,archive:ARCHIVES[VERSION],sources:pins.sources,additionalSources:pins.additionalSources,sourceReproof:{baseline:pins.baseline,checks:invariants.checks,facts:invariants.facts},native:[{case:'production-native-pilot',sha256:sha256(readFileSync(join(out,'native-pilot/result.json'))),status:'passed',assertions:native.assertions.length}],protocol:pins.protocol,productionAcceptanceComplete:false};write(join(out,'evidence.json'),evidence);pins.stage='source-and-native-passed';pins.nativePilotSha256=evidence.native[0].sha256;write(join(out,'source-pins.json'),pins);
 }
 console.log(JSON.stringify({status:'passed',stage:pins.stage,version:VERSION,sourceFiles:comparison.length,changed:comparison.filter(p=>p.changed).length,invariants:invariants.checks.length,gate7Passed:false}));
}catch(error){console.error(JSON.stringify({status:'failed',reason:error.message}));process.exitCode=1}
