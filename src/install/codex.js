// @ts-check
import { isAbsolute } from 'node:path';
import { bindingsFor, planHooks } from './hooks.js';
import { validateCapabilities } from './capabilities.js';
import { relayError } from '../protocol.js';

/** @param {import("../types.js").InstallPlan} options @returns {import("../types.js").Artifact} */
export function planCodex({ target, text, relayBin, nodeBin = process.execPath, subscribersPath, subscribers, evidence = null, retireFamiliar = false }) {
  if (typeof target !== 'string' || !isAbsolute(target) || !target.endsWith('/hooks.json')) {
    throw relayError('INVALID_CONFIG', `Codex --target must be an absolute path ending in /hooks.json, not ${JSON.stringify(target)}`);
  }
  if (!isAbsolute(relayBin) || !isAbsolute(nodeBin ?? '') || !isAbsolute(subscribersPath ?? '') || typeof text !== 'string') throw relayError('INVALID_CONFIG', 'Codex relay path, node path, subscriber path, and text must be explicit');
  const capability = validateCapabilities({ harness: 'codex', subscribers, bindings: bindingsFor('codex'), evidence });
  const after = planHooks({ text, harness: 'codex', relayBin, nodeBin, subscribersPath, retireFamiliar });
  return { schema: 1, harness: 'codex', changes: after === text ? [] : [{ path: target, before: text, after }], evidence: capability.evidence };
}
