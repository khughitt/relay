// @ts-check
import * as fs from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { relayError } from './protocol.js';
import { CLEANUP_MS, SUPERVISOR_STARTUP_MS } from './child.js';
import { DISCOVERY_MS } from './executable.js';
import { adapterFor, hookEventOf } from './adapters/index.js';
import { HOOK_KINDS, TOOL_KINDS, privateFieldsFor } from './adapters/hook-event.js';
import { checkPrivate } from './bus/store.js';

export const RECONCILE = 'reconcile';
export const SCHEMA = 2;
const HARNESSES = ['agy', 'claude-code', 'codex', 'opencode'];
const FIELDS = ['name', 'role', 'kinds', 'harnesses', 'tools', 'nativeEvents', 'argv', 'timeoutMs', 'registry', 'privateFields'];
const CONFIG_FIELDS = ['schema', 'subscribers'];
const ROLES = ['guard', 'notice', 'observer'];
const MAX_TIMEOUT_MS = 60000, MAX_PLANNED_MS = 60000, MIN_OUTER_MS = 500, INPUT_MS = 5000, REGISTRY_MS = 12000;
/** @type {(message: string, cause?: unknown) => never} */
const fail = (message, cause) => { throw relayError('INVALID_CONFIG', message, cause); };
/** @param {unknown} v @returns {v is Record<string, any>} */
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** @param {unknown} v */
const text = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @param {(v: any) => boolean} ok */
const list = (v, ok) => Array.isArray(v) && v.length > 0 && new Set(v).size === v.length && v.every(ok);
/** A PATH basename: no slash or NUL, not "." or "..". @param {unknown} v */
const commandName = (v) => typeof v === 'string' && v !== '' && v !== '.' && v !== '..' && !v.includes('/') && !v.includes('\0');
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Native events a (harness, kind) pair selects, narrowed by an optional nativeEvents list. @param {string} harness @param {string} kind @param {string[]|null} only */
const nativeEventsFor = (harness, kind, only) => Object.entries(adapterFor(harness).hookEvents)
  .filter(([name, entry]) => entry.kind === kind && (only === null || only.includes(name))).map(([name]) => name);
/** @param {string[]|null} harnesses */
const admitted = (harnesses) => harnesses ?? HARNESSES;

// Each (harness, kind) pair a guard or notice names must select native events, and every one of
// them must carry the role's native channel: refusal for guards, context for notices.
/** @param {string} where @param {{harnesses: string[], kinds: string[], nativeEvents: string[]|null}} selector @param {'refuse'|'context'} channel */
function requireChannel(where, { harnesses, kinds, nativeEvents }, channel) {
  const label = channel === 'refuse' ? 'refusal' : 'context';
  for (const harness of harnesses) for (const kind of kinds) {
    const natives = nativeEventsFor(harness, kind, nativeEvents);
    if (!natives.length || !natives.every((native) => adapterFor(harness).replies[native]?.[channel])) fail(`${where}: ${harness} ${kind} has no ${label} channel`);
  }
}

/** @param {string} where @param {unknown} v @param {{harnesses: string[], kinds: string[], nativeEvents: string[]|null}} selector @returns {import("./types.js").PrivateSelection[]} */
function validatePrivateFields(where, v, { harnesses, kinds, nativeEvents }) {
  if (v === undefined) return [];
  if (!Array.isArray(v)) fail(`${where}: privateFields must be a list of {nativeEvent, fields}`);
  const seen = new Set();
  return v.map((entry) => {
    if (!object(entry) || Object.keys(entry).some((key) => !['nativeEvent', 'fields'].includes(key)) || typeof entry.nativeEvent !== 'string') fail(`${where}: privateFields entries are {nativeEvent, fields}`);
    if (seen.has(entry.nativeEvent)) fail(`${where}: privateFields names ${entry.nativeEvent} twice`);
    seen.add(entry.nativeEvent);
    const selectedBy = harnesses.filter((harness) => kinds.some((kind) => nativeEventsFor(harness, kind, nativeEvents).includes(entry.nativeEvent)));
    if (!selectedBy.length) fail(`${where}: privateFields ${entry.nativeEvent} is not an event this subscriber selects`);
    if (!list(entry.fields, (field) => typeof field === 'string' && selectedBy.some((harness) => privateFieldsFor(harness, entry.nativeEvent).includes(field)))) {
      fail(`${where}: privateFields for ${entry.nativeEvent} must be a nonempty unique list of its private fields`);
    }
    return { nativeEvent: entry.nativeEvent, fields: [...entry.fields] };
  });
}

