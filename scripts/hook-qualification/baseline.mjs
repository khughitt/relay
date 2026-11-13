// @ts-check
// The acceptance comparator: what an event already runs on a host, frozen in a manifest. An
// already-relayed event runs the deployed relay branch beside the native branches being migrated;
// a not-yet-relayed event runs its native branches only. Branches launch on the harness's verified
// schedule and the event is timed from the first launch until the last branch has exited and its
// process group is empty: a parallel event is its critical path, never a sum of branches.
import { spawn } from 'node:child_process';

const KINDS = ['deployed-relay-plus-native', 'native-only'];
/** @type {(message: string) => never} */
const fail = (message) => { throw Object.assign(new Error(message), { code: 'BASELINE_INVALID' }); };
/** @param {unknown} v */
const text = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v */
const digest = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/**
 * Accepts a frozen manifest for exactly this harness and event, or refuses: there is no fallback to
 * another baseline.
 * @param {any} manifest @param {{harness: string, event: string}} target
 */
export function validateManifest(manifest, { harness, event }) {
  if (manifest === null || typeof manifest !== 'object' || manifest.schema !== 1) fail('baseline manifest must be schema 1');
  for (const key of ['host', 'harness', 'version', 'mode', 'event']) if (!text(manifest[key])) fail(`baseline manifest needs ${key}`);
  if (manifest.harness !== harness || manifest.event !== event) fail(`baseline manifest is for ${manifest.harness} ${manifest.event}, not ${harness} ${event}`);
  if (!KINDS.includes(manifest.baselineKind)) fail('baselineKind must be deployed-relay-plus-native or native-only');
  if (!manifest.settings || !text(manifest.settings.commit) || !text(manifest.settings.path) || !text(manifest.settings.blob)) fail('baseline manifest needs the settings identity it was read from');
  if (!manifest.schedule || !['parallel', 'serial'].includes(manifest.schedule.kind) || !text(manifest.schedule.evidence)) fail('the branch schedule needs its kind and evidence');
  if (!Array.isArray(manifest.branches) || manifest.branches.length === 0) fail('baseline manifest needs branches');
  const names = new Set();
  for (const branch of manifest.branches) {
    if (!branch || !text(branch.name) || !['deployed-relay', 'native'].includes(branch.role) || !Array.isArray(branch.argv) || !branch.argv.length || !branch.argv.every(text)) fail('each branch needs a name, role and argv');
    if (names.has(branch.name)) fail(`branch ${branch.name} appears twice`);
    names.add(branch.name);
  }
  const relays = manifest.branches.filter((b) => b.role === 'deployed-relay');
  if (manifest.baselineKind === 'deployed-relay-plus-native') {
    if (relays.length !== 1) fail('an already-relayed event needs exactly one deployed relay branch');
    const d = manifest.deployed;
    if (!d || !text(d.version) || !text(d.relayEntry) || !digest(d.packageSha256) || !digest(d.configSha256)) fail('the deployed relay needs its version, entry and package and config digests');
  } else if (relays.length !== 0 || manifest.deployed) fail('a native-only baseline has no deployed relay');
  if (!manifest.candidate || !digest(manifest.candidate.configSha256)) fail('baseline manifest needs the candidate config digest');
  if (!Array.isArray(manifest.replacementMap) || manifest.replacementMap.length === 0
    || !manifest.replacementMap.every((/** @type {any} */ e) => e && text(e.invocation) && text(e.baseline) && text(e.candidate))) fail('baseline manifest needs a replacement map');
  return manifest;
}

/**
 * The replacement map accounts for every invocation exactly once on each side: existing work is
 * neither dropped from the candidate nor credited only to one side.
 * @param {any} manifest @param {{baseline: string[], candidate: string[]}} sides
 */
export function checkRetainedWork(manifest, { baseline, candidate }) {
  for (const [side, listed] of /** @type {[string, string[]][]} */ ([['baseline', baseline], ['candidate', candidate]])) {
    const mapped = manifest.replacementMap.map((/** @type {any} */ e) => e[side]);
    if (new Set(mapped).size !== mapped.length) fail(`the replacement map names a ${side} invocation twice`);
    const missing = mapped.filter((/** @type {string} */ ref) => !listed.includes(ref)), extra = listed.filter((ref) => !mapped.includes(ref));
    if (missing.length || extra.length || new Set(listed).size !== listed.length) fail(`${side} work does not match the replacement map (missing ${missing.join(',') || 'none'}; unmapped ${extra.join(',') || 'none'})`);
  }
}

/**
 * The invocation lists each side actually runs: deployed relay subscribers and native branches for
 * the baseline, candidate relay subscribers for the candidate, from the configurations themselves.
 * @param {{deployed: {subscribers: {name: string}[]}|null, candidate: {subscribers: {name: string}[]}, native: string[]}} sides
 */
export function workLists({ deployed, candidate, native }) {
  return { baseline: [...(deployed?.subscribers ?? []).map((s) => `deployed-relay:${s.name}`), ...native],
    candidate: candidate.subscribers.map((s) => `candidate:${s.name}`) };
}

/** @param {number} pgid */
const groupExists = (pgid) => { try { process.kill(-pgid, 0); return true; } catch (error) { return /** @type {any} */ (error).code === 'EPERM'; } };

/**
 * Runs one event sample of the frozen composition.
 * @param {any} manifest @param {{event: string, input: string, env: NodeJS.ProcessEnv, cwd: string, drainMs?: number}} options
 * @returns {Promise<{elapsedMs: number, branches: {name: string, elapsedMs: number, status: string, pid: number|null}[], statuses: string[], survivors: string[]}>}
 */
export async function runBaseline(manifest, { event, input, env, cwd, drainMs = 1000 }) {
  validateManifest(manifest, { harness: manifest.harness, event });
  const started = performance.now();
  /** @param {any} branch */
  const launch = (branch) => new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(branch.argv[0], branch.argv.slice(1), { stdio: ['pipe', 'ignore', 'ignore'], env, cwd, detached: true });
    child.stdin.on('error', () => {}); child.stdin.end(input);
    child.once('error', () => resolve({ name: branch.name, elapsedMs: performance.now() - t0, status: 'spawn-failed', pgid: null }));
    child.once('exit', async (code, signal) => {
      // The branch counts as done when its whole group has drained; survivors are reported, not hidden.
      const until = performance.now() + drainMs;
      while (child.pid !== undefined && groupExists(child.pid) && performance.now() < until) await new Promise((r) => setTimeout(r, 2));
      resolve({ name: branch.name, elapsedMs: performance.now() - t0, status: signal ? `signal ${signal}` : `exited ${code}`, pgid: child.pid ?? null });
    });
  });
  /** @type {any[]} */
  const results = [];
  if (manifest.schedule.kind === 'parallel') results.push(...await Promise.all(manifest.branches.map(launch)));
  else for (const branch of manifest.branches) results.push(await launch(branch));
  const elapsedMs = performance.now() - started;
  const survivors = results.filter((r) => r.pgid !== null && groupExists(r.pgid)).map((r) => r.name);
  for (const r of results) if (r.pgid !== null && groupExists(r.pgid)) { try { process.kill(-r.pgid, 'SIGKILL'); } catch {} }
  return { elapsedMs, branches: results.map(({ name, elapsedMs: ms, status, pgid }) => ({ name, elapsedMs: ms, status, pid: pgid })), statuses: results.map((r) => r.status), survivors };
}
