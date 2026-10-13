import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { runServe, servePaths } from '../src/serve/serve.js';
import { applyEvent } from '../src/bus/transaction.js';
import { connectSocket } from '../src/serve/client.js';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tempState } from './helpers/fixture.js';
import { openInbox } from '../src/serve/inbox.js';
import { serveHttp } from '../src/serve/http.js';
import { classify } from '../src/serve/guard.js';
import { serveConfig } from '../src/serve/config.js';
import { expectAnswers } from '../src/routes/index.js';
import { questionMessage, answerMessage, withdrawalMessage, HANDLE, uuid } from './helpers/interaction.js';
import { until, nextCall, settledYet, turn } from './helpers/wait.js';

const LOGIN = 'me@example.com', HOST = 'desk.tail1234.ts.net';
// How long close() may take before a test calls it retained. Node holds a connection with an
// incomplete request until its headers timeout (60 s, checked every 30 s), so this still separates a
// retained connection from a prompt close, without failing a close that a loaded host made slow.
const CLOSE_DEADLINE_MS = 5000;
async function setup(t, { clientDir = null, serveHost = HOST, now = Date.now, io, question = {}, readAgents = async () => ({ agents: {} }) } = {}) {
  const p = await tempState(t);
  const { inbox } = await openInbox({ stateDir: p.stateDir, clock: now, expectAnswers, ...(io ? { io } : {}) });
  await inbox.setPresence('away');
  const srv = await serveHttp({ inbox, http: { port: 0, serveHost, serveLogin: LOGIN, clientDir }, readAgents, clock: now, log: () => {} });
  t.after(() => srv.close());
  const q = questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000, ...question } });
  await inbox.ask(q, { handback: false, waiter: HANDLE });
  return { p, inbox, port: srv.port, q, srv };
}
const local = (port) => ({ host: `127.0.0.1:${port}` });
const phone = { host: HOST, 'tailscale-user-login': LOGIN, 'x-forwarded-for': '100.64.0.2' };
function call(port, { method = 'GET', path, headers = {}, body, rawBody }) {
  return new Promise((resolve, reject) => {
    const text = rawBody ?? (body === undefined ? null : JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path, agent: false, headers: { ...(text ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: data && res.headers['content-type']?.startsWith('application/json') ? JSON.parse(data) : null, text: data }));
    });
    req.on('error', reject); if (text) req.write(text); req.end();
  });
}
const answerBody = (patch = {}) => ({ answerId: uuid(), surface: 'cli', outcome: 'answered', artifactRevision: null, values: { q1: { type: 'choice', optionIds: ['o2'] } }, ...patch });

