# The Darwin live probe

Status: implemented; awaiting the physical Mac run, 2026-09-25. Drafted 2026-09-25 and
revised after the first review (bundle checkouts, ops closure, harness-parented
publishers, OpenCode scope, redaction invariance, the `SessionEnd` gate), then after the
second (OpenCode data and cache isolation, a
project-scoped request to initialize OpenCode's plugin, D8's own live/dead fixture).
Task: `relay-b12132`; gated `relay-c19c0a` (publish v0.1.0) until 2026-10-18.
Status update 2026-10-18: the probe no longer gates publication. The physical run is
`relay-848c0f`, and it gates installing relay hooks on a Mac; v0.1.0 published on Linux
evidence (`docs/runbooks/release.md`). "Release gate" below names checks that gate that run.
Parent design: ops `docs/specs/2026-09-16-relay-design.md` (approved after `d7e2c33`),
sections "Handle encodings", "Process identity and liveness" and "Required verification
for the release". Execution brief: ops `docs/plans/2026-09-16-relay-bootstrap.md`, which
keeps "physical Darwin validation remains a release gate"; README and `docs/api.md` say
the same.
Scope: a self-contained bundle, run once by the user on a physical Mac, that exercises
every relay behaviour whose correctness depends on Darwin, returns redacted evidence, and
is judged on the Linux host. It adds no relay runtime behaviour; the defects it finds are fixed
in their own tasks.

## Why

Relay's Darwin paths have run only as fixture strings and mocks on Linux. An inventory of
the source on 2026-09-25 found these untested assumptions:

1. **`ps` width.** Relay calls `/bin/ps` without `-ww`. BSD `ps` writing to a pipe is
   believed to cut the last column near 79 characters unless `COLUMNS` is set, and `comm`
   is that column. A cut path (`…/claude/versions/2.1.280`, an npm Codex vendor path)
   parses without error, so harness recognition would fail silently (`src/bus/proc.js`
   `runDarwinPs`, `parseDarwinRow`, `argvOf`).
2. **What `comm` holds.** Relay's session-process spec (line 98) treats Darwin `comm` as
   the unabbreviated executable path; BSD `ps` may report argv[0] instead. The Claude
   adapter's version-shaped check and `executableOf` (which on Darwin has no absolute-path
   check) depend on the answer.
3. **Time zone.** A Darwin handle's `start` is `lstart` read as local time. Publisher and
   prober agree only if `ps` and Node interpret the same zone the same way; if they don't,
   live agents look `process replaced` and `relay reap` deletes them.
4. **Host name.** The Darwin `host` is `os.hostname()`, which can change with the network
   when no `HostName` is set. A changed host makes every handle `unknown`: nothing is
   reaped and a dead lock holder is never judged dead.
5. **No zombie state.** Darwin rows carry `state: null`, so a zombie with the same start
   reads `alive`.
6. **Cost.** Every Darwin process read spawns `ps`, synchronously. A hook pays for one
   table walk, argv reads, and one probe per registered agent. The tightest installed
   budget is Codex `SessionEnd` at 3 s.
7. **Hook `PATH`.** An installed hook runs `'<relay.js>' hook …` through `#!/usr/bin/env
   node`. A harness launched from a GUI inherits launchd's `PATH`
   (`/usr/bin:/bin:/usr/sbin:/sbin`), which has no Homebrew or nvm Node, so the hook would
   exit 127. That is a non-blocking hook error, so guards would fail open.
8. **Tests that weaken on Darwin.** `proc.test.js` returns early from its real
   `executableOf` test off Linux, `lock.test.js` skips its Darwin loop cases, and
   `transaction.test.js` asserts only on Linux. `cli-surface.test.js` needs Python 3.11.

The user's MacBook is not reachable from the Linux host. On 2026-09-25 they chose a bundle they
copy over and run, rather than ssh.

## Shape

```
Linux host                               Mac                                Linux host
just darwin-bundle  --copy-->  ./run  --> results tarball  --copy-->  just darwin-judge
 (clean relay + ops commits)     (live probe, local verdict)            (authoritative verdict,
                                                                         runbook + evidence)
```

