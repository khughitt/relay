import { openSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { ReadStream, WriteStream } from 'node:tty';
// A hidden paste, read chunk by chunk in raw mode. A pasted token followed by Enter can arrive
// as one chunk (text and the newline together), so the text before the newline is kept.
// Whitespace before the first character of a chunk that carries text is dropped, so a paste
// that starts with a newline is not read as Enter; Enter alone still reads as empty (skip).
// Ctrl-C reads as empty.
export async function readHidden(chunks) {
  let value = '';
  for await (const chunk of chunks) {
    let s = String(chunk);
    if (s.includes('\u0003')) return '';
    if (!value && s.trim()) s = s.trimStart();
    const nl = s.search(/[\r\n]/);
    if (nl === -1) { value += s; continue; }
    value += s.slice(0, nl);
    break;
  }
  return value.trim();
}
export async function ask(question, { hidden = false } = {}) {
  let fd; try { fd = openSync('/dev/tty', 'r+'); } catch { return null; }
  const input = new ReadStream(fd), output = new WriteStream(fd);
  try {
    if (hidden) input.setRawMode(true);
    output.write(question);
    if (!hidden) {
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
    }
    const value = await readHidden(input);
    // Never the token itself: its length lets the user see a short (e.g. hard-wrapped) paste.
    output.write(`\nreceived ${value.length} characters\n`);
    return value;
  } finally {
    if (hidden) input.setRawMode(false);
    // input.destroy()/output.destroy() already close the shared fd; a further closeSync
    // here would close it a second (or, with both streams, a third) time.
    input.destroy();
    output.destroy();
  }
}