test('config: off without a port; host and login together; port and paths checked', () => {
  assert.deepEqual(serveConfig({}), { http: null });
  assert.throws(() => serveConfig({ RELAY_SERVE_HOST: HOST, RELAY_SERVE_LOGIN: LOGIN }), { code: 'INVALID_CONFIG' });
  assert.throws(() => serveConfig({ RELAY_HTTP_PORT: '3340', RELAY_SERVE_HOST: HOST }), { code: 'INVALID_CONFIG', message: /RELAY_SERVE_LOGIN/ });
  assert.throws(() => serveConfig({ RELAY_HTTP_PORT: '3340', RELAY_SERVE_LOGIN: LOGIN }), { code: 'INVALID_CONFIG', message: /RELAY_SERVE_HOST/ });
  assert.throws(() => serveConfig({ RELAY_HTTP_PORT: '70000' }), { code: 'INVALID_CONFIG' });
  assert.throws(() => serveConfig({ RELAY_HTTP_PORT: '3340', RELAY_CLIENT_DIR: 'rel' }), { code: 'INVALID_CONFIG' });
  assert.deepEqual(serveConfig({ RELAY_HTTP_PORT: '3340' }), { http: { port: 3340, serveHost: null, serveLogin: null, clientDir: null } });
});
test('guard: proxied needs exact login and host and no Funnel; local needs loopback host on the port', () => {
  const cfg = { port: 3340, serveHost: HOST, serveLogin: LOGIN };
  assert.deepEqual(classify(phone, cfg), { allowed: true, surface: 'phone', origin: `https://${HOST}` });
  for (const h of [{ ...phone, 'tailscale-user-login': 'Me@example.com' }, { ...phone, host: `${HOST}:443` }, { ...phone, host: HOST.toUpperCase() },
    { ...phone, 'tailscale-funnel-request': '?1' }, { 'x-forwarded-host': 'x', host: '127.0.0.1:3340' }]) assert.equal(classify(h, cfg).allowed, false, JSON.stringify(h));
  assert.equal(classify(phone, { ...cfg, serveHost: null, serveLogin: null }).allowed, false);
  // tailscale serve on a port other than 443 keeps the port in Host; the configured authority carries it.
  const on8443 = { ...cfg, serveHost: `${HOST}:8443` };
  assert.deepEqual(classify({ ...phone, host: `${HOST}:8443` }, on8443), { allowed: true, surface: 'phone', origin: `https://${HOST}:8443` });
  assert.equal(classify(phone, on8443).allowed, false);
  assert.deepEqual(classify({ host: '127.0.0.1:3340' }, cfg), { allowed: true, surface: 'desktop', origin: 'http://127.0.0.1:3340' });
  for (const host of ['localhost:3340', '[::1]:3340']) assert.equal(classify({ host }, cfg).allowed, true);
  for (const host of ['127.0.0.1:9999', '192.168.1.2:3340', '127.0.0.1', undefined]) assert.equal(classify(host ? { host } : {}, cfg).allowed, false);
});
test('every path, static included, is 403 for a refused request', async (t) => {
  const dir = await fs.mkdtemp(join((await tempState(t)).stateDir, 'client-'));
  await fs.writeFile(join(dir, 'index.html'), '<p>inbox</p>');
  const { port } = await setup(t, { clientDir: dir });
  for (const path of ['/', '/index.html', '/v1/inbox', '/v1/events']) assert.equal((await call(port, { path, headers: { ...phone, 'tailscale-funnel-request': '?1' } })).status, 403, path);
  const ok = await call(port, { path: '/', headers: phone });
  assert.deepEqual([ok.status, ok.text], [200, '<p>inbox</p>']);
  assert.equal((await call(port, { path: '/../../etc/passwd', headers: phone })).status, 404);
});
test('answer from the phone: surface set by the guard, retry replays, second device refused', async (t) => {
  const { port, q, inbox } = await setup(t), body = answerBody();
  const post = (b) => call(port, { method: 'POST', path: `/v1/inbox/${q.id}/answer`, headers: { ...phone, origin: `https://${HOST}` }, body: b });
  const first = await post(body);
  assert.equal(first.status, 200); assert.equal(first.json.entry.answer.body.surface, 'phone');
  const retry = await post(body);
  assert.deepEqual([retry.status, retry.json.entry.seq], [200, first.json.entry.seq]);
  const other = await post(answerBody());
  assert.equal(other.status, 409); assert.equal(other.json.error.code, 'ALREADY_ANSWERED');
  assert.equal(inbox.get(q.id).answer.body.answerId, body.answerId);
});
test('POST needs the matching origin and JSON, under 64 KiB', async (t) => {
  const { port, q } = await setup(t), path = `/v1/inbox/${q.id}/answer`;
  assert.equal((await call(port, { method: 'POST', path, headers: phone, body: answerBody() })).status, 403);
  assert.equal((await call(port, { method: 'POST', path, headers: { ...phone, origin: 'https://evil.example' }, body: answerBody() })).status, 403);
  assert.equal((await call(port, { method: 'POST', path, headers: { ...phone, origin: `https://${HOST}`, 'content-type': 'text/plain' }, body: answerBody() })).status, 415);
  assert.equal((await call(port, { method: 'POST', path, headers: { ...phone, origin: `https://${HOST}` }, body: { pad: 'x'.repeat(70000) } })).status, 413);
  assert.equal((await call(port, { method: 'POST', path, headers: { ...phone, origin: `https://${HOST}` }, body: { nope: 1 } })).status, 400);
});
test('a queued answer to a question that expired while the host slept gets EXPIRED', async (t) => {
  let now = Date.now();
  const { port, q } = await setup(t, { now: () => now });
  now = q.body.expiresAt + 1; // the expiry setup computed, not the clock captured before it
  const r = await call(port, { method: 'POST', path: `/v1/inbox/${q.id}/answer`, headers: { ...phone, origin: `https://${HOST}` }, body: answerBody() });
  assert.deepEqual([r.status, r.json.error.code, r.json.entry.state], [409, 'EXPIRED', 'expired']);
});
test('inbox listing, one entry, defer, presence, agents', async (t) => {
  const { port, q } = await setup(t), h = { ...local(port), origin: `http://127.0.0.1:${port}` };
  const list = await call(port, { path: '/v1/inbox', headers: h });
  assert.deepEqual(list.json.entries.map((e) => e.id), [q.id]); assert.equal(typeof list.json.seq, 'number');
  assert.equal((await call(port, { path: `/v1/inbox/${q.id}`, headers: h })).json.entry.id, q.id);
  assert.equal((await call(port, { path: `/v1/inbox/${uuid()}`, headers: h })).status, 404);
  const d = await call(port, { method: 'POST', path: `/v1/inbox/${q.id}/defer`, headers: h, body: {} });
  assert.deepEqual([d.status, d.json.entry.presentation], [200, 'desktop']);
  assert.equal((await call(port, { method: 'PUT', path: '/v1/presence', headers: h, body: { mode: 'here' } })).json.presence.mode, 'here');
  assert.equal((await call(port, { path: '/v1/presence', headers: h })).json.presence.mode, 'here');
  assert.deepEqual((await call(port, { path: '/v1/agents', headers: h })).json, { agents: [] });
});
test('an event stream closed while its registration is queued leaves no listener', { timeout: 10000 }, async (t) => {
  const paused = pauseWrites(); t.after(() => paused.release());
  const { port, q, inbox } = await setup(t, { io: paused.io }), baseline = inbox.subscribers();
  const hit = paused.pause(), withdrawing = inbox.withdraw(q.id, withdrawalMessage(q));
  await hit;
  const req = http.request({ host: '127.0.0.1', port, path: '/v1/events', headers: phone, agent: false });
  t.after(() => req.destroy()); req.on('error', () => {});
  // The response arrives after the service flushed its headers and queued the registration.
  const registered = new Promise((resolve) => req.on('response', () => resolve())); req.end();
  // The HTTP surface shows nothing when it sees the close, so 30 ms only favours the close-while-queued
  // path; the assertion below holds on either path and waits for it.
  try { await registered; req.destroy(); await new Promise((r) => setTimeout(r, 30)); }
  finally { paused.release(); }
  await withdrawing; await inbox.idle();
  await until(() => inbox.subscribers() === baseline, { what: 'the closed stream to leave no listener' });
});
// An SSE client that keeps every entry event it receives, as [id, entry id, state].
function eventStream(t, port, { path = '/v1/events', headers = {} } = {}) {
  const events = [], req = http.request({ host: '127.0.0.1', port, path, headers: { ...phone, ...headers }, agent: false });
  t.after(() => req.destroy()); req.on('error', () => {});
  req.on('response', (res) => {
    assert.equal(res.headers['content-type'], 'text/event-stream'); res.setEncoding('utf8');
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
      for (let end = data.indexOf('\n\n'); end !== -1; end = data.indexOf('\n\n')) {
        const block = data.slice(0, end); data = data.slice(end + 2);
        const fields = Object.fromEntries(block.split('\n').filter((line) => !line.startsWith(':')).map((line) => [line.slice(0, line.indexOf(': ')), line.slice(line.indexOf(': ') + 2)]));
        if (fields.event !== 'entry') continue;
        const entry = JSON.parse(fields.data);
        assert.equal(Number(fields.id), entry.seq);
        events.push([entry.seq, entry.id, entry.state]);
      }
    });
  });
  req.end();
  return { events, count: (n) => until(() => events.length >= n, { what: `${n} events on ${path}` }) };
}
// Spec §7.3 and acceptance 5: a resumed stream replays exactly the entries changed after its cursor,
// in order, then streams live changes. The cursor must exclude a non-terminal entry (kept) and a
// terminal one (closed), each last changed at or before it.
for (const [how, cursor] of [['Last-Event-ID', (mark) => ({ headers: { 'last-event-id': String(mark) } })], ['?since=', (mark) => ({ path: `/v1/events?since=${mark}` })]]) {
  test(`events: ${how} resumes after its cursor, replaying exactly the newer entries before live ones`, { timeout: 15000 }, async (t) => {
    const { port, q: older, inbox } = await setup(t);
    const fresh = () => questionMessage({ createdAt: Date.now(), body: { expiresAt: Date.now() + 3_600_000 } });
    const ask = (q) => inbox.ask(q, { handback: false, waiter: HANDLE });
    const kept = fresh(), closed = fresh(), later = fresh();
    await ask(kept); await ask(closed); await inbox.withdraw(closed.id, withdrawalMessage(closed));
    const mark = inbox.seq();
    assert.deepEqual([inbox.get(older.id).seq, inbox.get(kept.id).seq, inbox.get(closed.id).seq], [1, 2, mark]);
    await ask(later); await inbox.answer(older.id, answerMessage(older));
    const stream = eventStream(t, port, cursor(mark));
    await stream.count(2); // the replay is written in the same queued step that subscribes the stream
    await inbox.withdraw(later.id, withdrawalMessage(later));
    await stream.count(3);
    assert.deepEqual(stream.events, [[mark + 1, later.id, 'pending'], [mark + 2, older.id, 'answered'], [mark + 3, later.id, 'withdrawn']]);
    const listed = await call(port, { path: `/v1/inbox?since=${mark}`, headers: phone });
    assert.deepEqual(listed.json.entries.map((e) => [e.seq, e.id]), [[2, kept.id], [mark + 2, older.id], [mark + 3, later.id]]);
  });
}

