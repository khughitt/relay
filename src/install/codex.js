// @ts-check
import { isAbsolute } from 'node:path';
import { planHooks, selectBindings } from './hooks.js';
import { validateCapabilities } from './capabilities.js';
import { qualifyInstall } from './qualification.js';
import { assertPairRetained } from './pair.js';
import { relayError } from '../protocol.js';

/** @param {import("../types.js").InstallPlan} options @returns {import("../types.js").Artifact} */
export function planCodex({ target, text, relayBin, nodeBin = process.execPath, subscribersPath, subscribers, evidence = null, retireFamiliar = false, events, qualification = null, identity }) {
  if (typeof target !== 'string' || !isAbsolute(target) || !target.endsWith('/hooks.json')) {
    throw relayError('INVALID_CONFIG', `Codex --target must be an absolute path ending in /hooks.json, not ${JSON.stringify(target)}`);
  }
  if (!isAbsolute(relayBin) || !isAbsolute(nodeBin ?? '') || !isAbsolute(subscribersPath ?? '') || typeof text !== 'string') throw relayError('INVALID_CONFIG', 'Codex relay path, node path, subscriber path, and text must be explicit');
  const bindings = selectBindings('codex', events);
  const capability = validateCapabilities({ harness: 'codex', subscribers, bindings, evidence });
  assertPairRetained({ harness: 'codex', text, relayBin, subscribersPath });
  qualifyInstall({ harness: 'codex', subscribers, bindings, qualification, target: identity });
  const after = planHooks({ text, harness: 'codex', relayBin, nodeBin, subscribersPath, retireFamiliar, bindings });
  return { schema: 1, harness: 'codex', changes: after === text ? [] : [{ path: target, before: text, after }], evidence: capability.evidence };
}
