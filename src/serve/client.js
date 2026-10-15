// @ts-check
import net from 'node:net';
import { relayError } from '../protocol.js';
import { lineReader } from './lines.js';
// A client of relay serve's local socket: request/response by reqId, everything else a push.
/** @param {string} socketPath @returns {Promise<ReturnType<typeof wrap>>} */
export function connectSocket(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once('error', (cause) => reject(relayError('SERVE_UNAVAILABLE', 'relay serve is not running', cause)));
    socket.once('connect', () => { socket.removeAllListeners('error'); resolve(wrap(socket)); });
  });
}
/** @param {import("node:net").Socket} socket */
function wrap(socket) {
  let next = 1, closed = false;
  /** @type {Map<number, {resolve: (value: unknown) => void, reject: (error: Error) => void}>} */
  const pending = new Map();
  /** @type {Set<(message: import("../types.js").SocketPush) => void>} */
  const pushes = new Set();
  // A socket error is always followed by close, which rejects what is pending.
  socket.on('error', () => {});
  lineReader(socket, (line) => {
    let message;
    try { message = JSON.parse(line); } catch { socket.destroy(); return; }
    const waiting = message.reqId != null ? pending.get(message.reqId) : undefined;
    if (waiting) { pending.delete(message.reqId); waiting.resolve(message); return; }
    for (const fn of pushes) fn(message);
  }, Infinity);
  /** @type {Promise<void>} */
  const closedPromise = new Promise((resolve) => socket.once('close', () => {
    closed = true;
    for (const { reject } of pending.values()) reject(relayError('SERVE_UNAVAILABLE', 'connection to relay serve closed'));
    pending.clear(); resolve();
  }));
  return {
    /** @template {keyof import("../types.js").SocketResponses} K @param {K} op @param {Record<string, unknown>} [fields] @returns {Promise<import("../types.js").SocketReply<import("../types.js").SocketResponses[K]>>} */
    request(op, fields = {}) {
      if (closed) return Promise.reject(relayError('SERVE_UNAVAILABLE', 'connection to relay serve closed'));
      const reqId = next++;
      return new Promise((resolve, reject) => { pending.set(reqId, { resolve: (value) => resolve(/** @type {import("../types.js").SocketReply<import("../types.js").SocketResponses[K]>} */ (value)), reject }); socket.write(`${JSON.stringify({ ...fields, reqId, op })}\n`); });
    },
    /** @param {(message: import("../types.js").SocketPush) => void} fn */
    onPush(fn) { pushes.add(fn); return () => pushes.delete(fn); },
    closed: closedPromise,
    close() { socket.end(); },
  };
}
