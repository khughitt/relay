import { createQueue, spawnHook, logError } from '../forward/index.js';

/** Maps one pi extension instance, which serves one session, onto relay hook events. */
export function bind(pi, { spawn = (event, payload) => spawnHook('pi', event, payload), env = process.env,
  report = (message) => logError('pi-extension.log', message, env) } = {}) {
  const queue = createQueue({ harness: 'pi', run: spawn, report });
  let closed = false, failed = false;

  // pi invalidates the context once a session is replaced, so it is read here and never in a job.
  // No return value: pi would read one as the handler's result.
  function forward(event, ctx) {
    if (closed) return;
    try { queue.push(event, { session_id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd }); }
    catch { reportInvalid(event); }
  }
  function reportInvalid(event) {
    try { Promise.resolve(report(`relay: pi ${event} INVALID_INPUT`)).catch(() => {}); }
    catch { /* A broken reporter must not escape into pi's event dispatch. */ }
  }

  pi.on('session_start', (_event, ctx) => { forward('session_start', ctx); });
  pi.on('agent_start', (_event, ctx) => { forward('agent_start', ctx); });
  // agent_settled does not say how its run ended. A retried error is followed by another agent_end.
  pi.on('agent_end', (event) => { failed = event.messages.findLast((m) => m.role === 'assistant')?.stopReason === 'error'; });
  pi.on('agent_settled', (event, ctx) => {
    forward(event.aborted ? 'agent_settled:aborted' : failed ? 'agent_settled:error' : 'agent_settled', ctx);
    failed = false;
  });
  // pi awaits this handler. Quitting mid-turn shuts down before the run settles, so nothing is taken
  // afterwards. A reload keeps the session: only what is queued must land before its next instance starts.
  pi.on('session_shutdown', async (event, ctx) => {
    if (event.reason !== 'reload') forward('session_shutdown', ctx);
    closed = true;
    await queue.drain();
  });
}
