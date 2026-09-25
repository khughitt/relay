import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessOps, parseStat, parseDarwinRow, normalizeDarwinTty, runDarwinPs, parseDarwinExecutable, DEADLINE_CUT } from '../src/bus/proc.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
test('proc parsing keeps state and exact field-22 text', () => {
  const after = Array(20).fill('0');
  after[0] = 'Z'; after[1] = '1'; after[4] = '34816'; after[19] = '9007199254740993';
  const row = parseStat(`42 (my (weird) process) ${after.join(' ')}`);
  assert.equal(row.starttime, '9007199254740993');
  assert.equal(row.state, 'Z');
});
const boot = '12345678-1234-4234-8234-123456789abc';
const stat = (pid = 42, ppid = 1, start = '987654', state = 'S', tty = '34816') => {
  const fields = Array(20).fill('0'); fields[0] = state; fields[1] = String(ppid); fields[4] = tty; fields[19] = start;
  return `${pid} (my (weird) proc) ${fields.join(' ')}`;
};
const failure = (code) => Object.assign(new Error(code), { code });
const linux = (row = stat(), extra = {}) => createProcessOps({ platform: 'linux', readText: (p) => {
  if (Object.hasOwn(extra, p)) { if (extra[p] instanceof Error) throw extra[p]; return extra[p]; }
  if (p.endsWith('/hostname')) return 'host\n';
  if (p.endsWith('/boot_id')) return boot;
  if (row instanceof Error) throw row;
  return row;
} });
const handle = { platform: 'linux', host: 'host', bootId: boot, pid: 42, start: '987654' };
test('fresh Linux qualification distinguishes dead from unknown', () => {
  for (const [ops, h, expected] of [
    [linux(), handle, 'alive'], [linux(stat(42, 1, '987655')), handle, 'dead'],
    [linux(stat(42, 1, '987654', 'Z')), handle, 'dead'], [linux(stat(42, 1, '987654', 'X')), handle, 'dead'],
    [linux(failure('ENOENT')), handle, 'dead'], [linux(failure('ESRCH')), handle, 'dead'],
    [linux(failure('EACCES')), handle, 'unknown'], [linux(failure('EPERM')), handle, 'unknown'],
    [linux('broken'), handle, 'unknown'], [linux(), { ...handle, host: 'foreign' }, 'unknown'],
    [linux(), { ...handle, platform: 'darwin', bootId: null }, 'unknown'],
    [linux(), { ...handle, bootId: '22345678-1234-4234-8234-123456789abc' }, 'dead'],
    [linux(), { ...handle, bootId: null }, 'unknown'], [linux(), null, 'unknown'],
    [linux(stat(), { '/proc/sys/kernel/random/boot_id': failure('EACCES') }), handle, 'unknown'],
    [linux(stat(), { '/proc/sys/kernel/hostname': failure('EACCES') }), handle, 'unknown'],
  ]) assert.equal(ops.probe(h).status, expected);
  assert.equal(linux(failure('ENOENT')).recordOf(42), null);
  assert.throws(() => linux(failure('EPERM')).recordOf(42), { code: 'PROCESS_UNREADABLE' });
  assert.equal(linux(stat(), { '/proc/sys/kernel/random/boot_id': failure('EACCES') }).handleOf(42).bootId, null);
  assert.equal(linux(stat(), { '/proc/sys/kernel/hostname': '' }).handleOf(42), null);
});
test('Linux walk preserves nearest-first order, absence and loop errors', () => {
  const rows = { '/proc/50/stat': stat(50, 40), '/proc/40/stat': stat(40, 30), '/proc/30/stat': stat(30, 1) };
  assert.deepEqual(linux(null, rows).ancestors(50).map(r => r.pid), [50, 40, 30]);
  assert.deepEqual(linux(failure('ENOENT'), { '/proc/50/stat': stat(50, 40) }).ancestors(50).map(r => r.pid), [50]);
  assert.throws(() => linux(null, { '/proc/50/stat': stat(50, 50) }).ancestors(50), { code: 'PROCESS_UNREADABLE' });
  assert.equal(parseStat(stat(42, 1, '1', 'S', '0')).tty, null);
  for (const bad of ['', 'nonsense', '500 (node) S 400 0 0 0 0']) assert.throws(() => parseStat(bad), { code: 'PROCESS_UNREADABLE' });
});
const darwinRow = (pid = 42, ppid = 1, tty = 'ttys000') => `${pid} ${ppid} ${tty} Tue Jan 02 03:04:05 2024 /usr/bin/codex`;
test('Darwin process proof is independent of unsafe tty and always fresh', () => {
  const calls = [];
  const ops = createProcessOps({ platform: 'darwin', hostname: () => 'host', runPs: (args) => { calls.push(args); return darwinRow(42, 1, 'console'); } });
  const h = ops.handleOf(42);
  assert.equal(ops.probe(h).status, 'alive');
  assert.throws(() => ops.recordOf(42), { code: 'PROCESS_UNREADABLE' });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(args => args[0] === '-p' && args[1] === '42'));
});
test('Darwin table is fresh per walk and isolates malformed rows by PID', () => {
  let calls = 0;
  const ops = createProcessOps({ platform: 'darwin', runPs: () => {
    calls++; return [darwinRow(50, 42, '??'), darwinRow(), darwinRow(99, 1, 'console'), 'garbage', '42 broken'].join('\n');
  } });
  assert.deepEqual(ops.ancestors(50).map(r => r.pid), [50, 42]);
  assert.deepEqual(ops.ancestors(50).map(r => r.pid), [50, 42]);
  assert.equal(calls, 2);
  assert.throws(() => ops.ancestors(99), { code: 'PROCESS_UNREADABLE' });
  assert.deepEqual(ops.ancestors(88), []);
});
test('Darwin empty target is absent; failures need ESRCH proof', () => {
  const h = { ...handle, platform: 'darwin', bootId: null, start: String(Date.parse('Tue Jan 02 03:04:05 2024') / 1000) };
  const options = { platform: 'darwin', hostname: () => 'host' };
  assert.equal(createProcessOps({ ...options, runPs: () => '' }).probe(h).status, 'dead');
  for (const [code, expected] of [['ESRCH', 'dead'], ['EPERM', 'unknown'], ['EIO', 'unknown']]) {
    const ops = createProcessOps({ ...options, runPs: () => { throw failure('EIO'); }, kill: () => { throw failure(code); } });
    assert.equal(ops.probe(h).status, expected);
  }
  for (const output of [darwinRow(43), `${darwinRow()}\n${darwinRow()}`, 0]) {
    assert.equal(createProcessOps({ ...options, runPs: () => output }).probe(h).status, 'unknown');
  }
  assert.throws(() => createProcessOps({ platform: 'win32' }), { code: 'PROCESS_UNAVAILABLE' });
});
test('Darwin subprocess has fixed locale, binary, deadline and output cap', () => {
  let call;
  assert.equal(runDarwinPs(['-axo', 'fields'], { clock: () => 10, deadline: 60, spawn: (...args) => { call = args; return { status: 0, stdout: 'rows' }; } }), 'rows');
  assert.equal(call[0], '/bin/ps'); assert.deepEqual(call[1], ['-axo', 'fields']);
  assert.equal(call[2].env.LC_ALL, 'C'); assert.equal(call[2].timeout, 50);
  assert.equal(call[2].maxBuffer, 4 * 1024 * 1024); assert.equal(call[2].killSignal, 'SIGKILL');
  for (const result of [{ error: failure('ENOENT') }, { signal: 'SIGKILL' }, { status: 7 }]) {
    assert.throws(() => runDarwinPs([], { spawn: () => result }), { code: 'PROCESS_UNAVAILABLE' });
  }
  assert.throws(() => runDarwinPs([], { clock: () => 10, deadline: 10 }), { code: 'DEADLINE_EXCEEDED' });
});
test('a Darwin lookup killed at the caller deadline is a deadline, not an unreadable process', () => {
  // Mac regression (relay-6e9410): the last owner probe before a lock deadline got 1-5 ms, ps -p
  // needs 3-6 ms, and the kill read as an owner of unknown identity.
  const killed = { error: failure('ETIMEDOUT'), signal: 'SIGKILL', status: null };
  for (const result of [killed, { error: failure('ETIMEDOUT'), signal: null, status: 0 }])
    assert.throws(() => runDarwinPs([], { clock: () => 10, deadline: 13, spawn: () => result }), { code: 'DEADLINE_EXCEEDED' });
  assert.throws(() => runDarwinPs([], { clock: () => 10, deadline: 60010, spawn: () => killed }), { code: 'PROCESS_UNAVAILABLE' });
  const h = { ...handle, platform: 'darwin', bootId: null, start: String(Date.parse('Tue Jan 02 03:04:05 2024') / 1000) };
  const ops = createProcessOps({ platform: 'darwin', hostname: () => 'host', kill: () => {},
    runPs: () => { throw Object.assign(new Error('cut'), { code: 'DEADLINE_EXCEEDED' }); } });
  assert.deepEqual(ops.probe(h), { status: 'unknown', reason: DEADLINE_CUT });
});
test('portable Darwin epoch under UTC and local DST date validation', () => {
  const corpus = JSON.parse(readFileSync(new URL('./fixtures/handles.json', import.meta.url)));
  const module = new URL('../src/bus/proc.js', import.meta.url).href;
  for (const c of corpus.darwin) {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `import {parseDarwinRow} from ${JSON.stringify(module)}; console.log(parseDarwinRow(${JSON.stringify(c.input.row)}).starttime);`], { env: { ...process.env, TZ: c.input.timezone } });
    assert.equal(output.toString().trim(), c.expected);
  }
  execFileSync(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; import {parseDarwinRow} from ${JSON.stringify(module)};
    assert.equal(parseDarwinRow('42 1 ?? Tue Jan 02 03:04:05 2024 /bin/node').starttime, '1704182645');
    assert.throws(() => parseDarwinRow('42 1 ?? Sun Mar 10 02:30:00 2024 /bin/node'));`], { env: { ...process.env, TZ: 'America/New_York' } });
});
test('real local process retains fresh qualified identity', () => {
  const ops = createProcessOps(), h = ops.handleOf(process.pid);
  assert.ok(h); assert.equal(ops.probe(h).status, 'alive');
  assert.equal(ops.probe({ ...h, start: String(BigInt(h.start) + 1n) }).status, 'dead');
});
test('Darwin ps keeps comm last and canonicalizes tty', () => {
  assert.deepEqual(parseDarwinRow(
    '77266 77264 ttys000 Sat Aug 22 23:24:46 2026 /Applications/Some App/claude'
  ), {
    pid: 77266,
    ppid: 77264,
    comm: 'claude',
    tty: 'ttys000',
    starttime: String(Date.parse('Sat Aug 22 23:24:46 2026') / 1000), state: null,
  });
});

test('Darwin tty accepts full and abbreviated ptys only', () => {
  assert.equal(normalizeDarwinTty('??'), null);
  assert.equal(normalizeDarwinTty('ttys003'), 'ttys003');
  assert.equal(normalizeDarwinTty('s003'), 'ttys003');
  for (const raw of ['console', '../ttys003', 'ttys003/x', '/dev/ttys003']) {
    assert.throws(() => normalizeDarwinTty(raw), /unsafe Darwin tty/);
  }
});

test('Darwin rows reject malformed identities, dates, and commands', () => {
  for (const row of [
    '0 1 ?? Sat Aug 22 23:24:46 2026 /usr/bin/node',
    '20 -1 ?? Sat Aug 22 23:24:46 2026 /usr/bin/node',
    '9007199254740992 1 ?? Sat Aug 22 23:24:46 2026 /usr/bin/node',
    '20 9007199254740992 ?? Sat Aug 22 23:24:46 2026 /usr/bin/node',
    '20 1 ?? not-a-date /usr/bin/node',
    '20 1 ?? Tue Feb 31 23:24:46 2026 /usr/bin/node',
    '20 1 ?? Sat Aug 22 24:24:46 2026 /usr/bin/node',
    '20 1 ?? Sat Aug 22 23:60:46 2026 /usr/bin/node',
    '20 1 ?? Sat Aug 22 23:24:60 2026 /usr/bin/node',
    '20 1 ?? Sun Aug 22 23:24:46 2026 /usr/bin/node',
    '20 1 ?? Sat Aug 22 23:24:46 2026    ',
  ]) {
    assert.throws(() => parseDarwinRow(row), /Darwin ps: malformed row/);
  }
});

test('one Linux provider refreshes hostname boot and process start on every probe',()=>{
  let row=stat(),host='host',bootId=boot;
  const ops=createProcessOps({platform:'linux',readText:p=>p.endsWith('/hostname')?host:p.endsWith('/boot_id')?bootId:row});
  const h=ops.handleOf(42);assert.equal(ops.probe(h).status,'alive');
  row=stat(42,1,'987655');assert.equal(ops.probe(h).status,'dead');
  row=stat();bootId='22345678-1234-4234-8234-123456789abc';assert.equal(ops.probe(h).reason,'boot changed');
  host='other';assert.equal(ops.probe(h).reason,'foreign host');
});

const linuxWith = (files, links = {}) => createProcessOps({ platform: 'linux',
  readText: (p) => { if (!Object.hasOwn(files, p)) throw failure('ENOENT'); if (files[p] instanceof Error) throw files[p]; return files[p]; },
  readLink: (p) => { if (!Object.hasOwn(links, p)) throw failure('ENOENT'); if (links[p] instanceof Error) throw links[p]; return links[p]; } });
test('Linux executable path comes from the exe link, and a replaced binary keeps its path', () => {
  const path = '/home/user/.local/share/claude/versions/2.1.280';
  assert.equal(linuxWith({}, { '/proc/7/exe': path }).executableOf(7), path);
  assert.equal(linuxWith({}, { '/proc/7/exe': `${path} (deleted)` }).executableOf(7), path);
  for (const link of [failure('EACCES'), failure('ENOENT'), 'relative/path', ''])
    assert.throws(() => linuxWith({}, { '/proc/7/exe': link }).executableOf(7), { code: 'PROCESS_UNREADABLE' });
});
test('Linux arguments split the NUL-separated cmdline; an empty cmdline is no arguments', () => {
  assert.deepEqual(linuxWith({ '/proc/7/cmdline': 'claude\0daemon\0run\0' }).argvOf(7), ['claude', 'daemon', 'run']);
  assert.deepEqual(linuxWith({ '/proc/7/cmdline': 'claude\0-p\0two words\0' }).argvOf(7), ['claude', '-p', 'two words']);
  assert.deepEqual(linuxWith({ '/proc/7/cmdline': '' }).argvOf(7), []);
  for (const text of [failure('EACCES'), failure('ENOENT')])
    assert.throws(() => linuxWith({ '/proc/7/cmdline': text }).argvOf(7), { code: 'PROCESS_UNREADABLE' });
});
test('Darwin executable path is the first text file lsof lists, never ps comm', () => {
  // Mac regression (Darwin probe D4): comm is argv[0], so a native install started as
  // `9.9.9` read as "9.9.9" and was never recognized.
  const exe = '/Users/Test User/.local/share/claude/versions/2.1.280';
  const calls = [];
  const ops = createProcessOps({ platform: 'darwin', runPs: () => { throw new Error('ps must not be read'); },
    runLsof: (args) => { calls.push(args.join(' ')); return `p9\nftxt\nn${exe}\nftxt\nn/usr/lib/dyld\n`; } });
  assert.equal(ops.executableOf(9), exe);
  assert.deepEqual(calls, ['-w -a -p 9 -d txt -Fn']);
  assert.equal(parseDarwinExecutable(`p9\nn${exe}\nn/usr/lib/dyld\n`, 9), exe);
  for (const output of ['', '\n', 'p8\nftxt\nn/bin/x\n', 'p9\n', 'p9\nftxt\nn9.9.9\n', 'p9\nfcwd\nn/Users\n', null])
    assert.throws(() => parseDarwinExecutable(output, 9), { code: 'PROCESS_UNREADABLE' });
  const empty = createProcessOps({ platform: 'darwin', runPs: () => '\n', runLsof: () => '' });
  for (const read of [() => empty.executableOf(9), () => empty.argvOf(9)]) assert.throws(read, { code: 'PROCESS_UNREADABLE' });
});
test('Darwin executable lookup failures propagate as unavailable', () => {
  const ops = createProcessOps({ platform: 'darwin', runLsof: () => { throw Object.assign(new Error('gone'), { code: 'PROCESS_UNAVAILABLE' }); } });
  assert.throws(() => ops.executableOf(9), { code: 'PROCESS_UNAVAILABLE' });
});
test('real lsof output parses to the executable', { skip: !existsSync('/usr/bin/lsof') && !existsSync('/usr/sbin/lsof') }, () => {
  const lsof = existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : '/usr/bin/lsof';
  const out = spawnSync(lsof, ['-w', '-a', '-p', String(process.pid), '-d', 'txt', '-Fn'], { encoding: 'utf8' });
  assert.equal(realpathSync(parseDarwinExecutable(out.stdout, process.pid)), realpathSync(process.execPath));
});
const darwinPs = (comm, args) => createProcessOps({ platform: 'darwin',
  runPs: (a) => a.includes('comm=') ? `${comm}\n` : a.includes('args=') ? `${args}\n` : '' });
test('Darwin argv[0] keeps its spaces: comm fixes where it ends, so a daemon is still a daemon', () => {
  // Review regression: splitting args on whitespace made argv[1] "User/.local/bin/claude".
  assert.deepEqual(darwinPs('/Users/Test User/.local/bin/claude', '/Users/Test User/.local/bin/claude daemon run').argvOf(9),
    ['/Users/Test User/.local/bin/claude', 'daemon', 'run']);
  assert.deepEqual(darwinPs('claude', 'claude').argvOf(9), ['claude']);
});
test('Darwin argv fails closed when argv[0] cannot be located in args', () => {
  for (const [comm, args] of [['/Users/Test User/.local/bin/claude', '/Users/Other/claude daemon run'],
    ['/Users/Test User/.local/bin/claude', '/Users/Test User/.local/bin/claudex daemon'], ['claude', 'claude-helper daemon'],
    // comm is argv[0] on Darwin, never an executable path standing in for it.
    ['/Users/user/.local/bin/claude', 'claude daemon run']])
    assert.throws(() => darwinPs(comm, args).argvOf(9), { code: 'PROCESS_UNREADABLE' });
});
test('real local process exposes its own executable and arguments', () => {
  const ops = createProcessOps();
  if (process.platform !== 'linux') return;
  assert.equal(ops.executableOf(process.pid), readlinkSync('/proc/self/exe'));
  assert.equal(ops.argvOf(process.pid)[0], process.argv0);
});
