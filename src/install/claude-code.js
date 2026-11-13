// @ts-check
import { isAbsolute } from 'node:path';
import { planHooks, planRouteHooks, routeBindings, selectBindings } from './hooks.js';
import { validateCapabilities } from './capabilities.js';
import { qualifyInstall } from './qualification.js';
import { assertPairRetained } from './pair.js';
import { relayError } from '../protocol.js';

/** @param {import("../types.js").InstallPlan} options @returns {import("../types.js").Artifact} */
export function planClaudeCode({ target, text, relayBin, nodeBin = process.execPath, subscribersPath, subscribers, evidence = null, retireFamiliar = false, withAsk = false, installedVersion,
  events, qualification = null, identity }) {
  if (!isAbsolute(target) || !isAbsolute(relayBin) || !isAbsolute(nodeBin ?? '') || !isAbsolute(subscribersPath ?? '') || typeof text !== 'string') throw relayError('INVALID_CONFIG', 'Claude target, relay path, node path, subscriber path, and text must be explicit');
  const bindings = selectBindings('claude-code', events);
  const capability = validateCapabilities({ harness: 'claude-code', subscribers, bindings, evidence });
  assertPairRetained({ harness: 'claude-code', text, relayBin, subscribersPath });
  qualifyInstall({ harness: 'claude-code', subscribers, bindings, qualification, target: identity });
  let after = planHooks({ text, harness: 'claude-code', relayBin, nodeBin, subscribersPath, retireFamiliar, bindings });
  // The ask route is reconciled on every full install: without --with ask it declares no rows, so a
  // route installed before (perhaps on a harness version since upgraded) is removed. An install of
  // selected events leaves it alone unless --with ask names it.
  if (withAsk || events === undefined) {
    const rows = withAsk ? routeBindings('claude-code', evidence, installedVersion) : [];
    after = planRouteHooks({ text: after, harness: 'claude-code', relayBin, nodeBin, rows });
  }
  return { schema: 1, harness: 'claude-code', changes: after === text ? [] : [{ path: target, before: text, after }], evidence: capability.evidence };
}
