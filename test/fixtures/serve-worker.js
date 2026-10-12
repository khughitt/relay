// relay serve in a child, for process tests. Env: RELAY_STATE_DIR (required), CLOCK_OFFSET_MS,
// REATTACH_MS, CRASH_ON (an entry state: SIGKILL right after that state is persisted).
import { runServe } from '../../src/serve/serve.js';
const offset = Number(process.env.CLOCK_OFFSET_MS ?? 0);
const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
await runServe({ env: process.env, signal: controller.signal, clock: () => Date.now() + offset,
  reattachMs: Number(process.env.REATTACH_MS ?? 10000),
  onCommit: (entry) => { if (process.env.CRASH_ON === entry.state) process.kill(process.pid, 'SIGKILL'); },
  ready: (info) => process.stdout.write(`${JSON.stringify({ type: 'ready', ...info })}\n`) });
process.stdout.write(`${JSON.stringify({ type: 'stopped' })}\n`);
