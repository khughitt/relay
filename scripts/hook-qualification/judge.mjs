// @ts-check
// Judges one route's transport latency evidence against the frozen qualification table (plan
// revision 3, "Final route qualification"), and selects the HookQualification rows that qualify.
//
//   node judge.mjs RESULT.json...     judge one route's per-host, per-runtime results; exit 0 on pass
//
// A route passes only on a complete pair: at least two hosts, each with a Node 22 run and a
// development-runtime run, all of one clean candidate commit and the same fixture work for each
// mapped invocation on both sides (reply encodings differ by protocol), each against
// that host's own frozen deployed composition (or its native-only path), with every condition's
// exact sample count, no failed or excluded call, no survivor, and every bound met. Synthetic
// results are transport evidence; a policy route's own cost is replayed separately before cutover.
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { statistics } from './statistics.mjs';
import { validateManifest, checkRetainedWork } from './baseline.mjs';
import { qualificationRows, qualifyBinding } from '../../src/install/qualification.js';

/** @param {string} runtime */
const major = (runtime) => Number(/^v(\d+)\./.exec(runtime)?.[1] ?? NaN);
/** @param {number} n */
const ms = (n) => n.toFixed(1);

/**
 * @param {any[]} samples one route's results, one per host and runtime
 * @param {any} workload
 * @returns {{passed: boolean, complete: boolean, failures: string[], rows: any[], evidence: string[]}}
 */