test('configuration rejects lone, empty, malformed and explicitly invalid values before creating state', async (t) => {
  for (const env of [{ RELAY_SERVE_HOST: HOST }, { RELAY_SERVE_LOGIN: LOGIN }]) {
    assert.throws(() => serveConfig(env), { code: 'INVALID_CONFIG', message: /is required/ });
  }
  for (const env of [
    { RELAY_HTTP_PORT: '' }, { RELAY_HTTP_PORT: '0' }, { RELAY_HTTP_PORT: ' 3340' },
    { RELAY_SERVE_HOST: '', RELAY_SERVE_LOGIN: LOGIN }, { RELAY_SERVE_HOST: HOST, RELAY_SERVE_LOGIN: '' },
    { RELAY_SERVE_HOST: 'https://desk.tail.ts.net', RELAY_SERVE_LOGIN: LOGIN },
    { RELAY_SERVE_HOST: `${HOST}/evil`, RELAY_SERVE_LOGIN: LOGIN },
    { RELAY_SERVE_HOST: `${HOST}:70000`, RELAY_SERVE_LOGIN: LOGIN },
    { RELAY_SERVE_HOST: HOST, RELAY_SERVE_LOGIN: ' me@example.com' },
    { RELAY_CLIENT_DIR: '' }, { RELAY_CLIENT_DIR: null },
  ]) assert.throws(() => serveConfig({ RELAY_HTTP_PORT: '3340', ...env }), { code: 'INVALID_CONFIG' });
  const p = await tempState(t), dir = join(p.stateDir, 'not-created');
  await assert.rejects(runServe({ env: { RELAY_STATE_DIR: dir, RELAY_SERVE_HOST: HOST } }), { code: 'INVALID_CONFIG', message: /RELAY_SERVE_LOGIN/ });
  await assert.rejects(fs.stat(dir), { code: 'ENOENT' });
  assert.equal(serveConfig({ RELAY_HTTP_PORT: '3340', RELAY_SERVE_HOST: `${HOST}:8443`, RELAY_SERVE_LOGIN: LOGIN }).http.serveHost, `${HOST}:8443`);
});

