
export function createQueue({ harness, run, report }) {
  let tail = Promise.resolve();
  let closed = false;
  let enqueued = 0, discarded = 0;

  function push(event, payload) {
    if (closed) throw new Error(`${harness}: the queue is closed — refusing to enqueue ${event}`);

    const position = ++enqueued;
    tail = tail.then(async () => {
      if (position <= discarded) return;
      try {
        await run(event, payload);
      } catch (err) {
        try {
          const code = ['EAGAIN','ENOENT','PROCESS_UNAVAILABLE','INPUT_TIMEOUT','INPUT_TOO_LARGE','INVALID_INPUT'].includes(err?.code) ? err.code : 'PROCESS_UNAVAILABLE';
          await report(`relay: ${harness} ${event} ${code}`);
        } catch { /* the reporter itself is broken. Nothing to do but keep the queue alive. */ }
      }
    });

    return tail;
  }

  // Takes a last event, or none, and waits for everything before it. With patienceMs, events still
  // unstarted after that long are dropped; the one running and the last event are not.
  async function close(event, payload, { patienceMs } = {}) {
    if (closed) throw new Error(`${harness}: the queue is already closed`);
    const before = enqueued;
    const done = event === undefined ? tail : push(event, payload);
    closed = true;
    const timer = patienceMs === undefined ? null : setTimeout(() => { discarded = before; }, patienceMs);
    try { await done; }
    finally { if (timer !== null) clearTimeout(timer); }
  }

  return { push, close };
}