Three units, each testable on its own:

- **Bundle builder** (`tools/darwin-probe/bundle`, recipe `just darwin-bundle`). Refuses a
  dirty relay or ops checkout. Writes `dist/relay-darwin-probe-<relay short sha>.tar.gz`
  (gitignored) holding:
  - `relay.bundle` and `ops.bundle`: single-commit Git bundles (`git bundle create` from a
    `--depth 1` clone) of relay `HEAD` and ops `HEAD`;
  - the `npm pack` tarball of that relay commit, which already bundles `jsonc-parser`;
  - the probe files;
  - `manifest.json` with both commit ids and a sha256 per file.

  Ops ships whole rather than as a file list, because the guard's load closure is not
  three files: `hooks/relay-guard` loads `hooks/claude-pretooluse`, which loads
  `hooks/claude-posttooluse`, `bin/tt` and `bin/ops-profile`, and that set changes as
  ops changes. The ops tree is about 3.5 MB.
- **Live probe** (`run`, a POSIX `sh` entry, and `probe.mjs`). Runs the stages below,
  writes raw observations, runs the judge locally so the user sees a verdict at the Mac,
  and packs `relay-darwin-results-<timestamp>.tar.gz` beside the bundle.
- **Judge** (`judge.mjs`). Pure functions from a results directory to a verdict per check.
  Unit-tested on Linux against fixture result directories. The Linux host's run over the returned
  tarball is the authoritative verdict.

**Checkouts on the Mac.** `run` verifies each Git bundle (`git bundle verify`), clones
it into the probe root, and requires `git rev-parse HEAD` to equal the manifest's commit
and `git status --porcelain` to be empty. The relay clone gets its one runtime dependency
by copying `jsonc-parser` out of D1's installed package into `node_modules/`, which relay
gitignores, after checking its version against the clone's `package-lock.json`. The ops
guard probe then runs unchanged against `<relay clone>/bin/relay.js`: its
`relay_snapshot()` reads a real, clean checkout at the recorded commit before preflight
and before every live run, exactly as on the Linux host.

The probe observes; it does not patch relay. For example, it records `ps` output with and
without `-ww` so the evidence shows whether relay needs the flag, but it runs relay as
committed.

## Running it

The user copies the bundle to the Mac (AirDrop, Dropbox, or a USB stick), then:

```sh
tar xzf relay-darwin-probe-<sha>.tar.gz && cd relay-darwin-probe-<sha> && ./run
```

`run` verifies the manifest hashes, then checks prerequisites and stops with one line
naming anything missing:
- macOS;
- Node >= 22 (`brew install node`);
- the Xcode Command Line Tools (`xcode-select -p`), because `/usr/bin/git` is a shim
  without them and relay's identity step runs git;
- `python3` >= 3.11 (`brew install python`), which relay's `cli-surface` test and the ops
  guard probe need.

Two optional moments ask the user something (D7's credential token and D9's ambient
sessions); pressing Enter skips either. Expected wall clock is about 10 minutes, most of
it the live harness sessions.