test('any forwarding header triggers proxy classification and mutations use the exact local or ported origin', async (t) => {
  const cfg = { port: 3340, serveHost: HOST, serveLogin: LOGIN };
  for (const name of ['x-forwarded-port', 'x-forwarded-prefix', 'x-forwarded-anything', 'tailscale-user-login', 'tailscale-funnel-request']) {
    assert.equal(classify({ host: '127.0.0.1:3340', [name]: '' }, cfg).allowed, false, name);
  }
  const { port } = await setup(t);
  for (const origin of [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]) {
    const host = origin.slice(7);
    assert.equal((await call(port, { method: 'PUT', path: '/v1/presence', headers: { host, origin }, body: { mode: 'here' } })).status, 200);
    assert.equal((await call(port, { method: 'PUT', path: '/v1/presence', headers: { host, origin: 'http://localhost:9999' }, body: { mode: 'here' } })).status, 403);
  }
});

test('static reads reject encoded traversal, outside symlinks and directories, and never write files', async (t) => {
  const p = await tempState(t), dir = join(p.stateDir, 'client'); await fs.mkdir(dir);
  await fs.writeFile(join(dir, 'index.html'), '<p>inbox</p>');
  await fs.writeFile(join(p.stateDir, 'secret.txt'), 'secret');
  await fs.symlink(join(p.stateDir, 'secret.txt'), join(dir, 'outside.txt'));
  await fs.symlink('index.html', join(dir, 'inside.html'));
  await fs.mkdir(join(dir, 'folder'));
  const { port } = await setup(t, { clientDir: dir });
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/outside.txt', '/folder', '/%00', '/%zz']) {
    assert.equal((await call(port, { path, headers: phone })).status, 404, path);
  }
  assert.equal((await call(port, { path: '/inside.html', headers: phone })).text, '<p>inbox</p>');
  assert.equal((await call(port, { method: 'PUT', path: '/index.html', headers: { ...phone, origin: `https://${HOST}` }, body: { changed: true } })).status, 404);
  assert.equal(await fs.readFile(join(dir, 'index.html'), 'utf8'), '<p>inbox</p>');
});

