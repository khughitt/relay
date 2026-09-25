# Darwin Live Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** draft for review, 2026-09-25; revised after the third plan review (stdin only when there is input, EPIPE handled; the interrupt test observes an early exit) and the second (stop-first cleanup, owned-group signalling with a sweeper and survivor report, verdicts free of stage text and exported redacted, session-bound D7 identity) and the first (registry paths, process-group cleanup, D9 argument stripping, tolerant finalization, a stricter judge, bundle verification, `planHooks` for D8, hook-ancestry identity in D7, structural JSON redaction).

**Goal:** Build the bundle, live probe and judge that `docs/specs/2026-09-25-darwin-probe.md`
specifies, prove it end to end on the Linux host, and hand the user a bundle to run on
their Mac. Closing `relay-b12132` needs the user's run and an accepted verdict; this plan
ends at the handoff and the judging recipe.

**Architecture:** Everything lives under `tools/darwin-probe/`, outside the published
package's `files`:
- one stage module per check writes raw observations into a results directory;
- a pure judge turns results into verdicts;
- a pure redactor rewrites text before packing;
- `probe.mjs` orchestrates the stages;
- a POSIX `run` script is the Mac entry point;
- `bundle.mjs` builds the tarball on the Linux host;
- `judge-cli.mjs` re-judges a returned tarball and writes the runbook.

Stage modules share four small libraries: isolation and process tracking, `ps` capture,
constructed harness parents, and a timed hook runner. One ops change lets the guard
probe take a Claude token instead of a credentials file.

**Tech Stack:** Node >= 22 (ES modules, built-ins only, `node:test`), POSIX `sh`, BSD and
procps `ps`, Git bundles, ops `bin/relay-guard-probe` (Python >= 3.11).

**Spec:** `docs/specs/2026-09-25-darwin-probe.md` (approved at `925dc7f`). Parent: ops
`docs/specs/2026-09-16-relay-design.md`.

## Global Constraints

- Node >= 22, ES modules, Node built-ins only; no new npm dependency. `package.json`
  `files` does not change, so nothing under `tools/` ships.
- The probe never patches relay: stages run relay's committed code from the clone or the
  installed tarball.
- Every file the probe writes lives under one root, `$TMPDIR/relay-darwin-probe.XXXXXX`.
  Every child process gets `RELAY_STATE_DIR`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`,
  `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` inside it.
- Every child the probe starts leads its own process group, owned by the tracker.
  `<root>/pids` lists only the groups still owned, as `-pgid`. Cleanup sends `SIGKILL` to
  each group and waits until it is empty. `run`'s trap on `EXIT`, `INT` and `TERM` repeats
  that for anything listed, then removes the root, keeping only the results tarball.
- Every registry read, list or reap goes through `registryFor(clone, env)`, which passes
  `paths(env)`. Relay's registry functions ignore an `env` option and fall back to the
  ambient default. The probe process also replaces its own `process.env` with the isolated
  environment at startup.
- The Mac prerequisites are macOS, Node >= 22, the Xcode Command Line Tools
  (`xcode-select -p`), and `python3` >= 3.11.
- Checks fall into three classes. A **release gate** blocks `relay-c19c0a`. **Cutover
  evidence** feeds `ai-539508`. A **finding** is reported and does not gate.
- Redaction:
  - each distinct host string becomes `<host-N>`, numbered in order of first appearance;
  - `/Users/<name>` becomes `/Users/<user>`, and any other occurrence of the user name
    becomes `<user>`;
  - booleans and numbers are never altered;
  - the mapping never leaves the Mac.
- A results tarball is accepted only when the verdict over the raw results, the verdict
  over the redacted results on the Mac, and the Linux host's verdict are identical, check
  by check.
- OpenCode is pinned to **v2.0.15**, verified on the Linux host on 2026-09-25:
  - authentication is HTTP Basic, user `opencode`, with the password taken from
    `OPENCODE_SERVER_PASSWORD`;
  - the project-instance request is `GET /api/plugin?location[directory]=<absolute
    project dir>`, which answers `{"location":{"directory":<dir>},"data":[…]}`;
  - `x-opencode-directory` is the equivalent header, and `/api/session` is not scoped by
    location;
  - the plugin-load outcome is logged in `$XDG_DATA_HOME/opencode/log/opencode.log` as
    `loading plugin`, `failed to load plugin`, or `configured plugin path must be a
    directory`.
- Tracked files never contain the Linux host's name or a home path; `just check` rejects
  both.

**Known before the run:** at v2.0.15, OpenCode drops the plugin file path that relay
writes ("configured plugin path must be a directory"). A directory wrapper fails too,
with "Plugin must export a default definition with an id and an effect or setup
function". Relay's OpenCode integration therefore does not load on OpenCode v2; this is
filed as `relay-d0a8df`. D7b still runs and records that outcome. Its cutover verdict
fails until `relay-d0a8df` lands. It is not a release gate.

**Clarification of the spec's isolation list.** The spec's watched paths name `~/.claude`
and `~/.codex`, but D9 invites the user to keep live sessions open, and those sessions
legitimately write transcripts under `~/.claude/projects` and `~/.codex/sessions`. So the
probe fingerprints:
- the configuration and credential files there: `~/.claude/settings.json`,
  `~/.claude/settings.local.json`, `~/.claude/.credentials.json`, `~/.codex/hooks.json`,
  `~/.codex/config.toml` and `~/.codex/auth.json`;
- whole trees for `~/.config/relay`, `~/.local/state/relay`, `~/.config/opencode`,
  `~/.local/share/opencode` and `~/.cache/opencode`.

`run` asks the user to close OpenCode during the probe.

## Review Focus

1. **Live state reached through an ambient default.** A registry call without explicit
   `paths` would read or reap the user's live registry. Task 4 pins `registryFor` against
   an ambient `RELAY_STATE_DIR`, and Task 10 isolates the probe's own environment.
2. **Ctrl-C while descendants run.** The user presses Ctrl-C during D7 while Python, a
   harness and hook processes are running, after a normally completed D0. The probe must
   pack results with D0's end reading and leave no descendant. Task 4 pins group cleanup
   with grandchildren, and Task 10 pins interruption after a real D0.
3. **A live Claude session writing during the run.** A session the user opened for D9
   writes under `~/.claude`. The isolation guard must not fail the attempt for that. Task 4
   pins the watched set.
4. **A user's prompt in ambient process arguments.** No argument text from the user's
   sessions may leave the Mac. Task 9 pins `argSummary` and `stripCapture`.
5. **A user name that collides with JSON or common text** (`true`, `sh`). Packed JSON must
   stay valid and verdicts unchanged. Task 2 pins structural redaction and verdict
   invariance.

---

## Results contract

Stages, judge, redactor and CLI all read and write this layout. The version field is
`schema: 1`.

```
results/
  manifest.json          {schema, relay_commit, ops_commit, opencode_pinned, allow_linux,
                          platform, started, finished, stages: [ids run],
                          isolation: {before, after, changed: [paths]},
                          redaction: {files: {"<path>": {host, user, home}}}}
  stages/<ID>.json       {id, status: "ran"|"absent"|"skipped"|"error", reason?, observations}
  logs/<ID>.log          stderr and command transcripts per stage
  verdict.raw.json       judge(raw results)        — written on the Mac before redaction
  verdict.redacted.json  judge(redacted results)   — written on the Mac after redaction
```

`judge(results)` returns:

```json
{"schema":1,"release":"pass"|"fail"|"incomplete"|"smoke",
 "checks":{"D0":{"class":"release","verdict":"pass"|"fail"|"absent"|"skipped","detail":"…","findings":["…"]}, "…":{}},
 "cutover":{"claude-code":"pass"|"fail"|"absent","codex":"…","opencode":"…","launchd-path":"…"}}
```

`release` is:
- `smoke` when `manifest.allow_linux` is true;
- `incomplete` when any release check is missing or `error`;
- `pass` only when D0, D1, D2, D3, D4, D5, D6 and D8's `reap` part all pass;
- `fail` otherwise.

---

### Task 1: Guard probe accepts a Claude token (ops)

Work in an ops worktree `.worktrees/darwin-token` (branch `darwin-token`), created and
locked by the global worktree rule. The bundle in Task 11 records the ops commit this task
lands.

**Files:**
- Modify: ops `bin/relay-guard-probe` (`main`, a new `credentials_mode`)
- Test: ops `tests/test_relay_guard_probe.py`

**Interfaces:**
- Produces: `credentials_mode(harness, env) -> "token" | "file"`. `results.json` gains
  `"credentials": "token"|"file"`. With the credentials file missing and no token, the
  probe exits with the message `missing ~/<source>; for claude-code set
  CLAUDE_CODE_OAUTH_TOKEN (claude setup-token)` rather than a traceback.

- [ ] **Step 1: Write the failing test** (append to `EvidenceTests` in `tests/test_relay_guard_probe.py`)

```python
    def test_credentials_mode_uses_a_claude_token_only_when_set(self):
        self.assertEqual(probe.credentials_mode("claude-code", {"CLAUDE_CODE_OAUTH_TOKEN": "t"}), "token")
        self.assertEqual(probe.credentials_mode("claude-code", {"CLAUDE_CODE_OAUTH_TOKEN": ""}), "file")
        self.assertEqual(probe.credentials_mode("claude-code", {}), "file")
        self.assertEqual(probe.credentials_mode("codex", {"CLAUDE_CODE_OAUTH_TOKEN": "t"}), "file")

    def test_missing_credentials_without_a_token_is_an_explicit_exit(self):
        with self.assertRaises(SystemExit) as caught:
            probe.require_credentials(pathlib.Path(self.base) / "absent.json", "claude-code")
        self.assertIn("CLAUDE_CODE_OAUTH_TOKEN", str(caught.exception))
```

- [ ] **Step 2: Run it to see it fail**

Run: `python3 -m pytest -q tests/test_relay_guard_probe.py -k credentials`
Expected: FAIL with `AttributeError: module ... has no attribute 'credentials_mode'`

- [ ] **Step 3: Implement**

Add after `CREDENTIALS`:

```python
def credentials_mode(harness, env):
    """Claude Code on macOS keeps its login in the Keychain, where no file can be copied;
    a `claude setup-token` token passed through the environment replaces the copy."""
    return "token" if harness == "claude-code" and env.get("CLAUDE_CODE_OAUTH_TOKEN") else "file"


def require_credentials(path, harness):
    if not pathlib.Path(path).is_file():
        hint = "; for claude-code set CLAUDE_CODE_OAUTH_TOKEN (claude setup-token)" if harness == "claude-code" else ""
        raise SystemExit(f"missing {path}{hint}")
    return path
```

In `main`, replace the `with Credentials(...)` line and record the mode:

```python
    mode = credentials_mode(args.harness, os.environ)
    summary["credentials"] = mode
    ...
        copy = contextlib.nullcontext() if mode == "token" else Credentials(require_credentials(home / source, args.harness),
                                                                            config / pathlib.Path(source).name)
        with copy:
```

`relay_env` already copies `os.environ`, so the token reaches `claude`.

- [ ] **Step 4: Run tests and gates**

Run: `python3 -m pytest -q tests/test_relay_guard_probe.py && just test-fast && just check`
Expected: all pass, check clean.

- [ ] **Step 5: Commit, merge to ops main**

```bash
git add bin/relay-guard-probe tests/test_relay_guard_probe.py
git commit -m "feat(bin): let relay-guard-probe run Claude Code from a setup token"
```

Fast-forward ops main to this branch, then remove the worktree using the unlock-then-remove
convention. Record the ops commit in a note on `relay-b12132`.

---

### Task 2: Redaction

**Files:**
- Create: `tools/darwin-probe/redact.mjs`
- Create: `test/helpers/darwin-results.js` (fixture factory, shared with Task 3)
- Test: `test/darwin-probe-redact.test.js`

**Interfaces:**
- Produces:
  - `collectHosts(results) -> string[]`: distinct host strings in canonical order. It reads
    D0's `hosts.start` fields (`os`, `HostName`, `LocalHostName`, `ComputerName`), then
    `hosts.end`, then every value under a JSON key named `host`, walking the stages in id
    order. `null` is skipped.
  - `redactionMap({hosts, user, home}) -> {hosts: Map<string,string>, user, home}`.
  - `redactText(text, map) -> {text, counts: {host, user, home}}`.
  - `redactValue(value, map, counts)`: a deep copy in which string *values* are redacted.
    Object keys, numbers, booleans and `null` are untouched.
  - `redactFile(path, map) -> {text, counts}`: a `.json` file is parsed, redacted with
    `redactValue`, and re-serialized. Any other file is redacted as text. Packing uses
    this, so a user name such as `true` can never rewrite a JSON literal.
- `passingResults({platform='darwin'})` returns an in-memory results object
  `{manifest, stages: {D0..D9}}` whose every check passes. Task 3 and Task 10 use it.

- [ ] **Step 1: Write the fixture factory** (`test/helpers/darwin-results.js`)

```js
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
        native: { recognized: true, executable: '/private/var/folders/x/relay-darwin-probe.1/n/claude/versions/9.9.9', executable_absolute: true },
        argv: { expected_argv0: '/private/var/folders/x/relay-darwin-probe.1/sp ace/s h', result: null, error: 'PROCESS_UNREADABLE', ok: true },
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
```

- [ ] **Step 2: Write the failing tests** (`test/darwin-probe-redact.test.js`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectHosts, redactFile, redactionMap, redactText, redactValue } from '../tools/darwin-probe/redact.mjs';
import { judge } from '../tools/darwin-probe/judge.mjs';
import { passingResults } from './helpers/darwin-results.js';

test('distinct hosts keep distinct tokens, ordered by first appearance', () => {
  const r = passingResults();
  r.stages.D0.observations.hosts.end.os = 'Mac-B.local';
  const hosts = collectHosts(r);
  assert.deepEqual(hosts, ['Mac-A.local', 'Mac-A', 'Mac A', 'Mac-B.local', 'other-host']);
  const map = redactionMap({ hosts, user: 'kh', home: '/Users/kh' });
  const out = redactValue(r, map, { host: 0, user: 0, home: 0 });
  assert.equal(out.stages.D0.observations.hosts.start.os, '<host-1>');
  assert.equal(out.stages.D0.observations.hosts.end.os, '<host-4>');
  assert.equal(out.stages.D3.observations.foreign_host.host, '<host-5>');
});
test('the home path stays absolute and booleans and numbers are untouched', () => {
  const map = redactionMap({ hosts: [], user: 'kh', home: '/Users/kh' });
  const { text, counts } = redactText('/Users/kh/.local/bin/claude and kh', map);
  assert.equal(text, '/Users/<user>/.local/bin/claude and <user>');
  assert.deepEqual(counts, { host: 0, user: 1, home: 1 });
  const v = redactValue({ a: true, b: 42, c: null, d: '/Users/kh' }, map, { host: 0, user: 0, home: 0 });
  assert.deepEqual(v, { a: true, b: 42, c: null, d: '/Users/<user>' });
});
test('a longer host is replaced before a host it contains', () => {
  const map = redactionMap({ hosts: ['Mac-A', 'Mac-A.local'], user: 'kh', home: '/Users/kh' });
  assert.equal(redactText('Mac-A.local Mac-A', map).text, '<host-2> <host-1>');
});
test('JSON files are redacted structurally: a user named true leaves literals and keys intact', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dpr-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const file = join(d, 'D5.json');
  writeFileSync(file, JSON.stringify({ true: true, ok: false, n: 3, who: 'true', home: '/Users/true/x' }));
  const out = JSON.parse(redactFile(file, redactionMap({ hosts: [], user: 'true', home: '/Users/true' })).text);
  assert.deepEqual(out, { true: true, ok: false, n: 3, who: '<user>', home: '/Users/<user>/x' });
});
test('an over-matching user name never changes a verdict', () => {
  const r = passingResults();
  const map = redactionMap({ hosts: collectHosts(r), user: 'sh', home: '/Users/sh' });
  assert.deepEqual(judge(redactValue(r, map, { host: 0, user: 0, home: 0 })), judge(r));
});
```

- [ ] **Step 3: Run to see it fail**

Run: `node --test test/darwin-probe-redact.test.js`
Expected: FAIL, `Cannot find module '../tools/darwin-probe/redact.mjs'` (and `judge.mjs`: Task 3; to run this test alone first, stub `judge.mjs` with `export const judge = (r) => ({})` and replace the stub in Task 3).

- [ ] **Step 4: Implement** (`tools/darwin-probe/redact.mjs`)

```js
import { readFileSync } from 'node:fs';
// Redaction for results that leave the Mac. Numbers, booleans and null are never altered:
// every fact that depends on a raw string (lengths, absoluteness, equality) is recorded as
// one of those at capture time, so a verdict never depends on redacted text.
const HOST_KEYS = ['os', 'HostName', 'LocalHostName', 'ComputerName'];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function collectHosts(results) {
  const seen = [], add = (v) => { if (typeof v === 'string' && v && !seen.includes(v)) seen.push(v); };
  const hosts = results.stages.D0?.observations?.hosts ?? {};
  for (const when of ['start', 'end']) for (const key of HOST_KEYS) add(hosts[when]?.[key]);
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'host') add(x); walk(x); }
  };
  for (const id of Object.keys(results.stages).sort()) walk(results.stages[id]);
  return seen;
}
export function redactionMap({ hosts, user, home }) {
  return { hosts: new Map(hosts.map((h, i) => [h, `<host-${i + 1}>`])), user, home };
}
export function redactText(text, map) {
  const counts = { host: 0, user: 0, home: 0 };
  let out = text;
  if (map.home) out = out.replace(new RegExp(escape(map.home), 'g'), () => { counts.home++; return map.home.replace(/[^/]+$/, '<user>'); });
  for (const host of [...map.hosts.keys()].sort((a, b) => b.length - a.length))
    out = out.replace(new RegExp(escape(host), 'g'), () => { counts.host++; return map.hosts.get(host); });
  if (map.user) out = out.replace(new RegExp(`(?<![A-Za-z0-9_<-])${escape(map.user)}(?![A-Za-z0-9_>-])`, 'g'), () => { counts.user++; return '<user>'; });
  return { text: out, counts };
}
export function redactValue(value, map, counts) {
  if (typeof value === 'string') {
    const r = redactText(value, map);
    for (const k of Object.keys(counts)) counts[k] += r.counts[k];
    return r.text;
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, map, counts));
  // Keys are schema (check ids, agent ids, field names), never host or user text.
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, map, counts)]));
  return value;
}
export function redactFile(path, map) {
  const text = readFileSync(path, 'utf8');
  if (!path.endsWith('.json')) return redactText(text, map);
  const counts = { host: 0, user: 0, home: 0 };
  return { text: `${JSON.stringify(redactValue(JSON.parse(text), map, counts), null, 2)}\n`, counts };
}
```

