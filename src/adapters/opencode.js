import { createProcessOps } from '../bus/proc.js';
import { relayError } from '../protocol.js';

export const events = Object.freeze({
  'init': Object.freeze({ kind: 'session-start', level: 'idle' }),
  'session.busy': Object.freeze({ kind: 'activity', level: 'working' }),
  'permission.pending': Object.freeze({ kind: 'needs-approval', level: 'needs-approval' }),
  'session.error': Object.freeze({ kind: 'turn-error', level: 'error' }),
  'session.idle': Object.freeze({ kind: 'idle', level: 'idle' }),
  'dispose': Object.freeze({ kind: 'session-end', level: null }),
});
export function stateForEvent(event) {
  if (!Object.hasOwn(events, event)) throw relayError('UNSUPPORTED_EVENT', 'unsupported harness event');
  return events[event].level;
}
const ACTIVE = new Set(['working', 'needs-input', 'needs-approval']);
export function reduceState(level, previous) {
  if (level !== 'idle') return level;
  if (previous === 'error') return 'error';
  return ACTIVE.has(previous) ? 'done' : 'idle';
}
// Preserve the measured terminal ancestor predicate; the hook itself is index zero.
export function resolveAgentPid({ startPid = process.pid, ancestors = (pid) => createProcessOps().ancestors(pid) } = {}) {
  return ancestors(startPid).find((p, i) => i > 0 && p.comm === 'opencode' && p.tty !== null)?.pid ?? null;
}