test('remote authorization cannot spoof a local answer surface; decline and defer remain available', async (t) => {
  const a = await setup(t, { question: { class: 'authorization' } });
  const headers = { ...phone, origin: `https://${HOST}` }, path = `/v1/inbox/${a.q.id}/answer`;
  const refused = await call(a.port, { method: 'POST', path, headers, body: answerBody({ surface: 'desktop' }) });
  assert.deepEqual([refused.status, refused.json.error.code, refused.json.entry.state], [409, 'LOCAL_ONLY', 'pending']);
  const deferred = await call(a.port, { method: 'POST', path: `/v1/inbox/${a.q.id}/defer`, headers, body: { surface: 'cli' } });
  assert.deepEqual([deferred.status, deferred.json.entry.messages.at(-1).message.body.surface], [200, 'phone']);
  const declined = await call(a.port, { method: 'POST', path, headers, body: answerBody({ outcome: 'declined', values: {} }) });
  assert.deepEqual([declined.status, declined.json.entry.answer.body.surface, declined.json.entry.answer.body.outcome], [200, 'phone', 'declined']);
});

test('local answer preserves its full normalized envelope and point reads include terminal history', async (t) => {
  const { port, q, inbox } = await setup(t), body = answerBody();
  const r = await call(port, { method: 'POST', path: `/v1/inbox/${q.id}/answer`, headers: { ...local(port), origin: `http://127.0.0.1:${port}` }, body });
  const answer = r.json.entry.answer;
  assert.deepEqual([answer.schema, answer.kind, answer.correlationId, answer.from, answer.to, answer.context], [1, 'answer', q.id, { kind: 'user' }, q.from, q.context]);
  assert.equal(answer.body.answerId, body.answerId); assert.equal(answer.body.surface, 'desktop');
  await inbox.handed(q.id, HANDLE);
  await inbox.confirm({ harness: 'claude-code', callId: 'toolu_1', observed: { 'Which shape?': 'Square' } });
  const one = await call(port, { path: `/v1/inbox/${q.id}`, headers: phone });
  assert.equal(one.json.entry.state, 'consumed'); assert.deepEqual(one.json.entry.answer, answer);
});

test('invalid JSON, scalar bodies and non-JSON media types receive client errors', async (t) => {
  const { port, q } = await setup(t), headers = { ...phone, origin: `https://${HOST}`, 'content-type': 'application/json' };
  for (const rawBody of ['{', 'null', '[]', 'true']) {
    assert.equal((await call(port, { method: 'PUT', path: '/v1/presence', headers, rawBody })).status, 400, rawBody);
    assert.equal((await call(port, { method: 'POST', path: `/v1/inbox/${q.id}/defer`, headers, rawBody })).status, 400, rawBody);
  }
  assert.equal((await call(port, { method: 'PUT', path: '/v1/presence', headers: { ...headers, 'content-type': 'application/jsonp' }, body: { mode: 'here' } })).status, 415);
  assert.equal((await call(port, { method: 'PUT', path: '/v1/presence', headers, body: { mode: 'elsewhere' } })).status, 400);
});

