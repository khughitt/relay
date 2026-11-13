// @ts-check
// Route qualification runner (plan revision 3, "Final route qualification"). Local synthetic
// processes only: no model, harness session or network request.
//
//   node run.mjs --prepare --output DIR
//       write the qualification fixture programs once and print their digests
//   node run.mjs --candidate DIR --baseline-manifest FILE --workload FILE --output DIR (--pilot|--measure) [--route HARNESS:EVENT]...
//       run every condition of the frozen table for each selected route of a host's manifest set
//
// --pilot runs one case of every condition, to validate cleanup and results before a measurement;
// --measure runs the frozen counts. Each route runs in its own process with the table's 10-minute
// wall bound, named for the harness in /proc comm so every hook has a verified fake harness
// ancestor (checked before timing), and writes its own result file: a rerun skips a route whose result for the same
// candidate commit, manifest and mode is already written. One host's results never qualify a route
// on their own; judge.mjs combines both hosts' results. --route selects routes, never their workload.
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cpus } from 'node:os';
import { statistics } from './statistics.mjs';
import { validateManifest, checkRetainedWork, runBaseline, workLists } from './baseline.mjs';
import { judge } from './judge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS_COMMANDS = /** @type {Record<string, string>} */ ({ 'claude-code': 'claude', codex: 'codex' });
/** @param {string} path */
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
/** @type {(message: string) => never} */
const refuse = (message) => { throw Object.assign(new Error(message), { code: 'QUALIFICATION_INPUT' }); };
/** @param {string} value */
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

// ---- fake harness ancestor ----

/** Names this process for its harness in /proc comm, so hooks it launches find it as their session
 * ancestor. Written after startup, since Node 24 and later rename the main thread then (for example
 * node-MainThread). The command line stays the runner's own, so command-line views (ps -f, pgrep -f,
 * host-load) show the runner; comm-based listings show the harness name, which hooks need. @param {string} harness */
export function becomeHarness(harness) {
  writeFileSync('/proc/self/comm', HARNESS_COMMANDS[harness] ?? refuse(`${harness} has no harness command to stand in for`));
}

/** The session pid a hook launched from this process the way the runner launches hooks (under
 * /bin/sh) resolves with the candidate's own adapter. @param {{candidate: string, harness: string, node?: string}} options
 * @returns {number|null} */
export function hookSessionPid({ candidate, harness, node = process.execPath }) {
  const adapters = pathToFileURL(join(candidate, 'src/adapters/index.js')).href;
  const script = `const { adapterFor } = await import(${JSON.stringify(adapters)}); process.stdout.write(JSON.stringify(adapterFor(${JSON.stringify(harness)}).resolveSessionPid() ?? null));`;
  const probe = spawnSync('/bin/sh', ['-c', `${shellQuote(node)} --input-type=module -e ${shellQuote(script)}`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 10000 });
  if (probe.status !== 0) refuse(`the session ancestry probe failed: ${probe.stderr.trim() || probe.error?.message || `exit ${probe.status ?? probe.signal}`}`);
  return JSON.parse(probe.stdout);
}

/** Refuses a route whose hooks would not resolve this process as their session: without it every
 * candidate condition carries a missing-handle diagnostic, and under a real harness session the
 * hooks would borrow that outer session silently. @param {number|null} resolved @param {number} [pid] */
export function assertHarnessAncestor(resolved, pid = process.pid) {
  if (resolved !== pid) refuse(`hooks would resolve session ${resolved ?? 'none'}, not this route's fake harness process ${pid}`);
}

// ---- fixture ----

/** Every fixture program does the same work (read stdin, note its parent's pid and command line)
 * and differs from the others only in the reply encoding its side's protocol needs. */
const WORK = 'cat >/dev/null\nIFS= read -r parent < /proc/$PPID/cmdline\necho "$PPID $parent" >> "$RELAY_PILOT_PPID_FILE"\n';
/** @param {number} contextChars @returns {Record<string, {work: string, reply: string}>} */
const fixturePrograms = (contextChars) => ({
  'relay-fixture-guard': { work: WORK, reply: `printf '{"decision":"allow"}'\n` },
  'relay-fixture-notice': { work: WORK, reply: `printf '{"context":"${'n'.repeat(contextChars)}"}'\n` },
  'relay-fixture-observer': { work: WORK, reply: '' },
  'relay-fixture-native': { work: WORK, reply: '' },
  // The timeout condition: a grandchild in the subscriber's own group, its pid noted for the survivor check.
  'relay-fixture-hang': { work: 'cat >/dev/null\nsleep 30 &\necho $! >> "$RELAY_QUAL_GRANDCHILD_FILE"\n', reply: 'sleep 30\n' },
});
// Notes every child_process.spawn a hook makes in $RELAY_SPAWN_LOG (start probes only).
const SPAWN_RECORDER = `const cp = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const spawn = cp.spawn;
cp.spawn = function (command, args, options) {
  const child = spawn.call(this, command, args, options);
  if (process.env.RELAY_SPAWN_LOG) appendFileSync(process.env.RELAY_SPAWN_LOG, [command, ...(args ?? [])].join(' ') + '\\n');
  return child;
};
syncBuiltinESMExports();
`;
/** @param {{work: string, reply: string}} program */
const programText = ({ work, reply }) => `#!/bin/sh\n${work}${reply}`;
/** @param {string} text */
const digestOf = (text) => createHash('sha256').update(text).digest('hex');

