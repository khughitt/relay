// @ts-check
// Newline-delimited JSON framing; only private service replies bypass the request cap.
export const LINE_LIMIT = 1024 * 1024;
/** @param {import("node:net").Socket} socket @param {(line: string) => void} onLine */
export function lineReader(socket, onLine, limit = LINE_LIMIT) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i !== -1; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i);
      if (Buffer.byteLength(line) > limit) { socket.destroy(); return; }
      buffer = buffer.slice(i + 1);
      if (line.trim()) onLine(line);
      if (socket.destroyed) return;
    }
    if (Buffer.byteLength(buffer) > limit) socket.destroy();
  });
}
