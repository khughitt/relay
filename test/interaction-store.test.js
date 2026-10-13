import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempState, tempPaths } from './helpers/fixture.js';
import { loadStore, inboxPaths, RETENTION_MS, writeDurable } from '../src/interaction/store.js';
import * as L from '../src/interaction/lifecycle.js';
import { questionMessage, answerMessage, HANDLE, NOW, withdrawalMessage, deferMessage, noticeMessage } from './helpers/interaction.js';

const entry = (q = questionMessage()) => L.createEntry(q, { handback: false, waiter: HANDLE, now: NOW });
// An io wrapper whose rename fails once for a path matching `when`: a crash between two writes.
const crashOn = (when) => { let armed = true; return { ...fs, rename: async (from, to) => { if (armed && when(to)) { armed = false; throw Object.assign(new Error('crash'), { code: 'EIO' }); } return fs.rename(from, to); } }; };

test('put stamps a sequence, persists privately, and reloads', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  const a = await store.put(entry()), b = await store.put(entry());
  assert.deepEqual([a.seq, b.seq, a.log[0].seq], [1, 2, 1]);
  const ip = inboxPaths(p.stateDir);
  assert.equal((await fs.stat(join(ip.entriesDir, `${a.id}.json`))).mode & 0o777, 0o600);
  assert.equal((await fs.readFile(ip.seqPath, 'utf8')).trim(), '2');
  const reloaded = (await loadStore(p.stateDir, { now: NOW })).store;
  assert.deepEqual(reloaded.get(a.id), a); assert.equal(reloaded.seq(), 2);
});
test('a crash between seq and entry never reuses a number', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  const first = await store.put(entry());
  const io = crashOn((to) => to.endsWith('.json'));
  const broken = (await loadStore(p.stateDir, { io, now: NOW })).store;
  await assert.rejects(broken.put(entry()), { code: 'IO_ERROR' });
  const { store: after } = await loadStore(p.stateDir, { now: NOW });
  assert.equal(after.seq(), first.seq + 1);
  assert.equal((await after.put(entry())).seq, first.seq + 2);
});
test('seq() exposes only committed numbers while a write is paused', async (t) => {
  const p = await tempState(t);
  let release, reached;
  const hit = new Promise((r) => { reached = r; }), gate = new Promise((r) => { release = r; });
  const io = { ...fs, rename: async (from, to) => { if (to.endsWith('.json')) { reached(); await gate; } return fs.rename(from, to); } };
  const { store } = await loadStore(p.stateDir, { io, now: NOW });
  const writing = store.put(entry());
  await hit;
  assert.equal(store.seq(), 0);
  release(); const stamped = await writing;
  assert.equal(store.seq(), stamped.seq);
});
test('pruning the highest entry then restarting keeps the counter', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  const e = await store.put(entry());
  const gone = await store.put(L.applyWithdraw(e, withdrawalMessage(e.question), NOW).entry);
  assert.deepEqual(await store.prune(NOW + RETENTION_MS), [e.id]);
  const { store: after } = await loadStore(p.stateDir, { now: NOW });
  assert.equal(after.get(e.id), null);
  assert.equal((await after.put(entry())).seq, gone.seq + 1);
});
test('supersession interrupted between the writes is completed on load', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  const x = await store.put(entry());
  const nq = questionMessage({ body: { supersedes: x.id } }), n = entry(nq);
  const io = crashOn((to) => to.endsWith(`${x.id}.json`));
  const broken = (await loadStore(p.stateDir, { io, now: NOW })).store;
  await assert.rejects(broken.supersede(n, L.applySuperseded(broken.get(x.id), n.id, NOW).entry), { code: 'IO_ERROR' });
  const { store: after, rejected } = await loadStore(p.stateDir, { now: NOW + 1 });
  assert.deepEqual(rejected, []);
  assert.deepEqual([after.get(x.id).state, after.get(x.id).supersededBy], ['withdrawn', n.id]);
  assert.equal(after.get(n.id).state, 'pending');
});
test('a replacement whose predecessor is missing or unreachable is quarantined', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  const orphan = await store.put(entry(questionMessage({ body: { supersedes: '00000000-0000-4000-8000-000000000000' } })));
  const { store: after, rejected } = await loadStore(p.stateDir, { now: NOW });
  assert.equal(after.get(orphan.id), null);
  assert.equal(rejected[0].name, `${orphan.id}.json`);
  await fs.access(join(inboxPaths(p.stateDir).rejectedDir, `${orphan.id}.json`));
});
test('pruning keeps a predecessor while its replacement is non-terminal', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  const x = await store.put(entry());
  const nq = questionMessage({ body: { supersedes: x.id } });
  const [n] = await store.supersede(entry(nq), L.applySuperseded(x, nq.id, NOW).entry);
  const answered = await store.put(L.applyAnswer(n, answerMessage(nq), NOW).entry);
  assert.deepEqual(await store.prune(NOW + RETENTION_MS + 1), []);
  const { store: reloaded, rejected } = await loadStore(p.stateDir, { now: NOW + RETENTION_MS + 2 });
  assert.deepEqual(rejected, []); assert.ok(reloaded.get(x.id));
  const done = await reloaded.put(L.applyAskerGone(answered, NOW + RETENTION_MS + 3).entry);
  assert.deepEqual((await reloaded.prune(done.updatedAt + RETENTION_MS)).sort(), [n.id, x.id].sort());
});
test('invalid and stray files are quarantined, temporary files removed', async (t) => {
  const p = await tempState(t), ip = inboxPaths(p.stateDir);
  await loadStore(p.stateDir, { now: NOW });
  await fs.writeFile(join(ip.entriesDir, 'junk.json'), '{', { mode: 0o600 });
  await fs.writeFile(join(ip.entriesDir, 'x.json.tmp.1.abc'), '{}', { mode: 0o600 });
  const { rejected } = await loadStore(p.stateDir, { now: NOW });
  assert.deepEqual(rejected.map((r) => r.name), ['junk.json']);
  assert.deepEqual(await fs.readdir(ip.entriesDir), []);
});
test('a corrupt seq file is an error, not a reset', async (t) => {
  const p = await tempState(t);
  await loadStore(p.stateDir, { now: NOW });
  await fs.writeFile(inboxPaths(p.stateDir).seqPath, 'seven\n', { mode: 0o600 });
  await assert.rejects(loadStore(p.stateDir, { now: NOW }), { code: 'CORRUPT_STATE' });
});

