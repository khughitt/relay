import { isAbsolute } from 'node:path';
import { bindingsFor, planHooks } from './hooks.js';
import { validateCapabilities } from './capabilities.js';

export function planCodex({ target, text, relayBin, subscribers, evidence = null, retireFamiliar = false }) {
  if (!isAbsolute(target) || !target.endsWith('/hooks.json') || !isAbsolute(relayBin) || typeof text !== 'string') throw new Error('Codex hooks.json target, relay path, and text must be explicit');
  const capability = validateCapabilities({ harness: 'codex', subscribers, bindings: bindingsFor('codex'), evidence });
  const after = planHooks({ text, harness: 'codex', relayBin, retireFamiliar });
  return { schema: 1, harness: 'codex', changes: after === text ? [] : [{ path: target, before: text, after }], evidence: capability.evidence };
}
