// @ts-check
// Early Task 3 latency pilot (plan revision 3, "Early Task 3 pilot"). Local synthetic processes only:
// no model, harness session or network request.
//
//   node pilot.mjs --prepare --output DIR            write the fixture bin/configs once; print digests
//   node pilot.mjs --candidate DIR --baseline-manifest FILE --output DIR [--smoke]
//
// The runner re-executes itself through a symlink named `claude`, so every hook it launches has a
// verified fake harness ancestor and registry publication follows its normal path. Hooks run through
// /bin/sh -c as a harness runs them. --smoke runs one case of every check to validate cleanup and
// results; the full run uses the frozen counts and judges them against the unchanged bounds.
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cpus } from 'node:os';
import { statistics } from './statistics.mjs';
import { validateManifest, checkRetainedWork, runBaseline } from './baseline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Judges a pilot result against the frozen workload. Gated cases must meet every bound with every
 * sample present and no failed or excluded call; no-subscriber rows are required diagnostics with no
 * numeric limit of their own.
 * @param {any} results @param {any} workload
 * @returns {{passed: boolean, complete: boolean, failures: string[], rows: {case: string, count: number, p50: number, p95: number, p99: number, max: number}[]}}
 */
export function judgePilot(results, workload) {
  const w = workload.pilot, failures = /** @type {string[]} */ ([]), rows = /** @type {any[]} */ ([]);
  let complete = true;
  /** @param {string} name @param {number[]} samples */
  const row = (name, samples) => { const s = statistics(samples); rows.push({ case: name, ...s }); return s; };
  const alone = results?.supervisorAlone?.samples;
  if (!Array.isArray(alone) || alone.length !== w.supervisorAlone.samples) { complete = false; failures.push(`supervisor-alone needs ${w.supervisorAlone.samples} samples`); }
  else {
    row('supervisor-alone startup', alone.map((s) => s.startupMs));
    row('supervisor-alone cleanup', alone.map((s) => s.cleanupMs));
    const combined = row('supervisor-alone combined', alone.map((s) => s.combinedMs));
    if (combined.p99 > w.supervisorAlone.bounds.combinedP99Ms) failures.push(`supervisor-alone combined p99 ${combined.p99} > ${w.supervisorAlone.bounds.combinedP99Ms} ms`);
    if (combined.max > w.supervisorAlone.bounds.combinedMaxMs) failures.push(`supervisor-alone combined max ${combined.max} > ${w.supervisorAlone.bounds.combinedMaxMs} ms`);
    if (alone.some((s) => s.cleanup !== 'complete')) failures.push('supervisor-alone cleanup incomplete');
  }
  const migrated = results?.migrated, n = w.migrated.samples, b = w.migrated.bounds;
  if (!migrated || migrated.baseline?.length !== n || migrated.candidate?.length !== n) { complete = false; failures.push(`migrated needs ${n} baseline and ${n} candidate samples`); }
  else {
    if ([...migrated.baseline, ...migrated.candidate].some((/** @type {any} */ s) => !s.ok)) failures.push('migrated has failed calls; none may be excluded');
    if (migrated.candidate.some((/** @type {any} */ s) => s.supervisors !== 1)) failures.push('a candidate dispatch did not use exactly one supervisor');
    const base = row('migrated baseline', migrated.baseline.map((/** @type {any} */ s) => s.elapsedMs)), cand = row('migrated candidate', migrated.candidate.map((/** @type {any} */ s) => s.elapsedMs));
    for (const [q, bound] of /** @type {[('p95'|'p99'|'max'), number][]} */ ([['p95', b.p95DeltaMs], ['p99', b.p99DeltaMs], ['max', b.maxDeltaMs]])) {
      if (cand[q] - base[q] > bound) failures.push(`migrated ${q} delta ${(cand[q] - base[q]).toFixed(1)} > ${bound} ms`);
    }
    if (cand.max > b.absoluteMaxMs) failures.push(`migrated candidate absolute max ${cand.max.toFixed(1)} > ${b.absoluteMaxMs} ms`);
  }
  const none = results?.noSubscriber, m = w.noSubscriber.samples;
  if (!none || none.deployed?.length !== m || none.candidate?.length !== m || none.native?.length !== m) { complete = false; failures.push(`no-subscriber diagnostics need ${m} samples each for deployed, candidate and native`); }
  else {
    row('no-subscriber deployed', none.deployed); row('no-subscriber candidate', none.candidate); row('no-subscriber native', none.native);
    if (none.candidateSupervisorStarts !== 0) failures.push('the empty candidate started a supervisor');
  }
  return { passed: complete && failures.length === 0, complete, failures, rows };
}