test('recovery uses the highest entry sequence when seq is missing or behind', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  await store.put(entry()); const last = await store.put(entry());
  const seqPath = inboxPaths(p.stateDir).seqPath;
  for (const value of ['0\n', null]) {
    if (value === null) await fs.unlink(seqPath); else await fs.writeFile(seqPath, value);
    const after = (await loadStore(p.stateDir, { now: NOW })).store;
    assert.equal(after.seq(), 2);
    assert.equal(after.get(last.id).seq, 2);
  }
});

test('recovered counter survives pruning every retained entry', async (t) => {
  for (const value of ['0\n', null]) {
    const p = await tempState(t), { store } = await loadStore(p.stateDir);
    const e = await store.put(entry());
    await store.put(L.applyWithdraw(e, withdrawalMessage(e.question), NOW).entry);
    const seqPath = inboxPaths(p.stateDir).seqPath;
    if (value === null) await fs.unlink(seqPath); else await fs.writeFile(seqPath, value);
    const recovered = (await loadStore(p.stateDir)).store;
    await recovered.prune(NOW + RETENTION_MS);
    const after = (await loadStore(p.stateDir)).store;
    assert.equal((await after.put(entry())).seq, 3);
  }
});

test('seq refuses unsafe integers and allocation refuses exhaustion', async (t) => {
  const p = await tempState(t); await loadStore(p.stateDir, { now: NOW });
  const seqPath = inboxPaths(p.stateDir).seqPath;
  for (const value of ['9007199254740992\n', '-1\n', '1.5\n', '01\n']) {
    await fs.writeFile(seqPath, value, { mode: 0o600 });
    await assert.rejects(loadStore(p.stateDir), { code: 'CORRUPT_STATE' });
  }
  await fs.writeFile(seqPath, '9007199254740991\n');
  const { store } = await loadStore(p.stateDir);
  await assert.rejects(store.put(entry()), { code: 'CORRUPT_STATE' });
  assert.deepEqual(store.all(), []);
});

