import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProcessOps } from '../src/bus/proc.js';
import { harnessWalk } from '../src/identity/walk.js';

const row = (pid, comm, ppid = 1) => ({ pid, ppid, comm, tty: null, state: 'S', starttime: String(pid * 10) });
function table(rows, { exe = {}, argv = {} } = {}) {
  const records = new Map(rows.map(r => [r.pid, r]));
  const reads = { record: [], exe: [], argv: [] };
  const processOps = {
    recordOf(pid) { reads.record.push(pid); return records.get(pid) ?? null; },
    executableOf(pid) {
      reads.exe.push(pid);
      if (!Object.hasOwn(exe, pid)) throw new Error('executable unreadable');
      return exe[pid];
    },
    argvOf(pid) {
      reads.argv.push(pid);
      if (!Object.hasOwn(argv, pid)) throw new Error('arguments unreadable');
      return argv[pid];
    },
  };
  return { processOps, reads };
}
const walk = (rows, options) => harnessWalk({ startPid: 1000, ...table([row(1000, 'node', rows[0].pid), ...rows], options) });
const boundary = (harness, pid, ppid = 1, role = 'session') => ({ kind: 'boundary', harness, pid, ppid, start: String(pid * 10), role });

test('nearest harness wins', () => {
  assert.deepEqual(walk([row(9, 'codex', 8), row(8, 'claude')]), boundary('codex', 9, 8));
});
test('version-comm claude', () => {
  assert.deepEqual(walk([row(9, '2.1.3')], { exe: { 9: '/x/claude/versions/2.1.3' }, argv: { 9: ['claude'] } }), boundary('claude-code', 9));
});
for (const role of ['daemon', 'bg-pty-host']) test(`${role} role`, () => {
  assert.deepEqual(walk([row(9, 'claude', 8), row(8, 'codex')], { argv: { 9: ['claude', role] } }), boundary('claude-code', 9, 8, role));
});
test('outside to init', () => {
  assert.deepEqual(walk([row(9, 'bash'), row(1, 'systemd', 0)]), { kind: 'outside' });
});
test('harness at pid 1', () => {
  assert.deepEqual(walk([row(1, 'claude', 0)], { argv: { 1: [] } }), boundary('claude-code', 1, 0));
});
test('boundary carries its observed start', () => {
  assert.equal(walk([{ ...row(9, 'codex'), starttime: '9007199254740993' }]).start, '9007199254740993');
});
test('vanished ancestor throws PROCESS_UNREADABLE', () => {
  assert.throws(() => walk([row(9, 'bash', 8)]), { code: 'PROCESS_UNREADABLE' });
});
test('cycle throws', () => {
  assert.throws(() => walk([row(9, 'bash', 8), row(8, 'bash', 9)]), { code: 'PROCESS_UNREADABLE' });
});
test('depth 65 throws', () => {
  const rows = Array.from({ length: 65 }, (_, i) => row(900 - i, i === 64 ? 'codex' : 'bash', 899 - i));
  assert.throws(() => walk(rows), { code: 'PROCESS_UNREADABLE' });
});
test('depth 64 can find a boundary', () => {
  const rows = Array.from({ length: 64 }, (_, i) => row(900 - i, i === 63 ? 'codex' : 'bash', 899 - i));
  assert.deepEqual(walk(rows), boundary('codex', 837, 836));
});
test('index 0 is never the boundary', () => {
  const fake = table([row(9, 'codex', 8), row(8, 'agy')]);
  assert.deepEqual(harnessWalk({ startPid: 9, processOps: fake.processOps }), boundary('agy', 8));
});
test('default startPid is the caller', () => {
  assert.deepEqual(harnessWalk(table([row(process.pid, 'codex', 1), row(1, 'init', 0)])), { kind: 'outside' });
});
test('a non-harness with ppid 0 is outside', () => {
  assert.deepEqual(walk([row(9, 'bash', 0)]), { kind: 'outside' });
});
test('a read failure throws PROCESS_UNREADABLE', () => {
  assert.throws(() => harnessWalk({ processOps: { recordOf() { throw new Error('denied'); } } }), { code: 'PROCESS_UNREADABLE' });
});
test('ancestry.rs: a_readable_claude_under_codex_is_the_claude_boundary', () => {
  assert.deepEqual(walk([row(9, 'claude', 8), row(8, 'codex')], { argv: { 9: ['claude'] } }), boundary('claude-code', 9, 8));
});
test('ancestry.rs: a_foreign_version_binary_is_walked_past', () => {
  for (const exe of ['/opt/tool/2.1.3', '/x/claude/versions/2.1.2']) {
    assert.deepEqual(walk([row(9, '2.1.3', 8), row(8, 'codex')], { exe: { 9: exe } }), boundary('codex', 8));
  }
});
test('ancestry.rs: an_unreadable_cmdline_is_unknown', () => {
  assert.throws(() => walk([row(9, 'claude')]), { code: 'PROCESS_UNREADABLE' });
});
test('ancestry.rs: an_empty_cmdline_is_a_session', () => {
  assert.deepEqual(walk([row(9, 'claude')], { argv: { 9: [] } }), boundary('claude-code', 9));
});
test('ancestry.rs: a_plain_chain_never_reads_an_executable_or_arguments', () => {
  assert.deepEqual(walk([row(9, 'zsh', 8), row(8, 'sudo'), row(1, 'init', 0)]), { kind: 'outside' });
});
test('ancestry.rs: only_the_nearest_claude_code_process_has_its_arguments_read', () => {
  const fake = table([row(10, 'node', 9), row(9, 'claude', 8), row(8, 'claude')], { argv: { 9: ['claude', '-p', 'x'] } });
  assert.deepEqual(harnessWalk({ startPid: 10, processOps: fake.processOps }), boundary('claude-code', 9, 8));
  assert.deepEqual(fake.reads.argv, [9]);
  assert.deepEqual(fake.reads.record, [10, 9]);
});
test('ancestry.rs: an_ancestry_walk_matches_every_recognized_comm', () => {
  for (const [comm, harness] of [['claude', 'claude-code'], ['codex', 'codex'], ['opencode', 'opencode'], ['agy', 'agy']]) {
    assert.deepEqual(walk([row(9, comm)], { argv: { 9: [comm] } }), boundary(harness, 9));
  }
});
test('ancestry.rs: an_agy_tool_shell_resolves_its_agy_ancestor_without_reading_exe_or_cmdline', () => {
  for (const outer of ['zsh', 'python3']) {
    assert.deepEqual(walk([row(9, 'bash', 8), row(8, 'agy', 7), row(7, outer)]), boundary('agy', 8, 7));
  }
});
test('ancestry.rs: every_relay_ancestry_chain_resolves_as_tasks_expects', () => {
  const corpus = JSON.parse(readFileSync(new URL('./fixtures/ancestry.json', import.meta.url)));
  const expected = {
    'daemon-nearest': boundary('claude-code', 300, 200, 'daemon'),
    'pty-host-nearest': boundary('claude-code', 400, 300, 'bg-pty-host'),
  };
  for (const chain of corpus.chains) {
    const fake = table(chain.rows.map(r => row(r.pid, r.comm, r.ppid)), {
      exe: Object.fromEntries(chain.rows.filter(r => r.exe !== null).map(r => [r.pid, r.exe])),
      argv: Object.fromEntries(chain.rows.filter(r => r.argv !== null).map(r => [r.pid, r.argv])),
    });
    if (chain.name === 'claude-ancestor-under-codex') {
      assert.throws(() => harnessWalk({ startPid: chain.rows[0].pid, processOps: fake.processOps }), { code: 'PROCESS_UNREADABLE' });
    } else {
      const session = chain.rows.find(r => r.pid === chain.session);
      assert.deepEqual(harnessWalk({ startPid: chain.rows[0].pid, processOps: fake.processOps }), expected[chain.name] ?? boundary(chain.harness, session.pid, session.ppid), chain.name);
    }
  }
});

