// @ts-check
// The runnable binary/config pairs a harness's hook settings pin, their digests, and the commit
// the running relay was installed from. Rollback restores settings pinning a retained prior pair;
// these are how an operator records that pair before cutover and proves it after recovery.
// See docs/runbooks/hook-install-rollback.md.
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { parse } from 'jsonc-parser';
import { relayCommandOf } from './hooks.js';
import { relayError } from '../protocol.js';

/** @param {Buffer|string} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Each distinct (node, relay.js, subscriber file) a relay dispatch entry pins, in first-seen
 * order, with the events that run it. Ask entries and every non-relay command are not pairs.
 * @param {{harness: string, text: string}} options @returns {import("../types.js").RelayPair[]}
 */
export function relayPairs({ harness, text }) {
  const hooks = parse(text)?.hooks;
  /** @type {Map<string, import("../types.js").RelayPair>} */
  const pairs = new Map();
  if (hooks === null || typeof hooks !== 'object') return [];
  for (const entries of Object.values(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      for (const hook of Array.isArray(entry?.hooks) ? entry.hooks : []) {
        const pinned = typeof hook?.command === 'string' ? relayCommandOf(hook.command, harness) : null;
        if (!pinned) continue;
        const key = JSON.stringify([pinned.node, pinned.relay, pinned.subscribers]);
        const pair = pairs.get(key) ?? { events: [], node: pinned.node, relay: pinned.relay, subscribers: pinned.subscribers };
        if (!pair.events.includes(pinned.event)) pair.events.push(pinned.event);
        pairs.set(key, pair);
      }
    }
  }
  return [...pairs.values()];
}

/** @param {string} path @param {typeof fs} io @param {string} what */
const read = (path, io, what) => {
  try { return io.readFileSync(path); } catch (caught) {
    throw relayError('PAIR_UNAVAILABLE', `${what} ${path} cannot be read: ${/** @type {import("../types.js").Failure} */ (caught).code ?? 'error'}`);
  }
};

/** Regular files under a directory, relative to root, sorted. @param {string} root @param {string} dir @param {typeof fs} io @returns {string[]} */
const filesUnder = (root, dir, io) => io.readdirSync(join(root, dir), { withFileTypes: true }).flatMap((item) => {
  const path = join(dir, item.name);
  return item.isDirectory() ? filesUnder(root, path, io) : item.isFile() ? [path] : [];
}).sort();

/**
 * The digests that identify a pinned pair: the node executable's bytes, the relay package's
 * runtime (package.json, bin/ and src/, each path with its sha256) and the subscriber file.
 * @param {import("../types.js").RelayPair} pair @param {{io?: typeof fs}} [options] @returns {import("../types.js").PairDigests}
 */
export function pairDigests(pair, { io = fs } = {}) {
  const root = dirname(dirname(pair.relay));
  let files;
  try { files = ['package.json', ...filesUnder(root, 'bin', io), ...filesUnder(root, 'src', io)]; }
  catch (caught) { throw relayError('PAIR_UNAVAILABLE', `relay package ${root} cannot be read: ${/** @type {import("../types.js").Failure} */ (caught).code ?? 'error'}`); }
  const binaryDigest = sha256(files.map((file) => `${file}\0${sha256(read(join(root, file), io, 'relay file'))}\n`).join(''));
  return { ...pair, nodeDigest: pair.node === null ? null : sha256(read(pair.node, io, 'node')), binaryDigest,
    configDigest: pair.subscribers === null ? null : sha256(read(pair.subscribers, io, 'subscriber file')) };
}

/**
 * The cutover never hands a prior relay's subscriber file to a different relay: the prior pair
 * must stay runnable as it was, so rollback restores a matching pair, not settings that point
 * the prior binary at a config rewritten for the new one.
 * @param {{harness: string, text: string, relayBin: string, subscribersPath: string}} options
 */
export function assertPairRetained({ harness, text, relayBin, subscribersPath }) {
  for (const pair of relayPairs({ harness, text })) {
    if (pair.subscribers === subscribersPath && pair.relay !== relayBin) {
      throw relayError('PAIR_NOT_RETAINED', `the prior relay ${pair.relay} runs ${pair.subscribers}; give the new relay its own versioned subscriber file and retain the prior pair (docs/adapters.md, "Route qualification")`);
    }
  }
}

/**
 * The commit the running relay was installed from: an npm installation's lock entry
 * (`resolved` ending in #<40-hex>), or a git checkout's HEAD when its tracked files are clean.
 * @param {string} relayBin @param {{io?: typeof fs, git?: (args: string[], cwd: string) => string}} [options]
 * @returns {{commit: string|null, source: string}}
 */
export function relayCommitOf(relayBin, { io = fs, git = gitIn } = {}) {
  const root = dirname(dirname(relayBin)), modules = dirname(root);
  if (basename(modules) === 'node_modules') {
    const lock = join(modules, '.package-lock.json');
    let resolved;
    try { resolved = JSON.parse(io.readFileSync(lock, 'utf8'))?.packages?.[`node_modules/${basename(root)}`]?.resolved; }
    catch { return { commit: null, source: `no readable npm lock entry at ${lock}` }; }
    const commit = typeof resolved === 'string' ? /#([0-9a-f]{40})$/.exec(resolved)?.[1] : undefined;
    return commit ? { commit, source: lock } : { commit: null, source: `${lock} names no git commit for ${basename(root)}` };
  }
  if (!io.existsSync(join(root, '.git'))) return { commit: null, source: `${root} is neither an npm installation nor a git checkout` };
  try {
    if (git(['status', '--porcelain', '--untracked-files=no'], root).trim()) return { commit: null, source: `${root} has uncommitted changes` };
    const commit = git(['rev-parse', 'HEAD'], root).trim();
    return /^[0-9a-f]{40}$/.test(commit) ? { commit, source: `${root} HEAD` } : { commit: null, source: `${root} HEAD is not a commit` };
  } catch (caught) { return { commit: null, source: `git in ${root} failed: ${/** @type {import("../types.js").Failure} */ (caught).code ?? 'error'}` }; }
}

/** git with only PATH and HOME, so an inherited GIT_DIR or GIT_WORK_TREE cannot redirect it. @param {string[]} args @param {string} cwd */
function gitIn(args, cwd) {
  /** @type {Record<string, string>} */
  const env = { GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['PATH', 'HOME']) if (process.env[key] !== undefined) env[key] = /** @type {string} */ (process.env[key]);
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env, timeout: 10000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
}