test('an invalid SSE cursor is refused with 400 INVALID_INPUT instead of replaying from 0', { timeout: 5000 }, async (t) => {
  const { port, inbox } = await setup(t), baseline = inbox.subscribers();
  for (const [path, headers] of [['/v1/events', { 'last-event-id': 'abc' }], ['/v1/events', { 'last-event-id': '-1' }],
    ['/v1/events', { 'last-event-id': '1.5' }], ['/v1/events?since=abc', {}], ['/v1/events?since=-2', {}],
    ['/v1/events?since=0', { 'last-event-id': 'x' }],
    // Only plain decimal text is a cursor: Number() would read these as 0 or as another sequence.
    ...['', ' ', '0x10', '1e3', '+5', '5.0', '01'].flatMap((text) => [['/v1/events', { 'last-event-id': text }],
      [`/v1/events?since=${encodeURIComponent(text)}`, {}], [`/v1/inbox?since=${encodeURIComponent(text)}`, {}]])]) {
    const r = await call(port, { path, headers: { ...phone, ...headers } });
    assert.deepEqual([r.status, r.json?.error.code], [400, 'INVALID_INPUT'], `${path} ${JSON.stringify(headers)}`);
  }
  assert.equal(inbox.subscribers(), baseline);
});
test('routes match their entire path and absent static configuration is readonly 404', async (t) => {
  const { port, q } = await setup(t);
  for (const path of ['/', '/v1/inbox/extra/answer/extra', `/v1/inbox/${q.id}/extra/extra`, '/v1/agents/extra', '/v1/presence/extra', '/v1/events/extra']) {
    assert.equal((await call(port, { path, headers: phone })).status, 404, path);
  }
  assert.equal((await call(port, { method: 'POST', path: `/v1/inbox/${q.id}/seen`, headers: { ...phone, origin: `https://${HOST}` }, body: {} })).status, 404);
  assert.equal((await call(port, { method: 'POST', path: `/v1/inbox/${q.id}/seen`, headers: { ...phone, 'tailscale-funnel-request': '?1' }, body: {} })).status, 403);
});

function pauseWrites() {
  let next = null, release = () => {};
  const io = { ...fs, rename: async (from, to) => {
    if (next && to.endsWith('.json')) { const reached = next; next = null; const wait = new Promise((r) => { release = r; }); reached(); await wait; }
    return fs.rename(from, to);
  } };
  return { io, pause: () => new Promise((r) => { next = r; }), release: () => release() };
}

test('point GET waits for a queued supersession to commit both entries', { timeout: 10000 }, async (t) => {
  const paused = pauseWrites(); t.after(() => paused.release());
  const { port, q, inbox } = await setup(t, { io: paused.io });
  const replacement = questionMessage({ createdAt: Date.now(), body: { expiresAt: q.body.expiresAt, supersedes: q.id } });
  const reached = paused.pause(), replacing = inbox.ask(replacement, { handback: false, waiter: HANDLE });
  await reached;
  let finished = false;
  const read = nextCall(inbox, 'snapshot');
  const pending = call(port, { path: `/v1/inbox/${q.id}`, headers: phone }).then((r) => { finished = true; return r; });
  try {
    const { result } = await read; // the GET has reached the inbox, behind the half-committed supersession
    assert.equal(await settledYet(result), false); assert.equal(finished, false);
  } finally { paused.release(); }
  await replacing;
  assert.equal((await pending).json.entry.state, 'withdrawn');
});

test('close ends SSE and drains an accepted write before returning; repeated close is safe', { timeout: 10000 }, async (t) => {
  const paused = pauseWrites(); t.after(() => paused.release());
  const { port, q, inbox, srv } = await setup(t, { io: paused.io });
  const req = http.request({ host: '127.0.0.1', port, path: '/v1/events', headers: phone, agent: false });
  t.after(() => req.destroy()); req.on('error', () => {});
  let ended; const streamEnded = new Promise((resolve) => { ended = resolve; });
  const streaming = new Promise((resolve) => req.on('response', (res) => { res.once('end', ended); res.resume(); resolve(); })); req.end(); await streaming;
  const reached = paused.pause();
  const answering = call(port, { method: 'POST', path: `/v1/inbox/${q.id}/answer`, headers: { ...phone, origin: `https://${HOST}` }, body: answerBody() });
  await reached;
  let closed = false; const closing = srv.close().then(() => { closed = true; });
  try { await streamEnded; await turn(); await turn(); assert.equal(closed, false); } // close has ended the stream, and still waits for the write
  finally { paused.release(); }
  assert.equal((await answering).status, 200); await closing; await srv.close();
  assert.equal(inbox.subscribers(), 0); assert.equal(inbox.get(q.id).state, 'answered');
});