test('all new log rows are stamped while message and observation history survive reload', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir, { now: NOW });
  const q = questionMessage();
  const pending = await store.put(entry(q));
  const deferred = L.applyDefer(pending, deferMessage(q), NOW + 1).entry;
  const answered = L.applyAnswer(deferred, answerMessage(q), NOW + 2).entry;
  const handed = L.applyHanded(answered, HANDLE, NOW + 3).entry;
  const confirmed = L.applyConfirm(handed, { matches: true, observed: { Shape: 'Square' } }, NOW + 4).entry;
  const saved = await store.put(confirmed);
  assert.deepEqual(saved.log.map((r) => r.seq), [1, 2, 2, 2, 2]);
  const reloaded = (await loadStore(p.stateDir)).store.get(q.id);
  assert.deepEqual(reloaded.messages, confirmed.messages);
  assert.deepEqual(reloaded.observations, confirmed.observations);
  assert.equal(reloaded.state, 'consumed');
});

test('invalid entries are refused before any durable allocation', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir);
  await assert.rejects(store.put({ ...entry(), id: '../outside' }), { code: 'INVALID_ENTRY' });
  assert.equal(store.seq(), 0);
  assert.deepEqual(await fs.readdir(inboxPaths(p.stateDir).entriesDir), []);
});

test('put refuses extra raw frame data before allocation and load quarantines it', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir);
  const extra = { rawHarnessPayload: { transcript: 'private text' } };
  await assert.rejects(store.put({ ...entry(), ...extra }), { code: 'INVALID_ENTRY' });
  assert.equal(store.seq(), 0);
  assert.deepEqual(await fs.readdir(inboxPaths(p.stateDir).entriesDir), []);
  await assert.rejects(fs.access(inboxPaths(p.stateDir).seqPath), { code: 'ENOENT' });
  const saved = await store.put(entry());
  await fs.writeFile(join(inboxPaths(p.stateDir).entriesDir, `${saved.id}.json`), JSON.stringify({ ...saved, ...extra }));
  const { store: after, rejected } = await loadStore(p.stateDir);
  assert.equal(after.get(saved.id), null);
  assert.deepEqual(rejected.map((r) => r.name), [`${saved.id}.json`]);
  await fs.access(join(inboxPaths(p.stateDir).rejectedDir, `${saved.id}.json`));
});

test('nested missing state ancestors are published in order, including after earlier mkdir', async (t) => {
  for (const precreated of [false, true]) {
    const p = await tempState(t), stateDir = join(p.stateDir, 'a', 'b', 'state'), synced = [];
    if (precreated) await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    const io = { ...fs, open: async (path, ...args) => {
      const handle = await fs.open(path, ...args);
      if (args[0] !== 'r') return handle;
      return { close: () => handle.close(), sync: async () => { await handle.sync(); synced.push(path); } };
    } };
    const { store } = await loadStore(stateDir, { io });
    assert.deepEqual(synced.filter((path) => path.startsWith(p.stateDir)), [
      p.stateDir, join(p.stateDir, 'a'), join(p.stateDir, 'a', 'b'), stateDir, join(stateDir, 'inbox'),
    ]);
    // A directory owned by another user that this uid cannot write holds no relay link: '/' is synced only as root.
    assert.equal(synced.includes('/'), process.getuid() === 0);
    for (let i = 1; i < synced.length; i++) assert.ok(synced[i].startsWith(synced[i - 1] === '/' ? '/' : `${synced[i - 1]}/`), synced.join(' '));
    assert.equal((await store.put(entry())).seq, 1);
  }
});

