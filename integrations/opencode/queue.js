
export function createQueue({ run, report }) {
  let tail = Promise.resolve();
  let closed = false;

  function push(event) {
    if (closed) throw new Error(`opencode: the queue is closed — refusing to enqueue ${event}`);

    tail = tail.then(async () => {
      try {
        await run(event);
      } catch (err) {
        try {
          const code = ['EAGAIN','ENOENT','PROCESS_UNAVAILABLE','INPUT_TIMEOUT','INPUT_TOO_LARGE','INVALID_INPUT'].includes(err?.code) ? err.code : 'PROCESS_UNAVAILABLE';
          await report(`relay: opencode ${event} ${code}`);
        } catch { /* the reporter itself is broken. Nothing to do but keep the queue alive. */ }
      }
    });

    return tail;
  }

  async function close(event) {
    if (closed) throw new Error('opencode: the queue is already closed');
    const done = push(event);
    closed = true;
    await done;
  }

  return { push, close };
}