export function judge(samples, workload) {
  const q = workload.qualification, c = q.conditions;
  /** @type {string[]} */
  const failures = [];
  /** @type {any[]} */
  const rows = [];
  /** @type {string[]} */
  const evidence = [];
  let complete = true;
  const incomplete = (/** @type {string} */ message) => { complete = false; failures.push(message); };
  if (!Array.isArray(samples) || samples.length === 0) return { passed: false, complete: false, failures: ['no results'], rows, evidence };
  const route = samples[0].route, label = `${route?.harness} ${route?.event}`;
  if (samples.some((r) => r.route?.harness !== route.harness || r.route?.event !== route.event || r.route?.outerMs !== route.outerMs)) incomplete('results are for more than one route');
  if (samples.some((r) => r.mode !== 'measure')) incomplete('pilot results exercise one case per condition and never qualify');
  // One clean candidate, one config, one set of fixtures, everywhere.
  const commits = new Set(samples.map((r) => r.candidate?.commit));
  if (commits.size !== 1 || ![...commits].every((x) => typeof x === 'string' && /^[0-9a-f]{40}$/.test(x))) failures.push('results do not name one candidate commit');
  if (samples.some((r) => r.candidate?.dirty !== false)) failures.push('a candidate had uncommitted changes');
  if (new Set(samples.map((r) => r.candidate?.configSha256)).size !== 1) failures.push('results do not name one candidate config');
  const commit = [...commits][0];
  // Two hosts, each with the Node floor and a development runtime.
  const hosts = [...new Set(samples.map((r) => r.host))];
  if (hosts.length < q.hosts) incomplete(`latency needs results from two hosts; have ${hosts.join(', ') || 'none'}`);
  for (const host of hosts) {
    const majors = samples.filter((r) => r.host === host).map((r) => major(r.runtime));
    if (!majors.includes(q.runtimes.floorMajor) || !majors.some((m) => Number.isFinite(m) && m !== q.runtimes.floorMajor)) incomplete(`${host} needs a Node 22 and a development runtime run`);
  }
  const schedule = q.schedules[route.harness];
  if (!schedule) failures.push(`${route.harness} has no verified scheduling evidence; its routes stay unmeasured`);
  for (const r of samples) {
    const where = `${r.host} ${r.runtime}`;
    let manifest;
    try { manifest = validateManifest(r.manifest, { harness: route.harness, event: route.event }); }
    catch (error) { failures.push(`${where}: ${/** @type {Error} */ (error).message}`); continue; }
    if (manifest.host !== r.host) failures.push(`${where}: the baseline manifest is for ${manifest.host}; each host freezes its own deployment`);
    const ancestor = r.harnessAncestor;
    if (!Number.isInteger(ancestor?.pid) || ancestor.resolved !== ancestor.pid) failures.push(`${where}: the harness ancestor check is ${ancestor ? `failed (hooks resolved session ${ancestor.resolved ?? 'none'}, not the route process ${ancestor.pid})` : 'missing'}`);
    const relayed = Array.isArray(manifest.inventory?.relayedEvents) ? manifest.inventory.relayedEvents.includes(route.event) : null;
    if (relayed === null) failures.push(`${where}: the manifest records no deployment inventory`);
    else if (relayed !== (manifest.baselineKind === 'deployed-relay-plus-native')) failures.push(`${where}: the deployment ${relayed ? 'relays' : 'does not relay'} ${route.event} but the baseline is ${manifest.baselineKind}`);
    if (manifest.baselineKind === 'deployed-relay-plus-native' && r.deployedDigest !== manifest.deployed.packageSha256) failures.push(`${where}: the deployed package run is not the frozen deployed artifact`);
    if (schedule && manifest.schedule.kind !== schedule.kind) failures.push(`${where}: the baseline is scheduled ${manifest.schedule.kind}; ${route.harness} runs matching hooks ${schedule.kind}`);
    try { checkRetainedWork(manifest, r.workLists ?? { baseline: [], candidate: [] }); } catch (error) { failures.push(`${where}: ${/** @type {Error} */ (error).message}`); }
    for (const entry of manifest.replacementMap) {
      const base = r.fixtures?.baseline?.[entry.baseline], cand = r.fixtures?.candidate?.[entry.candidate];
      if (!base || base !== cand) failures.push(`${where}: ${entry.invocation} runs different fixture work on the two sides`);
    }
    judgeConditions(r, where, manifest, c, failures, incomplete, rows);
    const warm = r.conditions?.warm;
    if (warm?.baseline?.length && warm?.candidate?.length) {
      const b = statistics(warm.baseline.map((/** @type {any} */ s) => s.elapsedMs)), x = statistics(warm.candidate.map((/** @type {any} */ s) => s.elapsedMs));
      evidence.push(`host=${r.host} outerMs=${route.outerMs} runtime=${r.runtime} ${label} commit=${commit} baseline=${manifest.baselineKind} warm p95 delta ${ms(x.p95 - b.p95)} p99 delta ${ms(x.p99 - b.p99)} max delta ${ms(x.max - b.max)} ms`);
    }
  }
  return { passed: complete && failures.length === 0, complete, failures, rows, evidence };
}

