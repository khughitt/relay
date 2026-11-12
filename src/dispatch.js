// @ts-check
import { adapterFor, hookEventOf } from './adapters/index.js';
import { normalizeHookEvent, registryEventFor, projectEnvelope } from './adapters/hook-event.js';
import { appDataDirFromPayload } from './adapters/agy.js';
import { readNativeInput } from './adapters/payload.js';
import { parseReply, CONTEXT_LIMIT } from './adapters/reply.js';
import { paths as defaultPaths } from './bus/paths.js';
import { applyEvent, reapRegistry } from './bus/transaction.js';
import { relayError } from './protocol.js';
import { loadSubscribers, loadSubscribersFrom, matchSubscribers, checkBudget, budgetFor, RECONCILE } from './subscribers.js';
import { runChild } from './child.js';
import { discoverBoundaries, resolveExecutable } from './executable.js';

// The per-dispatch reservation for repository discovery before the first subscriber.
const DISCOVERY_MS = 500;

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

// Filesystem operations (lock, read/write agents.json, rename) do not consult the deadline. This races a unit of work against
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

// The registry position an observer is told about: the published generation/revision, or why there is none.
/** @param {import("./types.js").RegistryResult} result @returns {import("./types.js").RegistryAccess} */
export const accessFor = (result) => result.snapshot === null ? { status: 'unavailable', code: 'NO_SNAPSHOT' }
  : { status: 'ready', generation: result.snapshot.generation, revision: result.snapshot.revision };
// Reconciliation carries no event: the registry position and the rows pruned for dead processes.
/** @param {import("./types.js").Subscriber} subscriber @param {import("./types.js").RegistryResult} result @returns {import("./types.js").ReconcileEnvelope} */
export const reconcileEnvelope = (subscriber, result) => ({ schema: 2, type: 'reconcile', subscriber: subscriber.name, registry: accessFor(result), reaped: result.reaped });
const NOT_REQUESTED = Object.freeze({ status: /** @type {'not-requested'} */ ('not-requested') });

/**
 * @typedef {{candidate: string, realPath: string}} Selected
 * @typedef {(subscriber: import("./types.js").Subscriber, input: string) => Promise<{result: import("./types.js").ChildResult, selected: Selected}>} Launch
 */
// Which installed copy ran (or was refused): metadata only, never argv or input.
/** @param {Partial<Selected>|null|undefined} selected */
const where = (selected) => selected?.candidate === undefined ? '' : ` (candidate ${selected.candidate}, real ${selected.realPath ?? 'unresolved'})`;

// Resolves a subscriber's command on PATH outside the event's repository, then runs it with its
// literal arguments in the event cwd and a PATH holding only the trusted directories. Discovery
// runs once per dispatch, before the first subscriber, inside its own reservation.
/** @param {{cwd: string, invokingCwd: string, env: NodeJS.ProcessEnv, clock: () => number, workDeadline: number, run: typeof runChild}} options @returns {Launch} */
function launcher({ cwd, invokingCwd, env, clock, workDeadline, run }) {
  /** @type {Promise<{directories: string[]}>|null} */
  let boundaries = null;
  return async (subscriber, input) => {
    boundaries ??= discoverBoundaries({ cwd, invokingCwd, deadline: Math.min(workDeadline, clock() + DISCOVERY_MS), clock });
    const resolved = await resolveExecutable(subscriber.argv[0], { path: env.PATH, boundaries: await boundaries, deadline: workDeadline, clock });
    const result = await run([resolved.candidate, ...subscriber.argv.slice(1)], input,
      { clock, deadline: workDeadline, timeoutMs: subscriber.timeoutMs, env: { ...env, PATH: resolved.childPath }, cwd });
    return { result, selected: resolved };
  };
}