// An io whose stat reports `faked` paths as owned by another user with the given mode, and whose
// directory opens fail with EACCES where that mode gives this uid no read permission.
function foreignIo(faked, synced) {
  const foreign = process.getuid() + 1;
  return { ...fs,
    stat: async (path, ...args) => {
      const info = await fs.stat(path, ...args);
      return Object.hasOwn(faked, path) ? Object.assign(info, { uid: foreign, mode: (info.mode & ~0o7777) | faked[path] }) : info;
    },
    open: async (path, ...args) => {
      if (args[0] === 'r' && Object.hasOwn(faked, path) && !(faked[path] & 0o004)) throw Object.assign(new Error(`EACCES: open '${path}'`), { code: 'EACCES' });
      const handle = await fs.open(path, ...args);
      if (args[0] !== 'r') return handle;
      return { close: () => handle.close(), sync: async () => { await handle.sync(); synced.push(path); } };
    } };
}

test('an ancestor owned by another user with mode 0711 is neither opened nor synced', async (t) => {
  const p = await tempState(t), locked = join(p.stateDir, 'locked'), mine = join(locked, 'mine'), stateDir = join(mine, 'state'), synced = [];
  await fs.mkdir(mine, { recursive: true, mode: 0o700 });
  const { store } = await loadStore(stateDir, { io: foreignIo({ [locked]: 0o711 }, synced) });
  assert.deepEqual(synced.filter((path) => path.startsWith(p.stateDir)), [mine, stateDir, join(stateDir, 'inbox')]);
  assert.equal((await store.put(entry())).seq, 1);
});

test('a directory relay creates inside another user\'s writable directory is still published there', async (t) => {
  const p = await tempState(t), shared = join(p.stateDir, 'shared'), created = join(shared, 'mine'), stateDir = join(created, 'state'), synced = [];
  await fs.mkdir(shared, { mode: 0o700 });
  await loadStore(stateDir, { io: foreignIo({ [shared]: 0o1777 }, synced) });
  assert.deepEqual(synced.filter((path) => path.startsWith(p.stateDir)), [shared, created, stateDir, join(stateDir, 'inbox')]);
});

test('failed nested ancestor sync prevents loading and retry publishes already-created links', async (t) => {
  const p = await tempState(t), a = join(p.stateDir, 'a'), stateDir = join(a, 'b', 'state'), synced = [];
  let armed = true;
  const io = { ...fs, open: async (path, ...args) => {
    const handle = await fs.open(path, ...args);
    if (args[0] !== 'r') return handle;
    return { close: () => handle.close(), sync: async () => {
      if (armed && path === a) { armed = false; throw Object.assign(new Error('ancestor sync failed'), { code: 'EIO' }); }
      await handle.sync(); synced.push(path);
    } };
  } };
  await assert.rejects(loadStore(stateDir, { io }), (error) => error.code === 'IO_ERROR' && error.cause.code === 'EIO');
  await fs.access(join(stateDir, 'inbox', 'entries'));
  await assert.rejects(fs.access(inboxPaths(stateDir).seqPath), { code: 'ENOENT' });
  synced.length = 0;
  const { store } = await loadStore(stateDir, { io });
  assert.deepEqual(synced.filter((path) => path.startsWith(p.stateDir)), [p.stateDir, a, join(a, 'b'), stateDir, join(stateDir, 'inbox')]);
  assert.equal((await store.put(entry())).seq, 1);
});

test('new store directories sync their containing directories before the first write', async (t) => {
  const p = await tempPaths(t), ip = inboxPaths(p.stateDir), synced = [];
  const io = { ...fs, open: async (path, ...args) => {
    const handle = await fs.open(path, ...args);
    if (args[0] !== 'r') return handle;
    return { sync: async () => { await handle.sync(); synced.push(path); }, close: () => handle.close() };
  } };
  const { store } = await loadStore(p.stateDir, { io });
  assert.deepEqual(synced.slice(-3), [dirname(p.stateDir), p.stateDir, ip.root]);
  const initialized = synced.length;
  const saved = await store.put(entry());
  assert.equal(saved.seq, 1);
  assert.deepEqual(synced.slice(initialized - 3, initialized), [dirname(p.stateDir), p.stateDir, ip.root]);
  synced.length = 0;
  await loadStore(p.stateDir, { io });
  assert.deepEqual(synced.slice(-3), [dirname(p.stateDir), p.stateDir, ip.root]);
});

