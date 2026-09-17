import { isAbsolute } from 'node:path';
import { bindingsFor, planHooks } from './hooks.js';
import { validateCapabilities } from './capabilities.js';

export function planClaudeCode({ target, text, relayBin, subscribers, evidence = null, retireFamiliar = false }) {
  if (!isAbsolute(target) || !isAbsolute(relayBin) || typeof text !== 'string') throw new Error('Claude target, relay path, and text must be explicit');
  const capability = validateCapabilities({ harness: 'claude-code', subscribers, bindings: bindingsFor('claude-code'), evidence });
  const after = planHooks({ text, harness: 'claude-code', relayBin, retireFamiliar });
  return { schema: 1, harness: 'claude-code', changes: after === text ? [] : [{ path: target, before: text, after }], evidence: capability.evidence };
}
