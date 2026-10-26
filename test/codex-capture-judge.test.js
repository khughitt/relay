import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const judge = new URL('../tools/codex-subagent-capture/judge-registry.mjs', import.meta.url).pathname;
const R1 = 'root-one', R2 = 'root-two', W = 'worker';
const handle = { platform: 'linux', host: 'host', bootId: null, pid: 4242, start: '1' };
const row = (id, extra = {}) => ({ id: `codex:${id}`, harness: 'codex', sessionId: id, scope: 'session', process: handle,
  cwd: '/p', repoRoot: null, remote: null, projectKey: '/p', project: 'p', state: 'working', updatedAt: 0, ...extra });
const workerRow = root => row(W, { scope: 'worker', root: `codex:${root}` });

// A capture's hook records in order, each with the registry relay left after it, built by
// replaying the events the way relay's transaction applies them.
function capture() {
  const steps = [], agents = {};
  const apply = (event, session, agent) => {
    if (event === 'SessionEnd') for (const id of Object.keys(agents)) {
      if (id === `codex:${session}` || agents[id].root === `codex:${session}`) delete agents[id];
    }
    else if (agent) agents[`codex:${agent}`] = workerRow(session);
    else agents[`codex:${session}`] = row(session);
    steps.push({ event, payload: { session_id: session, ...(agent ? { agent_id: agent } : {}) }, after: { schema: 2, agents: structuredClone(agents) } });
  };
  return { steps, agents, apply };
}
async function verdict(t, run, { beforeQuit } = {}) {
  const out = await mkdtemp(join(tmpdir(), 'relay-capture-judge-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await mkdir(join(out, 'log'));
  let seq = 1000000000000000000n;
  for (const step of run.steps) {
    const base = join(out, 'log', `${seq++}-${step.event}`);
    await writeFile(`${base}.json`, JSON.stringify({ event: step.event, payload: step.payload, env: {}, ancestry: [] }));
    await writeFile(`${base}.reply`, '');
    await writeFile(`${base}.agents.json`, JSON.stringify(step.after));
  }
  await writeFile(join(out, 'final-agents.json'), 'null');
  if (beforeQuit) await writeFile(join(out, 'before-quit-agents.json'), JSON.stringify({ schema: 2, agents: beforeQuit }));
  const r = spawnSync(process.execPath, [judge, out], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
  return { status: r.status, stdout: r.stdout };
}

test('a one-root background run passes', async t => {
  const run = capture();
  run.apply('SessionStart', R1); run.apply('Stop', R1); run.apply('SubagentStart', R1, W);
  run.apply('SubagentStop', R1, W); run.apply('SessionEnd', R1);
  const { status, stdout } = await verdict(t, run);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /^PASS: 2 worker events/m);
});

test("an old root's worker event is judged against its own root, not the latest one", async t => {
  const run = capture();
  run.apply('SessionStart', R1); run.apply('SubagentStart', R1, W); run.apply('SessionStart', R2);
  run.apply('SubagentStop', R1, W); run.apply('SessionEnd', R1); run.apply('Stop', R2);
  const beforeQuit = structuredClone(run.agents);
  run.apply('SessionEnd', R2);
  const { status, stdout } = await verdict(t, run, { beforeQuit });
  assert.equal(status, 0, stdout);
  assert.match(stdout, /^PASS/m);
});

test('a worker row recreated after its root ended is a row outliving its root', async t => {
  const run = capture();
  run.apply('SessionStart', R1); run.apply('SubagentStart', R1, W); run.apply('SessionEnd', R1);
  run.apply('SessionStart', R2); run.apply('PreToolUse', R1, W); run.apply('Stop', R2);
  const beforeQuit = structuredClone(run.agents);
  run.apply('SessionEnd', R2);
  const { status, stdout } = await verdict(t, run, { beforeQuit });
  assert.equal(status, 1, stdout);
  assert.match(stdout, /^FAIL: .*PreToolUse.*recreated codex:worker after its root codex:root-one ended/m);
  assert.match(stdout, /^FAIL: before \/quit, codex:worker outlives its root codex:root-one/m);
});

test('a switch with no SessionEnd leaves the old root and its worker behind', async t => {
  const run = capture();
  run.apply('SessionStart', R1); run.apply('SubagentStart', R1, W); run.apply('SessionStart', R2);
  run.apply('Stop', R2);
  const beforeQuit = structuredClone(run.agents);
  run.apply('SessionEnd', R2);
  const { status, stdout } = await verdict(t, run, { beforeQuit });
  assert.equal(status, 1, stdout);
  assert.match(stdout, /^INFO: codex:root-one had no SessionEnd before codex:root-two started/m);
  assert.match(stdout, /^FAIL: before \/quit, the replaced root codex:root-one is still published/m);
  assert.match(stdout, /^FAIL: before \/quit, codex:worker outlives its root codex:root-one/m);
});