Isolation: every file the probe writes lives under one root
(`/tmp/rdp.XXXXXX`: short, because macOS's `TMPDIR` under `/var/folders` would push a
constructed parent's path, which Darwin's `comm` holds in full, past the width plain `ps`
gives relay). For every process it launches, it sets
`RELAY_STATE_DIR`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME`,
`XDG_CACHE_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `TMPDIR` inside that root. The data and
cache variables matter for D7b: OpenCode keeps its logs and data under
`~/.local/share/opencode` and its cache under `~/.cache/opencode`. The probe never writes
`~/.claude`, `~/.codex`, `~/.config/relay`, `~/.local/state/relay`, `~/.config/opencode`,
`~/.local/share/opencode`, `~/.cache/opencode` or any live hook configuration, apart from
the guard probe's login write-back below. `run`
records the recursive mtimes and file counts of those paths before and after, and a
change fails the attempt. The "after" reading is taken just before D9, which invites the
user's own live sessions; what changes from there to the end is recorded as a finding,
not gated. One change is expected: the ops guard probe writes a harness's refreshed login
back to `~/.codex/auth.json` or `~/.claude/.credentials.json` (ops-4130ea). D7 reads that
file just before and after the live run it drives, and a change whose run-wide readings
equal D7's own is recorded as written back, a finding; any other change to it still fails. The probe handles `INT`, `TERM` and `HUP` itself (a closed terminal included):
it kills every pid it spawned (listed in `pids`) and packs the results. `run`'s `EXIT`
trap kills anything still listed and removes the root, keeping only the results tarball,
unless node ended abnormally (a kill, or the probe's own crash, which it reports as exit
70), in which case it keeps the root, deletes any `.credentials.json` or `auth.json` copy
from it, and names it as unredacted. On macOS `run` holds `caffeinate -i` for its
lifetime. `--stages` selects stages but never reorders them: they run in the order of
this document. Before packing, the raw and the redacted results are scanned for a
`.credentials.json` or `auth.json` file, for the Claude token and for a JWT-shaped token
(Codex's login); a hit names the files and nothing is packed.

## Checks

Each check has an id and a pass condition the judge evaluates from raw observations.
Checks fall into three classes:
- **Release gate** blocked `relay-c19c0a`; since 2026-10-18 it gates `relay-848c0f` (Darwin hooks).
- **Cutover evidence** feeds `ai-539508`: a platform without it stays uncut-over, but the
  release does not wait for it.
- **Finding** is recorded and reported without gating, because no spec states the Darwin
  answer yet. Each finding becomes a relay idea.

### D0 Environment — release gate

Records:
- `sw_vers` and `uname -m`;
- Node, npm, git and python3 versions, and `xcode-select -p`;
- each harness's version and resolved executable path (`claude`, `codex`, `opencode`),
  which tells native, Homebrew and npm installs apart;
- `TZ`, and the zone name from `readlink /etc/localtime`;
- `os.hostname()` plus `scutil --get HostName`, `LocalHostName` and `ComputerName`, taken
  at the start and again at the end.

Gate: the record is complete and every prerequisite is met. **Finding:** whether
`HostName` is unset, which is the case where item 4's host drift can happen, and whether
the host name changed during the run.

### D1 Package — release gate

Install the relay tarball with `npm install --offline` into an empty project with an empty
cache. Run `relay --help`, and `relay list --json` against an empty state directory.
Import every named export and both packaged fixtures. Gate: every command exits 0 and
every export is defined. This proves the published artifact installs and loads on
Darwin.

### D2 Suite — release gate

Run `npm test`'s file set in the relay clone, less the probe's own `test/darwin-probe-*.test.js` (they repeat D5 and D8 and must not gate relay's release; the number excluded is recorded), and record each test's result. Gate: no failure. The evidence also carries, by name, the three places
that weaken on Darwin (item 8). Each must be covered by a live check here: the
`executableOf` early return by D4, the lock Darwin cases by D5's lock recovery, and the
transaction assertion by D5's publishers, whose snapshot handles must carry
`platform: darwin` and `bootId: null`. Otherwise it is listed as uncovered.

### D3 Process identity — release gate

Spawns a `sleep` child and compares relay's `handleOf(pid)` with an independent reading
(`ps -o lstart=` converted by `date -j -f`, not by relay's parser). Then, with the same
child:

- it computes the handle under `TZ=UTC` and probes under `TZ=Pacific/Chatham`, and the
  reverse, and each time also with `TZ` unset against an explicit zone. The verdict is
  `alive` every way, because the spec requires every reader to agree on the same epoch
  seconds (item 3);
- `probe` returns `alive` / `qualified process matches`, and after `SIGKILL` and wait
  returns `dead` / `process absent`;
- a handle with the right pid and a start one second off returns `dead` / `process
  replaced`;
- a handle naming another host returns `unknown` / `foreign host`, and one with
  `platform: linux` returns `unknown` / `foreign platform`;
- `handleOf(1)` (launchd) yields a valid handle with `bootId: null`.

Gate: every comparison holds. **Finding:** what `probe` answers for a zombie child
(item 5).

### D4 Process table, ancestry and arguments — release gate

Raw capture first. Every `ps` form relay uses (`-axo pid=,ppid=,tty=,lstart=,comm=`,
`-p <pid> -o comm=`, `-p <pid> -o args=`) runs with stdout piped in three variants:
- as relay runs it;
- with `COLUMNS=500`;
- with `-ww`.

The capture targets are the constructed processes below and, in D7 and D9, real harness
processes. The judge compares the variants field by field. Truncation in relay's variant
on any row whose full path is longer than the cut is recorded as the item-1 defect.

Every constructed process below is a *constructed parent*: `tools/darwin-probe/lib/parent.c`,
compiled on the host with `cc` (the Command Line Tools provide it) and copied under the
harness's name. `parent CMD [ARGS...]` runs its command as a child, waits for it, then
blocks until the probe kills it. It is not a copy of `/bin/sh`: macOS refuses to launch a
copied Apple platform binary from `/tmp`, which killed the first Mac attempt's D4, D5 and
D8 parents before they ran anything. Before D4, D5 and D8 use one, the probe runs a
parent named `codex` with a `node` payload that writes a file, and a parent that cannot
run is one stage error within five seconds.

Then:
- **A constructed chain.** `script` owns a pseudo-terminal and runs a constructed parent
  named `claude`, placed under a long directory path so that the executable path exceeds
  100 characters. That parent runs a `node` child. The check compares `ancestors()` with
  an independent `ps -axo pid,ppid` walk, the recorded `tty` with `ps -o tty=`, and the
  Claude adapter's handle resolution with the process the chain was built to name.
- **A Claude-shaped native install.** A constructed parent is placed at
  `<root>/…/claude/versions/9.9.9` and started under the name `9.9.9`. The check runs
  the version-shaped recognition rule and `executableOf` on it.
- **`argvOf`** runs on a process whose executable path and arguments contain spaces.

Gate:
- ancestry, tty and the constructed chain's resolution match;
- `executableOf` returns an absolute path;
- an argument boundary relay cannot establish fails closed with `PROCESS_UNREADABLE`,
  never as a wrong argv;
- relay's own variant of every capture is complete, or the judge names the truncation.

**Finding:** whether Darwin `comm` is the executable path or argv[0] (item 2). The
evidence corrects the session-process spec's line 98 either way. It takes both parents:
the native one (argv[0] `9.9.9`, not its path) separates the path from argv[0], and the
chain one (argv[0] is its path, not its file name `claude`) separates argv[0] from the
file name. The second Mac run read the chain parent alone and reported "path". Answered by the second
Mac run: `comm` is argv[0], so relay now reads the executable from `lsof` (relay-7eef39),
and D4's native case is recognized only when `lsof` lists the executable first.

### D5 Registry, lock and cost — release gate

This check uses a disposable state directory, and every publisher runs under a
constructed harness parent. A hook launched directly by the probe has no recognized
harness ancestor, so relay would correctly publish `process: null` and nothing
Darwin-specific would be tested. The parent is a constructed parent (D4) at a short path
(`<root>/p/codex`), started as `codex`, so the Codex adapter's rule (nearest ancestor
whose `comm` is `codex`, no terminal required) names it. The short path keeps this check
independent of the D4 width question. Each parent runs `relay hook --harness codex
SessionStart` on a payload with its own session id and a git-initialized cwd, as its
child, and then blocks until the probe kills it. For each parent the probe records `handleOf(parent pid)` independently
before the hook runs.

- **Concurrent writers.** Eight parents publish at once, and the final snapshot holds
  all eight agents. Each agent's `process` equals its parent's recorded handle, with
  `platform: darwin` and `bootId: null`.
- **Lock recovery.** The probe reuses the relay clone's `test/fixtures/lock-worker.js`
  as `lock-multiprocess.test.js` does. A forked worker in `hold-main` mode reports
  `entered` while holding the lock and is then killed with `SIGKILL`. The probe records
  the lock token's holder handle, which must be Darwin-qualified. The next `withLock`
  must judge that holder dead through its Darwin handle and return its value. This
  exercises the lock Darwin cases that `lock.test.js` skips.
- **Reap.** Four of the eight parents are killed with `SIGKILL` and waited on. `relay
  reap` removes exactly those four agents and keeps the four whose parents are alive.
- **Cost.** With 0, 10 and 50 live parent-published agents registered, the probe times a
  `PreToolUse` hook and a Codex `SessionEnd` hook, each issued from under one more live
  constructed parent (item 6).

Gate:
- the first three hold;
- with 10 agents, the Codex `SessionEnd` hook exits 0 within its installed 3000 ms
  budget. Its reply and diagnostics carry no error. In the snapshot that follows, the
  ending agent is absent, the revision advanced by one, and the other 10 agents are
  present with unchanged handles;
- with 10 agents, the `PreToolUse` hook exits 0 with an allow reply and leaves every
  agent present.

A failed or timed-out hook therefore fails the gate however fast it returned. The
50-agent timings are a finding. All parents are released and reaped before D5 ends.

### D6 Dispatch without a harness — release gate

Replays recorded Claude Code and Codex `PreToolUse` payloads through `relay hook` with
three guards: one that allows, one that denies, and one that hangs. Gate: the allow and
deny replies byte-match the Linux host's replay of the same inputs, the hanging guard is refused
within its budget, and no guard process survives (checked with `ps`).

### D7 Live guard sessions: Claude Code and Codex — cutover evidence

Guard proof applies only to Claude Code and Codex. Those are the harnesses the ops
runner accepts and the only ones with a `PreToolUse` guard reply channel; OpenCode is D7b.
For each of the two installed on the Mac, D7 first runs the ops probe's preflight
(`bin/relay-guard-probe --skip-live`) from the ops clone against the relay clone. That
preflight replays the clean and attribution inputs through the unpacked guard and must
return the allow and deny replies before any live run starts. It then runs ops
`bin/relay-guard-probe` as on the Linux host, which produces a Darwin evidence record. It
adds two things:
- during each run a sampler takes the D4 `ps` captures once a second, bounded to the run;
- after each run it reads the disposable registry and checks that the published
  `Agent.process` handle names the harness process that ran the hook: an ancestor of the
  recorded hook pid whose executable is the harness.
- after the live runs it copies each run's exit, duration and the head of its stderr and
  stdout (the ops probe's `runs/<attempt>/<name>/`, which stay outside the results) into
  `logs/D7.log`, so a failed harness run is diagnosable from the tarball.

Of these two harnesses, one that is not installed is recorded as absent. Gate: for each
installed one, the preflight replies match, the ops predicate `proven(summary, record)` holds (with the Linux host's `PENDING` entry for
Codex's nested route) and the handle check passes. A handle check that fails because
`comm` was truncated is the item-1 defect: it is filed against relay and blocks the
release too.

Credentials: the ops probe copies `~/.claude/.credentials.json` and `~/.codex/auth.json`
into the disposable config, and afterwards writes a login the harness refreshed there back
to the live file, if the live file is unchanged (ops-4130ea): a refresh rotates the token,
so the live copy would otherwise stop working. Claude Code on macOS keeps its login in the Keychain, so the
file may not exist. When it is missing (and `claude` is on `PATH`), `run` asks at startup, before
any stage, for the user to run `claude setup-token` and paste the token, or press Enter to
skip Claude. It passes the token to the Claude
runs as `CLAUDE_CODE_OAUTH_TOKEN` and never writes it to disk or to results. This needs
one ops change, made in this task's plan: today `bin/relay-guard-probe` copies the
credentials file unconditionally and raises `FileNotFoundError` without it. With
`CLAUDE_CODE_OAUTH_TOKEN` set, it will skip the copy for Claude Code and record
`"credentials": "token"` in the summary. The bundle carries the ops commit that contains
this change. If Codex keeps its credentials in the Keychain instead, Codex D7 is recorded
as skipped with that reason.

### D7b OpenCode observation — cutover evidence

When OpenCode is installed, relay's plugin is installed into the disposable config only:
`relay install --harness opencode --config-dir <root>/xdg/opencode --apply`, with every
XDG variable pointing into the probe root (see Isolation). The probe creates a
git-initialized disposable project under the root and starts OpenCode headless
(`opencode serve` on a loopback port) from the probe root.

Starting the server is not enough. Upstream `opencode serve` creates no project instance
at startup; it initializes one per request for the project the request names, and
plugins load with that instance. So once the server answers, the probe sends one
read-only HTTP request scoped to the disposable project directory (for example, listing
its sessions). The plan picks the route and the directory-scoping mechanism from the
installed version's server and records both. It then polls the registry, bounded at
10 seconds, until an `opencode:` agent appears. The server is then stopped with
`SIGTERM`. No model call is needed, because the plugin publishes on instance load
(`init`) and on shutdown (`dispose`).

Gate:
- the scoped request returned success;
- the agent appeared within the bound;
- the registry holds exactly one `opencode:` agent, with `scope: process`, whose
  `process` handle names the OpenCode server process;
- after shutdown, that agent is gone. Either dispose was delivered, or `relay reap`
  removed it as dead; the evidence records which. No guard or reply is involved. When OpenCode is not
installed, D7b is recorded as absent.

### D8 Launchd environment — release gate and cutover evidence

- **Reap in a minimal environment.** D8 builds its own fixture in a fresh state
  directory, because D5's cleanup has killed every D5 parent. Four constructed `codex`
  parents publish as in D5, and two of them are killed with `SIGKILL` and waited on.
  `relay reap` then runs under
  `env -i HOME=<root> PATH=/usr/bin:/bin:<node dir> RELAY_STATE_DIR=<D8 state>`, the
  minimal environment a scheduled job receives, while the other two parents are still
  alive. Release gate: exit 0, and the snapshot holds exactly the two live parents'
  agents, with unchanged handles. The live parents are released and reaped only after
  the snapshot is read.
- **Hook under launchd's `PATH`** (item 7). The probe renders the exact hook command
  string that `relay install` would write, and runs it with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`
  on a recorded `PreToolUse` payload, with a denying guard subscribed. It records the
  exit code and whether the denial arrived. Cutover evidence: a denial that did not
  arrive means guards fail open for GUI-launched harnesses on this Mac, and `ai-539508`
  must not cut over Darwin until relay's installer writes an absolute Node path or an
  equivalent. That fix is a relay task, not this one.

### D9 Ambient sessions — finding, optional

Before D7, `run` offers: "Open an interactive `claude` (and, if you use it, `claude --bg`
and `codex`) in another terminal, then press Enter; or press Enter to skip." It then takes
the D4 captures of every running `claude`, `codex` and `opencode` process and its
ancestors. It runs relay's recognition, handle resolution and terminal lookup offline over
those rows. This is read-only: no hooks and no registry writes. It covers the
TTY-owning, background (`bg-pty-host`, `daemon`) and GUI-launched shapes that headless D7
cannot, and it supplies the Darwin background chain the session-process spec asks for.
The rows keep only the process columns and the harness's own arguments, with the prompt
text of any `-p` argument replaced by `<prompt>`.

## Evidence and redaction

Results hold raw observations per stage (JSON), stderr logs, and verdicts. Redaction must
not change any verdict, so it is built in three parts.

**Facts that depend on raw values are recorded as properties at capture time.** Examples
are string lengths, whether a `comm` value is absolute, whether a relay capture is a
strict prefix of its `-ww` twin, and whether two host readings are equal. The probe
stores them as booleans and numbers beside the text they describe. The judge reads the
properties, never lengths or shapes recomputed from redacted text, and redaction never
alters a boolean or a number. The full `ps -axo` table is not kept, because it lists
every app on the Mac. The probe keeps only rows in the chains it constructed or sampled,
plus table-wide counts: rows, rows over the cut, and rows truncated.

**Identities stay distinct.** Each distinct host string observed anywhere (D0's four
names at both readings, handle `host` fields) maps to `<host-1>`, `<host-2>`, … in order
of first appearance. So a changed host remains visible as two tokens, and D3's foreign
host remains a third. The home directory `/Users/<name>` becomes `/Users/<user>`: the
user-name component is replaced, but the path stays absolute and keeps its structure.
The user name elsewhere becomes `<user>`. The mapping never leaves the Mac: it is
neither written to results nor printed.

**Verdicts must survive redaction.** Before packing, `run` runs the judge over the raw
results and again over the redacted copy, and stores both verdict sets. The Linux host's
judge recomputes the verdicts from the redacted results and accepts the attempt only if
all three are identical, check by check. The manifest also records per-file replacement
counts, and the judge rejects a results tarball without them.

No credential file or token is copied into the results root; `run` fails if one is found
there, using the same check as the ops probe's final `find`.

On the Linux host, `just darwin-judge <tarball>` verifies the manifest and re-derives every
verdict. It writes `docs/runbooks/darwin-probe.md`, with one section per attempt covering:
- the Mac's architecture and macOS version;
- harness versions and install kinds;
- the relay and ops commits;
- the check table and the findings;
- the `ps` width comparison;
- skips and uncovered cases.

It also writes `docs/runbooks/darwin-evidence.json`. D7's per-harness evidence records
move to ops as Darwin variants of `relay-guard-evidence-<harness>.json` during
`ai-539508`'s cutover, not in this task.

## Failure handling

A failed release gate means a relay defect or a probe defect. The judge names the check
and its raw observation. The fix is filed as a relay task, `relay-c19c0a` stays blocked
on `relay-b12132`, and the user reruns a new bundle. A partial run still packs results,
so completed stages are analyzed before any rerun. Expected candidates, filed only if the
evidence confirms them:
- `-ww` on every relay `ps` call (item 1);
- an absolute Node path in installed hook commands (item 7);
- a Darwin zombie read (item 5);
- a documented `HostName` precondition (item 4).

## Testing the probe itself

- The judge is covered by unit tests over fixture result directories: one passing, and
  one per check with that check's failure.
- The bundle builder is tested on the Linux host. It refuses dirty checkouts, and its
  output holds exactly the manifest's files with matching hashes. The test then unpacks
  the output into a temporary directory and clones both bundles, checking the recorded
  commits and a clean status. It runs the ops preflight
  (`bin/relay-guard-probe --skip-live`) from the unpacked ops clone against the unpacked
  relay clone for each harness installed on the Linux host, and requires the allow and
  deny replies. That catches a missing file in the guard's load closure before the bundle
  leaves the host.
- Redaction is tested over fixture results that contain two host names, a home path, and
  a truncated capture: the redacted copy keeps distinct host tokens and absolute paths,
  and yields the same verdicts as the raw copy.
- The stages that do not need Darwin (D1, D2, D6, and D8's reap) run on the Linux host
  through the same entry with `--allow-linux`, and so do D5 and D8's reap with their
  constructed parents. The bundle is therefore smoke-tested end to end before it goes to the Mac. D3, D4, D7's sampler and D9 need Darwin `ps`, and the probe refuses to
  run them elsewhere.

## Out of scope

- Familiar's Darwin terminal emission and any launchd schedule (`fam-6e8321`). Relay
  ships no reap schedule; `relay reap` and every hook's own pruning are the only reaping.
- tasks on Darwin: by the parent spec, tasks keeps its unverifiable/TTL claim behaviour
  there, and native Darwin claim liveness is separate work.
- Installing or changing any live hook on the Mac, which is `ai-539508`'s cutover.
- Durability: relay's store renames without `fsync`, and macOS `fsync` does not flush
  the drive cache (`F_FULLFSYNC`). Crash durability is not a Darwin-specific release
  question.
- Intel versus Apple silicon: the probe records the architecture; a second machine is
  not required.
- Running relay's justfile on the Mac: `setup` uses Linux `attr`, and the bundle does not
  use the justfile there.
