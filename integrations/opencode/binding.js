import { join, isAbsolute } from 'node:path';
import { appendFile } from 'node:fs/promises';
import { paths } from '../../src/bus/paths.js';
import { ensurePrivateDir, checkPrivate } from '../../src/bus/store.js';
import { relayError } from '../../src/protocol.js';
import { createWindow } from './window.js';
import { createQueue } from './queue.js';
import { spawnHook } from './hook.js';

export const LEVEL_EVENTS = new Set([
  'session.status', 'permission.updated', 'permission.replied',
]);

export function createBinding({ directory, pid = process.pid, spawn = spawnHook, env = process.env, report = (message) => logError(message, env) } = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw relayError('INVALID_INPUT', 'opencode requires an absolute project directory');

  const payload = { session_id: `opencode:${pid}`, cwd: directory };

  const queue = createQueue({ run: (event) => spawn(event, payload), report });

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

// Diagnostics never inherit the TUI's stderr. Callers supply only sanitized codes.
export async function logError(message, env = process.env) {
  const { stateDir } = paths(env), path = join(stateDir, 'opencode-plugin.log');
  await ensurePrivateDir(stateDir);
  await checkPrivate(path, false);
  await appendFile(path, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
}
