const handle = (pid, platform = 'darwin', host = 'Mac-A.local') =>
  ({ platform, host, bootId: platform === 'darwin' ? null : '4f1c2b7e-5c7a-4c9e-8e1a-0e2f3b4c5d6e', pid, start: '1790336000' });
export function passingResults({ platform = 'darwin' } = {}) {
  const retained = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`codex:k${i}`, handle(200 + i, platform)]));
  const cost = (n) => ({ agents: n,
    pretool: { ms: 120, exit: 0, stderr: '', allow: true, retained: true },
    sessionend: { ms: 180, exit: 0, stderr: '', ending_absent: true, revision_delta: 1, others_retained: true } });
  return {
    manifest: { schema: 1, relay_commit: 'a'.repeat(40), ops_commit: 'b'.repeat(40), opencode_pinned: '2.0.15',
      allow_linux: platform !== 'darwin', platform, stages: ['D0','D1','D2','D3','D4','D5','D6','D7','D7b','D8','D9'],
      isolation: { changed: [] }, redaction: { files: {} } },
    stages: {
      D0: { id: 'D0', status: 'ran', observations: {
        platform, sw_vers: { ProductVersion: '15.6', BuildVersion: '24G84' }, arch: 'arm64',
        versions: { node: 'v24.8.0', npm: '11.6.0', git: 'git version 2.50.1', python3: 'Python 3.13.7' },
        clt: '/Library/Developer/CommandLineTools', tz: null, zone: 'America/New_York', columns_exported: false,
        harnesses: { claude: { version: '2.1.282 (Claude Code)', path: '/Users/kh/.local/bin/claude', real: '/Users/kh/.local/share/claude/versions/2.1.282' }, codex: null, opencode: null },
        hosts: { start: { os: 'Mac-A.local', HostName: null, LocalHostName: 'Mac-A', ComputerName: 'Mac A' },
                 end: { os: 'Mac-A.local', HostName: null, LocalHostName: 'Mac-A', ComputerName: 'Mac A' } },
        prerequisites: { macos: platform === 'darwin', node22: true, clt: true, python311: true } } },
      D1: { id: 'D1', status: 'ran', observations: { install: { exit: 0 }, help: { exit: 0 }, list: { exit: 0, json: { snapshot: null, liveness: {} } },
        exports: { STATES: true, createProcessOps: true, dispatchHook: true }, subpaths: { opencode: true, handles: true, ancestry: true } } },
      D2: { id: 'D2', status: 'ran', observations: { exit: 0, summary: { tests: 190, pass: 190, fail: 0, skipped: 0, todo: 0 }, failures: [] } },
      D3: { id: 'D3', status: 'ran', observations: {
        independent: { relay: '1790336000', date: '1790336000' },
        tz_pairs: [['UTC','Pacific/Chatham'],['Pacific/Chatham','UTC'],['','America/New_York'],['America/New_York','']].map(([a,b]) => ({ publish: a, probe: b, status: 'alive' })),
        alive: { status: 'alive', reason: 'qualified process matches' }, dead: { status: 'dead', reason: 'process absent' },
        replaced: { status: 'dead', reason: 'process replaced' }, foreign_host: { status: 'unknown', reason: 'foreign host', host: 'other-host' },
        foreign_platform: { status: 'unknown', reason: 'foreign platform' }, launchd: { valid: true, boot_id_null: true },
        zombie: { status: 'alive', reason: 'qualified process matches' } } },
      D4: { id: 'D4', status: 'ran', observations: {
        chain: { ancestors_match: true, tty_match: true, resolved: 4101, expected: 4101 },
        native: { recognized: true, executable: '/private/tmp/rdp.AbC123/n/claude/versions/9.9.9', executable_absolute: true },
        argv: { expected_argv0: '/private/tmp/rdp.AbC123/sp ace/s h', result: null, error: 'PROCESS_UNREADABLE', ok: true },
        captures: [{ pid: 4101, label: 'chain-claude', truncated: false }, { pid: 4102, label: 'native-claude', truncated: false }, { pid: 4103, label: 'argv-spaces', truncated: false }], comm_kind: 'path',
        table: { rows: 512, over_cut: 40, truncated: 0 } } },
      D5: { id: 'D5', status: 'ran', observations: {
        concurrent: { expected: 8, present: 8, handles_match: true, platforms: ['darwin'], boot_ids_null: true },
        lock: { holder: handle(301, platform), recovered: true, value: 42 },
        reap: { removed: ['codex:p0','codex:p1','codex:p2','codex:p3'], kept: ['codex:p4','codex:p5','codex:p6','codex:p7'],
                expected_removed: ['codex:p0','codex:p1','codex:p2','codex:p3'], expected_kept: ['codex:p4','codex:p5','codex:p6','codex:p7'] },
        cost: { n0: cost(0), n10: cost(10), n50: cost(50) }, retained_example: retained } },
      D6: { id: 'D6', status: 'ran', observations: {
        replies: ['claude-code','codex'].flatMap((h) => ['allow','deny','hang'].map((g) => ({ harness: h, guard: g, exit: g === 'allow' ? 0 : 2, stdout: '{}', expected_exit: g === 'allow' ? 0 : 2, expected_stdout: '{}', match: true }))),
        hang: [{ harness: 'claude-code', ms: 2110, budget_ms: 2000, survivors: [] }, { harness: 'codex', ms: 2105, budget_ms: 2000, survivors: [] }] } },
      D7: { id: 'D7', status: 'ran', observations: {
        'claude-code': { status: 'ran', credentials: 'token', preflight: { allow: true, deny: true }, proven: true,
          hook: { invocations: 3, truncated: false }, handle: { agents: 3, matched: 3, ok: true } },
        codex: { status: 'absent', reason: 'codex not installed' } } },
      D7b: { id: 'D7b', status: 'absent', reason: 'opencode not installed', observations: {} },
      D8: { id: 'D8', status: 'ran', observations: {
        reap: { exit: 0, kept: ['codex:q2','codex:q3'], expected_kept: ['codex:q2','codex:q3'], handles_unchanged: true },
        hook_path: { exit: 0, denied: true, stderr_head: '' } } },
      D9: { id: 'D9', status: 'skipped', reason: 'no terminal', observations: {} },
    },
  };
}
