import { createProcessOps } from '../bus/proc.js';
import { relayError } from '../protocol.js';

export const events = Object.freeze({
  'SessionStart': Object.freeze({ kind: 'session-start', level: 'idle' }),
  'UserPromptSubmit': Object.freeze({ kind: 'prompt', level: 'working' }),
  'PreToolUse': Object.freeze({ kind: 'before-tool', level: 'working' }),
  'Stop': Object.freeze({ kind: 'turn-end', level: 'done' }),
  'SessionEnd': Object.freeze({ kind: 'session-end', level: null }),
  'PermissionRequest': Object.freeze({ kind: 'needs-approval', level: 'needs-approval' }),
});
export function stateForEvent(event) {
  if (!Object.hasOwn(events, event)) throw relayError('UNSUPPORTED_EVENT', 'unsupported harness event');
  return events[event].level;
}
export const reduceState = (level) => level;
// Preserve the measured terminal ancestor predicate; the hook itself is index zero.
export function resolveAgentPid({ startPid = process.pid, ancestors = (pid) => createProcessOps().ancestors(pid) } = {}) {
  return ancestors(startPid).find((p, i) => i > 0 && p.comm === 'codex' && p.tty !== null)?.pid ?? null;
}
