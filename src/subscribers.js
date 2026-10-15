// @ts-check
import * as fs from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { relayError, KINDS } from './protocol.js';
import { adapterFor } from './adapters/index.js';
import { checkPrivate } from './bus/store.js';

export const RECONCILE = 'reconcile';
const HARNESSES = ['claude-code', 'codex', 'opencode'];
const FIELDS = ['name', 'role', 'kinds', 'harnesses', 'tools', 'argv', 'timeoutMs'];
const CONFIG_FIELDS = ['schema', 'subscribers'];
const MAX_TIMEOUT_MS = 60000, MAX_PLANNED_MS = 60000, MIN_OUTER_MS = 500, INPUT_MS = 5000, REGISTRY_MS = 12000;
/** @type {(message: string, cause?: unknown) => never} */
const fail = (message, cause) => { throw relayError('INVALID_CONFIG', message, cause); };
/** @param {unknown} v @returns {v is Record<string, any>} */
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** @param {unknown} v */
const text = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @param {(v: any) => boolean} ok */
const list = (v, ok) => Array.isArray(v) && v.length > 0 && new Set(v).size === v.length && v.every(ok);
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** @param {string} harness @param {string} kind */
const nativeEventsFor = (harness, kind) => Object.entries(adapterFor(harness).events).filter(([, event]) => event.kind === kind).map(([name]) => name);

/** @param {unknown} v @param {number} index @returns {import("./types.js").Subscriber} */
function validateSubscriber(v, index) {
  if (!object(v)) fail(`subscriber ${index} must be an object`);
  const where = `subscriber ${JSON.stringify(v.name ?? index)}`;
  if (typeof v.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(v.name)) fail(`${where}: name must match [a-z0-9][a-z0-9-]{0,63}`);
  if (!['guard', 'observer'].includes(v.role)) fail(`${where}: role must be guard or observer`);
  const kinds = v.role === 'observer' ? [...KINDS, RECONCILE] : KINDS;
  if (!list(v.kinds, (kind) => kinds.includes(kind))) fail(`${where}: kinds must be a nonempty unique list of event kinds`);
  const harnesses = v.harnesses ?? null, tools = v.tools ?? null;
  if (harnesses !== null && !list(harnesses, (harness) => HARNESSES.includes(harness))) fail(`${where}: harnesses must be a nonempty unique list of harness names`);
  if (v.role === 'guard' && harnesses === null) fail(`${where}: a guard must name its harnesses`);
  if (tools !== null && !list(tools, text)) fail(`${where}: tools must be a nonempty unique list of tool names`);
  if (tools !== null && !(v.kinds.length === 1 && v.kinds[0] === 'before-tool')) fail(`${where}: a tools filter requires kinds exactly ["before-tool"]`);
  if (!Array.isArray(v.argv) || !v.argv.length || !v.argv.every((arg) => typeof arg === 'string') || !isAbsolute(v.argv[0])) fail(`${where}: argv must be strings starting with an absolute executable`);
  if (!Number.isInteger(v.timeoutMs) || v.timeoutMs < 1 || v.timeoutMs > MAX_TIMEOUT_MS) fail(`${where}: timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  const extra = Object.keys(v).find((key) => !FIELDS.includes(key));
  if (extra !== undefined) fail(`${where}: unexpected field ${extra}`);
  if (v.role === 'guard') {
    for (const harness of harnesses) for (const kind of v.kinds) {
      const natives = nativeEventsFor(harness, kind);
      if (!natives.length || !natives.every((native) => adapterFor(harness).replies[native]?.refuse)) fail(`${where}: ${harness} ${kind} has no refusal channel`);
    }
  }
  return { name: v.name, role: v.role, kinds: [...v.kinds], harnesses: harnesses && [...harnesses], tools: tools && [...tools], argv: [...v.argv], timeoutMs: v.timeoutMs };
}

/** @param {unknown} v @returns {import("./types.js").Subscribers} */
export function validateSubscribers(v) {
  if (!object(v) || v.schema !== 1 || !Array.isArray(v.subscribers)) fail('subscriber config must be {"schema":1,"subscribers":[...]}');
  const extra = Object.keys(v).find((key) => !CONFIG_FIELDS.includes(key));
  if (extra !== undefined) fail(`subscriber config: unexpected field ${extra}`);
  const subscribers = v.subscribers.map(validateSubscriber);
  if (new Set(subscribers.map((subscriber) => subscriber.name)).size !== subscribers.length) fail('subscriber names must be unique');
  return { schema: 1, subscribers };
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
    return { schema: 1, subscribers: [] };
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

/** @param {import("./types.js").Subscribers} config @param {import("./types.js").Event} event */
export function matchSubscribers(config, event) {
  return config.subscribers.filter((subscriber) => subscriber.kinds.includes(event.kind) && admits(subscriber, event.harness)
    && (subscriber.tools === null || (event.tool !== null && subscriber.tools.includes(event.tool.name))));
}

/** @param {import("./types.js").Subscribers} config */
export const matchReconcile = (config) => config.subscribers.filter((subscriber) => subscriber.role === 'observer' && subscriber.kinds.includes(RECONCILE));

/** @param {{harness?: string|null, nativeEvent?: string|null, outerMs?: number}} [options] @returns {import("./types.js").Budget} */
export function budgetFor({ harness = null, nativeEvent = null, outerMs } = {}) {
  let max = Infinity;
  if (harness !== null) {
    const adapter = adapterFor(harness);
    adapter.stateForEvent(/** @type {string} */ (nativeEvent));
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

/** @param {import("./types.js").Subscribers} config @param {import("./types.js").Budget} budget @param {{harness?: string|null, kind: string}} event */
export function checkBudget(config, budget, { harness = null, kind }) {
  const matching = config.subscribers.filter((subscriber) => (/** @type {string[]} */ (subscriber.kinds)).includes(kind) && admits(subscriber, harness));
  const need = matching.reduce((sum, subscriber) => sum + subscriber.timeoutMs, 0), fit = Math.max(0, budget.subscribersMs);
  if (need > fit) fail(`subscribers for ${harness ?? 'reconcile'} ${kind} need ${need} ms but ${fit} ms fit inside ${budget.outerMs} ms`);
  return matching;
}
