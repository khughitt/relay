import http from 'node:http';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { relayError } from '../protocol.js';
import { validateMessage } from '../interaction/message.js';
import { classify } from './guard.js';
const BODY_LIMIT = 64 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const STATUS = { NOT_FOUND: 404, INVALID_MESSAGE: 400, INVALID_INPUT: 400, INVALID_ANSWER: 409, TOO_LARGE: 413 };
const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value));
};
const fail = (res, status, code, message, extra = {}) => json(res, status, { error: { code, message }, ...extra });
// A sequence cursor in a query or header: a present value that is not a nonnegative safe integer is refused.
function sequence(text, name) {
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0) throw relayError('INVALID_INPUT', `${name} must be a nonnegative sequence`);
  return value;
}
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > BODY_LIMIT) { req.resume(); throw relayError('TOO_LARGE', 'body over 64 KiB'); }
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (cause) { throw relayError('INVALID_INPUT', 'body is not JSON', cause); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw relayError('INVALID_INPUT', 'body must be a JSON object');
  return body;
}
const reply = (res, result) => result.error
  ? fail(res, STATUS[result.error.code] ?? 409, result.error.code, result.error.message ?? result.error.code, { entry: result.entry ?? null,
    ...(result.error.answer ? { answer: result.error.answer } : {}), ...(result.error.revision ? { revision: result.error.revision } : {}) })
  : json(res, 200, { entry: result.entry });
