import { createProcessOps } from '../bus/proc.js';
import { relayError } from '../protocol.js';
import { encodeStandardReply } from './reply.js';

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
// Reply channels verified against the Codex hooks reference on 2026-09-17. PermissionRequest
// uses a different decision object and stays unexposed in v1.
export const replies = Object.freeze({
  'UserPromptSubmit': Object.freeze({ refuse: true, context: true }),
  'PreToolUse': Object.freeze({ refuse: true, context: true }),
  'Stop': Object.freeze({ refuse: true, context: false }),
});
// SessionEnd and Interrupt default to one second and cap at three.
export const outerTimeouts = Object.freeze({ default: 600000, SessionEnd: 1000, max: Object.freeze({ SessionEnd: 3000 }) });
export const encodeReply = (nativeEvent, reply) => encodeStandardReply(nativeEvent, reply, replies[nativeEvent]);
// Preserve the measured terminal ancestor predicate; the hook itself is index zero.
export function resolveAgentPid({ startPid = process.pid, ancestors = (pid) => createProcessOps().ancestors(pid) } = {}) {
  return ancestors(startPid).find((p, i) => i > 0 && p.comm === 'codex' && p.tty !== null)?.pid ?? null;
}