/** @param {unknown} v @param {number} index @returns {import("./types.js").Subscriber} */
function validateSubscriber(v, index) {
  if (!object(v)) fail(`subscriber ${index} must be an object`);
  const where = `subscriber ${JSON.stringify(v.name ?? index)}`;
  if (typeof v.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(v.name)) fail(`${where}: name must match [a-z0-9][a-z0-9-]{0,63}`);
  if (!ROLES.includes(v.role)) fail(`${where}: role must be guard, notice or observer`);
  const extra = Object.keys(v).find((key) => !FIELDS.includes(key));
  if (extra !== undefined) fail(`${where}: unexpected field ${extra}`);
  const observer = v.role === 'observer';
  const kinds = observer ? [...HOOK_KINDS, RECONCILE] : HOOK_KINDS;
  if (!list(v.kinds, (kind) => kinds.includes(kind))) fail(`${where}: kinds must be a nonempty unique list of hook kinds`);
  const harnesses = v.harnesses ?? null, tools = v.tools ?? null, nativeEvents = v.nativeEvents ?? null;
  if (harnesses !== null && !list(harnesses, (harness) => HARNESSES.includes(harness))) fail(`${where}: harnesses must be a nonempty unique list of harness names`);
  if (!observer && harnesses === null) fail(`${where}: a ${v.role} must name its harnesses`);
  if (tools !== null && !list(tools, text)) fail(`${where}: tools must be a nonempty unique list of tool names`);
  if (tools !== null && !v.kinds.every((/** @type {string} */ kind) => TOOL_KINDS.includes(kind))) fail(`${where}: a tools filter requires only tool kinds (${TOOL_KINDS.join(', ')})`);
  const hookKinds = /** @type {string[]} */ (v.kinds).filter((kind) => kind !== RECONCILE);
  if (nativeEvents !== null && !list(nativeEvents, (native) => typeof native === 'string'
    && admitted(harnesses).some((harness) => hookKinds.some((kind) => nativeEventsFor(harness, kind, null).includes(native))))) {
    fail(`${where}: nativeEvents must be a nonempty unique list of native events its kinds and harnesses select`);
  }
  if (!Array.isArray(v.argv) || !v.argv.length || !v.argv.every((arg) => typeof arg === 'string') || !commandName(v.argv[0])) fail(`${where}: argv must be strings starting with a command basename resolved on PATH (no slash)`);
  if (!Number.isInteger(v.timeoutMs) || v.timeoutMs < 1 || v.timeoutMs > MAX_TIMEOUT_MS) fail(`${where}: timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  const selector = { harnesses: admitted(harnesses), kinds: hookKinds, nativeEvents };
  const base = { name: v.name, role: v.role, kinds: [...v.kinds], harnesses: harnesses && [...harnesses], tools: tools && [...tools],
    nativeEvents: nativeEvents && [...nativeEvents], argv: [...v.argv], timeoutMs: v.timeoutMs };
  if (!observer) {
    if (Object.hasOwn(v, 'registry')) fail(`${where}: registry applies only to observers`);
    if (Object.hasOwn(v, 'privateFields')) fail(`${where}: privateFields applies only to observers; a ${v.role} already receives its event's private fields`);
    requireChannel(where, selector, v.role === 'guard' ? 'refuse' : 'context');
    return base;
  }
  if (!['occurrence', 'snapshot'].includes(v.registry)) fail(`${where}: an observer must declare registry "occurrence" or "snapshot"`);
  if (v.registry === 'occurrence' && v.kinds.includes(RECONCILE)) fail(`${where}: reconcile carries no occurrence; only a snapshot observer may select it`);
  return { ...base, registry: v.registry, privateFields: validatePrivateFields(where, v.privateFields, selector) };
}

/** @param {unknown} v @returns {import("./types.js").Subscribers} */
export function validateSubscribers(v) {
  if (object(v) && v.schema === 1) fail('subscriber config schema 1 is no longer read; migrate it to schema 2 (docs/api.md, "Subscriber configuration")');
  if (!object(v) || v.schema !== SCHEMA || !Array.isArray(v.subscribers)) fail('subscriber config must be {"schema":2,"subscribers":[...]}');
  const extra = Object.keys(v).find((key) => !CONFIG_FIELDS.includes(key));
  if (extra !== undefined) fail(`subscriber config: unexpected field ${extra}`);
  const subscribers = v.subscribers.map(validateSubscriber);
  if (new Set(subscribers.map((subscriber) => subscriber.name)).size !== subscribers.length) fail('subscriber names must be unique');
  return { schema: SCHEMA, subscribers };
}

// One reader for both loaders. The default location may be absent, which means no
// subscribers; an explicitly named file was written by an installer and must exist.
/** @param {{configDir: string, subscribersPath: string}} paths @param {{io: typeof fs, required: boolean}} options @returns {Promise<import("./types.js").Subscribers>} */
async function readSubscribers(paths, { io, required }) {
  let present;
  try { present = await checkPrivate(paths.configDir, true, { io }) && await checkPrivate(paths.subscribersPath, false, { io }); }
  catch (cause) { fail(`subscriber config ${paths.subscribersPath} must be a privately owned 0600 regular file in a 0700 directory`, cause); }
  if (!present) {
    if (required) fail(`subscriber config ${paths.subscribersPath} does not exist`);
    return { schema: SCHEMA, subscribers: [] };
  }
  let value;
  try { value = JSON.parse(await io.readFile(paths.subscribersPath, 'utf8')); }
  catch (cause) { fail('cannot read subscriber config JSON', cause); }
  return validateSubscribers(value);
}

