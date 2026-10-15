// @ts-check
import { adapterFor, normalizeEvent } from './adapters/index.js';
import { readNativeInput } from './adapters/payload.js';
import { parseReply, CONTEXT_LIMIT } from './adapters/reply.js';
import { paths as defaultPaths } from './bus/paths.js';
import { applyEvent, reapRegistry } from './bus/transaction.js';
import { relayError } from './protocol.js';
import { loadSubscribers, loadSubscribersFrom, matchSubscribers, checkBudget, budgetFor, RECONCILE } from './subscribers.js';
import { runChild } from './child.js';

const NONE = Object.freeze({ refuse: false, context: false });
/** @param {import("./types.js").Failure} error */
const describe = (error) => `${error.code ?? 'IO_ERROR'}: ${error.code ? error.message : 'relay failed'}`;
/** @param {import("./types.js").Failure} error */
const refusalReason = (error) => {
  const prefix = 'relay refused: ', full = `${prefix}${describe(error)}`, code = String(error.code ?? 'IO_ERROR');
  return full.length <= CONTEXT_LIMIT ? full : `${prefix}${code.length <= CONTEXT_LIMIT - prefix.length ? code : 'IO_ERROR'}`;
};
/** @param {string[]} list */
const lines = (list) => list.map((line) => `${line}\n`).join('');

// R1's filesystem operations do not consult the deadline. This races a unit of work against
// the remaining budget; the work itself is left to finish or fail on its own.
/** @template T @param {() => Promise<T>} thunk @param {{clock: () => number, deadline: number}} timing @param {string} message @returns {Promise<T>} */
export function bounded(thunk, { clock, deadline }, message) {
  const remaining = deadline - clock();
  if (remaining <= 0) return Promise.reject(relayError('DEADLINE_EXCEEDED', message));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(relayError('DEADLINE_EXCEEDED', message)), remaining);
    thunk().then((value) => { clearTimeout(timer); clock() >= deadline ? reject(relayError('DEADLINE_EXCEEDED', message)) : resolve(value); },
      (error) => { clearTimeout(timer); reject(error); });
  });
}

// Observers see identity and event metadata plus the published generation/revision; the
// tool is reduced to its name. Reconciliation carries no event at all.
/** @param {string} type @param {import("./types.js").Subscriber} subscriber @param {import("./types.js").Event|null} event @param {import("./types.js").RegistryResult} result */
export function envelope(type, subscriber, event, result) {
  return { schema: 1, type, subscriber: subscriber.name,
    event: event === null ? null : { ...event, tool: event.tool === null ? null : { name: event.tool.name } },
    registry: { generation: result.snapshot?.generation ?? null, revision: result.snapshot?.revision ?? null },
    changed: result.changed, reaped: result.reaped };
}

/** @param {import("./types.js").Subscriber[]} observers @param {(observer: import("./types.js").Subscriber) => unknown} inputFor @param {{clock: () => number, workDeadline: number, run: typeof runChild}} deps @param {string[]} diagnostics */
export async function runObservers(observers, inputFor, { clock, workDeadline, run }, diagnostics) {
  for (const observer of observers) {
    if (clock() + observer.timeoutMs > workDeadline) { diagnostics.push(`SUBSCRIBER_SKIPPED: ${observer.name} does not fit the remaining budget`); continue; }
    const result = await run(observer.argv, JSON.stringify(inputFor(observer)), { clock, deadline: workDeadline, timeoutMs: observer.timeoutMs });
    if (result.status !== 'exited' || result.exitCode !== 0) diagnostics.push(`SUBSCRIBER_FAILED: ${observer.name} ${result.status}${result.exitCode === null ? '' : ` exit ${result.exitCode}`}`);
    for (const line of result.stderr.split('\n').filter(Boolean)) diagnostics.push(`${observer.name}: ${line}`);
  }
}

