// @ts-check
// HookQualification: the per-route proof an installer needs before it writes a dispatch binding.
// Distinct from the schema-1 capability/ask-route evidence record (capabilities.js), which keeps
// its own domain and never qualifies a hook route. See docs/adapters.md ("Route qualification").
import { adapterFor, hookEventOf } from '../adapters/index.js';
import { CONTEXT_LIMIT } from '../adapters/reply.js';
import { retryEscapes } from '../dispatch-failure.js';
import { budgetFor, checkBudget } from '../subscribers.js';
import { relayError } from '../protocol.js';

export const QUALIFICATION_CHECKS = Object.freeze(['decode', 'nativeReply', 'liveDelivery', 'failure', 'cleanup', 'latency', 'retryFlag', 'outerFailure', 'policyEquivalence']);
export const QUALIFICATION_STATUSES = Object.freeze(['passed', 'failed', 'unknown', 'unavailable', 'unsupported', 'not-applicable']);
export const QUALIFICATION_ROLES = Object.freeze(['guard', 'notice', 'observer', 'registry']);
const HARNESSES = ['claude-code', 'codex', 'agy'];
const KEYS = ['schema', 'harness', 'version', 'sessionMode', 'platform', 'relayCommit', 'configDigest', 'rows'];
const ROW_KEYS = ['event', 'role', 'outerMs', 'contextLimit', ...QUALIFICATION_CHECKS];
const OWNER = /^[a-z][a-z0-9]*-[0-9a-f]{6}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const EVIDENCE_LIMIT = 4096;

/** @param {unknown} value @returns {value is Record<string, any>} */
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @type {(message: string) => never} */
const invalid = (message) => { throw relayError('INVALID_QUALIFICATION', `invalid qualification: ${message}`); };
/** @type {(message: string) => never} */
const unqualified = (message) => { throw relayError('UNQUALIFIED_ROUTE', message); };

/**
 * The checks a route must pass. Not-applicable is allowed only by these rules: retryFlag off an
 * event whose infrastructure failure refuses only on its first attempt (Claude Code and Codex Stop,
 * and SubagentStop where it can refuse), for every role, since relay's own failure refuses there
 * whatever subscribers run; cleanup and policyEquivalence for a registry writer, which starts no
 * subscriber and carries no policy.
 * @param {string} harness @param {{event: string, role: string}} route @returns {string[]}
 */
export function applicableChecks(harness, { event, role }) {
  const nativeEvent = event.split(':', 1)[0];
  return QUALIFICATION_CHECKS.filter((check) => {
    if (check === 'retryFlag') return retryEscapes(harness, nativeEvent);
    if (check === 'cleanup' || check === 'policyEquivalence') return role !== 'registry';
    return true;
  });
}

/** Whether a route replies through a native context channel, and so needs a qualified limit. @param {import("../types.js").Adapter} adapter @param {string} event @param {string} role */
const usesContext = (adapter, event, role) => (role === 'notice' || role === 'guard') && adapter.replies[event.split(':', 1)[0]]?.context === true;

/** @param {unknown} value @param {string} where @param {boolean} required */
function parseCheck(value, where, required) {
  if (!object(value) || !QUALIFICATION_STATUSES.includes(value.status) || !Array.isArray(value.evidence)
    || Object.keys(value).some((key) => !['status', 'evidence', 'owner'].includes(key))) invalid(`${where} must be {status, evidence[], owner?}`);
  if (value.evidence.some((item) => typeof item !== 'string' || !item.trim() || item.length > EVIDENCE_LIMIT)) invalid(`${where} evidence must be nonempty strings`);
  if (value.owner !== undefined && (typeof value.owner !== 'string' || !OWNER.test(value.owner))) invalid(`${where} owner must be a task id`);
  if (value.status === 'not-applicable') {
    if (required) invalid(`${where} cannot be not-applicable for this role and event`);
  } else if (value.status === 'passed') {
    if (!value.evidence.length) invalid(`${where} passed needs evidence`);
  } else if (!value.owner || !value.evidence.length) invalid(`${where} ${value.status} needs an owner and a reason`);
  return /** @type {import("../types.js").QualificationCheck} */ (value);
}

