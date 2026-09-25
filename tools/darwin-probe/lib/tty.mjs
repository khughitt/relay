import { openSync, closeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { ReadStream, WriteStream } from 'node:tty';
export async function ask(question, { hidden = false } = {}) {
  let fd; try { fd = openSync('/dev/tty', 'r+'); } catch { return null; }
  const input = new ReadStream(fd), output = new WriteStream(fd);
  try {
    if (hidden) input.setRawMode(true);
    output.write(question);
    if (!hidden) { const rl = createInterface({ input, output, terminal: false }); const line = await new Promise((r) => rl.once('line', r)); rl.close(); return line.trim(); }
    let value = '';
    for await (const chunk of input) { const s = String(chunk); if (s.includes('\r') || s.includes('\n')) break; if (s === '\u0003') { value = ''; break; } value += s; }
    output.write('\n'); return value.trim();
  } finally { if (hidden) input.setRawMode(false); input.destroy(); output.destroy(); try { closeSync(fd); } catch {} }
}
