import { createProcessOps } from '../bus/proc.js';
import { relayError } from '../protocol.js';
import { encodeStandardReply } from './reply.js';

export const events = Object.freeze({
  'SessionStart': Object.freeze({ kind: 'session-start', level: 'idle' }),
  'UserPromptSubmit': Object.freeze({ kind: 'prompt', level: 'working' }),
  'PreToolUse': Object.freeze({ kind: 'before-tool', level: 'working' }),
  'Stop': Object.freeze({ kind: 'turn-end', level: 'done' }),
  'SessionEnd': Object.freeze({ kind: 'session-end', level: null }),
  'Notification:idle_prompt': Object.freeze({ kind: 'needs-input', level: 'needs-input' }),
  'Notification:permission_prompt': Object.freeze({ kind: 'needs-approval', level: 'needs-approval' }),
  'StopFailure': Object.freeze({ kind: 'turn-error', level: 'error' }),
});
export function stateForEvent(event) {
  if (!Object.hasOwn(events, event)) throw relayError('UNSUPPORTED_EVENT', 'unsupported harness event');
  return events[event].level;
}
export const reduceState = (level) => level;
// Reply channels verified against the Claude hooks reference on 2026-09-17: PreToolUse,
// UserPromptSubmit and Stop block; only the first two carry additionalContext.
export const replies = Object.freeze({
  'UserPromptSubmit': Object.freeze({ refuse: true, context: true }),
  'PreToolUse': Object.freeze({ refuse: true, context: true }),
  'Stop': Object.freeze({ refuse: true, context: false }),
});
// Documented outer hook timeouts in milliseconds; SessionEnd shares a 1.5 s budget that a
// per-hook timeout may raise to 60 s.
export const outerTimeouts = Object.freeze({ default: 600000, UserPromptSubmit: 30000, SessionEnd: 1500, max: Object.freeze({ SessionEnd: 60000 }) });
export const encodeReply = (nativeEvent, reply) => encodeStandardReply(nativeEvent, reply, replies[nativeEvent]);
// Preserve the measured terminal ancestor predicate; the hook itself is index zero.
export function resolveAgentPid({ startPid = process.pid, ancestors = (pid) => createProcessOps().ancestors(pid) } = {}) {
  return ancestors(startPid).find((p, i) => i > 0 && p.comm === 'claude' && p.tty !== null)?.pid ?? null;
}