- [ ] **Step 5: Run to see it pass**

Run: `node --test test/darwin-probe-redact.test.js`
Expected: PASS (4 tests; the invariance test passes against the Task 3 stub only trivially and is re-run in Task 3)

- [ ] **Step 6: Commit**

```bash
git add tools/darwin-probe/redact.mjs test/helpers/darwin-results.js test/darwin-probe-redact.test.js
git commit -m "feat(tools): redact Darwin probe results without touching facts"
```

---

### Task 3: Judge

**Files:**
- Create: `tools/darwin-probe/judge.mjs` (replaces any Task 2 stub)
- Test: `test/darwin-probe-judge.test.js`

**Interfaces:**
- Consumes: the results contract; `passingResults()` from Task 2.
- Produces: `judge(results) -> verdict` (shape in "Results contract");
  `RELEASE = ['D0','D1','D2','D3','D4','D5','D6','D8']`. There are two derived release
  checks. `ISO` requires `manifest.isolation.changed` to be an empty array. `D7w` fails
  when live-harness hook ancestry was truncated as relay reads it.
- A rule that meets missing or malformed observations returns verdict `error`, and never
  throws. Verdicts never copy free text from observations: not `stage.reason`, not an
  exception message. An errored stage's detail is `stage <status>`. The reason stays in
  the stage file, which is redacted like every other results file. `error`, `missing` and `skipped` release checks make the release `incomplete`.
- Cutover values are `pass`, `fail`, `absent` (the harness is not installed), `skipped`
  (installed but not run, for example no credentials), and `error` (the stage failed).

