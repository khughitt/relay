# The session's own process as the agent handle

Status: draft for review, 2026-09-23; revised after review (rollout safety, recovery).
Task: `relay-cb616b`.
Parent design: ops `docs/specs/2026-09-16-relay-design.md` (approved after `d7e2c33`),
section "Process discovery must be separated from terminal discovery".
Scope: which process an `Agent.process` handle names, how an adapter finds it, and the
terminal lookup that stays behind for familiar, and the registry schema bump that keeps
old consumers and old rows from meeting the new meaning. `Handle`, liveness, pruning,
dispatch and budgets do not change.

## Finding

Every adapter resolves the agent handle with one predicate: the nearest ancestor of the
hook, excluding the hook itself, whose `comm` is the harness name **and which owns a
controlling terminal**. It comes from familiar's hook-environment spike (familiar-archive
`docs/spikes/2026-07-11-hook-environment.md`, finding C). That spike wanted the terminal
to paint: it wrote escape sequences to `/proc/<pid>/fd/1`, so a process without a
terminal was the wrong answer. The registry reuses the same pid as the agent's identity
and liveness proof, and for that purpose the predicate names the wrong process whenever
the session itself has no terminal. Three shapes were observed on Linux with Claude Code
2.1.280 and codex-cli 0.156.1 on 2026-09-23:

