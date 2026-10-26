import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lib = new URL('../tools/codex-subagent-capture/lib.sh', import.meta.url).pathname;
test('the capture hook records CODEX_* names but only the id values, never a credential', async t => {
  const out = await mkdtemp(join(tmpdir(), 'relay-capture-hook-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await writeFile(join(out, 'auth.json'), '{}');
  const setup = spawnSync('bash', ['-c', '. "$1" && capture_home "$2"', 'setup', lib, out],
    { env: { PATH:process.env.PATH??'',HOME:out,CODEX_AUTH: join(out, 'auth.json') }, encoding: 'utf8' });
  assert.equal(setup.status, 0, setup.stderr);
  const hook = spawnSync(join(out, 'hook.sh'), ['PreToolUse', join(out, 'log')], { input: '{"session_id":"r"}', encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME:out,CODEX_THREAD_ID: 'thread-1', CODEX_API_KEY: 'sk-secret-value', CODEX_HOME: '/home/user/.codex' } });
  assert.equal(hook.status, 0, hook.stderr);
  const [name] = (await readdir(join(out, 'log'))).filter(file => file.endsWith('-PreToolUse.json'));
  const text = await readFile(join(out, 'log', name), 'utf8');
  assert.equal(text.includes('sk-secret-value'), false);
  assert.deepEqual(JSON.parse(text).env, { CODEX_THREAD_ID: 'thread-1', CODEX_HOME: '/home/user/.codex', CODEX_API_KEY: '<redacted>' });
});

test('a switch waits for both the root Stop and its worker tool event',async t=>{
  const base=await mkdtemp(join(tmpdir(),'relay-capture-ready-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const stop={session_id:'r'},tool={session_id:'r',agent_id:'w'};
  const cases=[[],[['Stop',stop]],[['PreToolUse',tool]],
    [['Stop',{session_id:'other'}],['PreToolUse',tool]],
    [['Stop',stop],['PreToolUse',{session_id:'other',agent_id:'w'}]],
    [['Stop',stop],['PreToolUse',tool]]];
  for(const [i,events]of cases.entries()){
    const out=join(base,String(i));await mkdir(join(out,'log'),{recursive:true});
    for(const [j,[event,payload]]of events.entries())await writeFile(join(out,'log',`${j}-${event}.json`),JSON.stringify({event,payload}));
    const result=spawnSync('bash',['-c','. "$1"; out=$2; switch_ready "$3"','ready',lib,out,'r'],
      {encoding:'utf8',env:{PATH:process.env.PATH??'',HOME:out}});
    assert.equal(result.status,i===cases.length-1?0:1,result.stderr);
  }
});