/** @param {string} out @param {any} workload */
function prepare(out, workload) {
  const fixture = join(out, 'fixture'), bin = join(fixture, 'bin');
  mkdirSync(bin, { recursive: true }); mkdirSync(join(fixture, 'config'), { recursive: true, mode: 0o700 }); mkdirSync(join(fixture, 'cwd'), { recursive: true });
  /** @type {Record<string, {sha256: string, work: string, reply: string}>} */
  const programs = {};
  for (const [name, program] of Object.entries(fixturePrograms(workload.qualification.contextChars))) {
    writeFileSync(join(bin, name), programText(program), { mode: 0o755 });
    programs[name] = { sha256: sha(join(bin, name)), work: digestOf(program.work), reply: digestOf(program.reply) };
  }
  writeFileSync(join(fixture, 'programs.json'), `${JSON.stringify(programs, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ fixture, programs }, null, 2)}\n`);
}

// ---- inputs ----

/** @param {string[]} argv */
function parse(argv) {
  /** @type {Record<string, any>} */
  const options = { route: [] };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (['--pilot', '--measure', '--prepare'].includes(key)) options[key.slice(2)] = true;
    else if (key === '--route' && i + 1 < argv.length) options.route.push(argv[++i]);
    else if (['--candidate', '--baseline-manifest', '--workload', '--output', '--one'].includes(key) && i + 1 < argv.length) options[key.slice(2)] = argv[++i];
    else refuse(`unknown or incomplete option ${key}`);
  }
  return options;
}

/** A host's manifest set: one frozen manifest per route, sharing the host. @param {string} file */
function manifestsOf(file) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  const manifests = value?.manifests ?? [value];
  if (!Array.isArray(manifests) || !manifests.length) refuse('the manifest set names no routes');
  for (const m of manifests) {
    validateManifest(m, { harness: m?.harness, event: m?.event });
    if (!HARNESS_COMMANDS[m.harness]) refuse(`${m.harness} has no harness command to stand in for`);
    if (!Array.isArray(m.inventory?.relayedEvents)) refuse(`${m.harness} ${m.event}: the manifest needs inventory.relayedEvents from the deployed settings`);
    if (typeof m.fixture !== 'string' || typeof m.candidate.config !== 'string' || m.payload === null || typeof m.payload !== 'object') refuse(`${m.harness} ${m.event}: the manifest needs fixture, candidate.config and payload`);
    if (m.baselineKind === 'deployed-relay-plus-native' && typeof m.deployed.config !== 'string') refuse(`${m.harness} ${m.event}: a deployed baseline needs deployed.config`);
  }
  return manifests;
}
/** @param {any} m */
const routeKey = (m) => `${m.harness}:${m.event}`;
/** @param {any} m */
const routeDir = (m) => `${m.harness}-${m.event.replace(/[^A-Za-z0-9_-]/g, '_')}`;

/**
 * The deployed package, checked file by file against its frozen `sha256  path` list (package.json,
 * bin/ and src/): the list's own digest when every file matches and none is missing or extra, or
 * the word "mismatch" with the differing paths. The list's line order is whatever froze it.
 * @param {any} manifest @param {string} setDir @returns {string}
 */
function deployedDigestOf(manifest, setDir) {
  const list = resolve(setDir, manifest.deployed.fileList ?? refuse(`${manifest.harness} ${manifest.event}: a deployed baseline needs deployed.fileList`));
  if (sha(list) !== manifest.deployed.packageSha256) return 'mismatch: the frozen file list changed';
  const root = dirname(dirname(manifest.deployed.relayEntry));
  /** @param {string} dir @returns {string[]} */
  const walk = (dir) => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []);
  let present;
  try { present = new Set(['package.json', ...walk('bin'), ...walk('src')]); } catch { return 'mismatch: the deployed package cannot be read'; }
  const frozen = new Map(readFileSync(list, 'utf8').split('\n').filter(Boolean).map((line) => { const [digest, ...path] = line.split('  '); return [path.join('  '), digest]; }));
  const differing = [...new Set([...present, ...frozen.keys()])].filter((path) => !present.has(path) || !frozen.has(path) || sha(join(root, path)) !== frozen.get(path));
  return differing.length ? `mismatch: ${differing.slice(0, 5).join(', ')}` : manifest.deployed.packageSha256;
}