test('initialization sync failure rejects the load and retry syncs existing directory links', async (t) => {
  const p = await tempPaths(t), synced = [];
  let armed = true;
  const io = { ...fs, open: async (path, ...args) => {
    const handle = await fs.open(path, ...args);
    if (args[0] !== 'r') return handle;
    return { close: () => handle.close(), sync: async () => {
      if (armed && path === p.stateDir) {
        armed = false; throw Object.assign(new Error('parent sync failed'), { code: 'EIO' });
      }
      await handle.sync(); synced.push(path);
    } };
  } };
  await assert.rejects(loadStore(p.stateDir, { io }), { code: 'IO_ERROR' });
  await fs.access(inboxPaths(p.stateDir).root);
  synced.length = 0;
  const { store } = await loadStore(p.stateDir, { io });
  assert.deepEqual(synced.slice(-3), [dirname(p.stateDir), p.stateDir, inboxPaths(p.stateDir).root]);
  assert.equal((await store.put(entry())).seq, 1);
});

test('unsafe directories, entry files, seq and symlinks are refused without repair', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir);
  const e = await store.put(entry()), ip = inboxPaths(p.stateDir);
  for (const [path, mode] of [[ip.root, 0o755], [ip.entriesDir, 0o755], [ip.rejectedDir, 0o755],
    [ip.seqPath, 0o644], [join(ip.entriesDir, `${e.id}.json`), 0o644]]) {
    const original = (await fs.stat(path)).mode & 0o777;
    await fs.chmod(path, mode);
    await assert.rejects(loadStore(p.stateDir), { code: 'IO_ERROR' });
    assert.equal((await fs.stat(path)).mode & 0o777, mode);
    await fs.chmod(path, original);
  }
  const target = join(ip.entriesDir, `${e.id}.json`), link = join(ip.entriesDir, 'link.json');
  await fs.symlink(target, link);
  await assert.rejects(loadStore(p.stateDir), { code: 'IO_ERROR' });
  assert.ok((await fs.lstat(link)).isSymbolicLink());
});

test('read IO failures stop loading instead of quarantining valid entries', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir);
  const e = await store.put(entry());
  const io = { ...fs, readFile: async (path, ...args) => {
    if (path.endsWith('.json')) throw Object.assign(new Error('disk'), { code: 'EIO' });
    return fs.readFile(path, ...args);
  } };
  await assert.rejects(loadStore(p.stateDir, { io }), { code: 'IO_ERROR' });
  await fs.access(join(inboxPaths(p.stateDir).entriesDir, `${e.id}.json`));
  assert.deepEqual(await fs.readdir(inboxPaths(p.stateDir).rejectedDir), []);
});

test('unreachable and answered predecessors quarantine replacements without changing predecessors', async (t) => {
  for (const state of ['withdrawn', 'answered']) {
    const p = await tempState(t), { store } = await loadStore(p.stateDir);
    const first = await store.put(entry());
    const x = await store.put((state === 'withdrawn'
      ? L.applyWithdraw(first, withdrawalMessage(first.question), NOW)
      : L.applyAnswer(first, answerMessage(first.question), NOW)).entry);
    const n = await store.put(entry(questionMessage({ body: { supersedes: x.id } })));
    const { store: after, rejected } = await loadStore(p.stateDir);
    assert.equal(after.get(n.id), null);
    assert.deepEqual(after.get(x.id), x);
    assert.equal(rejected[0].name, `${n.id}.json`);
  }
});