test('close releases a half-written request without a mutation', { timeout: 10000 }, async (t) => {
  const { port, inbox, srv } = await setup(t);
  const req = http.request({ host: '127.0.0.1', port, method: 'PUT', path: '/v1/presence',
    headers: { ...phone, origin: `https://${HOST}`, 'content-type': 'application/json', expect: '100-continue' }, agent: false });
  t.after(() => req.destroy()); req.on('error', () => {});
  // The service answers 100 Continue as it dispatches the request, so it is reading the body when it closes.
  const reading = new Promise((resolve) => req.once('continue', resolve)); req.flushHeaders();
  await reading; req.write('{');
  const closed = srv.close(); let timer;
  try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('HTTP close retained a half-written request')), CLOSE_DEADLINE_MS); })]); }
  finally { clearTimeout(timer); req.destroy(); await closed; }
  assert.equal(inbox.presence().mode, 'away');
});

test('agent display is filtered from the actual registry without mutating or pruning it', async (t) => {
  const p = await tempState(t);
  await applyEvent({ schema: 1, harness: 'claude-code', agentId: 'claude-code:s1', sessionId: 's1', kind: 'session-start', nativeEvent: 'SessionStart', cwd: '/project', tool: null }, {
    paths: p, resolveSessionPid: () => process.pid, gitContext: async () => ({ repoRoot: null, remote: null }),
  });
  const before = await fs.readFile(p.agentsPath);
  const abort = new AbortController(); let port;
  const occupied = http.createServer();
  await new Promise((r) => occupied.listen(0, '127.0.0.1', r)); port = occupied.address().port;
  await new Promise((r) => occupied.close(r));
  let ready; const started = new Promise((r) => { ready = r; });
  const run = runServe({ env: { RELAY_STATE_DIR: p.stateDir, RELAY_HTTP_PORT: String(port) }, signal: abort.signal, ready });
  t.after(async () => { abort.abort(); await run; });
  assert.equal((await started).httpPort, port);
  const r = await call(port, { path: '/v1/agents', headers: local(port) });
  assert.deepEqual(r.json, { agents: [{ id: 'claude-code:s1', harness: 'claude-code', project: 'project', state: 'idle' }] });
  assert.deepEqual(await fs.readFile(p.agentsPath), before);
  const client = await connectSocket(servePaths(p.stateDir).socketPath); t.after(() => client.close());
  assert.equal((await client.request('presence.get')).presence.mode, 'here');
  abort.abort(); await run;
  await assert.rejects(fs.stat(servePaths(p.stateDir).lockPath), { code: 'ENOENT' });
});

test('HTTP startup failure releases the service lock and closes the already-started socket', async (t) => {
  const p = await tempState(t), occupied = http.createServer();
  await new Promise((r) => occupied.listen(0, '127.0.0.1', r)); t.after(() => new Promise((r) => occupied.close(r)));
  const env = { RELAY_STATE_DIR: p.stateDir, RELAY_HTTP_PORT: String(occupied.address().port) };
  await assert.rejects(runServe({ env }), { code: 'EADDRINUSE' });
  await assert.rejects(fs.stat(servePaths(p.stateDir).lockPath), { code: 'ENOENT' });
  await assert.rejects(connectSocket(servePaths(p.stateDir).socketPath), { code: 'SERVE_UNAVAILABLE' });
});

test('close owns TCP connections even before a complete HTTP request arrives', { timeout: 10000 }, async (t) => {
  const { port, srv } = await setup(t);
  const sockets = [];
  for (const text of ['', 'GET /v1/inbox HTTP/1.1\r\nHost:']) {
    const socket = net.connect({ host: '127.0.0.1', port }); sockets.push(socket);
    socket.on('error', () => {}); t.after(() => socket.destroy());
    await new Promise((r) => socket.once('connect', r));
    if (text) socket.write(text);
  }
  const closed = srv.close();
  // On failure release the connections immediately rather than trapping the teardown.
  let timer;
  try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('HTTP close retained an incomplete connection')), CLOSE_DEADLINE_MS); })]); }
  finally { clearTimeout(timer); for (const socket of sockets) socket.destroy(); await closed; }
});

test('configuration accepts ordinary DNS hyphens without accepting leading or trailing label hyphens', () => {
  const env = { RELAY_HTTP_PORT: '3340', RELAY_SERVE_LOGIN: LOGIN };
  assert.equal(serveConfig({ ...env, RELAY_SERVE_HOST: 'my--desk.tail1234.ts.net' }).http.serveHost, 'my--desk.tail1234.ts.net');
  for (const host of ['-desk.tail.ts.net', 'desk-.tail.ts.net', 'desk.-tail.ts.net', 'desk.tail-.ts.net']) assert.throws(() => serveConfig({ ...env, RELAY_SERVE_HOST: host }), { code: 'INVALID_CONFIG' });
});