/** @param {import("./types.js").Subscriber[]} guards @param {import("./types.js").Event} event @param {import("./types.js").Capability} capability @param {{clock: () => number, workDeadline: number, run: typeof runChild}} deps @param {string[]} diagnostics */
async function runGuards(guards, event, capability, { clock, workDeadline, run }, diagnostics) {
  const contexts = []; let denial = null, error = null;
  for (const guard of guards) {
    if (clock() >= workDeadline) { error ??= relayError('DEADLINE_EXCEEDED', `guard ${guard.name} did not start before the deadline`); break; }
    let input, result;
    try { input = JSON.stringify({ schema: 1, type: 'event', subscriber: guard.name, event }); }
    catch (cause) { error ??= relayError('GUARD_FAILED', `guard ${guard.name} input serialization failed`, cause); continue; }
    try { result = await run(guard.argv, input, { clock, deadline: workDeadline, timeoutMs: guard.timeoutMs }); }
    catch (cause) { error ??= relayError('GUARD_FAILED', `guard ${guard.name} invocation failed`, cause); continue; }
    try {
      if (result.status !== 'exited') throw relayError('GUARD_FAILED', `guard ${guard.name} ${result.status}`);
      if (result.exitCode !== 0) throw relayError('GUARD_FAILED', `guard ${guard.name} exited ${result.exitCode}`);
      let reply;
      try { reply = parseReply(result.stdout); } catch (caught) { const cause = /** @type {import('./types.js').Failure} */ (caught); throw relayError(cause.code, `guard ${guard.name}: ${cause.message}`, cause); }
      // A denial is complete with its reason; context on a denial is dropped, so the channel
      // check applies only to allow replies.
      if (reply.decision === 'deny') denial ??= /** @type {string} */ (reply.reason);
      else if (reply.context !== undefined) {
        if (!capability.context) throw relayError('UNSUPPORTED_REPLY', `guard ${guard.name} returned context on an event without a context channel`);
        contexts.push(reply.context);
      }
    } catch (caught) { const cause = /** @type {import('./types.js').Failure} */ (caught); error ??= cause; }
    for (const line of result.stderr.split('\n').filter(Boolean)) diagnostics.push(`${guard.name}: ${line}`);
  }
  const context = contexts.join('\n');
  if (!error && context.length > CONTEXT_LIMIT) error = relayError('UNSUPPORTED_REPLY', `combined context exceeds ${CONTEXT_LIMIT} characters`);
  return { denial, error, context };
}

