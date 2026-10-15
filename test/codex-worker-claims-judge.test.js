import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const judge = new URL('../tools/codex-worker-claims/judge.mjs', import.meta.url).pathname;
const R = 'root-thread', W = 'worker-thread', A = 'wk-aaaaaa', B = 'wk-bbbbbb', PID = 4242;
const handle = { platform: 'linux', host: 'host', bootId: null, pid: PID, start: '1' };
const row = (id, extra = {}) => ({ id: `codex:${id}`, harness: 'codex', sessionId: id, scope: 'session', process: handle,
  cwd: '/p', repoRoot: null, remote: null, projectKey: '/p', project: 'p', state: 'working', updatedAt: 0, ...extra });
const rootRow = row(R), workerRow = row(W, { scope: 'worker', root: `codex:${R}` });
const claim = (id, owner) => ({ id, session: `codex:${owner}`, pid: PID, live: true });
const refusal = (id, owner) => `{"error":{"detail":"${id} is claimed by session codex:${owner}","kind":"claimed"}}\nexit=1\n`;
const x = ' 2>&1; echo exit=$?';

// A passing controller/worker run: hook records in order, each relay-bound one with the
// registry and claims it left (taken after relay handled it, before the command ran).
function passingRun() {
  const steps = [], agents = { [`codex:${R}`]: rootRow }, claims = [];
  const hook = (event, payload, bound = true) => steps.push({ event, payload: { session_id: R, ...payload },
    after: bound ? { schema: 2, agents: structuredClone(agents) } : null, claims: bound ? { claims: structuredClone(claims) } : null });
  let n = 0;
  const bash = (by, command, response, effect = () => {}) => {
    const id = `call-${++n}`, who = by === 'worker' ? { agent_id: W } : {};
    hook('PreToolUse', { ...who, tool_name: 'Bash', tool_use_id: id, tool_input: { command: command + x } });
    effect();
    hook('PostToolUse', { ...who, tool_name: 'Bash', tool_use_id: id, tool_response: response }, false);
  };
  hook('SessionStart', {});
  bash('controller', `tasks start ${A}`, `{"id":"${A}","warnings":[]}\nexit=0\n`, () => claims.push(claim(A, R)));
  agents[`codex:${W}`] = workerRow;
  hook('SubagentStart', { agent_id: W });
  bash('worker', `tasks start ${B}`, `{"id":"${B}","warnings":[]}\nexit=0\n`, () => claims.push(claim(B, W)));
  for (const verb of ['start', 'park', 'done']) bash('worker', `tasks ${verb} ${A}${verb === 'start' ? '' : ' probe'}`, refusal(A, R));
  hook('SubagentStop', { agent_id: W });
  for (const verb of ['start', 'park', 'done']) bash('controller', `tasks ${verb} ${B}${verb === 'start' ? '' : ' probe'}`, refusal(B, W));
  hook('Stop', {});
  const shown = (owner) => ({ task: { status: 'doing', notes: [{ text: 'started', harness_session: `codex:${owner}` }] } });
  return { steps, A: shown(R), B: shown(W) };
}
async function verdict(t, run) {
  const out = await mkdtemp(join(tmpdir(), 'relay-claims-judge-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await mkdir(join(out, 'log'));
  await writeFile(join(out, 'ids'), `A=${A}\nB=${B}\n`);
  await writeFile(join(out, 'A.json'), JSON.stringify(run.A));
  await writeFile(join(out, 'B.json'), JSON.stringify(run.B));
  let seq = 1000000000000000000n;
  for (const step of run.steps) {
    const base = join(out, 'log', `${seq++}-${step.event}`);
    await writeFile(`${base}.json`, JSON.stringify({ event: step.event, payload: step.payload, env: {}, ancestry: [] }));
    if (step.after) await writeFile(`${base}.agents.json`, JSON.stringify(step.after));
    if (step.claims) await writeFile(`${base}.claims.json`, JSON.stringify(step.claims));
  }
  const r = spawnSync(process.execPath, [judge, out], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout };
}

test('the claims judge passes a run whose claims came through the relay rows', async t => {
  const r = await verdict(t, passingRun());
  assert.equal(r.status, 0, r.stdout);
});
test('the claims judge fails a run whose claims carry no relay process (tasks fell back to the native thread)', async t => {
  const run = passingRun();
  for (const step of run.steps) for (const c of step.claims?.claims ?? []) delete c.pid;
  const r = await verdict(t, run);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /FAIL: A claimed without the relay row's process/);
});
test('the claims judge fails a run in which an owner had no row when it acquired', async t => {
  const run = passingRun();
  const start = run.steps.find(s => s.event === 'PreToolUse' && s.payload.tool_input.command.startsWith(`tasks start ${B}`) && s.payload.agent_id);
  delete start.after.agents[`codex:${W}`];
  const r = await verdict(t, run);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /FAIL: B: no codex:worker-thread row when its start ran/);
});
test('the claims judge fails a run whose rows have no process handle and whose claims have no pid', async t => {
  const run = passingRun();
  for (const step of run.steps) {
    for (const agent of Object.values(step.after?.agents ?? {})) agent.process = null;
    for (const c of step.claims?.claims ?? []) delete c.pid;
  }
  const r = await verdict(t, run);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /FAIL: A: codex:root-thread row had no process handle when its start ran/);
});
