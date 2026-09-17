import { relayError } from '../../src/protocol.js';

const BUSY = new Set(['busy', 'retry']);   // retry is a sub-state of busy (processor.ts:665-671)

export function createWindow() {
  const busy = new Set();
  const permissions = new Set();

  function apply({ type, properties = {} }) {
    switch (type) {
      case 'session.status': {
        const kind = properties.status?.type;
        if (BUSY.has(kind)) busy.add(properties.sessionID);
        else if (kind === 'idle') busy.delete(properties.sessionID);
        else throw relayError('INVALID_INPUT', 'opencode: unknown session status');
        return;
      }
      case 'permission.asked':
      case 'permission.updated': permissions.add(properties.id); return;
      case 'permission.replied': permissions.delete(properties.permissionID); return;
      default:
        throw relayError('INVALID_INPUT', 'opencode: the window does not track this event');
    }
  }

  function level() {
    if (permissions.size) return 'permission.pending';
    if (busy.size) return 'session.busy';
    return 'session.idle';
  }

  return { apply, level };
}