/** @param {{harness: string, nativeEvent: string, input: import("node:stream").Readable, outerMs?: number, subscribersPath?: string|null}} request @param {{clock?: () => number, loadConfig?: typeof loadSubscribers, loadConfigFrom?: typeof loadSubscribersFrom, run?: typeof runChild, apply?: typeof applyEvent, readInput?: typeof readNativeInput, applyOptions?: import("./types.js").RegistryOptions, paths?: import("./types.js").Paths, env?: NodeJS.ProcessEnv}} [deps] */
export async function dispatchHook({ harness, nativeEvent, input, outerMs, subscribersPath = null }, deps = {}) {
  const clock = deps.clock ?? performance.now.bind(performance), start = clock();
  const { loadConfig = loadSubscribers, loadConfigFrom = loadSubscribersFrom, run = runChild, apply = applyEvent, readInput = readNativeInput, applyOptions = {} } = deps;
  /** @param {import("./types.js").Failure} error */
  const failure = (error) => ({ stdout: '', stderr: `${describe(error)}\n`, exitCode: 1 });
  let adapter, budget;
  try { adapter = adapterFor(harness); adapter.stateForEvent(nativeEvent); budget = budgetFor({ harness, nativeEvent, outerMs }); }
  catch (caught) { const error = /** @type {import('./types.js').Failure} */ (caught); return failure(error); }
  const capability = adapter.replies[nativeEvent] ?? NONE;
  /** @param {string} reason */
  const refuse = (reason) => adapter.encodeReply(nativeEvent, { decision: 'deny', reason });
  // Fail closed for configured guards: any failure relay survives becomes a native refusal
  // where one exists; elsewhere it is reported because no refusal channel can be manufactured.
  /** @param {import("./types.js").Failure} error */
  const abort = (error) => capability.refuse ? refuse(refusalReason(error)) : failure(error);
  const workDeadline = start + budget.totalMs - budget.reserveMs, diagnostics = /** @type {string[]} */ ([]);
  // An installed entry names its file, so the hook environment decides nothing about
  // policy. State paths are only needed for publication, where failure is diagnostic.
  const statePaths = () => deps.paths ?? defaultPaths(deps.env ?? process.env);
  let paths = /** @type {import("./types.js").Paths|null} */ (null), event, guards, observers;
  try {
    if (subscribersPath === null) paths = statePaths();
    const load = subscribersPath === null ? () => loadConfig(/** @type {import("./types.js").Paths} */ (paths)) : () => loadConfigFrom(subscribersPath);
    const config = await bounded(load, { clock, deadline: workDeadline }, 'subscriber configuration did not load before the deadline');
    checkBudget(config, budget, { harness, kind: adapter.events[nativeEvent].kind });
    const raw = await readInput(input, { clock, deadline: Math.min(workDeadline, start + budget.inputMs) });
    event = normalizeEvent(harness, nativeEvent, raw);
    const matching = matchSubscribers(config, event);
    guards = matching.filter((subscriber) => subscriber.role === 'guard');
    observers = matching.filter((subscriber) => subscriber.role === 'observer');
  } catch (caught) { const error = /** @type {import('./types.js').Failure} */ (caught); return abort(error); }
  const { denial, error, context } = await runGuards(guards, event, capability, { clock, workDeadline, run }, diagnostics);
  if (denial !== null) return refuse(denial);
  if (error) return abort(error);
  let result = null;
  try {
    paths ??= statePaths();
    const deadline = Math.min(workDeadline, clock() + budget.registryMs);
    result = await bounded(() => apply(event, { ...applyOptions, paths: /** @type {import("./types.js").Paths} */ (paths), clock, deadline }), { clock, deadline }, 'registry publication did not finish before the deadline');
    for (const diagnostic of result.diagnostics) diagnostics.push(`${diagnostic.code}: ${diagnostic.message}${diagnostic.agentId ? ` (${diagnostic.agentId})` : ''}`);
  } catch (caught) { const cause = /** @type {import('./types.js').Failure} */ (caught); diagnostics.push(`registry: ${describe(cause)}`); }
  if (result === null) for (const observer of observers) diagnostics.push(`SUBSCRIBER_SKIPPED: ${observer.name} skipped after registry failure`);
  else await runObservers(observers, (observer) => envelope('event', observer, event, result), { clock, workDeadline, run }, diagnostics);
  const reply = adapter.encodeReply(nativeEvent, context ? { decision: 'allow', context } : { decision: 'allow' });
  return { stdout: reply.stdout, stderr: lines(diagnostics), exitCode: result === null ? 1 : reply.exitCode };
}

// relay reap: prune confirmed deaths, publish if changed, then tell reconcile observers to
// reread the snapshot. No event is fabricated and no guard runs. Loading and reaping errors
// propagate so the CLI reports them; observer failures are diagnostics.
/** @param {{outerMs?: number}} [request] @param {{clock?: () => number, loadConfig?: typeof loadSubscribers, run?: typeof runChild, reap?: typeof reapRegistry, paths?: import("./types.js").Paths}} [deps] */
export async function reconcile({ outerMs = 30000 } = {}, deps = {}) {
  const clock = deps.clock ?? performance.now.bind(performance), start = clock();
  const { loadConfig = loadSubscribers, run = runChild, reap = reapRegistry } = deps, paths = deps.paths ?? defaultPaths();
  const budget = budgetFor({ outerMs }), workDeadline = start + budget.totalMs - budget.reserveMs, diagnostics = /** @type {string[]} */ ([]);
  const config = await bounded(() => loadConfig(/** @type {import("./types.js").Paths} */ (paths)), { clock, deadline: workDeadline }, 'subscriber configuration did not load before the deadline');
  const observers = checkBudget(config, budget, { kind: RECONCILE });
  const deadline = Math.min(workDeadline, clock() + budget.registryMs);
  const result = await bounded(() => reap({ paths, clock, deadline }), { clock, deadline }, 'registry reap did not finish before the deadline');
  await runObservers(observers, (observer) => envelope('reconcile', observer, null, result), { clock, workDeadline, run }, diagnostics);
  return { result, diagnostics };
}
