// @ts-check
import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { relayError } from '../protocol.js';
import { ensurePrivateDir, checkPrivate } from '../bus/store.js';
import { validateEntry, isTerminal, applySuperseded } from './lifecycle.js';
// The inbox's durable store (spec §6). relay serve is its only writer. Each change allocates a
// sequence number, writes seq, then the entry; both writes are fsynced files renamed into place
// followed by a directory fsync.
export const RETENTION_MS = 30 * 24 * 3600 * 1000;
/** @param {string} stateDir */
export function inboxPaths(stateDir) {
  const root = join(stateDir, 'inbox');
  return { root, seqPath: join(root, 'seq'), entriesDir: join(root, 'entries'), rejectedDir: join(root, 'rejected') };
}
/** @param {string} path @param {typeof fs} io */
async function syncDir(path, io) { const dir = await io.open(path, 'r'); try { await dir.sync(); } finally { await dir.close(); } }
/** @param {string} path @param {string} text @param {import("../types.js").IOOptions} [options] */
export async function writeDurable(path, text, { io = fs } = {}) {
  await checkPrivate(dirname(path), true, { io });
  await checkPrivate(path, false, { io });
  const temp = `${path}.tmp.${process.pid}.${randomUUID()}`;
  let error;
  try {
    const handle = await io.open(temp, 'wx', 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    await io.rename(temp, path);
    await syncDir(dirname(path), io);
    return;
  } catch (cause) { error = relayError('IO_ERROR', 'cannot publish inbox file', cause); }
  try { await io.unlink(temp); }
  catch (caught) { const cause = /** @type {import('../types.js').Failure} */ (caught); if (cause.code !== 'ENOENT') throw new AggregateError([error, relayError('IO_ERROR', 'cannot clean temporary inbox file', cause)], 'inbox write and cleanup failed'); }
  throw error;
}
/** @param {string} path @param {typeof fs} io */
async function readSeq(path, io) {
  let text;
  try { if (!await checkPrivate(path, false, { io })) return 0; text = await io.readFile(path, 'utf8'); }
  catch (cause) { throw relayError('IO_ERROR', 'cannot read inbox seq', cause); }
  if (!/^(0|[1-9][0-9]{0,15})\n?$/.test(text) || !Number.isSafeInteger(Number(text.trim()))) throw relayError('CORRUPT_STATE', 'inbox seq is not a safe decimal integer');
  return Number(text.trim());
}
/** @param {string} stateDir */
export async function loadStore(stateDir, { io = fs, now = Date.now() } = {}) {
  const p = inboxPaths(stateDir);
  for (const dir of [stateDir, p.root, p.entriesDir, p.rejectedDir]) await ensurePrivateDir(dir, { io });
  // Publish every directory link relay may have created, including links from service startup or a
  // failed prior load (ruling F35, refined). Relay creates directories only as the current uid and only
  // where that uid can write, so an ancestor is synced exactly when its child on the chain is owned by
  // this uid and the ancestor is writable by it. Any other ancestor holds no relay link and is never
  // opened, so another user's 0711 directory cannot stop startup. The state and inbox dirs are relay's.
  const uid = (/** @type {() => number} */ (process.getuid))(), groups = new Set([(/** @type {() => number} */ (process.getegid))(), ...(/** @type {() => number[]} */ (process.getgroups))()]);
  /** @param {import("node:fs").Stats} info */
  const writable = (info) => uid === 0 || (info.mode & (info.uid === uid ? 0o200 : groups.has(info.gid) ? 0o020 : 0o002)) !== 0;
  const chain = [];
  for (let dir = stateDir; ; dir = dirname(dir)) {
    chain.unshift(dir);
    if (dirname(dir) === dir) break;
  }
  try {
    /** @type {import("node:fs").Stats[]} */
    const infos = [];
    for (const dir of chain) infos.push(await io.stat(dir));
    const directories = chain.slice(0, -1).filter((dir, i) => infos[i + 1].uid === uid && writable(infos[i]));
    for (const dir of [...directories, stateDir, p.root]) await syncDir(dir, io);
  } catch (cause) { throw relayError('IO_ERROR', 'cannot publish inbox directories', cause); }
  const persisted = await readSeq(p.seqPath, io);
  /** @type {Map<string, import("../types.js").StoredEntry>} */
  const entries = new Map();
  /** @type {{name: string, reason: string}[]} */
  const rejected = [];
  /** @param {string} name @param {string} reason */
  const quarantine = async (name, reason) => {
    let destination = join(p.rejectedDir, name);
    if (await checkPrivate(destination, false, { io })) destination += `.${randomUUID()}`;
    try {
      await io.rename(join(p.entriesDir, name), destination);
      await syncDir(p.rejectedDir, io);
      await syncDir(p.entriesDir, io);
    } catch (cause) { throw relayError('IO_ERROR', 'cannot quarantine inbox entry', cause); }
    rejected.push({ name, reason });
  };
  let names;
  try { names = await io.readdir(p.entriesDir); }
  catch (cause) { throw relayError('IO_ERROR', 'cannot list inbox entries', cause); }
  for (const name of names.sort()) {
    const path = join(p.entriesDir, name);
    if (!await checkPrivate(path, false, { io })) continue;
    if (name.includes('.tmp.')) {
      try { await io.unlink(path); await syncDir(p.entriesDir, io); }
      catch (cause) { throw relayError('IO_ERROR', 'cannot clean temporary inbox file', cause); }
      continue;
    }
    let text;
    try { text = await io.readFile(path, 'utf8'); }
    catch (cause) { throw relayError('IO_ERROR', 'cannot read inbox entry', cause); }
    let entry;
    try {
      entry = validateEntry(JSON.parse(text));
      if (`${entry.id}.json` !== name) throw relayError('INVALID_ENTRY', 'entry id does not match its file');
    } catch (caught) { const error = /** @type {import('../types.js').Failure} */ (caught); if (error.code === 'IO_ERROR') throw error; await quarantine(name, error.message); continue; }
    entries.set(entry.id, entry);
  }
  const start = [...entries.values()].reduce((highest, entry) => Math.max(highest, entry.seq), persisted);
  // Preserve recovery's high-water mark even if pruning removes every retained entry.
  if (start > persisted) await writeDurable(p.seqPath, `${start}\n`, { io });
  const store = makeStore(p, entries, start, io);
  // Supersession reconciliation (spec §5.5): finish an interrupted replacement before any request.
  for (const n of store.all()) {
    const x = n.kind === 'question' && !isTerminal(n) ? n.question.body.supersedes : null;
    if (x === null) continue;
    const predecessor = store.get(x);
    if (predecessor?.state === 'withdrawn' && predecessor.supersededBy === n.id) continue;
    if (predecessor?.state === 'pending') { await store.put(applySuperseded(predecessor, n.id, now).entry); continue; }
    entries.delete(n.id);
    await quarantine(`${n.id}.json`, predecessor ? `predecessor ${x} is ${predecessor.state}` : `predecessor ${x} is missing`);
  }
  return { store, rejected };
}
/** @param {ReturnType<typeof inboxPaths>} p @param {Map<string, import("../types.js").StoredEntry>} entries @param {number} start @param {typeof fs} io */
function makeStore(p, entries, start, io) {
  // allocated runs ahead of committed while a write is in flight; only committed is ever
  // exposed, so a cursor never names a change that is not yet readable.
  let allocated = start, committed = start;
  /** @param {import("../types.js").Entry} entry */
  async function put(entry) {
    if (allocated === Number.MAX_SAFE_INTEGER) throw relayError('CORRUPT_STATE', 'inbox sequence exhausted');
    const seq = allocated + 1;
    const stamped = validateEntry({ ...entry, seq, log: entry.log.map((l) => l.seq === null ? { ...l, seq } : l) });
    allocated = seq;
    await writeDurable(p.seqPath, `${seq}\n`, { io });
    await writeDurable(join(p.entriesDir, `${stamped.id}.json`), `${JSON.stringify(stamped)}\n`, { io });
    entries.set(stamped.id, stamped);
    committed = seq;
    return stamped;
  }
  return {
    /** @param {string} id */
    get: (id) => entries.get(id) ?? null,
    all: () => [...entries.values()].sort((a, b) => a.seq - b.seq),
    seq: () => committed,
    put,
    // Fixed order (spec §5.5): the replacement first, then the predecessor's withdrawal.
    /** @param {import("../types.js").QuestionEntry} replacement @param {import("../types.js").QuestionEntry} withdrawnPredecessor */
    async supersede(replacement, withdrawnPredecessor) { const n = await put(replacement); const x = await put(withdrawnPredecessor); return [n, x]; },
    /** @param {number} now */
    async prune(now) {
      const kept = new Set([...entries.values()].filter((e) => e.kind === 'question' && !isTerminal(e) && e.question.body.supersedes).map((e) => (/** @type {import("../types.js").QuestionEntry} */ (e)).question.body.supersedes));
      const pruned = [];
      for (const e of [...entries.values()]) {
        if (!isTerminal(e) || now - e.updatedAt < RETENTION_MS || kept.has(e.id)) continue;
        try { await io.unlink(join(p.entriesDir, `${e.id}.json`)); }
        catch (cause) { throw relayError('IO_ERROR', 'cannot prune inbox entry', cause); }
        entries.delete(e.id); pruned.push(e.id);
      }
      if (pruned.length) {
        try { await syncDir(p.entriesDir, io); }
        catch (cause) { throw relayError('IO_ERROR', 'cannot sync pruned inbox entries', cause); }
      }
      return pruned;
    },
  };
}