/** git in a clean environment, so an inherited GIT_DIR cannot redirect it. @param {string} dir @param {string[]} args */
const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/', GIT_CONFIG_NOSYSTEM: '1' } }).trim();
const load = () => { try { return readFileSync('/proc/loadavg', 'utf8').trim(); } catch { return 'unavailable'; } };

// ---- one route ----

/** @param {Record<string, any>} options */
async function runRoute(options) {
  const setFile = resolve(String(options['baseline-manifest'])), setDir = dirname(setFile);
  const manifest = manifestsOf(setFile).find((m) => routeKey(m) === options.one) ?? refuse(`no manifest for ${options.one}`);
  const workloadFile = resolve(String(options.workload)), workload = JSON.parse(readFileSync(workloadFile, 'utf8')), q = workload.qualification;
  const candidate = resolve(String(options.candidate)), out = resolve(String(options.output)), pilot = options.pilot === true;
  const fixture = resolve(setDir, manifest.fixture), fixtureBin = join(fixture, 'bin'), fixtureConfig = join(fixture, 'config');
  const node = process.execPath, runtime = process.version, harness = manifest.harness, event = manifest.event, nativeEvent = event.split(':', 1)[0];
  becomeHarness(harness);
  const harnessAncestor = { pid: process.pid, resolved: hookSessionPid({ candidate, harness, node }) };
  assertHarnessAncestor(harnessAncestor.resolved, harnessAncestor.pid);
  const { adapterFor } = await import(pathToFileURL(join(candidate, 'src/adapters/index.js')).href);
  const adapter = adapterFor(harness);
  const outerMs = Math.min(q.outerMs, adapter.outerTimeouts.max?.[nativeEvent] ?? q.outerMs);
  const candidateConfig = join(fixtureConfig, manifest.candidate.config);
  if (sha(candidateConfig) !== manifest.candidate.configSha256) refuse(`${options.one}: the candidate config changed since the manifest was frozen`);
  const relayed = manifest.baselineKind === 'deployed-relay-plus-native';
  const deployedConfig = relayed ? join(fixtureConfig, manifest.deployed.config) : null;
  const deployedDigest = relayed ? deployedDigestOf(manifest, setDir) : null;
  const work = join(out, routeDir(manifest), `${runtime}${pilot ? '-pilot' : ''}`);
  rmSync(work, { recursive: true, force: true });
  const home = join(work, 'home'), notes = join(work, 'notes'), workBin = join(work, 'bin'), workConfig = join(work, 'config');
  for (const dir of [home, notes, workBin]) mkdirSync(dir, { recursive: true });
  mkdirSync(workConfig, { recursive: true, mode: 0o700 });
  let counter = 0;
  const stateDir = (/** @type {string} */ name) => { const dir = join(work, 'state', name); mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; };
  const env = (/** @type {string} */ state) => { const n = ++counter; return { PATH: `${workBin}:${fixtureBin}:/usr/bin:/bin`, HOME: home, RELAY_STATE_DIR: state,
    XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.local/state'), RELAY_PILOT_PPID_FILE: join(notes, `${n}.ppid`), RELAY_QUAL_GRANDCHILD_FILE: join(notes, `${n}.grandchild`) }; };
  const lines = (/** @type {string} */ file) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  const vars = { '@NODE@': node, '@FIXTURE@': fixture, '@DEPLOYED@': relayed ? manifest.deployed.relayEntry : '', '@CONFIG@': fixtureConfig, '@CANDIDATE@': candidate };
  const substitute = (/** @type {string} */ value) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(k, v), value);
  const baselineBranches = manifest.branches.map((/** @type {any} */ b) => ({ ...b, argv: b.argv.map(substitute) }));
  const hook = (/** @type {string} */ entry, /** @type {string} */ config, /** @type {number} */ outer, /** @type {string} */ preload = '') =>
    `${shellQuote(node)}${preload ? ` --require ${shellQuote(preload)}` : ''} ${shellQuote(entry)} hook --harness ${harness} --outer-ms ${outer} --subscribers ${shellQuote(config)} ${event}`;
  // Start probes (never timed samples) preload a recorder that notes each process the hook spawns.
  const recorder = join(workBin, 'spawn-recorder.cjs');
  writeFileSync(recorder, SPAWN_RECORDER);
  /** Whether a hook run spawned the dispatch supervisor, observed in a fresh runtime directory. @param {string} config @param {string} name */
  const supervisorStarted = async (config, name) => {
    const log = join(notes, `${name}.spawns`), state = stateDir(name);
    const e = { ...env(state), RELAY_SPAWN_LOG: log };
    const r = await runBaseline(single(name, hook(join(candidate, 'bin/relay.js'), config, outerMs, recorder)), { event, input: payload, env: e, cwd, capture: true });
    return { ok: r.statuses.every((x) => x === 'exited 0') && r.survivors.length === 0, statuses: r.statuses, started: lines(log).some((line) => line.includes('supervisor-process.js')) };
  };
  /** A composition of the candidate relay with the native branches the cutover keeps. @param {string} config */
  const candidateOf = (config) => ({ ...manifest, baselineKind: 'native-only', deployed: null,
    branches: [{ name: 'candidate-relay', role: 'native', argv: ['/bin/sh', '-c', hook(join(candidate, 'bin/relay.js'), config, outerMs)] },
      ...baselineBranches.filter((/** @type {any} */ b) => b.role === 'native' && b.migrates === false)] });
  const single = (/** @type {string} */ name, /** @type {string} */ command) => ({ ...manifest, baselineKind: 'native-only', deployed: null, branches: [{ name, role: 'native', argv: ['/bin/sh', '-c', command] }] });
  const baselineEvent = { ...manifest, branches: baselineBranches };
  // Work each side runs, from the configurations themselves, and the fixture body each invocation runs.
  const configOf = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));
  const deployedSubscribers = deployedConfig ? configOf(deployedConfig) : null, candidateSubscribers = configOf(candidateConfig);
  const migrating = baselineBranches.filter((/** @type {any} */ b) => b.role === 'native' && b.migrates !== false);
  const lists = workLists({ deployed: deployedSubscribers, candidate: candidateSubscribers, native: migrating.map((/** @type {any} */ b) => b.name) });
  checkRetainedWork(manifest, lists);
  // Each invocation is identified by the work its fixture program does; a program that is not the
  // prepared one, or changed since, identifies nothing.
  const programs = JSON.parse(readFileSync(join(fixture, 'programs.json'), 'utf8'));
  const programOf = (/** @type {string} */ argv0) => { const path = isAbsolute(argv0) ? argv0 : join(fixtureBin, argv0), known = programs[path.split('/').at(-1) ?? ''];
    return known && existsSync(path) && sha(path) === known.sha256 ? known.work : null; };
  const fixtures = {
    baseline: Object.fromEntries([...(deployedSubscribers?.subscribers ?? []).map((/** @type {any} */ s) => [`deployed-relay:${s.name}`, programOf(s.argv[0])]),
      ...migrating.map((/** @type {any} */ b) => [b.name, b.fixture ? programOf(b.fixture) : null])]),
    candidate: Object.fromEntries(candidateSubscribers.subscribers.map((/** @type {any} */ s) => [`candidate:${s.name}`, programOf(s.argv[0])])),
  };
  const expected = { baseline: lists.baseline.length, candidate: lists.candidate.length };
  // A native payload of the declared size for this event, in the fixture's own working directory
  // unless the manifest names one.
  const cwd = typeof manifest.payload.cwd === 'string' ? manifest.payload.cwd : join(fixture, 'cwd');
  const payload = (() => {
    const base = { cwd, ...structuredClone(manifest.payload) }, path = manifest.padField ?? [];
    if (!path.length) return JSON.stringify(base);
    const parent = path.slice(0, -1).reduce((/** @type {any} */ o, /** @type {string} */ k) => o[k], base), field = path.at(-1);
    parent[field] = '';
    parent[field] = 'x'.repeat(Math.max(0, q.payloadBytes - Buffer.byteLength(JSON.stringify(base))));
    return JSON.stringify(base);
  })();
  /** @param {any} m @param {string} state @param {'baseline'|'candidate'} side */
  const sample = async (m, state, side) => {
    const e = env(state), r = await runBaseline(m, { event, input: payload, env: e, cwd, capture: true });
    const seen = lines(e.RELAY_PILOT_PPID_FILE), relay = r.branches.find((b) => b.name === 'candidate-relay');
    return { elapsedMs: r.elapsedMs, ok: r.statuses.every((s) => s === 'exited 0') && r.survivors.length === 0 && seen.length === expected[side],
      statuses: r.statuses, survivors: r.survivors, invocations: seen.length, stderr: side === 'candidate' ? relay?.stderr ?? '' : '', stateDir: state,
      branches: r.branches.map(({ name, startedMs, elapsedMs }) => ({ name, startedMs, elapsedMs })) };
  };
  const loadLog = /** @type {Record<string, string>} */ ({ start: load() });
  const counts = pilot
    ? { warmups: 0, warm: 1, cold: 1, missing: 1, timeout: 1, batches: 1, alone: 1, noneWarmups: 0, none: 1 }
    : { warmups: q.conditions.warm.warmups, warm: q.conditions.warm.samples, cold: q.conditions.cold.samples, missing: q.conditions.missing.samples, timeout: q.conditions.timeout.samples,
      batches: q.conditions.concurrent.batches, alone: q.conditions.supervisorAlone.samples, noneWarmups: q.conditions.noSubscriber.warmups, none: q.conditions.noSubscriber.samples };
  const candidateEvent = candidateOf(candidateConfig);
  /** @type {Record<string, any>} */
  const conditions = {};

  // Supervisor alone: fresh supervisors, each with one no-op child, timed through close.
  const { createChildSupervisor } = await import(pathToFileURL(join(candidate, 'src/child-supervisor.js')).href);
  const aloneState = stateDir('supervisor-alone');
  conditions.supervisorAlone = [];
  for (let i = 0; i < counts.alone; i++) {
    const t0 = performance.now();
    const supervisor = await createChildSupervisor({ deadline: t0 + 10000, sessionHandle: null, recordDir: join(aloneState, 'children') });
    const t1 = performance.now();
    const result = await supervisor.runChild(['/bin/true'], '', { timeoutMs: q.timeoutMs, deadline: t0 + 10000, env: { PATH: '/usr/bin:/bin' }, cwd: '/' });
    const t2 = performance.now(), closed = await supervisor.close(), t3 = performance.now();
    conditions.supervisorAlone.push({ startupMs: t1 - t0, runMs: t2 - t1, cleanupMs: (result.timings?.cleanupMs ?? 0) + (t3 - t2), combinedMs: t3 - t0,
      cleanup: result.cleanup === 'complete' && closed.cleanup === 'complete' ? 'complete' : 'failed' });
  }
  loadLog.supervisorAlone = load();

  // Warm serial: one runtime directory per side, interleaved samples after excluded warmups.
  const warmBase = stateDir('warm-baseline'), warmCand = stateDir('warm-candidate');
  conditions.warm = { baseline: [], candidate: [] };
  for (let i = 0; i < counts.warmups + counts.warm; i++) {
    const b = await sample(baselineEvent, warmBase, 'baseline'), c = await sample(candidateEvent, warmCand, 'candidate');
    if (i >= counts.warmups) { conditions.warm.baseline.push(b); conditions.warm.candidate.push(c); }
  }
  loadLog.warm = load();

  // Fresh-process cold: every sample a new process and its own runtime directory.
  conditions.cold = { baseline: [], candidate: [] };
  for (let i = 0; i < counts.cold; i++) {
    conditions.cold.baseline.push(await sample(baselineEvent, stateDir(`cold-baseline-${i}`), 'baseline'));
    conditions.cold.candidate.push(await sample(candidateEvent, stateDir(`cold-candidate-${i}`), 'candidate'));
  }
  loadLog.cold = load();

  // A derived candidate config with the first subscriber's program replaced.
  const derived = (/** @type {string} */ name, /** @type {any} */ change) => {
    const value = structuredClone(candidateSubscribers);
    value.subscribers[0] = { ...value.subscribers[0], ...change };
    const file = join(workConfig, name); writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 }); return file;
  };
  const first = candidateSubscribers.subscribers[0];
  if (!first) refuse(`${options.one}: the candidate config has no subscriber for the failure conditions`);
  const refusable = adapter.replies[nativeEvent]?.refuse === true;
  const allowReply = adapter.encodeReply(nativeEvent, { decision: 'allow' }), denyReply = refusable ? adapter.encodeReply(nativeEvent, { decision: 'deny', reason: 'relay refused' }) : null;
  const keys = (/** @type {string} */ text) => { try { return JSON.stringify(Object.keys(JSON.parse(text)).sort()); } catch { return null; } };
  /** What a reply did: refused (the native refusal's shape and exit), allowed, or anything else. @param {string} stdout @param {number|null} exit */
  const replyKind = (stdout, exit) => {
    if (denyReply && exit === denyReply.exitCode && (denyReply.stdout === '' ? exit !== allowReply.exitCode : keys(stdout) === keys(denyReply.stdout) && stdout !== allowReply.stdout && /deny|block/.test(stdout))) return 'refusal';
    return exit === allowReply.exitCode ? 'allow' : 'other';
  };
  const exitOf = (/** @type {string} */ status) => /^exited (\d+)$/.exec(status) ? Number(/^exited (\d+)$/.exec(status)?.[1]) : null;

  // Missing first command: the role's own failure, within the bound, with no fallback executable.
  const missingConfig = derived('missing.json', { argv: ['relay-qualification-missing', ...first.argv.slice(1)] }), missingEvent = candidateOf(missingConfig);
  const expectedFailure = first.role === 'guard' && refusable ? 'refusal' : 'allow';
  conditions.missing = [];
  for (let i = 0; i < counts.missing; i++) {
    const e = env(stateDir('missing')), r = await runBaseline(missingEvent, { event, input: payload, env: e, cwd, capture: true });
    const relay = /** @type {any} */ (r.branches.find((b) => b.name === 'candidate-relay')), seen = lines(e.RELAY_PILOT_PPID_FILE).length;
    const observed = replyKind(relay.stdout ?? '', exitOf(relay.status));
    conditions.missing.push({ elapsedMs: r.elapsedMs, ok: exitOf(relay.status) !== null && r.survivors.length === 0 && /EXECUTABLE_NOT_FOUND/.test(`${relay.stdout}${relay.stderr}`),
      expected: expectedFailure, observed, fallback: seen > expected.candidate - 1, survivors: r.survivors });
  }
  loadLog.missing = load();

  // Timeout with a grandchild: the group is contained within the bound and nothing survives it.
  const hangConfig = derived('timeout.json', { argv: ['relay-fixture-hang'], timeoutMs: q.timeoutMs }), hangEvent = candidateOf(hangConfig);
  const hangProgram = join(workBin, 'relay-fixture-hang');
  writeFileSync(hangProgram, programText(fixturePrograms(q.contextChars)['relay-fixture-hang']), { mode: 0o755 });
  conditions.timeout = [];
  for (let i = 0; i < counts.timeout; i++) {
    const e = env(stateDir('timeout')), r = await runBaseline(hangEvent, { event, input: payload, env: e, cwd, capture: true });
    await new Promise((done) => setTimeout(done, 50));
    // Survivors are recorded before the rescue kill, which marks the sample failed.
    const alive = lines(e.RELAY_QUAL_GRANDCHILD_FILE).map(Number).filter((pid) => { try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').startsWith('sleep'); } catch { return false; } });
    for (const pid of alive) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    const relay = /** @type {any} */ (r.branches.find((b) => b.name === 'candidate-relay'));
    conditions.timeout.push({ elapsedMs: r.elapsedMs, ok: exitOf(relay.status) !== null && lines(e.RELAY_QUAL_GRANDCHILD_FILE).length > 0,
      cleanup: alive.length === 0 && r.survivors.length === 0 ? 'complete' : 'failed', survivors: [...r.survivors, ...alive.map((pid) => `grandchild ${pid}`)] });
  }
  loadLog.timeout = load();

  // Concurrent: batches of calls at once per side, sharing that side's registry.
  const batchSize = q.conditions.concurrent.batchSize, concBase = stateDir('concurrent-baseline'), concCand = stateDir('concurrent-candidate');
  conditions.concurrent = { baseline: [], candidate: [], lostOccurrences: 0 };
  for (let i = 0; i < counts.batches; i++) {
    conditions.concurrent.baseline.push(...await Promise.all(Array.from({ length: batchSize }, () => sample(baselineEvent, concBase, 'baseline'))));
    const batch = await Promise.all(Array.from({ length: batchSize }, () => sample(candidateEvent, concCand, 'candidate')));
    conditions.concurrent.lostOccurrences += batch.reduce((n, s) => n + Math.max(0, expected.candidate - s.invocations), 0);
    conditions.concurrent.candidate.push(...batch);
  }
  loadLog.concurrent = load();

  // No-subscriber relay paths and the direct native reader: required diagnostics, never gated.
  const emptyCandidate = join(fixtureConfig, manifest.noSubscriber?.candidate ?? 'candidate-empty.json');
  const emptyDeployed = relayed ? join(fixtureConfig, manifest.noSubscriber?.deployed ?? 'deployed-empty.json') : null;
  const speculative = manifest.noSubscriber?.speculative ? join(fixtureConfig, manifest.noSubscriber.speculative) : null;
  const none = /** @type {any} */ ({ candidate: [], native: [], failures: [], starts: {} });
  if (relayed) none.deployed = [];
  if (speculative) none.speculative = [];
  const noneState = { deployed: stateDir('none-deployed'), candidate: stateDir('none-candidate'), native: stateDir('none-native') };
  const plain = async (/** @type {any} */ m, /** @type {string} */ state) => { const e = env(state), r = await runBaseline(m, { event, input: payload, env: e, cwd, capture: true });
    return { elapsedMs: r.elapsedMs, ok: r.statuses.every((s) => s === 'exited 0') && r.survivors.length === 0, statuses: r.statuses, survivors: r.survivors }; };
  const noneEvents = /** @type {[string, any, string][]} */ ([
    ...(relayed && emptyDeployed ? /** @type {[string, any, string][]} */ ([['deployed', single('deployed-empty', hook(manifest.deployed.relayEntry, emptyDeployed, manifest.deployed.outerMs ?? 600000)), noneState.deployed]]) : []),
    ['candidate', single('candidate-empty', hook(join(candidate, 'bin/relay.js'), emptyCandidate, outerMs)), noneState.candidate],
    ['native', single('native', join(fixtureBin, 'relay-fixture-native')), noneState.native],
    // A config whose only subscriber this payload's filter rejects: the supervisor starts speculatively, unused.
    ...(speculative ? /** @type {[string, any, string][]} */ ([['speculative', single('candidate-speculative', hook(join(candidate, 'bin/relay.js'), speculative, outerMs)), stateDir('none-speculative')]]) : [])]);
  for (let i = 0; i < counts.noneWarmups + counts.none; i++) {
    for (const [name, m, state] of noneEvents) {
      const r = await plain(m, state);
      if (i < counts.noneWarmups) continue;
      none[name].push(r.elapsedMs);
      if (!r.ok) none.failures.push({ name, ...r });
    }
  }
  // Observed, not inferred: a spawn of the supervisor process in a probe run.
  for (const [name, config] of /** @type {[string, string|null][]} */ ([['candidate', emptyCandidate], ['speculative', speculative]])) {
    if (!config) continue;
    const probe = await supervisorStarted(config, `${name}-start-probe`);
    if (!probe.ok) none.failures.push({ name: `${name} start probe`, statuses: probe.statuses });
    none.starts[name] = probe.started;
  }
  conditions.noSubscriber = none;
  loadLog.end = load();

  const result = {
    schema: 1, mode: pilot ? 'pilot' : 'measure', route: { harness, event, outerMs }, host: execFileSync('uname', ['-n'], { encoding: 'utf8' }).trim(), runtime, node, timeoutMs: q.timeoutMs,
    cpus: cpus().length, load: loadLog, harnessAncestor,
    candidate: { path: candidate, commit: git(candidate, ['rev-parse', 'HEAD']), dirty: git(candidate, ['status', '--porcelain', '--untracked-files=no']).length > 0,
      entry: join(candidate, 'bin/relay.js'), configSha256: manifest.candidate.configSha256 },
    manifest, manifestSetSha256: sha(setFile), workloadSha256: sha(workloadFile), deployedDigest, workLists: lists, fixtures,
    derivedConfigs: { missing: sha(missingConfig), timeout: sha(hangConfig) }, payloadBytes: Buffer.byteLength(payload), conditions,
    label: 'synthetic transport evidence: fixture bodies stand in for policy commands, whose own cost is replayed before each policy cutover',
  };
  writeFileSync(join(out, routeDir(manifest), `${runtime}${pilot ? '-pilot' : ''}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

// ---- report ----

/** @param {any} result */
function pilotProblems(result) {
  const k = result.conditions, problems = [];
  const each = (/** @type {string} */ name, /** @type {any[]} */ list) => { for (const s of list) if (!s.ok || s.survivors?.length) problems.push(`${name}: ${JSON.stringify(s).slice(0, 400)}`); };
  for (const name of ['warm', 'cold', 'concurrent']) { each(`${name} baseline`, k[name].baseline); each(`${name} candidate`, k[name].candidate); for (const s of k[name].candidate) if (s.stderr) problems.push(`${name} candidate diagnostic: ${s.stderr.slice(0, 300)}`); }
  each('missing first command', k.missing); each('timeout with grandchild', k.timeout);
  for (const s of k.missing) if (s.observed !== s.expected || s.fallback) problems.push(`missing first command: expected ${s.expected}, observed ${s.observed}${s.fallback ? ', with fallback' : ''}`);
  for (const s of k.timeout) if (s.cleanup !== 'complete') problems.push('timeout with grandchild: cleanup incomplete');
  if (k.concurrent.lostOccurrences) problems.push(`concurrent: ${k.concurrent.lostOccurrences} lost occurrence(s)`);
  for (const s of k.supervisorAlone) if (s.cleanup !== 'complete') problems.push('supervisor-alone cleanup incomplete');
  if (k.noSubscriber.failures.length) problems.push(`no-subscriber: ${JSON.stringify(k.noSubscriber.failures).slice(0, 400)}`);
  if (k.noSubscriber.starts.candidate) problems.push('no-subscriber: the empty candidate started a supervisor');
  if ('speculative' in k.noSubscriber.starts && !k.noSubscriber.starts.speculative) problems.push('no-subscriber: the speculative supervisor start was not observed');
  return problems;
}

/** @param {any} result */
function table(result) {
  const k = result.conditions;
  const show = (/** @type {string} */ name, /** @type {number[]} */ v) => v.length ? `  ${name.padEnd(30)} ${Object.entries(statistics(v)).map(([key, x]) => `${key} ${typeof x === 'number' ? x.toFixed(1) : x}`).join('  ')}` : `  ${name}: no samples`;
  return [`${result.route.harness} ${result.route.event} (outer ${result.route.outerMs} ms) on ${result.host}, ${result.runtime}, ${result.mode}; candidate ${result.candidate.commit}${result.candidate.dirty ? ' (dirty)' : ''}; baseline ${result.manifest.baselineKind}`,
    show('supervisor-alone combined', k.supervisorAlone.map((/** @type {any} */ s) => s.combinedMs)),
    ...['warm', 'cold', 'concurrent'].flatMap((name) => [show(`${name} baseline`, k[name].baseline.map((/** @type {any} */ s) => s.elapsedMs)), show(`${name} candidate`, k[name].candidate.map((/** @type {any} */ s) => s.elapsedMs))]),
    show('missing first command', k.missing.map((/** @type {any} */ s) => s.elapsedMs)), show('timeout with grandchild', k.timeout.map((/** @type {any} */ s) => s.elapsedMs)),
    ...Object.entries(k.noSubscriber).filter(([name, v]) => name !== 'failures' && Array.isArray(v)).map(([name, v]) => show(`no-subscriber ${name}`, /** @type {number[]} */ (v))),
    `  load ${JSON.stringify(result.load)}`].join('\n');
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (!options.output) refuse('--output DIR is required');
  const workloadFile = options.workload ?? join(HERE, 'workload.json');
  if (options.prepare) { prepare(resolve(String(options.output)), JSON.parse(readFileSync(workloadFile, 'utf8'))); return 0; }
  if (!options.candidate || !options['baseline-manifest'] || !options.workload) refuse('--candidate, --baseline-manifest and --workload are required');
  if (options.pilot === options.measure) refuse('choose exactly one of --pilot and --measure');
  if (options.one) return runRoute(options);
  const workload = JSON.parse(readFileSync(workloadFile, 'utf8')), out = resolve(String(options.output)), mode = options.pilot ? 'pilot' : 'measure';
  const manifests = manifestsOf(resolve(String(options['baseline-manifest'])));
  const known = manifests.map(routeKey);
  for (const r of options.route) if (!known.includes(r)) refuse(`--route ${r} is not in the manifest set (${known.join(', ')})`);
  const selected = options.route.length ? manifests.filter((m) => options.route.includes(routeKey(m))) : manifests;
  const commit = git(resolve(String(options.candidate)), ['rev-parse', 'HEAD']), setSha = sha(resolve(String(options['baseline-manifest'])));
  mkdirSync(out, { recursive: true });
  let failed = 0;
  /** @type {any[]} */
  const results = [];
  for (const m of selected) {
    const file = join(out, routeDir(m), `${process.version}${mode === 'pilot' ? '-pilot' : ''}.json`);
    const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    if (!(prior && prior.candidate?.commit === commit && prior.manifestSetSha256 === setSha && prior.mode === mode)) {
      // Each route names itself for its harness (becomeHarness), so its hooks have a verified fake harness ancestor.
      const args = [fileURLToPath(import.meta.url), ...process.argv.slice(2).filter((a, i, all) => a !== '--route' && all[i - 1] !== '--route'), '--one', routeKey(m)];
      const child = spawnSync(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'], timeout: workload.qualification.wallMs, killSignal: 'SIGKILL' });
      if (child.status !== 0 || !existsSync(file)) { failed++; process.stdout.write(`${routeKey(m)}: run failed (${child.error?.message ?? `exit ${child.status ?? child.signal}`}); no result written\n`); continue; }
    }
    const result = JSON.parse(readFileSync(file, 'utf8'));
    results.push(result);
    process.stdout.write(`${table(result)}\n`);
    if (mode === 'pilot') {
      const problems = pilotProblems(result);
      if (problems.length) failed++;
      process.stdout.write(`  pilot: ${problems.length ? `${problems.length} problem(s)\n    ${problems.join('\n    ')}` : 'every condition ran once and cleaned up'}\n`);
    } else {
      // One host alone never qualifies a route; report this host's own findings.
      const local = judge([result], workload).failures.filter((f) => !/two hosts|Node 22 and a development runtime/.test(f));
      if (local.length) failed++;
      process.stdout.write(`  local findings: ${local.length ? local.join('; ') : 'none (needs the other host and runtime before it can qualify)'}\n`);
    }
  }
  writeFileSync(join(out, `summary-${process.version}-${mode}.txt`), `${results.map(table).join('\n')}\n`);
  return failed ? 1 : 0;
}

// The entry module's URL has its symlinks resolved; argv[1] does not, so compare its real path.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { process.stderr.write(`run.mjs: ${/** @type {Error} */ (error).message}\n`); process.exitCode = 2; }
}
