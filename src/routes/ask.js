import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { relayError, validateHandle } from '../protocol.js';
import { createProcessOps } from '../bus/proc.js';
import { paths } from '../bus/paths.js';
import { readSnapshot } from '../bus/transaction.js';
import { parsePayload, readNativeInput } from '../adapters/payload.js';
import { connectSocket } from '../serve/client.js';
import { toQuestion, allowReply, denyReply, observedAnswers } from './claude-code.js';

const DELAYS = [250, 500, 1000, 2000, 5000];
const quiet = Object.freeze({ stdout: '', stderr: '', exitCode: 0 });
const passthrough = (error) => ({ stdout: '', stderr: `relay ask: ${error?.code ?? 'ERROR'}: ${error?.message ?? String(error)}\n`, exitCode: 0 });
const reply = (value) => ({ stdout: `${JSON.stringify(value)}\n`, stderr: '', exitCode: 0 });
const WITHDRAWN = 'question withdrawn by the user; do not wait for an answer';
const EXPIRED = 'question expired before an answer arrived; do not wait for an answer';
const UNDELIVERABLE = 'saved answer could not be delivered before the question expired; do not wait for an answer';

// Failures leave the native question available; a saved handoff is acknowledged before stdout.
export async function runAsk({ nativeEvent, handback = false, stdin, socketPath, connect = connectSocket, processOps,
  clock = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), newId = randomUUID } = {}) {
  try {
    if (!['PreToolUse', 'PostToolUse'].includes(nativeEvent)) throw relayError('INVALID_INPUT', 'unsupported ask hook event');
    const payload = parsePayload(await readNativeInput(stdin), nativeEvent);
    if (nativeEvent === 'PostToolUse') return await confirm({ payload, socketPath, connect });
    processOps ??= createProcessOps();
    const registry = await readSnapshot({ paths: paths({ RELAY_STATE_DIR: dirname(socketPath) }), processOps });
    const project = registry?.agents[`claude-code:${payload.session_id}`]?.projectKey ?? null;
    const question = toQuestion(payload, { now: clock(), id: newId(), project });
    const waiter = validateHandle(processOps.handleOf(process.pid));
    let conn = await connect(socketPath);
    for (let attempt = 0; ;) {
      const outcome = await attend(conn, { question, waiter, handback, payload });
      if (outcome) return outcome;
      // Claude's outer timeout bounds reconnects; the immutable question and waiter survive them.
      for (;;) {
        await sleep(DELAYS[Math.min(attempt++, DELAYS.length - 1)]);
        try { conn = await connect(socketPath); attempt = 0; break; } catch { /* still down */ }
      }
    }
  } catch (error) { return passthrough(error); }
}

// null means the service closed before acknowledging a reply: reattach and resume the handoff.
function attend(conn, { question, waiter, handback, payload }) {
  return new Promise((resolve) => {
    let busy = false, finished = false;
    const finish = (result) => { if (finished) return; finished = true; stop(); conn.close(); resolve(result); };
    const lost = () => { if (finished) return; finished = true; stop(); conn.close(); resolve(null); };
    async function act(entry) {
      if (finished || busy || entry?.id !== question.id) return;
      try {
        switch (entry.state) {
          case 'pending': return;
          case 'answered': case 'handed': case 'unconfirmed': case 'consumed': {
            busy = true;
            let r;
            try { r = await conn.request('handed', { id: entry.id, waiter }); } catch { return lost(); }
            if (finished) return;
            if (!r.ok && r.error.code === 'UNDELIVERABLE') return finish(handback ? quiet : reply(denyReply(UNDELIVERABLE)));
            if (!r.ok) return finish(passthrough(relayError(r.error.code, r.error.message)));
            return finish(reply(allowReply(payload, question, r.entry.answer.body)));
          }
          case 'released': return finish(quiet);
          case 'expired': return finish(handback ? quiet : reply(denyReply(EXPIRED)));
          case 'undeliverable': return finish(handback ? quiet : reply(denyReply(UNDELIVERABLE)));
          case 'withdrawn': return finish(reply(denyReply(WITHDRAWN)));
          default: return finish(passthrough(relayError('UNEXPECTED_STATE', `question is ${entry.state}`)));
        }
      } catch (error) { finish(passthrough(error)); }
    }
    const stop = conn.onPush((message) => { if (message.type === 'state') act(message.entry); });
    conn.closed.then(lost);
    conn.request('ask', { message: question, waiter, handback }).then((r) => {
      if (finished) return;
      if (r.passthrough) return finish(quiet);
      if (!r.ok) return finish(passthrough(relayError(r.error.code, r.error.message)));
      return act(r.entry);
    }, lost).catch((error) => finish(passthrough(error)));
  });
}

async function confirm({ payload, socketPath, connect }) {
  if (payload.tool_name !== 'AskUserQuestion' || typeof payload.tool_use_id !== 'string' || !payload.tool_use_id.trim()) {
    throw relayError('INVALID_INPUT', 'PostToolUse is not an AskUserQuestion call');
  }
  const observed = observedAnswers(payload), conn = await connect(socketPath);
  try {
    const r = await conn.request('confirm', { harness: 'claude-code', callId: payload.tool_use_id, observed });
    return r.ok || r.error.code === 'NOT_FOUND' ? quiet : passthrough(relayError(r.error.code, r.error.message));
  } finally { conn.close(); }
}
