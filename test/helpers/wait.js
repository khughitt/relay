// Waits that observe the work they wait for, instead of sleeping a fixed time and hoping it is done.

// Polls check() until it returns a truthy value, and returns that value. Fails once timeoutMs has
// passed, naming what it waited for.
export async function until(check, { timeoutMs = 10000, intervalMs = 10, what = 'the condition' } = {}) {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (performance.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// Resolves at the first call of object[method] whose arguments satisfy match, with those arguments
// and the call's result. The call itself runs unchanged, and the original method is restored at
// that call. Services look their inbox's methods up at call time, so this shows when a request has
// reached the inbox.
export function nextCall(object, method, match = () => true) {
  const original = object[method];
  return new Promise((resolve) => {
    object[method] = function spy(...args) {
      const result = original.apply(this, args);
      if (match(...args)) { object[method] = original; resolve({ args, result }); }
      return result;
    };
  });
}

// One full turn of the event loop: whatever I/O callback is running now has finished.
export const turn = () => new Promise((resolve) => setImmediate(resolve));
