#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { changedPaths, fingerprint, isolatedEnv, prepareRoot, stageLog, tracker, writeStage } from './lib/context.mjs';
import { judge } from './judge.mjs';
import { collectHosts, redactFile, redactionMap, redactValue } from './redact.mjs';

const STAGES = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D7b', 'D8', 'D9'];
const MODULES = { D0: 'd0-env', D1: 'd1-package', D2: 'd2-suite', D3: 'd3-identity', D4: 'd4-table', D5: 'd5-registry', D6: 'd6-dispatch', D7: 'd7-guard', D7b: 'd7b-opencode', D8: 'd8-launchd', D9: 'd9-ambient' };
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const verifyManifest = (dir, manifest) => Object.entries(manifest.files).filter(([f, h]) => !existsSync(join(dir, f)) || sha256(join(dir, f)) !== h).map(([f]) => f);
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// `git bundle verify` needs a repository even for a self-contained bundle; use a throwaway one.
export function cloneBundle(bundle, dest, commit) {
  const scratch = mkdtempSync(join(tmpdir(), 'dp-verify-'));
  try { git(['init', '-q'], scratch); git(['bundle', 'verify', bundle], scratch); } finally { rmSync(scratch, { recursive: true, force: true }); }
  execFileSync('git', ['clone', '-q', bundle, dest]);
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
export function loadResults(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const stagesDir = join(dir, 'stages');
  const stages = existsSync(stagesDir) ? Object.fromEntries(readdirSync(stagesDir).map((f) => { const s = JSON.parse(readFileSync(join(stagesDir, f), 'utf8')); return [s.id, s]; })) : {};
  return { manifest, stages };
}

async function main() {
  const { values } = parseArgs({ options: { bundle: { type: 'string' }, root: { type: 'string' }, 'allow-linux': { type: 'boolean' }, stages: { type: 'string' }, 'self-test-hang': { type: 'boolean' } } });
  const platform = process.platform, root = values.root, bundle = values.bundle, selfTest = values['self-test-hang'];
  if (platform !== 'darwin' && !values['allow-linux'] && !selfTest) throw new Error('this probe runs on macOS; pass --allow-linux for the smoke run');
  mkdirSync(root, { recursive: true }); prepareRoot(root);
  // Isolate this process too, so any relay default that reads the ambient environment lands in the root.
  const ambient = { columns_exported: process.env.COLUMNS !== undefined };
  const isolated = isolatedEnv(root);
  for (const key of Object.keys(process.env)) if (!(key in isolated)) delete process.env[key];
  Object.assign(process.env, isolated);
  const t = tracker(root), raw = join(root, 'results'), out = join(root, 'out');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const manifest = selfTest ? { relay_commit: null, ops_commit: null, files: {} } : JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'));
  const tampered = verifyManifest(bundle, manifest);
  if (tampered.length) throw new Error(`bundle files changed: ${tampered.join(', ')}`);
  const ctx = { root, results: raw, bundle, env: isolated, t, platform, ambient, tarball: manifest.tarball && join(bundle, manifest.tarball) };
  if (!selfTest) {
    ctx.clone = cloneBundle(join(bundle, 'relay.bundle'), join(root, 'relay'), manifest.relay_commit);
    ctx.opsClone = cloneBundle(join(bundle, 'ops.bundle'), join(root, 'ops'), manifest.ops_commit);
  }
  const home = homedir(), before = fingerprint(home), ran = [];
  const record = { schema: 1, relay_commit: manifest.relay_commit, ops_commit: manifest.ops_commit, opencode_pinned: '2.0.15',
    allow_linux: platform !== 'darwin', platform, started: new Date().toISOString(), stages: ran, isolation: {} };
  mkdirSync(raw, { recursive: true });
  const d0mod = await import('./stages/d0-env.mjs');
  let finalizing = null;
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
    const after = fingerprint(home);
    Object.assign(record, { finished: new Date().toISOString(), isolation: { before, after, changed: changedPaths(before, after) }, interrupted: signalCode ?? null });
    writeFileSync(join(raw, 'manifest.json'), `${JSON.stringify(record, null, 2)}\n`);
    const results = loadResults(raw);
    const map = redactionMap({ hosts: collectHosts(results), user: userInfo().username, home });
    const rawVerdict = judge(results);
    // Redact the files themselves, then judge exactly what will be packed. Verdict texts carry
    // no host or user strings by construction, so the raw verdict is written as computed.
    redactInto({ rawDir: raw, outDir: out, map });
    const redactedVerdict = judge(loadResults(out));
    const exported = (v) => `${JSON.stringify(redactValue(v, map, { host: 0, user: 0, home: 0 }), null, 2)}\n`;
    writeFileSync(join(out, 'verdict.raw.json'), exported(rawVerdict));
    writeFileSync(join(out, 'verdict.redacted.json'), exported(redactedVerdict));
    if (JSON.stringify(stableVerdict(rawVerdict)) !== JSON.stringify(stableVerdict(redactedVerdict))) process.stderr.write('redaction changed a verdict: the Linux host will reject these results\n');
    const tarball = join(bundle, `relay-darwin-results-${stamp}.tar.gz`);
    execFileSync('tar', ['czf', tarball, '-C', out, '.']);
    process.stdout.write(`release: ${rawVerdict.release}\n${Object.entries(rawVerdict.checks).map(([id, c]) => `  ${id} ${c.verdict} — ${c.detail}`).join('\n')}\ncutover: ${JSON.stringify(rawVerdict.cutover)}\nresults: ${tarball}\n`);
    if (record.isolation.changed.length) { process.stderr.write(`live paths changed: ${record.isolation.changed.join(', ')}\n`); process.exitCode = 1; }
  })());
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => { finalize(signal).finally(() => process.exit(code)); });
  const stageRun = async (id, fn) => {
    if (t.stopping) return;
    ctx.log = stageLog(raw, id);
    let rec; try { rec = await fn(ctx); } catch (error) { rec = { status: 'error', reason: error.stack ?? String(error), observations: {} }; }
    if (t.stopping) return; // finalization owns the results directory from here on
    writeStage(raw, id, rec); ran.push(id);
  };
  if (selfTest) {
    await stageRun('D0', d0mod.run);
    // A stage that resumes whenever its child dies, with grandchildren: the interrupt race.
    await stageRun('D1', async () => { for (;;) await ctx.t.run('/bin/sh', ['-c', 'sleep 600.321 & sleep 600.654; true']); });
    return;
  }
  for (const id of values.stages ? values.stages.split(',') : STAGES) { if (t.stopping) break; await stageRun(id, (await import(`./stages/${MODULES[id]}.mjs`)).run); }
  if (t.stopping) return;
  await finalize(null);
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exit(2); });