// Real ProcessOps preserves the existing executable/argv parsing boundary.
function linuxOps({ comm = '2.1.3', exe, cmdline = 'claude\0' } = {}) {
  return createProcessOps({ platform: 'linux',
    readText(path) {
      if (path.endsWith('/cmdline')) return cmdline;
      const pid = Number(path.split('/')[2]);
      return `${pid} (${pid === 10 ? 'node' : comm}) S ${pid === 10 ? 9 : 0} ${Array(17).fill(0).join(' ')} 42`;
    },
    readLink() { if (exe === undefined) throw new Error('denied'); return exe; },
  });
}
test('ancestry.rs: an_updated_version_binary_is_still_a_claude_code_boundary', () => {
  assert.deepEqual(harnessWalk({ startPid: 10, processOps: linuxOps({ exe: '/x/claude/versions/2.1.3 (deleted)' }) }), { kind: 'boundary', harness: 'claude-code', pid: 9, ppid: 0, start: '42', role: 'session' });
});
test('ancestry.rs: an_unreadable_or_relative_executable_is_unknown', () => {
  for (const exe of [undefined, 'versions/2.1.3']) assert.throws(() => harnessWalk({ startPid: 10, processOps: linuxOps({ exe }) }), { code: 'PROCESS_UNREADABLE' });
});
test('ancestry.rs: a_version_comm_is_digits_separated_by_dots', () => {
  for (const comm of ['2.1.280', '1.2', '10.0.0.1']) assert.throws(() => walk([row(9, comm)]), { code: 'PROCESS_UNREADABLE' });
  for (const comm of ['2', '2.', '.2', '2..1', 'v2.1', '2.1-rc', '']) assert.deepEqual(walk([row(9, comm, 0)]), { kind: 'outside' });
});
test('ancestry.rs: argv_splits_on_nul_and_drops_one_trailing_nul', () => {
  for (const cmdline of ['claude\0daemon\0', 'claude\0daemon']) assert.equal(harnessWalk({ startPid: 10, processOps: linuxOps({ comm: 'claude', cmdline }) }).role, 'daemon');
  for (const cmdline of ['', 'a\0\0']) assert.equal(harnessWalk({ startPid: 10, processOps: linuxOps({ comm: 'claude', cmdline }) }).role, 'session');
});
test('ancestry.rs: an_ancestry_entry_parses_a_comm_containing_spaces_and_parentheses', () => {
  assert.deepEqual(harnessWalk({ startPid: 10, processOps: linuxOps({ comm: 'weird ) name' }) }), { kind: 'outside' });
});
