// @ts-check
import { createProcessOps } from '../bus/proc.js';
import { relayError } from '../protocol.js';
import { encodeStandardReply } from './reply.js';
import { nearestSessionPid, nearestTerminalPid } from './ancestry.js';

/** @type {import("../types.js").Adapter["events"]} */
export const events = Object.freeze({
  'SessionStart': Object.freeze({ kind: 'session-start', level: 'idle' }),
  'UserPromptSubmit': Object.freeze({ kind: 'prompt', level: 'working' }),
  'PreToolUse': Object.freeze({ kind: 'before-tool', level: 'working' }),
  'Stop': Object.freeze({ kind: 'turn-end', level: 'done' }),
  'SessionEnd': Object.freeze({ kind: 'session-end', level: null }),
  'PermissionRequest': Object.freeze({ kind: 'needs-approval', level: 'needs-approval' }),
});
/** @param {string} event */
export function stateForEvent(event) {
  if (!Object.hasOwn(events, event)) throw relayError('UNSUPPORTED_EVENT', 'unsupported harness event');
  return events[event].level;
}
/** @param {import("../types.js").State|null} level */
export const reduceState = (level) => level;
// Reply channels verified against the Codex hooks reference on 2026-09-17. PermissionRequest
// uses a different decision object and stays unexposed in v1.
/** @type {Readonly<Record<string, import("../types.js").Capability>>} */
export const replies = Object.freeze({
  'UserPromptSubmit': Object.freeze({ refuse: true, context: true }),
  'PreToolUse': Object.freeze({ refuse: true, context: true }),
  'Stop': Object.freeze({ refuse: true, context: false }),
});
// SessionEnd and Interrupt default to one second and cap at three.
/** @type {import("../types.js").Adapter["outerTimeouts"]} */
export const outerTimeouts = Object.freeze({ default: 600000, SessionEnd: 1000, max: Object.freeze({ SessionEnd: 3000 }) });
/** @param {string} nativeEvent @param {import("../types.js").Reply} reply */
export const encodeReply = (nativeEvent, reply) => encodeStandardReply(nativeEvent, reply, replies[nativeEvent]);
const ops = () => createProcessOps();
/** @param {import("../types.js").AncestryOptions} [options] */
export function resolveSessionPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid) } = {}) {
  return nearestSessionPid(ancestors(startPid), { isHarness: (row) => row.comm === 'codex' });
}
/** @param {import("../types.js").AncestryOptions} [options] */
export function resolveTerminalPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid) } = {}) {
  return nearestTerminalPid(ancestors(startPid), 'codex');
}
