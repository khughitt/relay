// @ts-check
import { isAbsolute } from 'node:path';
import { relayError } from '../protocol.js';
import { verified, unverified } from '../model-identity.js';
import { createProcessOps } from '../bus/proc.js';
import { nearestHarness } from './index.js';
import { chainWithInit } from './codex-model.js';
import { conversationDatabase, issuingGeneration } from './agy-conversation.js';

/** @param {string|null} label @returns {string|null} */
export function effortOf(label) {
  return label?.match(/^[^()]* \(([A-Za-z]+)\)$/)?.[1].toLowerCase() ?? null;
}

/** @param {string} id @param {string|null} effort @returns {string} */
export function modelOf(id, effort) {
  return effort && id.endsWith(`-${effort}`) ? id.slice(0, -effort.length - 1) : id;
}

/**
 * @param {{env?: NodeJS.ProcessEnv, ops?: import('./codex-model.js').ModelOps, startPid?: number, importSqlite?: () => Promise<typeof import('node:sqlite')>}} [options]
 * @returns {Promise<import('../model-identity.js').ModelResult>}
 */
export async function resolveAgyModel({ env = process.env, ops = createProcessOps(), startPid = process.pid, importSqlite } = {}) {
  /** @type {Record<string, unknown>} */
  const source = {};
  const conversation = env.ANTIGRAVITY_CONVERSATION_ID;
  if (!conversation) return unverified('agy', 'no-conversation', 'ANTIGRAVITY_CONVERSATION_ID is not set; only an agy tool call carries it');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(conversation)) {
    throw relayError('INVALID_INPUT', 'ANTIGRAVITY_CONVERSATION_ID is not a lowercase UUID');
  }
  source.conversation = conversation;
  const chain = chainWithInit(ops, startPid);
  const nearest = nearestHarness(chain, { executableOf: (pid) => ops.executableOf(pid) });
  if (nearest === null || nearest.harness !== 'agy') {
    return unverified('agy', 'not-under-agy', nearest
      ? `the nearest harness process is ${nearest.harness} (pid ${chain[nearest.index].pid}), not agy`
      : 'no agy process among this process\'s ancestors', source);
  }
  const metadata = env.ANTIGRAVITY_SOURCE_METADATA;
  if (!metadata) return unverified('agy', 'no-step', 'ANTIGRAVITY_SOURCE_METADATA is not set; the issuing step is unknown', source);
  let tool;
  try { tool = JSON.parse(metadata)?.tool; }
  catch (cause) { throw relayError('INVALID_INPUT', 'ANTIGRAVITY_SOURCE_METADATA is not valid JSON', cause); }
  if (!Number.isInteger(tool?.stepIndex) || tool.stepIndex < 0 || tool.conversationId !== conversation) {
    throw relayError('INVALID_INPUT', 'ANTIGRAVITY_SOURCE_METADATA must carry tool.stepIndex >= 0 and the matching tool.conversationId');
  }
  const step = tool.stepIndex;
  source.step = step;
  const appData = env.ANTIGRAVITY_APP_DATA_DIR;
  if (!appData || !isAbsolute(appData)) throw relayError('INVALID_CONFIG', 'ANTIGRAVITY_APP_DATA_DIR must be an absolute path');
  const database = conversationDatabase(appData, conversation);
  source.database = database;
  const { generation, missing } = await issuingGeneration(database, { conversation, step, importSqlite });
  if (missing) return unverified('agy', 'no-conversation-record', `no database for conversation ${conversation} at ${database}`, source);
  if (!generation) return unverified('agy', 'no-generation', `no generation precedes step ${step} in conversation ${conversation}`, source);
  source.generation = generation.idx;
  source.label = generation.label;
  if (generation.model === null) return unverified('agy', 'no-model', `generation ${generation.idx} of conversation ${conversation} carries no model`, source);
  if (env.ANTIGRAVITY_TRAJECTORY_ID !== undefined && generation.trajectory !== env.ANTIGRAVITY_TRAJECTORY_ID) {
    return unverified('agy', 'trajectory-mismatch', `generation ${generation.idx} of conversation ${conversation} has a different trajectory`, source);
  }
  const effort = effortOf(generation.label);
  return verified({ harness: 'agy', model: modelOf(generation.model, effort), effort, source,
    effortDetail: `generation ${generation.idx} of conversation ${conversation} carries no effort label` });
}
