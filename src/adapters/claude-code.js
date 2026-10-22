// @ts-check
import { createProcessOps } from '../bus/proc.js';
import { relayError } from '../protocol.js';
import { encodeStandardReply } from './reply.js';
import { VERSION_COMM, nearestSessionPid, nearestTerminalPid } from './ancestry.js';

/** @type {import("../types.js").Adapter["events"]} */
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
/** @param {string} event */
export function stateForEvent(event) {
  if (!Object.hasOwn(events, event)) throw relayError('UNSUPPORTED_EVENT', 'unsupported harness event');
  return events[event].level;
}
// Spec docs/specs/2026-10-19-claude-background-work.md, Reduction: agents hand work
// back to the session; a shell wait is idle rather than a request for user input.
/** @type {import("../types.js").Adapter["reduceState"]} */
export function reduceState(level, _previous, { background } = {}) {
  if (level === 'done' && (background?.agents ?? 0) > 0) return 'working';
  if (level === 'needs-input' && (background?.other ?? 0) > 0) return 'idle';
  return level;
}
// Spec docs/specs/2026-10-19-claude-background-work.md: Claude Code 2.1.302 label map.
const AGENT_TYPES = new Set(['subagent', 'workflow', 'teammate', 'cloud session']);
const IN_FLIGHT = new Set(['running', 'pending']);
/** @param {Record<string, any>} data @param {string} nativeEvent @returns {import("../types.js").Background|null|undefined} */
export function backgroundOf(data, nativeEvent) {
  if (nativeEvent !== 'Stop' || !Object.hasOwn(data, 'background_tasks')) return undefined;
  const list = data.background_tasks;
  if (!Array.isArray(list) || !list.every((entry) => entry !== null && typeof entry === 'object'
      && !Array.isArray(entry) && typeof entry.type === 'string' && typeof entry.status === 'string')) return null;
  const background = { agents: 0, other: 0 };
  for (const entry of list) {
    if (IN_FLIGHT.has(entry.status)) background[AGENT_TYPES.has(entry.type) ? 'agents' : 'other']++;
  }
  return background;
}
// Reply channels verified against the Claude hooks reference on 2026-09-17: PreToolUse,
// UserPromptSubmit and Stop block; only the first two carry additionalContext.
/** @type {Readonly<Record<string, import("../types.js").Capability>>} */
export const replies = Object.freeze({
  'UserPromptSubmit': Object.freeze({ refuse: true, context: true }),
  'PreToolUse': Object.freeze({ refuse: true, context: true }),
  'Stop': Object.freeze({ refuse: true, context: false }),
});
// Documented outer hook timeouts in milliseconds; SessionEnd shares a 1.5 s budget that a
// per-hook timeout may raise to 60 s.
/** @type {import("../types.js").Adapter["outerTimeouts"]} */
export const outerTimeouts = Object.freeze({ default: 600000, UserPromptSubmit: 30000, SessionEnd: 1500, max: Object.freeze({ SessionEnd: 60000 }) });
/** @param {string} nativeEvent @param {import("../types.js").Reply} reply */
export const encodeReply = (nativeEvent, reply) => encodeStandardReply(nativeEvent, reply, replies[nativeEvent]);
// The native installer runs every version as …/claude/versions/<version>, so a background
// session's own process is named after its version. The daemon and the pty host share that
// executable and never fire a hook; landing on one means an unmeasured shape, so null.
const ROLES = Object.freeze(['daemon', 'bg-pty-host']);
const ops = () => createProcessOps();
/** A Claude Code process: `claude`, or a versioned binary under claude/versions/. */
/** @type {import("../types.js").Adapter["isHarness"]} */
export const isHarness = (row, { executableOf }) => row.comm === 'claude'
  || (VERSION_COMM.test(row.comm) && executableOf(row.pid).endsWith(`/claude/versions/${row.comm}`));
/** @param {import("../types.js").AncestryOptions} [options] */
export function resolveSessionPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid),
  executableOf = (pid) => ops().executableOf(pid), argvOf = (pid) => ops().argvOf(pid) } = {}) {
  return nearestSessionPid(ancestors(startPid), { isHarness: (row) => isHarness(row, { executableOf }), roles: ROLES, argvOf });
}
// A session started by its versioned path is named after its version, as a background
// session is. The background session's terminal belongs to its bg-pty-host parent and
// displays nothing, so a versioned process is a terminal only when that is not its parent.
/** @param {import("../types.js").AncestryOptions} [options] */
export function resolveTerminalPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid),
  executableOf = (pid) => ops().executableOf(pid), argvOf = (pid) => ops().argvOf(pid) } = {}) {
  const chain = ancestors(startPid);
  return nearestTerminalPid(chain, (row, index) => row.comm === 'claude' || (isHarness(row, { executableOf })
    && (index + 1 === chain.length || argvOf(chain[index + 1].pid)[1] !== 'bg-pty-host')));
}