/** @param {any} r @param {string} where @param {any} manifest @param {any} c @param {string[]} failures @param {(m: string) => void} incomplete @param {any[]} rows */
function judgeConditions(r, where, manifest, c, failures, incomplete, rows) {
  const k = r.conditions ?? {};
  const row = (/** @type {string} */ name, /** @type {number[]} */ values) => { const s = statistics(values); rows.push({ host: r.host, runtime: r.runtime, case: name, ...s }); return s; };
  const exact = (/** @type {string} */ name, /** @type {any[]|undefined} */ list, /** @type {number} */ n) => {
    if (!Array.isArray(list) || list.length !== n) { incomplete(`${where}: ${name} needs ${n} samples, has ${Array.isArray(list) ? list.length : 0}`); return false; }
    return true;
  };
  const sound = (/** @type {string} */ name, /** @type {any[]} */ list, /** @type {boolean} */ candidate) => {
    if (list.some((s) => !s.ok)) failures.push(`${where}: ${name} has failed calls; none may be excluded`);
    if (list.some((s) => s.survivors?.length)) failures.push(`${where}: ${name} left surviving processes`);
    if (candidate && list.some((s) => s.stderr)) failures.push(`${where}: a ${name} dispatch printed a failure diagnostic`);
  };
  /** The gated comparison of one condition: each side's samples, their deltas and the absolute bound. */
  const compare = (/** @type {string} */ name, /** @type {any} */ pair, /** @type {number} */ n, /** @type {any} */ bounds) => {
    if (!exact(`${name} baseline`, pair?.baseline, n) || !exact(`${name} candidate`, pair?.candidate, n)) return;
    sound(`${name} baseline`, pair.baseline, false); sound(`${name} candidate`, pair.candidate, true);
    if (manifest.schedule.kind === 'parallel' && manifest.branches.length > 1 && pair.baseline.some((/** @type {any} */ s) => !overlapped(s.branches))) {
      failures.push(`${where}: ${name} baseline branches did not overlap; a parallel event was serialized`);
    }
    const b = row(`${name} baseline`, pair.baseline.map((/** @type {any} */ s) => s.elapsedMs)), x = row(`${name} candidate`, pair.candidate.map((/** @type {any} */ s) => s.elapsedMs));
    for (const [q, bound] of /** @type {[('p95'|'p99'|'max'), string][]} */ ([['p95', 'p95DeltaMs'], ['p99', 'p99DeltaMs'], ['max', 'maxDeltaMs']])) {
      if (bounds[bound] !== undefined && x[q] - b[q] > bounds[bound]) failures.push(`${where}: ${name} ${q} delta ${ms(x[q] - b[q])} > ${bounds[bound]} ms`);
    }
    if (x.max > bounds.absoluteMaxMs) failures.push(`${where}: ${name} absolute max ${ms(x.max)} > ${bounds.absoluteMaxMs} ms`);
  };
  compare('warm', k.warm, c.warm.samples, c.warm.bounds);
  compare('cold', k.cold, c.cold.samples, c.cold.bounds);
  compare('concurrent', k.concurrent, c.concurrent.batches * c.concurrent.batchSize, c.concurrent.bounds);
  // Warm samples reuse one runtime directory per side; every cold sample has its own, never a warm one.
  for (const side of ['baseline', 'candidate']) {
    const warmDirs = new Set((k.warm?.[side] ?? []).map((/** @type {any} */ s) => s.stateDir)), coldDirs = (k.cold?.[side] ?? []).map((/** @type {any} */ s) => s.stateDir);
    if (warmDirs.size > 1) failures.push(`${where}: warm ${side} samples ran in more than one runtime directory (fresh state is a cold sample)`);
    if (new Set(coldDirs).size !== coldDirs.length || coldDirs.some((/** @type {string} */ d) => warmDirs.has(d))) failures.push(`${where}: cold ${side} samples share a runtime directory with each other or with warm samples`);
  }
  if (k.concurrent && k.concurrent.lostOccurrences !== 0) failures.push(`${where}: concurrent calls lost ${k.concurrent.lostOccurrences} occurrence(s)`);
  if (exact('missing first command', k.missing, c.missing.samples)) {
    const s = row('missing first command', k.missing.map((/** @type {any} */ x) => x.elapsedMs));
    if (k.missing.some((/** @type {any} */ x) => !x.ok || x.observed !== x.expected)) failures.push(`${where}: a missing first command did not fail as its role requires`);
    if (k.missing.some((/** @type {any} */ x) => x.fallback)) failures.push(`${where}: a missing first command fell back to another executable`);
    if (k.missing.some((/** @type {any} */ x) => x.survivors?.length)) failures.push(`${where}: missing first command left surviving processes`);
    if (s.max > c.missing.bounds.maxMs) failures.push(`${where}: missing first command max ${ms(s.max)} > ${c.missing.bounds.maxMs} ms`);
  }
  if (exact('timeout with grandchild', k.timeout, c.timeout.samples)) {
    const s = row('timeout with grandchild', k.timeout.map((/** @type {any} */ x) => x.elapsedMs));
    if (k.timeout.some((/** @type {any} */ x) => x.survivors?.length)) failures.push(`${where}: timeout with grandchild left surviving processes`);
    if (k.timeout.some((/** @type {any} */ x) => !x.ok || x.cleanup !== 'complete')) failures.push(`${where}: timeout with grandchild cleanup did not complete`);
    const limit = r.timeoutMs ?? 1000;
    if (s.max > limit + c.timeout.bounds.overTimeoutMs) failures.push(`${where}: timeout with grandchild took ${ms(s.max)} > ${limit} + ${c.timeout.bounds.overTimeoutMs} ms`);
  }
  if (exact('supervisor-alone', k.supervisorAlone, c.supervisorAlone.samples)) {
    row('supervisor-alone startup', k.supervisorAlone.map((/** @type {any} */ x) => x.startupMs));
    row('supervisor-alone cleanup', k.supervisorAlone.map((/** @type {any} */ x) => x.cleanupMs));
    const s = row('supervisor-alone combined', k.supervisorAlone.map((/** @type {any} */ x) => x.combinedMs));
    if (s.p99 > c.supervisorAlone.bounds.combinedP99Ms || s.max > c.supervisorAlone.bounds.combinedMaxMs) failures.push(`${where}: supervisor-alone combined p99 ${ms(s.p99)} / max ${ms(s.max)} exceeds ${c.supervisorAlone.bounds.combinedP99Ms} / ${c.supervisorAlone.bounds.combinedMaxMs} ms`);
    if (k.supervisorAlone.some((/** @type {any} */ x) => x.cleanup !== 'complete')) failures.push(`${where}: supervisor-alone cleanup incomplete`);
  }
  // Diagnostic rows: required, never gated by a number of their own.
  const none = k.noSubscriber, n = c.noSubscriber.samples, relayed = manifest.baselineKind === 'deployed-relay-plus-native';
  if (!none || none.candidate?.length !== n || none.native?.length !== n || (relayed && none.deployed?.length !== n)) incomplete(`${where}: no-subscriber diagnostics need ${n} samples each for the candidate, native${relayed ? ' and deployed' : ''} paths`);
  else {
    if (relayed) row('no-subscriber deployed', none.deployed);
    row('no-subscriber candidate', none.candidate); row('no-subscriber native', none.native);
    if (!Array.isArray(none.failures) || none.failures.length) incomplete(`${where}: a no-subscriber diagnostic failed`);
    if (none.starts?.candidate !== false) failures.push(`${where}: the empty candidate started a supervisor`);
    if (none.speculative) {
      row('no-subscriber speculative', none.speculative);
      if (none.starts?.speculative !== true) incomplete(`${where}: the speculative supervisor start was not observed`);
    }
  }
}

