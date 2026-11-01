// @ts-check
import { isAbsolute } from 'node:path';
import { createProcessOps } from '../bus/proc.js';
import { relayError } from '../protocol.js';
import { nearestSessionPid, nearestTerminalPid } from './ancestry.js';

/** @type {import("../types.js").Adapter["events"]} */
export const events = Object.freeze({
  'SessionStart': Object.freeze({ kind: 'session-start', level: 'idle' }),
  'PreToolUse': Object.freeze({ kind: 'before-tool', level: 'working' }),
  'Stop': Object.freeze({ kind: 'turn-end', level: 'done' }),
});
/** @param {string} event */
export function stateForEvent(event) {
  if (!Object.hasOwn(events, event)) throw relayError('UNSUPPORTED_EVENT', 'unsupported harness event');
  return events[event].level;
}
/** @param {import("../types.js").State|null} level */
export const reduceState = (level) => level;
// agy's PreToolUse refusal is JSON; Stop and SessionStart have no refusal channel and nothing has a context channel.
/** @type {Readonly<Record<string, import("../types.js").Capability>>} */
export const replies = Object.freeze({
  'PreToolUse': Object.freeze({ refuse: true, context: false }),
});
// agy's documented handler default; a handler timeout raises it, so installs raise both together.
/** @type {import("../types.js").Adapter["outerTimeouts"]} */
export const outerTimeouts = Object.freeze({ default: 30000, max: Object.freeze({}) });
// Allow is empty stdout (agy's no-op, so its own permission flow stays in force); never {"decision":"allow"}.
// Exit stays 0: agy reads the decision from JSON and ignored exit 2 in the probe.
// agy fails a tool call when PreToolUse hooks exit 1 (measured on agy 1.4.12), so relay failures exit 0 and report on stderr.
/** @type {0} */
export const failureExitCode = 0;
/** @param {string} nativeEvent @param {import("../types.js").Reply} reply */
export function encodeReply(nativeEvent, reply) {
  if (reply.decision === 'deny') {
    if (!Object.hasOwn(replies, nativeEvent) || !replies[nativeEvent].refuse) throw relayError('UNSUPPORTED_REPLY', `${nativeEvent} has no refusal channel`);
    return { stdout: `${JSON.stringify({ decision: 'deny', reason: reply.reason })}\n`, stderr: `${reply.reason}\n`, exitCode: 0 };
  }
  if (reply.context !== undefined) throw relayError('UNSUPPORTED_REPLY', `${nativeEvent} has no context channel`);
  return { stdout: '', stderr: '', exitCode: 0 };
}
/** @param {unknown} v @returns {v is Record<string, any>} */
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Translates agy's camelCase payload into the fields parsePayload checks; returns a new object.
 * @type {NonNullable<import("../types.js").Adapter["nativeFields"]>} */
export function nativeFields(data, nativeEvent) {
  /** @type {Record<string, any>} */
  const out = {};
  if (Object.hasOwn(data, 'conversationId')) out.session_id = data.conversationId;
  const first = Array.isArray(data.workspacePaths) ? data.workspacePaths[0] : undefined;
  if (typeof first === 'string' && !first.includes('\0') && isAbsolute(first)) out.cwd = first;
  if (nativeEvent === 'Stop' && Object.hasOwn(data, 'executionNum')) {
    const n = data.executionNum;
    if (!Number.isSafeInteger(n) || n < 0) throw relayError('INVALID_INPUT', 'invalid executionNum');
    out.stop_hook_active = n > 0;
  }
  if (nativeEvent === 'PreToolUse' && object(data.toolCall) && typeof data.toolCall.name === 'string') {
    const { name, args } = data.toolCall;
    out.tool_name = name === 'run_command' ? 'Bash' : name;
    out.tool_input = name === 'run_command' && object(args) && typeof args.CommandLine === 'string' ? { command: args.CommandLine }
      : object(args) ? args : {};
  }
  return out;
}
const ops = () => createProcessOps();
/** @type {import("../types.js").Adapter["isHarness"]} */
export const isHarness = (row) => row.comm === 'agy';
/** @param {import("../types.js").AncestryOptions} [options] */
export function resolveSessionPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid) } = {}) {
  return nearestSessionPid(ancestors(startPid), { isHarness: (row) => isHarness(row, { executableOf: () => '' }) });
}
/** @param {import("../types.js").AncestryOptions} [options] */
export function resolveTerminalPid({ startPid = process.pid, ancestors = (pid) => ops().ancestors(pid) } = {}) {
  return nearestTerminalPid(ancestors(startPid), (row) => row.comm === 'agy');
}
