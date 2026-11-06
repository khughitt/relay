// @ts-check
// Which model a Codex tool call's turn runs, read from the thread's own rollout.
// See docs/adapters.md ("Codex model resolution", steps 1-10).
import { relayError } from '../protocol.js';
import { verified, unverified } from '../model-identity.js';
import { createProcessOps } from '../bus/proc.js';
import { nearestHarness } from './index.js';
import { UUID_V7, SCAN_LIMIT, storeRoot, listDir, locateRollout, firstRecord, lastTurnContext, turnFields } from './codex-rollout.js';

/** The wall clock may move this much against the boot clock (docs/registry.md, "Start-time interval"). */
export const CLOCK_ALLOWANCE_MS = 1000;

/** @typedef {Pick<import("../types.js").ProcessOps, 'ancestors'|'recordOf'|'executableOf'|'startedAtMs'>} ModelOps */

/** Step 9: where a call process's start interval falls against the turn's record.
 * @param {{lo: number, hi: number}} start @param {number} at @returns {'verified'|'earlier-turn'|'turn-boundary'} */
export function bindTurn({ lo, hi }, at) {
  if (lo - CLOCK_ALLOWANCE_MS >= at) return 'verified';
  if (hi + CLOCK_ALLOWANCE_MS < at) return 'earlier-turn';
  return 'turn-boundary';
}

/** The ancestor chain including pid 1. relay's walk stops before pid 1 (the registry depends on
 * that); in Codex's sandbox the `codex` the command runs under is pid 1.
 * @param {Pick<ModelOps, 'ancestors'|'recordOf'>} ops @param {number} startPid */
export function chainWithInit(ops, startPid) {
  const chain = ops.ancestors(startPid);
  if (chain.at(-1)?.ppid === 1) { const init = ops.recordOf(1); if (init) chain.push(init); }
  return chain;
}

/** @param {{env?: NodeJS.ProcessEnv, ops?: ModelOps, startPid?: number, timeZone?: string, list?: (dir: string) => string[]|null, scanLimit?: number}} [options]
 * @returns {import("../model-identity.js").ModelResult} */
export function resolveCodexModel({ env = process.env, ops = createProcessOps(), startPid = process.pid, timeZone, list = listDir, scanLimit = SCAN_LIMIT } = {}) {
  /** @type {Record<string, unknown>} */
  const source = {};
  const thread = env.CODEX_THREAD_ID;
  if (!thread) return unverified('codex', 'no-thread', 'CODEX_THREAD_ID is not set; only a Codex tool call carries it');
  if (!UUID_V7.test(thread)) throw relayError('INVALID_INPUT', 'CODEX_THREAD_ID is not a lowercase UUIDv7');
  source.thread = thread;
  const chain = chainWithInit(ops, startPid);
  const nearest = nearestHarness(chain, { executableOf: (pid) => ops.executableOf(pid) });
  if (nearest === null || nearest.harness !== 'codex') {
    return unverified('codex', 'not-under-codex', nearest
      ? `the nearest harness process is ${nearest.harness} (pid ${chain[nearest.index].pid}), not codex`
      : 'no codex process among this process\'s ancestors', source);
  }
  const call = chain[nearest.index - 1];
  const root = storeRoot(env);
  const found = locateRollout(root, thread, { timeZone, list });
  if (found.length === 0) return unverified('codex', 'no-rollout', `no rollout of thread ${thread} under ${root}`, source);
  if (found.length > 1) return unverified('codex', 'ambiguous-rollout', `${found.length} rollouts match thread ${thread}: ${found.join(', ')}`, source);
  const rollout = found[0];
  source.rollout = rollout;
  const head = firstRecord(rollout, { limit: scanLimit });
  if (head?.type !== 'session_meta' || head.payload?.id !== thread) throw relayError('INVALID_ROLLOUT', `${rollout} does not open with the session_meta of thread ${thread}`);
  const { record, limited } = lastTurnContext(rollout, { limit: scanLimit });
  if (!record) {
    return limited
      ? unverified('codex', 'scan-limit', `no turn_context in the last ${scanLimit} bytes of ${rollout}`, source)
      : unverified('codex', 'no-turn-context', `${rollout} has no turn_context`, source);
  }
  const { model, effort, at } = turnFields(record);
  const binding = bindTurn(ops.startedAtMs(call), at);
  if (binding === 'earlier-turn') return unverified('codex', 'earlier-turn', `the call process (pid ${call.pid}) started before the latest turn's record at ${record.timestamp}`, source);
  if (binding === 'turn-boundary') return unverified('codex', 'turn-boundary', `the call process (pid ${call.pid}) started too close to the latest turn's record at ${record.timestamp} to order them`, source);
  return verified({ harness: 'codex', model, effort, source,
    effortDetail: `turn_context of thread ${thread} carries no effort` });
}
