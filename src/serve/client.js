import net from 'node:net';
import { relayError } from '../protocol.js';
import { lineReader } from './lines.js';
// A client of relay serve's local socket: request/response by reqId, everything else a push.
export function connectSocket(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once('error', (cause) => reject(relayError('SERVE_UNAVAILABLE', 'relay serve is not running', cause)));
    socket.once('connect', () => { socket.removeAllListeners('error'); resolve(wrap(socket)); });
  });
}
function wrap(socket) {
  let next = 1, closed = false;
  const pending = new Map(), pushes = new Set();
  // A socket error is always followed by close, which rejects what is pending.
  socket.on('error', () => {});
  lineReader(socket, (line) => {
    let message;
    try { message = JSON.parse(line); } catch { socket.destroy(); return; }
    const waiting = message.reqId != null ? pending.get(message.reqId) : undefined;
    if (waiting) { pending.delete(message.reqId); waiting.resolve(message); return; }
    for (const fn of pushes) fn(message);
  }, Infinity);
  const closedPromise = new Promise((resolve) => socket.once('close', () => {
    closed = true;
    for (const { reject } of pending.values()) reject(relayError('SERVE_UNAVAILABLE', 'connection to relay serve closed'));
    pending.clear(); resolve();
  }));
  return {
    request(op, fields = {}) {
      if (closed) return Promise.reject(relayError('SERVE_UNAVAILABLE', 'connection to relay serve closed'));
      const reqId = next++;
      return new Promise((resolve, reject) => { pending.set(reqId, { resolve, reject }); socket.write(`${JSON.stringify({ ...fields, reqId, op })}\n`); });
    },
    onPush(fn) { pushes.add(fn); return () => pushes.delete(fn); },
    closed: closedPromise,
    close() { socket.end(); },
  };
}