/** @param {{configDir: string, subscribersPath: string}} paths */
export const loadSubscribers = (paths, { io = fs } = {}) => readSubscribers(paths, { io, required: false });

// async so that a bad path rejects like every other failure instead of throwing synchronously.
/** @param {string} file */
export async function loadSubscribersFrom(file, { io = fs } = {}) {
  if (typeof file !== 'string' || !isAbsolute(file)) fail('subscriber config path must be absolute');
  return readSubscribers({ configDir: dirname(file), subscribersPath: file }, { io, required: true });
}

/** @param {import("./types.js").Subscriber} subscriber @param {string|null} harness */
const admits = (subscriber, harness) => harness === null || subscriber.harnesses === null || (/** @type {string[]} */ (subscriber.harnesses)).includes(harness);

/** @param {import("./types.js").Subscriber} subscriber @param {string|null} nativeEvent */
const selects = (subscriber, nativeEvent) => nativeEvent === null || subscriber.nativeEvents === null || subscriber.nativeEvents.includes(nativeEvent);

/** @param {import("./types.js").Subscribers} config @param {import("./types.js").HookEvent} event */
export function matchSubscribers(config, event) {
  const tool = event.tool?.name.status === 'valid' ? event.tool.name.value : null;
  return config.subscribers.filter((subscriber) => (/** @type {string[]} */ (subscriber.kinds)).includes(event.kind) && admits(subscriber, event.harness)
    && selects(subscriber, event.nativeEvent) && (subscriber.tools === null || (tool !== null && subscriber.tools.includes(tool))));
}

/** @param {import("./types.js").Subscribers} config */
export const matchReconcile = (config) => config.subscribers.filter((subscriber) => subscriber.role === 'observer' && subscriber.registry === 'snapshot' && subscriber.kinds.includes(RECONCILE));

/** @param {{harness?: string|null, nativeEvent?: string|null, outerMs?: number}} [options] @returns {import("./types.js").Budget} */
export function budgetFor({ harness = null, nativeEvent = null, outerMs } = {}) {
  let max = Infinity;
  if (harness !== null) {
    const adapter = adapterFor(harness);
    hookEventOf(adapter, /** @type {string} */ (nativeEvent));
    outerMs ??= /** @type {number|undefined} */ (adapter.outerTimeouts[/** @type {string} */ (nativeEvent)]) ?? adapter.outerTimeouts.default;
    max = adapter.outerTimeouts.max[/** @type {string} */ (nativeEvent)] ?? Infinity;
  }
  if (typeof outerMs !== 'number' || !Number.isInteger(outerMs) || outerMs < MIN_OUTER_MS) throw relayError('USAGE', `outer timeout must be an integer of at least ${MIN_OUTER_MS} milliseconds`);
  if (outerMs > max) throw relayError('USAGE', `${harness} ${nativeEvent} allows at most ${max} milliseconds`);
  const effective = Math.min(outerMs, MAX_PLANNED_MS);
  const marginMs = clamp(Math.floor(effective / 10), 100, 5000), reserveMs = clamp(Math.floor(effective / 10), 100, 1000);
  const inputMs = Math.min(INPUT_MS, Math.floor(effective / 5)), registryMs = Math.min(REGISTRY_MS, Math.floor(effective / 3));
  const totalMs = effective - marginMs;
  return { outerMs, totalMs, inputMs, registryMs, reserveMs, marginMs, subscribersMs: totalMs - inputMs - registryMs - reserveMs };
}

/** @param {import("./types.js").Subscribers} config @param {import("./types.js").Budget} budget @param {{harness?: string|null, kind: string, nativeEvent?: string|null}} event */
export function checkBudget(config, budget, { harness = null, kind, nativeEvent = null }) {
  const matching = config.subscribers.filter((subscriber) => (/** @type {string[]} */ (subscriber.kinds)).includes(kind) && admits(subscriber, harness) && selects(subscriber, nativeEvent));
  // Worst case for a dispatch that admits anything: one supervisor startup, one repository
  // discovery, and each subscriber's timeout plus its cleanup reserve. Nothing admitted costs nothing.
  const need = matching.length === 0 ? 0 : SUPERVISOR_STARTUP_MS + DISCOVERY_MS + matching.reduce((sum, subscriber) => sum + subscriber.timeoutMs + CLEANUP_MS, 0);
  const fit = Math.max(0, budget.subscribersMs);
  if (need > fit) fail(`subscribers for ${harness ?? 'reconcile'} ${kind} need ${need} ms but ${fit} ms fit inside ${budget.outerMs} ms`);
  return matching;
}