test('notice expiry is retained until its own thirty day deadline', async (t) => {
  const p = await tempState(t), { store } = await loadStore(p.stateDir);
  const notice = noticeMessage(), n = await store.put(L.createNotice(notice, { now: NOW }));
  assert.deepEqual(await store.prune(NOW + RETENTION_MS), []);
  const expired = await store.put(L.applyClock(n, notice.body.expiresAt).entry);
  assert.deepEqual(await store.prune(expired.updatedAt + RETENTION_MS - 1), []);
  assert.deepEqual(await store.prune(expired.updatedAt + RETENTION_MS), [n.id]);
});

test('durable publication syncs file before rename and directory after rename', async (t) => {
  const p = await tempState(t); await loadStore(p.stateDir);
  const path = inboxPaths(p.stateDir).seqPath, calls = [];
  const io = { ...fs, open: async (name, ...args) => {
    const handle = await fs.open(name, ...args);
    return { writeFile: async (...values) => { calls.push('write'); return handle.writeFile(...values); },
      sync: async () => { calls.push(name === inboxPaths(p.stateDir).root ? 'dir-sync' : 'file-sync'); return handle.sync(); },
      close: () => handle.close() };
  }, rename: async (...args) => { calls.push('rename'); return fs.rename(...args); } };
  await writeDurable(path, '1\n', { io });
  assert.deepEqual(calls, ['write', 'file-sync', 'rename', 'dir-sync']);
  assert.equal(await fs.readFile(path, 'utf8'), '1\n');
});

test('a failed file sync leaves prior state and removes the temporary file', async (t) => {
  const p = await tempState(t); await loadStore(p.stateDir);
  const path = inboxPaths(p.stateDir).seqPath;
  await writeDurable(path, '1\n');
  const io = { ...fs, open: async (name, ...args) => {
    const handle = await fs.open(name, ...args);
    return { writeFile: (...values) => handle.writeFile(...values), close: () => handle.close(),
      sync: async () => { throw Object.assign(new Error('sync failed'), { code: 'EIO' }); } };
  } };
  await assert.rejects(writeDurable(path, '2\n', { io }), { code: 'IO_ERROR' });
  assert.equal(await fs.readFile(path, 'utf8'), '1\n');
  assert.deepEqual((await fs.readdir(inboxPaths(p.stateDir).root)).sort(), ['entries', 'rejected', 'seq']);
});

test('a failed directory sync does not expose an uncommitted entry', async (t) => {
  const p = await tempState(t); await loadStore(p.stateDir);
  const ip = inboxPaths(p.stateDir);
  const io = { ...fs, open: async (name, ...args) => {
    const handle = await fs.open(name, ...args);
    if (name !== ip.entriesDir) return handle;
    return { close: () => handle.close(), sync: async () => {
      throw Object.assign(new Error('directory sync failed'), { code: 'EIO' });
    } };
  } };
  const { store } = await loadStore(p.stateDir, { io });
  const e = entry();
  await assert.rejects(store.put(e), { code: 'IO_ERROR' });
  assert.equal(store.get(e.id), null); assert.equal(store.seq(), 0);
  const after = (await loadStore(p.stateDir)).store;
  assert.equal(after.get(e.id).seq, 1);
  assert.equal((await after.put(entry())).seq, 2);
});

test('quarantine preserves previous rejected bytes when a name repeats', async (t) => {
  const p = await tempState(t); await loadStore(p.stateDir);
  const ip = inboxPaths(p.stateDir);
  await fs.writeFile(join(ip.entriesDir, 'junk.json'), 'first', { mode: 0o600 });
  await loadStore(p.stateDir);
  await fs.writeFile(join(ip.entriesDir, 'junk.json'), 'second', { mode: 0o600 });
  await loadStore(p.stateDir);
  const files = await fs.readdir(ip.rejectedDir);
  assert.equal(files.length, 2);
  assert.deepEqual((await Promise.all(files.map((name) => fs.readFile(join(ip.rejectedDir, name), 'utf8')))).sort(), ['first', 'second']);
});
