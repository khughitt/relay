# Codex worker rows

Status: draft for review, 2026-10-15.
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
scope:     session
root:      codex:R          (new, optional; absent on root rows)
process:   the handle of the nearest codex process (the same as R's)
cwd, repoRoot, remote, projectKey, project, state, updatedAt: as for any row
```

`root` is always the root session, never an immediate parent (fact 4): a nested worker's
row names `codex:R` as well.

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
    handle.
- **No other end.** An interrupted or failed worker turn leaves the row in its last state,
  usually `working`, until one of the above. Relay keeps its rule of no TTL, replay or
  decay (`docs/api.md`). A consumer reading a worker row's `state` must treat it as the
  last event seen, not as proof of activity. tasks is unaffected (fact 9): its claims
  live by the process, and a stale worker row only lets the same worker acquire again,
  which its thread proof already allows.

## Contract changes (`docs/api.md`)

```ts
type Agent = {
  // …unchanged fields
  root?: string;   // Codex workers only: the root session's agent id
};
type Event = {
  // …unchanged fields
  root?: string;   // set on Codex worker events
};
```

Validation, relay side: when `root` is present, the harness is `codex`, `root` is
`codex:<nonempty>`, and it differs from `id`. Root rows never carry it, so every existing
row stays byte-identical. The snapshot schema stays 2: tasks ignores the new field (fact
8), and the shared handle is safe for tasks once the change below is installed. The
rollout order, not a schema bump, keeps an old tasks from meeting worker rows.
Rejected: bumping to schema 3. Every installed tasks would then refuse the whole registry,
Claude sessions included, until upgraded, to protect only the Codex sessions that spawn
workers.

The Event mapping table gains the two rows above; the persisted-contract text gains one
paragraph on worker rows and the cascade on root SessionEnd.

A shared fixture, `test/fixtures/registry-workers.json`, holds a valid schema-2 snapshot
with a root row and two worker rows (one nested) on one handle. Relay's validator tests
read it; tasks vendors it beside `ancestry.json` and `handles.json`, as `relay-4a5559`
proposes for schema contracts.

## The tasks change

In tasks' resolver, after the process filters and before the cardinality refusal: when
the harness is Codex, a hint is present and more than one row qualifies, keep the single
qualifying row whose `sessionId` equals the hint. If none or more than one matches, refuse
as today. The rows all share host, boot, pid and start, so they are one `codex` process;
the hint is tasks' own validated `CODEX_THREAD_ID`; and ids are unique per `sessionId`.
The controller (thread == R) selects the root row and a worker selects its own. This is
the hint-based tie-breaking tasks' §4 deferred "before the producer's worker contract
exists"; this spec is that contract. tasks owns the wording, tests and its spec
amendment. It is filed in tasks as a piece of goal `relay-eaca0e`.

## Rollout

Relay's routing change alone creates worker rows, because PreToolUse is already installed
for every tool. So:

1. tasks' tie-break lands and is installed on every host that enables relay identity.
2. Relay's worker routing, cascade, validator and installer changes land. The relay
   implementation task depends on the tasks piece.
3. The operator cutover (`hq-539508`) installs the hooks, SubagentStart and SubagentStop
   included.

Nothing writes the registry on this host yet (no `agents.json`, no relay hooks, relay
identity off in tasks), so steps 1–2 change nothing live.

familiar (`fam-6e8321`, consuming relay identity) will see worker rows as agents; `root`
lets it group or skip them. That is noted on its task, not gated here.

## Testing

- Adapter: capture-shaped payloads (§7, §8, synthetic ids) normalize to root or worker
  events; a missing, empty or equal `agent_id` on SubagentStart/SubagentStop and on a
  worker-shaped payload is refused.
- Registry: worker events create and update only the worker row; the root row's state is
  untouched through a background worker after the root's Stop; root SessionEnd removes the
  root and its workers, nested included, in one revision; prune removes all rows of a dead
  process; a row with an invalid `root` fails validation.
- Installer: the Codex binding table includes SubagentStart and SubagentStop, and the plan
  and rollback artifacts cover them.
- Subscribers: a guard on Codex `turn-end` still loads, and a SubagentStop denial encodes
  as Stop's.
- Fixture: `registry-workers.json` validates.
- Live acceptance: the capture harness's `single`, `nested` and `background` cases rerun
  with relay's own hook command (installed by `relay install` into the private
  `CODEX_HOME`, with a private `RELAY_STATE_DIR`). Expected: root and worker rows on one
  handle during the run, worker rows named by `agent_id` with `root` set, and an empty
  registry after SessionEnd.

## Out of scope

- Claude Code and OpenCode subagents.
- Worker liveness beyond the process, and any TTL.
- An immediate-parent chain for nested workers.
- macOS evidence: the captures are Linux; the routing reads payload fields only, and the
  handle logic is unchanged.