export async function serveHttp({ inbox, http: cfg, readAgents, clock = Date.now, log }) {
  let port = cfg.port, closing = false, closed;
  const pending = new Set(), requests = new Set(), streams = new Set(), sockets = new Set();
  const root = cfg.clientDir ? await fs.realpath(cfg.clientDir) : null;
  if (root && !(await fs.stat(root)).isDirectory()) throw relayError('INVALID_CONFIG', 'RELAY_CLIENT_DIR must name a directory');
  const message = (entry, kind, body) => validateMessage({ schema: 1, id: randomUUID(), kind, correlationId: entry.id, from: { kind: 'user' },
    to: entry.question.from, createdAt: clock(), context: entry.question.context, body });
  const entry = async (id) => (await inbox.snapshot({ since: 0 })).entries.find((e) => e.id === id);
  async function question(res, id) {
    const e = await entry(id);
    if (!e || e.kind !== 'question') { fail(res, 404, 'NOT_FOUND', 'no such question'); return null; }
    return e;
  }
  async function staticFile(res, pathname) {
    if (!root) return fail(res, 404, 'NOT_FOUND', 'not found');
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return fail(res, 404, 'NOT_FOUND', 'not found'); }
    if (decoded.split('/').includes('..') || decoded.includes('\0')) return fail(res, 404, 'NOT_FOUND', 'not found');
    const file = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
    const inside = (path) => path.startsWith(root.endsWith(sep) ? root : root + sep);
    if (!inside(file)) return fail(res, 404, 'NOT_FOUND', 'not found');
    let data, target;
    try {
      target = await fs.realpath(file);
      if (!inside(target) || !(await fs.stat(target)).isFile()) return fail(res, 404, 'NOT_FOUND', 'not found');
      data = await fs.readFile(target);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EINVAL'].includes(error.code)) throw error;
      return fail(res, 404, 'NOT_FOUND', 'not found');
    }
    res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(data);
  }
  async function events(req, res, url) {
    const header = req.headers['last-event-id'];
    const since = header !== undefined ? sequence(header, 'Last-Event-ID')
      : url.searchParams.has('since') ? sequence(url.searchParams.get('since'), 'since') : 0;
    streams.add(res);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.flushHeaders();
    let ping, unsubscribe;
    const stop = () => { clearInterval(ping); unsubscribe?.(); streams.delete(res); };
    res.once('close', stop);
    const write = (event) => {
      if (res.destroyed || res.writableEnded) return;
      if (event.type === 'entry') res.write(`id: ${event.entry.seq}\nevent: entry\ndata: ${JSON.stringify(event.entry)}\n\n`);
      else res.write(`event: presence\ndata: ${JSON.stringify(event.presence)}\n\n`);
    };
    ({ unsubscribe } = await inbox.watch(since, write));
    if (res.destroyed || res.writableEnded || closing) { stop(); res.end(); }
    else ping = setInterval(() => res.write(': ping\n\n'), 25000);
  }
  async function route(req, res) {
    const verdict = classify(req.headers, { port, serveHost: cfg.serveHost, serveLogin: cfg.serveLogin });
    if (!verdict.allowed) return fail(res, 403, 'FORBIDDEN', 'forbidden');
    if (!req.url.startsWith('/')) return fail(res, 404, 'NOT_FOUND', 'not found');
    const url = new URL(req.url, 'http://relay'), pathname = req.url.split('?')[0];
    const mutation = req.method === 'POST' || req.method === 'PUT';
    if (mutation) {
      if (req.headers.origin !== verdict.origin) return fail(res, 403, 'FORBIDDEN', 'origin mismatch');
      if ((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') return fail(res, 415, 'UNSUPPORTED_MEDIA', 'JSON only');
    }
    if (!pathname.startsWith('/v1/')) return req.method === 'GET' ? staticFile(res, pathname) : fail(res, 404, 'NOT_FOUND', 'not found');
    if (req.method === 'GET' && pathname === '/v1/inbox') {
      const since = url.searchParams.has('since') ? sequence(url.searchParams.get('since'), 'since') : undefined;
      return json(res, 200, await inbox.snapshot({ since }));
    }
    const match = /^\/v1\/inbox\/([^/]+)(?:\/(answer|defer))?$/.exec(pathname);
    if (req.method === 'GET' && match && !match[2]) {
      const e = await entry(match[1]); return e ? json(res, 200, { entry: e }) : fail(res, 404, 'NOT_FOUND', 'no such entry');
    }
    if (req.method === 'GET' && pathname === '/v1/events') return events(req, res, url);
    if (req.method === 'GET' && pathname === '/v1/presence') return json(res, 200, { presence: inbox.presence() });
    if (req.method === 'GET' && pathname === '/v1/agents') {
      const snapshot = await readAgents();
      return json(res, 200, { agents: Object.values(snapshot?.agents ?? {}).map((a) => ({ id: a.id, harness: a.harness, project: a.project, state: a.state })) });
    }
    if (req.method === 'PUT' && pathname === '/v1/presence') return json(res, 200, { presence: await inbox.setPresence((await readBody(req)).mode) });
    if (req.method === 'POST' && match?.[2]) {
      const body = await readBody(req), e = await question(res, match[1]); if (!e) return;
      const m = message(e, match[2], { ...body, surface: verdict.surface });
      return reply(res, await inbox[match[2]](e.id, m));
    }
    return fail(res, 404, 'NOT_FOUND', 'not found');
  }
  const server = http.createServer((req, res) => {
    if (closing) { res.setHeader('connection', 'close'); return fail(res, 503, 'UNAVAILABLE', 'service closing'); }
    requests.add(req); res.once('close', () => requests.delete(req));
    res.once('finish', () => {
      requests.delete(req);
      if (closing && ![...requests].some((r) => r.socket === req.socket && r.complete)) req.socket.destroySoon();
    });
    const run = route(req, res).catch((error) => {
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      if (STATUS[error.code]) return fail(res, STATUS[error.code], error.code, error.message);
      log(`${error.code ?? 'ERROR'}: ${error.message}`);
      return fail(res, 500, 'INTERNAL', 'internal error');
    });
    pending.add(run); run.finally(() => pending.delete(run));
  });
  server.on('connection', (socket) => {
    if (closing) { socket.destroy(); return; }
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (error) { await new Promise((resolve) => server.close(resolve)); throw error; }
  port = server.address().port;
  return {
    port,
    close() {
      return closed ??= (async () => {
        closing = true;
        const stopped = new Promise((resolve) => server.close(resolve));
        for (const res of streams) res.end();
        const active = new Set([...requests].filter((req) => req.complete).map((req) => req.socket));
        // Node 22 keeps connections with incomplete HTTP headers open after server.close().
        for (const socket of sockets) if (!active.has(socket)) socket.destroy();
        server.closeIdleConnections();
        await Promise.allSettled([...pending]);
        await stopped;
      })();
    },
  };
}