/** @param {string} text @returns {import("../types.js").HookQualification} */
export function parseQualification(text) {
  let value;
  try { value = JSON.parse(text); } catch { invalid('not JSON'); }
  if (!object(value) || value.schema !== 1 || Object.keys(value).some((key) => !KEYS.includes(key))) invalid('expected schema 1 with only the qualification fields');
  if (!HARNESSES.includes(value.harness)) invalid(`unsupported harness ${JSON.stringify(value.harness)}`);
  for (const key of ['version', 'sessionMode', 'platform']) if (typeof value[key] !== 'string' || !TOKEN.test(value[key])) invalid(`${key} must be a nonempty token`);
  if (typeof value.relayCommit !== 'string' || !/^[0-9a-f]{40}$/.test(value.relayCommit)) invalid('relayCommit must be a full 40-hex commit');
  if (typeof value.configDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.configDigest)) invalid('configDigest must be a sha256 hex digest');
  if (!Array.isArray(value.rows)) invalid('rows must be an array');
  const adapter = adapterFor(value.harness), seen = new Set();
  for (const row of value.rows) {
    if (!object(row) || Object.keys(row).some((key) => !ROW_KEYS.includes(key))) invalid('a row has unexpected fields');
    try { hookEventOf(adapter, row.event); } catch { invalid(`unsupported event ${JSON.stringify(row.event)}`); }
    if (!QUALIFICATION_ROLES.includes(row.role)) invalid(`unsupported role ${JSON.stringify(row.role)}`);
    if (!Number.isInteger(row.outerMs) || row.outerMs < 1000 || row.outerMs % 1000 !== 0) invalid(`${row.event} outerMs must be positive whole seconds in milliseconds`);
    if (row.contextLimit !== undefined && (!Number.isInteger(row.contextLimit) || row.contextLimit < 1)) invalid(`${row.event} contextLimit must be a positive integer`);
    const key = `${row.event}\0${row.role}\0${row.outerMs}`;
    if (seen.has(key)) invalid(`duplicate row (${row.event},${row.role},${row.outerMs})`);
    seen.add(key);
    const required = applicableChecks(value.harness, /** @type {{event: string, role: string}} */ (row));
    for (const check of QUALIFICATION_CHECKS) parseCheck(row[check], `${row.event} ${row.role} ${check}`, required.includes(check));
  }
  return /** @type {import("../types.js").HookQualification} */ (value);
}

/** Each row with the identity its document was qualified under. @param {import("../types.js").HookQualification} qualification @returns {import("../types.js").QualificationRow[]} */
export function qualificationRows({ harness, version, sessionMode, platform, relayCommit, configDigest, rows }) {
  return rows.map((/** @type {import("../types.js").QualificationEntry} */ row) => ({ harness, version, sessionMode, platform, relayCommit, configDigest, ...row }));
}

const hosts = (/** @type {string[]} */ evidence) => new Set(evidence.flatMap((item) => [...item.matchAll(/(?:^|\s)host=([A-Za-z0-9._-]+)/g)].map((m) => m[1])));

/**
 * Qualifies one route for one installation, or throws UNQUALIFIED_ROUTE naming the missing proof.
 * @param {import("../types.js").QualificationRow} row @param {import("../types.js").QualificationTarget} target
 * @returns {{event: string, role: string, outerMs: number, contextLimit: number|null}}
 */