- [ ] **Step 1: Write the failing tests** (`test/darwin-probe-judge.test.js`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../tools/darwin-probe/judge.mjs';
import { passingResults } from './helpers/darwin-results.js';

const mutate = (f) => { const r = structuredClone(passingResults()); f(r); return judge(r); };
test('a complete passing Darwin run passes the release', () => {
  const v = judge(passingResults());
  assert.equal(v.release, 'pass');
  assert.equal(v.cutover['claude-code'], 'pass');
  assert.equal(v.cutover.codex, 'absent');
  assert.equal(v.cutover.opencode, 'absent');
});
test('a Linux smoke run never reports a release pass', () => {
  assert.equal(judge(passingResults({ platform: 'linux' })).release, 'smoke');
});
test('each release check fails the release on its own', () => {
  const cases = {
    D0: (r) => { r.stages.D0.observations.prerequisites.clt = false; },
    D1: (r) => { r.stages.D1.observations.exports.dispatchHook = false; },
    D2: (r) => { r.stages.D2.observations.summary.fail = 1; },
    D3: (r) => { r.stages.D3.observations.tz_pairs[1].status = 'dead'; },
    D4: (r) => { r.stages.D4.observations.captures[0].truncated = true; },
    D5: (r) => { r.stages.D5.observations.lock.recovered = false; },
    D6: (r) => { r.stages.D6.observations.hang[0].survivors = [77]; },
    D8: (r) => { r.stages.D8.observations.reap.handles_unchanged = false; },
  };
  for (const [id, f] of Object.entries(cases)) {
    const v = mutate(f);
    assert.equal(v.checks[id].verdict, 'fail', id);
    assert.equal(v.release, 'fail', id);
  }
});
test('a fast but failed SessionEnd fails D5', () => {
  for (const f of [(c) => { c.exit = 1; }, (c) => { c.stderr = 'DEADLINE_EXCEEDED: registry'; }, (c) => { c.ending_absent = false; }, (c) => { c.others_retained = false; }, (c) => { c.revision_delta = 0; }, (c) => { c.ms = 3001; }])
    assert.equal(mutate((r) => f(r.stages.D5.observations.cost.n10.sessionend)).checks.D5.verdict, 'fail');
});
test('the 50-agent timings are a finding, not a gate', () => {
  const v = mutate((r) => { r.stages.D5.observations.cost.n50.sessionend.ms = 9000; });
  assert.equal(v.checks.D5.verdict, 'pass');
  assert.ok(v.checks.D5.findings.some((f) => f.includes('50 agents')));
});
test('a missing or errored release stage makes the release incomplete', () => {
  assert.equal(mutate((r) => { delete r.stages.D3; }).release, 'incomplete');
  assert.equal(mutate((r) => { r.stages.D5 = { id: 'D5', status: 'error', reason: 'boom', observations: {} }; }).release, 'incomplete');
});
test('cutover evidence never changes the release', () => {
  const v = mutate((r) => { r.stages.D7.observations['claude-code'].proven = false; r.stages.D8.observations.hook_path.denied = false; });
  assert.equal(v.release, 'pass');
  assert.equal(v.cutover['claude-code'], 'fail');
  assert.equal(v.cutover['launchd-path'], 'fail');
});
test('findings are reported: host drift, unset HostName, zombie, comm kind', () => {
  const v = mutate((r) => { r.stages.D0.observations.hosts.end.os = 'Mac-B.local'; });
  assert.ok(v.checks.D0.findings.some((f) => f.includes('host changed')));
  assert.ok(v.checks.D0.findings.some((f) => f.includes('HostName is not set')));
  assert.ok(v.checks.D3.findings.some((f) => f.includes('zombie')));
  assert.ok(v.checks.D4.findings.some((f) => f.includes('comm')));
});
test('requirements the first draft missed each fail on their own', () => {
  assert.equal(mutate((r) => { r.stages.D4.observations.native.recognized = false; }).checks.D4.verdict, 'fail');
  const iso = mutate((r) => { r.manifest.isolation.changed = ['.config/relay']; });
  assert.equal(iso.checks.ISO.verdict, 'fail'); assert.equal(iso.release, 'fail');
  assert.equal(mutate((r) => { r.stages.D6.observations = { replies: [], hang: [] }; }).checks.D6.verdict, 'fail');
  const trunc = mutate((r) => { r.stages.D7.observations['claude-code'].hook.truncated = true; });
  assert.equal(trunc.checks.D7w.verdict, 'fail'); assert.equal(trunc.release, 'fail');
});
test('partial observations are an error verdict, never a throw', () => {
  const v = mutate((r) => { r.stages.D0.observations.hosts.end = null; delete r.stages.D6.observations.hang; });
  assert.equal(v.checks.D0.verdict, 'error'); assert.equal(v.checks.D6.verdict, 'error'); assert.equal(v.release, 'incomplete');
});
test('verdicts never carry stage text', () => {
  const v = mutate((r) => {
    r.stages.D5 = { id: 'D5', status: 'error', reason: 'Error: EACCES /Users/alice/private-directory on Mac-A.local', observations: {} };
    r.stages.D6.observations = { replies: null };
  });
  const text = JSON.stringify(v);
  assert.equal(text.includes('/Users/alice'), false); assert.equal(text.includes('Mac-A'), false);
  assert.equal(v.checks.D5.detail, 'stage error'); assert.equal(v.checks.D6.detail, 'malformed observations');
});
test('execution failures are distinct from absent harnesses', () => {
  assert.equal(mutate((r) => { r.stages.D7b = { id: 'D7b', status: 'error', reason: 'boom', observations: {} }; }).cutover.opencode, 'error');
  assert.equal(mutate((r) => { r.stages.D7.observations.codex = { status: 'skipped', reason: 'no credentials' }; }).cutover.codex, 'skipped');
  assert.equal(mutate((r) => { r.stages.D7 = { id: 'D7', status: 'error', reason: 'boom', observations: {} }; }).cutover['claude-code'], 'error');
});
test('D7b fails its cutover when the plugin is rejected or the version is not the pinned one', () => {
  const ran = (o) => mutate((r) => { r.stages.D7b = { id: 'D7b', status: 'ran', observations: { version: '2.0.15', version_match: true, install: { exit: 0 },
    request: { status: 200, directory_match: true }, plugin_log: 'loaded', appeared: true, agent: { count: 1, scope: 'process', matches_server: true },
    after: { gone: true, via: 'dispose' }, ...o } }; }).cutover.opencode;
  assert.equal(ran({}), 'pass');
  assert.equal(ran({ plugin_log: 'rejected-file', appeared: false, agent: { count: 0 } }), 'fail');
  assert.equal(ran({ version: '2.1.0', version_match: false }), 'fail');
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test test/darwin-probe-judge.test.js`
Expected: FAIL (`judge` is the stub or missing).

- [ ] **Step 3: Implement** (`tools/darwin-probe/judge.mjs`)

```js
// Pure verdicts over the results contract (docs/plans/2026-09-25-darwin-probe.md). Every rule
// reads recorded observations only; nothing here touches the filesystem or a process.
export const RELEASE = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D8'];
const SESSIONEND_BUDGET_MS = 3000;
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const result = (ok, detail, findings = []) => ({ verdict: ok ? 'pass' : 'fail', detail, findings });

const rules = {
  D0(o) {
    const findings = [];
    if (o.hosts.start.HostName === null) findings.push('HostName is not set: the host name can change with the network (spec item 4)');
    if (o.hosts.start.os !== o.hosts.end.os) findings.push('host changed during the run');
    if (o.columns_exported) findings.push('COLUMNS is exported in the user environment');
    const missing = Object.entries(o.prerequisites).filter(([k, v]) => !v && !(k === 'macos' && o.platform !== 'darwin')).map(([k]) => k);
    return result(missing.length === 0, missing.length ? `missing prerequisites: ${missing.join(', ')}` : 'environment recorded', findings);
  },
  D1(o) {
    const bad = [['install', o.install.exit], ['help', o.help.exit], ['list', o.list.exit]].filter(([, e]) => e !== 0).map(([n]) => n)
      .concat(Object.entries({ ...o.exports, ...o.subpaths }).filter(([, v]) => v !== true).map(([n]) => `export ${n}`));
    return result(bad.length === 0 && Object.keys(o.exports).length > 0, bad.length ? `failed: ${bad.join(', ')}` : 'package installs offline and loads');
  },
  D2(o) {
    return result(o.exit === 0 && o.summary.fail === 0 && o.summary.tests > 0, `${o.summary.pass}/${o.summary.tests} passed, ${o.summary.skipped} skipped`,
      o.failures.map((f) => `failed test: ${f}`));
  },
  D3(o) {
    const expect = [[o.alive, 'alive'], [o.dead, 'dead'], [o.replaced, 'dead'], [o.foreign_host, 'unknown'], [o.foreign_platform, 'unknown']];
    const ok = o.independent.relay === o.independent.date && o.tz_pairs.length === 4 && o.tz_pairs.every((p) => p.status === 'alive')
      && expect.every(([v, s]) => v.status === s) && o.launchd.valid && o.launchd.boot_id_null;
    return result(ok, ok ? 'identity agrees across readers and zones' : 'identity mismatch (see observations)',
      [`zombie child reads ${o.zombie.status} (${o.zombie.reason}) (spec item 5)`]);
  },
  D4(o) {
    const truncated = o.captures.filter((c) => c.truncated).map((c) => c.label);
    const ok = o.captures.length >= 3 && o.chain.ancestors_match && o.chain.tty_match && o.chain.resolved === o.chain.expected
      && o.native.recognized && o.native.executable_absolute && o.argv.ok && truncated.length === 0;
    return result(ok, truncated.length ? `ps truncated relay's capture of ${truncated.join(', ')} (spec item 1)` : ok ? 'table, ancestry and arguments agree' : 'ancestry, recognition or argument mismatch',
      [`Darwin comm holds the ${o.comm_kind === 'path' ? 'executable path' : o.comm_kind === 'argv0' ? 'argv[0]' : 'unexpected value'} (spec item 2)`,
       `process table: ${o.table.rows} rows, ${o.table.over_cut} past the cut, ${o.table.truncated} truncated as relay reads it`]);
  },
  D5(o) {
    const c = o.concurrent, r = o.reap, s = o.cost.n10.sessionend, p = o.cost.n10.pretool;
    const darwin = c.platforms.length === 1 && c.platforms[0] === 'darwin' && c.boot_ids_null;
    const sessionEnd = s.exit === 0 && s.stderr === '' && s.ms <= SESSIONEND_BUDGET_MS && s.ending_absent && s.revision_delta === 1 && s.others_retained;
    const preTool = p.exit === 0 && p.stderr === '' && p.allow && p.retained;
    const ok = c.expected === 8 && c.present === 8 && c.handles_match && o.lock.recovered && r.expected_removed.length === 4
      && same(r.removed, r.expected_removed) && same(r.kept, r.expected_kept) && sessionEnd && preTool && (o.platform !== 'darwin' || darwin);
    const n50 = o.cost.n50;
    return result(ok, ok ? 'registry, lock, reap and hook cost hold' : 'registry, lock, reap or hook cost failed',
      [`50 agents: PreToolUse ${n50.pretool.ms} ms, SessionEnd ${n50.sessionend.ms} ms (exit ${n50.sessionend.exit})`]);
  },
  D6(o) {
    const ok = o.replies.length === 6 && o.replies.every((r) => r.match) && o.hang.length === 2
      && o.hang.every((h) => h.survivors.length === 0 && h.ms < h.budget_ms + 3000);
    return result(ok, ok ? 'replies match the Linux replay; hung guards refused and gone' : 'dispatch replay incomplete, mismatched, or a guard survived');
  },
  D8(o) {
    const ok = o.reap.exit === 0 && o.reap.expected_kept.length === 2 && same(o.reap.kept, o.reap.expected_kept) && o.reap.handles_unchanged;
    return result(ok, ok ? 'reap in a launchd-like environment keeps exactly the live agents' : 'reap in a minimal environment failed');
  },
};
const guarded = (fn, o) => { try { return fn(o); } catch { return { verdict: 'error', detail: 'malformed observations', findings: [] }; } };

function cutoverHarness(stage, name) {
  if (!stage) return 'missing';
  if (stage.status !== 'ran') return stage.status === 'absent' ? 'absent' : stage.status === 'skipped' ? 'skipped' : 'error';
  const o = stage.observations[name];
  if (!o) return 'error';
  if (o.status !== 'ran') return o.status === 'absent' ? 'absent' : o.status === 'skipped' ? 'skipped' : 'error';
  try { return o.preflight.allow && o.preflight.deny && o.proven === true && o.handle.ok === true ? 'pass' : 'fail'; } catch { return 'error'; }
}
function cutoverOpencode(stage) {
  if (!stage) return 'missing';
  if (stage.status !== 'ran') return stage.status === 'absent' ? 'absent' : stage.status === 'skipped' ? 'skipped' : 'error';
  try {
    const o = stage.observations;
    return o.version_match && o.install.exit === 0 && o.request.status === 200 && o.request.directory_match && o.plugin_log === 'loaded' && o.appeared
      && o.agent.count === 1 && o.agent.scope === 'process' && o.agent.matches_server && o.after.gone ? 'pass' : 'fail';
  } catch { return 'error'; }
}
// Confirmed truncation in a live hook's own ancestry is the spec's item-1 defect and blocks
// the release like D4's constructed chain; no live evidence leaves D4 as the width check.
function liveWidth(stage) {
  const ran = stage?.status === 'ran' ? Object.entries(stage.observations).filter(([, o]) => o?.status === 'ran' && o.hook) : [];
  const cut = ran.filter(([, o]) => o.hook.truncated === true).map(([h]) => h);
  if (!ran.length) return { verdict: 'pass', detail: 'no live hook ancestry recorded; D4 carries the width check', findings: [] };
  return result(cut.length === 0, cut.length ? `ps truncated live hook ancestry for ${cut.join(', ')} (spec item 1)` : 'live hook ancestry read in full');
}

export function judge(results) {
  const checks = {};
  const platform = results.manifest.platform;
  for (const id of RELEASE) {
    const stage = results.stages[id];
    if (!stage) { checks[id] = { class: 'release', verdict: 'missing', detail: 'stage did not run', findings: [] }; continue; }
    // Never stage.reason: it can carry raw paths and host names, and verdicts are exported.
    if (stage.status !== 'ran') { checks[id] = { class: 'release', verdict: stage.status === 'skipped' ? 'skipped' : 'error', detail: `stage ${stage.status}`, findings: [] }; continue; }
    const observations = id === 'D5' ? { ...stage.observations, platform } : stage.observations;
    checks[id] = { class: 'release', ...guarded(rules[id], observations) };
  }
  const changed = results.manifest.isolation?.changed;
  checks.ISO = { class: 'release', ...(Array.isArray(changed) ? result(changed.length === 0, changed.length ? `live paths changed: ${changed.join(', ')}` : 'no live path changed')
    : { verdict: 'error', detail: 'isolation fingerprints missing', findings: [] }) };
  checks.D7w = { class: 'release', ...liveWidth(results.stages.D7) };
  const d8 = results.stages.D8?.status === 'ran' ? results.stages.D8.observations.hook_path : null;
  const cutover = { 'claude-code': cutoverHarness(results.stages.D7, 'claude-code'), codex: cutoverHarness(results.stages.D7, 'codex'),
    opencode: cutoverOpencode(results.stages.D7b), 'launchd-path': d8 ? (d8.denied === true ? 'pass' : 'fail') : 'error' };
  const verdicts = Object.values(checks).map((c) => c.verdict);
  const release = results.manifest.allow_linux ? 'smoke'
    : verdicts.some((v) => !['pass', 'fail'].includes(v)) ? 'incomplete'
    : verdicts.every((v) => v === 'pass') ? 'pass' : 'fail';
  return { schema: 1, release, checks, cutover };
}
```

Note: the D0 prerequisite waiver for `macos` applies only to a Linux smoke run, where
`platform` is `linux`.

- [ ] **Step 4: Run both test files**

Run: `node --test test/darwin-probe-judge.test.js test/darwin-probe-redact.test.js`
Expected: PASS (all). The `passingResults` D4 fixture needs `comm_kind: 'path'` and D3
`zombie` present; both are set in Task 2's factory.

- [ ] **Step 5: Commit**

```bash
git add tools/darwin-probe/judge.mjs test/darwin-probe-judge.test.js
git commit -m "feat(tools): judge Darwin probe results into release and cutover verdicts"
```

---

### Task 4: Probe runtime: isolation, tracking, `ps` capture, constructed parents, timed hooks

**Files:**
- Create: `tools/darwin-probe/lib/context.mjs`
- Create: `tools/darwin-probe/lib/ps.mjs`
- Create: `tools/darwin-probe/lib/parents.mjs`
- Create: `tools/darwin-probe/lib/timed-hook.mjs`
- Test: `test/darwin-probe-runtime.test.js`

**Interfaces:**
- Produces (`context.mjs`):
  - `isolatedEnv(root, base=process.env) -> env`: removes `COLUMNS` and the harness
    session variables, and sets the seven isolation variables.
  - `prepareRoot(root)`: creates `xdg/relay` (0700), `relay-state` (0700), and `state`,
    `data`, `cache`, `claude`, `codex`.
  - `tracker(root) -> {spawn(cmd,args,opts), fork(module,args,opts), run(cmd,args,{env,cwd,input,timeoutMs,argv0}) -> Promise<{exit,signal,stdout,stderr,ms}>, kill(pgid) -> Promise<void>, stop() -> void, stopping: boolean, killAll() -> Promise<{survivors: number[]}>}`.
    Ownership rules:
    - `kill(pgid)` signals only a group the tracker still owns, so a second kill of the
      same group is a no-op.
    - A sweeper checks every owned group every 250 ms and retires it once
      `kill(-pgid, 0)` reports `ESRCH`, whether or not its leader has exited.
    - After `stop()`, `spawn`, `fork` and `run` throw `Error('probe is stopping')`.
    - `killAll()` repeats until the tracker owns nothing or 10 s pass, and returns the
      groups still alive as `survivors`. `probe.mjs` records them in the manifest and
      prints them.
    Every child is spawned `detached`, so it leads its own process group and a signal to
    `-pgid` reaches everything it forks: a harness under Python, a `sleep` under `sh`, or
    OpenCode's forked server. `<root>/pids` lists only the groups still owned, one `-pgid`
    per line, rewritten on every change. A group leaves the list only once
    `kill(-pgid, 0)` reports `ESRCH`, so neither `killAll` nor `run`'s trap ever signals a
    reused pid. `kill` and `killAll` send `SIGKILL`, then wait up to 5 s for each group to
    empty. `run`'s timeout kills the whole group.
  - `registryFor(clone, env) -> Promise<{paths, read(), list(), reap()}>`: relay's registry
    functions bound to `paths(env)`. They take `paths`, not `env`, and without it fall back
    to the ambient default, so every probe registry call goes through this helper.
  - `WATCHED_FILES`, `WATCHED_TREES`, `fingerprint(home) -> {[relpath]: {exists, files, size, mtimeMs}}`,
    `changedPaths(before, after) -> string[]`.
  - `writeStage(resultsDir, id, record)`, `stageLog(resultsDir, id) -> (line) => void`.
- Produces (`ps.mjs`):
  - `ROW = 'pid=,ppid=,tty=,lstart=,comm='`;
  - `ps(args, {columns}) -> {exit, stdout}`: `/bin/ps`, `LC_ALL=C`, `COLUMNS` removed unless
    given;
  - `rowFor(text, pid) -> string|null`;
  - `compareCapture(relay, ww) -> {relay_len, ww_len, truncated, relay_is_prefix}`;
  - `capture(pid, label) -> {pid, label, forms: {row, comm, args}, truncated}`;
  - `tableCounts() -> {rows, over_cut, truncated}`;
  - `sampleHarnessRows(names) -> [{pid, ppid, row_ww, comm_ww}]`.
- Produces (`parents.mjs`):
  - `installShell(dir, name) -> path`: a copy of `/bin/sh`;
  - `startParent(t, {shell, clone, plan, workdir, env}) -> {child, pid, workdir, done(): Promise<object[]>}`.
    It writes `plan.json` and runs `timed-hook.mjs plan.json` as a non-final command, then
    blocks on `read` from a FIFO until killed.
- Produces (`timed-hook.mjs`): a CLI, `node timed-hook.mjs <plan.json>`. It reads the
  registry through `paths(process.env)` explicitly. The plan is
  `{clone, harness, subscribers, steps: [{event, outerMs, payload, out}]}`. For each step it
  writes `out` as `{ms, exit, stdout, stderr, before, after}`, where `before` and `after`
  are `readSnapshot()` results. Then it writes `<plan dir>/done`.

- [ ] **Step 1: Write the failing tests** (`test/darwin-probe-runtime.test.js`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isolatedEnv, prepareRoot, registryFor, tracker, fingerprint, changedPaths, WATCHED_FILES, WATCHED_TREES } from '../tools/darwin-probe/lib/context.mjs';
import { compareCapture, rowFor } from '../tools/darwin-probe/lib/ps.mjs';
import { installShell, startParent } from '../tools/darwin-probe/lib/parents.mjs';
import { createProcessOps } from '../src/index.js';

const root = (t) => { const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
test('isolation sets every redirect and drops COLUMNS and session variables', (t) => {
  const r = root(t), env = isolatedEnv(r, { HOME: '/h', COLUMNS: '80', CLAUDE_CODE_SESSION_ID: 'x', PATH: '/bin' });
  for (const k of ['RELAY_STATE_DIR','XDG_CONFIG_HOME','XDG_STATE_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','CLAUDE_CONFIG_DIR','CODEX_HOME']) assert.ok(env[k].startsWith(r), k);
  assert.equal(env.COLUMNS, undefined); assert.equal(env.CLAUDE_CODE_SESSION_ID, undefined); assert.equal(env.PATH, '/bin');
});
test('the watched set covers config and credentials, not session transcripts', () => {
  assert.ok(WATCHED_FILES.includes('.claude/settings.json') && WATCHED_FILES.includes('.codex/auth.json'));
  assert.ok(!WATCHED_TREES.some((p) => p === '.claude' || p === '.codex'));
  assert.ok(WATCHED_TREES.includes('.local/share/opencode') && WATCHED_TREES.includes('.cache/opencode'));
});
test('fingerprints report a new file inside a watched tree and ignore unwatched writes', (t) => {
  const home = root(t); mkdirSync(join(home, '.config/relay'), { recursive: true }); mkdirSync(join(home, '.claude/projects'), { recursive: true });
  const before = fingerprint(home);
  writeFileSync(join(home, '.claude/projects/session.jsonl'), 'x');
  assert.deepEqual(changedPaths(before, fingerprint(home)), []);
  writeFileSync(join(home, '.config/relay/new.json'), '{}');
  assert.deepEqual(changedPaths(before, fingerprint(home)), ['.config/relay']);
});
test('registry access follows the given env, never the ambient one', async (t) => {
  const r = root(t); prepareRoot(r);
  const saved = process.env.RELAY_STATE_DIR; process.env.RELAY_STATE_DIR = join(r, 'ambient');
  t.after(() => { if (saved === undefined) delete process.env.RELAY_STATE_DIR; else process.env.RELAY_STATE_DIR = saved; });
  const reg = await registryFor(process.cwd(), isolatedEnv(r));
  assert.equal(reg.paths.stateDir, join(r, 'relay-state'));
});
test('after stop, spawning is refused and a resumed stage cannot outlive cleanup', async (t) => {
  const r = root(t); const tr = tracker(r);
  // A stage that resumes whenever its child dies and immediately spawns another.
  const stage = (async () => { for (;;) await tr.run('/bin/sleep', ['600.777']); })().catch((e) => e.message);
  await new Promise((x) => setTimeout(x, 300));
  tr.stop();
  const { survivors } = await tr.killAll();
  assert.deepEqual(survivors, []);
  assert.equal(await stage, 'probe is stopping');
  assert.equal(execFileSync('/bin/ps', ['-axo', 'args='], { encoding: 'utf8' }).includes('sleep 600.777'), false);
  assert.throws(() => tr.spawn('/bin/true', []), /stopping/);
});
test('run survives a child that exits without reading its stdin', async (t) => {
  const r = root(t); const tr = tracker(r);
  assert.equal((await tr.run(process.execPath, ['--version'])).exit, 0);
  assert.equal((await tr.run('/bin/sh', ['-c', 'exit 0'], { input: 'x'.repeat(4 * 1024 * 1024) })).exit, 0);
  assert.equal((await tr.run('/bin/sh', ['-c', 'head -c 1 >/dev/null'], { input: 'y'.repeat(4 * 1024 * 1024) })).exit, 0);
});
test('kill is idempotent and a group is retired when its last member exits', async (t) => {
  const r = root(t); const tr = tracker(r);
  const c = tr.spawn('/bin/sh', ['-c', 'sleep 0.3 & exit 0'], { stdio: 'ignore' });
  await new Promise((x) => setTimeout(x, 1000));
  assert.equal(readFileSync(join(r, 'pids'), 'utf8'), '');
  await tr.kill(c.pid); await tr.kill(c.pid);
});
test('killAll reaches grandchildren and forgets only emptied groups', async (t) => {
  const r = root(t); const tr = tracker(r);
  const child = tr.spawn('/bin/sh', ['-c', 'sleep 600.321 & sleep 600.654; true'], { stdio: 'ignore' });
  await new Promise((x) => setTimeout(x, 300));
  assert.match(readFileSync(join(r, 'pids'), 'utf8'), new RegExp(`^-${child.pid}$`, 'm'));
  assert.deepEqual((await tr.killAll()).survivors, []);
  assert.equal(execFileSync('/bin/ps', ['-axo', 'args='], { encoding: 'utf8' }).includes('sleep 600.321'), false);
  assert.equal(execFileSync('/bin/ps', ['-axo', 'args='], { encoding: 'utf8' }).includes('sleep 600.654'), false);
  assert.equal(readFileSync(join(r, 'pids'), 'utf8'), '');
});
test('capture comparison flags a cut row and a clean row', () => {
  assert.deepEqual(compareCapture('12 1 ?? Thu Sep 25 07:31:02 2026 /Users/u/.local/share/cl', '12 1 ?? Thu Sep 25 07:31:02 2026 /Users/u/.local/share/claude/versions/2.1.282'),
    { relay_len: 59, ww_len: 82, truncated: true, relay_is_prefix: true });
  assert.equal(compareCapture('a', 'a').truncated, false);
  assert.equal(rowFor('  7 1 x\n 12 1 y\n', 12), '12 1 y');
});
test('a constructed codex parent publishes its own qualified handle and stays alive', async (t) => {
  const r = root(t); prepareRoot(r); const tr = tracker(r); t.after(() => tr.killAll());
  const env = isolatedEnv(r); writeFileSync(join(r, 'xdg/relay/subscribers.json'), '{"schema":1,"subscribers":[]}\n', { mode: 0o600 });
  const repo = join(r, 'repo'); mkdirSync(repo); execFileSync('git', ['init', '-q', repo]);
  const shell = installShell(join(r, 'p'), 'codex');
  const parent = startParent(tr, { shell, clone: process.cwd(), workdir: join(r, 'w0'), env, plan: { harness: 'codex',
    subscribers: join(r, 'xdg/relay/subscribers.json'), steps: [{ event: 'SessionStart', outerMs: 600000, payload: { session_id: 'k0', cwd: repo } }] } });
  const expected = createProcessOps().handleOf(parent.pid);
  const [step] = await parent.done();
  assert.equal(step.exit, 0);
  assert.deepEqual(step.after.agents['codex:k0'].process, expected);
  assert.equal(createProcessOps().probe(expected).status, 'alive');
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test test/darwin-probe-runtime.test.js`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement `context.mjs`**

```js
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync, appendFileSync as log } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SESSION_VARS = ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SESSION_ID', 'CODEX_THREAD_ID'];
export function isolatedEnv(root, base = process.env) {
  const env = { ...base };
  delete env.COLUMNS;
  for (const key of SESSION_VARS) delete env[key];
  return { ...env, RELAY_STATE_DIR: join(root, 'relay-state'), XDG_CONFIG_HOME: join(root, 'xdg'), XDG_STATE_HOME: join(root, 'state'),
    XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), CLAUDE_CONFIG_DIR: join(root, 'claude'), CODEX_HOME: join(root, 'codex') };
}
export function prepareRoot(root) {
  for (const dir of ['state', 'data', 'cache', 'claude', 'codex']) mkdirSync(join(root, dir), { recursive: true });
  mkdirSync(join(root, 'xdg/relay'), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'relay-state'), { mode: 0o700 });
}
// relay's registry functions take `paths`; without it they use the ambient default, which on
// the Mac is the user's live registry.
export async function registryFor(clone, env) {
  const relay = await import(pathToFileURL(join(clone, 'src/index.js')).href);
  const paths = relay.paths(env);
  return { paths, read: () => relay.readSnapshot({ paths }), list: () => relay.listAgents({ paths }), reap: () => relay.reapRegistry({ paths }) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function tracker(root) {
  const file = join(root, 'pids'), groups = new Map();
  let stopping = false, sweeper = null;
  const save = () => writeFileSync(file, [...groups.keys()].map((g) => `-${g}\n`).join(''));
  const alive = (pgid) => { try { process.kill(-pgid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
  // Retire a group once it is empty, whichever member exits last; only owned, non-empty groups
  // are ever signalled, which bounds the window in which a reused pgid could be hit.
  const sweep = () => {
    let changed = false;
    for (const pgid of groups.keys()) if (!alive(pgid)) { groups.delete(pgid); changed = true; }
    if (changed) save();
    if (!groups.size && sweeper) { clearInterval(sweeper); sweeper = null; }
  };
  const refuse = () => { if (stopping) throw new Error('probe is stopping'); };
  // Every child leads its own process group, so one signal reaches everything it forks.
  const spawnTracked = (cmd, args, options = {}) => {
    refuse();
    const child = spawn(cmd, args, { ...options, detached: true });
    if (child.pid) { groups.set(child.pid, child); save(); sweeper ??= setInterval(sweep, 250); sweeper.unref?.(); }
    return child;
  };
  const kill = async (pgid) => {
    if (!groups.has(pgid)) return;
    if (alive(pgid)) { try { process.kill(-pgid, 'SIGKILL'); } catch {} }
    for (const until = Date.now() + 5000; alive(pgid) && Date.now() < until;) await sleep(50);
    sweep();
  };
  const fork = (module, args, options = {}) => spawnTracked(process.execPath, [module, ...args], { ...options, stdio: options.stdio ?? ['ignore', 'ignore', 'inherit', 'ipc'] });
  // stdin is a pipe only when there is input to send. A child may exit without reading it
  // (`python3 --version`), so EPIPE on stdin is expected; any other stdin error is reported in
  // the result's stderr rather than escaping as an unhandled stream error.
  const run = (cmd, args, { env, cwd, input, timeoutMs = 600000, argv0 } = {}) => new Promise((resolve, reject) => {
    let child; try { child = spawnTracked(cmd, args, { env, cwd, argv0, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] }); } catch (error) { reject(error); return; }
    const started = performance.now();
    let stdout = '', stderr = '', stdinError = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { kill(child.pid); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); resolve({ exit: null, signal: null, stdout, stderr: `${stderr}${error.message}\n`, ms: performance.now() - started }); });
    child.once('close', (exit, signal) => { clearTimeout(timer); resolve({ exit, signal, stdout, stderr: stderr + stdinError, ms: performance.now() - started }); });
    if (input !== undefined) {
      child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') stdinError = `stdin: ${error.message}\n`; });
      child.stdin.end(input);
    }
  });
  const killAll = async () => {
    for (const until = Date.now() + 10000; groups.size && Date.now() < until;) { await Promise.all([...groups.keys()].map(kill)); sweep(); }
    return { survivors: [...groups.keys()].filter(alive) };
  };
  return { spawn: spawnTracked, fork, run, kill, killAll, stop: () => { stopping = true; }, get stopping() { return stopping; } };
}
// Live sessions the user keeps open (D9) write transcripts under ~/.claude and ~/.codex, so
// those two are watched by their configuration and credential files only.
export const WATCHED_FILES = ['.claude/settings.json', '.claude/settings.local.json', '.claude/.credentials.json',
  '.codex/hooks.json', '.codex/config.toml', '.codex/auth.json'];
export const WATCHED_TREES = ['.config/relay', '.local/state/relay', '.config/opencode', '.local/share/opencode', '.cache/opencode'];
function tree(path) {
  let files = 0, size = 0, mtimeMs = 0;
  const walk = (p) => { const s = lstatSync(p); mtimeMs = Math.max(mtimeMs, s.mtimeMs);
    if (s.isDirectory()) for (const name of readdirSync(p)) walk(join(p, name)); else { files++; size += s.size; } };
  walk(path);
  return { exists: true, files, size, mtimeMs };
}
export function fingerprint(home) {
  const out = {};
  for (const rel of [...WATCHED_FILES, ...WATCHED_TREES]) {
    const path = join(home, rel);
    out[rel] = existsSync(path) ? tree(path) : { exists: false, files: 0, size: 0, mtimeMs: 0 };
  }
  return out;
}
export const changedPaths = (before, after) => Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
export function writeStage(resultsDir, id, record) {
  mkdirSync(join(resultsDir, 'stages'), { recursive: true });
  writeFileSync(join(resultsDir, 'stages', `${id}.json`), `${JSON.stringify({ id, ...record }, null, 2)}\n`);
}
export function stageLog(resultsDir, id) {
  mkdirSync(join(resultsDir, 'logs'), { recursive: true });
  return (line) => log(join(resultsDir, 'logs', `${id}.log`), `${line}\n`);
}
```

- [ ] **Step 4: Implement `ps.mjs`**

```js
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

export const ROW = 'pid=,ppid=,tty=,lstart=,comm=';
// Relay spawns /bin/ps with the caller's environment plus LC_ALL=C; the probe's environment
// has no COLUMNS, so the plain variant is what relay reads in a hook whose harness does not
// export COLUMNS. D0 records whether the user's shell exports it.
export function ps(args, { columns = null } = {}) {
  const env = { ...process.env, LC_ALL: 'C' };
  delete env.COLUMNS;
  if (columns) env.COLUMNS = String(columns);
  const r = spawnSync('/bin/ps', args, { env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { exit: r.status, stdout: r.stdout ?? '' };
}
const pidOf = (line) => Number(/^\s*(\d+)/.exec(line)?.[1]);
export const rowFor = (text, pid) => text.split('\n').find((line) => pidOf(line) === pid)?.trim() ?? null;
export function compareCapture(relay, ww) {
  const both = relay !== null && ww !== null;
  return { relay_len: relay?.length ?? null, ww_len: ww?.length ?? null, truncated: both && relay !== ww, relay_is_prefix: both && ww.startsWith(relay) };
}
export function capture(pid, label) {
  const forms = { row: ['-axo', ROW], comm: ['-p', String(pid), '-o', 'comm='], args: ['-p', String(pid), '-o', 'args='] };
  const out = {};
  for (const [form, args] of Object.entries(forms)) {
    const pick = (text) => (form === 'row' ? rowFor(text, pid) : text.trim() || null);
    const relay = pick(ps(args).stdout), columns = pick(ps(args, { columns: 500 }).stdout), ww = pick(ps(['-ww', ...args]).stdout);
    out[form] = { relay, columns, ww, ...compareCapture(relay, ww) };
  }
  return { pid, label, forms: out, truncated: Object.values(out).some((f) => f.truncated) };
}
export function tableCounts() {
  const plain = ps(['-axo', ROW]).stdout.trimEnd().split('\n');
  const wide = new Map(ps(['-ww', '-axo', ROW]).stdout.trimEnd().split('\n').map((l) => [pidOf(l), l.trim()]));
  let over = 0, truncated = 0;
  for (const line of plain) { const w = wide.get(pidOf(line)); if (!w) continue; if (w.length >= 80) over++; if (w !== line.trim()) truncated++; }
  return { rows: plain.length, over_cut: over, truncated };
}
const VERSION = /^\d+\.\d+\.\d+$/;
export function sampleHarnessRows(names) {
  const rows = ps(['-ww', '-axo', ROW]).stdout.trimEnd().split('\n');
  return rows.map((line) => { const m = /^\s*(\d+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\d+\s+\S+\s+\d+\s+(.+)$/.exec(line); return m && { pid: +m[1], ppid: +m[2], row_ww: line.trim(), comm_ww: m[3] }; })
    .filter((r) => r && (names.includes(basename(r.comm_ww)) || VERSION.test(basename(r.comm_ww))));
}
```

- [ ] **Step 5: Implement `parents.mjs` and `timed-hook.mjs`**

```js
// parents.mjs — a constructed harness parent: a copy of /bin/sh named after the harness, so
// relay's adapter (nearest ancestor whose comm is the harness, no terminal required) names it.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const TIMED = fileURLToPath(new URL('./timed-hook.mjs', import.meta.url));
export function installShell(dir, name) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name); copyFileSync('/bin/sh', path); chmodSync(path, 0o755); return path;
}
export function startParent(t, { shell, clone, plan, workdir, env }) {
  mkdirSync(workdir, { recursive: true });
  const steps = plan.steps.map((s, i) => ({ ...s, out: join(workdir, `step-${i}.json`) }));
  writeFileSync(join(workdir, 'plan.json'), JSON.stringify({ ...plan, clone, steps }));
  execFileSync('mkfifo', [join(workdir, 'hold')]);
  // The hook runs as a non-final command so this shell stays its parent; `read` from a FIFO
  // nobody writes keeps it alive with no child until the probe kills it.
  const script = '"$1" "$2" "$3/plan.json"; read line < "$3/hold"';
  const child = t.spawn(shell, ['-c', script, 'parent', process.execPath, TIMED, workdir], { env, stdio: 'ignore' });
  const done = async (timeoutMs = 30000) => {
    const until = Date.now() + timeoutMs;
    while (!existsSync(join(workdir, 'done'))) { if (Date.now() > until) throw new Error(`parent ${child.pid} did not finish`); await new Promise((r) => setTimeout(r, 50)); }
    return steps.map((s) => JSON.parse(readFileSync(s.out, 'utf8')));
  };
  return { child, pid: child.pid, workdir, done };
}
```

```js
// timed-hook.mjs — runs relay hook steps from under a constructed parent and records timing
// and the registry before and after each step.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const planPath = process.argv[2], plan = JSON.parse(readFileSync(planPath, 'utf8'));
const relay = await import(pathToFileURL(join(plan.clone, 'src/index.js')).href);
const paths = relay.paths(process.env), readSnapshot = () => relay.readSnapshot({ paths });
for (const step of plan.steps) {
  const before = await readSnapshot(), started = performance.now();
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(plan.clone, 'bin/relay.js'), 'hook', '--harness', plan.harness,
      '--outer-ms', String(step.outerMs), '--subscribers', plan.subscribers, step.event], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.once('close', (exit) => resolve({ exit, stdout, stderr }));
    child.stdin.end(JSON.stringify(step.payload));
  });
  const ms = performance.now() - started, after = await readSnapshot();
  writeFileSync(step.out, JSON.stringify({ ms, ...r, before, after }));
}
writeFileSync(join(dirname(planPath), 'done'), '');
```

- [ ] **Step 6: Run to see it pass**

Run: `node --test test/darwin-probe-runtime.test.js`
Expected: PASS (10 tests). The parent test proves on Linux that the constructed-parent path
publishes a qualified handle; D5 relies on the same path on Darwin.

- [ ] **Step 7: Commit**

```bash
git add tools/darwin-probe/lib test/darwin-probe-runtime.test.js
git commit -m "feat(tools): add the Darwin probe runtime: isolation, ps capture, harness parents"
```

---

### Task 5: Stages D0–D2: environment, package, suite

**Files:**
- Create: `tools/darwin-probe/stages/d0-env.mjs`
- Create: `tools/darwin-probe/stages/d1-package.mjs`
- Create: `tools/darwin-probe/stages/d2-suite.mjs`
- Test: `test/darwin-probe-stages-a.test.js`

**Interfaces:**
- Every stage module exports `async function run(ctx) -> {status, reason?, observations}`.
  `ctx` is `{root, results, bundle, clone, opsClone, tarball, env, t, platform, log, consumer}`.
  - `ctx.t` is the Task 4 tracker.
  - `ctx.log` is that stage's `stageLog`.
  - `ctx.consumer` is set by D1 to the consumer project path, for D2 to copy `jsonc-parser`
    from.
- D0 also exports two pure helpers: `parseHostName(result) -> string|null` (exit 1 or "not
  set" gives `null`) and `pythonAtLeast(versionText, [3, 11]) -> boolean`.
- D2 exports `parseTap(text) -> {tests, pass, fail, skipped, todo, failures: string[]}`.

- [ ] **Step 1: Write the failing tests** (`test/darwin-probe-stages-a.test.js`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHostName, pythonAtLeast } from '../tools/darwin-probe/stages/d0-env.mjs';
import { parseTap } from '../tools/darwin-probe/stages/d2-suite.mjs';

test('an unset HostName is null, not the error text', () => {
  assert.equal(parseHostName({ exit: 1, stdout: '', stderr: 'HostName: not set\n' }), null);
  assert.equal(parseHostName({ exit: 0, stdout: 'Mac-A\n', stderr: '' }), 'Mac-A');
  assert.equal(parseHostName({ exit: null, stdout: '', stderr: 'spawn scutil ENOENT' }), null);
});
test('python version floor', () => {
  assert.equal(pythonAtLeast('Python 3.9.6', [3, 11]), false);
  assert.equal(pythonAtLeast('Python 3.13.7', [3, 11]), true);
  assert.equal(pythonAtLeast('', [3, 11]), false);
});
test('TAP summary and failures', () => {
  const tap = 'TAP version 13\nok 1 - a\nnot ok 2 - b fails\n  ---\n  ...\n# tests 2\n# pass 1\n# fail 1\n# skipped 0\n# todo 0\n';
  assert.deepEqual(parseTap(tap), { tests: 2, pass: 1, fail: 1, skipped: 0, todo: 0, failures: ['b fails'] });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test test/darwin-probe-stages-a.test.js` → FAIL (modules missing).

- [ ] **Step 3: Implement D0** (`stages/d0-env.mjs`)

```js
import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { readlinkSync, realpathSync } from 'node:fs';
export const parseHostName = (r) => (r.exit === 0 && r.stdout.trim() ? r.stdout.trim() : null);
export function pythonAtLeast(text, [major, minor]) {
  const m = /Python (\d+)\.(\d+)/.exec(text ?? ''); return !!m && (+m[1] > major || (+m[1] === major && +m[2] >= minor));
}
// Direct and bounded, not through the tracker: finalization takes the end reading after the
// tracker has stopped accepting children.
async function hosts(ctx) {
  const scutil = async (key) => {
    if (ctx.platform !== 'darwin') return null;
    const r = spawnSync('scutil', ['--get', key], { encoding: 'utf8', timeout: 2000 });
    return parseHostName({ exit: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' });
  };
  return { os: hostname(), HostName: await scutil('HostName'), LocalHostName: await scutil('LocalHostName'), ComputerName: await scutil('ComputerName') };
}
export async function run(ctx) {
  const v = async (cmd, args) => { const r = await ctx.t.run(cmd, args, { env: ctx.env }); return r.exit === 0 ? (r.stdout || r.stderr).trim() : null; };
  const harness = async (name) => {
    const path = await v('/usr/bin/which', [name]); if (!path) return null;
    let real = null; try { real = realpathSync(path); } catch {}
    return { version: await v(name, ['--version']), path, real };
  };
  const python3 = await v('python3', ['--version']);
  const clt = ctx.platform === 'darwin' ? await v('xcode-select', ['-p']) : null;
  let zone = null; try { zone = readlinkSync('/etc/localtime').replace(/^.*zoneinfo\//, ''); } catch {}
  const node = process.versions.node;
  const observations = {
    platform: ctx.platform,
    sw_vers: ctx.platform === 'darwin' ? { ProductVersion: await v('sw_vers', ['-productVersion']), BuildVersion: await v('sw_vers', ['-buildVersion']) } : null,
    arch: await v('uname', ['-m']),
    versions: { node: `v${node}`, npm: await v('npm', ['--version']), git: await v('git', ['--version']), python3 },
    clt, tz: process.env.TZ ?? null, zone, columns_exported: ctx.ambient?.columns_exported ?? process.env.COLUMNS !== undefined,
    harnesses: { claude: await harness('claude'), codex: await harness('codex'), opencode: await harness('opencode') },
    hosts: { start: await hosts(ctx), end: null },
    prerequisites: { macos: ctx.platform === 'darwin', node22: +node.split('.')[0] >= 22, clt: ctx.platform !== 'darwin' || clt !== null, python311: pythonAtLeast(python3, [3, 11]) },
  };
  return { status: 'ran', observations };
}
export async function finish(ctx, record) { record.observations.hosts.end = await hosts(ctx); return record; }
```

`probe.mjs` (Task 10) calls `finish` after the last stage, so the start and end host
readings bracket the whole run.

- [ ] **Step 4: Implement D1** (`stages/d1-package.mjs`)

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const EXPORTS = ['STATES', 'paths', 'adapterFor', 'normalizeEvent', 'readNativeInput', 'createProcessOps', 'readSnapshot', 'listAgents',
  'applyEvent', 'reapRegistry', 'CONTEXT_LIMIT', 'parseReply', 'validateSubscribers', 'loadSubscribers', 'matchSubscribers', 'budgetFor',
  'checkBudget', 'dispatchHook', 'reconcile'];
export async function run(ctx) {
  const consumer = join(ctx.root, 'consumer'), cache = join(ctx.root, 'npm-cache'), state = join(ctx.root, 'd1-state');
  mkdirSync(consumer); mkdirSync(state, { mode: 0o700 });
  writeFileSync(join(consumer, 'package.json'), '{"name":"consumer","private":true,"type":"module"}\n');
  const install = await ctx.t.run('npm', ['install', '--offline', '--no-audit', '--no-fund', '--cache', cache, ctx.tarball], { cwd: consumer, env: ctx.env });
  ctx.log(`npm install: ${install.exit}\n${install.stderr}`);
  const bin = join(consumer, 'node_modules/.bin/relay');
  const help = await ctx.t.run(bin, ['--help'], { env: ctx.env });
  const list = await ctx.t.run(bin, ['list', '--json'], { env: { ...ctx.env, RELAY_STATE_DIR: state } });
  const entry = join(consumer, 'node_modules/relay');
  const mod = await import(pathToFileURL(join(entry, 'src/index.js')).href).catch(() => ({}));
  const exports = Object.fromEntries(EXPORTS.map((n) => [n, mod[n] !== undefined]));
  const probe = async (specifier, options) => { try { await import(specifier, options); return true; } catch (error) { ctx.log(`${specifier}: ${error.message}`); return false; } };
  const req = (sub) => pathToFileURL(join(entry, sub)).href;
  const subpaths = { opencode: await probe(req('integrations/opencode/plugin.js')),
    handles: await probe(req('test/fixtures/handles.json'), { with: { type: 'json' } }),
    ancestry: await probe(req('test/fixtures/ancestry.json'), { with: { type: 'json' } }) };
  ctx.consumer = consumer;
  let json = null; try { json = JSON.parse(list.stdout); } catch {}
  return { status: 'ran', observations: { install: { exit: install.exit }, help: { exit: help.exit }, list: { exit: list.exit, json }, exports, subpaths } };
}
```

- [ ] **Step 5: Implement D2** (`stages/d2-suite.mjs`)

```js
import { cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export function parseTap(text) {
  const n = (k) => Number(new RegExp(`^# ${k} (\\d+)$`, 'm').exec(text)?.[1] ?? NaN);
  const failures = [...text.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), todo: n('todo'), failures };
}
export async function run(ctx) {
  // The clone's one runtime dependency comes from D1's installed package, checked against the lock.
  const lock = JSON.parse(readFileSync(join(ctx.clone, 'package-lock.json'), 'utf8')).packages['node_modules/jsonc-parser'].version;
  const from = join(ctx.consumer, 'node_modules/relay/node_modules/jsonc-parser');
  const have = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')).version;
  if (have !== lock) return { status: 'error', reason: `jsonc-parser ${have} does not match the lock's ${lock}`, observations: {} };
  cpSync(from, join(ctx.clone, 'node_modules/jsonc-parser'), { recursive: true });
  const files = ['test/*.test.js', 'integrations/opencode/*.test.mjs'];
  const r = await ctx.t.run('/bin/sh', ['-c', `exec node --test --test-reporter=tap ${files.join(' ')}`], { cwd: ctx.clone, env: ctx.env, timeoutMs: 900000 });
  ctx.log(r.stdout); ctx.log(r.stderr);
  const summary = parseTap(r.stdout);
  return { status: 'ran', observations: { exit: r.exit, summary: { tests: summary.tests, pass: summary.pass, fail: summary.fail, skipped: summary.skipped, todo: summary.todo }, failures: summary.failures } };
}
```

The shell glob mirrors `npm test` (`package.json` `scripts.test`), with the TAP reporter
added so the summary can be parsed.

- [ ] **Step 6: Run to see it pass**

Run: `node --test test/darwin-probe-stages-a.test.js` → PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add tools/darwin-probe/stages/d0-env.mjs tools/darwin-probe/stages/d1-package.mjs tools/darwin-probe/stages/d2-suite.mjs test/darwin-probe-stages-a.test.js
git commit -m "feat(tools): probe the Mac environment, the packed install, and the suite"
```

---

### Task 6: Stages D3–D4: process identity, table, ancestry and arguments (Darwin-only)

**Files:**
- Create: `tools/darwin-probe/stages/d3-identity.mjs`
- Create: `tools/darwin-probe/stages/d4-table.mjs`
- Create: `tools/darwin-probe/lib/identity-child.mjs` (computes or probes a handle under the TZ it was started with)
- Create: `tools/darwin-probe/lib/chain-report.mjs` (runs inside a constructed chain)
- Test: `test/darwin-probe-stages-b.test.js`

**Interfaces:**
- `identity-child.mjs`: `node identity-child.mjs <clone> handle <pid>` prints
  `handleOf(pid)` as JSON; `node identity-child.mjs <clone> probe <handle-json>` prints
  `probe(handle)`.
- `chain-report.mjs`: `node chain-report.mjs <clone> <out.json> <harness>` writes
  `{pid, ppid, ancestors_relay: [pids], ancestors_ps: [pids], tty_relay, tty_ps, resolved, capture}`.
  `capture` is `ps.capture(ppid, 'chain-<harness>')`.
- Both stages return `{status: 'skipped', reason: 'darwin only'}` when `ctx.platform !== 'darwin'`.
- D3 exports `epochFromLstart(text, run) -> Promise<string>`, which uses
  `date -j -f '%a %b %d %T %Y'` with `LC_ALL=C`.

- [ ] **Step 1: Write the failing test** (`test/darwin-probe-stages-b.test.js`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { run as d3 } from '../tools/darwin-probe/stages/d3-identity.mjs';
import { run as d4 } from '../tools/darwin-probe/stages/d4-table.mjs';

test('Darwin-only stages refuse to run elsewhere', async () => {
  for (const run of [d3, d4]) assert.deepEqual(await run({ platform: 'linux' }), { status: 'skipped', reason: 'darwin only', observations: {} });
});
```

- [ ] **Step 2: Run to see it fail** — `node --test test/darwin-probe-stages-b.test.js` → FAIL.

- [ ] **Step 3: Implement `identity-child.mjs` and D3**

```js
// identity-child.mjs
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [clone, mode, arg] = process.argv.slice(2);
const { createProcessOps } = await import(pathToFileURL(join(clone, 'src/index.js')).href);
const ops = createProcessOps();
process.stdout.write(JSON.stringify(mode === 'handle' ? ops.handleOf(Number(arg)) : ops.probe(JSON.parse(arg))));
```

```js
// stages/d3-identity.mjs
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ps } from '../lib/ps.mjs';
const CHILD = fileURLToPath(new URL('../lib/identity-child.mjs', import.meta.url));
export async function epochFromLstart(lstart, run) {
  const r = await run('date', ['-j', '-f', '%a %b %d %T %Y', lstart.replace(/\s+/g, ' ').trim(), '+%s'], { env: { ...process.env, LC_ALL: 'C' } });
  return r.stdout.trim();
}
export async function run(ctx) {
  if (ctx.platform !== 'darwin') return { status: 'skipped', reason: 'darwin only', observations: {} };
  const tzEnv = (tz) => { const env = { ...ctx.env }; if (tz) env.TZ = tz; else delete env.TZ; return env; };
  const handleUnder = async (tz, pid) => JSON.parse((await ctx.t.run(process.execPath, [CHILD, ctx.clone, 'handle', String(pid)], { env: tzEnv(tz) })).stdout);
  const probeUnder = async (tz, h) => JSON.parse((await ctx.t.run(process.execPath, [CHILD, ctx.clone, 'probe', JSON.stringify(h)], { env: tzEnv(tz) })).stdout);
  const sleeper = ctx.t.spawn('/bin/sleep', ['300'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 200));
  const h = await handleUnder('', sleeper.pid);
  const lstart = ps(['-p', String(sleeper.pid), '-o', 'lstart=']).stdout.trim();
  const independent = { relay: h.start, date: await epochFromLstart(lstart, ctx.t.run) };
  const zone = (await ctx.t.run('/bin/sh', ['-c', 'readlink /etc/localtime'])).stdout.trim().replace(/^.*zoneinfo\//, '');
  const pairs = [['UTC', 'Pacific/Chatham'], ['Pacific/Chatham', 'UTC'], ['', zone], [zone, '']];
  const tz_pairs = [];
  for (const [publish, probe] of pairs) tz_pairs.push({ publish, probe, status: (await probeUnder(probe, await handleUnder(publish, sleeper.pid))).status });
  const alive = await probeUnder('', h);
  const replaced = await probeUnder('', { ...h, start: String(BigInt(h.start) + 1n) });
  const foreign_host = { ...(await probeUnder('', { ...h, host: `${h.host}-other` })), host: `${h.host}-other` };
  const foreign_platform = await probeUnder('', { ...h, platform: 'linux', bootId: null });
  const l = await handleUnder('', 1);
  await ctx.t.kill(sleeper.pid);
  const dead = await probeUnder('', h);
  // A zombie: perl forks a child that exits at once and never reaps it.
  const z = ctx.t.spawn('perl', ['-e', '$|=1; my $p=fork(); if($p==0){exit 0} print "$p\\n"; sleep 30'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const zpid = Number(await new Promise((r) => z.stdout.once('data', (d) => r(String(d).trim()))));
  await new Promise((r) => setTimeout(r, 300));
  const zh = await handleUnder('', zpid);
  const zombie = zh ? await probeUnder('', zh) : { status: 'no-handle', reason: 'handleOf returned null' };
  await ctx.t.kill(z.pid);
  return { status: 'ran', observations: { independent, tz_pairs, alive, dead, replaced, foreign_host, foreign_platform,
    launchd: { valid: !!l && l.pid === 1, boot_id_null: l?.bootId === null }, zombie } };
}
```

- [ ] **Step 4: Implement `chain-report.mjs` and D4**

```js
// chain-report.mjs — runs as the child of a constructed harness process.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ps, capture } from './ps.mjs';
const [clone, out, harness] = process.argv.slice(2);
const { createProcessOps, adapterFor } = await import(pathToFileURL(join(clone, 'src/index.js')).href);
const ops = createProcessOps();
const relayChain = ops.ancestors(process.pid);
const table = new Map(ps(['-ww', '-axo', 'pid=,ppid=']).stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number)));
const psChain = []; for (let p = process.pid; p > 1 && psChain.length < 64; p = table.get(p)) psChain.push(p);
let resolved = null, error = null;
try { resolved = adapterFor(harness).resolveSessionPid(); } catch (e) { error = e.code ?? e.message; }
writeFileSync(out, JSON.stringify({ pid: process.pid, ppid: process.ppid, ancestors_relay: relayChain.map((r) => r.pid), ancestors_ps: psChain,
  tty_relay: relayChain[1]?.tty ?? null, tty_ps: ps(['-p', String(process.ppid), '-o', 'tty=']).stdout.trim(), resolved, error,
  capture: capture(process.ppid, `chain-${harness}`) }));
```

```js
// stages/d4-table.mjs
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installShell } from '../lib/parents.mjs';
import { capture, ps, tableCounts } from '../lib/ps.mjs';
const REPORT = fileURLToPath(new URL('../lib/chain-report.mjs', import.meta.url));
const wait = async (path, ms = 20000) => { const until = Date.now() + ms; while (!existsSync(path)) { if (Date.now() > until) throw new Error(`timeout waiting for ${path}`); await new Promise((r) => setTimeout(r, 50)); } };
const normTty = (t) => (!t || t === '??' ? null : t.startsWith('tty') ? t : `tty${t}`);
export async function run(ctx) {
  if (ctx.platform !== 'darwin') return { status: 'skipped', reason: 'darwin only', observations: {} };
  const { createProcessOps } = await import(pathToFileURL(join(ctx.clone, 'src/index.js')).href);
  const ops = createProcessOps();
  // 1. A chain under a pseudo-terminal whose `claude` executable path exceeds 100 characters.
  const longDir = join(ctx.root, 'l', 'x'.repeat(90));
  const claude = installShell(longDir, 'claude');
  const chainOut = join(ctx.root, 'd4-chain.json');
  const script = ctx.t.spawn('script', ['-q', '/dev/null', claude, '-c', `"${process.execPath}" "${REPORT}" "${ctx.clone}" "${chainOut}" claude-code; true`], { env: ctx.env, stdio: 'ignore' });
  await wait(chainOut);
  const chain = JSON.parse(readFileSync(chainOut, 'utf8'));
  await ctx.t.kill(script.pid);
  // 2. A Claude-shaped native install: …/claude/versions/9.9.9 started as `9.9.9`.
  const versioned = installShell(join(ctx.root, 'n/claude/versions'), '9.9.9');
  const nativeOut = join(ctx.root, 'd4-native.json');
  const native = ctx.t.spawn(versioned, ['-c', `"${process.execPath}" "${REPORT}" "${ctx.clone}" "${nativeOut}" claude-code; sleep 300; true`], { env: ctx.env, argv0: '9.9.9', stdio: 'ignore' });
  await wait(nativeOut);
  const nat = JSON.parse(readFileSync(nativeOut, 'utf8'));
  let executable = null; try { executable = ops.executableOf(native.pid); } catch (e) { executable = `error:${e.code}`; }
  await ctx.t.kill(native.pid);
  // 3. argvOf on an executable path and arguments with spaces.
  const spaced = installShell(join(ctx.root, 'sp ace'), 's h');
  // `; true` keeps the shell itself alive: sh may exec a final simple command in its place.
  const sp = ctx.t.spawn(spaced, ['-c', 'sleep 300; true', 'arg with space'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 300));
  let argv = null, argvError = null; try { argv = ops.argvOf(sp.pid); } catch (e) { argvError = e.code; }
  const spCapture = capture(sp.pid, 'argv-spaces');
  await ctx.t.kill(sp.pid);
  const commWw = chain.capture.forms.comm.ww;
  const comm_kind = commWw === claude ? 'path' : commWw === 'claude' || commWw === claude.split('/').pop() ? 'argv0' : 'other';
  return { status: 'ran', observations: {
    chain: { ancestors_match: JSON.stringify(chain.ancestors_relay) === JSON.stringify(chain.ancestors_ps.slice(0, chain.ancestors_relay.length)),
      tty_match: chain.tty_relay === normTty(chain.tty_ps), resolved: chain.resolved, expected: chain.ppid, error: chain.error },
    native: { recognized: nat.resolved === nat.ppid, executable, executable_absolute: typeof executable === 'string' && executable.startsWith('/') },
    argv: { expected_argv0: spaced, result: argv, error: argvError, ok: argvError === 'PROCESS_UNREADABLE' || argv?.[0] === spaced },
    captures: [chain.capture, nat.capture, spCapture].map((c) => ({ pid: c.pid, label: c.label, truncated: c.truncated, forms: c.forms })),
    comm_kind, table: tableCounts() } };
}
```

`comm_kind` compares the `-ww` `comm` of the chain's `claude` process with its full
executable path. Equal means Darwin reports the path. The bare name means Darwin reports
argv[0].

- [ ] **Step 5: Run to see it pass** — `node --test test/darwin-probe-stages-b.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/darwin-probe/stages/d3-identity.mjs tools/darwin-probe/stages/d4-table.mjs tools/darwin-probe/lib/identity-child.mjs tools/darwin-probe/lib/chain-report.mjs test/darwin-probe-stages-b.test.js
git commit -m "feat(tools): probe Darwin process identity, ps width, ancestry and argv"
```

---

### Task 7: Stages D5 and D8: registry, lock, reap, cost, launchd environment

**Files:**
- Create: `tools/darwin-probe/stages/d5-registry.mjs`
- Create: `tools/darwin-probe/stages/d8-launchd.mjs`
- Create: `tools/darwin-probe/lib/fleet.mjs` (shared: start N constructed codex parents, wait, kill some)
- Test: `test/darwin-probe-stages-c.test.js` (live on Linux: D5 and D8's reap with constructed parents)

**Interfaces:**
- `fleet.mjs` exports:
  - `fleetBase(ctx, stateDir) -> Promise<{env, subscribers, repo, shell, ops, registry}>`,
    where `registry` comes from `registryFor(ctx.clone, env)`;
  - `startFleet(ctx, base, {count, prefix, extraSteps}) -> Promise<[{id, pid, handle, steps}]>`.
    Each parent publishes `codex:<prefix><i>` through a `SessionStart` step.
  - `killParents(ctx, parents) -> Promise<void>`: `ctx.t.kill` on each parent's group, which
    waits until the group is empty.
- D5's observations match the contract. `cost.nN` is
  `{agents, pretool: {ms, exit, stderr, allow, retained}, sessionend: {ms, exit, stderr, ending_absent, revision_delta, others_retained}}`.
- D8's `hook_path` is `{exit, denied, stderr_head, command}`, with `command` redacted like
  any string.

- [ ] **Step 1: Write the failing test** (`test/darwin-probe-stages-c.test.js`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedEnv, prepareRoot, tracker } from '../tools/darwin-probe/lib/context.mjs';
import { run as d5 } from '../tools/darwin-probe/stages/d5-registry.mjs';
import { run as d8 } from '../tools/darwin-probe/stages/d8-launchd.mjs';

const ctxFor = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dp-')); prepareRoot(root);
  const tr = tracker(root); t.after(async () => { await tr.killAll(); rmSync(root, { recursive: true, force: true }); });
  return { root, env: isolatedEnv(root), t: tr, clone: process.cwd(), platform: process.platform, log: () => {} };
};
test('D5 on this host: eight publishers, lock recovery, exact reap, SessionEnd mutation', { timeout: 180000 }, async (t) => {
  const o = (await d5(ctxFor(t))).observations;
  assert.equal(o.concurrent.present, 8); assert.ok(o.concurrent.handles_match);
  assert.ok(o.lock.recovered);
  assert.deepEqual(o.reap.removed.sort(), o.reap.expected_removed.sort());
  const s = o.cost.n10.sessionend;
  assert.equal(s.exit, 0); assert.equal(s.stderr, ''); assert.ok(s.ending_absent); assert.equal(s.revision_delta, 1); assert.ok(s.others_retained);
});
test('D8 reap keeps exactly the live half of its own fleet', { timeout: 120000 }, async (t) => {
  const o = (await d8(ctxFor(t))).observations;
  assert.equal(o.reap.exit, 0); assert.deepEqual(o.reap.kept.sort(), o.reap.expected_kept.sort()); assert.ok(o.reap.handles_unchanged);
});
```

- [ ] **Step 2: Run to see it fail** — `node --test test/darwin-probe-stages-c.test.js` → FAIL.

- [ ] **Step 3: Implement `fleet.mjs`**

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registryFor } from './context.mjs';
import { installShell, startParent } from './parents.mjs';
export async function fleetBase(ctx, stateDir) {
  mkdirSync(stateDir, { mode: 0o700, recursive: true });
  const env = { ...ctx.env, RELAY_STATE_DIR: stateDir };
  const subscribers = join(ctx.root, 'xdg/relay/subscribers.json');
  writeFileSync(subscribers, '{"schema":1,"subscribers":[]}\n', { mode: 0o600 });
  const repo = join(ctx.root, 'fleet-repo'); mkdirSync(repo, { recursive: true }); execFileSync('git', ['init', '-q', repo]);
  // A short path keeps D5 independent of the ps width question D4 owns.
  const shell = installShell(join(ctx.root, 'p'), 'codex');
  const { createProcessOps } = await import(pathToFileURL(join(ctx.clone, 'src/index.js')).href);
  return { env, subscribers, repo, shell, ops: createProcessOps(), registry: await registryFor(ctx.clone, env) };
}
export async function startFleet(ctx, base, { count, prefix, extraSteps = () => [] }) {
  const parents = Array.from({ length: count }, (_, i) => {
    const id = `${prefix}${i}`;
    const p = startParent(ctx.t, { shell: base.shell, clone: ctx.clone, workdir: join(ctx.root, 'fleet', id), env: base.env,
      plan: { harness: 'codex', subscribers: base.subscribers, steps: [{ event: 'SessionStart', outerMs: 600000, payload: { session_id: id, cwd: base.repo } }, ...extraSteps(id)] } });
    return { id: `codex:${id}`, pid: p.pid, handle: base.ops.handleOf(p.pid), done: p.done };
  });
  const steps = await Promise.all(parents.map((p) => p.done()));
  return parents.map((p, i) => ({ ...p, steps: steps[i] }));
}
export const killParents = (ctx, parents) => Promise.all(parents.map((p) => ctx.t.kill(p.pid)));
```

- [ ] **Step 4: Implement D5**

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fleetBase, killParents, startFleet } from '../lib/fleet.mjs';
const pretool = (id, repo) => ({ event: 'PreToolUse', outerMs: 600000, payload: { session_id: id, cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' } } });
const sessionEnd = (id, repo) => ({ event: 'SessionEnd', outerMs: 3000, payload: { session_id: id, cwd: repo } });
const sameHandles = (before, after, ids) => ids.every((id) => after.agents[id] && JSON.stringify(before.agents[id]?.process) === JSON.stringify(after.agents[id].process));
export async function run(ctx) {
  const all = [];
  try {
    // Concurrent writers.
    const base = await fleetBase(ctx, join(ctx.root, 'd5-state'));
    const eight = await startFleet(ctx, base, { count: 8, prefix: 'p' }); all.push(...eight);
    const snap = await base.registry.read();
    const concurrent = { expected: 8, present: eight.filter((p) => snap?.agents[p.id]).length,
      handles_match: eight.every((p) => JSON.stringify(snap?.agents[p.id]?.process) === JSON.stringify(p.handle)),
      platforms: [...new Set(eight.map((p) => snap?.agents[p.id]?.process?.platform))], boot_ids_null: eight.every((p) => snap?.agents[p.id]?.process?.bootId === null) };
    // Lock recovery through relay's own worker fixture, forked under the tracker.
    const lockPath = base.registry.paths.lockPath;
    const worker = ctx.t.fork(join(ctx.clone, 'test/fixtures/lock-worker.js'), ['hold-main', base.env.RELAY_STATE_DIR]);
    const next = () => new Promise((r) => worker.once('message', r));
    await next(); worker.send('start'); await next();
    let holder = null; try { holder = JSON.parse(readFileSync(lockPath, 'utf8')).holder ?? null; } catch (e) { holder = `unreadable: ${e.code ?? e.message}`; }
    await ctx.t.kill(worker.pid);
    const { withLock } = await import(pathToFileURL(join(ctx.clone, 'src/bus/lock.js')).href);
    let recovered = false, value = null; try { value = (await withLock(lockPath, () => 42)).value; recovered = value === 42; } catch (e) { value = e.code ?? e.message; }
    // Reap: kill four, keep four.
    await killParents(ctx, eight.slice(0, 4));
    const reaped = await base.registry.reap();
    const after = await base.registry.read();
    const reap = { removed: eight.filter((p) => !after?.agents[p.id]).map((p) => p.id), kept: eight.filter((p) => after?.agents[p.id]).map((p) => p.id),
      expected_removed: eight.slice(0, 4).map((p) => p.id), expected_kept: eight.slice(4).map((p) => p.id), reaped: reaped.reaped?.length ?? null };
    await killParents(ctx, eight.slice(4));
    // Cost with 0, 10 and 50 live agents: fresh state per size.
    const cost = {};
    for (const n of [0, 10, 50]) {
      const b = await fleetBase(ctx, join(ctx.root, `d5-cost-${n}`));
      const live = await startFleet(ctx, b, { count: n, prefix: `c${n}-` }); all.push(...live);
      const [timed] = await startFleet(ctx, b, { count: 1, prefix: `t${n}-`, extraSteps: (id) => [pretool(id, b.repo), sessionEnd(id, b.repo)] }); all.push(timed);
      const [, pre, end] = timed.steps, ids = live.map((p) => p.id);
      cost[`n${n}`] = { agents: n,
        pretool: { ms: pre.ms, exit: pre.exit, stderr: pre.stderr, allow: pre.exit === 0, retained: sameHandles(pre.before, pre.after, ids) && !!pre.after?.agents[timed.id] },
        sessionend: { ms: end.ms, exit: end.exit, stderr: end.stderr, ending_absent: !end.after?.agents[timed.id],
          revision_delta: (end.after?.revision ?? 0) - (end.before?.revision ?? 0), others_retained: sameHandles(end.before, end.after, ids) } };
      await killParents(ctx, [...live, timed]);
    }
    return { status: 'ran', observations: { concurrent, lock: { holder, recovered, value }, reap, cost } };
  } finally { await killParents(ctx, all); }
}
```

The token's `holder` field follows `src/bus/lock.js`. Before writing this code, confirm it
with `grep -n holder src/bus/lock.js`.

- [ ] **Step 5: Implement D8**

```js
import { writeFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fleetBase, killParents, startFleet } from '../lib/fleet.mjs';
export async function run(ctx) {
  // Reap in a minimal environment, on a fleet of its own (D5's parents are gone by now).
  const base = await fleetBase(ctx, join(ctx.root, 'd8-state'));
  const fleet = await startFleet(ctx, base, { count: 4, prefix: 'q' });
  try {
    const before = await base.registry.read();
    await killParents(ctx, fleet.slice(0, 2));
    const minimal = { HOME: ctx.root, PATH: `/usr/bin:/bin:${dirname(process.execPath)}`, RELAY_STATE_DIR: base.env.RELAY_STATE_DIR };
    const r = await ctx.t.run('/usr/bin/env', ['-i', ...Object.entries(minimal).map(([k, v]) => `${k}=${v}`), process.execPath, join(ctx.clone, 'bin/relay.js'), '--json', 'reap']);
    ctx.log(`reap: exit ${r.exit}\n${r.stdout}${r.stderr}`);
    const after = await base.registry.read();
    const live = fleet.slice(2).map((p) => p.id);
    const reap = { exit: r.exit, kept: Object.keys(after?.agents ?? {}), expected_kept: live,
      handles_unchanged: live.every((id) => after?.agents[id] && JSON.stringify(after.agents[id].process) === JSON.stringify(before?.agents[id]?.process)) };
    // The command relay's installer renders for PreToolUse, from its own hook planner. The
    // installer CLI would demand capability evidence first; rendering needs none.
    const deny = join(ctx.root, 'd8-deny.sh');
    writeFileSync(deny, '#!/bin/sh\nprintf \'{"decision":"deny","reason":"d8 probe"}\'\n', { mode: 0o755 });
    const subs = join(ctx.root, 'xdg/relay/d8-subscribers.json');
    writeFileSync(subs, JSON.stringify({ schema: 1, subscribers: [{ name: 'd8-deny', role: 'guard', kinds: ['before-tool'], harnesses: ['claude-code'], argv: [deny], timeoutMs: 5000 }] }), { mode: 0o600 });
    const { planHooks } = await import(pathToFileURL(join(ctx.clone, 'src/install/hooks.js')).href);
    const rendered = JSON.parse(planHooks({ text: '{}', harness: 'claude-code', relayBin: realpathSync(join(ctx.clone, 'bin/relay.js')), subscribersPath: subs }));
    const command = rendered.hooks.PreToolUse.flatMap((e) => e.hooks).find((h) => / hook /.test(h.command))?.command;
    if (!command) return { status: 'error', reason: 'planHooks rendered no PreToolUse relay command', observations: { reap } };
    const payload = JSON.stringify({ session_id: 'd8', cwd: base.repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' } });
    const h = await ctx.t.run('/bin/sh', ['-c', command], { env: { ...base.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, input: payload });
    return { status: 'ran', observations: { reap, hook_path: { exit: h.exit, denied: h.stdout.includes('"permissionDecision":"deny"'), stderr_head: h.stderr.slice(0, 400), command } } };
  } finally { await killParents(ctx, fleet); }
}
```

`planHooks` is exported by `src/install/hooks.js` and is what `relay install` uses to
write the command. It renders without reading capability evidence, which only the
installer's CLI path (`src/install/capabilities.js`) enforces.

- [ ] **Step 6: Run to see it pass**

Run: `node --test test/darwin-probe-stages-c.test.js`
Expected: PASS (2 tests) on the Linux host. Handles there carry `platform: linux`; the judge
applies the Darwin handle rule only on a Darwin run.

- [ ] **Step 7: Commit**

```bash
git add tools/darwin-probe/lib/fleet.mjs tools/darwin-probe/stages/d5-registry.mjs tools/darwin-probe/stages/d8-launchd.mjs test/darwin-probe-stages-c.test.js
git commit -m "feat(tools): probe registry writers, lock recovery, reap and hook cost under harness parents"
```

---

### Task 8: Stage D6: dispatch replay against the Linux host's replies

**Files:**
- Create: `tools/darwin-probe/stages/d6-dispatch.mjs`
- Test: `test/darwin-probe-stages-d.test.js`

**Interfaces:**
- `replay(ctx) -> [{harness, guard, exit, stdout, ms, survivors}]`: the same function
  builds the bundle's `expected/d6.json` (Task 11) and runs on the Mac.
- `run(ctx)` reads `<bundle>/expected/d6.json`.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedEnv, prepareRoot, tracker } from '../tools/darwin-probe/lib/context.mjs';
import { replay } from '../tools/darwin-probe/stages/d6-dispatch.mjs';
test('replay: allow, deny and a hung guard for both harnesses; the hung guard is killed', { timeout: 60000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dp-')); prepareRoot(root); const tr = tracker(root);
  t.after(async () => { await tr.killAll(); rmSync(root, { recursive: true, force: true }); });
  const rows = await replay({ root, env: isolatedEnv(root), t: tr, clone: process.cwd() });
  assert.equal(rows.length, 6);
  for (const r of rows.filter((x) => x.guard === 'hang')) { assert.deepEqual(r.survivors, []); assert.ok(r.ms < 5000); }
  assert.ok(rows.find((x) => x.harness === 'claude-code' && x.guard === 'deny').stdout.includes('deny'));
});
```

- [ ] **Step 2: Run to see it fail** → FAIL.

- [ ] **Step 3: Implement**

```js
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ps } from '../lib/ps.mjs';
const HANG = '599.4242'; // a unique sleep argument, so a survivor is findable
const GUARDS = {
  allow: (dir) => { const p = join(dir, 'allow.sh'); writeFileSync(p, '#!/bin/sh\nprintf \'{"decision":"allow"}\'\n', { mode: 0o755 }); return [p]; },
  deny: (dir) => { const p = join(dir, 'deny.sh'); writeFileSync(p, '#!/bin/sh\nprintf \'{"decision":"deny","reason":"d6 probe"}\'\n', { mode: 0o755 }); return [p]; },
  hang: () => ['/bin/sleep', HANG],
};
export async function replay(ctx) {
  const dir = join(ctx.root, 'd6'); mkdirSync(dir, { recursive: true });
  const repo = join(dir, 'repo'); mkdirSync(repo); execFileSync('git', ['init', '-q', repo]);
  const rows = [];
  for (const harness of ['claude-code', 'codex']) for (const [guard, argv] of Object.entries(GUARDS)) {
    const subs = join(ctx.root, 'xdg/relay', `d6-${harness}-${guard}.json`);
    writeFileSync(subs, JSON.stringify({ schema: 1, subscribers: [{ name: `d6-${guard}`, role: 'guard', kinds: ['before-tool'], harnesses: [harness], argv: argv(dir), timeoutMs: 2000 }] }), { mode: 0o600 });
    const payload = JSON.stringify({ session_id: `d6-${harness}-${guard}`, cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' } });
    const r = await ctx.t.run(process.execPath, [join(ctx.clone, 'bin/relay.js'), 'hook', '--harness', harness, '--subscribers', subs, 'PreToolUse'], { env: ctx.env, input: payload });
    await new Promise((res) => setTimeout(res, 300));
    const survivors = ps(['-ww', '-axo', 'pid=,args=']).stdout.split('\n').filter((l) => l.includes(`sleep ${HANG}`)).map((l) => Number(l.trim().split(/\s+/)[0]));
    rows.push({ harness, guard, exit: r.exit, stdout: r.stdout, ms: r.ms, budget_ms: 2000, survivors });
  }
  return rows;
}
export async function run(ctx) {
  const expected = JSON.parse(readFileSync(join(ctx.bundle, 'expected/d6.json'), 'utf8'));
  const rows = await replay(ctx);
  const key = (r) => `${r.harness}/${r.guard}`, want = new Map(expected.map((r) => [key(r), r]));
  return { status: 'ran', observations: {
    replies: rows.map((r) => ({ harness: r.harness, guard: r.guard, exit: r.exit, stdout: r.stdout, expected_exit: want.get(key(r))?.exit, expected_stdout: want.get(key(r))?.stdout,
      match: want.has(key(r)) && want.get(key(r)).exit === r.exit && want.get(key(r)).stdout === r.stdout })),
    hang: rows.filter((r) => r.guard === 'hang').map((r) => ({ harness: r.harness, ms: r.ms, budget_ms: r.budget_ms, survivors: r.survivors })) } };
}
```

- [ ] **Step 4: Run to see it pass** → PASS. **Step 5: Commit**

```bash
git add tools/darwin-probe/stages/d6-dispatch.mjs test/darwin-probe-stages-d.test.js
git commit -m "feat(tools): replay guard dispatch against the Linux host's recorded replies"
```

---

### Task 9: Stages D7, D7b, D9: live guard sessions, OpenCode observation, ambient sessions

**Files:**
- Create: `tools/darwin-probe/lib/relay-wrapper.mjs` (a hook entry that records the hook's own ancestry, then runs the committed relay in the same process)
- Create: `tools/darwin-probe/stages/d7-guard.mjs`
- Create: `tools/darwin-probe/stages/d7b-opencode.mjs`
- Create: `tools/darwin-probe/stages/d9-ambient.mjs`
- Create: `tools/darwin-probe/lib/tty.mjs` (prompt on `/dev/tty`; hidden input for the token)
- Test: `test/darwin-probe-stages-e.test.js`

**Interfaces:**
- `tty.mjs`: `ask(question, {hidden}) -> Promise<string|null>`, which returns `null` when
  `/dev/tty` cannot be opened.
- `relay-wrapper.mjs` is installed by D7 at `<clone>/node_modules/.darwin-probe/relay.js`,
  which is gitignored, so the clone stays clean for the ops probe's `relay_snapshot()`. D7
  passes that path to the ops probe as `--relay`. The ops probe then writes it into the
  hook command, and every live `PreToolUse` hook runs as the wrapper process. The
  wrapper reads the hook payload from stdin, records its `session_id`, and passes the same
  bytes to relay's exported `main` through `main`'s `stdin` option. Before calling `main`,
  it appends one JSON line to `$DARWIN_PROBE_HOOKS`:
  `{pid, agent_id, resolved, ancestors: [{pid, ppid, comm, tty, starttime}], captures: [capture(ancestor)]}`,
  where `agent_id` is `<harness>:<session_id>`, the id relay publishes under.
  - `resolved` is the harness adapter's `resolveSessionPid()`.
  - `captures` are the Task 4 three-variant captures of every ancestor up to and
    including the resolved one.

  Relay's code runs unchanged, in the same process, so its ancestry is the real hook's
  ancestry.
- D7 exports `identityProof(agents, invocations, parseRow, harness) -> {agents, matched, ok}`.
  It is pure. An agent is proven only by invocations from its own session, meaning those
  whose `agent_id` equals the agent's registry id. Among those, three things must hold:
  - the invocation resolved exactly the agent's `process.pid`;
  - that pid is in the invocation's recorded ancestry;
  - the ancestor's `-ww` row, parsed by relay's `parseDarwinRow`, has the agent's `start`
    and a `comm` naming the harness (`claude` or `codex` by basename, or Claude's
    version-shaped native name).

  `ok` requires at least one agent and every agent proven. D7 also records
  `hook: {invocations, truncated}`, where `truncated` means any captured ancestor was
  truncated as relay reads it.
- D7b exports `pluginOutcome(logText, pluginPath) -> 'loaded'|'rejected-file'|'load-failed'|'none'`,
  and `PINNED = '2.0.15'`.
- D9 exports `argSummary(argv) -> {argv0_name, role, count}` and
  `stripCapture(capture) -> capture`. `ps` does not preserve argument boundaries, so a
  prompt cannot be reliably separated from other arguments. D9 therefore keeps only what
  recognition needs:
  - `argv0_name`: argv[0]'s basename;
  - `role`: the first argument when it is exactly one of relay's role words (`daemon`,
    `bg-pty-host`) and `other` otherwise;
  - `count`: the number of arguments.

  `stripCapture` drops the text of every `args` variant, keeping only the length and
  truncation properties, so no argument text of a user's session leaves the Mac.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { identityProof } from '../tools/darwin-probe/stages/d7-guard.mjs';
import { pluginOutcome, PINNED } from '../tools/darwin-probe/stages/d7b-opencode.mjs';
import { argSummary, stripCapture } from '../tools/darwin-probe/stages/d9-ambient.mjs';

test('an agent is proven only through its own session\'s hook', () => {
  const parse = (line) => { const [pid, start, comm] = line.split(' '); return { pid: Number(pid), starttime: start, comm }; };
  const inv = (agent_id, pid, start) => ({ agent_id, resolved: pid, ancestors: [{ pid: 99 }, { pid }], captures: [{ pid, forms: { row: { ww: `${pid} ${start} claude` } } }] });
  const A = inv('claude-code:A', 10, '111'), B = inv('claude-code:B', 20, '222');
  assert.deepEqual(identityProof({ 'claude-code:A': { process: { pid: 10, start: '111' } } }, [A, B], parse, 'claude-code'), { agents: 1, matched: 1, ok: true });
  // Agent A carrying session B's handle is not proven by B's evidence.
  assert.equal(identityProof({ 'claude-code:A': { process: { pid: 20, start: '222' } } }, [A, B], parse, 'claude-code').ok, false);
  assert.equal(identityProof({ 'claude-code:A': { process: { pid: 10, start: '999' } } }, [A], parse, 'claude-code').ok, false);
  assert.equal(identityProof({ 'claude-code:A': { process: { pid: 10, start: '111' } } }, [{ ...A, captures: [{ pid: 10, forms: { row: { ww: '10 111 node' } } }] }], parse, 'claude-code').ok, false);
  assert.equal(identityProof({ 'claude-code:A': { process: null } }, [A], parse, 'claude-code').ok, false);
  assert.equal(identityProof({}, [A], parse, 'claude-code').ok, false);
});
test('OpenCode plugin outcomes at the pinned version', () => {
  const p = '/x/plugin';
  assert.equal(PINNED, '2.0.15');
  assert.equal(pluginOutcome(`message="configured plugin path must be a directory" target=${p}/plugin.js`, p), 'rejected-file');
  assert.equal(pluginOutcome(`msg="loading plugin" id=${p}\nmessage="failed to load plugin" target=${p}`, p), 'load-failed');
  assert.equal(pluginOutcome(`msg="loading plugin" id=${p}`, p), 'loaded');
  assert.equal(pluginOutcome('', p), 'none');
});
test('ambient arguments keep only what recognition needs', () => {
  assert.deepEqual(argSummary(['/Users/u/.local/bin/claude', '-p', 'secret', 'project', 'details']), { argv0_name: 'claude', role: 'other', count: 5 });
  assert.deepEqual(argSummary(['2.1.282', 'daemon', 'run']), { argv0_name: '2.1.282', role: 'daemon', count: 3 });
  const c = stripCapture({ pid: 1, label: 'x', truncated: false, forms: { args: { relay: 'claude -p secret project details', columns: 'claude -p secret project details', ww: 'claude -p secret project details', relay_len: 31, ww_len: 31, truncated: false, relay_is_prefix: true }, comm: { relay: 'claude', ww: 'claude' } } });
  assert.equal(JSON.stringify(c).includes('secret'), false);
  assert.deepEqual(c.forms.args, { relay_len: 31, ww_len: 31, truncated: false, relay_is_prefix: true });
});
```

- [ ] **Step 2: Run to see it fail** → FAIL.

- [ ] **Step 3: Implement `tty.mjs`**

```js
import { openSync, closeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { ReadStream, WriteStream } from 'node:tty';
export async function ask(question, { hidden = false } = {}) {
  let fd; try { fd = openSync('/dev/tty', 'r+'); } catch { return null; }
  const input = new ReadStream(fd), output = new WriteStream(fd);
  try {
    if (hidden) input.setRawMode(true);
    output.write(question);
    if (!hidden) { const rl = createInterface({ input, output, terminal: false }); const line = await new Promise((r) => rl.once('line', r)); rl.close(); return line.trim(); }
    let value = '';
    for await (const chunk of input) { const s = String(chunk); if (s.includes('\r') || s.includes('\n')) break; if (s === '\u0003') { value = ''; break; } value += s; }
    output.write('\n'); return value.trim();
  } finally { if (hidden) input.setRawMode(false); input.destroy(); output.destroy(); try { closeSync(fd); } catch {} }
}
```

- [ ] **Step 4: Implement the wrapper and D7**

```js
#!/usr/bin/env node
// relay-wrapper.mjs — installed as <clone>/node_modules/.darwin-probe/relay.js (gitignored).
// Records this hook process's own ancestry as relay will read it, then runs the committed
// relay in this same process, so the recorded ancestry is the hook's real ancestry.
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { fileURLToPath, pathToFileURL } from 'node:url';
const clone = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { createProcessOps, adapterFor } = await import(pathToFileURL(join(clone, 'src/index.js')).href);
const { capture } = await import(process.env.DARWIN_PROBE_PS);
const args = process.argv.slice(2), harness = args[args.indexOf('--harness') + 1];
let stdin = process.stdin;
if (args[0] === 'hook' && process.env.DARWIN_PROBE_HOOKS) {
  // Read the payload once: its session id binds this evidence to one agent, and the same
  // bytes go on to relay.
  const payload = await buffer(process.stdin);
  stdin = Readable.from([payload]);
  let agentId = null; try { agentId = `${harness}:${JSON.parse(payload.toString('utf8')).session_id}`; } catch {}
  let record;
  try {
    const chain = createProcessOps().ancestors(process.pid);
    let resolved = null, error = null; try { resolved = adapterFor(harness).resolveSessionPid(); } catch (e) { error = e.code ?? e.message; }
    const upTo = chain.findIndex((r) => r.pid === resolved);
    const captured = chain.slice(1, upTo >= 0 ? upTo + 1 : Math.min(chain.length, 6));
    record = { pid: process.pid, agent_id: agentId, resolved, error, ancestors: chain.map((r) => ({ pid: r.pid, ppid: r.ppid, comm: r.comm, tty: r.tty, starttime: r.starttime })),
      captures: captured.map((r) => capture(r.pid, `hook-${r.pid}`)) };
  } catch (e) { record = { pid: process.pid, agent_id: agentId, error: e.code ?? e.message }; }
  appendFileSync(process.env.DARWIN_PROBE_HOOKS, `${JSON.stringify(record)}\n`);
}
const { main } = await import(pathToFileURL(join(clone, 'bin/relay.js')).href);
process.exit(await main(args, { stdin }));
```

```js
// stages/d7-guard.mjs
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registryFor } from '../lib/context.mjs';
import { ask } from '../lib/tty.mjs';
const WRAPPER = fileURLToPath(new URL('../lib/relay-wrapper.mjs', import.meta.url));
const PS = new URL('../lib/ps.mjs', import.meta.url).href;
const HARNESS_COMM = { 'claude-code': (c) => c === 'claude' || /^\d+\.\d+\.\d+$/.test(c), codex: (c) => c === 'codex' };
export function identityProof(agents, invocations, parseRow, harness) {
  const list = Object.entries(agents);
  const proven = ([id, a]) => a.process && invocations.some((inv) => {
    if (inv.agent_id !== id) return false;
    if (inv.resolved !== a.process.pid || !inv.ancestors?.some((r) => r.pid === a.process.pid)) return false;
    const row = inv.captures?.find((c) => c.pid === a.process.pid)?.forms?.row?.ww;
    if (!row) return false;
    try { const parsed = parseRow(row); return parsed.starttime === a.process.start && HARNESS_COMM[harness](basename(parsed.comm)); } catch { return false; }
  });
  const matched = list.filter(proven).length;
  return { agents: list.length, matched, ok: list.length > 0 && matched === list.length };
}
const PROVEN = `import json, runpy, sys
proven = runpy.run_path(sys.argv[1])["proven"]
print(json.dumps(bool(proven(json.load(open(sys.argv[2])), json.load(open(sys.argv[3]))))))`;
async function oneHarness(ctx, harness, token) {
  const name = harness === 'claude-code' ? 'claude' : 'codex';
  if ((await ctx.t.run('/usr/bin/which', [name])).exit !== 0) return { status: 'absent', reason: `${name} not installed` };
  const out = join(ctx.root, 'd7'); mkdirSync(out, { recursive: true });
  const hooks = join(out, `${harness}-hooks.jsonl`);
  const env = { ...ctx.env, DARWIN_PROBE_HOOKS: hooks, DARWIN_PROBE_PS: PS };
  if (harness === 'claude-code') {
    if (!existsSync(join(homedir(), '.claude/.credentials.json'))) { if (!token) return { status: 'skipped', reason: 'no credentials file and no token' }; env.CLAUDE_CODE_OAUTH_TOKEN = token; }
  } else if (!existsSync(join(homedir(), '.codex/auth.json'))) return { status: 'skipped', reason: 'codex credentials not in ~/.codex/auth.json (keychain?)' };
  const wrapper = join(ctx.clone, 'node_modules/.darwin-probe/relay.js');
  mkdirSync(join(wrapper, '..'), { recursive: true }); copyFileSync(WRAPPER, wrapper); chmodSync(wrapper, 0o755);
  const probe = join(ctx.opsClone, 'bin/relay-guard-probe');
  const args = ['--harness', harness, '--relay', wrapper, '--guard', join(ctx.opsClone, 'hooks/relay-guard'), '--out', out];
  const pre = await ctx.t.run('python3', [probe, ...args, '--skip-live'], { env });
  ctx.log(`preflight ${harness}: exit ${pre.exit}\n${pre.stderr}`);
  if (pre.exit !== 0) return { status: 'error', reason: `preflight exited ${pre.exit}`, preflight: { allow: false, deny: false } };
  const replay = JSON.parse(readFileSync(join(out, harness, 'results.json'), 'utf8')).replay;
  const preflight = { allow: !!replay?.clean?.reply?.includes('additionalContext'), deny: replay?.attribution?.exit === 2 && replay.attribution.reply.includes('"deny"') };
  if (!preflight.allow || !preflight.deny) return { status: 'ran', preflight, proven: false, hook: { invocations: 0, truncated: false }, handle: { agents: 0, matched: 0, ok: false }, reason: 'preflight replies wrong' };
  const live = await ctx.t.run('python3', [probe, ...args], { env, timeoutMs: 3600000 });
  ctx.log(`live ${harness}: exit ${live.exit}\n${live.stderr}`);
  const results = join(out, harness, 'results.json'), evidence = join(out, harness, 'evidence.json');
  if (!existsSync(results) || !existsSync(evidence)) return { status: 'error', reason: `live run exited ${live.exit} without results`, preflight };
  const again = await ctx.t.run('python3', ['-c', PROVEN, probe, results, evidence]);
  if (again.exit !== 0) return { status: 'error', reason: `proven check exited ${again.exit}: ${again.stderr.slice(0, 200)}`, preflight };
  const invocations = existsSync(hooks) ? readFileSync(hooks, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const { parseDarwinRow } = await import(pathToFileURL(join(ctx.clone, 'src/bus/proc.js')).href);
  const registry = await registryFor(ctx.clone, { ...ctx.env, RELAY_STATE_DIR: join(out, harness, 'state') });
  const snap = await registry.read();
  const summary = JSON.parse(readFileSync(results, 'utf8'));
  return { status: 'ran', credentials: summary.credentials, preflight, proven: JSON.parse(again.stdout),
    hook: { invocations: invocations.length, truncated: invocations.some((i) => i.captures?.some((c) => c.truncated)) },
    handle: identityProof(snap?.agents ?? {}, invocations, parseDarwinRow, harness),
    invocations, summary: { version: summary.version, attempt: summary.attempt, complete: summary.complete, results: summary.results },
    evidence: JSON.parse(readFileSync(evidence, 'utf8')) };
}
export async function run(ctx) {
  if (ctx.platform !== 'darwin') return { status: 'skipped', reason: 'darwin only', observations: {} };
  let token = null;
  if (!existsSync(join(homedir(), '.claude/.credentials.json')))
    token = await ask('Claude Code keeps its login in the Keychain. Run `claude setup-token` in another terminal and paste the token (Enter skips Claude): ', { hidden: true });
  return { status: 'ran', observations: { 'claude-code': await oneHarness(ctx, 'claude-code', token || null), codex: await oneHarness(ctx, 'codex', null) } };
}
```

The ops probe's `relay_snapshot()` runs `git status` and `rev-parse` against the wrapper's
directory, which is inside the clone. `node_modules/` is gitignored, so it sees the clean
recorded commit. The token lives only in the child environment. It is never logged, and it
is not in `ctx.env`, which is what the stage records. Each invocation's `captures` feed
`D7w`; confirmed truncation there blocks the release.

- [ ] **Step 5: Implement D7b**

```js
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { registryFor } from '../lib/context.mjs';
export const PINNED = '2.0.15';
export function pluginOutcome(log, pluginPath) {
  if (log.includes('configured plugin path must be a directory') && log.includes(pluginPath)) return 'rejected-file';
  if (log.includes('failed to load plugin') && log.includes(pluginPath)) return 'load-failed';
  if (log.includes('loading plugin') && log.includes(pluginPath)) return 'loaded';
  return 'none';
}
const freePort = () => new Promise((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
export async function run(ctx) {
  if ((await ctx.t.run('/usr/bin/which', ['opencode'])).exit !== 0) return { status: 'absent', reason: 'opencode not installed', observations: {} };
  const version = /(\d+\.\d+\.\d+)/.exec((await ctx.t.run('opencode', ['--version'], { env: ctx.env })).stdout)?.[1] ?? null;
  const subs = join(ctx.root, 'xdg/relay/subscribers.json'); writeFileSync(subs, '{"schema":1,"subscribers":[]}\n', { mode: 0o600 });
  const configDir = join(ctx.root, 'xdg/opencode'); mkdirSync(configDir, { recursive: true });
  const install = await ctx.t.run(process.execPath, [join(ctx.clone, 'bin/relay.js'), 'install', '--harness', 'opencode', '--subscribers', subs,
    '--config-dir', configDir, '--artifact', join(ctx.root, 'd7b-artifact.json'), '--apply'], { env: ctx.env });
  ctx.log(`install: exit ${install.exit}\n${install.stderr}`);
  if (install.exit !== 0) return { status: 'error', reason: `relay install --harness opencode exited ${install.exit}`, observations: { version, install: { exit: install.exit } } };
  const project = join(ctx.root, 'd7b-project'); mkdirSync(project); execFileSync('git', ['init', '-q', project]);
  const password = randomBytes(18).toString('base64url'), port = await freePort(), base = `http://127.0.0.1:${port}`;
  // The tracker makes the server lead its own process group: `opencode` forks the process that
  // keeps serving, and a signal to the spawned pid alone leaves that child running (observed
  // on the Linux host with v2.0.15).
  const server = ctx.t.spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: ctx.root, env: { ...ctx.env, OPENCODE_SERVER_PASSWORD: password }, stdio: 'ignore' });
  const auth = { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` };
  for (let i = 0; i < 60; i++) { try { await fetch(`${base}/`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  // v2.0.15 creates no project instance at startup; this request names the project, and the
  // plugin loads with that instance.
  const url = `${base}/api/plugin?${new URLSearchParams({ 'location[directory]': project })}`;
  const res = await fetch(url, { headers: auth }).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  const request = { status: res?.status ?? null, directory_match: body?.location?.directory === project };
  const registry = await registryFor(ctx.clone, ctx.env);
  const opencodeAgents = async () => Object.entries((await registry.read())?.agents ?? {}).filter(([id]) => id.startsWith('opencode:'));
  const started = performance.now(); let agents = [];
  while (performance.now() - started < 10000) { agents = await opencodeAgents(); if (agents.length) break; await new Promise((r) => setTimeout(r, 200)); }
  // Every process in the server's group counts as the server: `opencode` forks the one that serves.
  const serverPids = execFileSync('/bin/ps', ['-axo', 'pid=,pgid='], { encoding: 'utf8' }).trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter(([, g]) => g === server.pid).map(([p]) => p);
  const agent = { count: agents.length, scope: agents[0]?.[1]?.scope ?? null, matches_server: agents.length === 1 && serverPids.includes(agents[0][1].process?.pid) };
  // SIGTERM first so the plugin can deliver dispose; then the tracker kills and waits out the group.
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  await new Promise((r) => { const t = setTimeout(r, 10000); server.once('exit', () => { clearTimeout(t); r(); }); });
  await ctx.t.kill(server.pid);
  let gone = (await opencodeAgents()).length === 0, via = gone && agents.length ? 'dispose' : null;
  if (!gone) { await registry.reap(); gone = (await opencodeAgents()).length === 0; via = gone ? 'reap' : null; }
  const logDir = join(ctx.root, 'data/opencode/log');
  const log = readdirSync(logDir).map((f) => readFileSync(join(logDir, f), 'utf8')).join('\n');
  const pluginPath = JSON.parse(readFileSync(join(configDir, 'opencode.json'), 'utf8')).plugin?.[0] ?? '';
  return { status: 'ran', observations: { version, pinned: PINNED, version_match: version === PINNED, install: { exit: install.exit },
    request, plugin_log: pluginOutcome(log, pluginPath.replace(/\/plugin\.js$/, '')), appeared: agents.length > 0, ms: performance.now() - started, agent, after: { gone, via } } };
}
```

- [ ] **Step 6: Implement D9**

```js
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ask } from '../lib/tty.mjs';
import { capture, sampleHarnessRows } from '../lib/ps.mjs';
const ROLES = ['daemon', 'bg-pty-host'];
// ps joins arguments with spaces, so a prompt's boundaries are unknowable; keep only what
// relay's recognition reads (argv[0]'s name and whether argv[1] is a role word).
export const argSummary = (argv) => ({ argv0_name: basename(argv[0] ?? ''), role: ROLES.includes(argv[1]) ? argv[1] : argv.length > 1 ? 'other' : 'none', count: argv.length });
export function stripCapture(c) {
  const { relay, columns, ww, ...facts } = c.forms.args ?? {};
  return { ...c, forms: { ...c.forms, args: facts } };
}
export async function run(ctx) {
  if (ctx.platform !== 'darwin') return { status: 'skipped', reason: 'darwin only', observations: {} };
  const answer = await ask('Optional: open an interactive `claude` (and `claude --bg` or `codex` if you use them) in another terminal, then press Enter. Press Enter now to skip. ');
  if (answer === null) return { status: 'skipped', reason: 'no terminal', observations: {} };
  const { createProcessOps } = await import(pathToFileURL(join(ctx.clone, 'src/index.js')).href);
  const ops = createProcessOps();
  const processes = sampleHarnessRows(['claude', 'codex', 'opencode']).map((r) => {
    let chain = null, args = null, error = null;
    try { chain = ops.ancestors(r.pid).map((x) => ({ pid: x.pid, ppid: x.ppid, comm: x.comm, tty: x.tty })); } catch (e) { error = e.code; }
    try { args = argSummary(ops.argvOf(r.pid)); } catch (e) { args = { error: e.code }; }
    return { pid: r.pid, comm_ww: r.comm_ww, args, chain, error, capture: stripCapture(capture(r.pid, `ambient-${r.pid}`)) };
  });
  return { status: 'ran', observations: { processes } };
}
```

D9 is a finding only. The Task 3 judge does not read it, and it appears in the runbook
verbatim after redaction.

- [ ] **Step 7: Run to see it pass** → `node --test test/darwin-probe-stages-e.test.js` PASS.

- [ ] **Step 8: Pilot D7b on the Linux host** (records the pinned behaviour)

Run: `node -e` is not enough here; use Task 10's entry once it exists:
`node tools/darwin-probe/probe.mjs --allow-linux --stages D7b …` (see Task 12 Step 2).
Expected at v2.0.15: `plugin_log: "rejected-file"`, `appeared: false`,
`request.status: 200`, `request.directory_match: true`.

- [ ] **Step 9: Commit**

```bash
git add tools/darwin-probe/stages/d7-guard.mjs tools/darwin-probe/stages/d7b-opencode.mjs tools/darwin-probe/stages/d9-ambient.mjs tools/darwin-probe/lib/tty.mjs test/darwin-probe-stages-e.test.js
git commit -m "feat(tools): probe live guard sessions, OpenCode observation, and ambient sessions"
```

---

### Task 10: Orchestrator, `run` entry, redaction and packing

**Files:**
- Create: `tools/darwin-probe/probe.mjs`
- Create: `tools/darwin-probe/run` (mode 0755)
- Test: `test/darwin-probe-orchestrator.test.js`

**Interfaces:**
- `probe.mjs --bundle DIR --root DIR [--allow-linux] [--stages D0,D1,…]`:
  1. Verifies the manifest hashes and prerequisites.
  2. Clones `relay.bundle` and `ops.bundle`, then checks the commits and a clean status.
  3. Fingerprints the watched paths.
  4. Runs the stages in order. Each stage's record is written as it completes.
  5. Calls D0's `finish`, then fingerprints again.
  6. Judges the raw results, then redacts the files into `<root>/out`.
  7. Judges the redacted files as packed and writes both verdicts. Each is passed through
     `redactValue` with the same map before writing, so no verdict leaves the Mac
     unredacted, although by construction a verdict carries no stage text. The two are
     compared on their stable fields: `release`, each check's `class` and `verdict`, and
     `cutover`. A difference is printed, and the results are still packed. The Linux host
     rejects them, but their partial evidence is still worth reading.
  8. Packs `<bundle>/relay-darwin-results-<stamp>.tar.gz` and prints the verdict summary.

  On `SIGINT` or `SIGTERM`, it first marks the run as stopping: the tracker refuses new
  children, the stage loop starts no further stage, and a stage that returns after that is
  not recorded. It then kills every owned group, waiting for each to empty, and records
  any survivor in `manifest.cleanup.survivors`. It packs what completed and exits 130 or
  143. The same finalization runs on normal
  completion. It tolerates partial observations: when D0 has run but has no end-of-run
  host reading, finalization takes it; the judge turns anything malformed into an `error`
  verdict.
- At startup, before any stage, `probe.mjs` replaces its own `process.env` with the
  isolated environment (recording first whether the user exported `COLUMNS`). Any relay
  default that reads the ambient environment then lands inside the root too.
- `run`: a POSIX `sh` script. It checks `node` >= 22, creates the root, sets the
  kill-and-remove trap, and executes `probe.mjs`.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneBundle, stableVerdict, verifyManifest } from '../tools/darwin-probe/probe.mjs';

test('a tampered bundle file fails manifest verification', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, 'a.txt'), 'x');
  const manifest = { files: { 'a.txt': '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881' } };
  assert.deepEqual(verifyManifest(d, manifest), []);
  writeFileSync(join(d, 'a.txt'), 'y');
  assert.deepEqual(verifyManifest(d, manifest), ['a.txt']);
});
test('verdicts compare on stable fields only', () => {
  const v = { release: 'pass', cutover: { codex: 'absent' }, checks: { D0: { class: 'release', verdict: 'pass', detail: 'x', findings: ['a'] } } };
  assert.deepEqual(stableVerdict(v), stableVerdict({ ...v, checks: { D0: { ...v.checks.D0, detail: 'y', findings: [] } } }));
  assert.notDeepEqual(stableVerdict(v), stableVerdict({ ...v, release: 'fail' }));
});
test('a bundle verifies and clones outside any repository', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const src = join(d, 'src'); execFileSync('git', ['init', '-q', src]); writeFileSync(join(src, 'f'), 'x');
  const g = (...a) => execFileSync('git', ['-C', src, '-c', 'user.email=p@example.invalid', '-c', 'user.name=p', ...a], { encoding: 'utf8' }).trim();
  g('add', '.'); g('commit', '-qm', 'x'); g('bundle', 'create', join(d, 'r.bundle'), 'HEAD', g('rev-parse', '--abbrev-ref', 'HEAD'));
  const out = join(d, 'nowhere'); mkdirSync(out);
  assert.equal(execFileSync('git', ['-C', cloneBundle(join(d, 'r.bundle'), join(out, 'c'), g('rev-parse', 'HEAD')), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), g('rev-parse', 'HEAD'));
});
test('SIGINT after a normal D0 packs results, fills D0, and leaves no grandchild', { timeout: 90000 }, async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'dp-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  // --self-test-hang runs the real D0, then a stage that respawns `sh` (with two sleeps)
  // whenever it dies, which is the race between cleanup and a resuming stage.
  const child = spawn(process.execPath, ['tools/darwin-probe/probe.mjs', '--self-test-hang', '--root', join(d, 'root'), '--bundle', d], { stdio: 'ignore' });
  const exited = new Promise((r) => child.once('exit', r)); // registered now, so an early exit is not missed
  const ps = () => execFileSync('/bin/ps', ['-axo', 'args='], { encoding: 'utf8' });
  for (let i = 0; i < 100 && child.exitCode === null && !ps().includes('sleep 600.654'); i++) await new Promise((r) => setTimeout(r, 200));
  assert.equal(child.exitCode, null, 'the probe exited before the interrupt');
  child.kill('SIGINT');
  assert.equal(await exited, 130);
  const tarball = readdirSync(d).find((f) => f.startsWith('relay-darwin-results-'));
  assert.ok(tarball);
  const x = join(d, 'x'); mkdirSync(x); execFileSync('tar', ['xzf', join(d, tarball), '-C', x]);
  const d0 = JSON.parse(readFileSync(join(x, 'stages/D0.json'), 'utf8'));
  assert.equal(d0.status, 'ran'); assert.ok(d0.observations.hosts.end);
  assert.ok(JSON.parse(readFileSync(join(x, 'verdict.redacted.json'), 'utf8')).checks.D0);
  assert.deepEqual(JSON.parse(readFileSync(join(x, 'manifest.json'), 'utf8')).cleanup.survivors, []);
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(ps().includes('sleep 600.321'), false); assert.equal(ps().includes('sleep 600.654'), false);
  for (const f of ['verdict.raw.json', 'verdict.redacted.json', 'manifest.json']) assert.equal(readFileSync(join(x, f), 'utf8').includes(homedir()), false, f);
});
```

- [ ] **Step 2: Run to see it fail** → FAIL.

- [ ] **Step 3: Implement `probe.mjs`**

```js
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
```

- [ ] **Step 4: Implement `run`**

```sh
#!/bin/sh
# Entry point on the Mac: ./run [--allow-linux] [--stages D0,D1,...]
set -eu
BUNDLE=$(cd "$(dirname "$0")" && pwd)
command -v node >/dev/null 2>&1 || { echo "node is not installed (brew install node)"; exit 2; }
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ] || { echo "node $major is older than 22 (brew install node)"; exit 2; }
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/relay-darwin-probe.XXXXXX")
cleanup() {
  if [ -f "$ROOT/pids" ]; then while read -r pid; do kill -9 -- "$pid" 2>/dev/null || true; done < "$ROOT/pids"; fi
  rm -rf "$ROOT"
}
trap cleanup EXIT INT TERM
echo "Please close OpenCode (if it is running) for the duration of the probe."
node "$BUNDLE/probe/probe.mjs" --bundle "$BUNDLE" --root "$ROOT" "$@"
```

- [ ] **Step 5: Run to see it pass** → `node --test test/darwin-probe-orchestrator.test.js` PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/darwin-probe/probe.mjs tools/darwin-probe/run test/darwin-probe-orchestrator.test.js
git commit -m "feat(tools): orchestrate the Darwin probe with redaction, packing and interrupt safety"
```

