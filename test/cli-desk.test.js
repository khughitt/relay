import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tempState } from './helpers/fixture.js';
import { spawnLines } from './helpers/spawn-lines.js';
import { connectSocket } from '../src/serve/client.js';
import { openInbox } from '../src/serve/inbox.js';
import { serveSocket } from '../src/serve/socket.js';
import { expectAnswers } from '../src/routes/index.js';
import { createProcessOps } from '../src/bus/proc.js';
import { parseValues, runInbox, runPresence } from '../src/cli/desk.js';
import { runCli } from './helpers/cli-interaction.js';
import { HANDLE, NOW, questionMessage, answerMessage } from './helpers/interaction.js';

const worker = new URL('./fixtures/serve-worker.js', import.meta.url).pathname;
const waiterFile = new URL('./fixtures/socket-waiter.js', import.meta.url).pathname;
async function setup(t, body = {}) {
  const p = await tempState(t), w = spawnLines(t, worker, [], { env: { RELAY_STATE_DIR: p.stateDir } });
  const { socketPath } = await w.next((m) => m.type === 'ready');
  await runPresence({ mode: 'away', socketPath });
  const q = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000, ...body } });
  const file = join(p.stateDir, 'q.json'); await fs.writeFile(file, JSON.stringify(q));
  const asker = spawnLines(t, waiterFile, [socketPath, file]); await asker.next((m) => m.op === 'ask');
  return { p, socketPath, q, asker };
}
test('parseValues follows the grammar and refuses what does not fit', () => {
  const q = questionMessage(), entry = { question: q };
  assert.deepEqual(parseValues(entry, ['q1=o2']), { q1: { type: 'choice', optionIds: ['o2'] } });
  assert.deepEqual(parseValues({ question: questionMessage({ body: { items: [{ ...q.body.items[0], type: 'multi' }] } }) }, ['q1=o1,o2']), { q1: { type: 'choice', optionIds: ['o1', 'o2'] } });
  assert.deepEqual(parseValues(entry, ['q1=other:Hexagon']), { q1: { type: 'other', text: 'Hexagon' } });
  assert.deepEqual(parseValues({ question: questionMessage({ body: { items: [{ ...q.body.items[0], type: 'text', options: [], allowOther: false }] } }) }, ['q1=text:hello']), { q1: { type: 'text', text: 'hello' } });
  for (const bad of [[], ['q1'], ['q9=o1'], ['q1=o1', 'q1=o2'], ['q1=text:x']]) assert.throws(() => parseValues(entry, bad), { code: 'USAGE' }, JSON.stringify(bad));
  const bool = { question: questionMessage({ body: { items: [{ ...q.body.items[0], type: 'boolean', options: [], allowOther: false }] } }) };
  assert.deepEqual(parseValues(bool, ['q1=false']), { q1: { type: 'boolean', value: false } });
});
test('list, show, answer, and the waiter hears it', { timeout: 30000 }, async (t) => {
  const { socketPath, q, asker } = await setup(t);
  const list = await runInbox({ action: 'list', args: [], socketPath });
  assert.deepEqual(list.json.entries.map((e) => e.id), [q.id]);
  assert.match(list.text, new RegExp(`^${q.id} pending claude-code:s1 Which shape\\?$`, 'm'));
  const show = await runInbox({ action: 'show', args: [q.id], socketPath });
  assert.equal(show.json.entry.id, q.id);
  assert.match(show.text, /pending/);
  const a = await runInbox({ action: 'answer', args: [q.id, 'q1=o2'], socketPath });
  assert.equal(a.json.entry.answer.body.surface, 'cli');
  assert.match(a.text, new RegExp(`^${q.id} answer saved$`, 'm'));
  assert.equal((await runInbox({ action: 'list', args: [], socketPath })).json.entries[0].state, 'answered');
  await asker.next((m) => m.type === 'state' && m.entry.state === 'answered');
  await assert.rejects(runInbox({ action: 'answer', args: [q.id, 'q1=o1'], socketPath }), { code: 'ALREADY_ANSWERED' });
});
test('human output labels handed and consumed while JSON keeps machine states', { timeout: 30000 }, async (t) => {
  const { socketPath, q, asker } = await setup(t);
  await runInbox({ action: 'answer', args: [q.id, 'q1=o2'], socketPath });
  await asker.next((m) => m.type === 'state' && m.entry.state === 'answered');
  asker.send('handed');
  await asker.next((m) => m.op === 'handed');
  let result = await runInbox({ action: 'list', args: [], socketPath });
  assert.equal(result.json.entries[0].state, 'handed');
  assert.match(result.text, new RegExp(`^${q.id} handed to the agent `, 'm'));
  const conn = await connectSocket(socketPath);
  try {
    await conn.request('confirm', { harness: 'claude-code', callId: 'toolu_1', observed: { 'Which shape?': 'Square' } });
  } finally { conn.close(); }
  result = await runInbox({ action: 'show', args: [q.id], socketPath });
  assert.equal(result.json.entry.state, 'consumed');
  assert.match(result.text, new RegExp(`^${q.id} the agent received it$`, 'm'));
});
test('unconfirmed output uses the receipt label and keeps its machine state', async (t) => {
  const p = await tempState(t), socketPath = join(p.stateDir, 'serve.sock');
  let now = NOW;
  const { inbox } = await openInbox({ stateDir: p.stateDir, clock: () => now, expectAnswers });
  const server = await serveSocket({ inbox, socketPath, processOps: createProcessOps(), reattachMs: 60000, log: () => {} });
  t.after(() => server.close());
  const q = questionMessage({ body: { expiresAt: NOW + 3_600_000 } });
  await inbox.setPresence('away');
  await inbox.ask(q, { handback: false, waiter: HANDLE });
  await runInbox({ action: 'answer', args: [q.id, 'q1=o2'], socketPath, clock: () => now });
  await inbox.handed(q.id, HANDLE);
  now += 60000; await inbox.sweep();
  const result = await runInbox({ action: 'show', args: [q.id], socketPath });
  assert.equal(result.json.entry.state, 'unconfirmed');
  assert.match(result.text, new RegExp(`^${q.id} handed, receipt not confirmed$`, 'm'));
});
test('undeliverable output includes the saved answer and recorded reason', { timeout: 30000 }, async (t) => {
  const { socketPath, q, asker } = await setup(t);
  const answer = await runInbox({ action: 'answer', args: [q.id, 'q1=o2'], socketPath });
  await asker.next((m) => m.type === 'state' && m.entry.state === 'answered');
  asker.child.kill('SIGKILL'); await asker.exited;
  let result;
  for (let i = 0; i < 20; i++) {
    result = await runInbox({ action: 'show', args: [q.id], socketPath });
    if (result.json.entry.state === 'undeliverable') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(result.json.entry.answer.id, answer.json.entry.answer.id);
  assert.match(result.text, /reason: asker-gone/);
  assert.match(result.text, /"answerId"/);
});
test('defer, withdraw, decline, and presence', { timeout: 30000 }, async (t) => {
  const { p, socketPath, q } = await setup(t);
  assert.equal((await runInbox({ action: 'defer', args: [q.id], socketPath })).json.entry.presentation, 'desktop');
  assert.equal((await runInbox({ action: 'answer', args: [q.id], decline: true, socketPath })).json.entry.answer.body.outcome, 'declined');
  await assert.rejects(runInbox({ action: 'answer', args: [q.id, 'q1=o1'], decline: true, socketPath }), { code: 'USAGE' });
  await assert.rejects(runInbox({ action: 'withdraw', args: [q.id], socketPath }), { code: 'ANSWERED' });
  const refused = runCli(p, ['--pretty', 'inbox', 'withdraw', q.id]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Winning answer from cli saved at .*: declined \{\}/);
  assert.equal((await runPresence({ mode: null, socketPath })).json.presence.mode, 'away');
  assert.equal((await runPresence({ mode: 'here', socketPath })).text, 'here\n');
});
test('no service is SERVE_UNAVAILABLE', async (t) => {
  const p = await tempState(t);
  await assert.rejects(runPresence({ mode: null, socketPath: join(p.stateDir, 'serve.sock') }), { code: 'SERVE_UNAVAILABLE' });
});

test('real CLI conflict errors retain and explain the saved phone answer', { timeout: 30000 }, async (t) => {
  const item = questionMessage().body.items[0];
  const { p, socketPath, q } = await setup(t, { items: [item,
    { ...item, id: 'q2', type: 'boolean', options: [], allowOther: false },
    { ...item, id: 'q3', type: 'text', options: [], allowOther: false },
    { ...item, id: 'q4', type: 'multi' },
  ] });
  const conn = await connectSocket(socketPath);
  let saved;
  try { saved = (await conn.request('answer', { message: answerMessage(q, { values: {
    q1: { type: 'choice', optionIds: ['o2'] }, q2: { type: 'boolean', value: false },
    q3: { type: 'text', text: 'saved text' }, q4: { type: 'other', text: 'Triangle' },
  } }) })).entry; }
  finally { conn.close(); }
  const savedAt = saved.log.find((row) => row.cause === 'answer').at;
  for (const [action, args, code] of [
    ['answer', ['q1=o1', 'q2=true', 'q3=text:loser', 'q4=o1'], 'ALREADY_ANSWERED'], ['defer', [], 'ALREADY_ANSWERED'], ['withdraw', [], 'ANSWERED'],
  ]) {
    const json = runCli(p, ['--json', 'inbox', action, q.id, ...args]);
    assert.equal(json.status, 1, json.stderr);
    assert.equal(json.stdout, '');
    assert.deepEqual(JSON.parse(json.stderr).error, {
      kind: `inbox-${action}_failed`, detail: `${code}: ${code}`, entry: saved,
    });
    const pretty = runCli(p, ['--pretty', 'inbox', action, q.id, ...args]);
    assert.equal(pretty.status, 1, pretty.stderr);
    assert.equal(pretty.stdout, '');
    assert.match(pretty.stderr, new RegExp(`^relay: ${code}: ${code}\\n`));
    assert.match(pretty.stderr, /Square/);
    assert.match(pretty.stderr, /"q2":false/);
    assert.match(pretty.stderr, /saved text/);
    assert.match(pretty.stderr, /Triangle/);
    assert.match(pretty.stderr, /phone/);
    assert.ok(pretty.stderr.includes(new Date(savedAt).toISOString()), pretty.stderr);
  }
});

test('desk take consumes an undeliverable detached answer with receipt labels', async (t) => {
  const p = await tempState(t), socketPath = join(p.stateDir, 'serve.sock'); let now = NOW;
  const { inbox } = await openInbox({ stateDir: p.stateDir, clock: () => now, expectAnswers });
  const server = await serveSocket({ inbox, socketPath, processOps: createProcessOps(), log: () => {} }); t.after(() => server.close());
  const q = questionMessage({ body: { native: null } });
  await inbox.ask(q, { waiter: null, handback: false }); await inbox.answer(q.id, answerMessage(q));
  now = q.body.expiresAt;
  const taken = await runInbox({ action: 'take', args: [q.id], socketPath });
  assert.equal(taken.json.entry.state, 'consumed'); assert.match(taken.text, /the agent received it/);
  assert.equal(taken.json.entry.handedAt, null);
});
