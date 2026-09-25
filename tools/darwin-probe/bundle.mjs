#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { isolatedEnv, prepareRoot, tracker } from './lib/context.mjs';
import { replay } from './stages/d6-dispatch.mjs';
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
export function assertClean(dir) { if (git(['status', '--porcelain'], dir)) throw new Error(`${dir} is dirty; commit or stash first`); }
export function shallowBundle(repo, dest) {
  const head = git(['rev-parse', 'HEAD'], repo), branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repo);
  const tmp = mkdtempSync(join(tmpdir(), 'dpb-shallow-'));
  try {
    // Full clone, not `--depth 1`: gitformat-bundle(5) documents that "the Git bundle v2
    // format cannot represent a shallow clone repository" — `git bundle create` from a
    // shallow clone reports "complete history" but omits the truncated parent, and a
    // fresh `git clone` of that bundle then fails with "Could not read <parent>". The
    // detached temp clone still isolates the bundle from the source checkout's refs/locks
    // and lets us assert it landed exactly on HEAD before bundling.
    execFileSync('git', ['clone', '-q', '--no-local', '--branch', branch, `file://${resolve(repo)}`, join(tmp, 's')]);
    if (git(['rev-parse', 'HEAD'], join(tmp, 's')) !== head) throw new Error(`${repo}: clone is not at HEAD ${head}`);
    execFileSync('git', ['-C', join(tmp, 's'), 'bundle', 'create', dest, 'HEAD', branch], { stdio: 'ignore' });
    git(['bundle', 'verify', dest], join(tmp, 's'));
    return head;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });
export async function build({ relay, ops, out }) {
  assertClean(relay); assertClean(ops);
  const short = git(['rev-parse', '--short', 'HEAD'], relay), name = `relay-darwin-probe-${short}`;
  const stage = mkdtempSync(join(tmpdir(), 'dpb-')), top = join(stage, name); mkdirSync(join(top, 'expected'), { recursive: true });
  const relayCommit = shallowBundle(relay, join(top, 'relay.bundle')), opsCommit = shallowBundle(ops, join(top, 'ops.bundle'));
  const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', top], { cwd: relay, encoding: 'utf8' }).trim().split('\n').pop();
  cpSync(join(relay, 'tools/darwin-probe'), join(top, 'probe'), { recursive: true });
  cpSync(join(top, 'probe/run'), join(top, 'run')); chmodSync(join(top, 'run'), 0o755);
  // The replies D6 must byte-match, produced here by the same code the Mac runs.
  const root = mkdtempSync(join(tmpdir(), 'dpb-d6-')); prepareRoot(root); const t = tracker(root);
  try { writeFileSync(join(top, 'expected/d6.json'), JSON.stringify(await replay({ root, env: isolatedEnv(root), t, clone: relay }), null, 2)); }
  finally { await t.killAll(); rmSync(root, { recursive: true, force: true }); }
  const manifest = { schema: 1, relay_commit: relayCommit, ops_commit: opsCommit, tarball, opencode_pinned: '2.0.15', created: new Date().toISOString(),
    files: Object.fromEntries(files(top).map((p) => [relative(top, p), createHash('sha256').update(readFileSync(p)).digest('hex')])) };
  writeFileSync(join(top, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  mkdirSync(out, { recursive: true });
  const archive = join(resolve(out), `${name}.tar.gz`);
  execFileSync('tar', ['czf', archive, '-C', stage, name]);
  rmSync(stage, { recursive: true, force: true });
  return { tarball: archive, manifest };
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const { values } = parseArgs({ options: { ops: { type: 'string' }, out: { type: 'string', default: 'dist' } } });
  if (!values.ops) { process.stderr.write('--ops <ops checkout> is required\n'); process.exit(2); }
  const { tarball } = await build({ relay: process.cwd(), ops: resolve(values.ops), out: values.out });
  process.stdout.write(`${tarball}\n`);
}