---

### Task 11: Bundle builder and recipes

**Files:**
- Create: `tools/darwin-probe/bundle.mjs`
- Modify: `justfile` (recipes `darwin-bundle`, `darwin-bundle-check`, `darwin-judge`)
- Modify: `.gitignore` (add `dist/`)
- Test: `test/darwin-probe-bundle.test.js`

**Interfaces:**
- `node tools/darwin-probe/bundle.mjs --ops <ops checkout> [--out dist]` prints the tarball
  path. It exports `assertClean(dir)`, `shallowBundle(repo, dest) -> commit`, and
  `build({relay, ops, out}) -> {tarball, manifest}`.
- The bundle layout is `relay-darwin-probe-<short>/` containing:
  - `run`
  - `manifest.json`
  - `relay.bundle` and `ops.bundle`
  - `relay-0.1.0.tgz`
  - `probe/**` (a copy of `tools/darwin-probe`)
  - `expected/d6.json`

  `manifest.json` is `{schema, relay_commit, ops_commit, tarball, opencode_pinned, created, files: {rel: sha256}}`.
  `run` is a copy of `probe/run`, placed at the top level.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertClean, shallowBundle } from '../tools/darwin-probe/bundle.mjs';

const repo = (t) => { const d = mkdtempSync(join(tmpdir(), 'dpb-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', d]); writeFileSync(join(d, 'f'), 'x');
  execFileSync('git', ['-C', d, '-c', 'user.email=p@example.invalid', '-c', 'user.name=p', 'add', '.']);
  execFileSync('git', ['-C', d, '-c', 'user.email=p@example.invalid', '-c', 'user.name=p', 'commit', '-qm', 'x']); return d; };