/** @param {import("./types.js").Subscriber[]} observers @param {(observer: import("./types.js").Subscriber) => unknown} inputFor @param {{clock: () => number, workDeadline: number, launch: Launch, nativeEvent: string}} deps @param {string[]} diagnostics */
export async function runObservers(observers, inputFor, { clock, workDeadline, launch, nativeEvent }, diagnostics) {
  for (const observer of observers) {
    if (clock() + observer.timeoutMs > workDeadline) { diagnostics.push(`SUBSCRIBER_SKIPPED: ${observer.name} does not fit the remaining budget`); continue; }
    let launched;
    try { launched = await launch(observer, JSON.stringify(inputFor(observer))); }
    catch (caught) { const cause = /** @type {import('./types.js').Failure & Partial<Selected>} */ (caught); diagnostics.push(`SUBSCRIBER_FAILED: ${observer.name} ${nativeEvent} ${cause.code ?? 'IO_ERROR'}${where(cause)}`); continue; }
    const { result, selected } = launched;
    if (result.status !== 'exited' || result.exitCode !== 0) diagnostics.push(`SUBSCRIBER_FAILED: ${observer.name} ${result.status}${result.exitCode === null ? '' : ` exit ${result.exitCode}`}${where(selected)}`);
    for (const line of result.stderr.split('\n').filter(Boolean)) diagnostics.push(`${observer.name}: ${line}`);
  }
}

