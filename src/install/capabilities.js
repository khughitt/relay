// @ts-check
import { adapterFor } from '../adapters/index.js';
import { budgetFor, checkBudget } from '../subscribers.js';
import { relayError } from '../protocol.js';
import { ROUTE_EVIDENCE } from './hooks.js';

/** @param {unknown} value @returns {value is Record<string, any>} */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @type {(message: string) => never} */
const fail = message => { throw relayError('INVALID_EVIDENCE', message); };
/** @param {Record<string, unknown>} value @param {string[]} allowed */
const fields = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));

/** @param {string} text @returns {import("../types.js").Evidence} */
export function parseEvidence(text) {
  let value;
  try { value = JSON.parse(text); } catch { fail('evidence must be JSON'); }
  if (!object(value) || value.schema !== 1 || typeof value.harness !== 'string' || !value.harness
    || typeof value.version !== 'string' || !value.version.trim() || !Array.isArray(value.probes)
    || !fields(value, ['schema', 'harness', 'version', 'probes', 'routes'])) fail('invalid evidence record');
  let adapter;
  try { adapter = adapterFor(value.harness); } catch { fail('unsupported evidence harness'); }
  const seen = new Set();
  for (const probe of value.probes) {
    if (!object(probe) || typeof probe.event !== 'string' || !['refuse', 'context'].includes(probe.reply)
      || !Number.isInteger(probe.outerMs) || probe.outerMs < 1000 || probe.outerMs % 1000 !== 0
      || typeof probe.passed !== 'boolean' || !fields(probe, ['event', 'reply', 'outerMs', 'passed'])) fail('invalid probe');
    try { adapter.stateForEvent(probe.event); } catch { fail('unsupported probe event'); }
    if (!adapter.replies[probe.event]?.[/** @type {keyof import("../types.js").Capability} */ (probe.reply)]) fail('unsupported probe reply');
    const key = `${probe.event}\0${probe.reply}\0${probe.outerMs}`;
    if (seen.has(key)) fail('duplicate probe');
    seen.add(key);
  }
  if (value.routes !== undefined) {
    if (!Array.isArray(value.routes)) fail('routes must be an array');
    const names = new Set();
    for (const route of value.routes) {
      if (!object(route) || !ROUTE_EVIDENCE.includes(route.name) || typeof route.passed !== 'boolean' || typeof route.note !== 'string'
        || !fields(route, ['name', 'passed', 'note'])) fail('invalid route evidence');
      if (names.has(route.name)) fail('duplicate route evidence');
      names.add(route.name);
    }
  }
  return /** @type {import("../types.js").Evidence} */ (value);
}

/** @param {import("../types.js").Adapter} adapter @param {string} event @param {import("../types.js").Subscriber[]} matching */
const requiredReplies = (adapter, event, matching) => matching.some(subscriber => subscriber.role === 'guard')
  ? Object.keys(adapter.replies[event] ?? {}).filter(reply => adapter.replies[event][/** @type {keyof import("../types.js").Capability} */ (reply)]) : [];

/** @param {{harness: string, subscribers: import("../types.js").Subscribers, bindings: import("../types.js").Binding[], evidence?: import("../types.js").Evidence|null}} options */
export function validateCapabilities({ harness, subscribers, bindings, evidence = null }) {
  const adapter = adapterFor(harness);
  if (!Array.isArray(bindings)) throw relayError('INVALID_CONFIG', 'installer bindings must be an array');
  if (evidence !== null && evidence.harness !== harness) fail('evidence harness does not match install harness');
  if (harness === 'opencode' && subscribers.subscribers.some(subscriber => subscriber.role === 'guard'
    && (subscriber.harnesses === null || subscriber.harnesses.includes('opencode')))) {
    throw relayError('UNSUPPORTED_BINDING', 'OpenCode is observation-only');
  }
  for (const binding of bindings) {
    if (!object(binding) || typeof binding.event !== 'string' || !Number.isInteger(binding.outerMs)
      || binding.outerMs < 1000 || binding.outerMs % 1000 !== 0) throw relayError('INVALID_CONFIG', 'invalid installer binding');
    adapter.stateForEvent(binding.event);
    const budget = budgetFor({ harness, nativeEvent: binding.event, outerMs: binding.outerMs });
    const matching = checkBudget(subscribers, budget, { harness, kind: adapter.events[binding.event].kind });
    if (harness === 'opencode' && matching.some(subscriber => subscriber.role === 'guard')) {
      throw relayError('UNSUPPORTED_BINDING', 'OpenCode is observation-only');
    }
    const replies = requiredReplies(adapter, binding.event, matching);
    for (const reply of replies) {
      const found = evidence?.probes.some(probe => probe.event === binding.event && probe.reply === reply
        && probe.passed && probe.outerMs >= binding.outerMs);
      if (!found) throw relayError('UNSUPPORTED_BINDING', `missing capability probe (${harness},${binding.event},${reply}); a guard subscriber needs passed dispatch probes in the --evidence record, alongside any route rows (docs/runbooks/inbox-service.md)`);
    }
  }
  return { evidence: evidence === null ? null : { harness: evidence.harness, version: evidence.version } };
}