test('non-443 tailnet authority keeps its port in Host and mutation Origin', async (t) => {
  const authority = `${HOST}:8443`, { port, q } = await setup(t, { serveHost: authority });
  const path = `/v1/inbox/${q.id}/answer`;
  assert.equal((await call(port, { method: 'POST', path, headers: { ...phone, host: authority, origin: `https://${HOST}` }, body: answerBody() })).status, 403);
  assert.equal((await call(port, { path: '/v1/inbox', headers: phone })).status, 403);
  const r = await call(port, { method: 'POST', path, headers: { ...phone, host: authority, origin: `https://${authority}` }, body: answerBody() });
  assert.deepEqual([r.status, r.json.entry.answer.body.surface], [200, 'phone']);
});

test('list includes newer terminal entries and reports answer conflicts with their details', async (t) => {
  const { port, q, inbox } = await setup(t, { question: { artifact: { ref: 'doc:design', revision: 'r2' } } });
  const headers = { ...phone, origin: `https://${HOST}` }, path = `/v1/inbox/${q.id}/answer`;
  const stale = await call(port, { method: 'POST', path, headers, body: answerBody({ artifactRevision: 'r1' }) });
  assert.deepEqual([stale.status, stale.json.error.code, stale.json.revision, stale.json.entry.state], [409, 'STALE', 'r2', 'pending']);
  const invalid = await call(port, { method: 'POST', path, headers, body: answerBody({ artifactRevision: 'r2', values: {} }) });
  assert.deepEqual([invalid.status, invalid.json.error.code, invalid.json.entry.state], [409, 'INVALID_ANSWER', 'pending']);
  const mark = inbox.seq(); await inbox.withdraw(q.id, withdrawalMessage(q));
  assert.deepEqual((await call(port, { path: '/v1/inbox', headers: phone })).json.entries, []);
  const since = await call(port, { path: `/v1/inbox?since=${mark}`, headers: phone });
  assert.equal(since.json.entries[0].id, q.id); assert.equal(since.json.entries[0].state, 'withdrawn');
  const refused = await call(port, { method: 'POST', path, headers, body: answerBody({ artifactRevision: 'r2' }) });
  assert.deepEqual([refused.status, refused.json.error.code, refused.json.entry.state], [409, 'WITHDRAWN', 'withdrawn']);
});

test('static configuration must name an existing directory before a listener starts', async (t) => {
  const p = await tempState(t), file = join(p.stateDir, 'client-file'); await fs.writeFile(file, 'not a directory');
  let srv; t.after(() => srv?.close());
  const starting = serveHttp({ http: { port: 0, serveHost: null, serveLogin: null, clientDir: file } }).then((server) => { srv = server; return server; });
  await assert.rejects(starting, { code: 'INVALID_CONFIG' });
});

test('close drains a complete request before disposing its incomplete pipelined successor', { timeout: 10000 }, async (t) => {
  const paused = pauseWrites(); t.after(() => paused.release());
  const { port, q, inbox, srv } = await setup(t, { io: paused.io });
  const hit = paused.pause(), withdrawing = inbox.withdraw(q.id, withdrawalMessage(q)); await hit;
  const socket = net.connect({ host: '127.0.0.1', port }); t.after(() => socket.destroy()); socket.on('error', () => {});
  const disconnected = new Promise((r) => socket.once('close', r));
  let data = ''; socket.on('data', (chunk) => { data += chunk; });
  await new Promise((r) => socket.once('connect', r));
  const read = nextCall(inbox, 'snapshot');
  socket.write(`GET /v1/inbox/${q.id} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: keep-alive\r\n\r\nGET /v1/inbox HTTP/1.1\r\nHost:`);
  await read; await turn(); // the first request is parsed and waits in the inbox queue; its successor is still incomplete
  const closing = srv.close(); let timer;
  try {
    paused.release(); await withdrawing;
    await Promise.race([closing, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('HTTP close retained an incomplete pipelined request')), CLOSE_DEADLINE_MS); })]);
    await disconnected;
    assert.match(data, /HTTP\/1\.1 200/); assert.match(data, /"state":"withdrawn"/); assert.match(data, /\r\n0\r\n\r\n$/);
  } finally { clearTimeout(timer); paused.release(); socket.destroy(); await closing; }
});