/** @param {import("./types.js").Subscriber[]} guards @param {import("./types.js").HookEvent} event @param {import("./types.js").Capability} capability @param {{clock: () => number, workDeadline: number, launch: Launch}} deps @param {string[]} diagnostics */
async function runGuards(guards, event, capability, { clock, workDeadline, launch }, diagnostics) {
  const contexts = []; let denial = null, error = null;
  for (const guard of guards) {
    if (clock() >= workDeadline) { error ??= relayError('DEADLINE_EXCEEDED', `guard ${guard.name} did not start before the deadline`); break; }
    let input, result, selected;
    try { input = JSON.stringify(projectEnvelope(event, guard, NOT_REQUESTED)); }
    catch (cause) { error ??= relayError('GUARD_FAILED', `guard ${guard.name} input serialization failed`, cause); continue; }
    try { ({ result, selected } = await launch(guard, input)); }
    catch (caught) {
      const cause = /** @type {import('./types.js').Failure & Partial<Selected>} */ (caught);
      error ??= cause.code ? relayError(cause.code, `guard ${guard.name} ${event.nativeEvent}: ${cause.message}${where(cause)}`, cause)
        : relayError('GUARD_FAILED', `guard ${guard.name} invocation failed`, cause);
      continue;
    }
    try {
      if (result.status !== 'exited') throw relayError('GUARD_FAILED', `guard ${guard.name} ${result.status}${where(selected)}`);
      if (result.exitCode !== 0) throw relayError('GUARD_FAILED', `guard ${guard.name} exited ${result.exitCode}${where(selected)}`);
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

/** @param {{harness: string, nativeEvent: string, input: import("node:stream").Readable, outerMs?: number, subscribersPath?: string|null}} request @param {{clock?: () => number, loadConfig?: typeof loadSubscribers, loadConfigFrom?: typeof loadSubscribersFrom, run?: typeof runChild, apply?: typeof applyEvent, readInput?: typeof readNativeInput, applyOptions?: import("./types.js").RegistryOptions, paths?: import("./types.js").Paths, env?: NodeJS.ProcessEnv, invokingCwd?: string}} [deps] */
export async function dispatchHook({ harness, nativeEvent, input, outerMs, subscribersPath = null }, deps = {}) {
  const clock = deps.clock ?? performance.now.bind(performance), start = clock();
  const { loadConfig = loadSubscribers, loadConfigFrom = loadSubscribersFrom, run = runChild, apply = applyEvent, readInput = readNativeInput, applyOptions = {} } = deps;
  /** @type {import("./types.js").Adapter|undefined} */
  let adapter;
  /** @param {import("./types.js").Failure} error */
  const failure = (error) => ({ stdout: '', stderr: `${describe(error)}\n`, exitCode: adapter?.failureExitCode ?? 1 });
  /** @type {import("./types.js").HookEventEntry} */
  let hookEvent;
  try { adapter = adapterFor(harness); hookEvent = hookEventOf(adapter, nativeEvent); }
  catch (caught) { return failure(/** @type {import('./types.js').Failure} */ (caught)); }
  /** @type {ReturnType<typeof budgetFor>} */
  let budget;
  try { budget = budgetFor({ harness, nativeEvent, outerMs }); }
  catch (caught) {
    const error = /** @type {import('./types.js').Failure} */ (caught);
    // A harness whose failures exit 0 would run the tool unguarded, so where the event has a refusal channel the failure refuses.
    return adapter.failureExitCode === 0 && adapter.replies[nativeEvent]?.refuse ? adapter.encodeReply(nativeEvent, { decision: 'deny', reason: refusalReason(error) }) : failure(error);
  }
  const capability = adapter.replies[nativeEvent] ?? NONE;
  /** @param {string} reason */
  const refuse = (reason) => adapter.encodeReply(nativeEvent, { decision: 'deny', reason });
  // Fail closed whether or not guards are configured: any failure relay survives becomes a native
  // refusal where one exists; elsewhere it is reported because no refusal channel can be manufactured.
  /** @param {import("./types.js").Failure} error */
  const abort = (error) => capability.refuse ? refuse(refusalReason(error)) : failure(error);
  const workDeadline = start + budget.totalMs - budget.reserveMs, diagnostics = /** @type {string[]} */ ([]);
  const childEnv = deps.env ?? process.env;
  // process.cwd() throws when the harness started relay in a since-deleted directory; read it
  // inside the guarded block so that failure refuses like any other.
  let invokingCwd = /** @type {string} */ ('');
  // An installed entry names its file, so the hook environment decides nothing about
  // policy. State paths are only needed for publication, where failure is diagnostic.
  const statePaths = () => deps.paths ?? defaultPaths(deps.env ?? process.env);
  let paths = /** @type {import("./types.js").Paths|null} */ (null), event, guards, observers, agyAppDataDir = /** @type {string|null|undefined} */ (undefined);
  /** @type {import("./types.js").Event|null} */
  let registryEvent = null;
  /** @type {import("./types.js").Failure|null} */
  let registryError = null;
  try {
    invokingCwd = deps.invokingCwd ?? process.cwd();
    if (subscribersPath === null) paths = statePaths();
    const load = subscribersPath === null ? () => loadConfig(/** @type {import("./types.js").Paths} */ (paths)) : () => loadConfigFrom(subscribersPath);
    const config = await bounded(load, { clock, deadline: workDeadline }, 'subscriber configuration did not load before the deadline');
    checkBudget(config, budget, { harness, kind: hookEvent.kind, nativeEvent });
    const raw = await readInput(input, { clock, deadline: Math.min(workDeadline, start + budget.inputMs) });
    event = normalizeHookEvent(harness, nativeEvent, raw, { invokingCwd });
    // agy Stop reaches its policy even when registry identity is unusable; publication is then skipped
    // with a diagnostic. Every other event without a usable registry event fails as before.
    try { registryEvent = registryEventFor(event); }
    catch (caught) { if (harness !== 'agy' || nativeEvent !== 'Stop') throw caught; registryError = /** @type {import('./types.js').Failure} */ (caught); }
    if (harness === 'agy' && registryEvent !== null) agyAppDataDir = applyOptions.agyAppDataDir === undefined ? appDataDirFromPayload(raw, registryEvent.sessionId) : applyOptions.agyAppDataDir;
    if (registryEvent?.background === null) diagnostics.push('BACKGROUND_UNREADABLE: background_tasks is not a list of {type, status} entries');
    const matching = matchSubscribers(config, event);
    const notice = matching.find((subscriber) => subscriber.role === 'notice');
    if (notice !== undefined) throw relayError('UNSUPPORTED_ROLE', `notice ${notice.name} is not delivered by this relay build`);
    guards = matching.filter((subscriber) => subscriber.role === 'guard');
    observers = matching.filter((subscriber) => subscriber.role === 'observer');
  } catch (caught) { const error = /** @type {import('./types.js').Failure} */ (caught); return abort(error); }
  const launch = launcher({ cwd: event.cwd, invokingCwd, env: childEnv, clock, workDeadline, run });
  const { denial, error, context } = await runGuards(guards, event, capability, { clock, workDeadline, launch }, diagnostics);
  if (denial !== null) return refuse(denial);
  if (error) return abort(error);
  let result = null, published = registryEvent === null && registryError === null;
  if (registryError !== null) diagnostics.push(`registry: ${describe(registryError)}`);
  if (registryEvent !== null) try {
    paths ??= statePaths();
    const deadline = Math.min(workDeadline, clock() + budget.registryMs);
    const publishing = registryEvent;
    result = await bounded(() => apply(publishing, { ...applyOptions, ...(agyAppDataDir === undefined ? {} : { agyAppDataDir }), ...(applyOptions.env === undefined ? { env: deps.env ?? process.env } : {}), paths: /** @type {import("./types.js").Paths} */ (paths), clock, deadline }), { clock, deadline }, 'registry publication did not finish before the deadline');
    for (const diagnostic of result.diagnostics) diagnostics.push(`${diagnostic.code}: ${diagnostic.message}${diagnostic.agentId ? ` (${diagnostic.agentId})` : ''}`);
    published = true;
  } catch (caught) { const cause = /** @type {import('./types.js').Failure} */ (caught); diagnostics.push(`registry: ${describe(cause)}`); }
  const hooked = /** @type {import("./types.js").HookEvent} */ (event);
  if (!published) for (const observer of observers) diagnostics.push(`SUBSCRIBER_SKIPPED: ${observer.name} skipped after registry failure`);
  else await runObservers(observers, (observer) => projectEnvelope(hooked, observer, result === null ? NOT_REQUESTED : accessFor(result)), { clock, workDeadline, launch, nativeEvent }, diagnostics);
  const reply = adapter.encodeReply(nativeEvent, context ? { decision: 'allow', context } : { decision: 'allow' });
  return { stdout: reply.stdout, stderr: lines(diagnostics), exitCode: !published || registryEvent?.background === null ? (adapter.failureExitCode ?? 1) : reply.exitCode };
}

// relay reap: prune confirmed deaths, publish if changed, then tell reconcile observers to
// reread the snapshot. No event is fabricated and no guard runs. Loading and reaping errors
// propagate so the CLI reports them; observer failures are diagnostics.
/** @param {{outerMs?: number}} [request] @param {{clock?: () => number, loadConfig?: typeof loadSubscribers, run?: typeof runChild, reap?: typeof reapRegistry, paths?: import("./types.js").Paths, env?: NodeJS.ProcessEnv}} [deps] */
export async function reconcile({ outerMs = 30000 } = {}, deps = {}) {
  const clock = deps.clock ?? performance.now.bind(performance), start = clock();
  const { loadConfig = loadSubscribers, run = runChild, reap = reapRegistry } = deps, paths = deps.paths ?? defaultPaths();
  const budget = budgetFor({ outerMs }), workDeadline = start + budget.totalMs - budget.reserveMs, diagnostics = /** @type {string[]} */ ([]);
  const config = await bounded(() => loadConfig(/** @type {import("./types.js").Paths} */ (paths)), { clock, deadline: workDeadline }, 'subscriber configuration did not load before the deadline');
  const observers = checkBudget(config, budget, { kind: RECONCILE });
  const deadline = Math.min(workDeadline, clock() + budget.registryMs);
  const result = await bounded(() => reap({ paths, clock, deadline }), { clock, deadline }, 'registry reap did not finish before the deadline');
  const launch = launcher({ cwd: process.cwd(), invokingCwd: process.cwd(), env: deps.env ?? process.env, clock, workDeadline, run });
  await runObservers(observers, (observer) => reconcileEnvelope(observer, result), { clock, workDeadline, launch, nativeEvent: RECONCILE }, diagnostics);
  return { result, diagnostics };
}
