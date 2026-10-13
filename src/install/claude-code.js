import { isAbsolute } from 'node:path';
import { bindingsFor, planHooks, planRouteHooks, routeBindings } from './hooks.js';
import { validateCapabilities } from './capabilities.js';

export function planClaudeCode({ target, text, relayBin, nodeBin = process.execPath, subscribersPath, subscribers, evidence = null, retireFamiliar = false, withAsk = false, installedVersion }) {
  if (!isAbsolute(target) || !isAbsolute(relayBin) || !isAbsolute(nodeBin ?? '') || !isAbsolute(subscribersPath ?? '') || typeof text !== 'string') throw new Error('Claude target, relay path, node path, subscriber path, and text must be explicit');
  const capability = validateCapabilities({ harness: 'claude-code', subscribers, bindings: bindingsFor('claude-code'), evidence });
  let after = planHooks({ text, harness: 'claude-code', relayBin, nodeBin, subscribersPath, retireFamiliar });
  // The route is reconciled on every install: without --with ask it declares no rows, so a
  // route installed before (perhaps on a harness version since upgraded) is removed.
  const rows = withAsk ? routeBindings('claude-code', evidence, installedVersion) : [];
  after = planRouteHooks({ text: after, harness: 'claude-code', relayBin, nodeBin, rows });
  return { schema: 1, harness: 'claude-code', changes: after === text ? [] : [{ path: target, before: text, after }], evidence: capability.evidence };
}