test('a dirty checkout is refused', (t) => {
  const d = repo(t); assertClean(d); writeFileSync(join(d, 'f'), 'y');
  assert.throws(() => assertClean(d), /dirty/);
});
test('a shallow bundle clones back to the same clean commit', (t) => {
  const d = repo(t), out = mkdtempSync(join(tmpdir(), 'dpo-')); t.after(() => rmSync(out, { recursive: true, force: true }));
  const commit = shallowBundle(d, join(out, 'r.bundle'));
  execFileSync('git', ['clone', '-q', join(out, 'r.bundle'), join(out, 'c')]);
  assert.equal(execFileSync('git', ['-C', join(out, 'c'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), commit);
});
```

- [ ] **Step 2: Run to see it fail** → FAIL.

- [ ] **Step 3: Implement `bundle.mjs`**

```js
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
    execFileSync('git', ['clone', '-q', '--depth', '1', '--no-local', '--branch', branch, `file://${resolve(repo)}`, join(tmp, 's')]);
    if (git(['rev-parse', 'HEAD'], join(tmp, 's')) !== head) throw new Error(`${repo}: shallow clone is not at HEAD ${head}`);
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
```

- [ ] **Step 4: Add the recipes** (append to `justfile`)

```just
# Build the Darwin probe bundle from clean relay and ops checkouts (docs/specs/2026-09-25-darwin-probe.md).
darwin-bundle ops:
    node tools/darwin-probe/bundle.mjs --ops {{ops}}

# Unpack a bundle, clone both Git bundles, and run the ops guard preflight from the unpacked copies.
darwin-bundle-check tarball:
    #!/bin/sh
    set -eu
    d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
    tar xzf "{{tarball}}" -C "$d"; b=$(echo "$d"/relay-darwin-probe-*)
    git clone -q "$b/relay.bundle" "$d/relay"; git clone -q "$b/ops.bundle" "$d/ops"
    mkdir -p "$d/out"
    for h in claude-code codex; do
      command -v "$( [ "$h" = claude-code ] && echo claude || echo codex )" >/dev/null || continue
      python3 "$d/ops/bin/relay-guard-probe" --harness "$h" --relay "$d/relay/bin/relay.js" --guard "$d/ops/hooks/relay-guard" --out "$d/out" --skip-live >/dev/null
      python3 - "$d/out/$h/results.json" <<'PY'
    import json, sys
    r = json.load(open(sys.argv[1]))["replay"]
    assert "additionalContext" in r["clean"]["reply"], r
    assert r["attribution"]["exit"] == 2 and '"deny"' in r["attribution"]["reply"], r
    print("preflight ok:", sys.argv[1].split("/")[-2])
    PY
    done

# Judge a returned results tarball and write docs/runbooks/darwin-probe.md and darwin-evidence.json.
darwin-judge tarball ops:
    node tools/darwin-probe/judge-cli.mjs --tarball {{tarball}} --ops {{ops}}
```

Also append `dist/` to `.gitignore`.

- [ ] **Step 5: Run the tests and the recipe**

Run: `node --test test/darwin-probe-bundle.test.js`, then
`just darwin-bundle <ops checkout>` and `just darwin-bundle-check dist/relay-darwin-probe-*.tar.gz`.

Expected: tests PASS. The bundle builds from clean checkouts. The check prints
`preflight ok: claude-code` and `preflight ok: codex`, which proves the guard's load
closure resolves from the unpacked ops tree.

- [ ] **Step 6: Commit**

```bash
git add tools/darwin-probe/bundle.mjs justfile .gitignore test/darwin-probe-bundle.test.js
git commit -m "feat(tools): build and check the Darwin probe bundle"
```

---

### Task 12: Linux judging CLI, runbook, end-to-end smoke, handoff

**Files:**
- Create: `tools/darwin-probe/judge-cli.mjs`
- Create: `docs/runbooks/darwin-probe.md` (procedure header; attempts are appended by the CLI)
- Modify: `docs/specs/2026-09-25-darwin-probe.md` (status line only, at the end)
- Test: `test/darwin-probe-judge-cli.test.js`

**Interfaces:**
- `node judge-cli.mjs --tarball T --ops OPS`:
  1. Extracts the tarball.
  2. `loadResults`.
  3. Requires `manifest.redaction.files`.
  4. Recomputes `judge`, and requires it to equal both `verdict.raw.json` and
     `verdict.redacted.json`.
  5. For each D7 harness that ran, re-derives `proven` by running ops `proven` at
     `manifest.ops_commit` (`git -C OPS show <commit>:bin/relay-guard-probe` to a temp
     file) on the recorded summary and evidence, and requires it to equal the recorded
     `proven`.
  6. Appends a section to `docs/runbooks/darwin-probe.md` and writes
     `docs/runbooks/darwin-evidence.json`.

  It exits 1 on any mismatch, naming it.
- It exports `renderSection(results, verdict) -> string`.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSection, crossCheck } from '../tools/darwin-probe/judge-cli.mjs';
import { judge } from '../tools/darwin-probe/judge.mjs';
import { passingResults } from './helpers/darwin-results.js';
test('the section names commits, versions, every check and the findings', () => {
  const r = passingResults(), s = renderSection(r, judge(r));
  for (const needle of ['aaaaaaa', '15.6', 'arm64', '2.1.282', '| D5 | release | pass |', 'zombie', 'Cutover']) assert.ok(s.includes(needle), needle);
});
test('any verdict disagreement is refused', () => {
  const r = passingResults(), v = judge(r);
  assert.deepEqual(crossCheck(r, v, v), []);
  assert.deepEqual(crossCheck(r, v, { ...v, release: 'fail' }), ['verdict.redacted.json disagrees with the recomputed verdict']);
});
```

- [ ] **Step 2: Run to see it fail** → FAIL.

- [ ] **Step 3: Implement `judge-cli.mjs`**

```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { judge } from './judge.mjs';
import { loadResults, stableVerdict } from './probe.mjs';
export function crossCheck(results, raw, redacted) {
  const now = JSON.stringify(stableVerdict(judge(results))), problems = [];
  if (JSON.stringify(stableVerdict(raw)) !== now) problems.push('verdict.raw.json disagrees with the recomputed verdict');
  if (JSON.stringify(stableVerdict(redacted)) !== now) problems.push('verdict.redacted.json disagrees with the recomputed verdict');
  if (!results.manifest.redaction?.files) problems.push('manifest has no redaction counts');
  return problems;
}
export function renderSection(results, verdict) {
  const m = results.manifest, d0 = results.stages.D0?.observations ?? {};
  const rows = Object.entries(verdict.checks).map(([id, c]) => `| ${id} | ${c.class} | ${c.verdict} | ${c.detail} |`).join('\n');
  const findings = Object.entries(verdict.checks).flatMap(([id, c]) => c.findings.map((f) => `- ${id}: ${f}`)).join('\n');
  const harness = Object.entries(d0.harnesses ?? {}).map(([n, h]) => `${n} ${h ? `${h.version} (${h.real ?? h.path})` : 'absent'}`).join('; ');
  const d4 = results.stages.D4?.observations;
  return `\n## Attempt ${m.started} — ${m.platform}${m.allow_linux ? ' (smoke)' : ''}\n\n`
    + `relay \`${m.relay_commit}\`, ops \`${m.ops_commit}\`; macOS ${d0.sw_vers?.ProductVersion ?? '-'} (${d0.sw_vers?.BuildVersion ?? '-'}), ${d0.arch}; `
    + `node ${d0.versions?.node}, ${d0.versions?.python3}; harnesses: ${harness}.\n\n`
    + `Release: **${verdict.release}**. Cutover: ${Object.entries(verdict.cutover).map(([k, v]) => `${k} ${v}`).join(', ')}.\n\n`
    + `| Check | Class | Verdict | Detail |\n| --- | --- | --- | --- |\n${rows}\n\n**Findings**\n\n${findings || '- none'}\n`
    + (d4 ? `\n**ps width:** ${d4.table.rows} rows, ${d4.table.over_cut} past the cut, ${d4.table.truncated} truncated as relay reads them; comm holds the ${d4.comm_kind}.\n` : '');
}
async function main() {
  const { values } = parseArgs({ options: { tarball: { type: 'string' }, ops: { type: 'string' } } });
  const dir = mkdtempSync(join(tmpdir(), 'dpj-'));
  try {
    execFileSync('tar', ['xzf', values.tarball, '-C', dir]);
    const results = loadResults(dir), read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const problems = crossCheck(results, read('verdict.raw.json'), read('verdict.redacted.json'));
    const probe = join(dir, 'relay-guard-probe');
    writeFileSync(probe, execFileSync('git', ['-C', values.ops, 'show', `${results.manifest.ops_commit}:bin/relay-guard-probe`]));
    for (const [h, o] of Object.entries(results.stages.D7?.observations ?? {})) {
      if (o.status !== 'ran' || !o.summary) continue;
      const s = join(dir, `${h}-summary.json`), e = join(dir, `${h}-evidence.json`);
      writeFileSync(s, JSON.stringify({ harness: h, ...o.summary })); writeFileSync(e, JSON.stringify(o.evidence));
      const again = JSON.parse(execFileSync('python3', ['-c', 'import json,runpy,sys; p=runpy.run_path(sys.argv[1])["proven"]; print(json.dumps(bool(p(json.load(open(sys.argv[2])),json.load(open(sys.argv[3]))))))', probe, s, e], { encoding: 'utf8' }));
      if (again !== o.proven) problems.push(`D7 ${h}: recorded proven ${o.proven}, recomputed ${again}`);
    }
    if (problems.length) { process.stderr.write(`${problems.join('\n')}\n`); process.exit(1); }
    const verdict = judge(results);
    appendFileSync('docs/runbooks/darwin-probe.md', renderSection(results, verdict));
    writeFileSync('docs/runbooks/darwin-evidence.json', `${JSON.stringify({ manifest: results.manifest, verdict }, null, 2)}\n`);
    process.stdout.write(`release: ${verdict.release}\n`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main();
```

The D7 summary the stage records must carry every field `proven` reads: `harness`,
`version`, `attempt`, `complete`, `results`. Task 9's `oneHarness` records all of them,
and the CLI adds `harness`.

- [ ] **Step 4: Write the runbook header** (`docs/runbooks/darwin-probe.md`)

```markdown
# Darwin live probe

The physical Darwin validation relay's release requires (`relay-c19c0a`), run from a
bundle on a Mac. Design: `docs/specs/2026-09-25-darwin-probe.md`; plan:
`docs/plans/2026-09-25-darwin-probe.md`.

## Procedure

1. On the Linux host, from clean relay and ops checkouts:
   `just darwin-bundle <ops checkout>`, then `just darwin-bundle-check dist/relay-darwin-probe-<sha>.tar.gz`.
2. Copy the tarball to the Mac. There: `tar xzf relay-darwin-probe-<sha>.tar.gz && cd relay-darwin-probe-<sha> && ./run`.
   Prerequisites: Node >= 22, the Xcode Command Line Tools, python3 >= 3.11. Close OpenCode first.
3. Copy `relay-darwin-results-<stamp>.tar.gz` back and run `just darwin-judge <tarball> <ops checkout>`.
   Commit the appended section and `darwin-evidence.json`.

OpenCode is pinned to v2.0.15 (request `GET /api/plugin?location[directory]=<dir>`, Basic
auth `opencode:$OPENCODE_SERVER_PASSWORD`). At that version relay's plugin is rejected
until `relay-d0a8df` lands, so D7b's cutover verdict is expected to fail.

## Attempts
```

- [ ] **Step 5: Run the tests** → `node --test test/darwin-probe-judge-cli.test.js` PASS.
  Then run the whole suite: `just test-fast` → PASS.

- [ ] **Step 6: End-to-end Linux smoke through the real bundle**

Run the smallest version that exercises every gate end to end first:
1. `just darwin-bundle <ops checkout>` and `just darwin-bundle-check <tarball>`.
2. Unpack into a temporary directory and run `./run --allow-linux --stages D0,D1,D2,D5,D6,D7b,D8`.
3. Then `just darwin-judge <results tarball> <ops checkout>` into a scratch copy of the
   runbook. Use `git stash` or a throwaway branch: a smoke section is never committed.

Expected:
- `release: smoke`.
- D0, D1, D2, D5, D6 and D8 pass.
- D7b is recorded with `plugin_log: "rejected-file"`, `request.status: 200` and
  `directory_match: true` (the pinned v2.0.15 behaviour).
- The CLI's cross-check passes.
- `host-load --section session` shows nothing left running, including no `opencode serve`
  child from D7b.

If any stage errors, read its `logs/<ID>.log` inside the results tarball before changing
anything.

- [ ] **Step 7: Update the spec status, commit, hand off**

Set the spec's status line to "implemented; awaiting the physical Mac run, <date>". Then:

```bash
git add tools/darwin-probe/judge-cli.mjs docs/runbooks/darwin-probe.md docs/specs/2026-09-25-darwin-probe.md test/darwin-probe-judge-cli.test.js
git commit -m "feat(tools): judge returned Darwin results and record them in the runbook"
```

Build the final bundle from the merged commit, run `just darwin-bundle-check`, and park
`relay-b12132` waiting on the user:
`tasks park relay-b12132 "User runs dist/relay-darwin-probe-<sha>.tar.gz on the Mac (./run) and returns the results tarball; agent then runs just darwin-judge and files any failed gate" --waiting-on user --reason environment`.