export function qualifyBinding(row, target) {
  const route = `(${row.harness},${row.event},${row.role},${row.outerMs})`;
  for (const [field, expected, actual] of /** @type {[string, string, string][]} */ ([['harness', row.harness, target.harness], ['version', row.version, target.version],
    ['sessionMode', row.sessionMode, target.mode], ['platform', row.platform, target.platform], ['relayCommit', row.relayCommit, target.relayCommit],
    ['configDigest', row.configDigest, target.configDigest]])) {
    if (expected !== actual) unqualified(`unqualified route ${route}: qualification ${field} is ${expected}, the installation's is ${actual ?? 'unknown'}`);
  }
  const required = applicableChecks(row.harness, row);
  for (const check of QUALIFICATION_CHECKS) {
    const result = row[/** @type {keyof import("../types.js").QualificationChecks} */ (check)];
    if (!required.includes(check)) {
      if (result.status !== 'not-applicable') unqualified(`unqualified route ${route}: ${check} must be not-applicable, is ${result.status}`);
      continue;
    }
    if (result.status !== 'passed') unqualified(`unqualified route ${route}: ${check} is ${result.status}${result.owner ? ` (owner ${result.owner})` : ''}: ${result.evidence[0] ?? 'no reason recorded'}`);
  }
  if (hosts(row.latency.evidence).size < 2) unqualified(`unqualified route ${route}: latency needs passed results from two hosts (evidence naming host=NAME)`);
  // Each host's result names the outer budget it was measured at. A composition's transport cost does
  // not grow with its outer deadline once admitted, so a smaller measured budget stands for the row's
  // (whose admission install checks); a larger one never does.
  for (const line of row.latency.evidence.filter((item) => /(?:^|\s)host=/.test(item))) {
    const measured = /(?:^|\s)outerMs=(\d+)(?:\s|$)/.exec(line)?.[1];
    if (measured === undefined) unqualified(`unqualified route ${route}: latency evidence must name the outer budget it was measured at (outerMs=N): ${line}`);
    if (Number(measured) > row.outerMs) unqualified(`unqualified route ${route}: latency was measured at outerMs=${measured}, above the row's ${row.outerMs}`);
  }
  let contextLimit = null;
  if (usesContext(adapterFor(row.harness), row.event, row.role)) {
    if (row.contextLimit === undefined) unqualified(`unqualified route ${route}: contextLimit, the qualified native context limit, is missing`);
    if (row.contextLimit < CONTEXT_LIMIT) unqualified(`unqualified route ${route}: native context limit ${row.contextLimit} is below relay's ${CONTEXT_LIMIT}; relay cannot enforce a smaller limit`);
    contextLimit = row.contextLimit;
  }
  return { event: row.event, role: row.role, outerMs: row.outerMs, contextLimit };
}

/**
 * The routes each binding installs: one per role among the subscribers that match it, or one
 * registry route for a writer no subscriber matches.
 * @param {{harness: string, subscribers: import("../types.js").Subscribers, bindings: import("../types.js").Binding[]}} options
 */
export function requiredRoutes({ harness, subscribers, bindings }) {
  const adapter = adapterFor(harness);
  return bindings.flatMap((binding) => {
    const { kind } = hookEventOf(adapter, binding.event);
    const matching = checkBudget(subscribers, budgetFor({ harness, nativeEvent: binding.event, outerMs: binding.outerMs }), { harness, kind, nativeEvent: binding.event });
    const roles = QUALIFICATION_ROLES.filter((role) => matching.some((subscriber) => subscriber.role === role));
    return (roles.length ? roles : ['registry']).map((role) => ({ event: binding.event, role, outerMs: binding.outerMs }));
  });
}

/**
 * Every route the selected bindings install must qualify for this installation.
 * @param {{harness: string, subscribers: import("../types.js").Subscribers, bindings: import("../types.js").Binding[],
 *   qualification: import("../types.js").HookQualification|null, target: import("../types.js").QualificationTarget|undefined}} options
 */
export function qualifyInstall({ harness, subscribers, bindings, qualification, target }) {
  if (qualification === null) unqualified(`installing ${harness} hook routes needs a HookQualification record (--qualification); static encoder support is not route proof`);
  if (!target) throw relayError('INVALID_CONFIG', 'qualifying routes needs the installation identity');
  if (qualification.harness !== harness) unqualified(`qualification is for ${qualification.harness}, the installation is ${harness}`);
  const rows = qualificationRows(qualification);
  const routes = requiredRoutes({ harness, subscribers, bindings }).map((route) => {
    const row = rows.find((r) => r.event === route.event && r.role === route.role && r.outerMs === route.outerMs);
    if (!row) unqualified(`no qualification row (${harness},${route.event},${route.role},${route.outerMs})`);
    return qualifyBinding(row, target);
  });
  return { events: bindings.map((binding) => binding.event), routes };
}