/** Every branch had started before the first one finished. @param {{startedMs: number, elapsedMs: number}[]|undefined} branches */
function overlapped(branches) {
  if (!Array.isArray(branches) || branches.length < 2) return false;
  return Math.max(...branches.map((b) => b.startedMs)) < Math.min(...branches.map((b) => b.startedMs + b.elapsedMs));
}

/**
 * The events whose every row qualifies for this installation, each independently of the others: a
 * missing proof on one route never blocks another.
 * @param {import("../../src/types.js").HookQualification} qualification @param {import("../../src/types.js").QualificationTarget} target
 * @returns {string[]}
 */
export function qualifiedRows(qualification, target) {
  /** @type {Map<string, boolean>} */
  const events = new Map();
  for (const row of qualificationRows(qualification)) {
    let ok = true;
    try { qualifyBinding(row, target); } catch { ok = false; }
    events.set(row.event, (events.get(row.event) ?? true) && ok);
  }
  return [...events].filter(([, ok]) => ok).map(([event]) => event);
}

// The entry module's URL has its symlinks resolved; argv[1] does not, so compare its real path.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const files = process.argv.slice(2);
  if (!files.length) { process.stderr.write('usage: node judge.mjs RESULT.json...\n'); process.exit(2); }
  const workload = JSON.parse(readFileSync(new URL('./workload.json', import.meta.url), 'utf8'));
  const verdict = judge(files.map((file) => JSON.parse(readFileSync(file, 'utf8'))), workload);
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  process.exitCode = verdict.passed ? 0 : 1;
}
