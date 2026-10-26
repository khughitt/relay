# Codex worker rows

Status: approved 2026-10-15; implemented 2026-10-15 (`relay-635fdc`, plan
`docs/plans/2026-10-15-codex-worker-rows.md`; acceptance in
`docs/notes/2026-10-15-codex-worker-rows-acceptance.md`).
Task: `relay-6825f7` (goal `relay-eaca0e`; wakes `relay-f56e30`).
Evidence: `docs/notes/2026-10-12-codex-worker-registration-brief.md` §7 and §8 (Codex
0.162.1 captures), reproducible with `tools/codex-subagent-capture/run --case <case>`.
Consumer design: tasks `docs/specs/2026-10-06-delegated-identity-design.md` §4.
Scope: how relay names a Codex worker in the registry, which events create, update and
remove its row, the one tasks change that makes such a row usable, and the rollout order
between them. Handles, liveness, pruning, dispatch budgets and the other harnesses do not
change.

## Problem

A Codex controller and every worker it spawns run in one `codex` process, and every hook
they fire carries the controller's `session_id`. Relay keys rows by `session_id`, so it
publishes one row, the controller's, and it applies a worker's events to that row. tasks,
with relay identity enabled, finds a worker only that root row and refuses it ("only the
Codex root is registered in relay"), so a worker cannot acquire or continue a claim
through relay at all. A worker running after its controller's turn has ended also flips
the controller's row from `done` back to `working` (`relay-15b49c`).

## Facts the design rests on

From the captures (brief §7, §8) and the 0.162.1 source:

1. Every hook a worker fired in the captures (SubagentStart, PreToolUse, PostToolUse,
   SubagentStop) carried the worker's `agent_id`, which is its thread id
   (`CODEX_THREAD_ID`), beside the root `session_id`. No controller hook carried
   `agent_id`. A worker's PermissionRequest was not captured; routing depends only on the
   field's presence, and live acceptance below covers it if it occurs.
2. SubagentStart fires once, before a worker's first turn. SubagentStop fires at the end of
   each *successful* turn. A worker gets no UserPromptSubmit, Stop or SessionEnd, and an
   interrupted or failed turn ends with no event at all.
3. A worker's events can arrive after the controller's Stop, in an interactive session.
4. A nested worker carries its own `agent_id` and the root `session_id`; no payload field
   names its immediate parent.
5. Controller and worker hooks have the same nearest `codex` process, so the same
   process handle.
6. SubagentStop's reply schema is identical to Stop's (`decision`/`reason`).
   SubagentStart's matches SessionStart's.

From tasks (`src/relay/resolve.rs`, `src/relay/snapshot.rs`, `src/claims.rs`):

7. tasks finds its row by process ancestry first: it keeps every row whose handle
   matches the nearest harness process, refuses when more than one remains ("several
   relay agents match"), and only then compares the hint (`CODEX_THREAD_ID`) with that
   row's `sessionId`. Two rows sharing a handle therefore lock out the controller as well
   as the worker.
8. tasks requires `id == <harness>:<sessionId>` and `scope: "session"` for Codex, ignores
   unknown fields, refuses a snapshot whose schema is not 2, and fails the whole snapshot
   on one invalid row.
9. tasks judges a held claim's liveness by the process (pid, start, boot), never by the
   registry, and proves Codex ownership by `CODEX_THREAD_ID` matching the claim. A worker
   row's lifetime therefore affects claim *acquisition* only.

## Decision

**A worker gets its own row, keyed by its `agent_id`, sharing the controller's process
handle and naming its root. tasks selects among rows that share a handle by the thread
hint.**

Row for worker `W` under root session `R`:

```
id:        codex:W          (key and id)
harness:   codex
sessionId: W
scope:     worker           (new value; root rows keep session)
root:      codex:R          (new, optional; present exactly on worker rows)
process:   the handle of the nearest codex process (the same as R's)
cwd, repoRoot, remote, projectKey, project, state, updatedAt: as for any row
```

`root` is always the root session, never an immediate parent (fact 4): a nested worker's
row names `codex:R` as well. `scope: "worker"` marks the row's kind for every reader and is
the tripwire that keeps older relay writers from corrupting worker rows (Older writers,
below).

### Rejected alternatives

- **Worker rows with `process: null`.** No tasks change is needed, since a handle-less row
  never qualifies, but it gives tasks nothing: the worker still finds only the root row
  and is refused. It would serve presentation alone.
- **Worker entries inside the root row** (`workers: {W: …}`). Every consumer would have to
  look inside rows, and tasks' resolver would change more than under the decision.
- **No worker rows; workers claim natively.** tasks' relay level deliberately never falls
  back to native identity, so this needs a tasks policy change that weakens the level's
  process proof for Codex workers. The decision keeps the proof: a worker row is matched
  by the same process evidence as the root.
- **An immediate-parent field from SubagentStop's `transcript_path`.** It is available only
  at a successful turn end, derived from a rollout file name, and tasks' design groups by
  root only.

## Event routing

`normalizeEvent` for Codex reads `agent_id` from the payload:

- **Absent:** unchanged. The event is the root's (`agentId: codex:<session_id>`).
- **Present:** the event is the worker's: `agentId: codex:<agent_id>`,
  `sessionId: <agent_id>`, `root: codex:<session_id>`. `agent_id` must be nonempty text
  different from `session_id`; anything else is `INVALID_INPUT`. `agent_type` is not
  stored.

`Event` gains the optional `root` field, set only on worker events. Subscribers see it in
the guard and observer envelopes; the event schema stays 1, since validators ignore
unknown optional fields. A guard on a worker's PreToolUse thus sees the worker's own id.

New Codex native events, installed by `relay install`:

| Native event | Kind | Level | Reply channel |
| --- | --- | --- | --- |
| SubagentStart | session-start | working | none (as SessionStart) |
| SubagentStop | turn-end | done | refuse, no context (as Stop) |

SubagentStart and SubagentStop without `agent_id` are `INVALID_INPUT`. Giving SubagentStop
Stop's refusal channel keeps an existing guard on Codex `turn-end` valid: the subscriber
loader refuses a guard whose kind includes a native event without one
(`src/subscribers.js`). A refusal there makes the worker continue its turn, as Stop does
for the controller. Relay encodes it as for Stop (`decision: block`, exit 2). Live proof
of that reply belongs to the existing capability gate, not this design.

Worker PreToolUse and PermissionRequest keep their existing kinds, levels and replies;
only the row they update changes.

## Row lifecycle

- **Created or updated** by any worker event (SubagentStart, PreToolUse,
  PermissionRequest, SubagentStop), with the level from the table. Later turns have no
  start event (fact 2), so the first tool event of a turn sets `working` again. A worker
  event for an unknown worker creates its row; one whose root row is absent still names
  `root`.
- **Never changes the root row.** This is the fix `relay-15b49c` asks for.
- **Removed** when:
  - the root's SessionEnd arrives: relay deletes the root row and every row whose `root`
    is that root's id, in the same publication; or
  - the process dies: the existing prune removes it with the root, since they share the
    handle; or
  - a root Codex SessionStart proves the same process (equal platform, host, bootId, pid
    and start; Linux requires bootId, Darwin permits null): it removes other root rows
    plus `done` workers of other roots. Unfinished workers retain their original root;
    a worker SubagentStart never causes this replacement; or
  - its SubagentStop arrives while its own root row is absent and a different root row
    proves the same process as the event. A duplicate stop does not recreate it. Without
    that replacement evidence, worker upserts remain ordinary, including absent-root
    workers. A later tool event can recreate a worker row.
- **Guard denial precedes mutation.** A refused SubagentStop leaves the registry unchanged
  because dispatch returns before applying it; the worker continues with its last row.
- **No inferred end.** An interrupted or failed worker turn leaves the row in its last state,
  usually `working`, until one of the above. Relay keeps its rule of no TTL, replay or
  decay (`docs/api.md`). A consumer reading a worker row's `state` must treat it as the
  last event seen, not as proof of activity. tasks is unaffected (fact 9): its claims
  live by the process, and a stale worker row only lets the same worker acquire again,
  which its thread proof already allows.

Root replacement was added by relay-1ba6de after the recorded switch captures. Ordinary
root events still upsert: missing start/proof can recover, and a late old-root event may
restore duplicate rows. No event history is retained; without a competing root's proof
the original lifecycle applies. Retained `needs-approval` can describe an obsolete
approval request. Registry retirement does not release the old root's process-live
claims or let the new thread release them. Daemon-hosted concurrent roots sharing a
handle remain unverified (relay-511e14). See `docs/api.md` for the current contract.

## Contract changes (`docs/api.md`)

```ts
type Agent = {
  // …unchanged fields
  scope: 'session' | 'process' | 'worker';
  root?: string;   // present exactly when scope is 'worker': the root session's agent id
};
type Event = {
  // …unchanged fields
  root?: string;   // set on Codex worker events
};
```

Validation, relay side: `scope` is `process` for OpenCode, and for Codex either `session`
with no `root`, or `worker` with `root` set to `codex:<nonempty>` different from `id`.
Claude Code rows stay `session`. Root rows are unchanged, so every existing row stays
byte-identical. The snapshot schema stays 2. A tasks without the change below refuses the
whole snapshot while it holds a worker row (`scope` is not `session`), Claude sessions
included: loud, where a `session`-scoped worker row would quietly lock out only the
controller. The rollout installs the change first. Rejected: bumping to schema 3.
Every installed tasks and relay would then refuse the whole registry, Claude sessions
included, from the first publication by an upgraded writer, not only once a worker
appears.

### Older writers

Every relay writer validates the snapshot it read, rebuilds each row from the fields it
knows, and publishes the result: `applyEvent` from any harness's hook, and
`reapRegistry` from `relay reap`. A relay before this change accepting a worker row
under `scope: "session"` would drop `root` on its next publication (a Claude event is
enough), and the root's SessionEnd could no longer find that worker's row. Once dropped,
the association cannot be recovered or even detected: a worker row without `root` looks
like a root row.

`scope: "worker"` closes that path. The pre-change validator accepts only `session` for
Codex, so an older writer refuses the whole snapshot with `INVALID_SCHEMA` and writes
nothing; checked against `main` at `022f29d`, whose `reapRegistry` refused a worker-scope
snapshot and left the file's bytes unchanged. The refusal is loud and bounded: the hook's
registry step reports a diagnostic, its observers are skipped (guards run before the
registry and are unaffected), `relay reap` and `relay list` fail, and nothing is lost.
Rejected: a rollout rule alone, which an overlooked writer would break silently.

The tripwire turns a missed upgrade into a visible failure; it does not replace the
upgrade. The rollout requires every writer to be upgraded before workers appear.

The Event mapping table gains the two rows above; the persisted-contract text gains one
paragraph on worker rows and the cascade on root SessionEnd.

A shared fixture, `test/fixtures/registry-workers.json`, holds a valid schema-2 snapshot
with a root row and two worker rows (one nested) on one handle. Relay's validator tests
read it; tasks vendors it beside `ancestry.json` and `handles.json`, as `relay-4a5559`
proposes for schema contracts.

## The tasks change

tasks' snapshot validator accepts `scope: "worker"` for Codex rows (it may ignore
`root`). In tasks' resolver, after the process filters and before the cardinality refusal:
when the harness is Codex, a hint is present and more than one row qualifies, keep the
single qualifying row whose `sessionId` equals the hint. If none or more than one matches, refuse
as today. The rows all share host, boot, pid and start, so they are one `codex` process;
the hint is tasks' own validated `CODEX_THREAD_ID`; and ids are unique per `sessionId`.
The controller (thread == R) selects the root row and a worker selects its own. This is
the hint-based tie-breaking tasks' §4 deferred "before the producer's worker contract
exists"; this spec is that contract. tasks owns the wording, tests and its spec
amendment. It is filed in tasks as a piece of goal `relay-eaca0e`.

## Rollout

Relay's routing change alone creates worker rows, because PreToolUse is already installed
for every tool. So:

1. tasks' change (worker scope and tie-break) lands and is installed on every host that
   enables relay identity.
2. Relay's worker routing, cascade, validator and installer changes land. The relay
   implementation task depends on the tasks piece.
3. Every relay writer on a host resolves to the upgraded relay before any Codex worker
   event can reach it. The writers are: the installed hook command of every harness
   (Claude Code settings, Codex `hooks.json`, the OpenCode plugin when enabled), every
   `relay reap` invocation (manual or scheduled), and any package that depends on relay
   and calls `applyEvent` or `reapRegistry` (familiar, once `fam-6e8321` consumes relay,
   pins a relay revision of its own). The cutover checklist lists each writer on the host
   and the relay it resolves to.
4. The operator cutover (`hq-539508`) then installs the Codex hooks, SubagentStart and
   SubagentStop included.

A missed writer in step 3 fails closed through the tripwire above. Nothing writes the
registry on this host yet (no `agents.json`, no relay hooks, relay identity off in
tasks), so steps 1–2 change nothing live.

familiar (`fam-6e8321`, consuming relay identity) will see worker rows as agents; `root`
and `scope: "worker"` let it group or skip them, and its pinned relay must satisfy step 3.
That is noted on its task, not gated here.

## Testing

- Adapter: capture-shaped payloads (§7, §8, synthetic ids) normalize to root or worker
  events; a missing, empty or equal `agent_id` on SubagentStart/SubagentStop and on a
  worker-shaped payload is refused.
- Registry: worker events create and update only the worker row; the root row's state is
  untouched through a background worker after the root's Stop; root SessionEnd removes the
  root and its workers, nested included, in one revision; prune removes all rows of a dead
  process; a row with an invalid `root`, a worker scope without `root`, `root` on a
  session row, or a worker scope on a non-Codex row fails validation.
- Installer: the Codex binding table includes SubagentStart and SubagentStop, and the plan
  and rollback artifacts cover them.
- Subscribers: a guard on Codex `turn-end` still loads, and a SubagentStop denial encodes
  as Stop's.
- Fixture: `registry-workers.json` validates.
- Older writer: `reapRegistry` and `applyEvent` from the last pre-change relay revision,
  run against `registry-workers.json` in a private `RELAY_STATE_DIR`, refuse with
  `INVALID_SCHEMA` and leave the file's bytes unchanged.

Live acceptance, after the tasks piece is installed. Both runs use the capture harness's
isolation: a private `CODEX_HOME` (auth copied in, removed on exit) with relay's own hook
command installed by `relay install`, a private `RELAY_STATE_DIR`, and no change to the
user's harness, relay or tasks configuration.

- **Registry rows.** The `single`, `nested` and `background` cases. Expected: root and
  worker rows on one handle during the run, worker rows `codex:<agent_id>` with
  `scope: "worker"` and `root` set, the root row's state untouched by worker events, and
  an empty registry after SessionEnd.
- **Claim acquisition.** One controller/worker run through tasks itself. Isolation adds a
  private `XDG_CONFIG_HOME` and `XDG_STATE_HOME` holding a throwaway tasks project with
  two todo tasks, A and B, and `[identity] relay = true`. Codex runs with
  `sandbox_mode = "danger-full-access"`, so its commands see the host PID view: a
  workspace-write sandbox runs each command under a namespace-local `codex` helper at pid
  1, which hides the session process, and tasks refuses acquisition there before worker
  selection is reached (tasks `docs/notes/2026-09-30-delegated-identity-brief.md`,
  "PID-namespace process proof"). Its `shell_environment_policy` sets the relay and XDG
  variables explicitly and excludes `TASKS_SESSION` and `TASKS_SESSION_PID`. The harness
  confirms both are absent in the commands' environment: an explicit identity override
  bypasses relay selection, so identity must come from the relay row and Codex's native
  thread export alone. The prompt names only `tasks` commands over the throwaway project.
  The controller runs `tasks start A`, then spawns one
  worker that runs `tasks start B`. The worker then attempts `tasks start A`,
  `tasks park A` and `tasks done A`, and the controller, after the worker's turn, attempts
  the same on B. The harness judges the outcome from tasks' and relay's state, not the
  transcript:
  - A's claim is held by the root row's id and B's by the worker row's id, and each
    matches a row present in the registry at acquisition;
  - every cross-claim attempt refuses and leaves both claims' owners unchanged;
  - each task's `started` note carries its own session's provenance.

  A run in which the model deviates from the script (no spawn, commands skipped) is an
  invalid attempt, rerun, not a pass.
- **Sandboxed refusal control.** A separate run with the same private directories under
  a workspace-write sandbox, in which the controller runs only `tasks start A`. Expected:
  the start refuses on process proof and A stays unclaimed. This pins the boundary the
  positive run avoids; it is not a pass condition for worker rows.

## Out of scope

- Claude Code and OpenCode subagents.
- Worker liveness beyond the process, and any TTL.
- An immediate-parent chain for nested workers.
- macOS evidence: the captures are Linux; the routing reads payload fields only, and the
  handle logic is unchanged.
