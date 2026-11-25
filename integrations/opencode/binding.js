import { isAbsolute } from 'node:path';
import { relayError } from '../../src/protocol.js';
import { createWindow } from './window.js';
import { createQueue, spawnHook, logError } from '../forward/index.js';

export const LEVEL_EVENTS = new Set([
  'session.status', 'permission.updated', 'permission.replied',
]);

export function createBinding({ directory, pid = process.pid, spawn = (event, payload) => spawnHook('opencode', event, payload), env = process.env, report = (message) => logError('opencode-plugin.log', message, env) } = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw relayError('INVALID_INPUT', 'opencode requires an absolute project directory');

  const payload = { session_id: `opencode:${pid}`, cwd: directory };

  const queue = createQueue({ harness: 'opencode', run: (event) => spawn(event, payload), report });

  const guarded = (label, fn) => {
    try {
      fn();
    } catch (err) {
      try { Promise.resolve(report(`relay: opencode ${label} INVALID_INPUT`)).catch(() => {}); }
      catch { /* A broken reporter must not escape into the host dispatcher. */ }
    }
  };

  queue.push('init');
  const window = createWindow();

  function onEvent({ event } = {}) {
    const type = event?.type;

    if (type === 'session.error') {
      if (event.properties?.sessionID) queue.push('session.error');
      return;
    }

    if (!LEVEL_EVENTS.has(type)) return;
    guarded(type, () => {
      window.apply(event);
      queue.push(window.level());
    });
  }

  function onPermissionAsk(permission) {
    guarded('permission.ask', () => {
      window.apply({ type: 'permission.asked', properties: { id: permission?.id } });
      queue.push(window.level());
    });
  }

  async function dispose() {
    await queue.close('dispose');
  }

  return { onEvent, onPermissionAsk, dispose };
}
