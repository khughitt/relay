#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir, userInfo } from 'node:os';
import { basename, delimiter, dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fingerprint, isolatedEnv, isolationOf, prepareRoot, stageLog, tracker, writeStage } from './lib/context.mjs';
import { ask } from './lib/tty.mjs';
import { pythonAtLeast } from './stages/d0-env.mjs';
import { judge } from './judge.mjs';
import { collectHosts, redactFile, redactionMap, redactValue } from './redact.mjs';

const STAGES = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D7b', 'D8', 'D9'];
const MODULES = { D0: 'd0-env', D1: 'd1-package', D2: 'd2-suite', D3: 'd3-identity', D4: 'd4-table', D5: 'd5-registry', D6: 'd6-dispatch', D7: 'd7-guard', D7b: 'd7b-opencode', D8: 'd8-launchd', D9: 'd9-ambient' };
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const verifyManifest = (dir, manifest) => Object.entries(manifest.files).filter(([f, h]) => !existsSync(join(dir, f)) || sha256(join(dir, f)) !== h).map(([f]) => f);
// A validation failure the user should see as one line, not a stack trace.
class ProbeError extends Error {}
const die = (message) => { throw new ProbeError(message); };
const firstLine = (s) => String(s).split('\n')[0];
// Every git call the probe makes is hermetic: no global or system config leaks in from the
// Mac's own git setup (a signing key, a credential helper, an unrelated alias).
const gitEnv = () => ({ ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() }).trim();
// `git bundle verify` needs a repository even for a self-contained bundle; use a throwaway one,
// scoped under the probe's own root rather than the shared system temp directory.
export function cloneBundle(bundle, dest, commit, scratchBase = tmpdir()) {
  const scratch = mkdtempSync(join(scratchBase, 'dp-verify-'));
  try { git(['init', '-q'], scratch); git(['bundle', 'verify', bundle], scratch); } finally { rmSync(scratch, { recursive: true, force: true }); }
  execFileSync('git', ['clone', '-q', bundle, dest], { env: gitEnv() });
  const head = git(['rev-parse', 'HEAD'], dest), status = git(['status', '--porcelain'], dest);
  if (head !== commit || status) throw new Error(`${bundle}: HEAD ${head} (want ${commit}), status '${status}'`);
  return dest;
}
const walkFiles = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walkFiles(p) : [p]; });
export function redactInto({ rawDir, outDir, map }) {
  const counts = {};
  for (const file of walkFiles(rawDir)) {
    const rel = relative(rawDir, file), target = join(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    const r = redactFile(file, map);
    writeFileSync(target, r.text); counts[rel] = r.counts;
  }
  const manifestPath = join(outDir, 'manifest.json'), m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  m.redaction = { files: counts }; writeFileSync(manifestPath, `${JSON.stringify(m, null, 2)}\n`);
}
// The fields a redaction must not change; details and findings are prose.
export const stableVerdict = (v) => ({ release: v.release, cutover: v.cutover,
  checks: Object.fromEntries(Object.entries(v.checks).map(([id, c]) => [id, { class: c.class, verdict: c.verdict }])) });
// Stage records only: macOS tar can add `._<name>` AppleDouble entries, and Finder a .DS_Store.
const isStageFile = (f) => f.endsWith('.json') && !f.startsWith('.');
export function loadResults(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const stagesDir = join(dir, 'stages');
  const stages = existsSync(stagesDir) ? Object.fromEntries(readdirSync(stagesDir).filter(isStageFile).map((f) => { const s = JSON.parse(readFileSync(join(stagesDir, f), 'utf8')); return [s.id, s]; })) : {};
  return { manifest, stages };
}
// COPYFILE_DISABLE stops macOS bsdtar writing `._<name>` AppleDouble entries, --no-xattrs keeps
// extended attributes (quarantine, provenance) out, and --numeric-owner keeps the account's
// user and group names out of every header. GNU tar and bsdtar accept all three.
export function packResults(dir, dest) {
  execFileSync('tar', ['czf', dest, '--numeric-owner', '--no-xattrs', '-C', dir, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
}
// The spec's refusal: no credential file and no token leaves the Mac. A hit names the files.
const CREDENTIAL_FILES = ['.credentials.json', 'auth.json'];
export function credentialHits(dir, token) {
  return walkFiles(dir).filter((file) => CREDENTIAL_FILES.includes(basename(file)) || (!!token && readFileSync(file).includes(token)))
    .map((file) => relative(dir, file));
}
const onPath = (name) => (process.env.PATH ?? '').split(delimiter).some((dir) => { try { accessSync(join(dir, name), constants.X_OK); return true; } catch { return false; } });
// A real `claude setup-token` token is ~100 characters. Anything much shorter is a stray key
// press, and scanning the results for it would refuse to pack an otherwise good run.
const MIN_TOKEN = 20;

async function main() {
  const { values } = parseArgs({ options: { bundle: { type: 'string' }, root: { type: 'string' }, 'allow-linux': { type: 'boolean' }, stages: { type: 'string' }, 'self-test-hang': { type: 'boolean' } } });
  const platform = process.platform, root = values.root, bundle = values.bundle, selfTest = values['self-test-hang'];
  if (platform !== 'darwin' && !values['allow-linux'] && !selfTest) throw new Error('this probe runs on macOS; pass --allow-linux for the smoke run');
  // Before anything runs: an unknown stage id is a typo, not a run worth starting.
  if (values.stages) {
    const unknown = values.stages.split(',').filter((id) => !(id in MODULES));
    if (unknown.length) die(`unknown stage id(s): ${unknown.join(', ')}`);
  }
  mkdirSync(root, { recursive: true }); prepareRoot(root);
  // Isolate this process too, so any relay default that reads the ambient environment lands in the root.
  const ambient = { columns_exported: process.env.COLUMNS !== undefined };
  const isolated = isolatedEnv(root);
  for (const key of Object.keys(process.env)) if (!(key in isolated)) delete process.env[key];
  Object.assign(process.env, isolated);
  // Before any git call: the Command Line Tools also provide the git this probe shells out to.
  if (platform === 'darwin') {
    try { execFileSync('xcode-select', ['-p'], { stdio: 'ignore' }); }
    catch { die('the Xcode Command Line Tools are required: run xcode-select --install'); }
  }
  // The ops guard probe (D7), relay's cli-surface test (D2) and D0 need python3 >= 3.11; the
  // Command Line Tools' /usr/bin/python3 is 3.9. Refuse now rather than ten minutes in.
  const py = spawnSync('python3', ['--version'], { encoding: 'utf8', timeout: 10000 });
  const pyVersion = py.error ? '' : `${py.stdout ?? ''}${py.stderr ?? ''}`.trim().split('\n')[0];
  if (!pythonAtLeast(pyVersion, [3, 11])) die(`python3 >= 3.11 is required (found ${pyVersion || 'none'}); install one, e.g. brew install python`);
  const wanted = values.stages ? values.stages.split(',') : STAGES;
  const home = homedir();
  // Asked once, before any stage, so the user is not interrupted mid-run. The token lives in
  // ctx.token only: never ctx.env, a log, an observation or the results (scanned before packing).
  let token = null;
  if (platform === 'darwin' && wanted.includes('D7') && onPath('claude') && !existsSync(join(home, '.claude/.credentials.json'))) {
    token = await ask('Claude Code keeps its login in the Keychain. Run `claude setup-token` in another terminal and paste the token (Enter skips Claude): ', { hidden: true }) || null;
    if (token && token.length < MIN_TOKEN) { process.stderr.write(`${token.length} characters is too short for a token; Claude Code will be skipped\n`); token = null; }
  }
  const t = tracker(root), raw = join(root, 'results'), out = join(root, 'out');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let manifest;
  if (selfTest) manifest = { relay_commit: null, ops_commit: null, files: {} };
  else { try { manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8')); } catch (error) { die(`bundle manifest unreadable: ${firstLine(error.message)}`); } }
  const tampered = verifyManifest(bundle, manifest);
  if (tampered.length) die(`bundle files changed: ${tampered.join(', ')}`);
  const ctx = { root, results: raw, bundle, env: isolated, t, platform, ambient, token, tarball: manifest.tarball && join(bundle, manifest.tarball) };
  if (!selfTest) {
    try {
      ctx.clone = cloneBundle(join(bundle, 'relay.bundle'), join(root, 'relay'), manifest.relay_commit, root);
      ctx.opsClone = cloneBundle(join(bundle, 'ops.bundle'), join(root, 'ops'), manifest.ops_commit, root);
    } catch (error) { die(`clone failed: ${firstLine(error.message)}`); }
  }
  const before = fingerprint(home), ran = [];
  // D9 invites the user to open live sessions, which may write their own config; the gating
  // "after" reading is taken just before it (D9 only reads), and later changes are a finding.
  let beforeD9 = null;
  const record = { schema: 1, relay_commit: manifest.relay_commit, ops_commit: manifest.ops_commit, opencode_pinned: '2.0.15',
    allow_linux: platform !== 'darwin', platform, started: new Date().toISOString(), requested_stages: values.stages ? wanted : null, stages: ran, isolation: {} };
  mkdirSync(raw, { recursive: true });
  const d0mod = await import('./stages/d0-env.mjs');
  let finalizing = null, refused = false;
  const finalize = (signalCode) => (finalizing ??= (async () => {
    t.stop();
    const { survivors } = await t.killAll();
    record.cleanup = { survivors };
    if (survivors.length) process.stderr.write(`process groups survived cleanup: ${survivors.join(', ')}\n`);
    // D0's end-of-run host reading, however the run ended.
    const d0path = join(raw, 'stages/D0.json');
    if (existsSync(d0path)) {
      const d0 = JSON.parse(readFileSync(d0path, 'utf8'));
      if (d0.status === 'ran' && !d0.observations?.hosts?.end) { try { writeStage(raw, 'D0', await d0mod.finish(ctx, d0)); } catch (error) { ctx.log?.(`D0 finish: ${error.message}`); } }
    }
    Object.assign(record, { finished: new Date().toISOString(), isolation: isolationOf(before, beforeD9, fingerprint(home)), interrupted: signalCode ?? null });
    writeFileSync(join(raw, 'manifest.json'), `${JSON.stringify(record, null, 2)}\n`);
    const results = loadResults(raw);
    // Seed the host list with the machine's own name too: collectHosts only sees hosts a
    // stage happened to record, and a name the probe itself never observed would leak.
    const map = redactionMap({ hosts: [...new Set([...collectHosts(results), hostname()])], user: userInfo().username, home });
    const rawVerdict = judge(results);
    // Redact the files themselves, then judge exactly what will be packed. Verdict texts carry
    // no host or user strings by construction, so the raw verdict is written as computed.
    redactInto({ rawDir: raw, outDir: out, map });
    const redactedVerdict = judge(loadResults(out));
    const exported = (v) => `${JSON.stringify(redactValue(v, map, { host: 0, user: 0, home: 0 }), null, 2)}\n`;
    writeFileSync(join(out, 'verdict.raw.json'), exported(rawVerdict));
    writeFileSync(join(out, 'verdict.redacted.json'), exported(redactedVerdict));
    if (JSON.stringify(stableVerdict(rawVerdict)) !== JSON.stringify(stableVerdict(redactedVerdict))) process.stderr.write('redaction changed a verdict: the Linux host will reject these results\n');
    // Build under the root and rename into the bundle directory last, so an interrupt during
    // packing never leaves a truncated tarball where the user would find it. `--numeric-owner`
    // keeps the Mac account's user and group name out of every archive header.
    const hits = credentialHits(out, ctx.token);
    if (hits.length) {
      process.stderr.write(`refusing to pack: credential material in ${hits.join(', ')}\n`);
      refused = true; process.exitCode = 1; return;
    }
    const name = `relay-darwin-results-${stamp}.tar.gz`, staged = join(root, name), tarball = join(bundle, name);
    packResults(out, staged);
    try { renameSync(staged, tarball); } catch (error) { if (error.code !== 'EXDEV') throw error; copyFileSync(staged, tarball); rmSync(staged); }
    process.stdout.write(`release: ${rawVerdict.release}\n${Object.entries(rawVerdict.checks).map(([id, c]) => `  ${id} ${c.verdict} — ${c.detail}`).join('\n')}\ncutover: ${JSON.stringify(rawVerdict.cutover)}\nresults: ${tarball}\n`);
    if (record.isolation.changed_during_d9.length) process.stderr.write(`changed while D9 sampled live sessions (a finding, not a failure): ${record.isolation.changed_during_d9.join(', ')}\n`);
    if (record.isolation.changed.length) { process.stderr.write(`live paths changed: ${record.isolation.changed.join(', ')}\n`); process.exitCode = 1; }
  })());
  // `.on`, not `.once`: a second signal must be ignored deliberately once finalizing has
  // started, not fall through to Node's default (immediate, unpacked) termination.
  let signalling = false;
  const CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  for (const [signal, code] of Object.entries(CODES)) {
    process.on(signal, () => {
      if (signalling) return;
      signalling = true;
      process.stderr.write('stopping: killing children and packing results…\n');
      finalize(signal).catch((error) => { process.stderr.write(`finalize failed: ${error.stack ?? error}\n`); }).finally(() => process.exit(refused ? 1 : code));
    });
  }
  const stageRun = async (id, fn) => {
    if (t.stopping) return;
    ctx.log = stageLog(raw, id);
    let rec; try { rec = await fn(ctx); } catch (error) { rec = { status: 'error', reason: error.stack ?? String(error), observations: {} }; }
    if (t.stopping) return; // finalization owns the results directory from here on
    writeStage(raw, id, rec); ran.push(id);
  };
  // A throw outside a stage itself (an import, stageLog, writeStage) still finalizes: the
  // finally runs killAll, D0 finish and packing before the error is reported.
  try {
    if (selfTest) {
      await stageRun('D0', d0mod.run);
      // A stage that resumes whenever its child dies, with grandchildren: the interrupt race.
      await stageRun('D1', async () => { for (;;) await ctx.t.run('/bin/sh', ['-c', 'sleep 600.321 & sleep 600.654; true']); });
    } else {
      for (const id of wanted) {
        if (t.stopping) break;
        if (id === 'D9') beforeD9 = fingerprint(home);
        await stageRun(id, (await import(`./stages/${MODULES[id]}.mjs`)).run);
      }
    }
  } finally {
    if (!t.stopping) await finalize(null).catch((error) => { process.stderr.write(`finalize failed: ${error.stack ?? error}\n`); process.exitCode ||= 2; });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // A closed terminal turns every write to it into EIO. Without a listener that stream 'error'
  // is uncaught and kills the probe mid-cleanup, losing every result; the writes are lost anyway.
  for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {});
  main().catch((error) => {
    process.stderr.write(error instanceof ProbeError ? `${error.message}\n` : `${error.stack ?? error}\n`);
    process.exit(2);
  });
}