**Nested headless session.** A `claude -p` run from inside an interactive Claude Code
session. Its SessionStart published `claude-code:<nested id>` with the *outer* session's
pid and start, because the walk skipped the nested `claude` (no terminal) and adopted the
outer one. The registry then held two rows with the same handle. tasks' relay identity
correctly refused the nested session, but refused the outer session too ("several relay
agents match"), and `relay reap` kept the row because the outer process was still alive.
One nested run locked the parent out of claim acquisition until the parent exited.

**Background session.** `claude --bg`, read from `/proc`:

```
2.1.280  …/claude/versions/2.1.280 --session-id 9a2732d5…   tty 34836   <- the session
2.1.280  claude bg-pty-host --bg-pty-host …/9a2732d5.sock   tty 0
claude   claude daemon run --origin transient …              tty 0
systemd --user
```

The session process's `comm` is its version, `2.1.280`, not `claude`, so no predicate
keyed on `comm === 'claude'` can match it. Under systemd the walk yields null and throws
away a provable handle. In the spike's shape, where the daemon's parent was an
interactive `claude`, the walk reached that interactive process: the spike's "real
agent" at depth 4 was the terminal session that hosted the daemon, not the background
session that fired the hook. That is the nested-headless misattribution again, measured
in 370 of 1507 samples.

**Standalone headless Codex.** `codex exec` with no terminal published `process: null`.
That is honest, but the `codex` process that fired the hook was there to be named.

The spike's own chains show the hook's parent is the session process at depth 1: the
harness that fires a hook spawns it. The nearest harness process is therefore the
session's own process by construction. The walk went wrong only where it skipped that
process in search of a terminal.

Codex and OpenCode tests carry a "daemon" case: a same-named process without a terminal
between the hook and the agent. Neither was measured for those harnesses; both were
modelled on the Claude spike.

## Decision

Split the one predicate into two lookups with different answers and different readers.

**Session process** (relay's identity, the registry handle): the nearest ancestor,
excluding index zero, that is a process of the event's harness, with no terminal
requirement. If that process holds a non-session role (below), the result is null: the
walk never continues past the nearest harness process. A borrowed pid is worse than none,
which the parent design already requires ("must not borrow the hook PID or a
terminal-session PID and call it the agent").

**Terminal process** (familiar's paint target): the existing measured predicate,
unchanged: the nearest ancestor whose `comm` is the harness name and which owns a
terminal. Relay keeps exporting it, because familiar's observers run under the relay hook
and inherit the same ancestry. Relay itself no longer calls it.

Rejected: keep the terminal predicate for the handle and add a daemon exclusion by
command line, publishing null for every other terminal-less harness process. That fixes
the nested misattribution and leaves familiar untouched, but it keeps background sessions
unattributed and makes headless sessions permanently unprovable, where the harness
process that fired the hook is sitting one level up.

### Recognizing a harness process

| Harness | A process is this harness when |
| --- | --- |
| `claude-code` | `comm` is `claude`, **or** its executable path ends in `/claude/versions/<comm>` |
| `codex` | `comm` is `codex` |
| `opencode` | `comm` is `opencode` |

The second Claude branch is what finds a background session: the native installer runs
each version as `…/claude/versions/<version>`, and the kernel names a process after the
file it executed. An interactive `claude` launched through the `~/.local/bin/claude`
symlink has the same executable, so both branches agree on it. The executable path is
read only for an ancestor whose `comm` is version-shaped (digits separated by dots,
`^[0-9]+(\.[0-9]+)+$`): the shape gates the read, and the path decides. Other ancestors,
a root-owned `sudo` among them, are never read. On Linux the path is
`readlink /proc/<pid>/exe`; on Darwin it is the unabbreviated `comm` column of
`ps -p <pid>`, which relay today reduces to its basename. An unreadable path for a
version-shaped ancestor is a `PROCESS_UNREADABLE` error, exactly as an unreadable `stat`
is now; it is never treated as "not a harness".

### Non-session roles

The nearest Claude Code process must not be one of its hosting processes. Those share the
same executable as a session, and on a platform where the version branch fails to match,
the walk would otherwise land on them:

| `argv[1]` | Role |
| --- | --- |
| `daemon` | the background-session daemon |
| `bg-pty-host` | the pty host of one background session |

When the nearest Claude Code process has one of these roles, the result is null with the
existing `PROCESS_UNAVAILABLE` diagnostic. The arguments are read for that one process
only: Linux `/proc/<pid>/cmdline`, Darwin `ps -p <pid> -o args=`. Codex and OpenCode have
no measured non-session roles and get no list; one is added only with a measured chain.

## Contract changes

`docs/api.md`, `Adapter`: `resolveAgentPid` is replaced by two functions. There is no
alias under the old name, because every existing caller must choose which answer it
means.

```ts
type Adapter = {
  // …events, stateForEvent, reduceState unchanged
  resolveSessionPid(options?: { startPid?: number; ancestors?: (pid: number) => ProcessRow[];
    executableOf?: (pid: number) => string; argvOf?: (pid: number) => string[] }): number | null;
  resolveTerminalPid(options?: { startPid?: number;
    ancestors?: (pid: number) => ProcessRow[] }): number | null;
};
```

`ProcessOps` gains `executableOf(pid, options)` and `argvOf(pid, options)` with the
error discipline of `recordOf`: a coded `PROCESS_UNREADABLE` or `PROCESS_UNAVAILABLE`
for unreadable evidence, never a default. `MutationOptions.resolveAgentPid` becomes
`resolveSessionPid`. `applyEvent` resolves the handle with `resolveSessionPid`.

`Agent.process` keeps its type. Its meaning is stated: the handle of the process that
*is* the session, not of the terminal that displays it, and null only when no harness
process is an ancestor or the nearest one holds a non-session role. Because the meaning
changes, `Snapshot.schema` becomes `2` (see **Rollout and recovery**). The
sentence "The measured comm/tty predicate skips index zero" becomes a description of
`resolveTerminalPid`, and the session-process rule is documented beside it.

A new fixture corpus, `test/fixtures/ancestry.json`, exported as
`relay/fixtures/ancestry.json`, holds each chain above plus the existing measured ones.
Every row carries `pid`, `ppid`, `comm`, `tty`, `exe` and `argv`, and every chain carries
its harness and the expected session and terminal pids. It is the cross-language contract
for the session-process rule, as `handles.json` is for the handle format.

The ops parent design is amended by reference, not edited here: "Existing ancestor
predicates are preserved for the measured terminal cases" now holds for terminal
discovery only, and its tasks section's "The tty predicate remains part of qualified
process resolution" no longer holds.

## Rollout and recovery

Two hazards follow from changing what a published pid means, and the schema bump
answers both.

**A consumer that predates the change.** tasks mirrors the ancestry walk and today skips
version-named ancestors. Given new relay rows and the chain tasks → `2.1.280` → `claude`,
an old tasks lands on the outer `claude`, finds the outer session's correct row, and,
with no session hint or an inherited outer one, claims as the outer session. This was
reproduced with process shims in review. Ordering the rollouts cannot prevent it,
because relay and tasks are installed separately on each host. The schema can: every
consumer validates `schema`, and tasks rejects anything but `1`. A schema-2 registry is
therefore a refusal for an old tasks, never an identity.

**Rows written under the old rule.** A registry written by old relay can hold a row
that borrowed another session's handle, such as an exited nested session carrying its
parent's pid. Reap keeps it, because the borrowed process is alive, and a later event
from the parent updates only the parent's row, so the ambiguity survives the upgrade.
Which of two rows sharing a handle is the rightful one cannot be told from the registry.
New relay therefore does not migrate schema-1 rows. It supersedes the store:

- A mutation (`applyEvent`, `reapRegistry`) that finds a schema-1 file replaces it, under
  the writer lock, with an empty schema-2 snapshot under a fresh generation, then applies
  its own event. It reports a `REGISTRY_SUPERSEDED` diagnostic listing the dropped agent
  ids. This is the only schema relay replaces rather than rejects; any other unknown
  schema stays `INVALID_SCHEMA`.
- A read (`readSnapshot`, `listAgents`, `relay list`) takes no lock and writes nothing,
  so it fails with a coded `REGISTRY_SUPERSEDED` error: run `relay reap`, or wait for
  any hook event.
- Every live session reappears with a correct handle at its next hook event, because
  every non-end event upserts its row. The cost is registry state between the upgrade
  and each session's next event: familiar reconciles its visuals, and tasks claims keep
  the proof they recorded and do not depend on the row.

The operator procedure after upgrading relay is `relay reap`, which supersedes the file
at once instead of at the next event. No session restart is needed.

## Consumers

**tasks** (relay identity, tasks spec `docs/specs/2026-09-22-relay-ancestry-identity-design.md`)
mirrors the ancestry walk in Rust. It has to adopt the same recognition table and
non-session roles, or a background session's nearest harness for tasks (the daemon,
`comm` `claude`) will disagree with relay's (the `2.1.280` session) and every
acquisition there will refuse. Its tests read the vendored `ancestry.json` at a pinned
revision. Its reader accepts schema `2` only; a schema-1 file is refused with the
supersession message above, not read. The refusal text from `tasks-962300` and the
README paragraph about headless sessions become wrong once a headless session carries a
handle; both change with it. tasks keeps refusing on a null handle; only the reasons it
can meet change. This is a tasks task with its own review, filed when this spec is
approved. Either side may ship first, because each version pairing fails closed: old
tasks refuses a schema-2 registry, and new tasks refuses a schema-1 one. The tasks task
lands before relay's resolver is released, so that relay identity keeps working across
the upgrade rather than refusing until tasks catches up.

**familiar** (`fam-6e8321`, not yet migrated) calls `resolveTerminalPid` wherever it
used the old function for emission, niri window lookup or statusline, and reads
`Agent.process` only as identity and liveness. Its migration plan picks this up; nothing
in familiar changes now.

## Out of scope

- Darwin measurement. The Darwin fixtures keep their current expectations (each resolves
  to a process that is both the session and the terminal). The version-binary branch and
  the role check are specified for Darwin but unmeasured there; the physical Darwin run
  that is already a release requirement adds a background-session chain.
- Codex and OpenCode headless or daemon shapes beyond the standalone `codex exec` chain.
- Telling tasks' nearest-harness scope test anything new beyond the shared table.
- Using a session hint to break ties between rows that share a handle. Supersession
  removes the rows old relay wrote, and the new rule gives each session its own
  process; a shared handle that still appears remains an ambiguity refusal in tasks.

## Verification

- `ancestry.json` chains, each asserting both lookups: interactive Claude (session =
  terminal = `claude`); spike background shape (session = the `2.1.207` process,
  terminal = the depth-4 `claude`; its `exe` reconstructed from the spike's recorded command line); 2.1.280 background shape under systemd (session =
  `2.1.280`, terminal = null); nested `claude -p` (session = nested `claude`, terminal =
  outer `claude`); a chain whose nearest Claude process is `daemon` and one that is
  `bg-pty-host` (session = null); standalone `codex exec` (session = `codex`, terminal =
  null); interactive Codex; the three Darwin chains unchanged.
- An unreadable `exe` or `cmdline` for the ancestor under test surfaces as
  `PROCESS_UNREADABLE`, never as a skip.
- `applyEvent` with a nested chain publishes the nested process's handle, and with the
  outer session's row already present leaves two rows with different handles.
- Live, on Linux, into a private `RELAY_STATE_DIR`: rerun the 2026-09-23 probes (a
  nested `claude -p`, a `claude --bg` session, a `codex exec`) and confirm each row's
  `process.pid` is the process that fired the hook, then confirm with relay identity on
  in tasks (after its task lands) that the outer and nested sessions each acquire a claim.
- Recovery from a contaminated registry: a schema-1 file holding an outer row and an
  exited nested row with the same handle. `relay list` fails with
  `REGISTRY_SUPERSEDED`; `relay reap` replaces it and reports both ids; the outer
  session's next event publishes one row with its own handle; tasks then claims as the
  outer session. The same starting file, handed to an `applyEvent` instead of a reap,
  ends in the same state.
- Mixed versions, fail closed in both directions: the tasks schema-1 reader against a
  schema-2 registry refuses, and the new tasks reader against a schema-1 registry
  refuses with the supersession message.
- The review's chain, tasks → `2.1.280` → `claude`, with a correct outer row present and
  no session hint: new tasks resolves its nearest harness to the `2.1.280` process and
  refuses when that process has no row. It never claims as the outer session.
- `just gate` on Node 22 and the development runtime.
