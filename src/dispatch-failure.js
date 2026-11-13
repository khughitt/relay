// @ts-check
// Event-specific failure replies, the Stop retry recovery read, and notice reply/context rules.
// See docs/api.md ("Failure replies") and docs/adapters.md ("Hook events").
import { readNativeInput } from './adapters/payload.js';
import { adapterFor } from './adapters/index.js';
import { CONTEXT_LIMIT } from './adapters/reply.js';
import { relayError } from './protocol.js';

export const RECOVERY_READ_MS = 250;
const RETRY_EVENTS = ['Stop', 'SubagentStop'];
const RETRY_HARNESSES = ['claude-code', 'codex'];

/** @param {import("./types.js").Failure} error */
export const describe = (error) => `${error.code ?? 'IO_ERROR'}: ${error.code ? error.message : 'relay failed'}`;
/** @param {import("./types.js").Failure} error */
export function refusalReason(error) {
  const prefix = 'relay refused: ', full = `${prefix}${describe(error)}`, code = String(error.code ?? 'IO_ERROR');
  return full.length <= CONTEXT_LIMIT ? full : `${prefix}${code.length <= CONTEXT_LIMIT - prefix.length ? code : 'IO_ERROR'}`;
}

/**
 * Whether an infrastructure failure on this event refuses only on the first attempt: Claude Code and
 * Codex Stop, and SubagentStop where the harness gives it a refusal channel.
 * @param {string} harness @param {string} nativeEvent
 */
export function retryEscapes(harness, nativeEvent) {
  if (!RETRY_HARNESSES.includes(harness) || !RETRY_EVENTS.includes(nativeEvent)) return false;
  return adapterFor(harness).replies[nativeEvent]?.refuse === true;
}

/**
 * The fixed, bounded first read for a retry-escaping Stop: begun before configuration loading and
 * budget validation, so their failures cannot prevent it. Only the exact boolean stop_hook_active of
 * a parsed JSON object counts; anything else is missing or invalid, never true. The bytes are kept
 * for normal decoding, so stdin is read once.
 * @param {import("node:stream").Readable} stream @param {{harness: string, nativeEvent: string, clock?: () => number}} options
 * @returns {Promise<{raw: Buffer|null, retry: import("./types.js").Fact<boolean>, errorCode?: string}>}
 */
export async function readRecoveryInput(stream, { clock = performance.now.bind(performance) }) {
  let raw;
  try { raw = await readNativeInput(stream, { clock, deadline: clock() + RECOVERY_READ_MS }); }
  catch (caught) { return { raw: null, retry: { status: 'missing' }, errorCode: String(/** @type {import("./types.js").Failure} */ (caught).code ?? 'INVALID_INPUT') }; }
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { return { raw, retry: { status: 'invalid' } }; }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { raw, retry: { status: 'invalid' } };
  if (!Object.hasOwn(data, 'stop_hook_active')) return { raw, retry: { status: 'missing' } };
  return { raw, retry: typeof data.stop_hook_active === 'boolean' ? { status: 'valid', value: data.stop_hook_active } : { status: 'invalid' } };
}

/**
 * The one native reply for a dispatch that did not end in a plain allow. An explicit policy denial
 * always refuses. agy Stop never encodes continue for relay's own failure. A retry-escaping Stop
 * refuses on its first attempt but not on a validated stopHookActive=true retry. Tools and prompts,
 * and every other refusal-capable event, fail closed. Elsewhere the failure is reported.
 * @param {{adapter: import("./types.js").Adapter, harness: string, nativeEvent: string, retry?: import("./types.js").Fact<boolean>|null,
 *   explicitDenial?: string|null, error?: import("./types.js").Failure|null, diagnostics: string[]}} options
 * @returns {import("./types.js").Output}
 */
export function failureReply({ adapter, harness, nativeEvent, retry = null, explicitDenial = null, error = null, diagnostics }) {
  if (explicitDenial !== null) return adapter.encodeReply(nativeEvent, { decision: 'deny', reason: explicitDenial });
  const cause = error ?? relayError('IO_ERROR', 'relay failed');
  const report = [...diagnostics, describe(cause)].map((line) => `${line}\n`).join('');
  if (harness === 'agy' && nativeEvent === 'Stop') return { stdout: '', stderr: report, exitCode: 0 };
  if (retryEscapes(harness, nativeEvent) && retry?.status === 'valid' && retry.value === true) return { stdout: '', stderr: report, exitCode: 0 };
  if (adapter.replies[nativeEvent]?.refuse) return adapter.encodeReply(nativeEvent, { decision: 'deny', reason: refusalReason(cause) });
  return { stdout: '', stderr: report, exitCode: adapter.failureExitCode ?? 1 };
}

/**
 * A notice replies exactly {} or {"context":"<nonempty text>"}; it cannot deny.
 * @param {string} text @param {{limit?: number}} [options] @returns {{context?: string}}
 */
export function parseNoticeReply(text, { limit = CONTEXT_LIMIT } = {}) {
  let value;
  try { value = JSON.parse(text); } catch (cause) { throw relayError('INVALID_REPLY', 'notice reply is not JSON', cause); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw relayError('INVALID_REPLY', 'notice reply must be a JSON object');
  const keys = Object.keys(value);
  if (keys.length === 0) return {};
  if (keys.length !== 1 || keys[0] !== 'context') throw relayError('INVALID_REPLY', 'notice reply must be {} or {"context": text}');
  if (typeof value.context !== 'string' || !value.context.trim() || value.context.length > limit) throw relayError('INVALID_REPLY', `notice context must be nonempty text of at most ${limit} characters`);
  return { context: value.context };
}

/**
 * Guard context, then notice context, each in configuration order, newline-separated. Guards that
 * overflow the limit are a guard failure; a notice that no longer fits is dropped whole (its index
 * returned), never clipped. Lengths are JavaScript string lengths, as the native ceilings count.
 * @param {string[]} guardContexts @param {string[]} noticeContexts @param {{limit?: number}} [options]
 * @returns {{context?: string, dropped: number[]}}
 */
export function combineContext(guardContexts, noticeContexts, { limit = CONTEXT_LIMIT } = {}) {
  let context = guardContexts.join('\n');
  if (context.length > limit) throw relayError('UNSUPPORTED_REPLY', `combined guard context exceeds ${limit} characters`);
  /** @type {number[]} */
  const dropped = [];
  noticeContexts.forEach((text, index) => {
    const next = context ? `${context}\n${text}` : text;
    if (next.length > limit) dropped.push(index); else context = next;
  });
  return context ? { context, dropped } : { dropped };
}
