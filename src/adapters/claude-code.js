import { createProcessOps } from '../bus/proc.js';
import { relayError } from '../protocol.js';
import { encodeStandardReply } from './reply.js';
import { VERSION_COMM, nearestSessionPid, nearestTerminalPid } from './ancestry.js';

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
// The native installer runs every version as …/claude/versions/<version>, so a background
// session's own process is named after its version. The daemon and the pty host share that
// executable and never fire a hook; landing on one means an unmeasured shape, so null.
const ROLES = Object.freeze(['daemon', 'bg-pty-host']);
const ops = () => createProcessOps();
export function resolveSessionPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid),
  executableOf = (pid) => ops().executableOf(pid), argvOf = (pid) => ops().argvOf(pid) } = {}) {
  const isHarness = (row) => row.comm === 'claude'
    || (VERSION_COMM.test(row.comm) && executableOf(row.pid).endsWith(`/claude/versions/${row.comm}`));
  return nearestSessionPid(ancestors(startPid), { isHarness, roles: ROLES, argvOf });
}
export function resolveTerminalPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid) } = {}) {
  return nearestTerminalPid(ancestors(startPid), 'claude');
}
