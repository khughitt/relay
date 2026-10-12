// A stand-in for a hook: asks one question and echoes every line it receives. stdin commands:
// "handed" sends handed for its own entry; "reattach" reconnects and asks again with the same id.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { connectSocket } from '../../src/serve/client.js';
import { createProcessOps } from '../../src/bus/proc.js';
import { validateHandle } from '../../src/protocol.js';
const [socketPath, messagePath, handback = 'false'] = process.argv.slice(2);
const message = JSON.parse(readFileSync(messagePath, 'utf8'));
const waiter = validateHandle(createProcessOps().handleOf(process.pid));
const out = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
let conn;
async function attach() {
  conn = await connectSocket(socketPath);
  conn.onPush(out); conn.closed.then(() => out({ type: 'closed' }));
  out({ type: 'response', op: 'ask', ...(await conn.request('ask', { message, waiter, handback: handback === 'true' })) });
}
await attach();
for await (const line of createInterface({ input: process.stdin })) {
  if (line === 'handed') conn.request('handed', { id: message.id, waiter }).then((r) => out({ type: 'response', op: 'handed', ...r }), (e) => out({ type: 'error', op: 'handed', code: e.code }));
  if (line === 'reattach') await attach().catch((e) => out({ type: 'error', op: 'ask', code: e.code }));
}