// ---- fixture ----

const PAYLOAD_BYTES = 1024;
/** Every fixture body does the same work on both sides: read stdin, note its parent, reply. */
const fixtureScripts = {
  'relay-fixture-guard': '#!/bin/sh\ncat >/dev/null\necho "$PPID" >> "$RELAY_PILOT_PPID_FILE"\nprintf \'{"decision":"allow"}\'\n',
  'relay-fixture-observer': '#!/bin/sh\ncat >/dev/null\necho "$PPID" >> "$RELAY_PILOT_PPID_FILE"\n',
  'relay-fixture-native': '#!/bin/sh\ncat >/dev/null\necho "$PPID" >> "$RELAY_PILOT_PPID_FILE"\n',
};
/** @param {string} path */
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** @param {string} out */
function prepare(out) {
  const fixture = join(out, 'fixture'), bin = join(fixture, 'bin'), config = join(fixture, 'config'), cwd = join(fixture, 'cwd');
  for (const dir of [bin, cwd]) mkdirSync(dir, { recursive: true });
  mkdirSync(config, { recursive: true, mode: 0o700 });
  for (const [name, body] of Object.entries(fixtureScripts)) writeFileSync(join(bin, name), body, { mode: 0o755 });
  const timeoutMs = 1000;
  const write = (/** @type {string} */ name, /** @type {unknown} */ value) => writeFileSync(join(config, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  // Deployed composition fixture: the subscribers the deployed config matches for Claude PreToolUse
  // (ops-guard with tools Bash, familiar), same order, timeouts normalized to the workload.
  write('deployed.json', { schema: 1, subscribers: [
    { name: 'ops-guard', role: 'guard', harnesses: ['claude-code'], kinds: ['before-tool'], tools: ['Bash'], argv: [join(bin, 'relay-fixture-guard')], timeoutMs },
    { name: 'familiar', role: 'observer', harnesses: ['claude-code'], kinds: ['before-tool'], argv: [join(bin, 'relay-fixture-observer')], timeoutMs } ] });
  write('candidate.json', { schema: 2, subscribers: [
    { name: 'ops-guard', role: 'guard', harnesses: ['claude-code'], kinds: ['before-tool'], tools: ['Bash'], argv: ['relay-fixture-guard'], timeoutMs },
    { name: 'turn-pause', role: 'guard', harnesses: ['claude-code'], kinds: ['before-tool'], argv: ['relay-fixture-guard'], timeoutMs },
    { name: 'familiar', role: 'observer', registry: 'snapshot', harnesses: ['claude-code'], kinds: ['before-tool'], argv: ['relay-fixture-observer'], timeoutMs } ] });
  // PostToolUse is not relayed today: the native-only diagnostic's candidate migrates the test counter as an occurrence observer.
  write('candidate-posttool.json', { schema: 2, subscribers: [
    { name: 'test-counter', role: 'observer', registry: 'occurrence', harnesses: ['claude-code'], kinds: ['after-tool'], tools: ['Bash'],
      privateFields: [{ nativeEvent: 'PostToolUse', fields: ['command', 'durationMs'] }], argv: ['relay-fixture-observer'], timeoutMs } ] });
  write('deployed-empty.json', { schema: 1, subscribers: [] });
  write('candidate-empty.json', { schema: 2, subscribers: [] });
  const digests = Object.fromEntries([...readdirSync(bin).map((n) => [`bin/${n}`, sha(join(bin, n))]), ...readdirSync(config).map((n) => [`config/${n}`, sha(join(config, n))])]);
  writeFileSync(join(fixture, 'digests.json'), `${JSON.stringify(digests, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ fixture, digests }, null, 2)}\n`);
}

// ---- run ----

/** @param {string[]} argv */
function parse(argv) {
  /** @type {Record<string, string|boolean>} */
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--smoke' || key === '--prepare' || key === '--post-tool') options[key.slice(2)] = true;
    else if (['--candidate', '--baseline-manifest', '--output'].includes(key) && i + 1 < argv.length) options[key.slice(2)] = argv[++i];
    else throw new Error(`unknown or incomplete option ${key}`);
  }
  return options;
}
const load = () => readFileSync('/proc/loadavg', 'utf8').trim();

/** @param {Record<string, any>} options */
async function measure(options) {
  const out = resolve(String(options.output)), candidate = resolve(String(options.candidate));
  const workload = JSON.parse(readFileSync(join(HERE, 'workload.json'), 'utf8')), w = workload.pilot;
  const manifest = validateManifest(JSON.parse(readFileSync(String(options['baseline-manifest']), 'utf8')), { harness: w.harness, event: w.event });
  const fixture = join(dirname(String(options['baseline-manifest'])), 'fixture');
  const digests = JSON.parse(readFileSync(join(fixture, 'digests.json'), 'utf8'));
  for (const [rel, digest] of Object.entries(digests)) if (sha(join(fixture, rel)) !== digest) throw new Error(`fixture ${rel} changed since the manifest was frozen`);
  if (digests['config/candidate.json'] !== manifest.candidate.configSha256) throw new Error('candidate config digest does not match the manifest');
  const node = process.execPath, runtime = process.version, smoke = options.smoke === true;
  const tag = `${runtime}${smoke ? '-smoke' : ''}`, work = join(out, tag);
  rmSync(work, { recursive: true, force: true });
  const home = join(work, 'home'), ppid = join(work, 'ppid'), cwd = join(fixture, 'cwd');
  for (const dir of [home, ppid]) mkdirSync(dir, { recursive: true });
  const stateFor = (/** @type {string} */ name) => { const dir = join(work, 'state', name); mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; };
  const bin = join(fixture, 'bin'), config = join(fixture, 'config');
  const tool = 'x'.repeat(PAYLOAD_BYTES);
  const payload = (() => { const base = { session_id: `pilot-${runtime}`, cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: '' } };
    const pad = PAYLOAD_BYTES - Buffer.byteLength(JSON.stringify(base)); return JSON.stringify({ ...base, tool_input: { command: tool.slice(0, Math.max(0, pad)) } }); })();
  let sample = 0;
  const env = (/** @type {string} */ state) => ({ PATH: `${bin}:/usr/bin:/bin`, HOME: home, RELAY_STATE_DIR: state, XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.local/state'),
    RELAY_PILOT_PPID_FILE: join(ppid, String(++sample)) });
  const parents = (/** @type {string} */ file) => existsSync(file) ? new Set(readFileSync(file, 'utf8').split('\n').filter(Boolean)).size : 0;
  const deployedEntry = manifest.deployed.relayEntry;
  const relay = (/** @type {string} */ entry, /** @type {number} */ outer, /** @type {string} */ subs) => `'${node}' '${entry}' hook --harness claude-code --outer-ms ${outer} --subscribers '${join(config, subs)}' PreToolUse`;
  const composition = (/** @type {{name: string, role: string, command: string}[]} */ branches) => ({ ...manifest, branches: branches.map((b) => ({ name: b.name, role: b.role, argv: ['/bin/sh', '-c', b.command] })) });
  const deployedState = stateFor('deployed'), candidateState = stateFor('candidate'), emptyCandidateState = stateFor('candidate-empty'), emptyDeployedState = stateFor('deployed-empty');
  const baselineEvent = composition([{ name: 'deployed-relay', role: 'deployed-relay', command: relay(deployedEntry, 600000, 'deployed.json') }, { name: 'turn-pause', role: 'native', command: join(bin, 'relay-fixture-native') }]);
  const candidateEvent = { ...manifest, baselineKind: 'native-only', deployed: null, branches: [{ name: 'candidate-relay', role: 'native', argv: ['/bin/sh', '-c', relay(join(candidate, 'bin/relay.js'), w.outerMs, 'candidate.json')] }] };
  const single = (/** @type {string} */ name, /** @type {string} */ command) => ({ ...manifest, baselineKind: 'native-only', deployed: null, branches: [{ name, role: 'native', argv: ['/bin/sh', '-c', command] }] });
  checkRetainedWork(manifest, { baseline: ['deployed-relay:ops-guard', 'deployed-relay:familiar', 'turn-pause'], candidate: ['candidate:ops-guard', 'candidate:turn-pause', 'candidate:familiar'] });
  /** @param {any} m @param {string} state */
  const event = async (m, state) => {
    const e = env(state), r = await runBaseline(m, { event: w.event, input: payload, env: e, cwd });
    return { elapsedMs: r.elapsedMs, ok: r.statuses.every((s) => s === 'exited 0') && r.survivors.length === 0, statuses: r.statuses, survivors: r.survivors, supervisors: parents(e.RELAY_PILOT_PPID_FILE) };
  };
  const loadLog = /** @type {Record<string, string>} */ ({ start: load() });
  // Case 1: fresh supervisors, each with one no-op child, timed through close.
  const { createChildSupervisor } = await import(pathToFileURL(join(candidate, 'src/child-supervisor.js')).href);
  const aloneState = stateFor('supervisor-alone');
  const alone = [];
  for (let i = 0; i < (smoke ? 1 : w.supervisorAlone.samples); i++) {
    const t0 = performance.now();
    const supervisor = await createChildSupervisor({ deadline: t0 + 10000, sessionHandle: null, recordDir: join(aloneState, 'children') });
    const t1 = performance.now();
    const result = await supervisor.runChild(['/bin/true'], '', { timeoutMs: w.timeoutMs, deadline: t0 + 10000, env: { PATH: '/usr/bin:/bin' }, cwd: '/' });
    const t2 = performance.now(), closed = await supervisor.close(), t3 = performance.now();
    alone.push({ startupMs: t1 - t0, runMs: t2 - t1, cleanupMs: (result.timings?.cleanupMs ?? 0) + (t3 - t2), combinedMs: t3 - t0, cleanup: result.cleanup === 'complete' && closed.cleanup === 'complete' ? 'complete' : 'failed' });
  }
  loadLog.supervisorAlone = load();
  // Case 2: one migrated subscriber against the deployed composition, interleaved samples.
  const migrated = { baseline: /** @type {any[]} */ ([]), candidate: /** @type {any[]} */ ([]) };
  const warm = smoke ? 0 : w.migrated.warmups, measured = smoke ? 1 : w.migrated.samples;
  for (let i = 0; i < warm + measured; i++) {
    const base = await event(baselineEvent, deployedState), cand = await event(candidateEvent, candidateState);
    if (i >= warm) { migrated.baseline.push(base); migrated.candidate.push(cand); }
  }
  loadLog.migrated = load();
  // Case 3: no-subscriber relay paths and the direct native reader (diagnostic only).
  const noSubscriber = { deployed: /** @type {number[]} */ ([]), candidate: /** @type {number[]} */ ([]), native: /** @type {number[]} */ ([]), candidateSupervisorStarts: 0, failures: /** @type {any[]} */ ([]) };
  const nWarm = smoke ? 0 : w.noSubscriber.warmups, nMeasured = smoke ? 1 : w.noSubscriber.samples;
  for (let i = 0; i < nWarm + nMeasured; i++) {
    const rows = await Promise.resolve().then(async () => [
      ['deployed', await event(single('deployed-empty', relay(deployedEntry, 600000, 'deployed-empty.json')), emptyDeployedState)],
      ['candidate', await event(single('candidate-empty', relay(join(candidate, 'bin/relay.js'), w.outerMs, 'candidate-empty.json')), emptyCandidateState)],
      ['native', await event(single('native', join(bin, 'relay-fixture-native')), emptyDeployedState)]]);
    if (i < nWarm) continue;
    for (const [name, r] of /** @type {[('deployed'|'candidate'|'native'), any][]} */ (rows)) { noSubscriber[name].push(r.elapsedMs); if (!r.ok) noSubscriber.failures.push({ name, ...r }); }
  }
  // Case 4 (optional, diagnostic): a newly transported route against its native-only baseline.
  const postTool = { baseline: /** @type {any[]} */ ([]), candidate: /** @type {any[]} */ ([]) };
  if (options['post-tool']) {
    const postPayload = (() => { const base = { session_id: `pilot-${runtime}`, cwd, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_pilot', tool_input: { command: '' }, tool_response: { stdout: 'ok', stderr: '' }, duration_ms: 4200 };
      const pad = PAYLOAD_BYTES - Buffer.byteLength(JSON.stringify(base)); return JSON.stringify({ ...base, tool_input: { command: tool.slice(0, Math.max(0, pad)) } }); })();
    const postState = stateFor('posttool');
    const nativeOnly = single('claude-posttooluse', join(bin, 'relay-fixture-native'));
    const relayed = single('candidate-relay', `'${node}' '${join(candidate, 'bin/relay.js')}' hook --harness claude-code --outer-ms ${w.outerMs} --subscribers '${join(config, 'candidate-posttool.json')}' PostToolUse`);
    const sample = async (/** @type {any} */ m) => { const e = env(postState), r = await runBaseline({ ...m, event: 'PostToolUse' }, { event: 'PostToolUse', input: postPayload, env: e, cwd });
      return { elapsedMs: r.elapsedMs, ok: r.statuses.every((x) => x === 'exited 0') && r.survivors.length === 0, statuses: r.statuses, supervisors: parents(e.RELAY_PILOT_PPID_FILE) }; };
    for (let i = 0; i < warm + measured; i++) {
      const b = await sample(nativeOnly), c = await sample(relayed);
      if (i >= warm) { postTool.baseline.push(b); postTool.candidate.push(c); }
    }
    loadLog.postTool = load();
  }
  // A supervisor writes its ownership record on start, creating the children directory.
  noSubscriber.candidateSupervisorStarts = existsSync(join(emptyCandidateState, 'children')) ? 1 : 0;
  loadLog.end = load();
  const git = (/** @type {string[]} */ args) => execFileSync('git', ['-C', candidate, ...args], { encoding: 'utf8' }).trim();
  const results = {
    schema: 1, runtime, node, smoke, host: execFileSync('uname', ['-n'], { encoding: 'utf8' }).trim(), cpus: cpus().length, load: loadLog,
    candidate: { path: candidate, commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain']).length > 0, entry: join(candidate, 'bin/relay.js'), configSha256: digests['config/candidate.json'] },
    baseline: { manifest: resolve(String(options['baseline-manifest'])), manifestSha256: sha(String(options['baseline-manifest'])), deployedEntry },
    fixtureDigests: digests, payloadBytes: Buffer.byteLength(payload),
    supervisorAlone: { samples: alone }, migrated, noSubscriber, ...(options['post-tool'] ? { postTool } : {}),
  };
  const verdict = smoke ? null : judgePilot(results, workload);
  writeFileSync(join(out, `results-${tag}.json`), `${JSON.stringify({ ...results, verdict }, null, 2)}\n`);
  const show = (/** @type {string} */ name, /** @type {number[]} */ v) => v.length ? `${name.padEnd(28)} ${Object.entries(statistics(v)).map(([k, x]) => `${k} ${typeof x === 'number' ? x.toFixed(1) : x}`).join('  ')}` : `${name}: no samples`;
  const table = [
    `runtime ${runtime} (${node}) host ${results.host} cpus ${results.cpus} load ${JSON.stringify(loadLog)}`,
    `candidate ${results.candidate.commit}${results.candidate.dirty ? ' (dirty)' : ''}`,
    show('supervisor-alone startup', alone.map((s) => s.startupMs)), show('supervisor-alone cleanup', alone.map((s) => s.cleanupMs)), show('supervisor-alone combined', alone.map((s) => s.combinedMs)),
    show('migrated baseline', migrated.baseline.map((s) => s.elapsedMs)), show('migrated candidate', migrated.candidate.map((s) => s.elapsedMs)),
    show('no-subscriber deployed', noSubscriber.deployed), show('no-subscriber candidate', noSubscriber.candidate), show('no-subscriber native', noSubscriber.native),
    ...(options['post-tool'] ? [show('posttool native-only baseline', postTool.baseline.map((x) => x.elapsedMs)), show('posttool relayed candidate', postTool.candidate.map((x) => x.elapsedMs)),
      `posttool diagnostic (not gated in Task 3): failed ${[...postTool.baseline, ...postTool.candidate].filter((x) => !x.ok).length}; deltas ${postTool.candidate.length ? ['p95', 'p99', 'max'].map((q) => `${q} ${(/** @type {any} */ (statistics(postTool.candidate.map((x) => x.elapsedMs)))[q] - /** @type {any} */ (statistics(postTool.baseline.map((x) => x.elapsedMs)))[q]).toFixed(1)}`).join(' ') : 'none'} (warm bounds +100/+150/+250)`] : []),
    `failed calls: migrated ${[...migrated.baseline, ...migrated.candidate].filter((s) => !s.ok).length}, no-subscriber ${noSubscriber.failures.length}; candidate supervisors per dispatch ${[...new Set(migrated.candidate.map((s) => s.supervisors))].join(',')}; empty-candidate supervisor starts ${noSubscriber.candidateSupervisorStarts}`,
    verdict ? `verdict: ${verdict.passed ? 'PASS' : 'FAIL'}${verdict.failures.length ? ` — ${verdict.failures.join('; ')}` : ''}` : 'smoke: no verdict',
  ].join('\n');
  writeFileSync(join(out, `summary-${tag}.txt`), `${table}\n`);
  process.stdout.write(`${table}\n`);
  if (smoke) for (const s of [...migrated.baseline, ...migrated.candidate]) if (!s.ok) process.stdout.write(`failed sample: ${JSON.stringify(s)}\n`);
  return verdict === null ? 0 : verdict.passed ? 0 : 1;
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (!options.output) throw new Error('--output DIR is required');
  if (options.prepare) { prepare(resolve(String(options.output))); return 0; }
  if (!options.candidate || !options['baseline-manifest']) throw new Error('--candidate and --baseline-manifest are required');
  // Re-execute through a `claude`-named link so launched hooks have a verified fake harness ancestor.
  if (basename(process.argv0) !== 'claude') {
    const link = join(resolve(String(options.output)), `harness-${process.version}`, 'claude');
    mkdirSync(dirname(link), { recursive: true }); rmSync(link, { force: true }); symlinkSync(process.execPath, link);
    const child = spawnSync(link, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', timeout: 300000, killSignal: 'SIGKILL' });
    return child.status ?? 1;
  }
  return measure(options);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
