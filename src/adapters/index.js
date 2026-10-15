// @ts-check
import * as claudeCode from './claude-code.js';
import * as codex from './codex.js';
import * as opencode from './opencode.js';
import { parsePayload } from './payload.js';
import { relayError, validateEvent } from '../protocol.js';
/** @type {Record<string, import("../types.js").Adapter>} */
const adapters = { 'claude-code': claudeCode, codex, opencode };
/** @param {string} harness */
export function adapterFor(harness) {
  if (!Object.hasOwn(adapters, harness)) throw relayError('UNSUPPORTED_HARNESS', 'unsupported harness');
  return adapters[harness];
}
/** @param {string} harness @param {string} nativeEvent @param {unknown} raw */
export function normalizeEvent(harness, nativeEvent, raw) {
  const adapter = adapterFor(harness);
  adapter.stateForEvent(nativeEvent);
  const kind = adapter.events[nativeEvent].kind;
  const data = parsePayload(raw, nativeEvent);
  return validateEvent({ schema: 1, kind, harness, nativeEvent, agentId: `${harness}:${data.session_id}`,
    sessionId: data.session_id, cwd: data.cwd,
    ...(Object.hasOwn(data, 'stop_hook_active') ? { stopHookActive: data.stop_hook_active } : {}),
    tool: kind === 'before-tool' ? { name: data.tool_name, input: data.tool_input,
      command: data.tool_name === 'Bash' && typeof data.tool_input.command === 'string' ? data.tool_input.command : null } : null });
}
