
export function createQueue({ harness, run, report }) {
  let tail = Promise.resolve();
  let closed = false;

  function push(event, payload) {
    if (closed) throw new Error(`${harness}: the queue is closed — refusing to enqueue ${event}`);

    tail = tail.then(async () => {
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

  async function close(event, payload) {
    if (closed) throw new Error(`${harness}: the queue is already closed`);
    const done = push(event, payload);
    closed = true;
    await done;
  }

  // Everything enqueued so far; a job's failure is reported, never thrown.
  const drain = () => tail;

  return { push, close, drain };
}
