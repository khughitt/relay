import { openSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { ReadStream, WriteStream } from 'node:tty';
export async function ask(question) {
  let fd; try { fd = openSync('/dev/tty', 'r+'); } catch { return null; }
  const input = new ReadStream(fd), output = new WriteStream(fd);
  try {
    output.write(question);
    const rl = createInterface({ input, output, terminal: false });
    // EOF (Ctrl-D, or the stream erroring) never fires 'line'; without a 'close'/'error'
    // fallback this promise — and the whole stage — would hang forever.
    const line = await new Promise((resolve) => {
      rl.once('line', resolve);
      rl.once('close', () => resolve(null));
      input.once('error', () => resolve(null));
    });
    rl.close();
    return line === null ? null : line.trim();
  } finally {
    // input.destroy()/output.destroy() already close the shared fd; a further closeSync
    // here would close it a second (or, with both streams, a third) time.
    input.destroy();
    output.destroy();
  }
}
